# 1st Line Training Portal - Technical Architecture & Codebase Reference

> **AI INSTRUCTION:** This document contains the definitive technical context for the application. Use this to understand data flows, function responsibilities, and system architecture before proposing code changes.

## 1. System Architecture

**Type:** Thick Client / Local-First SPA
**Runtime:** Electron (Node.js + Chromium)
**Frontend:** Vanilla JavaScript, HTML5, CSS3
**Backend:** Supabase (PostgreSQL + Realtime WebSockets + Presence API)
**Sync Strategy:** Zero-Latency Real-Time Push Architecture with Mutex-Locked Fast Saves

### Core Principles
1.  **True Native Desktop App:** The application is packaged in Electron and uses a preload bridge (`window.electronAPI`) exposed by `preload.js` to mediate OS interactions. Renderer code is expected to use this bridge; direct `require`/`ipcRenderer` usage is guarded and only used when the preload exposes it (code paths check for `require`/`ipcRenderer` before calling native APIs).
2.  **Push-first Real-Time Architecture with Dynamic Fallback:** The app prefers realtime WebSocket delivery (a global listener in `js/data.js`) as the primary update mechanism. However, it also uses role-based heartbeat timers and dynamic fallback polling (via `setInterval`) when the realtime tunnel drops or for targeted recovery tasks. Incoming events are queued and processed to avoid UI focus stealing; the system favors push, but polling is used as a reliable fallback.
3.  **Local-First with Infinite Disk Cache:** `localStorage` acts as the immediate RAM for the UI. To bypass browser limits and prevent data loss, the application silently streams a backup of `localStorage` directly to a native `.json` file on the hard drive via the OS File System.
4.  **Hybrid Sync Engine:**
    *   **Blobs (`app_documents` table):** Low-volume, atomic data (Config, Rosters, Users) syncs as full JSON objects.
    *   **Rows (Dedicated Tables):** High-volume data (Records, Logs, Submissions) syncs as individual rows.
5.  **Authoritative Deletes:** Critical deletions (Groups, Records, Tests) are executed on the server *first* before updating local state to prevent "Ghost Data" recurrence.

---

## 2. Data Schema (`js/data.js`)

### Global Schema (`DB_SCHEMA`)
| Key | Type | Sync Strategy | Description |
| :--- | :--- | :--- | :--- |
| `users` | Array | Row (`users`) with legacy blob fallback | User credentials, roles, themes, and trainee contact metadata. |
| `rosters` | Object | Blob | Group definitions `{ "GroupA": ["User1", "User2"] }`. |
| `system_config` | Object | Blob | Global settings (Sync rates, Security, Failover). **Protected**. |
| `live_assessment_rules_config` | Object | Blob | Editable Live Assessment Arena rule text/HTML shown before the first pushed question. |
| `live_booking_rules_config` | Object | Blob (`app_documents`) | Editable Live Assessment Booking sidebar Rules of Booking text/HTML. |
| `training_rules_config` | Object | Blob (`app_documents`) | Editable Training Rules shown to trainees on first login and/or every login, with all/user/group targeting plus admin-configured office dropdown options. |
| `system_tombstones` | Array | Blob | Persistent blacklist of deleted item IDs used to prevent deleted items from being resurrected during sync. |
| `records` | Array | Row (`records`) | Final assessment scores and grades. |
| `app_documents` | Object | Blob | Generic JSON storage. Used for `tl_personal_lists`, `tl_backend_data`, `tl_agent_feedback`, `opl_hub_data`, `content_studio_data` (Content Creator workspace). |
| `submissions` | Array | Row (`submissions`) | Digital test attempts (answers, timestamps). |
| `auditLogs` | Array | Row (`audit_logs`) | Admin action history. |
| `monitor_history` | Array | Row (`monitor_history`) | Daily activity logs (Pruned locally to 14 days). |
| `violation_reports` | Array | Blob (`app_documents`) | Mandatory trainee explanations for external-app training-scope violations. Stores trigger, reason, platform, person informed, status, and review metadata. |
| `insight_progress_config` | Object | Blob (`app_documents`) | Agent Progress Builder checklist configuration. This is the canonical progress/scoring list for Insight Compare Viewer and Agent Search archive progress, including checklist type and Onboard Report section flags. |
| `insight_rule_config` | Object | Blob (`app_documents`) | Insight severity/threshold trigger mapping. |
| `live_assessment_rules_config` | Object | Blob (`app_documents`) | Rich-text Live Assessment pre-question rules shown in the arena. |
| `live_booking_rules_config` | Object | Blob (`app_documents`) | Rich-text Rules of Booking shown in the Live Assessment Booking sidebar and edited from Admin Tools > System Config. |
| `test_integrity_overrides` | Object | Blob (`app_documents`) | Admin overrides for Test Engine Integrity Review, keyed by whole assessment/live/vetting entry. Stores validity and attempt 1/2 classifications. |
| `adminDecisions` | Object | Blob (`app_documents`) | Legacy Onboard Report manual review decisions keyed by trainee name; kept for report compatibility. |
| `liveSessions` | Array | Row (`live_sessions`) | Active state of Live Assessments. |
| `tests` | Array | Blob | Assessment definitions (Questions, Settings). |
| `liveBookings` | Array | Row (`live_bookings`) | Scheduled slots for live assessments. |
| `attendance_records` | Array | Row (`attendance`) | Clock In/Out logs. |
| `accessLogs` | Array | Row (`access_logs`) | Login/Logout history. |
| `error_reports` | Array | Row (`error_reports`) | Client-side error logs. |
| `savedReports` | Array | Row (`saved_reports`) | Generated Onboard Reports (HTML snapshots). |
| `network_diagnostics` | Array | Row (`network_diagnostics`) | Network health reports (Ping, CPU, RAM). |
| `insightReviews` | Array | Row (`insight_reviews`) | Admin manual reviews of agents. |
| `exemptions` | Array | Row (`exemptions`) | Assessment exemptions. |
| `nps_responses` | Array | Row (`nps_responses`) | Trainee feedback. |
| `graduated_agents` | Array | Row (`archived_users`) | Archived data for former trainees. Graduation snapshots should include original row data plus `progressConfigSnapshot` and `officialProgress` when available. |
| `retrain_archives` | Array | Blob (`app_documents`) | Archived attempt snapshots for trainees moved to retraining groups. Stores the outgoing attempt rows, attempt metadata, cleanup summary, and current progress/scoring snapshot data. |
| `linkRequests` | Array | Row (`link_requests`) | TL requests for assessment links. |
| `calendarEvents` | Array | Row (`calendar_events`) | Custom calendar items. |


**Note:** The runtime uses a local delete queue key `system_pending_deletes` (persisted in localStorage) together with `system_tombstones` to reliably queue and flush deletes to the server and prevent deleted items from reappearing during sync.

### Row-Level Map (`ROW_MAP`)
Maps local `localStorage` keys to Supabase tables.
- `users` -> `public.users`
- `records` -> `public.records`
- `submissions` -> `public.submissions`
- `auditLogs` -> `public.audit_logs`
- `monitor_history` -> `public.monitor_history`
- `accessLogs` -> `public.access_logs`
- `error_reports` -> `public.error_reports`
- `liveSessions` -> `public.live_sessions`
- `liveBookings` -> `public.live_bookings`
- `attendance_records` -> `public.attendance`
- `savedReports` -> `public.saved_reports`
- `insightReviews` -> `public.insight_reviews`
- `exemptions` -> `public.exemptions`
- `nps_responses` -> `public.nps_responses`
- `graduated_agents` -> `public.archived_users`
- `linkRequests` -> `public.link_requests`
- `calendarEvents` -> `public.calendar_events`
- `tl_task_submissions` -> `public.tl_task_submissions`
- `network_diagnostics` -> `public.network_diagnostics`

---

## 3. File Reference & Function Map

### Core Infrastructure

#### `preload.js` (Secure OS Bridge)
- **Responsibility:** Provides a controlled bridge between renderer code and OS capabilities via `window.electronAPI`.
- **Key Objects:** Exposes `window.electronAPI` containing safe wrappers for `ipcRenderer.invoke/send`, `shell.openExternal`, `notifications.show`, and `disk.saveCache/loadCache`.
- **Study Browser Bridge:** Exposes `studyBrowser.clearCache()` and `studyBrowser.openPopout(payload)` for the secure study browser, plus `windowControls.minimize/maximize/close` for frameless app windows.
- **Security:** Mediates access to Node APIs and restricts direct module usage; renderer code still guards `require`/`ipcRenderer` usage and relies on the preload bridge for native operations.

#### `js/main.js` (Bootloader)
- **Responsibility:** App initialization, version checks, failover recovery, global event listeners, and Native OS bridging (`preload.js`).
- **Key Functions:**
    - `window.onload`: Main entry point. Checks `last_connected_server` for server migration logic. Calls `loadFromServer`.
    - `selectBootRole(mode)` / `applyBootRoleUi(mode)` / `getStartupBootRoleMode()`: Startup runtime gate that routes login into Admin/Teamleader runtime or isolated Trainee runtime before normal navigation.
    - `performSilentServerSwitch(newTarget)`: Hot failover helper. **Awaits the full local-to-target migration before pulling**, and rolls back to the previous target if the migration fails.
    - `loadFromServer()`: **CRITICAL**. Orchestrates the sync process. Returns `true` on partial/full success.
    - `startRealtimeSync()`: Starts the background polling loops for Data Sync and Heartbeat.
    - `renderViewById(id, { source })`: Shared tab-render router used by tab switches, high-priority fresh-pull rerenders, and hard refresh flows to prevent duplicate view logic drift.
    - `applySystemConfig()`: Applies hot-reload settings (Announcements, Sync Rates).
    - `checkReleaseNotes(ver)`: Shows changelog popup on update.
    - `performUpdateRestart()`: Saves user state (drafts, active tab) and restarts the app after an update is downloaded.
    - `ensureReportProblemUI()` / `openReportProblemModal()` / `submitReportProblem()`: Global floating Problem Report workflow with captured console snapshot + contextual metadata (`activeTab`, app version, URL).
    - **Updater Channel Guardrails:** Renderer now treats beta payloads as optional installs and only applies intrusive restart/login-block prompts for `main` channel downloads.
    - **Native Overrides:** Intercepts `os-resume` to instantly re-establish WebSockets after a PC wakes from sleep. Intercepts `force-final-sync` to execute Safe Quits.

#### `js/auth.js` (Authentication)
- **Responsibility:** Login, Session Management, Security Checks.
- **Key Functions:**
    - `attemptLogin()`: Validates credentials against `users` array. Checks IP Whitelist, Client ID Ban, and Version.
    - `hashPassword(text)`: SHA-256 hashing for security.
    - `checkAccessControl()`: Verifies user IP against CIDR whitelist.
    - `persistAppSession(user)` / `getPersistentAppSession()`: Preserve the last valid desktop session until logout so full app restarts do not force unnecessary sign-in loops.
    - `secureAuthSave()`: Wrapper for saving user data immediately.

#### `js/data.js` (Sync Engine)
 - **Responsibility:** Data synchronization logic (Pull/Push/Merge), **Global Realtime WebSockets**, and **Supabase Presence API**.
- **Key Functions:**
    - `loadFromServer(silent)`: Pulls data.
        - **Blobs:** Checks `updated_at` timestamps in `app_documents`.
        - **Rows:** Queries tables for rows newer than local `row_sync_ts`.
        - **Ghost Slayer:** Actively purges local cache of items deleted on other clients (Tombstones & Revoked Users).
        - **Local Edits Shield:** Rejects incoming server data if a local, unsynced edit exists for the same item, preventing overwrites.
    - `saveToServer(keys, force)`: Pushes data.
        - **Fast-Save Mutex:** Uses `_IS_PROCESSING_SAVE` lock to allow hyper-fast 500ms saves without overlapping network race conditions.
        - **Failure Re-Queue:** If an upload fails, the current and remaining keys are pushed back into `SAVE_QUEUE` so unsynced local edits are never silently abandoned.
        - **Safe Quit Flush:** Using target `FLUSH`, it awaits the mutex and pushes all remaining data before allowing the OS to kill the app.
    - `safeLocalParse(rawKey) / safeParse(str)`: Parsing helpers that guard against literal `'undefined'` and malformed JSON stored in `localStorage`/other sources to prevent `JSON.parse` crashes.
    - `hardDelete(table,id) / hardDeleteByQuery(...) / processPendingDeletes()`: Local delete queue (`system_pending_deletes`) and persistent tombstone list (`system_tombstones`) are used to queue deletions, apply tombstones locally to prevent resurrection, and flush deletes to the server reliably.
    - `performSmartMerge(server, local)`: Merges arrays/objects. Handles deduplication by ID/Name/Composite Key.
    - `setupRealtimeListeners()`: Subscribes to the entire `public` schema. Routes changes instantly to the `INCOMING_DATA_QUEUE`.
    - `handle...Realtime(payload)`: Pushes incoming realtime events into a temporary `INCOMING_DATA_QUEUE`.
    - `processIncomingDataQueue()`: Processes the queue. Uses `isUserTyping()` to prevent UI re-renders from stealing cursor focus, and re-queues the batch if processing throws so realtime updates are never lost.
    - `sendHeartbeat()`: Uses `window.PRESENCE_CHANNEL.track()` to track active users with 0 database impact.
    - `reportSystemError(msg, type, meta)`: Local-first error/problem report writer to `error_reports` with best-effort sync (`saveToServer`) and metadata fields (`source`, `issueDetail`, `consoleSnapshot`, `pageUrl`, `activeTab`, `appVersion`).

