# Changelog

## 2.7.82 - 2026-06-22

- **Live Assessment Start Hotfix:** Normal Test Engine assessments no longer crash on start when the Device Sessions module is loaded but the selected assessment does not require a physical router session.
- **Verification:** Added a regression test for starting a standard trainee assessment with Device Sessions available but not required.

> Release target: stable main channel.

## 2.7.81 - 2026-06-22

- **Assessment Studio Hard Save Guard:** Assessment Studio module saves, host fallback saves, and global blob sync now refuse or merge away any upload that would replace non-empty server Question Bucket/generator/grouping/tag data with an empty local authoring cache.
- **Assessment Studio Database Guard:** Added `ops/assessment_studio_authoring_guard_20260622.sql` so Supabase can preserve recovered authoring arrays even if a stale client attempts an empty-authoring update.
- **Assessment Studio Recovery Safety:** Recovered authoring rebuilt from submitted snapshots is now protected from stale clients that still have empty local caches.
- **Verification:** Full Jest suite passed after the hard save guard.

> Release target: stable main channel.

## 2.7.80 - 2026-06-22

- **Assessment Studio Authoring Guard:** Studio, host, global sync, and Schedule Studio merges now preserve local Question Bucket, generator, grouping, and tag data when a newer partial server document only contains submissions.
- **Assessment Studio Recovery Note:** If a live server document was already overwritten before this build, recover authoring from server backups or submitted `testSnapshot.questions` before running the row backfill; the rebuild keeps existing submissions intact.
- **Violation Evidence Review:** Evidence signed URL creation retries brief Storage/database timeouts before marking an image unavailable.
- **Verification:** Full Jest suite passed after the authoring-preservation fix.

> Release target: stable main channel.

## 2.7.79 - 2026-06-22

- **Assessment Studio Row Safety:** Super Admin Data & Logs now has a guided Assessment/Violation row backfill that previews the write plan, copies only missing or older same-state rows, and skips existing newer/completed/reviewed rows instead of overwriting live review data.
- **Assessment Studio Load Relief:** Assessment Studio submissions and violation reports now have direct exact-row write/read paths for live-critical actions so submit, grading, lock, and review flows do not need to wake the broad document sync path.
- **Assessment Studio Data Safety:** Studio, host, global sync, and Schedule Studio merges now preserve local Question Bucket, generator, grouping, and tag data when a newer partial server document only contains submissions, preventing authoring data from disappearing while completed/grading rows remain visible.
- **Violation Evidence Review:** Evidence signed URL creation retries brief Storage/database timeouts before marking an image unavailable.
- **Device-Limited Assessments:** Admin Tools adds Device Sessions for selected Test Engine or Assessment Studio assessments, allowing only the configured available router sessions to be claimed at runtime and moving completed sessions to Requires Attention for admin release/reset.
- **Admin Load Relief:** Background Network Diagnostics now stays local-only unless the legacy cloud telemetry flag is explicitly enabled, and Super Admin orphan checks use smaller throttled ID probes for high-volume tables such as attendance.
- **Verification:** Live lightweight row-table checks confirmed the new Assessment/Violation row tables are empty before backfill and recent legacy record/submission trainee rows have populated trainee indexes; focused row-backfill, device-session, sync, runtime, live-stats, and grading tests passed before release.

> Release target: stable main channel.

## 2.7.78 - 2026-06-19

- **Realtime Outage Relief:** Realtime fallback polling now reads recovery tables one at a time and stops early when Supabase is returning outage/schema-cache errors, preventing repeated parallel `sessions`, `live_sessions`, and vetting table 503 bursts.
- **Violation Evidence Recovery:** Evidence review now keeps the modal open when an old screenshot object is missing or unsigned, showing the unavailable image slot instead of failing the whole evidence view.

> Release target: stable main channel.

## 2.7.77 - 2026-06-19

- **Violation Evidence Load Relief:** Evidence screenshots now request signed Storage URLs one at a time instead of in parallel, reducing Storage API bursts while admins review violation evidence.
- **Violation Evidence Cleanup Relief:** Approved evidence cleanup now deletes Storage objects and updates evidence metadata one item at a time with a small delay, reducing `544`/database timeout pressure during batch review.

> Release target: stable main channel.

## 2.7.76 - 2026-06-18

- **Startup Recovery:** Initial cloud sync now gives cached startup priority and stops holding login behind slow Supabase row-table reads.
- **Navigation Recovery:** High-priority tab refreshes now start cloud sync in the background instead of showing a route loader while PostgREST is timing out.
- **Assessment Studio Grading:** Opening a grading workspace now renders the grader first and only claims the grading lock after the workspace is mounted, preventing failed opens from leaving stale "You are grading" locks.
- **Sync Load Relief:** `link_requests` now uses the same smaller row-sync limit and timeout cooldown as the other timeout-prone row tables.

> Release target: stable main channel.

## 2.7.75 - 2026-06-18

- **Sync Load Relief:** Row-table pulls now run with controlled concurrency instead of launching every table request at once, reducing Supabase/PostgREST bursts during login and admin navigation.
- **Sync Recovery:** Large row tables now use smaller pull limits and apply a short cooldown after Postgres statement timeouts, preventing the app from immediately retrying the same failing `users`, `submissions`, `exemptions`, `insight_reviews`, `archived_users`, `tl_task_submissions`, or `monitor_state` query.
- **Server Load Relief:** Normal admin navigation no longer runs the broad `records/submissions select id limit 10000` reconciliation scan unless `enable_full_row_reconcile` is explicitly enabled in local storage.

> Release target: stable main channel.

## 2.7.74 - 2026-06-18

- **Super Admin Tools:** The Super Admin DevTools button now uses the preload IPC bridge and can open DevTools in packaged builds.

> Release target: stable main channel.

## 2.7.73 - 2026-06-18

- **Sync Recovery:** `app_documents` pulls now fetch stale document keys one at a time instead of batching multiple JSON documents into one PostgREST request.
- **Sync Recovery:** A single slow/timed-out document key is now skipped with a warning while the rest of the server pull continues, preventing one 500 on rosters/schedules/tests from leaving the whole app stuck at an old sync timestamp.

> Release target: stable main channel.

## 2.7.72 - 2026-06-18

- **Sync Stability:** `error_reports` is now disabled as a live sync dataset. The app clears local legacy error-report cache, stops collecting runtime reports, and filters the key out of normal save/load queues.
- **Server Load Relief:** Old `error_reports` database rows can no longer be pulled into normal app sync or uploaded by background runtime error capture.

> Release target: stable main channel.

## 2.7.71 - 2026-06-18

- **Sync Stability:** Runtime error reporting is now local-first only and no longer immediately uploads `error_reports` while Supabase is already slow, preventing timeout reports from creating more timeout-producing sync calls.
- **Sync Stability:** Normal/non-forced sync defers `error_reports` uploads, and broad local-cache republish no longer includes the timeout-prone diagnostics table.
- **Diagnostics:** Manual sync retry now uses the tiny `app_health` probe before falling back to `app_documents`.

> Release target: stable main channel.

## 2.7.70 - 2026-06-18

