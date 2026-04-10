# 1st Line Training Portal (Cloud Edition)

## Project Overview
A comprehensive, "Thick Client" training and assessment platform built with **Electron** and **Vanilla JavaScript**, utilizing **Supabase** for real-time cloud synchronization. The application follows a **Local-First / Optimistic UI** architecture where `localStorage` is the immediate source of truth, synchronized asynchronously with the cloud.

It supports multiple user roles (Admin, Team Leader, Trainee, Special Viewer) and features secure testing environments (Vetting Arena), live interactive assessments, productivity monitoring, and detailed reporting.

## Architecture
- **Frontend**: Vanilla JavaScript, HTML5, CSS3 (SPA architecture loaded via `index.html`).
- **Runtime**: Electron (Main Process handles Node integration, Kiosk Mode, Auto-Updates).
- **Database**: 
  - **Local**: `localStorage` (Primary read/write layer).
  - **Cloud**: Supabase (Hybrid Model: `app_documents` for config blobs, dedicated tables for `records`, `submissions`, `logs`, etc.).
- **Sync Engine**: Custom "Hybrid Row-Level Sync" (`js/data.js`).
  - **Failover**: "Dual-Aware" client capable of hot-swapping between Cloud and Local servers via `startServerLookout`.
  - **Logic**: 
    - **Blobs**: Config/Rosters sync as JSON objects.
    - **Rows**: High-volume data (Records, Logs) syncs as individual rows to save bandwidth.
  - **Optimization**: Uses lightweight checksums to track changes and prevent storage bloat.

## Key File Structure & Responsibilities

### Core
- **`index.html`**: Main entry point. Loads all scripts dynamically based on availability.
- **`electron-main.js`**: Main Process. Handles window management, Kiosk Mode (Vetting), Auto-Updates, and OS-level IPC (Process list, Screen count).
- **`js/data.js`**: **The Heart of the App.** Handles `loadFromServer` (Pull) and `saveToServer` (Push). Implements `performSmartMerge` to combine arrays/objects intelligently.
 - **`js/auth.js`**: Authentication, Password Hashing (SHA-256), Role Management, IP Access Control (CIDR checks), and **Semantic Versioning** checks.
 - **`js/main.js`**: Boot sequence, Version checks, Session restoration, **Release Notes Popup**, Global Event Listeners, **Vetting Enforcer** initialization, and **Theme Application**.
- **`js/utils.js`**: Shared utility functions for formatting and common helpers.
- **`js/forms.js`**: **First-Time Questionnaire** logic, Profile updates, and Assessment **Exemption** handling.

### Assessment Engine (Split Architecture)
*Refactored to separate concerns.*
- **`js/assessment_core.js`**: Shared rendering logic (`renderQuestionInput`), Answer persistence, and Reference Viewer.
- **`js/assessment_admin.js`**: Admin Dashboard, Marking Queue, Grading Logic, and Record Creation.
- **`js/assessment_trainee.js`**: Trainee Test Taker, Timer Logic, Draft Saving, and Submission.
- **`js/admin_builder.js`**: Test Creator UI with **Draft Saving**. Supports Rich Text, Matrix, Matching, Drag & Drop, and Live Practical types.
- **`js/calendar.js`**: **Unified Event Engine**. Aggregates Schedules, Live Bookings, and Custom Events into a single timeline. Powers the "Today's Tasks" widget.
- **`js/admin_history.js`**: Historical view of completed assessments with Retake/Delete capabilities.
- **`js/admin_grading.js`**: Manual Score Capture interface and "Test Records" history view (aggregates digital & manual).

### Specialized Modules
- **`js/schedule.js`**: 
  - Manages Assessment Timeline and Calendar views with **Multi-Group Support** (Schedule A, B, etc.).
  - **Live Assessment Engine**: Implements **Multi-Group Live Schedules** (Live Schedule A, B...), allowing distinct start dates, durations, and active slot configurations per group.
  - Handles Booking logic (Slots, Conflicts, Cancellations) and dynamic Trainee-to-Schedule mapping.
- **`js/live_execution.js` (Live Arena)**: 
  - Real-time interaction between Trainer and Trainee.
  - Uses Polling or Supabase Realtime to sync state (`liveSession` key).
  - **Timer Control**: Admin starts/stops question timers; syncs to Trainee.
  - **Connection Health**: Monitors trainee connectivity status.
  - Admin pushes questions; Trainee answers in real-time.
- **`modules/vetting_rework/js/main.js` + `modules/vetting_rework/js/data.js` (Vetting Arena 2.0 Admin Runtime)**:
  - Primary Admin/Super Admin/Special Viewer vetting control surface (isolated webview runtime).
  - Multi-session control, realtime monitor table, per-trainee security toggle/override, force refresh controls.
  - Dual-table sync (`vetting_sessions_v2` + `vetting_sessions`) with retry queue and fallback polling.
- **`js/vetting_runtime_v2.js` (Vetting Arena 2.0 Trainee Runtime Bridge)**:
  - Host-side trainee exam flow (pre-flight checks, auto-route enforcer, kiosk/content-protection enforcement).
  - Safe status patching with retry queue against both vetting tables.
  - Preserves timer/start/submit lock behavior until Admin ends the vetting session.
