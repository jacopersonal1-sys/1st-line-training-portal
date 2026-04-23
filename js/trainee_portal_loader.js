/* ================= TRAINEE PORTAL LOADER ================= */
const TraineePortalLoader = {
    _lastHardReloadAt: 0,

    stopAutoRefresh() {
        const frame = document.getElementById('trainee-portal-frame');
        if (!frame) return;
        try {
            if (frame.contentWindow && frame.contentWindow.TraineePortalApp && typeof frame.contentWindow.TraineePortalApp.stopAutoRefresh === 'function') {
                frame.contentWindow.TraineePortalApp.stopAutoRefresh();
            }
        } catch (error) {
            console.warn('[Trainee Portal Loader] Stop auto-refresh bridge failed:', error);
        }
    },

    startAutoRefresh() {
        const frame = document.getElementById('trainee-portal-frame');
        if (!frame || frame.dataset.ready !== '1') return;
        try {
            if (frame.contentWindow && frame.contentWindow.TraineePortalApp && typeof frame.contentWindow.TraineePortalApp.startAutoRefresh === 'function') {
                frame.contentWindow.TraineePortalApp.startAutoRefresh();
            }
        } catch (error) {
            console.warn('[Trainee Portal Loader] Start auto-refresh bridge failed:', error);
        }
    },

    onFrameLoad() {
        const frame = document.getElementById('trainee-portal-frame');
        if (!frame) return;
        frame.dataset.ready = '1';
        this.startAutoRefresh();
    },

    renderUI() {
        const container = document.getElementById('trainee-portal-content');
        if (!container) return;

        const basePath = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
        const modulePath = `${basePath}/modules/trainee_portal/index.html?embedded=1`;

        if (!document.getElementById('trainee-portal-frame')) {
            container.innerHTML = `
                <iframe
                    id="trainee-portal-frame"
                    src="${modulePath}"
                    title="Trainee Portal"
                    onload="TraineePortalLoader.onFrameLoad()"
                    style="width:100%; height:calc(100vh - 190px); border:none; border-radius:14px; background:var(--bg-card); box-shadow:0 10px 30px rgba(0,0,0,0.2);"
                ></iframe>
            `;
            return;
        }

        this.refresh(false);
    },

    async refresh(forcePull = false) {
        const frame = document.getElementById('trainee-portal-frame');
        if (!frame) return;
        if (frame.dataset.ready !== '1') return;

        if (forcePull && typeof loadFromServer === 'function') {
            try {
                await loadFromServer(true);
            } catch (error) {
                console.warn('[Trainee Portal Loader] Host force pull failed:', error);
            }
        }

        try {
            if (frame.contentWindow && frame.contentWindow.TraineePortalApp && typeof frame.contentWindow.TraineePortalApp.refresh === 'function') {
                await frame.contentWindow.TraineePortalApp.refresh({ forcePull: false });
                return;
            }
        } catch (error) {
            console.warn('[Trainee Portal Loader] Refresh bridge failed:', error);
        }

        const now = Date.now();
        if ((now - this._lastHardReloadAt) > 5000) {
            this._lastHardReloadAt = now;
            frame.dataset.ready = '0';
            frame.src = frame.src;
        }
    }
};

window.TraineePortalLoader = TraineePortalLoader;
