const AppContext = {
    user: null,
    supabase: null,
    authorized: false
};

(function bootstrapContext() {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const userStr = urlParams.get('user');
        const credsStr = urlParams.get('creds');

        if (userStr) {
            AppContext.user = JSON.parse(decodeURIComponent(userStr));
        }

        if (credsStr && window.supabase) {
            const creds = JSON.parse(decodeURIComponent(credsStr));
            if (creds.url && creds.key) {
                AppContext.supabase = window.supabase.createClient(creds.url, creds.key, {
                    auth: {
                        persistSession: false,
                        autoRefreshToken: false
                    }
                });
            }
        }
    } catch (error) {
        console.error("[Data Studio] Failed to initialize context:", error);
    }

    AppContext.authorized = Boolean(
        AppContext.user &&
        AppContext.user.role === 'super_admin' &&
        AppContext.supabase
    );
})();
