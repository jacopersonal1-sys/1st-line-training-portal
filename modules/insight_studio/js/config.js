/* ================= INSIGHT MODULE CONFIG ================= */

const AppContext = {
    user: null,
    supabase: null
};

(function hydrateContext() {
    const params = new URLSearchParams(window.location.search);
    const userStr = params.get('user');
    const credsStr = params.get('creds');

    if (userStr) {
        try {
            AppContext.user = JSON.parse(decodeURIComponent(userStr));
        } catch (error) {
            console.warn('[Insight Module] Failed to parse user context:', error);
        }
    }

    if (credsStr && window.supabase) {
        try {
            const creds = JSON.parse(decodeURIComponent(credsStr));
            if (creds && creds.url && creds.key) {
                AppContext.supabase = window.supabase.createClient(creds.url, creds.key);
            }
        } catch (error) {
            console.warn('[Insight Module] Failed to parse Supabase credentials:', error);
        }
    }
})();
