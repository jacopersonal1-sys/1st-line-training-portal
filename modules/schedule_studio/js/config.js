const AppContext = {
    host: null,
    user: null,
    embedded: false
};

function syncThemeFromHost() {
    if (!AppContext.host || !AppContext.host.document) return;

    try {
        const hostRoot = AppContext.host.document.documentElement;
        const localRoot = document.documentElement;
        const hostStyle = AppContext.host.getComputedStyle(hostRoot);
        const varsToMirror = [
            '--primary',
            '--bg-app',
            '--bg-card',
            '--bg-input',
            '--bg-header',
            '--bg-hover',
            '--text-main',
            '--text-muted',
            '--border-color',
            '--border-radius',
            '--shadow-card',
            '--shadow-hover',
            '--transition'
        ];

        varsToMirror.forEach((name) => {
            const value = hostStyle.getPropertyValue(name);
            if (value && value.trim()) {
                localRoot.style.setProperty(name, value.trim());
            }
        });
    } catch (error) {
        console.warn('[Schedule Studio] Theme sync failed:', error);
    }
}

(function bootstrapContext() {
    const params = new URLSearchParams(window.location.search);
    AppContext.embedded = params.get('embedded') === '1';

    try {
        if (window.parent && window.parent !== window) {
            AppContext.host = window.parent;
        }
    } catch (error) {
        console.warn('[Schedule Studio] Parent bridge unavailable:', error);
    }

    if (AppContext.host && AppContext.host.CURRENT_USER) {
        AppContext.user = AppContext.host.CURRENT_USER;
    } else {
        const userStr = params.get('user');
        if (userStr) {
            AppContext.user = JSON.parse(decodeURIComponent(userStr));
        }
    }

    syncThemeFromHost();
})();