#### `js/config.js` (Configuration)
- **Responsibility:** Supabase Client initialization.
- **Logic:** Reads `active_server_target`. Initializes `window.supabaseClient`. Handles connection failures by triggering **Recovery Mode** (revert to Cloud).
- **Staging:** Overrides credentials if `active_server_target` is 'staging'.

### Assessment Engine

#### `js/admin_builder.js` (Test Creator)
- **Responsibility:** UI for creating/editing assessments.
- **Key Functions:**
    - `loadTestBuilder(id)`: Loads a test into the editor.
    - `saveTest()`: Saves the test definition to `tests` array/table.
    - `loadManageTests()`: Renders the "Assessment Manager" list.
    - `uploadImage(idx, input)`: Converts images/PDFs to Base64 Data URIs.

#### `js/assessment_trainee.js` (Test Taker)
- **Responsibility:** Trainee interface for taking tests.
- **Key Functions:**
    - `openTestTaker(id)`: Initializes a test session. Handles shuffling.
    - `renderTestPaper()`: Renders questions.
    - `submitTest()`: Grades auto-scored questions, saves to `submissions`, and syncs.

#### `js/assessment_admin.js` (Grading)
- **Responsibility:** Marking queue and manual grading.
- **Key Functions:**
    - `loadMarkingQueue()`: Lists pending submissions. Includes "Ghost Data" cleanup to hide invalid retakes and "Auto-Repair" to recover falsely archived tests.
    - `openAdminMarking(id)`: Opens the grading modal.
    - `finalizeAdminMarking(id)`: Saves final scores and creates a permanent `record`.
    - `submitMarking()`: Legacy modal-button compatibility wrapper that resolves the active submission ID from `#markingSubmitBtn.dataset.submissionId` and routes to `finalizeAdminMarking(...)`.
    - `viewCompletedTest(submissionId, ...)`: Digital script view path is strict by `submissionId`; trainee+assessment fallback lookup is retired to prevent duplicate-attempt misbinding.

#### `js/live_execution.js` (Live Arena)
- **Responsibility:** Real-time interactive assessments.
- **Key Functions:**
    - `loadLiveExecution()`: Starts the Live Arena, binds `buildzone:data-changed` listeners, and runs a strict 1-second hard sync loop (targeted `sessionId` refresh) while the Live tab is open.
    - `syncLiveSessionState()`: Reads from `localStorage.getItem('liveSessions')` (realtime cache) and is complemented by targeted session-level refresh fallback for tunnel instability.
    - `adminPushQuestion(idx)`: Updates session state to show a specific question and sends a `sessions.pending_action` live-sync nudge to force trainee refresh if realtime table events lag.
    - `renderTraineeLivePanel()`: Renders the active question for the trainee.
    - `submitLiveAnswer()`: Pushes trainee answer to the server instantly.
    - `updateLiveConnectionStatus()`: Checks `ACTIVE_USERS_CACHE` (Presence API) for trainee connectivity health with zero database impact.

#### `modules/vetting_rework/js/main.js` + `modules/vetting_rework/js/data.js` (Vetting Arena 2.0 Admin Runtime)
- **Responsibility:** Primary admin-side Vetting Arena runtime in isolated webview.
- **Key Functions:**
    - `App.startSession()` / `App.endSession()`: Creates/closes vetting sessions.
    - `App.toggleSecurity()` / `App.overrideSecurity()`: Per-trainee strict/relaxed control and unblock flow.
    - `App.forceRefreshSession()` / `App.forceRefreshTrainee()`: Session-level and per-trainee refresh controls.
    - `DataService.loadInitialData()`: Loads `tests`, `rosters`, and row-synced `users` into the isolated runtime so vetting sessions can resolve roster entries to canonical trainee usernames.
    - `DataService.resolveSessionTargets()`: Resolves targets by username/email/contact aliases before seeding sessions and sending `sessions.pending_action` nudges.
    - `DataService.patchSessionUser()`: Safe per-trainee patching with retry queue.
    - `DataService.pollSessions()` / `DataService.setupRealtime()`: Dual-table session merge (`vetting_sessions_v2` + `vetting_sessions`) with realtime + fallback polling.

#### `js/vetting_rework_loader.js` + `modules/vetting_rework/preload.js` (Vetting Webview Security Bridge)
- **Responsibility:** Host-side secure injection and preload bridge for the isolated Vetting 2.0 admin runtime.
- **Hardening Contract:** Vetting admin webview now runs with `nodeIntegration=no` + `contextIsolation=yes` and uses dedicated preload-only APIs (`get-screen-count`, `get-process-list`, kiosk/content-protection toggles).

#### `js/vetting_runtime_v2.js` (Vetting Arena 2.0 Trainee Runtime Bridge)
- **Responsibility:** Primary trainee-side secure exam flow in host app.
- **Key Functions:**
    - `loadTraineeArena()` / `renderTraineeArena()`: Renders pre-flight, in-test, and submitted waiting states.
    - `checkSystemCompliance()`: Pre-flight checks (monitor count + forbidden apps) with admin override handling.
    - `enterArena()` / `exitArena(keepLocked)`: Kiosk/content protection and submission lock semantics.
    - `checkAndEnforceVetting()`: Auto-route enforcer from login/runtime.
    - `patchTraineeStatus()` / `flushQueuedPatches()`: Safe per-user status sync with retry queue to both vetting tables.
    - `verifySubmissionPipelineForCompletion()`: Completion gate that holds trainee status at `submitting` until authoritative submission pipeline state is verified (includes legacy linked-record fallback by `data.submissionId`).

### Admin Modules

#### `js/admin_users.js` (User Management)
- **Responsibility:** User CRUD, Rosters, Groups.
- **Key Functions:**
    - `loadAdminUsers()`: Renders user list with filters.
    - `addUser()` / `remUser()`: Manages user accounts.
    - `saveRoster()`: Creates/Updates groups.
    - `graduateTrainee()`: Archives a user and wipes their active data. Graduation archive payloads include `progressConfigSnapshot` and `officialProgress` when ProgressCatalog data is available.
    - `confirmMoveUser()`: Moves trainees between groups and writes the outgoing attempt to `retrain_archives` with source rows, attempt metadata, cleanup summary, `progressConfigSnapshot`, and `officialProgress`.
    - `repairArchiveSnapshots()`: Backfills existing graduation and retrain archive snapshots with missing archive IDs/types, current Progress Builder config snapshots, and official progress where original row data is still present.

#### `js/admin_sys.js` (System Tools)
- **Responsibility:** Database tools, Super Admin Console.
- **Key Functions:**
    - `openSuperAdminConfig()`: Opens the master settings modal.
    - `saveSuperAdminConfig()`: Pushes global `system_config`.
    - `performBlobToRowMigration()`: Utility to move data from legacy Blobs to new Tables.
    - `forceMigrationPush()`: Manually triggers the Server Switch migration logic.
    - `checkRowSyncStatus()`: Compares local vs cloud row counts.
    - `performOrphanCleanup()`: Removes local records that no longer exist on the server (Hard Delete sync).
    - `switchToStaging()` / `exitStaging()`: Toggles between Production and Staging environments.
    - `clearSystemErrors()`: **Hard Deletes** all error reports from the cloud table.
    - `viewProblemReports()` / `viewProblemReportDetails()` / `clearProblemReports()`: Dedicated Problem Reports console (user-submitted reports) split from system errors.
    - `emergencyDataRepair()`: Clears local queues/cache and forces a fresh full download (Soft Reset).
    - `openDevTools()`: Opens Electron Developer Tools (Super Admin only).

#### `js/superadmin_data_studio_loader.js` + `modules/superadmin_data_studio/` (Super Admin Data Studio - Isolated Module)
- **Architecture:** Isolated Webview program for live Supabase operations and high-risk admin controls.
- **Entry Point:** `modules/superadmin_data_studio/index.html` mounted by `js/superadmin_data_studio_loader.js`.
- **Key Files:**
    - `js/data.js`: Source catalog for blob/row/doc data, realtime subscriptions, and safe row/document save/delete helpers.
    - `js/main.js`: Multi-tab studio shell (`Overview`, `People`, `User Control`, `Assessments`, `Operations`, `System`, `Raw Explorer`), modal editor flows, and User Control orchestration.
        - **Agent Data Explorer:** Folder-style workspace inside User Control with live + archive folders and per-bucket row visibility.
        - **Bi-Directional Item Moves:** Supports specific row moves live→archive and archive→live for `records`, `submissions`, `live_bookings`, `attendance`, `saved_reports`, and `insight_reviews`.
        - **Move Safeguards:** Each move writes a backup snapshot to `app_documents.key = user_control_move_backups`, validates source row/key integrity, and attempts rollback if live-delete fails.
    - `style.css`: Dedicated studio theme + folder/explorer visuals for bucket drilldown and row operations.

#### `js/ai_core.js` (AI System Analyst)
- **Responsibility:** Gemini Integration (`gemini-1.5-flash`). Handles natural language commands, system diagnostics, and error analysis.
- **Key Functions:**
    - `processRequest(text)`: Sends prompts to the Gemini API via an IPC call (`invoke-gemini-api`) to the main process. This bypasses browser CORS restrictions. It also checks a local `tools` registry for direct command execution.
    - `analyzeError(msg)`: Auto-diagnoses system errors.
    - `runSelfRepair()`: Fixes data integrity issues.
    - `analyzeForImprovements()`: Background task that analyzes logs and suggests system improvements.

#### `js/schedule.js` (Schedule Bridge + Live Booking Engine)
- **Responsibility:** Hosts legacy schedule helpers and the Live Assessment Booking system. Timeline authoring/view now routes through the isolated Schedule Studio module.
- **Key Functions:**
    - `renderSchedule()`: Delegates the Assessment Schedule tab to `ScheduleStudioLoader` (isolated module render path).
    - `renderLiveTable()`: Renders the Live Assessment booking grid.
    - `generateLiveTable()`: Legacy Live Booking "Update Dates" compatibility wrapper; saves current live schedule start/duration and rerenders the grid.
    - `confirmBooking()`: Validates and saves a new booking.
    - `editDailyTrainers(date)`: Configures specific trainers for a single day.
    - `openAdminBookingModal()`: Allows Admins to manually assign a trainee to any empty slot.
    - `liveDrop(event)`: Handles Drag & Drop re-scheduling. Uses `force=true` save to prevent appointments from "bouncing" back.

#### `js/schedule_studio_loader.js` (Schedule Studio Host Bridge)
- **Responsibility:** Injects the Schedule Studio iframe into `#assessment-schedule` and refreshes it through a parent-child bridge.
- **Key Functions:**
    - `renderSchedule()`: Replaced by loader to mount `modules/schedule_studio/index.html?embedded=1`.
    - `ScheduleStudioLoader.refresh()`: Requests in-frame refresh via `App.refresh()` or reload fallback.

#### `modules/schedule_studio/` (Isolated Timeline Program)
- **Architecture:** Program-within-a-program schedule editor running in an isolated iframe.
- **Entry Point:** `modules/schedule_studio/index.html`
- **Key Files:**
    - `js/main.js`: Timeline app controller, admin template manager/apply flow, duration-based date automation, linked content expand/collapse previews, signed URL asset launchers for linked module video/document playback, and editor modal open/scroll reset.
    - `js/data.js`: Shared localStorage/Supabase bridge helpers, business-day date math, template serialization, and content-module discovery that reads both `content_studio_data_local` and canonical `content_studio_data` cache keys.
    - `js/ui_timeline.js`: Timeline tabs, toolbar actions, timeline cards.
    - `js/ui_calendar.js`: Calendar view rendering.
    - `style.css`: Includes sticky modal action footers so Save controls remain reachable on short displays.

#### `js/network_diag.js` (Network Diagnostics)
- **Responsibility:** Real-time network health check (Ping Gateway/Internet/Server) and System Stats (CPU/RAM/Disk).
- **Key Functions:**
    - `NetworkDiag.openModal()`: Opens the diagnostics UI.
    - `NetworkDiag.startTests()`: Starts continuous ping loop via IPC.
    - `NetworkDiag.analyze()`: Interprets metrics to give plain English status (e.g., "Local Gateway Issue").
    - `NetworkDiag.reportToCloud()`: Auto-saves diagnostics to `network_diagnostics` table every 10 mins.
    - `NetworkDiag.init()`: Initializes on load (injected via `index.html`).

