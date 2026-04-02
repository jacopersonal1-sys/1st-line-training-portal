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
                    <div style="background:var(--bg-input); padding:10px 14px; border-radius:10px; margin-bottom:14px; border:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center; gap:12px;">
                        <div>
                            <strong style="color:var(--primary);"><i class="fas fa-layer-group"></i> Schedule Studio</strong>
                            <div style="font-size:0.85rem; color:var(--text-muted); margin-top:4px;">The schedule timeline now runs inside its own isolated module.</div>
                        </div>
                        <button class="btn-secondary btn-sm" onclick="ScheduleStudioLoader.refresh()"><i class="fas fa-rotate-right"></i> Refresh</button>
                    </div>
                    <iframe
                        id="schedule-studio-frame"
                        src="${modulePath}"
                        title="Schedule Studio"
                        style="width:100%; height:calc(100vh - 230px); border:none; border-radius:14px; background:var(--bg-card); box-shadow:0 10px 30px rgba(0,0,0,0.2);"
                    ></iframe>
                `;
                return;
            }

            this.refresh();
        },

        refresh() {
            const frame = document.getElementById('schedule-studio-frame');
            if (!frame) return;

            try {
                if (frame.contentWindow && frame.contentWindow.App && typeof frame.contentWindow.App.refresh === 'function') {
                    frame.contentWindow.App.refresh();
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
