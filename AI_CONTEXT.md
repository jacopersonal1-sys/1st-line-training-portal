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
| `users` | Array | Blob | User credentials, roles, and themes. |
| `rosters` | Object | Blob | Group definitions `{ "GroupA": ["User1", "User2"] }`. |
| `system_config` | Object | Blob | Global settings (Sync rates, Security, Failover). **Protected**. |
| `system_tombstones` | Array | Blob | Persistent blacklist of deleted item IDs used to prevent deleted items from being resurrected during sync. |
| `records` | Array | Row (`records`) | Final assessment scores and grades. |
| `app_documents` | Object | Blob | Generic JSON storage. Used for `tl_personal_lists`, `tl_backend_data`, `tl_agent_feedback`, `opl_hub_data`, `content_studio_data`. |
| `submissions` | Array | Row (`submissions`) | Digital test attempts (answers, timestamps). |
| `auditLogs` | Array | Row (`audit_logs`) | Admin action history. |
| `monitor_history` | Array | Row (`monitor_history`) | Daily activity logs (Pruned locally to 14 days). |
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
| `graduated_agents` | Array | Row (`archived_users`) | Archived data for former trainees. |
| `linkRequests` | Array | Row (`link_requests`) | TL requests for assessment links. |
| `calendarEvents` | Array | Row (`calendar_events`) | Custom calendar items. |


**Note:** The runtime uses a local delete queue key `system_pending_deletes` (persisted in localStorage) together with `system_tombstones` to reliably queue and flush deletes to the server and prevent deleted items from reappearing during sync.

### Row-Level Map (`ROW_MAP`)
Maps local `localStorage` keys to Supabase tables.
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
- **Security:** Mediates access to Node APIs and restricts direct module usage; renderer code still guards `require`/`ipcRenderer` usage and relies on the preload bridge for native operations.

#### `js/main.js` (Bootloader)
- **Responsibility:** App initialization, version checks, failover recovery, global event listeners, and Native OS bridging (`preload.js`).
- **Key Functions:**
    - `window.onload`: Main entry point. Checks `last_connected_server` for server migration logic. Calls `loadFromServer`.
    - `performSilentServerSwitch(newTarget)`: Hot failover helper. **Awaits the full local-to-target migration before pulling**, and rolls back to the previous target if the migration fails.
    - `loadFromServer()`: **CRITICAL**. Orchestrates the sync process. Returns `true` on partial/full success.
    - `startRealtimeSync()`: Starts the background polling loops for Data Sync and Heartbeat.
    - `applySystemConfig()`: Applies hot-reload settings (Announcements, Sync Rates).
    - `checkReleaseNotes(ver)`: Shows changelog popup on update.
    - `performUpdateRestart()`: Saves user state (drafts, active tab) and restarts the app after an update is downloaded.
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
    - `DataService.patchSessionUser()`: Safe per-trainee patching with retry queue.
    - `DataService.pollSessions()` / `DataService.setupRealtime()`: Dual-table session merge (`vetting_sessions_v2` + `vetting_sessions`) with realtime + fallback polling.

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
    - `graduateTrainee()`: Archives a user and wipes their active data.

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
    - `emergencyDataRepair()`: Clears local queues/cache and forces a fresh full download (Soft Reset).
    - `openDevTools()`: Opens Electron Developer Tools (Super Admin only).

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
    - `js/main.js`: Timeline app controller, admin template manager/apply flow, duration-based date automation.
    - `js/data.js`: Shared localStorage/Supabase bridge helpers, business-day date math, template serialization.
    - `js/ui_timeline.js`: Timeline tabs, toolbar actions, timeline cards.
    - `js/ui_calendar.js`: Calendar view rendering.

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
    - **Security Model:** The internal study browser (`<webview>`) allows all navigation, as there is no URL bar. Violations are only triggered by the OS-level `startActivityPoller` when the user switches to an unauthorized external application. Trainee study links must route through `window.StudyMonitor.openStudyWindow(...)` so they stay inside the secured Electron overlay instead of using raw `window.open(...)`. The browser shell now uses a dedicated control deck above the `webview` so navigation and action buttons do not compete with the embedded page for click focus, and the Electron `persist:study_session` partition is intentionally kept persistent to improve Microsoft/SharePoint study-session reliability across restarts.
    - `startMarkForClarity()`: Interactive drawing engine overlay injected into the `<webview>` for precision bounding-box screenshots/bookmarks.
    - `track(activity)`: Logs current activity.
    - `sync()`: Pushes `monitor_data` to server.
    - `checkDailyReset()`: Archives daily logs to `monitor_history` at midnight.

