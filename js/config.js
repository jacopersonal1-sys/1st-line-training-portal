/* ================= CONFIGURATION ================= */

// --- SUPABASE CONFIGURATION ---
// Critical: These keys connect the Electron app to the Cloud Database.

// 1. Define Available Servers
window.CLOUD_CREDENTIALS = {
    url: 'https://ukhgyvhqoijgetxzlzpy.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVraGd5dmhxb2lqZ2V0eHpsenB5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3Njg4MDQsImV4cCI6MjA4NTM0NDgwNH0.FONPTHcaicp7IAI47gwmic4frYM1ruitTSfNQT8vEf4'
};

// 2. Determine Active Server
let activeTarget = localStorage.getItem('active_server_target') || 'cloud';
const systemConfig = JSON.parse(localStorage.getItem('system_config') || '{}');
const localSettings = systemConfig.server_settings || {};

let SUPABASE_URL = window.CLOUD_CREDENTIALS.url;
let SUPABASE_ANON_KEY = window.CLOUD_CREDENTIALS.key;

if (activeTarget === 'local' && localSettings.local_url && localSettings.local_key) {
    console.log("Using LOCAL Server Credentials");
    SUPABASE_URL = localSettings.local_url;
    SUPABASE_ANON_KEY = localSettings.local_key;
} else {
    console.log("Using CLOUD Server Credentials");
}

// Initialize the Supabase Client
// We use 'window.supabaseClient' to avoid conflict with the library's global 'supabase' variable.
if (typeof window !== 'undefined' && window.supabase) {
    try {
        const options = {
            global: {
                headers: { 'ngrok-skip-browser-warning': 'true' }
            }
        };
        window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, options);
        console.log(`Supabase Client Initialized (${activeTarget.toUpperCase()}) -> ${SUPABASE_URL}`);
    } catch (e) {
        console.error("Supabase Initialization Failed:", e); 
        // FAILSAFE: If Local fails, revert to Cloud immediately
        // BYPASS: If 'force_local' is set, do not revert (Manual Override)
        if (activeTarget === 'local' && localStorage.getItem('force_local') !== 'true') {
            console.warn("Local Server Unreachable. Reverting to Cloud...");
            localStorage.setItem('active_server_target', 'cloud');
            sessionStorage.setItem('recovery_mode', 'true'); // Prevent immediate switch-back loop
            // Reload to apply
            setTimeout(() => location.reload(), 1000);
        }
    }
} else {
    window.supabaseClient = null;
    // We don't error here immediately to allow for local testing if needed,
    // but data.js will warn if it tries to use it.
    console.error("Supabase Library not found. Check internet connection.");
    // Alert the user if they are likely offline on startup
    if(document.readyState === 'complete') {
        alert("Warning: Could not connect to Cloud Database library.\nCheck your internet connection and restart the app.");
    }
}

// Scoring Constants
const PASS = 90;
const IMPROVE = 60;

// Booking Time Slots
const TIME_SLOTS = ["1:00 PM", "2:00 PM", "3:00 PM", "4:00 PM"];

// Global State
let CURRENT_USER = null;
let LOGIN_MODE = 'admin'; 
let AUTO_BACKUP = false; 

// System Status & Heartbeat Constants
const HEARTBEAT_INTERVAL = 15000; 
const IDLE_THRESHOLD = 60000;       
const LOGOUT_THRESHOLD = 10 * 60 * 1000; // 10 Minutes

// --- NODE.JS / ELECTRON COMPATIBILITY ---
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { 
        PASS, IMPROVE, TIME_SLOTS, 
        HEARTBEAT_INTERVAL, IDLE_THRESHOLD 
    };
} else {
    console.log("Configuration Loaded (Browser Mode)");
}

// --- DEFAULTS ---
// MODIFIED: Defaults removed to allow for dynamic creation/editing via Admin Panel.
// This prevents hardcoded defaults from reappearing after a user deletes them.

const DEFAULT_ASSESSMENTS = [];

const DEFAULT_VETTING_TOPICS = [];

const DEFAULT_SCHEDULE = [];

// --- INSIGHT TAB CONFIGURATION ---
// Used by insight.js to flag specific failures as Critical/Semi-Critical
const INSIGHT_CONFIG = {
    CRITICAL: [
        "Radius", "Core", "Terms"
    ],
    SEMI_CRITICAL: [
        "VoIP", "Email"
    ]
};

// --- DYNAMIC CONFIGURATION DEFAULTS ---
const DEFAULT_FORBIDDEN_APPS = [
    'chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'safari', 
    'waterfox', 'tor', 'duckduckgo', 'maxthon', 'seamonkey', 'avast', 'yandex',
    'whatsapp', 'discord', 'slack', 'teams'
];

const SUPPORT_EMAILS = {
    TO: "systemsupport@herotel.com",
    CC: "darren.tupper@herotel.com,jaco.prince@herotel.com,soanette.wilken@herotel.com"
};