- **Trainee Session Control:** Trainee sessions now auto sign out once per day after 17:30, while still allowing the trainee to sign back in afterward if needed.
- **Active User Reporting:** Logout/day-end session writes now mark the session row inactive, and the active-user monitor drops signed-out or stale session rows from the live cache.
- **Diagnostics:** Supabase health checks now prefer the tiny `app_health` table and only fall back to `app_documents` when the health table is unavailable.

> Release target: stable main channel.

## 2.7.69 - 2026-06-18

- **Sync Load Relief:** Current-version admin heartbeat loops now run at a calmer 15-second UI cadence and write DB heartbeat rows no more than every 30 seconds, reducing session-table write pressure while keeping active-user monitoring live.
- **Assessment Studio Scoring:** Multiple-answer auto marking now only deducts for over-selecting beyond the number of correct answers. Wrong selections within the allowed answer count simply miss that option's credit, so selecting three answers with two correct on a three-correct question scores 2/3.
- **Feedback Sessions:** Changing a feedback status now preserves the current Feedback Sessions search/filter/date controls after the save refreshes the view.
- **Assessment Studio Trainee Uploads:** Submit now seals the completed trainee snapshot locally and returns the trainee to My Assessments without trying to upload immediately. The submitted card shows `Upload Needed` with an explicit `Upload Assessment` action, and the existing Supabase-present check still switches to re-upload recovery when the server copy is missing.
- **Verification:** Focused Assessment Studio grading/runtime tests and the full Jest suite passed before release.

> Release target: stable main channel.

## 2.7.68 - 2026-06-18

- **Server Load Relief:** Assessment Studio grading lock heartbeats now run every two minutes with a five-minute lease instead of rewriting the full Studio document every 45 seconds, reducing pressure on the shared `assessment_studio_data` row while still releasing abandoned locks within a short window.
- **Supabase Operations:** Added `ops/supabase_server_hotspot_diagnostics_20260618.sql` for direct Docker/psql diagnostics, autovacuum tuning, index checks, analyze, and normal `VACUUM ANALYZE` on the hot `app_documents` table.
- **Server Compose:** Updated the Supabase server compose copy with conservative Postgres memory/checkpoint settings for the 32 GB RAM server.

> Release target: stable main channel.

## 2.7.67 - 2026-06-18

- **Assessment Studio Trainee Uploads:** Failed trainee submissions now enter an automatic background retry queue instead of requiring repeated Re-upload clicks.
- **Assessment Studio Trainee Uploads:** Re-upload now queues one retry with backoff and shows `Upload Queued` / `Retry Scheduled`, reducing repeated pressure on slow Supabase responses.
- **Assessment Studio Trainee Uploads:** Queued retries use increasing delays up to two minutes and clear automatically once Supabase confirms the submitted snapshot.
- **Verification:** Focused Assessment Studio trainee runtime tests and the full Jest suite passed before release.

> Release target: stable main channel.

## 2.7.66 - 2026-06-18

- **Assessment Studio Grading:** Admins can now add a per-question marker comment while grading each submitted Assessment Studio question.
- **Assessment Studio Grading:** Per-question comments are saved as `questionComments` on the completed grading record and survive Assessment Studio reload/sync normalization.
- **Verification:** Focused Assessment Studio grading tests and the full Jest suite passed before release.

> Release target: stable main channel.

## 2.7.65 - 2026-06-18

- **Assessment Studio Grading Locks:** Grading locks now use a short heartbeat lease so abandoned locks clear quickly instead of blocking other admins for 30 minutes.
- **Assessment Studio Grading Locks:** Active grader workspaces keep their lock alive with a heartbeat, while locks whose heartbeat stops are treated as available.
- **Assessment Studio Grading Locks:** Current admins can release their own older-session locks when returning to the queue or refreshing.
- **Verification:** Focused Assessment Studio grading tests and the full Jest suite passed before release.

> Release target: stable main channel.

## 2.7.64 - 2026-06-18

- **Assessment Studio Grading Locks:** Opening a submission now proves that the grader workspace actually mounted before keeping the grading lock.
- **Assessment Studio Grading Locks:** If the grader does not open after a lock claim, the app releases the lock immediately and returns the admin to the queue with a retry message.
- **Verification:** Focused Assessment Studio grading tests and the full Jest suite passed before release.

> Release target: stable main channel.

## 2.7.63 - 2026-06-18

- **Assessment Studio Grading Locks:** Admins can now reclaim their own stranded grading lock from an older app session instead of being blocked by a stale "`name` is grading" badge.
- **Assessment Studio Grading Locks:** Rows locked by the current admin remain actionable, while rows locked by a different admin still stay protected.
- **Verification:** Focused Assessment Studio grading tests and the full Jest suite passed before release.

> Release target: stable main channel.

## 2.7.62 - 2026-06-18

- **Sync Freeze Guard:** The global Supabase sync overlay is now informational and no longer blocks app navigation or clicks when the server is slow.
- **Sync Freeze Guard:** Long-running sync overlays now auto-dismiss and warn that sync is continuing in the background instead of trapping the UI.
- **Verification:** Focused syntax/sync checks and the full Jest suite passed before release.

> Release target: stable main channel.

## 2.7.61 - 2026-06-18

- **Realtime Load Relief:** Trainee realtime no longer subscribes to heavy `monitor_history` and `nps_responses` row tables.
- **Super Admin Data Studio:** Data Studio realtime now uses explicit per-table bindings and excludes low-priority diagnostic/history tables instead of listening to the whole public schema.
- **Verification:** Focused sync/Assessment Studio tests and the full Jest suite passed before release.

> Release target: stable main channel.

## 2.7.60 - 2026-06-18

- **Assessment Studio Question Bucket:** Newly saved questions now appear immediately in the visible Question Bucket table and point totals without requiring a manual refresh.
- **Verification:** Focused Assessment Studio grading tests and the full Jest suite passed before release.

> Release target: stable main channel.

## 2.7.59 - 2026-06-18

- **Assessment Studio Question Recovery:** Question Bucket saves now verify that the saved question exists in the Supabase Studio document after upload confirmation.
- **Assessment Studio Question Recovery:** Bucket rows now show an `Upload Failed` badge and `Re-upload Question` action when a local question is missing, stale, or failed on Supabase.
- **Assessment Studio Question Recovery:** Re-upload merges the single local bucket question, grouping, and tag metadata back into the shared Studio document without requiring the admin to recreate the question.
- **Verification:** Focused Assessment Studio grading tests and the full Jest suite passed before release.

> Release target: stable main channel.

## 2.7.58 - 2026-06-18

- **Assessment Studio Question Bucket:** Saving a bucket question now commits the question locally and updates the modal/table immediately before waiting for Supabase confirmation, so a slow server no longer leaves admins clicking Save repeatedly.
- **Assessment Studio Question Metadata:** New grouping/tag selections made while saving a question are folded into the same Studio save instead of triggering separate blocking cloud saves first.
- **Verification:** Focused Assessment Studio grading tests and the full Jest suite passed before release.

> Release target: stable main channel.

## 2.7.57 - 2026-06-18