### Monitoring & Analytics

#### `js/study_monitor.js` (Activity Tracker)
- **Responsibility:** Tracks active window titles and idle time.
- **Key Functions:**
    - `startActivityPoller()`: **No Frontend Timers.** Listens to `activity-update` from the `electron-main.js` background thread.
    - **Security Model:** The internal study browser (`<webview>`) allows all navigation, as there is no URL bar. Violations are only triggered by the OS-level `startActivityPoller` when the user switches to an unauthorized external application. Trainee study links must route through `window.StudyMonitor.openStudyWindow(...)` so they stay inside the secured Electron overlay instead of using raw `window.open(...)`. The browser shell now uses a dedicated control deck above the `webview`, active overlay mode temporarily disables global floating controls, and inactive webviews are forced off-canvas/non-interactive to prevent embedded-page click dead zones. The Electron `persist:study_session` partition is intentionally kept persistent to improve Microsoft/SharePoint study-session reliability across restarts.
    - **Popout Browser:** `popOutActiveTab(...)` and `openStudyNotesPopout()` use `window.electronAPI.studyBrowser.openPopout(...)` to open the active study tab or notes page in a frameless BrowserWindow with custom minimize/maximize/close/navigation controls. Popout windows keep the `persist:study_session` partition so Microsoft/SharePoint auth continuity is preserved.
    - **Mandatory Violation Capture:** `triggerExternalAppWarning(...)` now opens a blocking violation form that records the triggering external window, required reason, platform, and person informed (`Darren`, `Netta`, `Jaco`) into `violation_reports`. `openViolationReviewModal()` / `renderViolationReviewRows()` provide admin/teamleader review with filters, search, per-agent badges, notification counts, and `markViolationReviewed(...)`.
    - `startMarkForClarity()`: Interactive drawing engine overlay injected into the `<webview>` for precision bounding-box screenshots/bookmarks.
    - `track(activity)`: Logs current activity.
    - `sync()`: Pushes `monitor_data` to server.
    - `checkDailyReset()`: Archives daily logs to `monitor_history` at midnight.

#### `modules/insight_studio/` (Insight)
- **Responsibility:** Admin/super-admin Insight workspace replacing the retired Training Insight Dashboard.
- **Key Functions:**
    - `InsightDataService.getAgentDetail(...)`: Builds agent-level status, attendance, activity, content engagement, TL feedback, timeline, and subject-review state.
    - `InsightDataService.getDepartmentOverview(...)`: Builds department-level health, activity, effort/performance, content engagement, and feedback summaries.
    - `InsightDataService` indexes agent records, submissions, attendance, monitor history, feedback, and reviews in memory per load so Insight startup and tab changes avoid repeated full-array scans.
    - `InsightDataService.buildKnowledgeGaps(...)`: Groups failed questions by assessment, individual, and all groups. A question is failed when its awarded score is below the full available marks, including partial scores like `1/2`.
    - `InsightApp.renderKnowledgeGaps()`: Renders the Knowledge Gaps sub-view inside Insight.
    - `InsightApp.renderCompareViewer()`: Renders Current Live Attempt, Training Attempt 1 Archive, Training Attempt 2 Archive, and Attempt 1 vs Current Live comparison scopes.
    - **Compare Viewer Source of Truth:** Assessment/vetting/live/test score lines prefer Progress Builder official items (`insight_progress_config` through ProgressCatalog/`officialProgress`) over raw records. Extra legacy records not configured in Progress Builder should not affect comparison averages or graph lines.
    - **Compare Graph Semantics:** Missing configured scores are omitted, not plotted as `0%`. A real scored zero still plots as zero. Individual lines are compacted to each person's available scored sequence and stop at the end when later scores do not exist.
    - **Attendance Graph Semantics:** Attendance comparison calculations ignore attendance rows marked `isIgnored` in both score totals and daily grids.

#### `js/analyticsDashboard.js` (Legacy Analytics Helpers)
- **Responsibility:** Shared analytics helpers retained for Agent Search and tests after the old Training Insight Dashboard view was removed.
- **Key Functions:**
    - `renderDepartmentDashboard()`: Renders Effort vs Performance matrix.
    - `renderIndividualProfile()`: Renders detailed agent history and risk score.

#### `js/dashboard.js` (Home Screen)
- **Responsibility:** Main dashboard widgets.
- **Key Functions:**
    - `renderDashboard()`: Builds the grid layout based on user role.
    - `updateDashboardHealth()`: Reads Active Users instantly from `window.ACTIVE_USERS_CACHE` without hitting the database.
    - `buildNoticeManager()`: Admin tool for posting broadcasts.
    - **Training Rules Quick Link:** Legacy trainee-dashboard fallback includes a `training_rules` widget that opens the shared Training Rules modal; the isolated Trainee Portal is the primary trainee landing surface.

#### `js/reporting.js` (Reports)
- **Responsibility:** Onboard Reports and Link Requests.
- **Key Functions:**
    - `generateReport()`: Aggregates data into a printable format.
    - `submitInsightReview()`: Legacy Onboard Report review-modal compatibility handler that saves `adminDecisions` and refreshes the report surface.
    - `saveGeneratedReport()`: Saves snapshot to `savedReports`.
    - `requestRecordLink()`: Handles TL requests for assessment links.

#### `js/attendance.js` (Clock In/Out)
- **Responsibility:** Time tracking.
- **Key Functions:**
    - `readAttendanceRecords()`: Safely parses `attendance_records` with `safeLocalParse` fallback and dedupes by trainee/date.
    - `checkAttendanceStatus()`: Prompts user to clock in.
    - `submitClockIn()` / `submitClockOut()`: Saves timestamp.
    - `renderAttendanceRegister()`: Admin view of lates/absences.
    - `updateAttendanceUI()`: Refreshes the Admin Register UI when realtime data arrives.

#### `modules/team_projects/` (Teamleader Hub - Isolated Module)
- **Architecture:** "Program within a Program". Runs inside a `<webview>` for complete isolation.
- **Entry Point:** `index.html` loaded by `js/tl_tasks.js` with encoded credentials in URL.
- **Files:**
    - `js/main.js`: Core controller. Handles routing (Timeline, My Team, Feedback, Review, etc.).
    - `js/data.js`: Independent data layer. Fetches blobs directly from Supabase (`tl_task_submissions`, `tl_backend_data`, `tl_agent_feedback`).
    - `js/ui_timeline.js`: Renders the Operations Timeline. Supports custom inputs:
        - `outage_form`: Auto-fills areas from backend config. Supports multiple entries.
        - `ticket_backlog`: Tracks total/oldest tickets.
        - `handover_notes`: Structured handover tracking with multiple problem tickets.
        - `bottleneck_form`: Identifies operational bottlenecks with file/link uploads.
    - `js/ui_team.js`: Renders Roster and Calendar views. Supports role assignment (FLA/ESA).
    - `js/ui_backend.js`: Configuration UI for dropdowns (Outage Areas, Bottlenecks, Feedback Categories).
    - `js/ui_feedback.js`: Renders the multi-question "Agent Production Feedback" capture form.
    - `js/ui_feedback_review.js`: Renders the "Feedback Review Dashboard" with Roster, History, and Analytics views.

#### `js/content_studio_loader.js` + `modules/content_studio/` (Content Creator - Isolated Module)
- **Architecture:** "Program within a Program" loaded in a dedicated `<webview>` tab (`content-studio`) with internal submenus (`View`, `Builder`) and themed to match the main app shell.
- **Entry Point:** `modules/content_studio/index.html` mounted by `js/content_studio_loader.js`.
- **Data Key:** `app_documents.key = content_studio_data` (local mirror key: `content_studio_data_local`).
- **Files:**
    - `js/main.js`: Module shell, subnav routing (`View`, `Builder`, `Engagement`), and role-gated Builder/Engagement access.
    - `js/data.js`: Isolated data + sync layer for content entries, media upload metadata, engagement analytics, and annotations.
        - **Single Workspace Model:** Uses a default workspace entry (`content_creator_default`) instead of schedule-timeline binding.
        - **Legacy Migration:** Legacy schedule-linked entries are merged into the default workspace for backward compatibility.
        - **Content Model:** Stores header + subject list (`code`, rich text HTML), optional media toggles (`hasVideo`, `hasDocument`), source mode (`url` or `upload`), and resolved storage paths/URLs for video + PDF.
        - **Storage Integration:** Direct uploads target Supabase Storage buckets `content_creator_videos` and `content_creator_documents`, with signed/public URL resolution on open.
        - **Engagement Model:** Tracks per-user subject analytics (`plays`, `watchSeconds`, `skips`, `skippedSeconds`, `skipEvents`, `lastPosition`, `lastPlayedAt`) and timestamped annotations (`note`/`question`) per user.
    - `js/ui_view.js`: Renders document-style header + subject rows with play/document actions and a subject selector.
        - **Conditional Actions:** Play/Document icons render only when subject media is enabled and linked.
        - **Tracking:** Video playback records watch-time deltas and forward-seek skip events (TikTok-style engagement intent).
        - **In-Player Annotation:** Video modal includes `Add Note / Question`, pauses at current timestamp, saves annotation, and supports timestamp jump-back.
        - **Quiz Launch Bridge:** Questionnaire launch first uses Electron webview `ipcRenderer.sendToHost('content-studio-open-quiz')`, then falls back to parent-window launch/postMessage when embedded outside webview.
    - `js/ui_builder.js`: Builder for header + subjects (custom rich text + optional media) with edit/delete + engagement summary; schedule timeline selector removed.
        - **Media Controls:** Includes yes/no media toggles, source switchers (`HTTP Link` vs `Upload`), video upload, and PDF-only document upload.
    - `js/ui_engagement.js`: Admin/Super Admin engagement workspace for per-user and per-subject breakdown (watch time, plays, skips, notes/questions, last activity).

#### `js/trainee_portal_loader.js` + `modules/trainee_portal/` (Trainee Portal Runtime - Isolated Module)
- **Architecture:** Program-within-a-program trainee workspace mounted in `#trainee-portal` and isolated from admin-heavy views.
- **Entry Point:** `modules/trainee_portal/index.html?embedded=1` mounted by `js/trainee_portal_loader.js`.
- **Key Behaviors:**
    - Visual widget dashboard with drag/reorder/resize layout persistence per trainee (`trainee_portal_layout_v2_<user>`).
    - Widget actions route to existing host tabs (`assessment-schedule`, `my-tests`, `live-assessment`, `live-execution`, `study-notes`) while keeping trainee runtime isolation boundaries.
    - Attendance + badges + results + notes/clarity metrics are aggregated from trainee-scoped local cache (`records`, `submissions`, `liveBookings`, `attendance_records`, `trainee_bookmarks`).
    - Training Rules are exposed in the header action row and as a configurable `training_rules` widget, both bridged to host `openTrainingRulesModal()`.
    - Loader bridges module auto-refresh lifecycle directly (start/stop), avoiding duplicate host interval polling.

#### `js/study_notes.js` + `modules/study_notes/` (Study Notes Runtime - Isolated Module)
- **Architecture:** Isolated notes workspace mounted in `#study-notes` and designed for section -> page -> note authoring flow.
- **Entry Point:** `modules/study_notes/index.html?embedded=1` mounted by `js/study_notes.js`.
- **Data Key:** `study_notes_v2` (per-user workspace object), with clarity integration from `trainee_bookmarks`.
- **Key Behaviors:**
    - Section/page CRUD (`add`, `rename`, `delete`, `select`) with active selection state (`activeSectionId`, `activePageId`).
    - Debounced save and host sync bridge (`saveToServer(['study_notes_v2'])`).
    - Bookmark insertion pipeline that converts clarity marks into structured note blocks.
    - Event-driven rerender (`buildzone:data-changed`) for `study_notes_v2` and `trainee_bookmarks`; no loader-level polling loop.

---

## 4. Critical Workflows
### H. The Demo Sandbox (Data Isolation)
1.  **Intercept:** `auth.js` intercepts logins for `demo_admin`/`demo_tl`/`demo_trainee`, sets `DEMO_MODE` in `localStorage`, generates mock data, and forces a hard reload.
2.  **Shielding:** `data.js` detects `DEMO_MODE` on boot, deletes the `ROW_MAP`, preventing row-level sync to live tables, and prepends `demo_` to all blob keys (e.g. `demo_system_config`).
3.  **Destruction:** On logout or timeout, `sessionStorage` and `localStorage` are completely wiped. A 'Poison Pill' (`IS_SANDBOX_DB`) ensures orphaned data is destroyed on the next boot if the app was forced closed.

