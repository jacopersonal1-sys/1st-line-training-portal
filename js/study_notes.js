/* ================= STUDY NOTES LOADER ================= */
const StudyNotesWorkspace = {
    _lastHardReloadAt: 0,

    stopAutoRefresh() {
        const frame = document.getElementById('study-notes-frame');
        if (!frame) return;
        try {
            if (frame.contentWindow && frame.contentWindow.StudyNotesWorkspace && typeof frame.contentWindow.StudyNotesWorkspace.stopAutoRefresh === 'function') {
                frame.contentWindow.StudyNotesWorkspace.stopAutoRefresh();
            }
        } catch (error) {
            console.warn('[Study Notes Loader] Stop auto-refresh bridge failed:', error);
        }
    },

    startAutoRefresh() {
        // Notes workspace is event-driven; no loader timer is required.
    },

    onFrameLoad() {
        const frame = document.getElementById('study-notes-frame');
        if (!frame) return;
        frame.dataset.ready = '1';
        if (typeof applyThemeToEmbeddedFrame === 'function') applyThemeToEmbeddedFrame(frame);
    },

    renderUI() {
        const container = document.getElementById('study-notes-workspace');
        if (!container) return;

        const basePath = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
        const modulePath = `${basePath}/modules/study_notes/index.html?embedded=1`;

        if (!document.getElementById('study-notes-frame')) {
            container.innerHTML = `
                <div style="background:var(--bg-input); padding:10px 14px; border-radius:10px; margin-bottom:14px; border:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center; gap:12px;">
                    <div>
                        <strong style="color:var(--primary);"><i class="fas fa-layer-group"></i> Study Notes Workspace</strong>
                        <div style="font-size:0.85rem; color:var(--text-muted); margin-top:4px;">Isolated notes module with sections, pages, and clarity-mark linking.</div>
                    </div>
                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                        <button class="btn-secondary btn-sm" onclick="showTab('trainee-portal')"><i class="fas fa-house"></i> Home</button>
                        <button class="btn-secondary btn-sm" onclick="openStudyNotesAssist('popup')"><i class="fas fa-up-right-from-square"></i> Pop Out</button>
                    </div>
                </div>
                <iframe
                    id="study-notes-frame"
                    src="${modulePath}"
                    title="Study Notes"
                    onload="StudyNotesWorkspace.onFrameLoad()"
                    style="width:100%; height:calc(100vh - 230px); border:none; border-radius:14px; background:var(--bg-card); box-shadow:0 10px 30px rgba(0,0,0,0.2);"
                ></iframe>
            `;
            return;
        }

        // Keep the iframe mounted. Study Notes are local-only and should not refresh while a trainee is typing.
    },

    async refresh(forcePull = false) {
        const frame = document.getElementById('study-notes-frame');
        if (!frame) return;
        if (frame.dataset.ready !== '1') return;
        // Intentionally no-op: refreshing the notes iframe can move the user's cursor or active page.
    }
};

window.StudyNotesWorkspace = StudyNotesWorkspace;