- **`js/study_monitor.js` (Productivity)**: 
  - Tracks user activity (Study vs External vs Idle).
  - Uses `ipcRenderer` to get active window titles.
  - **Focus Score**: Calculated based on time spent in Whitelisted apps vs External.
  - **Timeline**: Visual bar showing activity segments (Green=Study, Red=External, Striped=Tolerated).
  - **Detailed View**: Clickable timeline for granular session analysis.
- **`js/dashboard.js`**: 
  - Role-specific Home Screen (Admin, TL, Trainee).
  - Customizable Widget Layout (Drag & Drop).
  - Urgent Notice System.
  - **Gamification Engine**: Leaderboards and Badge earning logic.
- **`js/reporting.js`**: 
  - Generates printable A4 Onboard Reports.
  - Aggregates Manual Records and Digital Submissions.
  - **Link Management**: Handles Team Leader requests for assessment links.
- **`js/agent_search.js`**: 
  - Comprehensive Agent Profile view.
  - Aggregates Attendance, Activity, Records, and Notes.
- **`js/insight.js`**: 
  - Analytics Dashboard (Effort vs Performance, Knowledge Gaps).
   - "Action Required" logic for failing agents (Deduplicated by Highest Score).
   - **Stale Review Detection**: Automatically reverts manual "Pass" statuses if new failing data arrives.
  - **Access Revocation**: Logic for blacklisting and removing users.
- **`js/attendance.js`**: 
  - Clock In/Out system with Late Reason capture.
  - Admin Register view.
  - **Reminders**: "Clock In" prompt on login (until 4 PM) and "Clock Out" alerts (16:45 - 17:00) with a stern popup at 16:55.
- **`js/nps_system.js`**: 
  - Net Promoter Score surveys triggered by time or completion.
- **`js/analyticsDashboard.js`**: 
  - Visual rendering engine (`AnalyticsEngine`) for charts/graphs used in Insights and Agent Profiles.

### Admin & System
- **`js/admin_users.js`**: User CRUD, Roster Management, **Onboarding Email Automation**, and **Graduate/Restore** workflows.
 - **`js/admin_sys.js`**: Database Management (**Row-Level Sync** aware), System Health, **Super Admin Console**, **Remote Commands** (Kick/Ban), **Audit Logs**, and **System Configuration** (Hot Reload). Handles **Factory Reset** and **Data Deletion** across cloud tables.
- **`js/admin_updates.js`**: Auto-Updater logic and Update Logs.
- **`js/ai_core.js`**: **AI System Analyst** (Gemini Integration). Handles natural language commands, system diagnostics, error analysis, and self-repair logic.

## User Roles
1.  **Super Admin**: Ultimate control. Can configure system internals, ban clients, override security locks, and manage global settings.
2.  **Admin**: Full access. Manage users, build tests, grade, configure system.
3.  **Team Leader**: View-only access to reports, schedules, and agent progress.
4.  **Trainee**: Restricted access. Take tests, view schedule, check results.
5.  **Special Viewer**: Read-only Admin view (Audit mode).

## Critical Logic Flows

### 1. Data Synchronization (`js/data.js`)
The app uses a **"Hybrid Row-Level Sync"** engine:
- **Load (Pull)**: 
  - Fetches metadata for Blobs (Config, Rosters).
  - Queries Tables for new Rows (Records, Logs) based on `updated_at`.
- **Merge**: `performSmartMerge(server, local, strategy)` combines arrays/objects.
  - **Deduplication**: Case-insensitive matching for records to prevent duplicates.
- **Save (Push)**: 
  - **Blobs**: Pushes full JSON objects for settings.
  - **Rows**: Pushes only changed items as individual rows to Supabase tables.
- **Optimization**: Uses 8-char checksums in `hash_map` to track changes efficiently.
- **Auto-Recovery**: Automatically retries sync when network comes online.
- **Visuals**: UI indicates "Unsaved...", "Syncing...", "Offline", or "Sync Failed" with a manual Retry/Speed Test button.

### 2. Activity Monitoring (`js/study_monitor.js`)
- **Polling**: Every 5s, checks active window title.
- **Classification**: 
  - Matches against `monitor_whitelist` -> **Study**.
  - If not matched -> **External**.
  - If no input for > 1 min -> **Idle**.
- **Tolerance**: External/Idle segments < 3 mins are visually "Striped" and count as neutral/study to prevent micro-micromanagement.
- **Persistence**: Data is archived daily to `monitor_history` to keep the payload light.

### 3. Live Assessment (`js/live_execution.js`)
- **Session State**: Stored in `liveSessions` array in Supabase.
- **Flow**:
  1. Admin clicks "Start" on a Booking.
  2. Session object created with `sessionId`.
  3. Trainee's UI detects active session via polling/realtime.
  4. Admin updates `currentQ` index.
  5. Trainee UI renders Question `currentQ`.
  6. Trainee answers -> Syncs to Server -> Admin UI updates.
  7. Admin grades -> "Finish" -> Saves to `submissions` and `records`.

### 4. Vetting Arena 2.0 (Admin Webview + Trainee Bridge)
- **Admin Runtime (Primary):** `modules/vetting_rework/` runs inside the Vetting tab webview for Admin/Super Admin/Special Viewer.
- **Trainee Runtime (Primary):** `js/vetting_runtime_v2.js` renders the secure trainee arena in the host app.
- **Pre-Flight:** Checks for 2nd monitor and forbidden apps before allowing test start.
- **Lockdown:** Enforces kiosk and content protection during strict mode.
- **Monitoring:** Admin sees a live table of trainees, statuses, timer progress, and security violations.
- **Enforcer:** Background watcher auto-redirects trainees to Vetting when a targeted session is active.
- **Reliability:** Writes and reads both `vetting_sessions_v2` and `vetting_sessions`, with retry queue + 1-second fallback pollers.