### A. The Boot Sequence (`main.js`)
1.  **Init:** Load `config.js` to set `supabaseClient`.
2.  **Runtime Gate:** `selectBootRole` / `getStartupBootRoleMode` determines whether login proceeds through Admin/Teamleader runtime or isolated Trainee runtime.
3.  **Migration Check:** Compare `last_connected_server` vs `active_server_target`. If different, trigger `saveToServer` (Push).
4.  **Load:** Call `loadFromServer()`.
    *   If successful: Render UI.
    *   If failed (Timeout/Error): Check `active_server_target`.
        *   If Local: Trigger **Auto-Recovery** (Switch to Cloud, set `recovery_mode` flag, reload).
5.  **Start Engine:** Call `startRealtimeSync()` to begin polling/heartbeat and **subscribe to Realtime channels**.

### B. Data Synchronization (`data.js`)
1.  **Pull (Load):**
    *   Fetch `app_documents` metadata. Download changed Blobs.
    *   Iterate `ROW_MAP`. Query tables for rows where `updated_at > last_sync`.
    *   Merge new rows into local arrays using `performSmartMerge`.
    *   **Pruning:** `monitor_history` and logs are pruned to 14/30 days locally to prevent storage quotas.
2.  **Push (Save):**
    *   Iterate keys. Calculate checksum of local data.
    *   Compare with `hash_map`.
    *   If changed:
        *   **Rows:** Upload changed items individually (`upsert`).
        *   **Blobs:** Upload full object.
        *   **Deletes:** Explicitly executes `DELETE` on Supabase for items removed locally to prevent "Ghost Data". Critical items use `force=true` (Authoritative) logic.
    *   **Protection:** `system_config` is only saved if user is Super Admin and save is explicit.

### B1. Violation Review Workflow
1. **Detection:** During working hours, `StudyMonitor.startActivityPoller()` classifies unapproved external windows as `Violation: <window title>`.
2. **Mandatory Capture:** The trainee cannot dismiss the prompt until they submit a reason, platform, and informed person. The informed-person dropdown is intentionally restricted to Darren, Netta, and Jaco.
3. **Sync:** Entries are saved into `violation_reports` as an `app_documents` blob so no SQL migration/table is required.
4. **Admin Review:** Activity Monitor shows pending counts in its toolbar, per-agent violation badges, a searchable review modal, and a notification-bell item for Admin/Teamleader/Super Admin users.
5. **Review State:** `markViolationReviewed(...)` marks entries reviewed with reviewer and timestamp metadata.

### C. Vetting Arena Security
1.  **Entry:** Trainee clicks "Enter Arena".
2.  **Lockdown:** `ipcRenderer` triggers Kiosk Mode (Fullscreen, No Exit) and Content Protection (No Screenshots).
3.  **Monitoring:**
    *   **Admin Runtime:** Vetting 2.0 webview uses realtime + fallback polling and merges `vetting_sessions_v2` + `vetting_sessions`.
    *   **Trainee Runtime:** Host bridge performs strict local security checks and 1-second fallback session polling.
    *   **Reliability:** Status patches are queued/retried and written to both vetting tables.
4.  **Violation:** If forbidden app found -> Alert -> Force Submit -> Kick.

### C1. Vetting Regression Memory (Do Not Reintroduce)
1.  **"Already Submitted" false lockouts:** Keep arena-mode submission archival + strict ID matching in `assessment_trainee.js`.
2.  **Session status overwrites/races:** Use per-trainee patching only (`patchSessionUser` / `patchTraineeStatus`), never blind whole-session overwrites from stale local snapshots.
3.  **Realtime tunnel stalls:** Preserve dual-table session merge + 1-second fallback pollers + retry queue flush loops.
4.  **Relaxed mode bypassing global strict policy:** Always treat `force_kiosk_global` as authoritative over per-user relaxed toggles.
5.  **Trainees escaping or not auto-routing:** Keep enforcer startup at login and stale-session-aware target detection.
6.  **UI wipe during active exam:** Do not rerender over `arenaTestContainer` while a test is in progress.

### D. Failover Protocol
1.  **Detection:** `startServerLookout` is designed to poll Cloud and Local URLs periodically (30s) and detect remote commands to switch targets. Note: in the current runtime this routine is intentionally disabled by default (early return) to avoid automatic server switching; re-enable with admin action if automatic failover is desired.
2.  **Command:** If `system_config.active` changes on the remote server:
    *   **Ping Check:** Verify new server is reachable.
    *   **Switch:** Update local config, reload app.
3.  **Migration:** On reboot, `main.js` detects the switch and pushes local data to the new server.

### E. Global Realtime Sync & UI Protection
1.  **The Global Net:** `data.js` -> `setupRealtimeListeners()` subscribes to the entire `public` database schema. Any change by any user triggers a push. **Includes a Dynamic Fallback Engine** that disables data polling while the realtime tunnel is healthy, falls back to the role-based sync cadence if the tunnel drops, and automatically attempts to rebuild dropped connections.
2.  **Queueing:** Incoming events are pushed into `INCOMING_DATA_QUEUE`.
3.  **Protection:** `processIncomingDataQueue()` checks `isUserTyping()`. If an Admin is actively typing in a field, the UI refresh is paused to prevent cursor stealing or text wiping, while the data is silently updated in the background cache.

### F. Presence Engine (Realtime-First with Resilient Backup)
Presence is handled by the Realtime presence channel rather than frequent DB writes:
1.  Users join the `online_users` Realtime presence channel and broadcast status via `PRESENCE_CHANNEL.track()` for zero-latency presence.
2.  The app also performs resilient backup writes to the `sessions` table (about every 15 seconds) to keep active-user monitoring + remote command delivery reliable during presence/realtime tunnel degradation.
3.  Admin UIs read from `window.ACTIVE_USERS_CACHE` for immediate presence information without frequent DB writes.

### G. Native OS Integrations
1.  **Disk Cache Recovery:** On every successful sync, `data.js` sends the entire database payload to `electron-main.js` via `save-disk-cache`. Native cache writes now use temp-file + atomic rename, and startup load validates JSON with `.bak` fallback recovery to prevent truncated-cache boot failures.
2.  **Intercepted Safe Quit:** When a user clicks "X" to close the app, `electron-main.js` blocks the close event, commands the frontend to `FLUSH` its data queue to the cloud, waits for the Mutex lock to complete the upload, and *then* cleanly shuts down the app.
3.  **Persistent Study Session:** The Electron `persist:study_session` partition is intentionally retained and flushed cleanly on quit so Microsoft/SharePoint training material has a better chance of preserving a stable sign-in session across app restarts.

---

## 5. Recent Architectural Notes

