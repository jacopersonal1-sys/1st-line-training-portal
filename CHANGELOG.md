# Changelog

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