### 5. Assessment Lifecycle
1. **Creation**: Admin builds test in `js/admin_builder.js`. Saved to `tests`.
2. **Assignment**: 
   - **Standard**: Added to Schedule (`js/schedule.js`).
   - **Live**: Booked via Live Booking system.
   - **Vetting**: Pushed via Vetting Arena control panel.
3. **Execution**: Trainee takes test (`js/assessment_trainee.js`). Drafts saved locally.
4. **Submission**: Pushed to `submissions` array.
5. **Grading**: Admin reviews in `js/assessment_admin.js` or `js/live_execution.js`.
6. **Record**: Final score saved to `records` (Permanent History).

### 6. Vetting Non-Regression Map
- **Session visibility drops / stale monitors:** prevented by dual-table sync + retry queue + 1-second fallback pollers.
- **Trainees not auto-routed into active vetting:** prevented by login enforcer + stale-session filtering.
- **Security relax accidentally bypassing global strict mode:** prevented by explicit `force_kiosk_global` override in trainee security checks.
- **"Already Submitted" retake lockouts in arena:** prevented by arena-mode submission archive logic before start.
- **Data overwrite/race during trainee status updates:** prevented by per-trainee safe patching rather than full-session blind overwrite.
- **Post-submit unlock or accidental session exit:** prevented by keeping trainee locked in session state until Admin ends the vetting session.

