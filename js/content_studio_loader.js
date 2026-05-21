/* ================= CONTENT CREATOR LOADER ================= */
/* HOST LOADER: Launches the isolated Content Creator module */

const ContentStudioLoader = {
    _windowMessageBound: false,

    launchLinkedQuiz: function(payload) {
        const testId = payload && payload.testId ? String(payload.testId) : '';
        if (!testId) return;

        const tests = (typeof safeLocalParse === 'function')
            ? safeLocalParse('tests', [])
            : (() => {
                try {
                    const raw = localStorage.getItem('tests');
                    if (!raw || raw === 'undefined' || raw === 'null') return [];
                    const parsed = JSON.parse(raw);
                    return Array.isArray(parsed) ? parsed : [];
                } catch (error) {
                    console.warn('Content Studio ignored invalid local tests data:', error);
                    return [];
                }
            })();
        const linked = tests.find(t => String(t.id) === testId);
        if (!linked) {
            if (typeof showToast === 'function') showToast('Linked quiz test was not found in Test Engine.', 'warning');
            return;
        }

        if (typeof openTestTaker === 'function') {
            openTestTaker(testId, true, {
                popupMode: true,
                returnTab: 'content-studio',
                source: 'content-studio-webview',
                contentStudioContext: {
                    source: 'content_studio',
                    launchSurface: 'content_creator_view',
                    entryId: payload && payload.entryId ? String(payload.entryId) : '',
                    subjectId: payload && payload.subjectId ? String(payload.subjectId) : '',
                    subjectCode: payload && payload.subjectCode ? String(payload.subjectCode) : '',
                    subjectTitle: payload && payload.subjectTitle ? String(payload.subjectTitle) : '',
                    testId: testId,
                    testTitle: linked.title || ''
                }
            });
        } else if (typeof showToast === 'function') {
            showToast('Quiz launcher is unavailable in this runtime.', 'error');
        }
    },

    bindWindowMessageBridge: function() {
        if (this._windowMessageBound) return;
        this._windowMessageBound = true;
        window.addEventListener('message', (event) => {
            const data = event && event.data ? event.data : null;
            if (!data || data.type !== 'content-studio-open-quiz') return;
            this.launchLinkedQuiz(data.payload || null);
        });
    },

    renderUI: function() {
        const container = document.getElementById('content-studio-content');
        if (!container) {
            console.error('[Content Creator Loader] Container not found.');
            return;
        }

        if (!CURRENT_USER) {
            container.innerHTML = `
                <div class="card" style="max-width:760px; margin:24px auto; text-align:center; border-color:#ff5252;">
                    <h3 style="color:#ff5252; margin-bottom:8px;">Session Required</h3>
                    <p style="color:var(--text-muted); margin:0;">Please sign in to open Content Creator.</p>
                </div>
            `;
            return;
        }

        const role = String(CURRENT_USER.role || '').trim().toLowerCase();
        if (!['admin', 'super_admin'].includes(role)) {
            container.innerHTML = `
                <div class="card" style="max-width:760px; margin:24px auto; text-align:center; border-color:#ff5252;">
                    <h3 style="color:#ff5252; margin-bottom:8px;">Access Denied</h3>
                    <p style="color:var(--text-muted); margin:0;">Content Creator is available to Admin and Super Admin only.</p>
                </div>
            `;
            return;
        }

        const userStr = typeof CURRENT_USER !== 'undefined' ? JSON.stringify(CURRENT_USER) : '{}';
        const credsStr = (window.CLOUD_CREDENTIALS) ? JSON.stringify(window.CLOUD_CREDENTIALS) : '{}';
        const userParam = encodeURIComponent(userStr);
        const credsParam = encodeURIComponent(credsStr);

        const basePath = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
        const modulePath = basePath + '/modules/content_studio/index.html';

        container.innerHTML = `
            <div class="embedded-program-shell">
            <div class="embedded-program-header">
                <div>
                    <div class="embedded-program-title"><i class="fas fa-photo-film"></i> Content Creator</div>
                    <div class="embedded-program-subtitle">Learning content authoring in an isolated workspace.</div>
                </div>
                <div class="embedded-program-actions">
                    <button class="btn-secondary btn-sm" onclick="goWorkspaceHome()"><i class="fas fa-house"></i> Home</button>
                    <button class="btn-secondary btn-sm" onclick="ContentStudioLoader.renderUI()"><i class="fas fa-rotate-right"></i> Refresh</button>
                </div>
            </div>
            <webview
                id="content-studio-webview"
                class="embedded-program-frame"
                src="${modulePath}?user=${userParam}&creds=${credsParam}"
                style="height:calc(100vh - 230px);"
                nodeintegration
                webpreferences="nodeIntegration=yes, contextIsolation=no"
                partition="persist:content_studio"
                allowpopups
            ></webview>
            </div>
        `;

        const webview = document.getElementById('content-studio-webview');
        if (!webview) return;

        webview.addEventListener('dom-ready', () => {
            if (typeof applyThemeToWebview === 'function') applyThemeToWebview(webview);
        });

        webview.addEventListener('ipc-message', (event) => {
            if (!event || event.channel !== 'content-studio-open-quiz') return;
            const payload = Array.isArray(event.args) ? event.args[0] : null;
            this.launchLinkedQuiz(payload);
        });

        this.bindWindowMessageBridge();
    }
};

window.ContentStudioLoader = ContentStudioLoader;