- **Realtime Load Relief:** Admin realtime subscriptions now keep operational tables such as `app_documents`, sessions, submissions, live sessions, and vetting active while excluding heavy diagnostic/history tables that do not need instant fan-out.
- **Sync Load Relief:** General server pulls now skip timeout-prone diagnostic/history row tables so login, Assessment Studio, violations, and submission workflows spend less time waiting behind large background scans.
- **Session Fallback:** Remote command checks still have a REST fallback, but the fallback is throttled when realtime is healthy instead of polling `sessions.pending_action` on every heartbeat.
- **Assessment Studio Sync:** Embedded Studio saves now avoid the duplicate host cloud write after Supabase already confirmed the update, and legacy row-backed data opens from the row cache instead of stale app document blobs.
- **Supabase Maintenance:** Added `ops/supabase_realtime_load_relief_20260618.sql` to trim the realtime publication, add `updated_at` indexes, and analyze the tables that were producing statement timeouts.
- **Verification:** Focused sync tests and the full Jest suite passed before release.

> Release target: stable main channel.

## 2.7.56 - 2026-06-17

- **Assessment Studio Feedback:** Feedback Sessions now persist the selected `None`, `Requested`, or `Received` state onto the actual Assessment Studio submission and host cache.
- **Trainee Matrix View:** Wide matrix questions now adapt column widths, keep row labels visible while scrolling, and leave enough bottom spacing so the Save Draft / Submit bar does not cover answer rows.
- **Trainee Runtime:** The question navigator now marks matrix, matching, and multi-answer questions as complete only when the answer is actually complete.
- **Trainee Runtime:** Saving a draft now correctly captures cleared multi-answer/matching/matrix controls instead of leaving older stored answers behind.
- **Verification:** Focused Assessment Studio grading, sync, and trainee runtime tests passed.

> Release target: stable main channel.

## 2.7.52 - 2026-06-17

- **Assessment Studio:** Question Bucket questions can now include an optional picture, either pasted as an image URL or uploaded directly in the question editor.
- **Trainee View:** Assessment Studio question pictures render under the question text during the trainee test.
- **Grading View:** Admin grading now shows the same question picture while marking, keeping the trainee and admin views aligned.
- **Cache Guard:** The embedded Assessment Studio webview now cache-busts its local module files so refreshed/released UI changes appear reliably.
- **Verification:** Full Jest suite passed before release.

> Release target: stable main channel.

## 2.7.49 - 2026-06-15

- **Attendance Review:** Attendance Register now flags trainee weekdays with no clock-in as **Missing Reviews**, so admins can review the day and record whether the reason is valid.
- **Sync Guard:** Reviewed missing days are saved as attendance rows with reviewer, reason, validity, and timestamp so the review syncs to other admins and does not reappear as an unreviewed generated absence.
- **Assessment Studio:** Grading Queue now defaults to pending-review submissions only, keeping completed tests in Completed Tests instead of mixing them into active grading work.
- **Question Entry Speed:** Assessment Studio question editing now keeps Assessment, Grouping, Tag, and Type pinned at the top and preserves the previous grouping/tag after saving a new question.
- **Verification:** Full Jest suite passed before release.

> Release target: stable main channel.

## 2.7.48 - 2026-06-12

- **Emergency Fix:** Assessment Studio data normalization no longer crashes while loading question bucket or generated submission snapshots.
- **Recovery:** Restores the Grading Queue, Completed Tests, bucket questions, and generated tests after the broken `2.7.47` rollout made Studio data appear empty.
- **Safety Rail:** Added a direct normalizer regression test with bucket questions and completed submissions so this blank-screen failure is caught before release.
- **Verification:** Focused Assessment Studio grading tests passed; full-suite and package verification completed before release.

> Release target: stable main channel.

## 2.7.47 - 2026-06-12

- **Safety Rail:** Assessment Studio grading now mirrors trainee upload recovery: completed grades saved locally but not confirmed on Supabase are flagged with a **Grade Upload Failed** badge.
- **Recovery:** Admins can retry a failed completed-grade upload from the grading/completed queue without reopening or losing the marked scores.
- **Sync Guard:** Assessment Studio now verifies completed local grades against the server document on load/refresh and clears the warning once Supabase confirms the completed record.
- **Verification:** Focused Assessment Studio grading tests passed; full-suite and package verification completed before release.

> Release target: stable main channel.

## 2.7.46 - 2026-06-12

- **Safety Rail:** Assessment Studio question validation now blocks duplicate choices/ranking items, incomplete matching pairs, invalid correct selections, and matrix answers that point to missing columns.
- **Safety Rail:** Trainee Assessment Studio submission now refuses invalid complete-looking answers, including ranking answers with duplicate or missing ordered items.
- **Safety Rail:** Admin grading save now refuses duplicate, missing, out-of-range, or unlinked score inputs before completing a test.
- **Verification:** Focused Assessment Studio grading/trainee runtime tests passed; full-suite and package verification completed before release.

> Release target: stable main channel.

## 2.7.45 - 2026-06-12

- **Fix:** Assessment Studio completed grading now clears stale active grading locks during load/refresh, so rows no longer show an admin as still marking after the test is completed.
- **Sync Guard:** Assessment Studio merge logic now keeps completed/graded submissions authoritative over stale pending-review copies, even when the stale copy has a newer lock timestamp.
- **UI Guard:** Completed queue rows no longer render grading lock badges.
- **Verification:** Focused Assessment Studio grading/sync tests passed; full-suite and package verification completed before release.

> Release target: stable main channel.

## 2.7.44 - 2026-06-12

- **Fix:** Assessment Studio Ranking Order auto-marking now awards proportional points for every item in the correct position, including later correct positions after earlier mistakes.
- **Fix:** Assessment Studio Multiple Answer auto-marking now gives partial credit for correct selections and deducts the same per-option value for extra/wrong selections.
- **Consistency:** Trainee submit-time scores and admin grading queue recalculation now use the same partial-credit rules.
- **Verification:** `npm.cmd test -- --runInBand` passed and `npm.cmd run pack` passed.

> Release target: stable main channel.

## 2.7.43 - 2026-06-12

- **Safety Rail:** Assessment Studio now checks local submitted assessments against Supabase and shows an **Upload Failed** badge with a **Re-upload** action when a local pending/completed submission is missing from the server document.
- **Recovery:** Legacy Test Engine submissions now mark local-only submit failures with the same visible **Upload Failed / Re-upload** action in My Assessments.
- **Guardrail:** Successful verified re-uploads clear the local warning; failed retries keep the warning visible instead of making a local-only submission look safely synced.
- **Verification:** `npm.cmd test -- --runInBand` passed and `npm.cmd run pack` passed.

> Release target: stable main channel.

## 2.7.42 - 2026-06-12

- **Critical Fix:** Assessment Studio trainee runtime now defers background re-renders while a trainee is typing/selecting answers, preventing text fields from losing focus after one character and preserving spacebar input.
- **Recovery:** Trainee devices now silently republish local submitted Assessment Studio submissions that are missing from the server document, so submitted-local cases can be recovered into the admin grading queue when the affected trainee opens My Assessments or the Studio runtime.
- **Safety:** Submit now runs the same server recovery check after the confirmed local save, while still preserving server-authoritative questions, generators, and admin deletes.
- **Verification:** `npm.cmd test -- --runInBand` passed and `npm.cmd run pack` passed.