#### `js/insight.js` (Analytics)
- **Responsibility:** Performance dashboards.
- **Key Functions:**
    - `renderInsightDashboard()`: Renders Action Required / Full Overview.
    - `calculateAgentStatus()`: Determines if an agent is Critical/Pass based on scores.
    - `renderProgressView()`: Shows checklist of required assessments vs completed.

#### `js/analyticsDashboard.js` (Visuals)
- **Responsibility:** Charts and Graphs.
- **Key Functions:**
    - `renderDepartmentDashboard()`: Renders Effort vs Performance matrix.
    - `renderIndividualProfile()`: Renders detailed agent history and risk score.

#### `js/dashboard.js` (Home Screen)
- **Responsibility:** Main dashboard widgets.
- **Key Functions:**
    - `renderDashboard()`: Builds the grid layout based on user role.
    - `updateDashboardHealth()`: Reads Active Users instantly from `window.ACTIVE_USERS_CACHE` without hitting the database.
    - `buildNoticeManager()`: Admin tool for posting broadcasts.

#### `js/reporting.js` (Reports)
- **Responsibility:** Onboard Reports and Link Requests.
- **Key Functions:**
    - `generateReport()`: Aggregates data into a printable format.
    - `saveGeneratedReport()`: Saves snapshot to `savedReports`.
    - `requestRecordLink()`: Handles TL requests for assessment links.

#### `js/attendance.js` (Clock In/Out)
- **Responsibility:** Time tracking.
- **Key Functions:**
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

#### `js/content_studio_loader.js` + `modules/content_studio/` (Content Studio - Isolated Module)
- **Architecture:** "Program within a Program" loaded in a dedicated `<webview>` tab (`content-studio`) with internal submenus (`View`, `Builder`).
- **Entry Point:** `modules/content_studio/index.html` mounted by `js/content_studio_loader.js`.
- **Data Key:** `app_documents.key = content_studio_data` (local mirror key: `content_studio_data_local`).
- **Files:**
    - `js/main.js`: Module shell, subnav routing, and role-gated Builder access.
    - `js/data.js`: Isolated data + sync layer for timeline entries and engagement analytics.
        - **Timeline Linkage:** Binds content entries to schedule timeline items from `localStorage.schedules` using deterministic `scheduleKey`.
        - **Content Model:** Each entry stores header + subject list (`code`, rich text HTML, video link, document link).
        - **Engagement Model:** Tracks per-user subject analytics (`plays`, `watchSeconds`, `skips`, `skippedSeconds`, `skipEvents`, `lastPosition`).
    - `js/ui_view.js`: Renders document-style header + subject rows with play/document actions and subject dropdown.
        - **Tracking:** Video playback records watch-time deltas and forward-seek skip events (TikTok-style engagement intent).
    - `js/ui_builder.js`: Builder for header + subjects (custom rich text, video link, document link) with edit/delete + engagement summary.

---

## 4. Critical Workflows
### H. The Demo Sandbox (Data Isolation)
1.  **Intercept:** `auth.js` intercepts logins for `demo_admin`/`demo_tl`/`demo_trainee`, sets `DEMO_MODE` in `localStorage`, generates mock data, and forces a hard reload.
2.  **Shielding:** `data.js` detects `DEMO_MODE` on boot, deletes the `ROW_MAP`, preventing row-level sync to live tables, and prepends `demo_` to all blob keys (e.g. `demo_system_config`).
3.  **Destruction:** On logout or timeout, `sessionStorage` and `localStorage` are completely wiped. A 'Poison Pill' (`IS_SANDBOX_DB`) ensures orphaned data is destroyed on the next boot if the app was forced closed.

### A. The Boot Sequence (`main.js`)
1.  **Init:** Load `config.js` to set `supabaseClient`.
2.  **Migration Check:** Compare `last_connected_server` vs `active_server_target`. If different, trigger `saveToServer` (Push).
3.  **Load:** Call `loadFromServer()`.
    *   If successful: Render UI.
    *   If failed (Timeout/Error): Check `active_server_target`.
        *   If Local: Trigger **Auto-Recovery** (Switch to Cloud, set `recovery_mode` flag, reload).
4.  **Start Engine:** Call `startRealtimeSync()` to begin polling/heartbeat and **subscribe to Realtime channels**.

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
2.  The app also performs occasional resilient backup writes to the `sessions` table (roughly every 10 minutes) to persist a durable heartbeat and enable admin remote commands (`sessions.pending_action`).
3.  Admin UIs read from `window.ACTIVE_USERS_CACHE` for immediate presence information without frequent DB writes.

