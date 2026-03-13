/* ================= MODULE CONFIGURATION ================= */
/* Reads context passed from Main App via URL Parameters */

const AppContext = {
    user: null,
    supabase: null
};

// Parse URL Params
const urlParams = new URLSearchParams(window.location.search);
const userStr = urlParams.get('user');
const credsStr = urlParams.get('creds');

if (userStr) {
    AppContext.user = JSON.parse(decodeURIComponent(userStr));
}

if (credsStr && window.supabase) {
    const creds = JSON.parse(decodeURIComponent(credsStr));
    if (creds.url && creds.key) {
        AppContext.supabase = window.supabase.createClient(creds.url, creds.key);
    }
}