> Release target: stable main channel.

## 2.7.41 - 2026-06-12

- **Critical Fix:** Realtime queued-update status no longer opens or keeps the full-screen busy overlay, preventing trainees from being blocked mid-assessment while background updates wait to process.
- **Safety:** Incoming realtime queues now have a short typing grace period, priority handling for Assessment Studio, Content Creator, Q&A, schedules, and tests, and repeated-failure protection so one bad payload cannot block every later sync event.
- **Verification:** `npm.cmd test -- --runInBand` passed and `npm.cmd run pack` passed.

> Release target: stable main channel.

## 2.7.40 - 2026-06-12

- **Critical Fix:** Assessment Studio trainee runtime now keeps the active in-progress submission open through realtime/server refresh gaps, preventing timeline-launched assessments from closing a few seconds after launch.
- **Safety:** The runtime fallback only preserves assigned/in-progress active submissions and still blocks submitted/completed assessments from reopening.
- **Verification:** `npm.cmd test -- --runInBand` passed and `npm.cmd run pack` passed.

> Release target: stable main channel.

## 2.7.39 - 2026-06-12

- **Fix:** Assessment Studio admin grading now shows every Multiple Choice and Multiple Answer option, matching the context the trainee saw instead of only showing the selected answer.
- **Fix:** Matrix/Grid grading now marks selected wrong cells and correct cells with clear red/green indicators.
- **Fix:** Ranking Order grading now displays each position as a readable row with correct/incorrect styling and the expected answer beside the trainee answer.
- **Verification:** `npm.cmd test -- --runTestsByPath tests/assessment_studio_grading.test.js tests/sync.test.js tests/schedule_studio_recalculate.test.js tests/test_engine_edge_cases.test.js` passed.

> Release target: stable main channel.

## 2.7.38 - 2026-06-12

- **Fix:** Assessment Studio grading locks now fail closed for completed/non-review submissions so stale "currently marking" badges do not linger on other admin screens after a test is marked or removed.
- **Fix:** Matrix/Grid answer cells now show only the selection dot in trainee and admin views; column names remain in the grid header only.
- **Verification:** `npm.cmd test -- --runTestsByPath tests/assessment_studio_grading.test.js tests/sync.test.js tests/schedule_studio_recalculate.test.js tests/test_engine_edge_cases.test.js` passed.

> Release target: stable main channel.

## 2.7.37 - 2026-06-12

- **Fix:** Assessment Studio grading queue now recalculates fresh auto marks for pending auto-marked questions instead of trusting stale saved `questionScores`.
- **Fix:** Matrix/Grid, Matching/Pairs, Multiple Choice, Multiple Answer, and Ranking auto-score logic now handles the stored trainee answer formats used by timeline-launched generated assessments.
- **Safety:** Completed assessments keep admin-corrected scores when reopened, so manual score corrections are not overwritten by fresh auto scoring.
- **Verification:** `npm.cmd test -- --runTestsByPath tests/assessment_studio_grading.test.js tests/sync.test.js tests/schedule_studio_recalculate.test.js tests/test_engine_edge_cases.test.js` passed.

> Release target: stable main channel.

## 2.7.36 - 2026-06-12

- **Fix:** Assessment Studio admin grading now displays Matching/Pairs answers as structured pair rows instead of a flattened text string.
- **Fix:** Assessment Studio admin grading now displays Matrix/Grid answers in the same grid-style layout trainees see when taking timeline-launched generated assessments.
- **Verification:** `npm.cmd test -- --runTestsByPath tests/sync.test.js tests/schedule_studio_recalculate.test.js tests/test_engine_edge_cases.test.js` passed.

> Release target: stable main channel.

## 2.7.35 - 2026-06-12

- **Fix:** Assessment Studio trainee runtime now renders Matrix/Grid questions as a real responsive grid with column headers and one answer cell per row/column.
- **Fix:** Matching/Pairs questions now use a clearer two-column pairing layout with full-width selects, preventing cramped or misleading answer rows during timeline-launched assessments.
- **Verification:** `npm.cmd test -- --runTestsByPath tests/sync.test.js tests/schedule_studio_recalculate.test.js tests/test_engine_edge_cases.test.js` passed.

> Release target: stable main channel.

## 2.7.34 - 2026-06-12

- **Audit Fix:** Extended the false-sync confirmation audit to more direct `app_documents` writers outside the main studio modules.
- **Safety:** Q&A Hub, Insight subject/HR documents, Superadmin Data Studio document edits, and Hosted HTML Tool metadata now require a returned Supabase `updated_at` before treating a save as confirmed.
- **Guardrail:** Confirmed writes now update local `sync_ts_*` markers so last-sync status cannot look newer than the server acknowledgement.
- **Verification:** `npm.cmd test -- --runTestsByPath tests/sync.test.js tests/schedule_studio_recalculate.test.js` passed.

> Release target: stable main channel.

## 2.7.33 - 2026-06-12

- **Audit Fix:** Hardened additional direct `app_documents` save paths found by the false-confirmation scan.
- **Critical Fix:** OPL Hub now requires Supabase confirmation for document/backend saves and surfaces save failures instead of swallowing cloud sync errors.
- **Safety:** Team Projects production feedback now waits for Supabase confirmation before showing "saved successfully"; unconfirmed feedback stays local with a warning.
- **Verification:** `npm.cmd test -- --runTestsByPath tests/sync.test.js tests/schedule_studio_recalculate.test.js` passed.

> Release target: stable main channel.

## 2.7.32 - 2026-06-11

- **Critical Fix:** Assessment Studio generator saves now require a direct Supabase confirmation from the embedded studio, even when the host bridge is notified, preventing "saved" generator details from staying local and missing Schedule Studio/other admin PCs.
- **Safety:** Content Creator uses the same direct Supabase confirmation pattern so module saves cannot silently depend on a flaky host bridge.
- **Guardrail:** Assessment Studio and Content Creator now surface missing Supabase confirmation as a save error instead of showing false success.
- **Verification:** `npm.cmd test -- --runTestsByPath tests/sync.test.js tests/schedule_studio_recalculate.test.js` passed.

> Release target: stable main channel.

## 2.7.31 - 2026-06-11

- **Fail-Safe:** Added shape validation for server-authoritative Schedule Studio, Q&A Hub, Assessment Studio, and Content Creator documents before pull, realtime, or upload can write them.
- **Safety:** Server-authoritative overwrites now keep a last-good local backup under `server_authority_backup_<key>` before replacing local cache.
- **Guardrail:** Q&A Hub, Assessment Studio, and Content Creator server pulls now mirror the confirmed server document into their `_local` embedded-module caches so stale local copies cannot keep winning after refresh.
- **Guardrail:** Invalid shared documents fail closed and are not retried as poisoned sync queue items.
- **Verification:** `npm.cmd test -- --runTestsByPath tests/sync.test.js tests/schedule_studio_recalculate.test.js` passed.

