# 1st Line Training Portal (Cloud Edition)

## Project Overview
A comprehensive, "Thick Client" training and assessment platform built with **Electron** and **Vanilla JavaScript**, utilizing **Supabase** for real-time cloud synchronization. The application follows a **Local-First / Optimistic UI** architecture where `localStorage` is the immediate source of truth, synchronized asynchronously with the cloud.

It supports multiple user roles (Admin, Team Leader, Trainee, Special Viewer) and features secure testing environments (Vetting Arena), live interactive assessments, productivity monitoring, and detailed reporting.

## Architecture
- **Frontend**: Vanilla JavaScript, HTML5, CSS3 (SPA architecture loaded via `index.html`).
- **Runtime**: Electron (Main Process handles Node integration, Kiosk Mode, Auto-Updates).
- **Database**: 
  - **Local**: `localStorage` (Primary read/write layer).
  - **Cloud**: Supabase (`app_documents` table for JSON blobs, `sessions` for heartbeat).
- **Sync Engine**: Custom "Smart Split Sync" (`js/data.js`).
  - **Logic**: Merges local changes with server data field-by-field to prevent overwrites.
  - **Conflict Resolution**: Server timestamp wins unless specific "User-Specific" merge logic applies (e.g., Activity Monitor).

## Key File Structure & Responsibilities

### Core
- **`index.html`**: Main entry point. Loads all scripts dynamically based on availability.
- **`electron-main.js`**: Main Process. Handles window management, Kiosk Mode (Vetting), Auto-Updates, and OS-level IPC (Process list, Screen count).
- **`js/data.js`**: **The Heart of the App.** Handles `loadFromServer` (Pull) and `saveToServer` (Push). Implements `performSmartMerge` to combine arrays/objects intelligently.
- **`js/auth.js`**: Authentication, Password Hashing (SHA-256), Role Management, and IP Access Control (CIDR checks).
- **`js/main.js`**: Boot sequence, Version checks, Session restoration, **Release Notes Popup**, Global Event Listeners, and **Theme Application**.
- **`js/utils.js`**: Shared utility functions for formatting and common helpers.
- **`js/forms.js`**: **First-Time Questionnaire** logic, Profile updates, and Assessment **Exemption** handling.

### Assessment Engine (Split Architecture)
*Refactored to separate concerns.*
- **`js/assessment_core.js`**: Shared rendering logic (`renderQuestionInput`), Answer persistence, and Reference Viewer.
- **`js/assessment_admin.js`**: Admin Dashboard, Marking Queue, Grading Logic, and Record Creation.
- **`js/assessment_trainee.js`**: Trainee Test Taker, Timer Logic, Draft Saving, and Submission.
- **`js/admin_builder.js`**: Test Creator UI with **Draft Saving**. Supports Rich Text, Matrix, Matching, Drag & Drop, and Live Practical types.
- **`js/admin_history.js`**: Historical view of completed assessments with Retake/Delete capabilities.
- **`js/admin_grading.js`**: Manual Score Capture interface and "Test Records" history view (aggregates digital & manual).

### Specialized Modules
- **`js/schedule.js`**: 
  - Manages Assessment Timeline and Calendar views.
  - Handles Live Assessment Booking logic (Slots, Conflicts, Cancellations).
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
  - "Action Required" logic for failing agents.
  - **Access Revocation**: Logic for blacklisting and removing users.
- **`js/attendance.js`**: 
  - Clock In/Out system with Late Reason capture.
  - Admin Register view.
const DEFAULT_SYSTEM_CONFIG = {
    // --- CORE PERFORMANCE (Your Request) ---
    sync_rates: {
        admin: 10000,      // 10s (High visibility)
        teamleader: 300000,// 5m (Low bandwidth)
        trainee: 60000     // 1m (Standard)
    },
    heartbeat_rates: {
        admin: 5000,       // 5s (Realtime monitoring)
        default: 60000     // 1m (Active status check)
    },
    idle_thresholds: {
        warning: 60000,    // 1m (When to show "Are you there?")
        logout: 900000     // 15m (Auto-logout duration)
    },

    // --- ATTENDANCE RULES (New Recommendation) ---
    attendance: {
        work_start: "08:00",
        late_cutoff: "08:15", // Grace period
        work_end: "17:00",
        reminder_start: "16:45", // When to start nagging to clock out
        allow_weekend_login: false
    },

    // --- SECURITY & ACCESS (New Recommendation) ---
    security: {
        maintenance_mode: false,      // If true, only Admins can login
        min_version: "2.1.46",        // Block login for outdated apps
        force_kiosk_global: false,    // EMERGENCY: Force everyone into Kiosk mode
        allowed_ips: []               // CIDR whitelist (e.g. Office IP only)
    },

    // --- FEATURE FLAGS (New Recommendation) ---
    // Turn modules on/off instantly if they break or aren't needed
    features: {
        vetting_arena: true,
        live_assessments: true,
        nps_surveys: true,
        daily_tips: true
    },

    // --- MONITORING TOLERANCE (New Recommendation) ---
    monitoring: {
        tolerance_ms: 180000,         // 3 mins (Time allowed in external apps before flagging)
        whitelist_strict: false       // If true, ANY non-whitelisted app is immediately flagged
    },

    // --- GLOBAL MESSAGING ---
    announcement: {
        active: false,
        message: "",                  // "System maintenance in 10 mins!"
        type: "info"                  // info, warning, error
    }
};
  - **Reminders**: "Clock In" prompt on login (until 4 PM) and "Clock Out" alerts (16:45 - 17:00) with a stern popup at 16:55.
- **`js/nps_system.js`**: 
  - Net Promoter Score surveys triggered by time or completion.
- **`js/analyticsDashboard.js`**: 
  - Visual rendering engine (`AnalyticsEngine`) for charts/graphs used in Insights and Agent Profiles.

### Admin & System
- **`js/admin_users.js`**: User CRUD, Roster Management, **Onboarding Email Automation**, and **Graduate/Restore** workflows.
- **`js/admin_sys.js`**: Database Management, System Health, **Super Admin Console**, **Remote Commands** (Kick/Ban), **Audit Logs**, and **System Configuration** (Hot Reload).
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
The app uses a **"Smart Split Sync"** with Conflict Resolution:
- **Load (Pull)**: `loadFromServer()` fetches metadata. Uses **`server_wins`** strategy to ensure updates from other admins are accepted.
- **Merge**: `performSmartMerge(server, local, strategy)` combines arrays/objects.
  - **Deduplication**: Case-insensitive matching for records to prevent duplicates.
- **Save (Push)**: `saveToServer(keys, force)` pushes local data.
  - Uses **`local_wins`** strategy to preserve local edits.
  - **Timestamping**: Uses authoritative Server Time from Supabase to prevent sync loops.
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