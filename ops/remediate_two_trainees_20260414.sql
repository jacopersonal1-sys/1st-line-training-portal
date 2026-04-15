-- Targeted remediation for two trainees with broken graduate/migrate lifecycle state.
-- Date: 2026-04-14
-- Usage:
--   psql "postgresql://user:pass@host:port/dbname" -v ON_ERROR_STOP=1 -f ops/remediate_two_trainees_20260414.sql
--
-- What this script does:
-- 1) Backs up affected data (users + active lifecycle rows + rosters snapshot) into a dedicated backup table.
-- 2) Archives prior-attempt lifecycle data into app archive key: app_documents.key='retrain_archives'.
-- 3) Deletes active lifecycle rows that should have been reset on migrate/graduate:
--    - records, submissions, attendance, saved_reports, insight_reviews, live_bookings
--    - exemptions, link_requests, tl_task_submissions
--
-- IMPORTANT:
-- - This script DOES NOT change current roster placement.
-- - Use this when trainees are already in the correct new group and only old attempt data must be archived/reset.
--
BEGIN;

-- 0) Target set (hardcoded to avoid accidental broad changes)
CREATE TEMP TABLE remediation_targets (user_name TEXT PRIMARY KEY);

INSERT INTO remediation_targets (user_name) VALUES
('Nompumelelo Dzingwa'),
('Sichumile Makaula');

-- 1) Backup table (append-only)
CREATE TABLE IF NOT EXISTS backup_user_lifecycle_remediation (
    id BIGSERIAL PRIMARY KEY,
    backup_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    run_tag TEXT NOT NULL,
    user_name TEXT NOT NULL,
    payload JSONB NOT NULL
);

-- 2) Backup payload per trainee
INSERT INTO backup_user_lifecycle_remediation (run_tag, user_name, payload)
SELECT
    'remediate_two_trainees_20260414' AS run_tag,
    t.user_name,
    jsonb_build_object(
        'users', COALESCE((SELECT jsonb_agg(to_jsonb(u.*)) FROM users u WHERE LOWER(COALESCE(u.data->>'user','')) = LOWER(t.user_name)), '[]'::jsonb),
        'records', COALESCE((SELECT jsonb_agg(to_jsonb(r.*)) FROM records r WHERE LOWER(COALESCE(r.trainee,'')) = LOWER(t.user_name)), '[]'::jsonb),
        'submissions', COALESCE((SELECT jsonb_agg(to_jsonb(s.*)) FROM submissions s WHERE LOWER(COALESCE(s.trainee,'')) = LOWER(t.user_name)), '[]'::jsonb),
        'attendance', COALESCE((SELECT jsonb_agg(to_jsonb(a.*)) FROM attendance a WHERE LOWER(COALESCE(a.user_id,'')) = LOWER(t.user_name)), '[]'::jsonb),
        'saved_reports', COALESCE((SELECT jsonb_agg(to_jsonb(sr.*)) FROM saved_reports sr WHERE LOWER(COALESCE(sr.trainee,'')) = LOWER(t.user_name)), '[]'::jsonb),
        'insight_reviews', COALESCE((SELECT jsonb_agg(to_jsonb(ir.*)) FROM insight_reviews ir WHERE LOWER(COALESCE(ir.trainee,'')) = LOWER(t.user_name)), '[]'::jsonb),
        'live_bookings', COALESCE((SELECT jsonb_agg(to_jsonb(lb.*)) FROM live_bookings lb WHERE LOWER(COALESCE(lb.trainee,'')) = LOWER(t.user_name)), '[]'::jsonb),
        'exemptions', COALESCE((SELECT jsonb_agg(to_jsonb(ex.*)) FROM exemptions ex WHERE LOWER(COALESCE(ex.trainee,'')) = LOWER(t.user_name)), '[]'::jsonb),
        'link_requests', COALESCE((SELECT jsonb_agg(to_jsonb(lr.*)) FROM link_requests lr WHERE LOWER(COALESCE(lr.trainee,'')) = LOWER(t.user_name)), '[]'::jsonb),
        'tl_task_submissions', COALESCE((SELECT jsonb_agg(to_jsonb(tts.*)) FROM tl_task_submissions tts WHERE LOWER(COALESCE(tts.user_id,'')) = LOWER(t.user_name)), '[]'::jsonb),
        'rosters_before', COALESCE((SELECT content FROM app_documents WHERE key = 'rosters'), '{}'::jsonb)
    )
FROM remediation_targets t;