- **v2.6.79 (Progress Builder Test Engine Source, 2026-05-13):** Agent Progress Builder now presents Test Engine items as the visible progress checklist source instead of mixing `assessment-list`, `vetting-topics`, and `timeline` source buckets in the selector. Legacy assessment/vetting/timeline candidates are retained only as fallback/evidence matching so historical trainee submissions still satisfy the canonical Test Engine progress list.
- **v2.6.78 (Insight Session Cache, 2026-05-13):** Insight now uses a full host-provided session snapshot when the tab opens, skips the module's own cloud bootstrap in session-cache mode, and ignores background fresh-pull re-renders while active. Leaving the Insight tab clears the in-session cache and isolated module mirrors so the next visit rebuilds from current BuildZone data without the active-tab lag.
- **v2.6.77 (Insight Soft Refresh Performance, 2026-05-13):** Insight refreshes now use a debounced soft data sync instead of reloading the embedded webview during background pulls. After the first load, the host only pushes changed local-data keys into the isolated Insight partition before re-rendering, reducing UI stalls while keeping group filters, agent search, and stats current.
- **v2.6.76 (Insight Webview Data Hydration, 2026-05-13):** Insight's host loader now waits for the embedded webview `dom-ready` event before reloading and injects the host app's local trainee data snapshot into the isolated Insight partition. Insight also preserves local `users`, `records`, `submissions`, and `attendance_records` fallbacks when the cloud bootstrap returns empty arrays so group filters, agent search, and stats populate consistently across submenus.
- **v2.6.75 (Hidden First Line Troubleshooting Tool, 2026-05-13):** Added `modules/first_line_troubleshooting/` as an embedded copy of the First Line Troubleshooting Tool V3.4. The host app exposes it only through the hidden `first-line-troubleshooting` route, gated to Jaco's `super_admin` account by `js/first_line_troubleshooting_loader.js` and route/nav checks in `js/main.js`.
- **v2.6.74 (Insight Immediate Local Render, 2026-05-13):** Insight renders locally hydrated users, rosters, records, submissions, and attendance immediately across all Insight submenus before the background Supabase pull completes.
- **v2.6.73 (Insight Compare Hydration + Q&A Drafts, 2026-05-13):** Insight Compare Viewer now hydrates users, rosters, records, submissions, attendance, archives, and supporting config from localStorage before waiting for Supabase so group/person pickers populate even when the cloud pull is slow. Q&A Hub now defaults new FAQ entries to draft and exposes explicit Save Draft and Publish to Library actions.
- **v2.6.72 (Insight Canonical Progress + Archive Repair, 2026-05-13):** Insight Compare Viewer now uses Agent Progress Builder as the definitive scoring list for assessment/vetting/live/test performance. Missing configured scores are omitted from lines instead of dropping to `0%`, the graph uses compact per-person sequences with end labels and summary cards, and attendance scoring ignores `isIgnored` rows. Insight data loading now uses in-memory indexes and a smaller module cache to reduce startup freezes. Admin Tools gained an explicit Save Progress List action and a Repair Archive Snapshots action that backfills graduation/retrain archives with progress config snapshots and official progress when original row data still exists.
- **v2.6.70 (Live Booking Polish + Rules Config, 2026-05-11):** Live Assessment Booking received a cleaner schedule workspace and now reads Rules of Booking from the synced `live_booking_rules_config` document edited in Admin Tools > System Config. Live trainee stats now count completed live submissions/records as completion evidence even when a booking row is missing. Study Notes pop-out uses an opener-linked notes window so it reads/writes the same local notes store as the main app.
- **v2.6.69 (Compare Graph Full Selection, 2026-05-08):** Insight Compare Viewer breakdown graphs now render every selected trainee/group row instead of capping at 8, and line colors are generated from a larger hue sequence so larger selections are easier to distinguish.
- **v2.6.68 (Compare Attempt 1 vs Current Live, 2026-05-08):** Insight Compare Viewer now includes an `Attempt 1 vs Current Live` scope. In this mode, the picker selects trainees and the viewer plots two rows/lines per selected trainee: retrain archive Attempt 1 and the trainee's current live attempt.
- **v2.6.67 (Retrain Archive Integrity Review, 2026-05-08):** Test Engine Integrity Review now includes `retrain_archives` snapshots as reviewable/editable rows. Admins can filter to Retrain Archives, inspect archive contents (records/submissions/attendance), mark archives Valid/Review/Invalid, classify snapshots as A1/A2, clear archive decisions, or delete confirmed invalid archive snapshots.
- **v2.6.66 (Retrain Archive Clean Slate, 2026-05-07):** Moving a trainee to another group now archives the outgoing attempt into `retrain_archives`, stores a cleanup summary, and queues exact row-table hard deletes/tombstones for the archived records/submissions/attendance/supporting rows so Supabase cannot rehydrate old attempt clutter into the new live group. Agent Search labels retrain archives by stored attempt number/label and keeps Current Attempt separate.
- **v2.6.65 (Integrity Review Whole-Entry Overrides, 2026-05-07):** Test Engine Integrity Review now presents each assessment/live/vetting attempt as a whole entry. Admins can mark entries Valid, Review, or Invalid and classify them as Attempt 1 or Attempt 2; these manual decisions persist in the synced `test_integrity_overrides` app document and override the date-gap guess.
- **v2.6.64 (Test Engine Integrity Review, 2026-05-07):** Added Test Engine > Integrity Review for assessment, live assessment, and vetting entries. It evaluates submission answer coverage, missing test snapshots, manual-question grading completeness, invalid scores, linked record mismatches, suspicious completed 0% entries, and inferred repeat attempts by trainee/title/date gaps. The tool is review-first and deletes only after explicit admin confirmation.
- **v2.6.63 (Compare Viewer Attempt Scope, 2026-05-06):** Compare Viewer now replaces the Per Person button with an attempt selector for Current Live Attempt, Training Attempt 1 Archive, and Training Attempt 2 Archive. Insight hydrates `retrain_archives`, builds archived comparison rows from the snapshot's records/submissions/attendance/monitor history, and caps visible archive attempts to the first two safe retrain snapshots so broken retain-attempt counts above 2 do not skew release graphs.
- **v2.6.62 (Compare Viewer Live Data Integrity, 2026-05-06):** Compare Viewer now uses current live roster data only. It excludes blocked or ungrouped agents and filters assessment/submission graph inputs to rows for the agent's current roster group with valid score/date and non-archived/non-deleted/non-invalid status, preventing archived or previous-group records from skewing comparison graphs.
- **v2.6.61 (Compare Viewer Refinement, 2026-05-06):** Refined Insight Compare Viewer by removing the Metric Shape panel, keeping Ranked Overall, adding a selectable result set for one/multiple trainees or groups, showing selected group members directly when a specific group is chosen, thinning graph lines, replacing unreadable x-axis subject text with numbered labels plus an axis key, and separating performance, attendance, and focus into separate graphs.
- **v2.6.60 (Compare Viewer Breakdown Graph, 2026-05-06):** Updated Insight Compare Viewer so the graph is a true breakdown line comparison. Each agent or group average now gets one straight polyline across actual scored items (`Assessment: ...`, `Vetting: ...`, `Live: ...`, `Test: ...`) plus Attendance and Focus Level. Group mode averages member values per metric label.
- **v2.6.59 (Insight Compare Viewer, 2026-05-06):** Added an Insight sub-menu called Compare Viewer with per-person and per-group modes. It builds comparison rows from current Insight live data and graphs assessment, vetting, live assessment, test submission, attendance punctuality, focus, progress, violations, late-coming, and overall score metrics through KPI cards, ranked bars, an SVG metric radar, trend graph, and detailed matrix.
- **v2.6.58 (External Link Bridge Hotfix, 2026-05-06):** `window.electronAPI.shell.openExternal(...)` now delegates to a main-process `open-external-url` IPC handler instead of calling Electron `shell.openExternal` directly inside preload. This fixes packaged clients where sandboxed preload exposes the function but `shell` is unavailable, which caused cPanel/Webmail links to throw before the browser opened.
- **v2.6.57 (cPanel/Webmail Compatibility, 2026-05-06):** Study Browser now detects Herotel cPanel/Webmail targets (`cp1.herotel.com`, `cp2.herotel.com`, cPanel/Webmail paths, and standard cPanel ports) and opens them in the system browser instead of the embedded Electron webview because the embedded path can trigger a server-side `500 Internal Server Error` from `cpsrvd`. Activity Monitor also recognises cPanel/Webmail titles as permitted work activity while those program links run externally. Verification included focused `js/study_monitor.js` syntax check, full JavaScript syntax sweep, and Jest suite.
- **v2.6.56 (Training Rules + Release Readiness, 2026-05-05):** Finalized Training Rules as a configurable Admin Tools > System Config workflow with rich text, first-login display, optional every-login redisplay, and all/user/group targeting. Trainees can open rules from the isolated Trainee Portal and legacy dashboard fallback, and first-time setup now uses the admin-configured Office dropdown. Hardened delete-agent cleanup and attendance parsing against literal `"undefined"` localStorage values, kept partial cloud row-delete failures non-fatal, restored compatibility wrappers for legacy marking/review/live-date buttons, routed dashboard Insight actions to Insight Studio, and configured Windows packaging to use `ico.ico`. Release verification included JS syntax sweep, literal route scan, inline handler scan, Jest suite, and Electron Builder unpacked package check.
- **v2.6.55 (Agent Progress Catalog + Activity Grace Rules, 2026-05-05):** Agent Progress Builder now builds its add-list from active Test Engine definitions only and flags configured progress rows that are no longer present in the active test list. Added assessment rename propagation from Test Engine/History into linked submissions, records, Insight trigger presets, and Agent Progress mappings. Activity Monitor now treats MS Teams as permitted communication for the first 8 continuous minutes and only captures a violation after that grace window; OS idle also becomes a violation only after more than 8 minutes during monitored hours.
- **v2.6.54 (Arcade Logo Click + Main Dist Script Release Prep, 2026-05-05):** Hardened the hidden Arcade Vault logo trigger so `#arcade-logo-trigger` is explicitly outside the Electron draggable header region and stops click propagation before the window can maximize/restore. Kept the `dist` script as a main-channel alias for token-based publishing (`npm run dist` -> `npm run dist:main`) alongside explicit `dist:main` and `dist:beta` commands.
- **v2.6.53 (Arcade Vault Game Pack, 2026-05-04):** Expanded the hidden Arcade Vault with Pong, Memory Match, Simon Says, Typing Speed Challenge, and Tic-Tac-Toe while keeping the existing Tetris, Snake, Space Impact, and Hangman games under the same five-click logo unlock.
- **v2.6.52 (Arcade Logo Trigger Hotfix, 2026-05-04):** Restored the hidden Arcade Vault unlock by making the top-header logo click target explicit (`#arcade-logo-trigger`) and routing five rapid logo clicks through `handleEasterArcadeLogoClick(...)`. The arcade module still opens local-only games for any user once unlocked.
- **v2.6.51 (Insight Replacement + Realtime Fallback Controls, 2026-05-04):** Retired the old Training Insight Dashboard route and navigation entry so the new Insight workspace is the single admin insight surface. Added Super Admin Console controls for realtime-tunnel failure fallback polling by server target and role, replacing the previous hardcoded 1-second admin failover with configurable conservative defaults. Hardened Insight data matching across alternate field names (`trainee`, `user`, `username`, `agent`, `email`), included `violation_reports` in activity/violation totals, surfaced explicit `No data` states for missing activity metrics, and added a Knowledge Gaps sub-view that groups below-full-mark questions by assessment, individual, and all groups.
- **v2.6.50 (Configurable Report Checklist, 2026-05-04):** Extended Admin Tools > System Config > Agent Progress Builder Insight so each checklist item can be classified as Assessment, Vetting Test, or Test and can be ticked into specific Onboard Report sections (`Training Goal Feedback`, `Assessment Scores`, `Vetting Test Scores (Test 1)`, `Vetting Test Scores (Test 2 / Final)`). The Onboard Report now reads those checklist report-section flags first and falls back to the legacy static assessment/vetting lists only when no report mapping is configured. `insight_progress_config`, `insight_rule_config`, and `live_assessment_rules_config` are registered in `DB_SCHEMA` so they are pulled/saved as first-class app document configs, and progress-builder tick changes persist locally immediately before server sync.
- **v2.6.49 (Study Popout + Violation Review, 2026-05-04):** Added frameless Study Browser/Study Notes popout windows via the preload `studyBrowser.openPopout(...)` bridge, removed native app menus for those windows, and gave popouts custom app-style minimize/maximize/close/navigation controls. Replaced soft external-app warnings with mandatory violation explanation capture (`violation_reports`) including trigger, reason, platform, and restricted informed-person choices (`Darren`, `Netta`, `Jaco`). Added Activity Monitor violation review badges, searchable filters, notification-bell counts, and reviewed-state tracking. Simplified Admin Tools > Manage Users from role buckets into one unified searchable list while preserving filters, details, and actions.
- **v2.6.48 (Vetting Delivery + Schedule Modal Guardrail, 2026-04-30):** Hardened Vetting Arena 2.0 session launch so the isolated admin runtime loads row-synced `users`, resolves roster/email/contact aliases to canonical trainee usernames, seeds sessions with those usernames, and allows trainee clients to accept a session if their username appears in the session trainee map. Also made both legacy and isolated Schedule Studio edit modals scroll from the top with sticky Save/Cancel footers so schedule edits remain saveable on short screens.

- **v2.6.30 (Live Session Completion + Stale Recovery Rollout, 2026-04-24):** Hardened Live Assessment completion so `Confirm & Submit` now executes authoritative session close semantics (inactive marker + server row cleanup + local pointer cleanup), preventing completed sessions from resurfacing as active. Expanded Live Booking Integrity with stale-session detection and one-click recovery that archives stale session payloads (`liveSessionRecoveryArchive`), rebuilds missing submission/record artifacts for completed stale sessions, then safely closes stale active rows.

- **v2.6.29 (Global Cleanup + Release Scope Hygiene, 2026-04-24):** Removed cross-module helper collisions that could override shared global UI helpers (`getAvatarHTML`, `refreshApp`, `toggleTheme`), tightened refresh-button targeting for current runtime headers, and added ignore rules for local recovery/cache backup artifacts so release commits stay scoped to product code.

- **v2.6.28 (Trainee Runtime Isolation + Router Cleanup, 2026-04-23):** Finalized startup runtime selection flow so trainee sessions boot directly into the isolated Trainee Portal path, documented isolated Study Notes runtime contracts, removed duplicate loader polling intervals, and consolidated duplicated tab-render routing in `js/main.js` to a shared `renderViewById(...)` path to reduce drift and maintenance risk.

