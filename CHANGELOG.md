# Changelog

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