-- 3) Build retrain archive entries in the same shape app uses in admin_users.js
CREATE TEMP TABLE remediation_archives AS
SELECT
    t.user_name,
    jsonb_build_object(
        'id', CONCAT('retrain_', EXTRACT(EPOCH FROM NOW())::BIGINT, '_', SUBSTRING(md5(random()::text) FROM 1 FOR 6)),
        'user', t.user_name,
        'movedDate', NOW(),
        'archiveType', 'retrain',
        'reason', 'Ops remediation 2026-04-14 (retroactive archive after migrate/graduate bug)',
        'targetGroup', NULL,
        'records', COALESCE((SELECT jsonb_agg((r.data)) FROM records r WHERE LOWER(COALESCE(r.trainee,'')) = LOWER(t.user_name)), '[]'::jsonb),
        'submissions', COALESCE((SELECT jsonb_agg((s.data)) FROM submissions s WHERE LOWER(COALESCE(s.trainee,'')) = LOWER(t.user_name)), '[]'::jsonb),
        'attendance', COALESCE((SELECT jsonb_agg((a.data)) FROM attendance a WHERE LOWER(COALESCE(a.user_id,'')) = LOWER(t.user_name)), '[]'::jsonb),
        'reports', COALESCE((SELECT jsonb_agg((sr.data)) FROM saved_reports sr WHERE LOWER(COALESCE(sr.trainee,'')) = LOWER(t.user_name)), '[]'::jsonb),
        'reviews', COALESCE((SELECT jsonb_agg((ir.data)) FROM insight_reviews ir WHERE LOWER(COALESCE(ir.trainee,'')) = LOWER(t.user_name)), '[]'::jsonb),
        'notes', NULL
    ) AS archive_entry
FROM remediation_targets t;

-- 4) Append entries into app_documents retrain_archives (preserves existing history)
INSERT INTO app_documents (key, content, updated_at)
VALUES (
    'retrain_archives',
    (SELECT COALESCE(jsonb_agg(archive_entry), '[]'::jsonb) FROM remediation_archives),
    NOW()
)
ON CONFLICT (key) DO UPDATE
SET content = (
    COALESCE(app_documents.content, '[]'::jsonb) ||
    (SELECT COALESCE(jsonb_agg(archive_entry), '[]'::jsonb) FROM remediation_archives)
),
updated_at = NOW();

-- 5) Delete stale active lifecycle rows for the two trainees
DELETE FROM records WHERE LOWER(COALESCE(trainee,'')) IN (SELECT LOWER(user_name) FROM remediation_targets);
DELETE FROM submissions WHERE LOWER(COALESCE(trainee,'')) IN (SELECT LOWER(user_name) FROM remediation_targets);
DELETE FROM attendance WHERE LOWER(COALESCE(user_id,'')) IN (SELECT LOWER(user_name) FROM remediation_targets);
DELETE FROM saved_reports WHERE LOWER(COALESCE(trainee,'')) IN (SELECT LOWER(user_name) FROM remediation_targets);
DELETE FROM insight_reviews WHERE LOWER(COALESCE(trainee,'')) IN (SELECT LOWER(user_name) FROM remediation_targets);
DELETE FROM live_bookings WHERE LOWER(COALESCE(trainee,'')) IN (SELECT LOWER(user_name) FROM remediation_targets);
DELETE FROM exemptions WHERE LOWER(COALESCE(trainee,'')) IN (SELECT LOWER(user_name) FROM remediation_targets);
DELETE FROM link_requests WHERE LOWER(COALESCE(trainee,'')) IN (SELECT LOWER(user_name) FROM remediation_targets);
DELETE FROM tl_task_submissions WHERE LOWER(COALESCE(user_id,'')) IN (SELECT LOWER(user_name) FROM remediation_targets);

-- 6) Verification output
SELECT 'retrain_archives_count' AS section, jsonb_array_length(COALESCE(content, '[]'::jsonb)) AS count
FROM app_documents
WHERE key = 'retrain_archives';

SELECT 'remaining_records' AS section, COUNT(*) AS count
FROM records
WHERE LOWER(COALESCE(trainee,'')) IN (SELECT LOWER(user_name) FROM remediation_targets);

SELECT 'remaining_submissions' AS section, COUNT(*) AS count
FROM submissions
WHERE LOWER(COALESCE(trainee,'')) IN (SELECT LOWER(user_name) FROM remediation_targets);

SELECT 'remaining_attendance' AS section, COUNT(*) AS count
FROM attendance
WHERE LOWER(COALESCE(user_id,'')) IN (SELECT LOWER(user_name) FROM remediation_targets);

SELECT 'backups_written' AS section, COUNT(*) AS count
FROM backup_user_lifecycle_remediation
WHERE run_tag = 'remediate_two_trainees_20260414';

COMMIT;
