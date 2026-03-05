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
- **`js/vetting_arena.js` (Security)**: 
  - High-security testing environment.
  - Uses Electron IPC to enforce Kiosk Mode (Fullscreen, No Exit).
  - Monitors background processes (`get-process-list`) and screen count.
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

### 4. Vetting Arena (`js/vetting_arena.js`)
- **Pre-Flight**: Checks for 2nd monitor and forbidden apps (Teams, Discord, etc.).
- **Lockdown**: 
  - `ipcRenderer.invoke('set-kiosk-mode', true)`
  - `ipcRenderer.invoke('set-content-protection', true)`
- **Monitoring**: Admin sees a live table of all trainees in the arena, their status, and any security violations.
- **Enforcer**: Background process automatically redirects Trainees to the Arena when a session is active for their group.

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

## Recent Major Updates (AI Context)
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