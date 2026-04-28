-- Supabase realtime + diagnostics stability setup
-- Run this in Supabase SQL Editor during a quiet window, not while Live Assessment/Vetting is active.
-- The script is idempotent: it skips missing tables/columns and already-added publication entries.

-- 1) Dedicated lightweight health probe table for Network Diagnostics.
create table if not exists public.app_health (
    id text primary key default 'default',
    checked_at timestamptz not null default now()
);

insert into public.app_health (id)
values ('default')
on conflict (id) do nothing;

grant select on public.app_health to anon, authenticated;

-- 2) Keep Supabase Realtime publication focused on app tables only.
do $$
declare
    table_name text;
    realtime_tables text[] := array[
        'app_documents',
        'sessions',
        'live_sessions',
        'live_bookings',
        'vetting_sessions',
        'vetting_sessions_v2',
        'users',
        'records',
        'submissions',
        'attendance',
        'monitor_state',
        'monitor_history',
        'link_requests',
        'exemptions',
        'nps_responses',
        'network_diagnostics',
        'tl_task_submissions',
        'calendar_events',
        'saved_reports',
        'insight_reviews',
        'audit_logs',
        'access_logs',
        'error_reports',
        'archived_users'
    ];
begin
    if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        raise notice 'Publication supabase_realtime does not exist. Skipping realtime publication setup.';
        return;
    end if;

    foreach table_name in array realtime_tables loop
        if to_regclass(format('public.%I', table_name)) is null then
            raise notice 'Skipping missing realtime table: %', table_name;
            continue;
        end if;

        if not exists (
            select 1
            from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public'
              and tablename = table_name
        ) then
            execute format('alter publication supabase_realtime add table public.%I', table_name);
            raise notice 'Added table to supabase_realtime: %', table_name;
        else
            raise notice 'Realtime already enabled for: %', table_name;
        end if;
    end loop;
end $$;

-- 3) Indexes used by sync, active-user status, live assessment, vetting, and diagnostics.
do $$
declare
    item record;
begin
    for item in
        select * from (values
            ('app_documents', 'key', 'idx_app_documents_key'),
            ('sessions', 'username', 'idx_sessions_username'),
            ('sessions', 'lastSeen', 'idx_sessions_last_seen'),
            ('records', 'id', 'idx_records_id'),
            ('records', 'trainee', 'idx_records_trainee'),
            ('submissions', 'id', 'idx_submissions_id'),
            ('submissions', 'trainee', 'idx_submissions_trainee'),
            ('live_bookings', 'id', 'idx_live_bookings_id'),
            ('live_bookings', 'trainee', 'idx_live_bookings_trainee'),
            ('live_sessions', 'id', 'idx_live_sessions_id'),
            ('live_sessions', 'trainer', 'idx_live_sessions_trainer'),
            ('attendance', 'user_id', 'idx_attendance_user_id'),
            ('monitor_state', 'user_id', 'idx_monitor_state_user_id'),
            ('monitor_history', 'user_id', 'idx_monitor_history_user_id'),
            ('link_requests', 'trainee', 'idx_link_requests_trainee'),
            ('exemptions', 'trainee', 'idx_exemptions_trainee'),
            ('nps_responses', 'user_id', 'idx_nps_responses_user_id'),
            ('network_diagnostics', 'id', 'idx_network_diagnostics_id'),
            ('tl_task_submissions', 'user_id', 'idx_tl_task_submissions_user_id'),
            ('calendar_events', 'id', 'idx_calendar_events_id'),
            ('vetting_sessions', 'id', 'idx_vetting_sessions_id'),
            ('vetting_sessions_v2', 'id', 'idx_vetting_sessions_v2_id')
        ) as t(table_name, column_name, index_name)
    loop
        if to_regclass(format('public.%I', item.table_name)) is null then
            raise notice 'Skipping index %. Table missing: %', item.index_name, item.table_name;
            continue;
        end if;

        if not exists (
            select 1
            from information_schema.columns c
            where c.table_schema = 'public'
              and c.table_name = item.table_name
              and c.column_name = item.column_name
        ) then
            raise notice 'Skipping index %. Column missing: %.%', item.index_name, item.table_name, item.column_name;
            continue;
        end if;

        if to_regclass(format('public.%I', item.index_name)) is null then
            execute format('create index %I on public.%I (%I)', item.index_name, item.table_name, item.column_name);
            raise notice 'Created index: %', item.index_name;
        else
            raise notice 'Index already exists: %', item.index_name;
        end if;
    end loop;
end $$;

-- 4) Fresh planner statistics after index changes.
analyze public.app_health;

do $$
declare
    table_name text;
    table_names text[] := array[
        'app_documents',
        'sessions',
        'live_sessions',
        'live_bookings',
        'vetting_sessions',
        'vetting_sessions_v2',
        'records',
        'submissions',
        'attendance',
        'monitor_state',
        'monitor_history'
    ];
begin
    foreach table_name in array table_names loop
        if to_regclass(format('public.%I', table_name)) is not null then
            execute format('analyze public.%I', table_name);
            raise notice 'Analyzed table: %', table_name;
        end if;
    end loop;
end $$;
