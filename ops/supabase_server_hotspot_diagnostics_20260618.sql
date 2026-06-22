-- BuildZone Supabase server hotspot diagnostics and immediate maintenance
-- Run with Docker psql on the Supabase server, not through Studio when Studio/API is timing out.
--
-- Recommended command from PowerShell on the server:
--   cd "C:\Server\supabase\docker"
--   Get-Clipboard -Raw | docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1
--
-- This script is intentionally conservative:
-- - It reports active waits, table bloat signals, and the largest app_documents blobs.
-- - It tightens autovacuum/analyze on hot application tables.
-- - It refreshes planner statistics and runs normal VACUUM ANALYZE on app_documents.
-- It does not run VACUUM FULL because that requires downtime.

\echo 'BuildZone Supabase hotspot diagnostics started'

set statement_timeout = '10min';
set lock_timeout = '15s';

\echo ''
\echo '0) Ensure lightweight app health probe table exists'
create table if not exists public.app_health (
    id text primary key default 'default',
    checked_at timestamptz not null default now()
);

insert into public.app_health (id)
values ('default')
on conflict (id) do nothing;

grant select on public.app_health to anon, authenticated;

\echo ''
\echo '1) Current database activity and waits'
select
    now() as checked_at,
    pid,
    usename,
    application_name,
    state,
    wait_event_type,
    wait_event,
    age(now(), query_start) as query_age,
    left(regexp_replace(query, '\s+', ' ', 'g'), 240) as query
from pg_stat_activity
where datname = current_database()
  and state <> 'idle'
order by query_start nulls last;

\echo ''
\echo '2) Granted and waiting locks by relation'
select
    coalesce(l.relation::regclass::text, l.locktype) as locked_object,
    l.mode,
    l.granted,
    count(*) as lock_count
from pg_locks l
left join pg_database d on d.oid = l.database
where d.datname = current_database()
   or l.database is null
group by locked_object, l.mode, l.granted
order by granted asc, lock_count desc, locked_object;

\echo ''
\echo '3) Largest app_documents rows'
select
    key,
    pg_size_pretty(pg_column_size(content)::bigint) as content_size,
    pg_column_size(content) as content_bytes,
    updated_at
from public.app_documents
order by pg_column_size(content) desc
limit 30;

\echo ''
\echo '4) app_documents physical size'
select
    pg_size_pretty(pg_relation_size('public.app_documents')) as table_size,
    pg_size_pretty(pg_indexes_size('public.app_documents')) as index_size,
    pg_size_pretty(pg_total_relation_size('public.app_documents')) as total_size;

\echo ''
\echo '5) Table dead tuple and vacuum/analyze status'
select
    relname,
    n_live_tup,
    n_dead_tup,
    round((n_dead_tup::numeric / greatest(n_live_tup, 1)) * 100, 2) as dead_tuple_pct,
    last_vacuum,
    last_autovacuum,
    last_analyze,
    last_autoanalyze
from pg_stat_user_tables
where schemaname = 'public'
order by n_dead_tup desc, n_live_tup desc
limit 40;

\echo ''
\echo '6) Realtime publication tables'
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by schemaname, tablename;

\echo ''
\echo '7) Apply conservative autovacuum settings to hot tables'
do $$
declare
    item text;
    hot_tables text[] := array[
        'app_documents',
        'sessions',
        'users',
        'records',
        'submissions',
        'live_sessions',
        'live_bookings',
        'attendance',
        'monitor_state',
        'assessment_studio_submissions'
    ];
begin
    foreach item in array hot_tables loop
        if to_regclass(format('public.%I', item)) is not null then
            execute format(
                'alter table public.%I set (
                    autovacuum_vacuum_scale_factor = 0.02,
                    autovacuum_analyze_scale_factor = 0.01,
                    autovacuum_vacuum_threshold = 50,
                    autovacuum_analyze_threshold = 50
                )',
                item
            );
            raise notice 'Autovacuum tuned for public.%', item;
        end if;
    end loop;
end $$;

\echo ''
\echo '8) Ensure critical sync indexes exist'
create index if not exists idx_app_documents_updated_at on public.app_documents (updated_at);

do $$
declare
    item record;
begin
    for item in
        select * from (values
            ('sessions', 'username', 'idx_sessions_username'),
            ('sessions', 'lastSeen', 'idx_sessions_last_seen'),
            ('users', 'updated_at', 'idx_users_updated_at'),
            ('records', 'updated_at', 'idx_records_updated_at'),
            ('submissions', 'updated_at', 'idx_submissions_updated_at'),
            ('live_bookings', 'updated_at', 'idx_live_bookings_updated_at'),
            ('live_sessions', 'updated_at', 'idx_live_sessions_updated_at'),
            ('attendance', 'updated_at', 'idx_attendance_updated_at'),
            ('monitor_state', 'updated_at', 'idx_monitor_state_updated_at')
        ) as t(table_name, column_name, index_name)
    loop
        if to_regclass(format('public.%I', item.table_name)) is null then
            continue;
        end if;

        if exists (
            select 1
            from information_schema.columns
            where table_schema = 'public'
              and table_name = item.table_name
              and column_name = item.column_name
        ) and to_regclass(format('public.%I', item.index_name)) is null then
            execute format('create index %I on public.%I (%I)', item.index_name, item.table_name, item.column_name);
            raise notice 'Created index: %', item.index_name;
        end if;
    end loop;
end $$;

\echo ''
\echo '9) Refresh planner statistics'
analyze public.app_documents;

do $$
declare
    item text;
    analyze_tables text[] := array[
        'sessions',
        'users',
        'records',
        'submissions',
        'live_sessions',
        'live_bookings',
        'attendance',
        'monitor_state'
    ];
begin
    foreach item in array analyze_tables loop
        if to_regclass(format('public.%I', item)) is not null then
            execute format('analyze public.%I', item);
            raise notice 'Analyzed public.%', item;
        end if;
    end loop;
end $$;

\echo ''
\echo '10) Normal vacuum analyze on app_documents'
vacuum (analyze, verbose) public.app_documents;

\echo ''
\echo '11) Post-maintenance app_documents size'
select
    pg_size_pretty(pg_relation_size('public.app_documents')) as table_size,
    pg_size_pretty(pg_indexes_size('public.app_documents')) as index_size,
    pg_size_pretty(pg_total_relation_size('public.app_documents')) as total_size;

\echo 'BuildZone Supabase hotspot diagnostics complete'
