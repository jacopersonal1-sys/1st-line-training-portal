# 1st Line Training Portal (Cloud Edition)

## Project Overview
A comprehensive training and assessment platform built with Electron and Node.js, utilizing Supabase for real-time cloud synchronization. The application supports multiple user roles (Admin, Team Leader, Trainee) and features secure testing environments, live interactive assessments, and detailed reporting.

## Architecture
- **Frontend**: Vanilla JavaScript, HTML5, CSS3 (SPA architecture in `index.html`).
- **Backend/Runtime**: Electron (Desktop App), Node.js (Local Server for backups).
- **Database**: Supabase (Cloud), LocalStorage (Offline Cache/Optimistic UI).
- **Sync Engine**: Custom "Smart Split Sync" in `js/data.js` polling `app_documents` table.

## Key File Structure & Responsibilities

### Core
- `index.html`: Main entry point. Loads all scripts dynamically.
- `electron-main.js`: Main process. Handles window management, Kiosk mode (Vetting), and Auto-updates.
- `server.js`: Local Express server (Legacy/Backup purposes).
- `js/config.js`: Supabase configuration and global constants.
- `js/data.js`: The Sync Engine. Handles `loadFromServer` and `saveToServer`.
- `js/auth.js`: Authentication, Role management, IP Access Control.
- `js/main.js`: Application initialization and boot logic.

### Assessment Engine (Split Architecture)
*Refactored from monolithic `assessment.js` to prevent logic conflicts.*
- `js/assessment_core.js`: Shared helpers and rendering logic (e.g., `renderQuestionInput`).
- `js/assessment_admin.js`: Admin-specific logic (Dashboard, Marking Queue, Grading).
- `js/assessment_trainee.js`: Trainee-specific logic (Taking tests, Timer, Submission).
- `js/admin_builder.js`: Test Creator/Editor UI.

### Modules
- `js/live_execution.js`: Real-time "Live Arena" for interactive assessments between Trainer and Trainee.
- `js/vetting_arena.js`: High-security testing environment (Kiosk mode, process monitoring).
- `js/schedule.js`: Timeline and Calendar views for training schedules.
- `js/reporting.js`: A4 Report generation and Saved Reports.
- `js/insight.js`: Training Insight Dashboard (Progress tracking, Action Required).
- `js/attendance.js`: Clock-in/out system and Admin attendance register.
- `js/admin_users.js`: User management, Rosters, and Permissions.
- `js/admin_sys.js`: System settings, Database management, Access Control.
- `js/admin_history.js`: Historical view of completed assessments.

## User Roles
1.  **Admin**: Full access. Can manage users, build tests, grade assessments, and configure system settings.
2.  **Team Leader**: View-only access to reports, schedules, and agent progress. Can request links.
3.  **Trainee**: Restricted access. Can take assigned tests, view schedule, and check own results.
4.  **Special Viewer**: Read-only admin view (Audit mode).

## Critical Workflows
1.  **Sync**: Data is stored in LocalStorage and synced to Supabase. `saveToServer(true)` forces an overwrite (Instant Save), while `saveToServer(false)` performs a safe merge.
2.  **Vetting**: Trainees enter a locked-down "Arena". Electron IPC checks for secondary screens and forbidden apps.
3.  **Live Assessment**: Admin and Trainee connect via `live_execution.js`. Admin pushes questions in real-time; Trainee answers; Admin grades immediately.

## Recent Updates (Context for AI)
- **Assessment Logic Split**: The monolithic `assessment.js` was split into `_core`, `_admin`, and `_trainee` to separate concerns and fix duplication bugs.
- **Live Arena**: Polling logic optimized to prevent UI thrashing.
- **File Structure**: `index.html` now references the split assessment files and `admin_history.js`.

## How to Run
1.  **Install Dependencies**: `npm install`
2.  **Run Dev**: `npm start`
3.  **Build**: `npm run dist`

## Next Steps / Known State
- The assessment logic split is complete and verified in `index.html`.
- `assessment_trainee.js` has been cleaned of duplicate helper functions.
- `admin_history.js` and `attendance.js` are correctly linked.