> Release target: stable main channel.

## 2.7.30 - 2026-06-11

- **Server Authority:** Q&A Hub, Assessment Studio, Content Creator, and Schedule Studio documents are now treated as strict server-authoritative shared blobs, so background cache saves cannot silently republish stale admin structures.
- **Fix:** Q&A Hub admin questions and Content Creator modules now stay server-owned during pull/realtime merges, preventing deleted FAQs or modules from being resurrected from older local cache.
- **Safety:** User activity data still merges forward where appropriate: Q&A asks, Content Creator analytics/annotations, and Assessment Studio trainee submissions remain protected when genuinely newer than the server document.
- **Verification:** `npm.cmd test -- --runTestsByPath tests/sync.test.js tests/schedule_studio_recalculate.test.js` passed.

> Release target: stable main channel.

## 2.7.29 - 2026-06-11

- **Fix:** Schedule Studio now uses delete-aware merging for Assessment Studio generators and Content Creator modules, so newer recreated generators appear while deleted modules are not resurrected from stale cache.
- **Fix:** Assessment Studio now writes its merged loaded document back to both host cache keys, preventing Schedule Studio from reading an old canonical generator list after refresh.
- **Safety:** Content Creator now stamps the full module document on save, giving Schedule Studio a reliable document timestamp to distinguish real deletes from missing stale cache data.
- **Verification:** `npm.cmd test -- --runTestsByPath tests/schedule_studio_recalculate.test.js tests/sync.test.js` passed.

> Release target: stable main channel.

## 2.7.28 - 2026-06-11

- **Fix:** Schedule Studio now merges Content Creator canonical and local module caches by stable module key, so newly saved modules appear in timeline linking even when an older one-module cache exists.
- **Fix:** Assessment Studio and Content Creator embedded loaders now merge canonical/local cache data before injecting studio state, preventing stale host data from hiding newly saved generators or modules.
- **Safety:** Timeline editor now shows empty/missing picker states for Assessment Studio generators and Content Creator modules, and blocks saving a Content Creator module link if the selected module cannot be found.
- **Verification:** `npm.cmd test -- --runTestsByPath tests/schedule_studio_recalculate.test.js tests/sync.test.js` passed.

> Release target: stable main channel.

## 2.7.27 - 2026-06-11

- **Fix:** Live Assessment Booking now keeps the time-slot header sticky while scrolling through the booking grid, with the date column pinned for context.
- **Improvement:** Insight Build's Assessment & Test Scores now uses the same official progress checklist source and status style as the agent progress checklist.
- **Screenshot Safety:** Insight Build cards expand their stat tables/lists instead of forcing inner vertical scrollbars, making review screenshots easier to capture in one pass.
- **Verification:** `npm.cmd test -- --runTestsByPath tests/live_booking_slots.test.js tests/insight_compare_viewer.test.js tests/sync.test.js tests/schedule_studio_recalculate.test.js` passed.

> Release target: stable main channel.

## 2.7.26 - 2026-06-11

- **Safety:** Added Assessment Studio guardrails across the full flow: admin bucket questions, generator setup, Schedule Studio links, trainee launch/submission, and admin grading.
- **Critical Fix:** Assessment Studio trainee forced saves now surface failed Supabase confirmation instead of showing submit/draft success when the cloud write is not confirmed.
- **Fix:** Replaced the missing Assessment Studio icon references with the supported clipboard-list icon in the sidebar, embedded header, module header, and trainee assignment card.
- **Verification:** `npm.cmd test -- --runTestsByPath tests/sync.test.js tests/schedule_studio_recalculate.test.js` passed.

> Release target: stable main channel.

## 2.7.25 - 2026-06-11

- **Recovery:** Extended the one-time first-run recovery check to include Content Creator (`content_studio_data`) and Q&A Hub (`qa_data`) along with Schedule Studio and Assessment Studio.
- **Safety:** Bumped the recovery marker so clients that already ran the 2.7.24 recovery will re-check the expanded set once after this update.
- **Verification:** `npm.cmd test -- --runTestsByPath tests/sync.test.js tests/schedule_studio_recalculate.test.js` passed.

> Release target: stable main channel.

## 2.7.24 - 2026-06-11

- **Critical Fix:** Restored confirmed cloud persistence for Assessment Studio and Content Creator by routing embedded saves through the host sync engine and surfacing failed Supabase writes instead of showing a false synced state.
- **Recovery:** Added a one-time first-run recovery check for recent Schedule Studio and Assessment Studio local changes from the last 20 hours. If Supabase is missing or older than the local cache, the app republishes those documents before the normal server pull can overwrite them.
- **Safety:** Row-table uploads now only mark local hashes as synced after Supabase confirms the write, preventing stale local data from being skipped after a failed upload.
- **Fix:** Schedule Studio now merges Assessment Studio local/canonical caches for generator selection and displays the saved generator point leeway.
- **Verification:** `npm.cmd test -- --runTestsByPath tests/sync.test.js tests/schedule_studio_recalculate.test.js` passed.

> Release target: stable main channel.

## 2.7.23 - 2026-06-10

- **Critical Fix:** Assessment Studio now treats the synced `assessment_studio_data` document as authoritative for admin-created questions, generator details, grading results, and admin deletes, preventing deleted generators/submissions from coming back after refresh.
- **Critical Fix:** Trainee sync now pulls Assessment Studio data and refreshes My Assessments / active Assessment Studio runtime when the shared document changes, so Pending Review updates to Completed with the admin score.
- **Safety:** Trainee draft/submission protection is now scoped to the current trainee and only kept when it is newer than the server document, so one trainee cannot resurrect another trainee's deleted or graded test.
- **Fix:** Schedule Studio now chooses the newest Assessment Studio cache by timestamp instead of item count, and keeps the saved generator point leeway when linking timeline items.
- **Verification:** `npm.cmd test -- --runInBand` passed.

> Release target: stable main channel.

## 2.7.22 - 2026-06-10 (Test Build)

- **Critical Fix:** Assessment Studio admin marking now instantly syncs to all admin instances. When one admin completes marking a test, other admins see the submission removed from their marking queues immediately, even on background tabs.
- **Critical Fix:** Trainees now see completed assessments with updated marks instantly after admin grading. My Assessments view refreshes automatically when submissions/records update via realtime.
- **Critical Fix:** Submission and record deletions now propagate to all users (admins and trainees). When an admin deletes a submission, it's immediately removed from all other admins' queues and trainees' assessment lists.
- Implementation: `js/data.js` processIncomingDataQueue() now always triggers UI refresh for admin/trainee assessment views on submission/record changes (not just active tabs).
- Implementation: `js/assessment_trainee.js` now listens for realtime submission/record changes and auto-refreshes My Assessments.
- Implementation: `js/admin_grading.js` and `js/admin_history.js` now emit data-changed events and sync deletions after hardDelete() succeeds.
- Test Build: Ready for QA testing of assessment studio sync and deletion workflows.

> Release target: test channel.

## 2.7.20 - 2026-06-09

