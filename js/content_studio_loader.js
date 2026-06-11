/* ================= CONTENT CREATOR LOADER ================= */
/* HOST LOADER: Launches the isolated Content Creator module */

const ContentStudioLoader = {
    _windowMessageBound: false,

    handleStudioSave: function(payload) {
        const data = payload && typeof payload === 'object' ? payload : {};
        const content = data.content && typeof data.content === 'object'
            ? data.content
            : null;
        if (!content) return false;

        try {
            localStorage.setItem('content_studio_data', JSON.stringify(content));
            localStorage.setItem('content_studio_data_local', JSON.stringify(content));
            window.dispatchEvent(new CustomEvent('buildzone:data-changed', {
                detail: { key: 'content_studio_data', source: 'content_studio_webview' }
            }));
        } catch (error) {
            console.error('[Content Studio Loader] Host cache save failed:', error);
            if (typeof showToast === 'function') showToast('Content Creator could not update host cache.', 'error');
            return false;
        }

        if (typeof saveToServer === 'function') {
            Promise.resolve(saveToServer(['content_studio_data'], true, true))
                .then((ok) => {
                    if (!ok && typeof showToast === 'function') {
                        showToast('Content Creator saved locally, but cloud sync did not confirm.', 'warning');
                    }
                })
                .catch((error) => {
                    console.warn('[Content Studio Loader] Host cloud save failed:', error);
                    if (typeof showToast === 'function') showToast('Content Creator saved locally. Cloud sync can retry after refresh.', 'warning');
                });
            return true;
        }

        if (window.supabaseClient && typeof window.supabaseClient.from === 'function') {
            window.supabaseClient.from('app_documents').upsert({
                key: 'content_studio_data',
                content,
                updated_at: new Date().toISOString()
            }).select().then(({ data: savedData, error }) => {
                if (error) throw error;
                if (savedData && savedData[0] && savedData[0].updated_at) {
                    localStorage.setItem('sync_ts_content_studio_data', savedData[0].updated_at);
                }
            }).catch((error) => {
                console.warn('[Content Studio Loader] Direct cloud save failed:', error);
            });
        }

        return true;
    },

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
            if (!data) return;
            if (data.type === 'content-studio-open-quiz') this.launchLinkedQuiz(data.payload || null);
            if (data.type === 'content-studio-save') this.handleStudioSave(data.payload || null);
        });
    },

    syncHostDataToWebview: function(webview) {
        if (!webview || typeof webview.executeJavaScript !== 'function') return;
        let content = null;
        try {
            const canonical = JSON.parse(localStorage.getItem('content_studio_data') || 'null');
            const local = JSON.parse(localStorage.getItem('content_studio_data_local') || 'null');
            const itemTime = (item) => Date.parse(item && (item.updatedAt || item.lastModified || item.createdAt) || 0) || 0;
            const mergeByKey = (leftItems, rightItems, keyFn) => {
                const map = new Map();
                [...(Array.isArray(leftItems) ? leftItems : []), ...(Array.isArray(rightItems) ? rightItems : [])].forEach(item => {
                    if (!item || typeof item !== 'object') return;
                    const key = String(keyFn(item) || '').trim();
                    if (!key) return;
                    const existing = map.get(key);
                    if (!existing || itemTime(item) >= itemTime(existing)) map.set(key, item);
                });
                return Array.from(map.values());
            };
            if (canonical && local && typeof canonical === 'object' && typeof local === 'object') {
                const canonicalTime = itemTime(canonical);
                const localTime = itemTime(local);
                content = {
                    ...(canonicalTime >= localTime ? local : canonical),
                    ...(canonicalTime >= localTime ? canonical : local),
                    entries: mergeByKey(canonical.entries, local.entries, item => item.scheduleKey || item.id),
                    analytics: mergeByKey(canonical.analytics, local.analytics, item => item.id),
                    annotations: mergeByKey(canonical.annotations, local.annotations, item => item.id)
                };
            } else {
                content = canonical || local;
            }
        } catch (error) {
            content = null;
        }
        if (!content || typeof content !== 'object') return;
        const script = `
            (() => {
                try {
                    const content = ${JSON.stringify(content)};
                    localStorage.setItem('content_studio_data', JSON.stringify(content));
                    localStorage.setItem('content_studio_data_local', JSON.stringify(content));
                    if (window.DataService && typeof DataService.getStore === 'function') {
                        if (window.App && typeof App.render === 'function') App.render();
                    }
                } catch (error) {
                    console.warn('[Content Studio] Host data injection failed:', error);
                }
            })();
        `;
        webview.executeJavaScript(script, true).catch(error => {
            console.warn('[Content Studio Loader] Host data sync failed:', error);
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
            ContentStudioLoader.syncHostDataToWebview(webview);
        });

        webview.addEventListener('ipc-message', (event) => {
            const payload = Array.isArray(event.args) ? event.args[0] : null;
            if (event && event.channel === 'content-studio-open-quiz') this.launchLinkedQuiz(payload);
            if (event && event.channel === 'content-studio-save') this.handleStudioSave(payload);
        });

        this.bindWindowMessageBridge();
    }
};

window.ContentStudioLoader = ContentStudioLoader;