- **v2.6.22 (User Control Explorer + Study Browser Hit-Test Hardening, 2026-04-16):** Expanded Super Admin Data Studio User Control with a folder-style Agent Data Explorer and specific row-level moves both directions (live↔archive) across lifecycle buckets, backed by backup snapshots (`user_control_move_backups`) and rollback-aware move handling. Also hardened Study Browser overlay layering and hidden-tab hit-testing to reduce inconsistent unclickable hotspots in embedded apps (e.g., Q-Contact).
- **v2.6.21 (Content Creator Media + Engagement Expansion, 2026-04-16):** Extended Content Creator with optional per-subject media toggles, dual media source modes (`HTTP Link` or Supabase upload), dedicated Engagement submenu (admin-only per-user + per-subject analytics), and in-player timestamped note/question capture tied to each watcher.
- **v2.6.20 (Content Creator + User Control Release, 2026-04-15):** Finalized isolated `content-studio` runtime and reworked it into Content Creator (View + Builder + engagement telemetry), removed schedule timeline selector dependency, kept Header + Subject Builder flows with optional inputs, and aligned module theming with the main app while preserving Super Admin Data Studio `User Control` and sync hardening updates.
- **v2.6.19 (Retrain Attempt Unlock Hotfix, 2026-04-14):** Patched `js/assessment_trainee.js` to classify stale pre-move attempts as legacy by combining retrain archive move timestamps with linked `records.groupID` checks, then auto-ignore/archive those legacy attempts so trainees moved to a new group can start current scheduled assessments without false "already completed" lockouts.
- **v2.6.18 (Lifecycle + Grading Reliability Patch, 2026-04-14):** Hardened retrain/migration flow in `js/admin_users.js` with case-insensitive multi-group removal + dedupe to prevent trainees remaining in old groups after moves, and added completed-score self-healing in `js/admin_history.js` plus score fallback linking in `js/admin_grading.js` so finalized marks no longer display as `0%` after refresh/relogin when linked `records` rows are authoritative.
- **v2.6.24 (Content Creator Module Operations + Questionnaire Popup Flow, 2026-04-16):** Added trainee questionnaire popup launch path for linked content quizzes (complete/submit without hard navigation), and upgraded Content Creator Builder with a dedicated Module Manager (search/open/rename/duplicate/delete) where each module is managed as one package (header + all subjects + linked content).
- **v2.6.23 (Update Channel Split, 2026-04-16):** Added explicit Main (inline) vs Beta (pre-release) update channel handling in Electron updater flow, plus Admin Tools controls to trigger channel-specific checks without changing code.
- **Content Creator Module (Current Build, 2026-04-16):** Isolated `content-studio` tab now operates as Content Creator with a single default workspace (`content_creator_default`), no schedule timeline dropdown dependency, retained Header + Subject Builder authoring, optional media toggles with `HTTP Link`/upload source modes, app-aligned themed UI, admin-only Engagement breakdowns, and per-user telemetry + timestamped video notes/questions persisted in `content_studio_data`.
- **v2.6.17 (Targeted Submission Recovery Rollout, 2026-04-14):** Added a new `sessions.pending_action` command `recover_submission:<payload>` in `js/data.js` that targets the logged-in trainee, scans local `submissions` for matching criteria, auto-rebuilds missing linked `records` rows, and force-syncs `submissions` + `records` on next heartbeat/realtime command tick.
- **v2.6.16 (Release Rollout, 2026-04-13):** Version increment for production rollout delivery so clients already on `2.6.15` can receive the latest hardening package. Reinforces strict `submissionId` linking, vetted completion-gate semantics, and atomic disk-cache recovery as active release contracts.
- **v2.6.15 (Rollout Hardening Addendum, 2026-04-13):** Added strict `submissionId`-only digital script viewing in reporting/admin/search flows, removed trainee+assessment fallback linking in digital record upserts, added vetting completion gate (`submitting` -> `completed`) that verifies authoritative submission pipeline state (including retry continuity across restart), hardened native disk-cache persistence with atomic writes + backup recovery, and widened `performSmartMerge` scope to merge on the union of schema/server/local keys.
- **v2.6.14:** Hardened Vetting 2.0 false-submit prevention. Trainee runtime now avoids carrying local `completed` status across new session IDs, identity-collision matching now prefers non-completed status for alias usernames, and vetting session start/nudge paths seed canonical `waiting` trainee entries to reduce first-sync ambiguity.
- **v2.6.13:** Hardened recovery and shared-state persistence safety: explicit strict shared-key saves (users/tests/schedules/live state) now flush immediately to reduce debounce rollback windows, JSON import restore now uploads only imported keys instead of force-pushing full local state, and Vetting 2.0 trainee runtime identity resolution was tightened so admin relax/override flags apply reliably during active enforcement checks.
- **Vetting 2.0 Cutover (Current):** Admin/Super Admin/Special Viewer now run Vetting in the isolated `modules/vetting_rework` runtime while trainee secure exam flow runs through `js/vetting_runtime_v2.js`. Legacy `js/vetting_arena.js` has been retired. Reliability guardrails include dual-table sync (`vetting_sessions_v2` + `vetting_sessions`), per-user safe patching, retry queue flush loops, and hard 1-second fallback polling for continuity during realtime tunnel degradation.
- **v2.6.10:** Hotfixed Vetting 2.0 session visibility failures where admin session creation could target the wrong backend by always passing `CLOUD_CREDENTIALS` into the isolated runtime. `js/vetting_rework_loader.js` now resolves credentials from `active_server_target` (`cloud`, `local`, `staging`) so session writes align with trainee reads. Also hardened trainee arena button visibility in `js/auth.js` + `js/main.js` to consider active `adminVettingSessions` targeting logic, not only the cached `vettingSession` object.
- **v2.6.9:** Enforced strict server-authority guardrails for shared data (`users`, `rosters`, `tests`, `schedules`, `liveSchedules`, `liveBookings`, `liveSessions`) so background autosave cannot republish stale local state unless an explicit targeted/forced save is invoked. Added crash-recovery disk-cache protections in `js/main.js` to exclude risky sync/server-target keys and skip automatic migration push on recovery boots, and fixed `deleteGroup()` ordering in `js/admin_users.js` to persist local deletion before authoritative roster push (with rollback on failure).
- **v2.6.8:** Split retraining-transfer archives out of `graduated_agents` into dedicated `retrain_archives` to keep graduation reporting clean, added legacy auto-split handling for older `"Moved to ..."` entries, expanded archive lookups (Agent Search/Reports) to include retrain history without graduate badge pollution, and upgraded the header refresh action to flush queued writes/deletes + embedded vetting queues before forcing a full fresh Supabase pull.
- **v2.6.7:** Added a hard 1-second Live Arena targeted refresh loop in `js/live_execution.js` (using `forceRefreshLiveSessionById` from `js/data.js`) so question/diagnostic changes are polled by `sessionId` while Live Execution is open, even when realtime tunnel delivery is degraded.
- **v2.6.6:** Added a secondary Live Arena delivery path (`js/live_execution.js` + `js/data.js`) using `sessions.pending_action` `live_sync:*` commands to trigger targeted `live_sessions` refresh-by-id on trainee clients for question pushes and diagnostics when table realtime events are delayed.
- **v2.6.5:** Version increment for rollout alignment after the v2.6.4 boot parser hotfix; no new architectural changes introduced.
- **v2.6.4:** Hotfixed app boot reliability by correcting release-note HTML string formatting in `js/main.js` (removed unescaped inline backticks that broke parser execution and downstream UI boot flow like `showTab` initialization).
- **v2.6.3:** Hardened Live Arena realtime reliability (`js/live_execution.js` + `js/data.js`) by adding event-driven `liveSessions` cache listeners, monotonic live session revision/push timestamps, trainee session pinning, and automatic `live_sessions` row recovery when Supabase realtime emits partial payloads.
- **v2.6.2:** Shifted timeline template operations fully into isolated Schedule Studio (`modules/schedule_studio`) with admin-only editable templates, duration-based business-day auto-dates (skip weekends/holidays), restored explicit Delete Timeline controls in Studio, and improved Microsoft SafeLinks/SharePoint URL normalization in both Studio and Study Browser paths.
- **v2.6.1:** Preserved Microsoft/SharePoint links exactly as entered in schedule and study-browser URL handling, fixed trainee schedule/calendar scoping to only the assigned group, expanded trainee `Profile & Settings` personalization to include Experimental Theme/Custom Lab controls, and added a study-browser cache/session clear action for Microsoft sign-in recovery.
- **v2.6.0:** Hardened user lifecycle integrity (`js/admin_users.js` + `js/data.js`) so deleted users/profile edits survive sync/restart, added chunked realtime queue processing to reduce UI typing lockups under heavy payloads, introduced local cached-copy fallback in the Study Browser (`js/study_monitor.js`) for failed SharePoint/material loads, and extended Experimental Custom Lab to support wallpaper URL configuration (`index.html` + `js/main.js` + `style.css`).
- **v2.5.9:** Added a Live Booking Integrity Check + auto-repair flow in `js/schedule.js` to normalize duplicates/collisions and protect Live Arena and assessment breakdown consistency. Expanded Experimental Themes with app-wide motion styling and introduced a customizable `theme-custom-lab` profile with preview/save/reset controls.

## v2.6.79 - 2026-05-13

- Improvement: Agent Progress Builder now uses Test Engine items as the normal visible catalog for progress checklist selection.
- Improvement: Assessment-list, vetting-topic, and schedule/timeline items no longer appear as competing source labels in the normal Progress Builder selector.
- Fix: Legacy assessment/vetting/timeline names are still used as fallback/evidence matching so existing trainee submissions can complete the canonical progress list.

## v2.6.78 - 2026-05-13

- Performance: Insight now opens in session-cache mode using one full host data snapshot instead of repeatedly reacting to background fresh pulls.
- Performance: The Insight module skips its own cloud bootstrap while session-cache mode is active, avoiding duplicate data pulls and startup stalls.
- Fix: Leaving Insight clears the host/session/module cache so the next entry rebuilds against current BuildZone data.

## v2.6.77 - 2026-05-13

- Performance: Insight no longer reloads the full embedded webview during fresh sync pulls; refresh requests are debounced and handled as soft in-module data updates.
- Performance: The Insight host loader tracks local data signatures and only pushes changed keys after the initial hydration, reducing large repeated localStorage transfers.
- Fix: Soft refresh still re-renders Insight after changed data arrives, keeping group filters, agent search, and stats updated without the heavy reload freeze.

## v2.6.76 - 2026-05-13

- Fix: Insight Studio webview refreshes are now queued until Electron has attached the webview and emitted `dom-ready`, preventing the early reload exception that could freeze the Insight tab.
- Fix: The Insight host loader now mirrors the main app's local trainee, roster, records, submissions, attendance, archive, progress, and content snapshot into the isolated Insight module before rendering.
- Fix: Insight's initial cloud bootstrap now keeps local fallback data for core trainee tables when a remote row query returns empty, so group filters, agent search, and stats still populate from the source data already present in BuildZone.

## v2.6.75 - 2026-05-13

- Feature: Added the First Line Troubleshooting Tool V3.4 as an embedded hidden workspace available only to Jaco's Super Admin account.
- Safety: The original Downloads project was not modified; BuildZone uses a copied module under `modules/first_line_troubleshooting/`.
- Verification: Syntax checks and full Jest suite passed.

## v2.6.74 - 2026-05-13

- Fix: Insight now renders the locally hydrated trainee data immediately across Agent Triggers, Agent Progress, Department Overview, Knowledge Gaps, and Compare Viewer before the slower cloud pull finishes.
- Verification: Focused syntax checks and full Jest suite passed.

## v2.6.73 - 2026-05-13

- Fix: Insight Compare Viewer now hydrates users, rosters, records, submissions, attendance, retrain archives, and support config from localStorage before waiting for Supabase, so the group/person picker can populate immediately after opening Insight.
- Feature: Q&A Hub now defaults new FAQ entries to draft and has separate Save Draft and Publish to Library actions.
- Verification: Focused syntax checks and Insight compare/progress Jest tests passed.

## v2.6.72 - 2026-05-13

- Improvement: Insight startup now builds reusable in-memory indexes and avoids caching large analytics payloads in the module cache, reducing the freeze before content appears.
- Improvement: Compare Viewer assessment/test lines use Progress Builder official score items as the scoring source of truth, omit missing scores instead of plotting them as zero, and render clearer compact trend lines with end labels and summary stats.
- Fix: Attendance comparison graphs now exclude `isIgnored` attendance rows from both totals and day grids.
- Feature: Agent Progress Builder has an explicit Save Progress List button, and archive repair can backfill existing graduation/retrain snapshots with progress configuration snapshots plus official progress when source rows still exist.
- Verification: Jest suite passed before main push.

## v2.6.70 - 2026-05-11

- Improvement: Live Assessment Booking now has a cleaner schedule workspace with more professional slot cards, admin controls, and rule display.
- Feature: Rules of Booking are editable from Admin Tools > System Config and sync through `live_booking_rules_config`.
- Fix: Live trainee stats count completed live submissions and permanent records even if the completed booking row is missing.
- Fix: Study Notes pop-out opens with the trainee's existing local notes instead of an empty isolated store.
- Verification: Syntax checks and Jest suite passed.

## v2.6.69 - 2026-05-08

- Fix: Insight Compare Viewer breakdown graphs now render every selected trainee/group instead of only the first 8.
- Improvement: Compare graph line colors now use a generated hue sequence for more distinct colors on larger selections.
- Verification: Focused syntax checks, Jest suite, and Electron Builder unpacked package check passed.

## v2.6.68 - 2026-05-08

- Feature: Insight Compare Viewer now includes an `Attempt 1 vs Current Live` scope that plots selected trainees' retrain Attempt 1 archive against their current live attempt.
- Verification: Focused syntax checks, Jest suite, and Electron Builder unpacked package check passed.

## v2.6.67 - 2026-05-08

- Feature: Test Engine Integrity Review now includes retrain archive snapshots, with flags for repeated snapshots, mixed-trainee data, empty archives, and excess archive attempts.
- Improvement: Admins can filter to Retrain Archives, inspect archive contents, mark archive snapshots Valid/Review/Invalid, classify them as A1/A2, clear decisions, or delete confirmed invalid archive snapshots.
- Verification: Focused syntax checks, Jest suite, and Electron Builder unpacked package check passed.

## v2.6.66 - 2026-05-07

- Fix: Retrain migration now archives the outgoing attempt before cleanup and queues exact hard deletes/tombstones for the archived Supabase row-table entries.
- Improvement: Agent Search now labels retrain archive tabs using the stored attempt label/number and keeps the current live attempt separate from archive history.
- Verification: Focused syntax checks, Jest suite, and Electron Builder unpacked package check passed.

## v2.6.65 - 2026-05-07

- Improvement: Test Engine Integrity Review now treats each assessment/live/vetting attempt as one whole entry, with question-level answers and marking used only as supporting evidence.
- Feature: Admins can manually override an integrity entry as Valid, Review, or Invalid and classify it as Attempt 1 or Attempt 2. Overrides persist in `test_integrity_overrides`.
- Verification: Focused syntax checks, full JavaScript syntax sweep, Jest suite, and Electron Builder unpacked package check passed.

## v2.6.64 - 2026-05-07

- Feature: Test Engine now includes an Integrity Review view for assessment, live assessment, and vetting entries. It flags missing test snapshots, low answer coverage, missing manual grading, invalid scores, submission/record mismatches, suspicious zero-score attempts, and inferred repeat attempts by date gaps.
- Safety: Integrity Review is review-first. It does not auto-remove entries; admins must explicitly confirm a flagged submission/record deletion.
- Verification: Focused syntax checks, full JavaScript syntax sweep, Jest suite, and Electron Builder unpacked package check passed.

## v2.6.63 - 2026-05-06

- Improvement: Insight Compare Viewer now replaces the Per Person button with an attempt selector for Current Live Attempt, Training Attempt 1 Archive, and Training Attempt 2 Archive.
- Fix: Insight now hydrates `retrain_archives` for Compare Viewer and only exposes safe archive attempts 1/2, preventing bogus higher retain-attempt counts from appearing in release graphs.
- Verification: Focused Insight syntax checks, full JavaScript syntax sweep, Jest suite, and Electron Builder unpacked package check passed.

## v2.6.62 - 2026-05-06

- Fix: Insight Compare Viewer now uses current live roster data only and excludes archived, invalid, blocked, ungrouped, and previous-group rows from comparison graphs.
- Verification: Focused Insight syntax checks passed.

## v2.6.61 - 2026-05-06

- Improvement: Insight Compare Viewer now removes Metric Shape, adds selectable comparison filters, shows group members for selected groups, and separates assessment/test, attendance, and focus graphs with clearer axis labels.
- Verification: Focused Insight syntax check passed.

## v2.6.60 - 2026-05-06

- Improvement: Insight Compare Viewer graph now plots straight per-agent/per-group lines across actual breakdown items: assessments, vetting, live assessments, test submissions, attendance, and focus level.
- Verification: Focused Insight syntax check passed.

