/* ================= Q&A HUB MODULE CONFIG ================= */
const AppContext = {
    user: null,
    supabase: null,
    host: null
};

const params = new URLSearchParams(window.location.search);
const userStr = params.get('user');
const credsStr = params.get('creds');

try {
    if (window.parent && window.parent !== window && window.parent.QAHub) {
        AppContext.host = window.parent;
    }
} catch (error) {
    console.warn('[Q&A Hub] Host bridge unavailable:', error);
}

if (userStr) {
    try {
        AppContext.user = JSON.parse(decodeURIComponent(userStr));
    } catch (error) {
        console.warn('[Q&A Hub] Failed to parse user context:', error);
    }
}

if (credsStr && window.supabase) {
    try {
        const creds = JSON.parse(decodeURIComponent(credsStr));
        if (creds && creds.url && creds.key) {
            AppContext.supabase = window.supabase.createClient(creds.url, creds.key);
        }
    } catch (error) {
        console.warn('[Q&A Hub] Failed to parse Supabase credentials:', error);
    }
}