### G. Native OS Integrations
1.  **Disk Cache Recovery:** On every successful sync, `data.js` sends the entire database payload to `electron-main.js` via `save-disk-cache`. Native cache writes now use temp-file + atomic rename, and startup load validates JSON with `.bak` fallback recovery to prevent truncated-cache boot failures.
2.  **Intercepted Safe Quit:** When a user clicks "X" to close the app, `electron-main.js` blocks the close event, commands the frontend to `FLUSH` its data queue to the cloud, waits for the Mutex lock to complete the upload, and *then* cleanly shuts down the app.
3.  **Persistent Study Session:** The Electron `persist:study_session` partition is intentionally retained and flushed cleanly on quit so Microsoft/SharePoint training material has a better chance of preserving a stable sign-in session across app restarts.

---

## 5. Recent Architectural Notes

- **v2.6.19 (Retrain Attempt Unlock Hotfix, 2026-04-14):** Patched `js/assessment_trainee.js` to classify stale pre-move attempts as legacy by combining retrain archive move timestamps with linked `records.groupID` checks, then auto-ignore/archive those legacy attempts so trainees moved to a new group can start current scheduled assessments without false "already completed" lockouts.
- **v2.6.18 (Lifecycle + Grading Reliability Patch, 2026-04-14):** Hardened retrain/migration flow in `js/admin_users.js` with case-insensitive multi-group removal + dedupe to prevent trainees remaining in old groups after moves, and added completed-score self-healing in `js/admin_history.js` plus score fallback linking in `js/admin_grading.js` so finalized marks no longer display as `0%` after refresh/relogin when linked `records` rows are authoritative.
- **Content Studio Module (Current Build, 2026-04-14):** Added isolated `content-studio` tab with `View` + `Builder` submenus, schedule-linked header/subject documents, play/document action controls per subject, and per-user video engagement telemetry (watch-time + skip capture) persisted in `content_studio_data`.
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
- `manual-update-check`: Triggers auto-updater.
- `set-kiosk-mode`: Toggles Kiosk mode.
- `get-process-list`: Returns running processes (for Vetting).
- `get-screen-count`: Returns the number of connected displays.
- `get-active-window`: Returns title of foreground window (for Study Monitor).
- `set-update-channel`: Switches between 'prod' and 'staging' (beta) update channels.
- `perform-network-test`: Pings a target IP/Host and returns latency in ms.
- `get-system-stats`: Returns CPU load, RAM usage, Disk usage (C:), and Connection Type (Ethernet/Wireless).
- `open-devtools`: Opens the Chromium Developer Tools.
- `invoke-gemini-api`: Proxies a fetch request to the Gemini API from the main process to bypass CORS.

---


## 7. Release & Update Protocol (AI Instructions)

> **AI INSTRUCTION:** When the user asks to "Push this update" or "Release version X.X.X", follow this strict protocol:
> **AI INSTRUCTION:** When the user asks to "Push this update" or "Release version X.X.X", follow this strict protocol:

1.  **Update Version Numbers:**
    *   Increment `version` in `package.json`.
    *   Add a new entry to `getChangelog()` in `js/main.js` summarizing recent changes.

2.  **Update Documentation:**
    *   Update `README.md` "Recent Major Updates" section.
    *   **CRITICAL:** Update this file (`AI_CONTEXT.md`) if any architectural changes, new files, or schema changes occurred.

3.  **Generate Git Commands:**
    *   Prefer a scoped/safe commit over blanket staging:
        ```bash
        git add <only-relevant-files>
        git commit -m "feat: vX.X.X - Summary of changes"
        git push origin main
        ```

## 8. Anti-Regression Rules (CRITICAL FOR AI)
> **AI INSTRUCTION:** You MUST abide by these rules to prevent breaking the application's performance architecture.
1. **Context Isolation**: Main window runs with `nodeIntegration: false` and `contextIsolation: true`. Frontend OS calls must route through the secure bridge (`window.electronAPI`). Legacy `require('electron')` calls are only valid via the controlled shim in `js/main.js`, which maps to the same bridge.
2. **No Broad Database Polling**: Do not add generic schema polling loops. Prefer realtime cache (`localStorage`) and websocket push from `data.js`.  
   **Exception:** Approved targeted reliability pollers exist for exam-critical runtimes (Live Execution and Vetting 2.0) and must remain session-scoped and lightweight.
3. **No Database Heartbeats**: Do not write to the `sessions` table every 15 seconds. Use `window.PRESENCE_CHANNEL.track()`.
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