## v2.6.59 - 2026-05-06

- Feature: Insight now includes Compare Viewer for per-person and per-group graph comparison across assessment, vetting, live assessment, test, attendance, focus, progress, and activity risk metrics.
- Verification: Focused Insight syntax checks and Jest suite passed.

## v2.6.58 - 2026-05-06

- Fix: External program links now open through a main-process IPC bridge so cPanel/Webmail links do not crash when packaged preload cannot access Electron `shell` directly.
- Verification: Focused syntax checks passed for `preload.js`, `electron-main.js`, `js/main.js`, and `js/study_monitor.js`.

## v2.6.57 - 2026-05-06

- Fix: Herotel cPanel/Webmail links now open in the system browser instead of the embedded Electron webview to avoid the `cpsrvd` 500 error seen on `cp1.herotel.com`.
- Fix: External cPanel/Webmail windows are recognised as permitted work activity by Activity Monitor.
- Verification: Focused `js/study_monitor.js` syntax check, full JavaScript syntax sweep, and Jest suite passed.

## v2.6.56 - 2026-05-05

- Feature: Training Rules are release-ready with admin rich-text editing, first-login/every-login display controls, all/user/group targeting, trainee portal quick access, and legacy dashboard fallback access.
- Feature: First-time trainee setup includes the Office dropdown sourced from Admin Tools > System Config.
- Fix: Delete-agent and attendance flows now tolerate malformed local JSON values such as literal `"undefined"`, and cloud row-delete cleanup failures no longer abort the entire delete action.
- Fix: Legacy admin modal buttons for marking, Insight review decisions, and Live Booking date updates route to current workflows.
- Release: Windows packaging now applies `ico.ico`; release checks passed for JS syntax, route targets, inline handlers, Jest, and Electron Builder unpacked packaging.

## v2.6.33 - 2026-04-28

- Improvement: Network Diagnostics main-channel rollout now includes the second-screen overlay, latency history, scheduled group online counts, admin console-error visibility, and simplified agent status reporting.
- Bug Fix: Live Assessment and realtime stability hardening reduce reconnect churn and release trainees when sessions end.
- Improvement: Study Notes are local-only for trainees, Activity Monitor summaries expose trainee violation drilldowns, and Problem Reports now show submitted reports with Super Admin bell notifications.
- Release: Version bump to `2.6.33` for stable main channel rollout.

## v2.6.34 - 2026-04-29

- Bug Fix: Live Assessment finalization now creates separate submission-linked permanent records per booking/session instead of matching by trainee and assessment title.
- Bug Fix: Live stale-session recovery and admin marking now preserve record identity and use saved assessment snapshots for score totals.
- Bug Fix: Test Engine history/delete safeguards now preserve separate live attempts and avoid deleting unrelated same-title records.
- Improvement: Assessment Records score edits now force-sync permanent records and linked submissions together where applicable.
- Improvement: Live Booking Integrity now includes Repair Live Records to rebuild missing live records from completed live submissions and relink completed bookings.
- Release: Version bump to `2.6.34` for stable main channel rollout.

## v2.6.35 - 2026-04-29

- Stability: Critical explicit saves for records, submissions, live bookings, live sessions, users, tests, schedules, live schedules, rosters, and assessments now return a visible failure and remain queued when Supabase rejects the write instead of logging a partial per-key warning while the overall save reports success.
- Verification: Completed broad release stability pass across sync, realtime routing, live assessment save identity, completed-history editing, Assessment Records score editing, Network Diagnostics error capture, and active-view rerender behavior.
- Release: Version bump to `2.6.35` for stable main channel rollout.

## v2.6.36 - 2026-04-29

- Stability: Orphan cleanup now checks only local row IDs against Supabase using targeted ID lookups instead of scanning every server ID from high-volume tables like `error_reports`, preventing statement timeouts during background diagnostics/sync checks.
- Clarification: Duplicate row collapse warnings during records upload are expected protective sync cleanup messages after duplicate local IDs are deduped before upsert; they do not indicate score overwrite behavior.
- Release: Version bump to `2.6.36` for stable main channel rollout.

## v2.6.37 - 2026-04-29

- Bug Fix: Live Assessment final summary/save paths now guard missing or delayed test definitions instead of throwing `Cannot read properties of undefined (reading 'questions')`, and live score/comment saves initialize missing `scores`/`comments` containers.
- Improvement: Problem Reports and System Error Reports now classify and hide resolved/noisy historical reports by default, including old live-exit reports, old Study Notes refresh reports, fixed live-summary crashes, records duplicate-upload 500s, transient server outages, and external SharePoint/Genially load failures. A toggle keeps the hidden reports reviewable.
- Release: Version bump to `2.6.37` for stable main channel rollout.

## v2.6.38 - 2026-04-29

- Improvement: Today's Tasks dashboard widget now groups admin day work into schedule, live bookings, admin actions, and booking review items, with clearer booking metadata and invalid-booking warnings.
- Stability: Attendance records are normalized by trainee/date to reduce duplicate clock-ins and recurring late approvals, attendance modal refreshes avoid interrupting active edits, and the trainee portal shows Clock Out when a trainee is clocked in.
- Feature Added: Live Assessment pre-question rules are now editable under Admin Tools > System Config and used by the trainee Live Assessment Arena before the first pushed question.
- Improvement: User theme variables now sync into same-origin embedded iframes, isolated webviews, and Network Diagnostics popouts more consistently.
- Release: Version bump to `2.6.38` for stable main channel rollout.

## v2.6.39 - 2026-04-29

- Improvement: Attendance Register & Review now opens as a larger admin workspace with summary cards, clearer agent/day status rows, and manual refresh while the modal is open so realtime updates do not repaint the view during review.
- Feature Added: Live Assessment rules now support sanitized rich formatting (`rulesHtml`) for bullets, bold, italic, and text sizing while retaining plain-text `rules` for compatibility.
- Release: Version bump to `2.6.39` for stable main channel rollout.

## v2.6.40 - 2026-04-29

- Improvement: Admin dashboards now include a Command Center strip that summarizes pending marking, Insight actions, live bookings, booking issues, attendance review, and open clock-outs.
- Polish: Dashboard title bars, cards, modal shells, and shared panel surfaces now use a cleaner 8px-radius visual system with less movement-heavy hover behavior and better scan density.
- Stability: Daily dashboard and calendar counts use the local date helper for consistency with attendance and South African working-day usage.
- Release: Version bump to `2.6.40` for stable main channel rollout.

## v2.6.41 - 2026-04-29

- Improvement: Admin Tools now uses a left-side settings workspace rail, preserving existing admin subview logic while making configuration sections easier to scan.
- Improvement: Assessment Records now has pinned filters on the left and a dedicated results panel on the right.
- Polish: Added shared table state components for empty/loading/error states and applied them to Assessment Records and Vetting Test Submissions.
- Release: Version bump to `2.6.41` for stable main channel rollout.

## v2.6.42 - 2026-04-29

- Improvement: Attendance Register & Review now uses near-fullscreen coverage so admins can review more rows without feeling boxed into a small popup.
- Polish: Network Diagnostics and Agent Activity Monitor now use larger, cleaner modal shells with modern cards, consistent spacing, and improved popout styling.
- Feature Added: Added global UI density preferences (`Compact`, `Comfortable`, `Spacious`), shared status chip styling, admin sync indicators, reduced-motion route transitions, and responsive row-card tables on smaller screens.
- Release: Version bump to `2.6.42` for stable main channel rollout.

## v2.6.44 - 2026-04-29
- Improvement: Onboard Summary Report now keeps the A4 document surface while moving generation controls into a cleaner report workspace.
- Improvement: Editable report fields auto-expand, wrap long text/links safely, and are normalized before save/print.
- Fix: Saved report preview printing now uses a dedicated saved-report print mode so the opened report is the print target.
- Release: Version bump to `2.6.44` for stable main channel rollout.

## v2.6.45 - 2026-04-29
- Fix: Onboard Summary Report print styling is now scoped to report printing so the report no longer appears when printing other app pages.
- Release: Version bump to `2.6.45` for stable main channel rollout.

## v2.6.46 - 2026-04-29
- Fix: Onboard Summary Report workspace styling no longer overrides route visibility, preventing the report page from appearing on every screen for admins, trainees, and other roles.
- Release: Version bump to `2.6.46` for stable main channel rollout.

## v2.6.47 - 2026-04-29
- Fix: Super Admin minimum-version enforcement now verifies the real desktop app version before login, blocks unverifiable clients when a minimum is configured, and applies the same gate to saves.
- Hardening: Access Control is pulled during auth refresh and fails closed when IP verification is unavailable while restrictions are enabled.
- Release: Version bump to `2.6.47` for stable main channel rollout.

## v2.6.43 - 2026-04-29

- Improvement: Live Assessment Booking now uses the shared admin workspace layout with pinned booking controls, live booking stats, booking rules, and a dedicated schedule grid.
- Improvement: Attendance Register & Review now keeps review filters and attendance stats pinned on the left while agent rows stay in the main review area.
- Polish: Problem Reports and System Error Reports now use the same workspace modal pattern with triage stats and review guidance.
- Release: Version bump to `2.6.43` for stable main channel rollout.

## v2.6.24 - 2026-04-16

- Feature Added: Linked content questionnaires now support trainee popup launch for complete-and-submit flow.
- Improvement: Content Creator Builder now has stronger module management (search/open/rename/duplicate/delete) with clear package-level navigation.
- Bug Fix: New/duplicate module actions were hardened so button actions always execute with visible feedback.
- Release: Version bumped to `2.6.24`.

## v2.6.26 - 2026-04-21

- Improvement: Schedule Studio now resolves linked Content Creator modules from both `content_studio_data` and `content_studio_data_local` cache paths for consistent module visibility.
- Improvement: Linked timeline content video/document launch now resolves signed storage URLs before opening to reduce asset open failures.
- Fix: Content Creator quiz launch bridge now includes fallback host messaging paths for runtime contexts where direct `sendToHost` is unavailable.
- Release: Version bump to `2.6.26` for linked content runtime reliability rollout.

## v2.6.27 - 2026-04-22

- Feature Added: New Insight workspace rollout (Agent Triggers + Agent Progress) for admin/super-admin review workflows.
- Improvement: Linked content launch paths in Schedule/Content Creator are more reliable for module discovery and media/quiz opens.
- Bug Fix: Realtime fallback handling and diagnostics UI guards were hardened to reduce timeout reconnect storms and null-element runtime crashes.
- Release: Version bump to `2.6.27` for stable main channel rollout.

## v2.6.28 - 2026-04-23

- Feature Added: Startup runtime selection now routes trainee sessions directly into the isolated Trainee Portal runtime path.
- Improvement: Trainee Portal and Study Notes loaders now use leaner event/bridge refresh behavior to reduce duplicate background polling.
- Bug Fix: Shared tab rendering logic was consolidated to reduce duplicate router branches and prevent view-refresh drift across navigation paths.
- Release: Version bump to `2.6.28` for beta rollout.

## v2.6.29 - 2026-04-24

- Improvement: Global helper collisions were removed so shared UI helpers remain consistent across modules and tabs.
- Bug Fix: Refresh icon detection now matches current runtime header patterns more safely.
- Improvement: Local recovery/cache backup artifacts are now ignored from source control for cleaner release scope.
- Release: Version bump to `2.6.29` for beta rollout.

## v2.6.30 - 2026-04-24

- Bug Fix: Live Assessment Confirm & Submit now closes sessions authoritatively so completed sessions no longer re-open as active.
- Feature Added: Live Booking Integrity now includes Recover Stale Sessions, which archives stale session payloads and rebuilds missing submission/record artifacts where recoverable.
- Improvement: Stale live-session filtering now blocks stale rejoin paths tied to completed/cancelled booking states.
- Release: Version bump to `2.6.30` for stable main channel rollout.

## v2.6.25 - 2026-04-20

- Improvement: Beta updater rollout is now strict opt-in, with optional install prompts only for beta payloads.
- Fix: Forced update and min-version update checks now explicitly target the `main` channel to prevent beta enforcement.
- Fix: Problem Report workflow is now local-first resilient (captures/saves reports even when sync is temporarily unavailable) and Problem Reports admin views now safely parse malformed local payloads.
- Fix: Schedule Studio content linking now resolves Content Creator modules from both canonical and local cache keys so newly created modules appear reliably in timeline link selectors.
- Improvement: Linked content document/video launchers in Schedule Studio now resolve signed storage URLs using bucket/path metadata (same reliability model as Content Creator view).
- Fix: Content Creator questionnaire launch now includes fallback host bridges when `sendToHost` is unavailable in non-standard runtime embeddings.
- Release: Version bump to `2.6.25` for beta rollout safety controls.

## v2.6.23 - 2026-04-16

