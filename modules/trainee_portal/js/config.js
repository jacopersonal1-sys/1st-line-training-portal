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
            '--primary-hover',
            '--primary-soft',
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
            '--transition',
            '--oneui-layer-0',
            '--oneui-layer-1',
            '--oneui-layer-2',
            '--oneui-layer-3',
            '--oneui-green',
            '--oneui-red',
            '--oneui-amber',
            '--oneui-shadow-soft',
            '--oneui-shadow-float'
        ];

        varsToMirror.forEach((name) => {
            const value = hostStyle.getPropertyValue(name);
            if (value && value.trim()) {
                localRoot.style.setProperty(name, value.trim());
            }
        });

        const hostBody = AppContext.host.document.body;
        document.body.classList.toggle('theme-one-ui', hostBody && hostBody.classList.contains('theme-one-ui'));
        document.body.classList.toggle('light-mode', hostBody && hostBody.classList.contains('light-mode'));
        document.body.classList.toggle('exp-theme-active', hostBody && hostBody.classList.contains('exp-theme-active'));
    } catch (error) {
        console.warn('[Trainee Portal] Theme sync failed:', error);
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
        console.warn('[Trainee Portal] Parent bridge unavailable:', error);
    }

    if (AppContext.host && AppContext.host.CURRENT_USER) {
        AppContext.user = AppContext.host.CURRENT_USER;
    } else {
        const userStr = params.get('user');
        if (userStr) {
            try {
                AppContext.user = JSON.parse(decodeURIComponent(userStr));
            } catch (error) {}
        }
    }

    syncThemeFromHost();
})();
