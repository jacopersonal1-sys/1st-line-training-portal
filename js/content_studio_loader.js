/* ================= CONTENT CREATOR LOADER ================= */
/* HOST LOADER: Launches the isolated Content Creator module */

const ContentStudioLoader = {
    _windowMessageBound: false,

    launchLinkedQuiz: function(payload) {
        const testId = payload && payload.testId ? String(payload.testId) : '';
        if (!testId) return;

        const tests = JSON.parse(localStorage.getItem('tests') || '[]');
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
            <webview
                id="content-studio-webview"
                src="${modulePath}?user=${userParam}&creds=${credsParam}"
                style="width:100%; height:calc(100vh - 190px); border:none; background:transparent;"
                nodeintegration
                webpreferences="nodeIntegration=yes, contextIsolation=no"
                partition="persist:content_studio"
                allowpopups
            ></webview>
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
