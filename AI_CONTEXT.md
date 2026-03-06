# 1st Line Training Portal - Technical Architecture & Codebase Reference

> **AI INSTRUCTION:** This document contains the definitive technical context for the application. Use this to understand data flows, function responsibilities, and system architecture before proposing code changes.

## 1. System Architecture

**Type:** Thick Client / Local-First SPA
**Runtime:** Electron (Node.js + Chromium)
**Frontend:** Vanilla JavaScript, HTML5, CSS3
**Backend:** Supabase (PostgreSQL + Realtime)
**Sync Strategy:** Hybrid Row-Level Sync (Optimistic UI)

### Core Principles
1.  **Local-First:** `localStorage` is the primary data source for the UI. The app works offline and syncs when online.
2.  **Hybrid Sync:**
    *   **Blobs (`app_documents` table):** Low-volume, atomic data (Config, Rosters, Users) syncs as full JSON objects.
    *   **Rows (Dedicated Tables):** High-volume data (Records, Logs, Submissions) syncs as individual rows to save bandwidth and prevent overwrites.
3.  **Dual-Server Failover:** The client can hot-swap between a Cloud Supabase instance and a Local Docker Supabase instance based on `system_config`.

---

## 2. Data Schema (`js/data.js`)

### Global Schema (`DB_SCHEMA`)
| Key | Type | Sync Strategy | Description |
| :--- | :--- | :--- | :--- |
| `users` | Array | Blob | User credentials, roles, and themes. |
| `rosters` | Object | Blob | Group definitions `{ "GroupA": ["User1", "User2"] }`. |
| `system_config` | Object | Blob | Global settings (Sync rates, Security, Failover). **Protected**. |
| `records` | Array | Row (`records`) | Final assessment scores and grades. |
| `submissions` | Array | Row (`submissions`) | Digital test attempts (answers, timestamps). |
| `auditLogs` | Array | Row (`audit_logs`) | Admin action history. |
| `monitor_history` | Array | Row (`monitor_history`) | Daily activity logs (Pruned locally to 14 days). |
| `liveSessions` | Array | Row (`live_sessions`) | Active state of Live Assessments. |
| `tests` | Array | Row (`tests`) | Assessment definitions (Questions, Settings). |
| `liveBookings` | Array | Row (`live_bookings`) | Scheduled slots for live assessments. |
| `attendance_records` | Array | Row (`attendance`) | Clock In/Out logs. |
| `accessLogs` | Array | Row (`access_logs`) | Login/Logout history. |
| `error_reports` | Array | Row (`error_reports`) | Client-side error logs. |
| `savedReports` | Array | Row (`saved_reports`) | Generated Onboard Reports (HTML snapshots). |
| `insightReviews` | Array | Row (`insight_reviews`) | Admin manual reviews of agents. |
| `exemptions` | Array | Row (`exemptions`) | Assessment exemptions. |
| `nps_responses` | Array | Row (`nps_responses`) | Trainee feedback. |
| `graduated_agents` | Array | Row (`archived_users`) | Archived data for former trainees. |
| `linkRequests` | Array | Row (`link_requests`) | TL requests for assessment links. |
| `calendarEvents` | Array | Row (`calendar_events`) | Custom calendar items. |

### Row-Level Map (`ROW_MAP`)
Maps local `localStorage` keys to Supabase tables.
- `records` -> `public.records`
- `submissions` -> `public.submissions`
- `auditLogs` -> `public.audit_logs`
- `monitor_history` -> `public.monitor_history`
- `accessLogs` -> `public.access_logs`
- `error_reports` -> `public.error_reports`
- `liveSessions` -> `public.live_sessions`
- `tests` -> `public.tests`
- `liveBookings` -> `public.live_bookings`
- `attendance_records` -> `public.attendance`
- `savedReports` -> `public.saved_reports`
- `insightReviews` -> `public.insight_reviews`
- `exemptions` -> `public.exemptions`
- `nps_responses` -> `public.nps_responses`
- `graduated_agents` -> `public.archived_users`
- `linkRequests` -> `public.link_requests`
- `calendarEvents` -> `public.calendar_events`

---

## 3. File Reference & Function Map

### Core Infrastructure

#### `js/main.js` (Bootloader)
- **Responsibility:** App initialization, version checks, failover recovery, and global event listeners.
- **Key Functions:**
    - `window.onload`: Main entry point. Checks `last_connected_server` for migration. Calls `loadFromServer`.
    - `loadFromServer()`: **CRITICAL**. Orchestrates the sync process. Returns `true` on partial/full success.
    - `startRealtimeSync()`: Starts the background polling loops for Data Sync and Heartbeat.
    - `applySystemConfig()`: Applies hot-reload settings (Announcements, Sync Rates).
    - `checkReleaseNotes(ver)`: Shows changelog popup on update.

#### `js/data.js` (Sync Engine)
- **Responsibility:** Data synchronization logic (Pull/Push/Merge).
- **Key Functions:**
    - `loadFromServer(silent)`: Pulls data.
        - **Phase A (Blobs):** Checks `updated_at` timestamps in `app_documents`.
        - **Phase B (Rows):** Queries tables for rows newer than local `row_sync_ts`.
        - **Phase C (Monitor):** Merges `monitor_state` table.
    - `saveToServer(keys, force)`: Pushes data.
        - **Strategy A (Rows):** Calculates checksums. Upserts changed items to tables. Batches large uploads.
        - **Strategy B (Monitor):** Upserts to `monitor_state`.
        - **Strategy C (Blobs):** Upserts to `app_documents`. **Guarded:** `system_config` requires Super Admin.
    - `performSmartMerge(server, local)`: Merges arrays/objects. Handles deduplication by ID/Name.
    - `syncOrphans()`: Removes local records that no longer exist on the server (Hard Delete sync).

