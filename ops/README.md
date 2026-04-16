# Unbind Tshepo Raselabe (ops)

Purpose: safely backup and remove the `boundClientId` key from the `users` table for the user `Tshepo Raselabe`.

Files created:
- `ops/unbind_tshepo.sql` — SQL that prints the matching rows, copies them into `backup_users_tshepo`, removes `boundClientId`, and verifies.
- `ops/unbind_tshepo.sh` — small helper to run the SQL with an explicit typed confirmation.

Usage (examples):

- Inspect the SQL first: `less ops/unbind_tshepo.sql`
- Run it yourself (recommended):
  - `bash ops/unbind_tshepo.sh "postgresql://postgres:YOUR_PASSWORD@169.159.128.176:54323/postgres"`
  - When prompted, type: `I authorize a one-row backup and unbind for Tshepo Raselabe`

Or, provide an admin DB URI here with explicit authorization and I will run it and report the results.

Caution: the script creates a backup table `backup_users_tshepo`. Verify backups and permissions before running.

---

# Remediate Two Trainees (2026-04-14)

Purpose: apply a targeted lifecycle cleanup for:
- `Nompumelelo Dzingwa`
- `Sichumile Makaula`

Files:
- `ops/remediate_two_trainees_20260414.sql`
- `ops/remediate_two_trainees_20260414.sh`

What it does:
- Writes a backup snapshot to `backup_user_lifecycle_remediation` (append-only).
- Appends retrain archive entries to `app_documents.key = 'retrain_archives'` so prior attempt history is preserved.
- Deletes stale active lifecycle rows for those trainees from:
  - `records`, `submissions`, `attendance`, `saved_reports`, `insight_reviews`
  - `live_bookings`, `exemptions`, `link_requests`, `tl_task_submissions`
- Keeps current roster/group placement unchanged.

Usage:
- Inspect SQL first.
- Run:
  - `bash ops/remediate_two_trainees_20260414.sh "postgresql://postgres:YOUR_PASSWORD@HOST:PORT/postgres"`
  - confirm prompt text exactly.

---

# Content Creator Storage Setup (2026-04-16)

Purpose: create and configure Supabase Storage buckets/policies required by the v2.6.21 Content Creator media upload flow.

File:
- `ops/content_creator_storage_20260416.sql`

What it does:
- Ensures bucket `content_creator_videos` exists (public read, video mime types, 500MB limit).
- Ensures bucket `content_creator_documents` exists (public read, PDF mime type, 25MB limit).
- Creates idempotent `storage.objects` policies for `select`, `insert`, `update`, and `delete` on both buckets.

Usage:
- Open Supabase SQL Editor.
- Paste/run the file content from `ops/content_creator_storage_20260416.sql`.
- Confirm verification query output shows both bucket IDs.
