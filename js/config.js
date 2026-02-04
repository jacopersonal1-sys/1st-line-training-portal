/* ================= CONFIGURATION ================= */

// --- SUPABASE CONFIGURATION ---
// Critical: These keys connect the Electron app to the Cloud Database.
const SUPABASE_URL = 'https://ukhgyvhqoijgetxzlzpy.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_kqWhx44NM-nAWrWI3j3bIw_hSyCLKz6';

// Initialize the Supabase Client
// We use 'window.supabaseClient' to avoid conflict with the library's global 'supabase' variable.
if (typeof window !== 'undefined' && window.supabase) {
    try {
        window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log("Supabase Client Initialized.");
    } catch (e) {
        console.error("Supabase Initialization Failed:", e);
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
const LOGOUT_THRESHOLD = 20 * 60 * 1000; // 20 Minutes

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