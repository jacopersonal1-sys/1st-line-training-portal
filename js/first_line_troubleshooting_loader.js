/* ================= FIRST LINE TROUBLESHOOTING TOOL LOADER ================= */

function canAccessFirstLineTroubleshootingTool() {
    const user = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) ? CURRENT_USER : null;
    if (!user || String(user.role || '').trim().toLowerCase() !== 'super_admin') return false;
    const rawName = String(user.user || user.username || user.name || '').trim().toLowerCase();
    const localPart = rawName.split('@')[0] || rawName;
    const compact = localPart.replace(/[^a-z0-9]/g, '');
    return compact === 'jaco' || compact === 'jacoprince';
}

const FirstLineTroubleshootingLoader = {
    renderUI: function() {
        const container = document.getElementById('first-line-troubleshooting-content');
        if (!container) return;

        if (!canAccessFirstLineTroubleshootingTool()) {
            container.innerHTML = `
                <div class="card" style="max-width:760px; margin:24px auto; text-align:center; border-color:#ff5252;">
                    <h3 style="color:#ff5252; margin-bottom:8px;">Access Denied</h3>
                    <p style="color:var(--text-muted); margin:0;">This troubleshooting workspace is restricted to Jaco's Super Admin account.</p>
                </div>
            `;
            return;
        }

        const basePath = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
        const modulePath = `${basePath}/modules/first_line_troubleshooting/index.html`;
        container.innerHTML = `
            <iframe
                id="first-line-troubleshooting-frame"
                src="${modulePath}"
                title="First Line Troubleshooting Tool"
                style="width:100%; height:calc(100vh - 145px); border:none; background:transparent;"
            ></iframe>
        `;

        const frame = document.getElementById('first-line-troubleshooting-frame');
        if (frame) {
            frame.addEventListener('load', () => {
                if (typeof applyThemeToEmbeddedFrame === 'function') applyThemeToEmbeddedFrame(frame);
            });
        }
    },

    refresh: function() {
        const frame = document.getElementById('first-line-troubleshooting-frame');
        if (frame && frame.contentWindow) {
            frame.contentWindow.location.reload();
            return;
        }
        this.renderUI();
    }
};

window.canAccessFirstLineTroubleshootingTool = canAccessFirstLineTroubleshootingTool;
window.FirstLineTroubleshootingLoader = FirstLineTroubleshootingLoader;