## Recent Major Updates (AI Context)
 - **Vetting 2.0 Cutover (Current)**: Promoted Vetting Arena 2.0 as the primary runtime. Admin controls run in isolated `modules/vetting_rework` (with security toggle, override, and force-refresh controls), while trainee secure exam execution runs in `js/vetting_runtime_v2.js` with pre-flight checks, kiosk enforcement, dual-table sync (`vetting_sessions_v2` + `vetting_sessions`), retry queue, and 1-second fallback polling to prevent status/session loss during realtime instability.
 - **v2.6.10**: **Critical Vetting Join Hotfix**: Fixed Vetting 2.0 admin runtime to use the active server target credentials (cloud/local/staging) when creating sessions so trainees and admins are always reading/writing the same backend, and tightened trainee arena visibility checks to include active `adminVettingSessions` targeting logic so valid live sessions reliably appear.
 - **v2.6.9**: **Server-Authority Sync Hardening**: Enforced server-authoritative behavior for shared data paths (users, rosters/groups, schedules, tests, and live assessment state) by blocking background autosave pushes for strict shared keys unless explicitly forced/targeted, forcing server-first refresh for strict shared blobs during load, adding disk-cache recovery guardrails to prevent stale migration pushes after crash restore, and fixing roster group deletion ordering to prevent deleted groups from reappearing.
 - **v2.6.8**: **Archive Separation + Hard Refresh Upgrade**: Split retraining transfers into dedicated `retrain_archives` so graduation archive/reporting remains clean, updated agent/report archive lookups to preserve retrain history without graduate labeling, and upgraded the header refresh action to flush queued writes/deletes, trigger embedded vetting queue flushes, clear sync timestamps, and pull a full fresh Supabase snapshot before rerendering active surfaces.
 - **v2.6.7**: **Live Arena 1-Second Hard Sync**: Added a strict 1-second targeted live-session refresh loop while Live Execution is open, plus shared force-refresh-by-session-id handling, so trainee question updates continue landing even when realtime tunnel delivery is unstable.
 - **v2.6.6**: **Live Arena Command-Channel Fix**: Added a guaranteed `sessions.pending_action` live-sync nudge path so trainee clients force-refresh the exact `live_sessions` row on trainer question pushes and Test Connection pings, preventing stalls that previously required logout/login.
 - **v2.6.5**: **Release Rollout Update**: Version increment for stable deployment alignment, carrying forward the Live Arena realtime reliability improvements (v2.6.3) and critical boot parser hotfix (v2.6.4).
 - **v2.6.4**: **Critical Boot Hotfix**: Fixed a JavaScript parsing error in release-note rendering that could break app initialization (`main.js`) and trigger downstream UI boot issues like missing `showTab`.
 - **v2.6.3**: **Live Arena Realtime Reliability**: Hardened Live Assessment session propagation so trainee question changes sync immediately without requiring session exit/re-entry, added automatic recovery for partial `live_sessions` realtime payloads, and introduced monotonic live revision/push timestamps plus event-driven cache hooks for more deterministic trainer-to-trainee updates.
 - **v2.6.2**: **Schedule Studio Templates + SharePoint Reliability**: Added admin-only editable timeline templates inside the isolated Schedule Studio module, including duration-based business-day auto date generation that skips weekends/holidays, restored clear Delete Timeline controls, and improved Microsoft SafeLinks/SharePoint URL handling to reduce blank/error study page opens.
 - **v2.6.1**: **Microsoft Link Stability + Trainee UX Scope**: Preserved Microsoft/SharePoint links exactly as entered, fixed trainee schedule/calendar visibility to only the learner’s assigned group, expanded trainee Profile & Settings personalization with Experimental Themes/Custom Lab controls, and added a Study Browser cache/session clear action for Microsoft login recovery.
 - **v2.6.0**: **Sync + User Reliability + Study Cache**: Hardened Manage Users so deleted users and profile edits persist correctly (no random resurrection), upgraded realtime queue processing to reduce typing lockups during heavy Supabase bursts, added local in-app study page cache fallback for failed loads, and extended Custom Lab with Wallpaper URL support.
 - **v2.5.9**: **Live Booking Integrity + Theme Lab Upgrade**: Added a Booking Integrity Check with auto-repair for duplicate/invalid live bookings to protect Live Arena and trainee breakdown consistency. Reworked Experimental Themes to affect more of the app with richer motion and added a full Custom Theme Builder (preview/save/reset) while keeping one-click revert to the original profile theme.
 - **v2.5.8**: **Critical Fix**: Resolved an infinite background loop during the safe-quit sequence that created zombie processes and blocked the auto-updater from overwriting files.
 - **v2.5.7**: **System Update**: Version bump and minor maintenance.
 - **v2.5.6**: **Live Data Studio**: Added a dedicated, isolated module for Super Admins to securely view and directly edit live Supabase database records through a real-time visual interface.
 - **v2.5.5**: **Persistent Login & Study Session Hardening**: The desktop app now restores the last valid login until logout, the Microsoft/SharePoint study browser session is more durable on trainee installs, and the Team Leader Hub Agent Feedback flow was rebuilt into a new guided wizard with linked ticket-path question filtering.
 - **v2.5.4**: **Study Browser Controls**: Reworked the in-app study browser so the full control set stays usable after opening training links in new tabs. Added a dedicated control deck and improved button clickability and tab handling.
 - **v2.5.3**: **Study Browser Hardening**: Fixed the secure in-app browser bridge so Schedule study material opens inside the Electron overlay again, improved tab/navigation reliability, and added a safe Windows Snipping Tool exception to the OS-level activity monitor.
 - **v2.5.2**: **Data Integrity & Test Engine**: Fixed a critical case-sensitivity bug in the Sync Engine preventing Trainee scores from loading correctly. Resolved the "Disappearing Test" bug caused by stale Vetting Enforcer sessions.
 - **v2.5.1**: **Hotfix & Polish**: Resolved a startup crash in the release notes viewer and finalized the stable deployment of the new Teamleader Hub Agent Feedback System.
 - **v2.4.77**: **Sync Reliability & Cleanup**: Silent server switches now await migration before pulling fresh data, failed save keys are re-queued instead of being stranded, realtime fallback polling now stays off while the tunnel is healthy, and unused legacy files were safely removed from the repo.
 - **v2.4.72**: **Presentation Tools**: Built a 100% isolated Demo Sandbox (`demo_admin`/`demo_trainee`) with rich mock data generation. Implemented a 5-layer isolation shield to guarantee live production data is completely protected from sandbox leaks during unexpected app closures or browser cache restorations.
 - **v2.5.0**: **Agent Feedback System**: Added a comprehensive "Agent Production Feedback" form and a "Feedback Review Dashboard" to the Teamleader Hub. The new system saves to a dedicated cloud record (`tl_agent_feedback`) and features dynamic, per-question dropdown configuration.
 - **v2.4.73**: **Security & UX**: Simplified the Study Browser security model by removing the internal firewall, fixing complex SSO login crashes. Violation tracking now relies solely on the OS-level monitor for external applications.
 - **v2.4.76**: **Hotfix**: Resolved a startup crash (`SyntaxError`) preventing the application from loading by correctly handling asynchronous calls in the Activity Monitor initialization.
 - **v2.4.75**: **AI & Log Integrity**: Fixed a startup race condition causing log bleeding between days. Improved activity classification (Material vs. Tools) and overhauled the AI prompt to provide a structured, narrative summary of the day.
 - **v2.4.74**: **AI Stability**: Hardened the Gemini API integration to resolve connection errors related to CORS, API versions, and regional model availability. Added a "Test Connection" diagnostic tool and a model selector dropdown to the Super Admin console.
 - **v2.4.71**: **Stability & UX**: Added SharePoint URL Sanitizer to the Schedule to prevent stale links. Fixed Activity Monitor wake-from-sleep race condition.
 - **v2.4.70**: **Hotfix**: Fixed scroll-reset issue in the Activity Monitor breakdown views.
 - **v2.4.69**: **Hotfix**: Resolved Activity Monitor rendering crash related to URL cleaner strictness.
 - **v2.4.68**: **Activity Monitor 3.0 & Performance**: Implemented 4-tier activity breakdown, Study Browser Sandbox Firewall, Date-Picker for archives, and parallelized boot sequence for instant startup. Added Assessment Protection for system updates.
 - **v2.4.67**: **Activity Monitor & Browser**: Added strict Violation tracking for external apps. Fixed study browser navigation button focus issues when viewing PDFs.
 - **v2.4.66**: **Architectural Hardening**: Patched 10+ critical race conditions, state desyncs, and edge cases. Added Lunch Timer UI, client-side image compression, and defused the assessment "Time-Stop" exploit.
 - **v2.4.65**: **Network Resilience**: Hardened the Zero-Latency Real-Time tunnel with a Dynamic Fallback Engine. Silently falls back to 30-second polling if WebSockets are blocked and actively attempts to rebuild dropped connections.
 - **v2.4.64**: **Performance & UX**: Zero-latency WebSockets for Live Arena, Trainee Data Minimization (98% bandwidth reduction), and native Spellcheck Context Menu.
 - **v2.4.63**: **Performance & Stability**: Optimized Cloud Database with SQL indexes for instant RTT. Reduced trainee background sync payloads. Suppressed ghost diagnostic popups.
 - **v2.4.62**: **Study Browser & Monitor**: Fixed stale UI buttons, added Preseem to quick links, and whitelisted MS Teams/Outlook.
 - **v2.4.61**: **Study Monitor**: Added full Sandbox Browser with tab support, Cloud-synced Bookmarks, and OS-level hardware idle tracking.
 - **v2.4.53**: **Hotfix**: Resolved infinite failover loop and added mutex locks for silent server switching. Added dev-mode version bypass.
 - **v2.4.52**: **Hotfix**: Fixed login screen crash caused by background Live Assessment syncing without an active user session.
 - **v2.4.51**: **Test Engine UI**: Added Type Filter to Assessment Manager. Redesigned Marking Queue to group submissions by Trainee with color-coded tags. Fixed offline failover "Ghost Data" persistence.
 - **v2.4.50**: **Performance & Admin UI**: Optimized background sync queries. Added per-environment sync rate configurations and visual server failover cards.
 - **v2.4.49**: **Failover Recovery**: Fixed server migration protocol to prevent stale local data from overwriting the cloud database when reconnecting. Implemented Pristine Pull.
 - **v2.4.48**: **Arena Diagnostics**: Added Test Connection ping tool and Force Refresh remote commands to Live and Vetting Arenas. Added missing test data fallback recovery.
 - **v2.4.47**: **Live Assessment UX**: Added global floating alerts for session starts. Implemented strict server-side duplicate booking prevention. Added manual refresh button. Improved Trainee schedule sync logic.
 - **v2.4.46**: **Realtime-First Refactor**: Migrated Attendance, Vetting, and Live Execution to a direct-to-database model for instant updates. Patched critical edge cases related to offline use and UI stability.
 - **v2.4.44**: **Live Assessment Fixes**: Eliminated race conditions causing Double-Bookings, Ghost Renders, and UI-Wipes during drag-and-drop. Implemented atomic collision checks directly to Supabase.
 - **v2.4.43**: **Sync Engine**: Fixed "Disappearing Data" glitch caused by PostgreSQL WAL partial updates during bulk saves.
 - **v2.4.42**: **Live Assessments**: Fixed drag-and-drop reverting bug. Added manual admin assignment capability to slots.
 - **v2.4.41**: **Grading Visibility**: Fixed aggressive Ghost Data cleanup hiding legitimate retakes from the Marking Queue.
 - **v2.4.40**: **Sync Engine Reforge**: Fixed severe background data loop and Local Edits Shield to protect rapid grading.
 - **v2.4.39**: **Grading Stability**: Fixed score overwrite race condition. Added Phase Filter to history.
 - **v2.4.38**: **Data Integrity & Fixes**: Added Ghost Slayer local purge. Fixed invisible history tests and orphaned Live Bookings.
 - **v2.4.35**: **Critical Fixes**: Fixed Vetting Arena UI refreshing bug and Assessment Timer/Answer disappearing glitches.
 - **v2.4.34**: **Hotfixes**: Resolved authentication initialization and Vetting Arena view mode errors.
 - **v2.4.31**: **Admin Split View**: Added multi-monitor Grid UI for managing parallel Vetting Sessions simultaneously.
 - **v2.4.30**: **Multi-Session Vetting**: Upgraded Vetting Arena to support concurrent live sessions with a multi-tab admin interface.
 - **v2.4.29**: **Team Leader Hub Overhaul**: Implemented mandatory field validation, multi-entry support for outages/handovers, and enhanced UI for operational tasks.