- Fix: Timeline-linked Assessment Studio submissions now stay closed after submission and show Submitted or Graded instead of reopening the test.
- Fix: Trainee runtime no longer displays submitted question answers after an Assessment Studio test is handed in.
- Fix: Completed Assessment Studio grades now win during sync/merge so trainee My Assessments updates from Pending Review to Completed.
- Improvement: Assessment Studio grading now reserves the selected script for the active admin and shows when another admin is grading it.
- Improvement: Assessment Studio grading now opens as a full-width marking workspace with the active trainee/test details kept sticky at the top.
- Improvement: Legacy Test Engine grading now uses a larger full-app style marking view with a sticky test detail header.
- Release: Version bump to `2.7.20` for stable main-channel rollout.

> Release target: stable main channel.

## 2.7.1 - 2026-05-21

- Hotfix: Live Assessment Arena is now hidden unless its own tab is active, preventing the arena layout/background from bleeding into unrelated application views.
- Polish: The active study-session return button is less intrusive and the live trainee arena reserves bottom space so action buttons stay visible.
- Release: Version bump to `2.7.1` for stable main-channel rollout.

> Release target: stable main channel.

## 2.7.0 - 2026-05-21

- Fix: Retrain migration and Insight N/A handling are more reliable for agents moved into new training groups.
- Improvement: Admin navigation now uses a cleaner Navigation Map with drag-and-drop ordering and quick submenus.
- Improvement: Live Assessment Arena now adapts question, answer, chat, and action areas better when UI zoom is high.
- Performance: Trainee login, navigation, embedded modules, and heavy admin views now do less blocking work during startup and tab changes.
- Stability: App modules now use guarded cache reads so corrupt local data is far less likely to crash login, dashboards, reports, scheduling, vetting, or diagnostics.
- Release: Version bump to `2.7.0` for stable main-channel rollout.

> Release target: stable main channel.

## 2.6.99 - 2026-05-20

- Hotfix: Trainee Portal fresh-pull loading no longer replaces the embedded portal iframe during login.
- Fix: If the trainee portal iframe is missing when a refresh runs, the loader remounts it instead of leaving trainees stuck on the loading card.
- Fix: Agent migration now safely handles local storage buckets that contain literal `undefined` values instead of failing with `"undefined" is not valid JSON`.
- Fix: Insight Studio's Migrate action opens the host group selector immediately, then refreshes server data after the target group is confirmed.
- Safety: Retrying a recent failed retrain migration for the same agent and target group now resumes the existing retrain archive and merges any remaining live rows before cleanup.
- Safety: Retrain archives now calculate official progress from the Agent Progress Builder snapshot and count valid N/A marks even when the agent was already pulled between groups.
- Polish: Admin sidebar advanced mode is now a cleaner Navigation Map with priority rows, compact destination tiles, and no visible mini group labels.
- Feature: Navigation Map order can now be changed with drag-and-drop directly from the expanded sidebar or the local customizer, with the first six destinations becoming priority rows.
- Improvement: Navigation Map shortcuts now open as clean inline dropdowns only when requested, keeping the sidebar uncluttered.
- Improvement: Navigation Map now includes shortcut dropdowns for Insight, OPL Hub, Schedule Studio, Live Assessment schedules, Content Creator, Teamleader Hub, Vetting Arena, and Data Studio where those modules expose subviews.
- Performance: Navigation now avoids repeated embedded-theme injection, full-page responsive-table rescans, hidden Admin Tools renders, and unnecessary forced server refreshes on normal admin tab changes.
- Stability: Realtime setup now ignores duplicate same-user channel starts, and boot/notification storage reads are hardened against corrupt JSON cache values.
- Stability: Shared utilities plus Test Builder, Test History, and Capture Scores now handle corrupt local cache values more defensively, and app-wide notification/update/lunch intervals are guarded against duplicate startup registration.
- Stability: Study Monitor now uses defensive cache reads for monitor data, history, whitelists, schedules, users, and trainee bookmarks so corrupted local storage cannot crash activity views or background tracking.
- Performance: Schedule Studio host rendering no longer performs a full server refresh just because a legacy `renderSchedule()` caller touched the replaced schedule tab.
- Stability: The remaining active `schedule.js` Live Assessment Booking paths now read schedules, live schedules, bookings, live sessions, rosters, records, submissions, and repair archives defensively.
- Stability: Admin System maintenance/migration tools and Live Assessment Execution now tolerate corrupt local cache values instead of crashing on bad JSON while reading live sessions, row counts, records, users, or system config.
- Stability: Admin Users, Department Overview analytics, and trainee assessment screens now use defensive cache reads for users, rosters, submissions, schedules, records, notifications, and progress data.
- Stability: Reporting, Agent Search, AI diagnostics, and Dashboard widgets now use defensive cache reads for saved reports, archives, link requests, notices, bookmarks, tips, and system-wide diagnostic data.
- Stability: Assessment Admin marking, quick approve, history review, marking leases, and marker note updates now use defensive cache reads for submissions, records, tests, rosters, and sync hash maps.
- Stability: Main shell, NPS, Vetting runtimes, Insight rules, attendance, and admin assessment workflows now avoid raw local storage JSON parsing in their larger hot paths.
- Stability: Login/auth, calendar, diagnostics, Content Studio, Team Hub, OPL Hub, Q&A Hub, Insight Studio helpers, and Vetting Rework now use guarded cache reads instead of direct local storage JSON parsing.
- Verification: `node --check js\main.js`, `node --check js\trainee_portal_loader.js`, and full Jest passed.

> Release target: stable main channel.

## 2.6.98 - 2026-05-20

- Performance: Trainee login now renders the portal first and moves trainee-scoped server sync plus activity monitor startup into the background.
- Improvement: Trainee Portal now inherits One UI classes and theme tokens from the host shell.
- Improvement: Advanced sidebar navigation now expands into a wider compact grid so more tabs fit on-screen.
- Feature: Advanced sidebar entries can expose quick submenus for Admin Tools, Test Engine, and Onboard Report subviews.
- Verification: Focused syntax checks and Jest coverage passed.

> Release target: stable main channel.

## 2.6.97 - 2026-05-20

- Feature: Added shared app loading surfaces for heavier Supabase pulls, including progress-aware full-sync overlay and reusable inline loaders.
- Improvement: High-priority view refreshes now show calm loading states while server data is pulled before rerendering records, Test Engine, Q&A Hub, trainee portal, and live booking views.
- Improvement: Live Assessment Booking and Super Admin Data Studio now use the shared loader while authoritative booking syncs or embedded Data Studio startup is in progress.
- Performance: Reduced Operations Dashboard render lag by caching per-render localStorage reads, moving storage-size calculation off the critical path, shortening card entrance timing, delegating edit-mode drag events, and avoiding duplicate calendar widget rendering.
- Performance: Dashboard refreshes are now coalesced into idle-time renders, realtime submission updates debounce heavy Test Engine refreshes, and embedded theme syncing is batched to reduce navigation/editing stalls.
- Performance: Insight background refresh no longer replaces the embedded workspace with a route loader after the first render; it now soft-refreshes the webview data after the pull completes.
- Fix: Assessment feedback requests now use an immediate delta sync instead of a forced full upload of all submissions and records.
- Fix: Network Diagnostics is excluded from One UI bottom-sheet modal rules and opens as a large diagnostics workspace.
- Polish: Network Diagnostics modal cards and the admin popout now inherit One UI tokens, theme classes, rounded surfaces, and custom accent variables from the main app.
- Polish: App-wide interaction transitions now target paint-friendly properties instead of using broad `all` transitions.
- Polish: Host theme variables and One UI bridge styling are injected into embedded iframes/webviews so Teamleader Hub, OPL Hub, Q&A Hub, Content Creator, Schedule Studio, and Vetting Arena 2.0 inherit the current app theme more consistently.
- Cleanup: Release sweep checked syntax, merge/debug markers, and focused Test Engine coverage.
- Verification: JS syntax checks and focused Test Engine Jest coverage passed.