#### `js/auth.js` (Authentication)
- **Responsibility:** Login, Session Management, Security Checks.
- **Key Functions:**
    - `attemptLogin()`: Validates credentials against `users` array. Checks IP Whitelist, Client ID Ban, and Version.
    - `hashPassword(text)`: SHA-256 hashing for security.
    - `checkAccessControl()`: Verifies user IP against CIDR whitelist.
    - `secureAuthSave()`: Wrapper for saving user data immediately.

#### `js/config.js` (Configuration)
- **Responsibility:** Supabase Client initialization.
- **Logic:** Reads `active_server_target`. Initializes `window.supabaseClient`. Handles connection failures by triggering **Recovery Mode** (revert to Cloud).

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
    - `loadMarkingQueue()`: Lists pending submissions.
    - `openAdminMarking(id)`: Opens the grading modal.
    - `finalizeAdminMarking(id)`: Saves final scores and creates a permanent `record`.

#### `js/live_execution.js` (Live Arena)
- **Responsibility:** Real-time interactive assessments.
- **Key Functions:**
    - `loadLiveExecution()`: Starts the Live Arena. Subscribes to `live_sessions` realtime channel.
    - `adminPushQuestion(idx)`: Updates session state to show a specific question.
    - `renderTraineeLivePanel()`: Renders the active question for the trainee.
    - `submitLiveAnswer()`: Pushes trainee answer to the server instantly.

#### `js/vetting_arena.js` (Security)
- **Responsibility:** Secure testing environment (Kiosk Mode).
- **Key Functions:**
    - `enterArena()`: Locks the terminal (Kiosk Mode).
    - `checkSystemCompliance()`: Checks for 2nd monitors or forbidden apps via IPC.
    - `renderAdminArena()`: Shows live status of all trainees in the session.
    - `updateTraineeStatus()`: Pushes status (Started/Blocked/Completed) to `vetting_sessions`.

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

#### `js/schedule.js` (Calendar)
- **Responsibility:** Scheduling and Live Bookings.
- **Key Functions:**
    - `renderSchedule()`: Renders the Timeline or Calendar view.
    - `renderLiveTable()`: Renders the Live Assessment booking grid.
    - `confirmBooking()`: Validates and saves a new booking.

### Monitoring & Analytics

#### `js/study_monitor.js` (Activity Tracker)
- **Responsibility:** Tracks active window titles and idle time.
- **Key Functions:**
    - `track(activity)`: Logs current activity.
    - `sync()`: Pushes `monitor_data` to server.
    - `checkDailyReset()`: Archives daily logs to `monitor_history` at midnight.
    - `renderActivityMonitorContent()`: Renders the Admin view (Live Grid or Review Queue).

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
    - `updateDashboardHealth()`: Fetches system stats (Active Users, Latency).
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

---

## 4. Critical Workflows

### A. The Boot Sequence (`main.js`)
1.  **Init:** Load `config.js` to set `supabaseClient`.
2.  **Migration Check:** Compare `last_connected_server` vs `active_server_target`. If different, trigger `saveToServer` (Push).
3.  **Load:** Call `loadFromServer()`.
    *   If successful: Render UI.
    *   If failed (Timeout/Error): Check `active_server_target`.
        *   If Local: Trigger **Auto-Recovery** (Switch to Cloud, set `recovery_mode` flag, reload).
4.  **Start Engine:** Call `startRealtimeSync()` to begin polling/heartbeat.

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
    *   **Protection:** `system_config` is only saved if user is Super Admin and save is explicit.

### C. Vetting Arena Security
1.  **Entry:** Trainee clicks "Enter Arena".
2.  **Lockdown:** `ipcRenderer` triggers Kiosk Mode (Fullscreen, No Exit) and Content Protection (No Screenshots).
3.  **Monitoring:**
    *   **Net Poller:** Checks `vetting_sessions` table for commands.
    *   **Local Poller:** Checks Process List (Task Manager) and Screen Count.
4.  **Violation:** If forbidden app found -> Alert -> Force Submit -> Kick.

### D. Failover Protocol
1.  **Detection:** `startServerLookout` polls both Cloud and Local URLs every 30s.
2.  **Command:** If `system_config.active` changes on the remote server:
    *   **Ping Check:** Verify new server is reachable.
    *   **Switch:** Update local config, reload app.
3.  **Migration:** On reboot, `main.js` detects the switch and pushes local data to the new server.

---

## 5. IPC Channels (Electron Main)
- `get-app-version`: Returns `package.json` version.
- `manual-update-check`: Triggers auto-updater.
- `set-kiosk-mode`: Toggles Kiosk mode.
- `get-process-list`: Returns running processes (for Vetting).
- `get-active-window`: Returns title of foreground window (for Study Monitor).

---

## 6. Release & Update Protocol (AI Instructions)

> **AI INSTRUCTION:** When the user asks to "Push this update" or "Release version X.X.X", follow this strict protocol:

1.  **Update Version Numbers:**
    *   Increment `version` in `package.json`.
    *   Add a new entry to `getChangelog()` in `js/main.js` summarizing recent changes.

2.  **Update Documentation:**
    *   Update `README.md` "Recent Major Updates" section.
    *   **CRITICAL:** Update this file (`AI_CONTEXT.md`) if any architectural changes, new files, or schema changes occurred.

3.  **Generate Git Commands:**
    *   Provide the standard git commands to commit and push:
        ```bash
        git add .
        git commit -m "feat: vX.X.X - Summary of changes"
        git push origin main
        ```