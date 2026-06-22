-- BuildZone Supabase realtime/load relief
-- Run in Supabase SQL Editor during a quiet window.
-- Idempotent: skips missing tables/columns and already-existing indexes.

-- 1) Keep high-volume diagnostic/history tables out of Realtime publication.
-- They still sync through normal REST saves and can be fetched by dedicated admin views.
do $$
declare
    table_name text;
    low_priority_tables text[] := array[
        'audit_logs',
        'access_logs',
        'error_reports',
        'monitor_history',
        'network_diagnostics',
        'saved_reports',
        'insight_reviews',
        'archived_users',
        'tl_task_submissions',
        'nps_responses'
    ];
begin
    if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        raise notice 'Publication supabase_realtime does not exist. Skipping publication trim.';
        return;
    end if;

    foreach table_name in array low_priority_tables loop
        if to_regclass(format('public.%I', table_name)) is null then
            raise notice 'Skipping missing table: %', table_name;
            continue;
        end if;

        if exists (
            select 1
            from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public'
              and tablename = table_name
        ) then
            execute format('alter publication supabase_realtime drop table public.%I', table_name);
            raise notice 'Removed low-priority table from supabase_realtime: %', table_name;
        else
            raise notice 'Realtime already trimmed for: %', table_name;
        end if;
    end loop;
end $$;

-- 2) Add indexes for the REST sync shape:
--    updated_at > timestamp order by updated_at asc limit N
-- and for sessions command/heartbeat lookups by username.
do $$
declare
    item record;
begin
    for item in
        select * from (values
            ('app_documents', 'updated_at', 'idx_app_documents_updated_at'),
            ('users', 'updated_at', 'idx_users_updated_at'),
            ('records', 'updated_at', 'idx_records_updated_at'),
            ('submissions', 'updated_at', 'idx_submissions_updated_at'),
            ('live_bookings', 'updated_at', 'idx_live_bookings_updated_at'),
            ('live_sessions', 'updated_at', 'idx_live_sessions_updated_at'),
            ('attendance', 'updated_at', 'idx_attendance_updated_at'),
            ('monitor_state', 'updated_at', 'idx_monitor_state_updated_at'),
            ('link_requests', 'updated_at', 'idx_link_requests_updated_at'),
            ('exemptions', 'updated_at', 'idx_exemptions_updated_at'),
            ('calendar_events', 'updated_at', 'idx_calendar_events_updated_at'),
            ('audit_logs', 'updated_at', 'idx_audit_logs_updated_at'),
            ('access_logs', 'updated_at', 'idx_access_logs_updated_at'),
            ('error_reports', 'updated_at', 'idx_error_reports_updated_at'),
            ('monitor_history', 'updated_at', 'idx_monitor_history_updated_at'),
            ('network_diagnostics', 'updated_at', 'idx_network_diagnostics_updated_at'),
            ('saved_reports', 'updated_at', 'idx_saved_reports_updated_at'),
            ('insight_reviews', 'updated_at', 'idx_insight_reviews_updated_at'),
            ('archived_users', 'updated_at', 'idx_archived_users_updated_at'),
            ('tl_task_submissions', 'updated_at', 'idx_tl_task_submissions_updated_at'),
            ('nps_responses', 'updated_at', 'idx_nps_responses_updated_at'),
            ('vetting_sessions', 'updated_at', 'idx_vetting_sessions_updated_at'),
            ('vetting_sessions_v2', 'updated_at', 'idx_vetting_sessions_v2_updated_at'),
            ('sessions', 'username', 'idx_sessions_username'),
            ('sessions', 'lastSeen', 'idx_sessions_last_seen')
        ) as t(table_name, column_name, index_name)
    loop
        if to_regclass(format('public.%I', item.table_name)) is null then
            raise notice 'Skipping index %. Table missing: %', item.index_name, item.table_name;
            continue;
        end if;

        if not exists (
            select 1
            from information_schema.columns
            where table_schema = 'public'
              and table_name = item.table_name
              and column_name = item.column_name
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

-- 3) Refresh planner statistics.
do $$
declare
    table_name text;
    table_names text[] := array[
        'app_documents',
        'users',
        'records',
        'submissions',
        'live_bookings',
        'live_sessions',
        'attendance',
        'monitor_state',
        'sessions',
        'audit_logs',
        'access_logs',
        'error_reports',
        'monitor_history',
        'network_diagnostics',
        'saved_reports',
        'insight_reviews',
        'archived_users',
        'tl_task_submissions',
        'nps_responses'
    ];
begin
    foreach table_name in array table_names loop
        if to_regclass(format('public.%I', table_name)) is not null then
            execute format('analyze public.%I', table_name);
            raise notice 'Analyzed table: %', table_name;
        end if;
    end loop;
end $$;