- Feature Added: Split updater checks into Main (inline) and Beta (pre-release) channels.
- Improvement: Admin Tools > System Updates now exposes separate Main/Beta check actions with active channel status.
- Bug Fix: Updater channel routing now accepts `main`/`beta` naming directly and keeps messaging channel-aware.
- Release: Version bumped to `2.6.23`.

## v2.6.22 - 2026-04-16

- Feature: Added folder-style Agent Data Explorer inside Super Admin Data Studio User Control with explicit live/archived bucket drilldowns and row-level visibility for archived attempt payloads.
- Feature: Added bi-directional row moves in User Control (live→archive and archive→live) for records/submissions/live bookings/attendance/saved reports/insight reviews.
- Hardening: Added move safety backup snapshots in `app_documents` (`user_control_move_backups`) and rollback-aware handling when archive writes/live deletes fail.
- Fix: Hardened Study Browser layering + hidden-webview hit-testing so embedded programs (for example Q-Contact) are less likely to expose intermittent unclickable regions.
- Release: Version bump to `2.6.22` for Data Studio explorer and study-browser reliability rollout.

## v2.6.21 - 2026-04-16

- Feature: Added optional subject-level media flags and source selectors in Content Creator (`hasVideo`/`hasDocument`, `url`/`upload`) with direct Supabase storage upload support for video and PDF assets.
- Feature: Added dedicated admin-only Engagement submenu (`modules/content_studio/js/ui_engagement.js`) with per-user watcher analytics and per-subject drilldown, including notes/question totals.
- Feature: Added in-player `Add Note / Question` flow in `modules/content_studio/js/ui_view.js` to pause video, capture note/question at current timestamp, and jump playback to saved markers.
- Release: Version bump to `2.6.21` for media + engagement rollout.

## v2.6.20 - 2026-04-15

- Feature: Released isolated Content Creator (`js/content_studio_loader.js` + `modules/content_studio/`) with header/subject authoring, optional builder inputs, single-workspace data model, and per-user video engagement telemetry (`plays`, `watchSeconds`, `skips`).
- Feature: Expanded Super Admin Data Studio (`modules/superadmin_data_studio`) with a dedicated `User Control` workspace for identity-safe profile edits, revoked/bound-client operations, archive payload editing, and one-click archive/reset lifecycle cleanup across live rows.
- Hardening: Added auth-critical pre-login refresh (`users`, `revokedUsers`, `system_config`, `rosters`), identity-safe user/roster dedupe paths, and reinforced realtime/view sync observability with high-priority fresh-pull behavior + sync diagnostics.
- Release: Version bump to `2.6.20` for fleet rollout.

## v2.6.17 - 2026-04-14

- Feature: Added `recover_submission:<payload>` command handling in `js/data.js` so admins can trigger trainee-specific local submission recovery on next heartbeat/realtime command cycle.
- Feature: Recovery flow now rebuilds missing `record_<submissionId>` entries from local `submissions` before syncing.
- Release: Version bump to `2.6.17` to push recovery tooling to client fleets.

## v2.6.18 - 2026-04-14

- Fix: Hardened retrain/migration cleanup in `js/admin_users.js` to remove trainees from prior groups case-insensitively, dedupe roster membership, and apply case-insensitive linked-data reset so stale first-attempt data does not leak into new group attempts.
- Fix: Added score drift self-healing in `js/admin_history.js` and fallback score linking in `js/admin_grading.js` so completed marks remain accurate after refresh/relogin when linked `records` rows are authoritative.
- Release: Version bump to `2.6.18` for lifecycle + grading reliability rollout.

## v2.6.19 - 2026-04-14

- Fix: Patched `js/assessment_trainee.js` submission lock logic to detect legacy pre-move attempts using retrain archive move date and linked `records.groupID`, preventing migrated trainees from being blocked by old resurfaced attempts.
- Fix: Legacy attempts detected at test start are now auto-archived (retake-safe) so current scheduled attempts in the new group can launch immediately.
- Release: Version bump to `2.6.19` for immediate hotfix rollout.

## v2.6.16 - 2026-04-13

- Release: Version bump to `2.6.16` to enable updater rollout for fleets already on `2.6.15`.
- Stability Contract: Maintain strict digital script linking by `submissionId`, vetting completion verification gate, and atomic native cache persistence/recovery.

## v2.6.15 - 2026-04-13

- Fix: Vetting Arena trainee overlay blocking Enter/Start — trainee-side overlay logic in `js/vetting_runtime_v2.js` was corrected so compliance scanning no longer prevents the Enter/Start action.
- Fix: Prevented JSON.parse crashes caused by literal "undefined" in localStorage by adding `safeLocalParse` and `safeParse` helpers used across `js/data.js` and other modules.
- Fix: Hardened hard-delete/tombstone flow to stop "ghost data" reappearing — added `system_tombstones`, `system_pending_deletes`, and `processPendingDeletes()` to ensure deletes are backed up, queued, and reconciled reliably.
- Change: Improved authoritative blob/row sync behavior and strict-server key handling to avoid accidental background pushes for shared state (users/tests/schedules).
- Ops: Added `ops/unbind_tshepo.sql` and `ops/unbind_tshepo.sh` to safely backup and remove `boundClientId` from the user row for targeted recovery (see `ops/README.md`).
- Release: Branch `release/v2.6.15` and tag `v2.6.15` were created for this fixpack; client-side hardening is included in this release.

If you want me to run the prepared `ops/unbind_tshepo.sql` against your DB, provide the admin Postgres URI and explicit authorization and I will perform a single-row backup and unbind, then report results.

- **v2.5.8:** Fixed critical `before-quit` infinite loop in `electron-main.js` that caused zombie processes and blocked auto-updates.
- **v2.5.7:** Version bump and minor maintenance.
- **v2.5.6:** Added a completely isolated Super Admin Data Studio module (`modules/live_data_manager` or `superadmin_data_studio`) leveraging a Webview bridge for real-time visual database editing.
- **v2.5.5:** Added persistent desktop session restore until explicit logout, hardened the Electron study-session handling for Microsoft/SharePoint material, and rebuilt the Team Leader Hub Agent Production Feedback flow around a new guided wizard plus linked ticket-path question creator.

---

## 6. IPC Channels (Electron Main)
- `start-activity-monitor` / `stop-activity-monitor`: Controls background OS polling.
- `activity-update`: Event pushed to UI containing OS-level idle time and active external window.
- `show-notification`: Triggers Native Windows OS Toast Notifications.
- `save-disk-cache` / `load-disk-cache`: Bypasses browser limits for infinite hard-drive storage.
- `force-final-sync` / `final-sync-complete`: Handshake for the Intercepted Safe Quit flow.
- `os-resume`: Triggers instant WebSocket reconnection when PC wakes from sleep.
- `get-app-version`: Returns `package.json` version.
- `get-update-status`: Returns updater readiness object `{ ready: boolean, channel: 'main' | 'beta' }`.
- `manual-update-check`: Triggers auto-updater (supports channel-aware checks via `main`/`beta` payload).
- `get-update-channel`: Returns the currently active updater channel (`main` or `beta`).
- `set-kiosk-mode`: Toggles Kiosk mode.
- `get-process-list`: Returns running processes (for Vetting).
- `get-screen-count`: Returns the number of connected displays.
- `get-active-window`: Returns title of foreground window (for Study Monitor).
- `set-update-channel`: Switches update checks between `main` (inline release) and `beta` (pre-release).
- `perform-network-test`: Pings a target IP/Host and returns latency in ms.
- `get-system-stats`: Returns CPU load, RAM usage, Disk usage (C:), and Connection Type (Ethernet/Wireless).
- `open-devtools`: Opens the Chromium Developer Tools.
- `invoke-gemini-api`: Proxies a fetch request to the Gemini API from the main process to bypass CORS.

---


## 7. Release & Update Protocol (AI Instructions)

> **AI INSTRUCTION:** When the user asks to push an update, first confirm release type intent as either `main` (inline) or `beta` (pre-release), then follow this protocol.

1.  **Release Type Rules:**
    *   `main` update: publish with stable release channel.
    *   `beta` update: publish as pre-release channel (strict opt-in adoption flow only).
    *   Admin/Super Admin can manually check both channels from **Admin Tools > System Updates**.
    *   Trainee/Team Leader continue receiving normal app update prompts from the standard in-app updater flow.
    *   Beta must never become mandatory for general users: no forced restart/login block and no global forced commands tied to beta payloads.
    *   Remote/mandatory update nudges (`force_update`, min-version enforcement) must always target `main` channel checks only.

2.  **Version + Changelog Rules:**
    *   Increment `version` in `package.json`.
    *   Add one short changelog entry in `js/main.js` `getChangelog()` only.
    *   Keep changelog wording concise: use only high-level labels such as `Bug Fix`, `Improvement`, `Feature Added` (no deep technical breakdown).

3.  **Build Command Rules (Token-Based):**
    *   Ensure scripts are ready so user only needs to provide token. `npm run dist` must remain a main-channel alias for `npm run dist:main`:
        ```bash
        $env:GH_TOKEN="<token>"
        npm run dist
        ```
        or explicitly:
        ```bash
        $env:GH_TOKEN="<token>"
        npm run dist:main
        ```
        or
        ```bash
        $env:GH_TOKEN="<token>"
        npm run dist:beta
        ```

4.  **Documentation Rules:**
    *   Update `AI_CONTEXT.md` whenever release workflow behavior changes.
    *   Add a short release note block for the new version.

5.  **Scoped Git Commands:**
    *   Prefer scoped commits:
        ```bash
        git add <only-relevant-files>
        git commit -m "chore: vX.X.X release prep"
        git push origin main
        ```

## 8. Anti-Regression Rules (CRITICAL FOR AI)
> **AI INSTRUCTION:** You MUST abide by these rules to prevent breaking the application's performance architecture.
1. **Context Isolation**: Main window runs with `nodeIntegration: false` and `contextIsolation: true`. Frontend OS calls must route through the secure bridge (`window.electronAPI`). Legacy `require('electron')` calls are only valid via the controlled shim in `js/main.js`, which maps to the same bridge.
2. **No Broad Database Polling**: Do not add generic schema polling loops. Prefer realtime cache (`localStorage`) and websocket push from `data.js`.  
   **Exception:** Approved targeted reliability pollers exist for exam-critical runtimes (Live Execution and Vetting 2.0) and must remain session-scoped and lightweight.
3. **Presence-First Session Writes**: Presence must remain primary via `window.PRESENCE_CHANNEL.track()`. The `sessions` table backup heartbeat (currently ~15s) is allowed only for resilient monitoring/remote commands and must not be made more aggressive or expanded into broad polling writes.
4. **Protect the UI**: When rendering data from WebSockets, always check `isUserTyping()` or specific input focus states to ensure you do not wipe out a user's active text field.
5. **Mutex Saves**: If modifying `saveToServer` or `_processSaveQueue`, you must respect the `_IS_PROCESSING_SAVE` mutex to prevent concurrent database upsert corruption.
6. **Digital Script Linking**: Do not reintroduce trainee+assessment fallback openers for digital marked scripts. Viewer routing must remain strict on `submissionId`.

## 9. Cross-Module Contracts (Change Safety)
> **AI INSTRUCTION:** Treat these as behavioral contracts. Changes touching any one module must preserve the full contract chain.

### A. Digital Submission Contract
1. `assessment_trainee.js` creates authoritative submission attempts (`submissions.id`).
2. `assessment_admin.js` and report/search/admin views must resolve digital scripts by `submissionId` only.
3. `records` linkage for digital scripts must preserve `record.submissionId`.
4. Any UI fallback by trainee+assessment is considered unsafe and can bind the wrong attempt.

### B. Vetting Completion Contract
1. Trainee status can move to `submitting` before `completed`.
2. Final `completed` requires authoritative server verification of the linked submission pipeline.
3. Restart continuity must be preserved (a user in `submitting` should retry verification automatically).
4. Admin/runtime displays must tolerate `submitting` as an intermediate status.

### C. Identity & Merge Contract
1. Identity comparisons must remain normalized/case-insensitive where roster/user matching is involved.
2. `performSmartMerge()` must merge across union of schema/server/local keys, not schema-only assumptions.
3. `revokedUsers`/tombstone semantics must remain preserved through merge and sync.

### D. Native Cache Durability Contract
1. Disk-cache writes must remain atomic (temp write + rename).
2. Boot recovery must validate JSON before trusting cached payloads.
3. Backup fallback (`.bak`) should be retained for recovery from partial/truncated writes.

### E. Rollout Preflight (Required Before Push)
1. Run targeted security/flow tests for changed subsystems.
2. Run full test suite at least once for release candidates.
3. Confirm commit scope excludes backup artifacts, local recovery dumps, and unrelated deletions.
4. Update `AI_CONTEXT.md` release notes when contracts or architecture change.