- **v2.4.28**: **Data Integrity & Stability**: Fixed Live Assessment completion bug. Implemented "Deep Clean" user deletion. Added Network Health history view for Admins.
- **v2.4.27**: **Network Tool Fix**: Moved Network Test to the main sidebar for reliable visibility. Fixed related startup crashes and console warnings.
- **v2.4.25**: **Network Diagnostics**: Added a comprehensive Network Diagnostics tool with historical admin view. Fixed related UI and stability issues.
- **v2.4.24**: **Feature Fix**: Resolved Network Diagnostics button visibility and fixed related database errors.
- **v2.4.23**: **Critical Fixes**: Resolved Live Assessment score overwrites. Fixed Grading Queue count mismatches. Added Emergency Data Repair tool.
- **v2.4.22**: **Stability & Integrity**: Fixed background sync freezing issues. Implemented "Tombstone" protocol for permanent deletions. Improved Sync Queue UI.
- **v2.4.21**: **Data Integrity & Live Arena**: Resolved "Ghost Pending Test" sync bug. Hardened the Live Assessment booking system to prevent duplicate sessions and provide instant "Join Now" alerts for trainees.
- **v2.4.12**: **Migration Tools**: Finalized Staging Mode and Migration protocols for server switchover.
- **v2.4.11**: **Workflow**: Implemented Staging Mode and Draft Releases for safer deployment.
- **v2.4.10**: **Maintenance**: General stability improvements and version synchronization.
- **v2.4.7**: **Maintenance**: Version bump for deployment. Includes Schedule Link fixes and Notification polling updates.
- **v2.4.6**: **Hotfix**: Fixed update notification polling and schedule link issues (SharePoint characters). Forced sync for trainees on schedule view.
- **v2.4.7**: **Storage Optimization**: Implemented aggressive pruning for activity logs and disabled hash mapping for history tables to prevent LocalStorage quota errors and boot loops.
- **v2.4.6**: **Hotfix**: Temporarily disabled automatic server switching (Lookout) to resolve login loops when Local Server is unstable.
- **v2.4.5**: **Login Stability**: Implemented "Recovery Mode" to prevent infinite switching loops when the Local server is unreachable. Ensures Admins can always log in via Cloud to fix configuration.
- **v2.4.4**: **Configuration Protection**: Implemented strict write protection for global system settings (`system_config`) to prevent older clients from overwriting server configuration during sync. Added explicit restore capability for Admins.
- **v2.4.3**: **Data Integrity**: Implemented strict "Hard Delete" logic across all Admin modules (History, Groups, Reports, Schedule) to permanently remove data from the cloud and prevent "Zombie Data" recurrence.
- **v2.4.2**: **Feature Expansion**: Added Broadcast Message capability for Team Leaders. Enabled PDF uploads for Assessment Reference material. Implemented configuration write protection to prevent legacy client overwrites.
- **v2.4.1**: **UX & Stability**: Added manual Ping button for latency testing. Fixed "Monitor Live" count error in Admin Database tools.
- **v2.4.0**: **Unlimited Architecture**: Enabled Global Realtime Sync (Push) for instant updates. Migrated Assessments to Row-Level Sync for scalability. Added Image Upload support for Test Builder. Added "My Team" widget for Team Leaders.
- **v2.3.10**: **Stability Release**: Finalized robust failover logic, fixed "Zombie Data" recurrence during server switches, and hardened real-time assessment engines against race conditions.
- **v2.3.9**: **Data Integrity & Real-time Hardening**: Implemented "Smart Orphan Cleanup" to prevent deleted data from reappearing ("Zombie Data"). Upgraded Vetting Arena to support multiple concurrent sessions. Hardened Live Assessment answer syncing to prevent race conditions.
- **v2.3.8**: **Critical Failover Fix**: Resolved issue where Auto-Recovery wouldn't trigger because sync errors were being suppressed. App now correctly detects dead Local connections and reverts to Cloud.
- **v2.3.7**: **Failover & Permissions**: Fixed issue where app wouldn't revert to Cloud if Local server died. Hardened Team Leader permissions to strictly block Insight Dashboard access.
- **v2.3.6**: **Failover Hardening**: Implemented "Ping Check" to prevent switching to unreachable servers (Loop Prevention). Added automatic fallback to Cloud if Local server fails on startup.
- **v2.3.5**: **Server Indicator**: Added a visual indicator in the header to show whether the app is connected to Cloud or Local server.
- **v2.3.4**: **Dual-Server Stability**: Resolved numerous schema and configuration issues for local Supabase setup. Added a "Schema Check" tool to the Super Admin console to verify database compatibility before switching servers. Hardened Team Leader permissions.
- **v2.3.3**: **Vetting & Sync Hardening**: Fixed "Uneditable Text" bug in Vetting Arena by preventing alert loops. Improved security check to ignore background Edge/Chrome processes (False Positives). Implemented "Soft Deletes" to ensure deleted records are removed from all clients.
- **v2.3.2**: **Update Notifications**: Added a notification bell alert when a new system update is downloaded and ready to install.
- **v2.3.1**: **Trainee Access**: Enabled Trainees to view their own Vetting Test submissions and history in the "Test Records" tab.
- **v2.3.0**: **Dual-Server Failover System**: Implemented "Dual-Aware" client architecture. The app now supports hot-swapping between Cloud and Local Supabase instances. Added **Server Lookout** service to poll both servers for switch commands. Implemented **Migration Protocol** to auto-push local data when switching servers, preventing data loss. Added **Connectivity Tester** and **Failover Controls** to Super Admin Console.
- **v2.2.15**: **Documentation & Polish**: Updated README to reflect Universal Search, Working Hours logic, and Stale Review detection.
- **v2.2.14**: **Data Integrity Fixes**: Fixed "Zombie Data" issues where deleted records/submissions would reappear. Updated Factory Reset to correctly wipe all cloud tables. Hardened deletion logic in Admin Database tools.
- **v2.2.13**: **Insight & Live Fixes**: Fixed Insight Dashboard to correctly reflect retaken assessments (Highest Score logic). Resolved "Zombie" Live Sessions by filtering stale data and fixing the Admin Clear tool.
- **v2.2.12**: **Timer Fixes**: Fixed Vetting Test timer display for trainees (formatting & visibility). Increased Admin Monitor refresh rate for timer synchronization.
- **v2.2.11**: **Login Fix**: Fixed semantic version comparison logic in Auth module to correctly handle double-digit version numbers (e.g., 2.2.10 > 2.2.6).
- **v2.2.10**: **Vetting & Submission Fixes**: Fixed Vetting Arena counters not updating in real-time. Prevented "Already Submitted" errors by disabling the submit button immediately on click.
- **v2.2.9**: **Vetting & Assessment Fixes**: Added active server polling to Vetting Arena to ensure Admins see trainees even if Realtime connection drops. Fixed "Already Submitted" error by enforcing strict ID matching for assessments.
- **v2.2.8**: **Vetting Arena Stability**: Implemented "Safe Patch" logic for Vetting sessions to ensure real-time trainee visibility without data overwrites. Added process tolerance for Microsoft Teams/WebView2. Fixed submission success messages and hardened save logic.
- **v2.2.7**: **Vetting Arena Hardening**: Fixed Enforcer logic to ensure trainees are locked into the arena immediately upon login or refresh. Updated sync logic to write session data to both Table and Blob storage for immediate consistency. Fixed `window.supabaseClient` references in Live/Vetting modules.
- **v2.2.4**: **Mission Control & Vetting Enforcer**: Added `js/calendar.js` for unified event tracking (Schedules, Live Bookings, Admin Tasks). Implemented **Vetting Enforcer** to auto-redirect trainees to active exams. Added "Today's Tasks" dashboard widget.
- **v2.2.3**: **Sync Visibility & Fixes**: Added "Last Sync Time" columns to Admin Console. Fixed User Idle Timeout logic to respect custom overrides.
- **v2.2.2**: **Hotfix**: Resolved login lockout for Admins switching terminals.
- **v2.2.1**: **Storage Optimization**: Implemented lightweight checksums for sync, reducing local DB size by ~90%. Added automatic duplicate cleanup.
- **v2.2.0**: **Architectural Overhaul**: Migrated from Blob Storage to **Row-Level Sync** for high-volume data (Records, Submissions, Logs). Added **Emergency Lockdown** and **Data Patcher** tools.
- **v2.1.61**: **Header & Profile Polish**: Separated Profile Settings (Logo) and Admin Tools (Gear) in the header. Implemented robust injection logic for header buttons. Added "My Profile" shortcut in Admin User Management. Fixed Live Assessment booking visibility for admins.
- **v2.1.60**: **Visual & Accessibility**: **Zoom Control**: Added global UI Zoom slider in Theme Settings (50% - 150%). **Smooth Transitions**: Implemented CSS transitions for theme toggling to reduce visual jar. **Light Mode Polish**: Softened borders and text colors in Light Mode for better readability.
- **v2.1.59**: **Super Admin & AI Overhaul**: **Console 2.0**: Completely redesigned Super Admin Console with tabbed navigation (Overview, Config, Security, Data, AI). **Raw Data Inspector**: Added JSON editor for direct database manipulation with validation. **AI Analyst**: Dedicated chat interface for querying system data (`analyze_records`, `read_config`). **Study Monitor 2.0**: Implemented "Lenient Scoring" (tolerance for short interruptions), robust "Idle Detection" (60s timeout), and "Anti-Jiggle" logic to prevent false positives. **Vetting Arena**: Added "Waiting for Admin" pulse indicator and fixed idle detection to allow waiting in the arena without timeout. **Stability**: Added graceful error handling for cloud sync timeouts (500 errors) and optimistic UI updates for smoother admin interactions.
- **v2.1.58**: **Vetting Arena Stability & Security**: **Flicker-Free Monitor**: Implemented smart DOM patching in the Admin Monitor to eliminate UI refreshing artifacts. **Group Isolation**: Fixed logic to strictly filter trainees by the selected target group. **Session Locking**: Trainees now remain locked in Kiosk Mode after submission until the Admin ends the session. **Auto-Retake**: Pushing a test in the Arena now automatically archives previous attempts, preventing "Already Submitted" errors. **Sync Protection**: Hardened `js/data.js` to prevent background syncs from overwriting local answers during active tests.
- **v2.1.57**: **Live Assessment Overhaul**: Implemented **Multi-Group Live Schedules**, allowing Admins to manage separate booking calendars for different cohorts. Added dynamic slot configuration and roster assignment for Live Assessments. **System Stability**: Fixed Factory Reset logic to correctly target the new Split Schema (`app_documents`) and ensure clean state restoration.
- **v2.1.56**: **Assessment Engine & Visuals**: **Robust Deduplication**: Overhauled Assessment Record creation logic to support "Retraining" scenarios (same user/test in different groups) and implemented case-insensitive matching to prevent duplicates. **Visual Polish**: Added auto-generated Avatars to all Assessment tables (Reporting, History, Marking Queue). Replaced plain text statuses with color-coded badges. **Data Integrity**: Enhanced `submissions` sync logic to prevent "ghost" duplicates on legacy data.
- **v2.1.55**: **Agent Profile & Search Overhaul**: **Structured Notes**: Upgraded Agent Notes from simple text to a chronological history with timestamps and authors. **Interactive Records**: Added "View" buttons to assessment tables for direct access to digital submissions. **UX Redesign**: Complete visual overhaul of the Agent Profile with generated Avatars, Key Metrics (Risk, Attendance, Avg Score), and a modern dashboard layout. **Deep Linking**: Added URL support (`?agent=Name`) for direct profile sharing. **Fixes**: Resolved `performSmartMerge` crash on partial syncs and fixed search autocomplete binding.
- **v2.1.54**: **Insight Dashboard Optimization**: **Performance**: Implemented Hash Map pre-indexing to reduce rendering complexity from $O(N \times M)$ to $O(N)$, drastically improving load times for large rosters. **UX**: Added Real-Time Search, Avatar generation, and a new "Pending" status for new hires (fixing false "Pass" positives). **Logic**: Centralized compliance logic and optimized cloud syncing for the Insight module.
- **v2.1.53**: **Dashboard Visual Overhaul**: Implemented "Glassmorphism" UI for dashboard widgets. Added "Hero Widget" style for Trainee "Up Next" card. Improved hover effects and interactivity for all cards. Added "Badge Grid" styling.
- **v2.1.52**: **Performance & Logic Optimization**: **System Health**: Optimized Supabase queries in `js/data.js` and `js/dashboard.js` to select specific columns, reducing bandwidth usage. **Network**: Replaced aggressive external pings with browser-native `navigator.connection` API for connectivity checks. **Attendance**: Updated logic to correctly respect the `allow_weekend_login` configuration setting.
- **v2.1.51**: **Core Logic & Admin Enhancements**: Added **Attendance Editing** (Ignore/Edit Lates), **Active Schedule Filter**, and fixed "Absent" record handling. Enhanced **Super Admin Permissions** for Test Engine & Vetting. Implemented **Robust Heartbeat** (Schema Fallback) for Active Users list. Added **Local Network Ping** for system health. Fixed **AI Co-Pilot** initialization and "Analyzing..." states. **Hotfixes**: Resolved Supabase 400 errors and Attendance Modal Z-Index issues.
- **v2.1.50**: **Stability & Access Fixes**: Resolved login visibility for retrained agents (previously graduated). Added **Clear Cache** utility for login loops. Enabled **SSO/Windows Integrated Auth** for seamless SharePoint access in Study Monitor. Fixed SharePoint link corruption issues.
- **v2.1.49**: **AI Co-Pilot Integration**: Added **Gemini System Analyst** for Super Admins. Features include natural language system queries, automated error analysis, self-repair tools, **Background Improvement Suggestions**, and **Full Log Export**. Enhanced Super Admin console with quick actions and deep system visibility.
- **v2.1.48**: **System Hardening**: Enhanced Backup & Restore tools to include full system configuration, metadata, and local settings. Improved Factory Reset to cover all new security schemas. Fixed SharePoint display issues in Study Monitor.
- **v2.1.47**: **Super Admin & System Control**: Introduced `super_admin` role with a dedicated console (`Ctrl+Shift+S`). Added dynamic **System Configuration** (Sync rates, Attendance rules, Feature flags). Implemented **Client Health Monitoring** with remote commands (Kick, Reload, Message) and **Instant Ban** button. Added **Banned Clients** list, **Client Whitelist** (Strict Mode), and **Audit Logging** for critical actions.
- **v2.1.46**: **Attendance Logic**: Enhanced reminder system. Trainees are now prompted to Clock In upon login until 16:00. Added a "Clock Out" monitor that triggers warnings from 16:45, culminating in a stern alert at 16:55 to ensure compliance before the 17:00 cutoff.
- **v2.1.45**: **Visual Overhaul**: Comprehensive UI/UX upgrade including glassmorphism login with particle effects, animated dashboard entry, and modern assessment interface. **Feedback Systems**: Added skeleton loaders, enhanced toast notifications, and dynamic activity monitor grid. **Polish**: Implemented smooth tab transitions, tactile button responses, and interactive table rows.
- **v2.1.44**: **Login Security**: Filtered out Graduated Agents from the Trainee Login list. **User Management**: Prevented system from regenerating accounts for archived graduates.
- **v2.1.43**: **Daily Tip Management**: Added Admin widget to customize tips. **Sync Hardening**: Removed conflict prompts, added retry logic, and improved nested merge. **Stability**: Fixed Trainee Dashboard crash.
- **v2.1.42**: **Reporting & Search Enhancements**: Added 'Date Graduated' to Agent Search profile. Improved Onboard Report auto-fill logic with fuzzy matching for assessment names.
- **v2.1.41**: **Archived Reports Fix**: Resolved issue where 'View Full Report' failed for graduated agents. Added archive lookup logic to the report viewer.
- **v2.1.40**: **Conflict Resolution System**: Added interactive modal for resolving data conflicts (Server vs Local) on critical keys.
- **v2.1.39**: **Sync Engine Overhaul**: Implemented 'Server-Wins' vs 'Local-Wins' merge strategies to fix data reversion bugs. Added **Auto-Recovery**, **Latency Testing**, and **Visual Sync Indicators** (Unsaved/Offline).
- **v2.1.38**: Added **Duplicate Cleanup Tool** in Admin Database. Fixed Assessment Viewer linking issues (ID-based lookup).
- **v2.1.37**: Fixed Agent Search crash on report data structure mismatch.
- **v2.1.36**: Added **Agent Note Saving** and fixed Agent Search crash.
- **v2.1.35**: Fixed **Activity Monitor Classification** persistence (Reviewed List).
- **v2.1.34**: Enhanced **Activity Monitor Robustness** (Idle detection, Data retention).
- **v2.1.32**: Implemented **Smart Merge** for Activity Monitor to prevent data loss.

## How to Run
1.  **Install Dependencies**: `npm install`
2.  **Run Dev**: `npm start`
3.  **Build**: `npm run publish` (Handles Electron Builder & GitHub Release)
