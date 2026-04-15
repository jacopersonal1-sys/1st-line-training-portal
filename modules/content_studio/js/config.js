/* ================= CONTENT STUDIO CONFIG ================= */

const AppContext = {
    user: null,
    supabase: null
};

const params = new URLSearchParams(window.location.search);
const userStr = params.get('user');
const credsStr = params.get('creds');

if (userStr) {
    try {
        AppContext.user = JSON.parse(decodeURIComponent(userStr));
    } catch (err) {
        console.warn('[Content Studio] Failed to parse user context:', err);
    }
}

if (credsStr && window.supabase) {
    try {
        const creds = JSON.parse(decodeURIComponent(credsStr));
        if (creds && creds.url && creds.key) {
            AppContext.supabase = window.supabase.createClient(creds.url, creds.key);
        }
    } catch (err) {
        console.warn('[Content Studio] Failed to parse Supabase credentials:', err);
    }
}
