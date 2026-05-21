/* ================= SCHEDULE STUDIO LOADER ================= */

(function bootstrapScheduleStudioLoader() {
    if (typeof window.LegacyRenderSchedule !== 'function' && typeof window.renderSchedule === 'function') {
        window.LegacyRenderSchedule = window.renderSchedule;
    }

    const loader = {
        renderUI() {
            const container = document.getElementById('assessment-schedule');
            if (!container) return;

            const basePath = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
            const modulePath = `${basePath}/modules/schedule_studio/index.html?embedded=1`;

            if (!document.getElementById('schedule-studio-frame')) {
                container.innerHTML = `
                    <div class="embedded-program-shell">
                    <div class="embedded-program-header">
                        <div>
                            <div class="embedded-program-title"><i class="fas fa-layer-group"></i> Schedule Studio</div>
                            <div class="embedded-program-subtitle">The schedule timeline now runs inside its own isolated module.</div>
                        </div>
                        <div class="embedded-program-actions">
                            <button class="btn-secondary btn-sm" onclick="goWorkspaceHome()"><i class="fas fa-house"></i> Home</button>
                            <button class="btn-secondary btn-sm" onclick="ScheduleStudioLoader.refresh()"><i class="fas fa-rotate-right"></i> Refresh</button>
                        </div>
                    </div>
                    <iframe
                        id="schedule-studio-frame"
                        class="embedded-program-frame"
                        src="${modulePath}"
                        title="Schedule Studio"
                        onload="if (typeof applyThemeToEmbeddedFrame === 'function') applyThemeToEmbeddedFrame(this)"
                    ></iframe>
                    </div>
                `;
                return;
            }

            const frame = document.getElementById('schedule-studio-frame');
            if (typeof applyThemeToEmbeddedFrame === 'function') applyThemeToEmbeddedFrame(frame);
            try {
                if (frame.contentWindow && frame.contentWindow.App && typeof frame.contentWindow.App.refresh === 'function') {
                    frame.contentWindow.App.refresh({ forcePull: false });
                }
            } catch (error) {
                console.warn('[Schedule Studio Loader] Soft refresh bridge failed:', error);
            }
        },

        async refresh() {
            const frame = document.getElementById('schedule-studio-frame');
            if (!frame) return;

            // Fresh pull on-demand so Studio always opens with latest server state.
            if (typeof loadFromServer === 'function') {
                try {
                    await loadFromServer(true);
                } catch (error) {
                    console.warn('[Schedule Studio Loader] Host refresh pull failed:', error);
                }
            }

            try {
                if (typeof applyThemeToEmbeddedFrame === 'function') applyThemeToEmbeddedFrame(frame);
                if (frame.contentWindow && frame.contentWindow.App && typeof frame.contentWindow.App.refresh === 'function') {
                    frame.contentWindow.App.refresh({ forcePull: false });
                    return;
                }
            } catch (error) {
                console.warn('[Schedule Studio Loader] Refresh bridge failed:', error);
            }

            frame.src = frame.src;
        }
    };

    window.ScheduleStudioLoader = loader;
    window.renderSchedule = function renderScheduleModule() {
        loader.renderUI();
    };
})();