> Release target: stable main channel.

## 2.6.96 - 2026-05-19

- Feature: Added assessment feedback requests for completed trainee assessments, including a one-time Feedback Required action in My Assessments.
- Feature: Test Engine & History now includes Feedback Sessions for admins to review requested feedback and mark feedback as given.
- Feature: Admin notification bell now alerts Admin/Super Admin users when a trainee requests assessment feedback.
- Improvement: My Assessments now includes completed live assessment entries, not only upcoming live bookings.
- Improvement: Feedback status now appears in trainee cards, completed history, feedback sessions, and marked script print/review headers.
- Verification: Focused syntax checks and Test Engine Jest coverage passed.

> Release target: stable main channel.

## 2.6.95 - 2026-05-19

- Feature: One UI Clean is now presented as an official workspace theme instead of only an experimental preset.
- Improvement: One UI can now be customized from profile/admin personalization with separate light/dark accent colors, light/dark surface tones, shape, and depth controls.
- Improvement: One UI defaults now use a dark-grey accent palette instead of blue, while keeping light/dark adaptive surfaces.
- Polish: One UI form labels, color inputs, range controls, table headers, dropdowns, active theme cards, embedded program icons, and primary buttons received deeper visual alignment.
- Performance: One UI navigation now defers non-critical table/sync work to idle time, avoids full-sidebar active-state scans, and temporarily disables expensive blur/shadow/transition effects while routes switch.
- Verification: Syntax checks passed for the changed theme scripts.

> Release target: stable main channel.

## 2.6.94 - 2026-05-19

- Feature: One UI Clean is now the default adaptive workspace theme when no custom visual theme is configured.
- Improvement: One UI received deeper shell, card, modal, status-chip, segmented-control, table, toast, and embedded-workspace polish across the main app and isolated modules.
- Performance: Navigation now avoids rebuilding heavy embedded views on return, defers responsive table labelling and fresh server sync until after the tab paints, and debounces repeated tab clicks.
- Fix: Marking queue cleanup now keeps actively marked linked pending submissions visible and repairs stale linked pending rows without archiving them.
- Fix: Admin connectivity testing no longer throws when Local Server fields are absent from the current modal state.
- Verification: Syntax checks and focused Jest suites passed.

> Release target: stable main channel.

## 2.6.93 - 2026-05-19

- Fix: Knowledge Gaps now reads Test Engine question scores from saved submission marks and shows failure rates against all marked attempts.
- Improvement: HR Evidence now saves to the trainee's canonical app name, stable trainee key, and group so Insight Build can reliably display captured evidence.
- Hardening: Vetting submission, force-submit, and admin marking flows now verify critical server saves and avoid false completed states when sync is interrupted.
- Feature: Added the reversible One UI Clean experimental theme with brighter mobile-inspired surfaces, softer cards, and calmer motion.
- Ops: Added Supabase SQL setup for Insight HR Evidence app documents.
- Verification: Focused syntax checks and Jest suites passed.

> Release target: stable main channel.

## 2.6.92 - 2026-05-18

- Feature: Added Insight Build as a dedicated Insight submenu for 3 month trainee probation review deep dives.
- Feature: Insight Build includes the official Assessment / Test Breakdown graph, same-group peer comparison, attendance timeline, focus timeline, and probation review evidence signals.
- Improvement: Attendance and focus probation graphs now render day-by-day timelines instead of the compact Compare Viewer summary style.
- Fix: Attendance timelines now start from trainee first activity/schedule evidence, exclude weekends, separate public holidays from absences, and use a larger readable graph.
- Fix: Focus timelines now understand archived material/tool study summaries and can use the current live monitor feed for the active day.
- Improvement: Compare Viewer, Insight Build, and Department Overview now compile on demand after selecting the target scope, refreshing archived monitor data before rendering heavy graphs.
- Improvement: Assessment / Test Breakdown graphs now show faded Fail, Improve, and Pass goal bands behind the progress lines.
- Improvement: Attendance timelines now label each weekday cell Monday through Friday.
- Fix: Activity Monitor previous-day detail and AI analysis now fetch missing archived monitor days directly from Supabase instead of relying only on the locally pruned cache.
- Fix: Insight Build compile now performs a focused archived monitor pull for the selected trainee and peers, and probation windows use first real activity before falling back to schedule dates.
- Improvement: Insight Build now replaces recent review evidence with a numeric Assessment, Vetting, Live Assessment, and Test score list sorted by course/name.
- Improvement: Insight Build attendance and focus timelines are wider and now include review tables below the graphs for late entries and daily focus scores.
- Improvement: Insight Build now includes a test Performance Evaluation Evidence Grid and Training / Resource Engagement section, with only app-backed review areas auto-populated and an OPL Hub production-readiness note.
- Improvement: Insight Build can now choose current/live training or a detected retrain archive attempt, using archived attendance and focus rows for the selected attempt timelines.
- Feature: Added an HR Evidence submenu for trainee-level manual performance evidence capture, including trigger, description, SharePoint proof link, and screenshot proof, with captured rows shown in Insight Build.
- Improvement: HR Evidence trigger selection now includes all performance evaluation areas, including areas Insight Build also auto-populates, so admins can add manual supporting proof where needed.
- Verification: Focused syntax checks and Jest suite passed.

> Release target: stable main channel.

## 2.6.91 - 2026-05-14

- Feature: Added Admin Tools > Tool Hosting for uploading and replacing two hosted HTML slots: Main HTML Tool and Exported HTML Tool.
- Feature: Added generated hosted URLs, copy/open actions, and usage tracking for hosted HTML views.
- Infrastructure: Added Supabase Storage setup SQL and an Edge Function that serves uploaded HTML with browser-renderable `text/html` responses.
- Verification: Syntax checks and Jest suite passed.

> Release target: stable main channel.

## 2.6.71 - 2026-05-12

- Feature: Added the Q&A Hub admin workspace with editable FAQ entries, trainee question submissions, resource attachments, and in-app resource viewing.
- Improvement: Trainee Q&A now opens question submission as an in-widget compose view instead of occupying the default widget surface.
- Fix: Trainee attached material previews now handle image, video, document, audio, and SharePoint link resources more consistently inside the app.
- Maintenance: Reduced cognitive complexity in selected shared data helpers without changing user-facing behavior.
- Verification: Syntax checks and Jest suite passed.

