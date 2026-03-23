/* ================= CONFIGURATION ================= */

// --- SUPABASE CONFIGURATION ---
// Critical: These keys connect the Electron app to the Cloud Database.

// 1. Define Available Servers
window.CLOUD_CREDENTIALS = {
    url: 'https://ukhgyvhqoijgetxzlzpy.supabase.co',
    key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVraGd5dmhxb2lqZ2V0eHpsenB5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk3Njg4MDQsImV4cCI6MjA4NTM0NDgwNH0.FONPTHcaicp7IAI47gwmic4frYM1ruitTSfNQT8vEf4'
};

// --- NEW: DYNAMIC CLIENT INITIALIZATION ---
window.initSupabaseClient = function() {
    // CLOUD DEAD OVERRIDE: Force all clients to default to Local
    localStorage.setItem('active_server_target', 'local');

    let activeTarget = localStorage.getItem('active_server_target') || 'cloud';
    const systemConfig = JSON.parse(localStorage.getItem('system_config') || '{}');
    const localSettings = systemConfig.server_settings || {};

    // CLOUD DEAD OVERRIDE: Mutate the CLOUD_CREDENTIALS to point to the Local VM
    // This prevents any residual background services (like the Admin Tester) from pinging the dead cloud.
    if (localSettings.local_url && localSettings.local_key) {
        window.CLOUD_CREDENTIALS.url = localSettings.local_url;
        window.CLOUD_CREDENTIALS.key = localSettings.local_key;
    }

    let SUPABASE_URL = window.CLOUD_CREDENTIALS.url;
    let SUPABASE_ANON_KEY = window.CLOUD_CREDENTIALS.key;

    const stagingCreds = JSON.parse(localStorage.getItem('staging_credentials') || '{}');

    if (activeTarget === 'staging' && stagingCreds.url && stagingCreds.key) {
        console.log("Using STAGING Server Credentials");
        SUPABASE_URL = stagingCreds.url;
        if (!SUPABASE_URL.match(/^https?:\/\//)) SUPABASE_URL = 'http://' + SUPABASE_URL;
        SUPABASE_ANON_KEY = stagingCreds.key;
    } else if (activeTarget === 'local' && localSettings.local_url && localSettings.local_key) {
        console.log("Using LOCAL Server Credentials");
        SUPABASE_URL = localSettings.local_url;
        if (!SUPABASE_URL.match(/^https?:\/\//)) SUPABASE_URL = 'http://' + SUPABASE_URL;
        SUPABASE_ANON_KEY = localSettings.local_key;
    } else {
        console.log("Using CLOUD Server Credentials");
    }

    if (typeof window !== 'undefined' && window.supabase) {
        try {
            const options = { global: { headers: { 'ngrok-skip-browser-warning': 'true' } } };
            window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, options);
            console.log(`Supabase Client Initialized (${activeTarget.toUpperCase()}) -> ${SUPABASE_URL}`);
        } catch (e) {
            console.error("Supabase Initialization Failed:", e); 
            if (activeTarget === 'local' && localStorage.getItem('force_local') !== 'true') {
                console.warn("Local Server Unreachable. Silently reverting to Cloud...");
                localStorage.setItem('active_server_target', 'cloud');
                sessionStorage.setItem('recovery_mode', 'true');
                if (typeof performSilentServerSwitch === 'function') {
                    performSilentServerSwitch('cloud');
                } else {
                    setTimeout(() => location.reload(), 1000);
                }
            }
        }
    } else {
        window.supabaseClient = null;
        console.error("Supabase Library not found. Check internet connection.");
    }
};

// Boot client immediately
window.initSupabaseClient();

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