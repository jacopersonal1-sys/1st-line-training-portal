/* ================= MODULE CONFIGURATION ================= */
/* Reads context passed from Main App via URL Parameters */

const AppContext = {
    user: null,
    supabase: null
};

const urlParams = new URLSearchParams(window.location.search);
const userStr = urlParams.get('user');
const credsStr = urlParams.get('creds');

try {
    // urlParams.get() already decodes the URI component. Double decoding throws URIError.
    if (userStr) AppContext.user = JSON.parse(userStr);
    
    if (credsStr && window.supabase) {
        const creds = JSON.parse(credsStr);
        if (creds.url && creds.key) AppContext.supabase = window.supabase.createClient(creds.url, creds.key);
    }
} catch (e) {
    console.error("Config Parsing Error:", e);
}