> Release target: stable main channel.

## 2.6.70 - 2026-05-11

- Improvement: Live Assessment Booking now has a cleaner schedule workspace with more professional booking cards, slot controls, and rule display.
- Feature: Rules of Booking are now editable from Admin Tools > System Config and sync through `live_booking_rules_config`.
- Fix: Live trainee stats now count completed live submissions and records even if the completed booking row is missing.
- Fix: Study Notes pop-out now opens with the trainee's existing notes instead of an empty isolated store.
- Verification: Syntax checks and Jest suite passed.

> Release target: stable main channel.

## 2.6.69 - 2026-05-08

- Fix: Insight Compare Viewer breakdown graphs now render every selected trainee/group row instead of only the first 8.
- Improvement: Compare graph line colors now use a generated color sequence so larger selections get more distinct line colors.
- Verification: Focused syntax checks, Jest suite, and Electron Builder unpacked package check passed.

> Release target: stable main channel.

## 2.6.68 - 2026-05-08

- Feature: Insight Compare Viewer now includes an `Attempt 1 vs Current Live` scope. Selecting trainees in this mode plots each selected trainee's retrain Attempt 1 archive against their current live attempt on the same comparison graphs and matrix.
- Verification: Focused syntax checks, Jest suite, and Electron Builder unpacked package check passed.

> Release target: stable main channel.

## 2.6.67 - 2026-05-08

- Feature: Test Engine Integrity Review now includes retrain archive snapshots alongside assessment/live/vetting entries, with counts and flags for repeated snapshots, mixed-trainee data, empty archives, and excess archive attempts.
- Improvement: Admins can filter specifically to Retrain Archives, inspect archive records/submissions/attendance, mark an archive Valid/Review/Invalid, classify it as A1/A2, clear the decision, or delete a confirmed invalid archive snapshot.
- Verification: Focused syntax checks, Jest suite, and Electron Builder unpacked package check passed.

> Release target: stable main channel.

## 2.6.66 - 2026-05-07

- Fix: Retrain migration now archives the outgoing attempt first, then queues exact hard deletes for the archived row-table data so Supabase cannot reintroduce the old attempt into the trainee's new current group.
- Improvement: Agent Search now labels retrain archives by the stored attempt number/label and keeps the current live attempt separate from archive history.
- Verification: Focused syntax checks, Jest suite, and Electron Builder unpacked package check passed.

> Release target: stable main channel.

## 2.6.65 - 2026-05-07

- Improvement: Test Engine Integrity Review now treats each assessment/live/vetting attempt as one whole entry, with question-level answers and marking used only as supporting evidence.
- Feature: Admins can manually override an integrity entry as Valid, Review, or Invalid and classify it as Attempt 1 or Attempt 2. Overrides persist in `test_integrity_overrides`.
- Verification: Focused syntax checks, full JavaScript syntax sweep, Jest suite, and Electron Builder unpacked package check passed.

> Release target: stable main channel.

## 2.6.64 - 2026-05-07

- Feature: Test Engine now includes an Integrity Review view for assessment, live assessment, and vetting entries. It flags missing test snapshots, low answer coverage, missing manual grading, invalid scores, submission/record mismatches, suspicious zero-score attempts, and inferred repeat attempts by date gaps.
- Safety: Integrity Review is review-first. It does not auto-remove entries; admins must explicitly confirm a flagged submission/record deletion.
- Verification: Focused syntax checks, full JavaScript syntax sweep, Jest suite, and Electron Builder unpacked package check passed.

> Release target: stable main channel.

## 2.6.63 - 2026-05-06

- Improvement: Insight Compare Viewer replaces the Per Person button with an attempt selector for Current Live Attempt, Training Attempt 1 Archive, and Training Attempt 2 Archive.
- Fix: Archived comparison graphs now read from `retrain_archives` snapshots for attempts 1/2 only, keeping bogus higher retain-attempt counts out of the release view.
- Verification: Focused Insight syntax checks, full JavaScript syntax sweep, Jest suite, and Electron Builder unpacked package check passed.

> Release target: stable main channel.

## 2.6.62 - 2026-05-06

- Fix: Insight Compare Viewer now uses current live roster data only and excludes archived, deleted, invalid, blocked, ungrouped, and previous-group assessment/submission rows from comparison graphs.
- Verification: Focused Insight syntax checks passed.

> Release target: stable main channel.

## 2.6.61 - 2026-05-06

- Improvement: Insight Compare Viewer now removes the Metric Shape panel, keeps Ranked Overall, adds selectable comparison result filters, shows selected group members directly, and separates assessment/test, attendance, and focus graphs.
- Verification: Focused Insight syntax check passed.

> Release target: stable main channel.

## 2.6.60 - 2026-05-06

- Improvement: Insight Compare Viewer graph now plots straight per-agent/per-group lines across the actual breakdown items: individual assessments, vetting, live assessments, test submissions, attendance, and focus level.
- Verification: Focused Insight syntax check passed.

> Release target: stable main channel.

## 2.6.59 - 2026-05-06

- Feature: Insight now includes a Compare Viewer sub-menu for per-person and per-group graph comparisons across assessment, vetting, live assessment, test, attendance, focus, progress, violations, and late-coming metrics.
- Verification: Focused Insight syntax checks and Jest suite passed.

> Release target: stable main channel.

## 2.6.58 - 2026-05-06

- Fix: External browser opening now uses the Electron main-process IPC bridge so cPanel/Webmail links do not fail when the packaged preload cannot access `shell.openExternal` directly.
- Verification: Focused Electron/preload/study-monitor syntax checks passed.

> Release target: stable main channel.

## 2.6.57 - 2026-05-06

- Fix: cPanel/Webmail links such as `cp1.herotel.com` now open in the user's normal browser to avoid the embedded Electron view triggering a cPanel `500 Internal Server Error`.
- Fix: Activity monitoring now treats external cPanel/Webmail windows as permitted work activity while trainees use those program links.
- Verification: Full JavaScript syntax sweep and Jest suite passed.

> Release target: stable main channel.

## 2.6.56 - 2026-05-05

- Feature: Training Rules now have a release-ready trainee flow with first-login display, optional every-login redisplay, user/group targeting, rich admin editing, trainee portal access, and dashboard fallback access.
- Feature: First-time trainee setup includes the admin-configured Office dropdown alongside email, phone, and previous experience.
- Fix: Deleting an agent from a group is hardened against malformed local JSON such as literal `"undefined"` and no longer aborts the whole delete when one cloud row-delete cleanup path fails.
- Fix: Legacy admin click handlers for marking finalization, Insight review decisions, and live booking date updates now route to the current implementation instead of failing at click time.
- Fix: Attendance reads tolerate corrupted local attendance payloads and fall back safely.
- Fix: Admin dashboard Insight actions now route to the current Insight Studio.
- Release: Windows packaging now uses the app `ico.ico` instead of the default Electron icon.
- Verification: Full JavaScript syntax sweep, literal route-target scan, inline handler scan, Jest suite, and Electron Builder unpacked package check passed.

> Release target: stable main channel.
