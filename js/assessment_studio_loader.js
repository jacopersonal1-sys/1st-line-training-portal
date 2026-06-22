/* ================= ASSESSMENT STUDIO LOADER ================= */
/* HOST LOADER: Launches the isolated Assessment Studio module */

const AssessmentStudioLoader = {
    _windowMessageBound: false,
    _saveTimer: null,

    hasAuthoring: function(studio) {
        const source = studio && typeof studio === 'object' ? studio : {};
        return ['questionBucket', 'generators', 'groupings', 'tags']
            .some(field => Array.isArray(source[field]) && source[field].length > 0);
    },

    handleStudioSave: function(payload) {
        const data = payload && typeof payload === 'object' ? payload : {};
        const content = data.content && typeof data.content === 'object'
            ? data.content
            : null;
        if (!content) return false;
        const cloudConfirmedAt = String(data.cloudConfirmedAt || '').trim();

        try {
            localStorage.setItem('assessment_studio_data', JSON.stringify(content));
            localStorage.setItem('assessment_studio_data_local', JSON.stringify(content));
            if (cloudConfirmedAt) localStorage.setItem('sync_ts_assessment_studio_data', cloudConfirmedAt);
            window.dispatchEvent(new CustomEvent('buildzone:data-changed', {
                detail: { key: 'assessment_studio_data', source: 'assessment_studio_webview' }
            }));
        } catch (error) {
            console.error('[Assessment Studio Loader] Host cache save failed:', error);
            if (typeof showToast === 'function') showToast('Assessment Studio could not update host cache.', 'error');
            return false;
        }

        if (cloudConfirmedAt) return true;

        const runCloudSave = () => {
            if (typeof saveToServer !== 'function') return false;
            Promise.resolve(saveToServer(['assessment_studio_data'], true, true))
                .then((ok) => {
                    if (!ok && typeof showToast === 'function') {
                        showToast('Assessment Studio saved locally, but cloud sync did not confirm.', 'warning');
                    }
                })
                .catch((error) => {
                    console.warn('[Assessment Studio Loader] Host cloud save failed:', error);
                    if (typeof showToast === 'function') showToast('Assessment Studio saved locally. Cloud sync can retry after refresh.', 'warning');
                });
            return true;
        };

        if (typeof saveToServer === 'function') {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
            runCloudSave();
        } else if (window.supabaseClient && typeof window.supabaseClient.from === 'function') {
            window.supabaseClient.from('app_documents')
                .select('content')
                .eq('key', 'assessment_studio_data')
                .maybeSingle()
                .then(({ data: remoteRow, error: loadError }) => {
                    if (loadError) throw loadError;
                    if (this.hasAuthoring(remoteRow && remoteRow.content) && !this.hasAuthoring(content)) {
                        throw new Error('Refusing direct Assessment Studio cloud save because local authoring data is empty while server authoring exists.');
                    }
                    return window.supabaseClient.from('app_documents').upsert({
                        key: 'assessment_studio_data',
                        content,
                        updated_at: new Date().toISOString()
                    }).select();
                }).then(({ data: savedData, error }) => {
                if (error) throw error;
                if (savedData && savedData[0] && savedData[0].updated_at) {
                    localStorage.setItem('sync_ts_assessment_studio_data', savedData[0].updated_at);
                }
            }).catch((error) => {
                console.warn('[Assessment Studio Loader] Direct cloud save failed:', error);
            });
        }

        return true;
    },

    handleFeedbackStatus: function(payload) {
        const data = payload && typeof payload === 'object' ? payload : {};
        const submissionId = String(data.submissionId || '').trim();
        if (!submissionId) return false;
        const feedbackStatus = (() => {
            const status = String(data.feedbackStatus || '').trim().toLowerCase();
            if (status === 'requested') return 'requested';
            if (status === 'received' || status === 'recieved' || status === 'given') return 'received';
            return 'none';
        })();
        try {
            const updateStudioCache = (key) => {
                const raw = localStorage.getItem(key);
                const studio = raw ? JSON.parse(raw) : null;
                if (!studio || typeof studio !== 'object' || !Array.isArray(studio.submissions)) return false;
                const idx = studio.submissions.findIndex(item => item && String(item.id || '') === submissionId);
                if (idx < 0) return false;
                studio.submissions[idx] = {
                    ...studio.submissions[idx],
                    feedbackStatus,
                    updatedAt: new Date().toISOString()
                };
                studio.updatedAt = new Date().toISOString();
                studio.updatedBy = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.user) ? CURRENT_USER.user : (studio.updatedBy || 'Admin');
                localStorage.setItem(key, JSON.stringify(studio));
                return true;
            };
            const changedCanonical = updateStudioCache('assessment_studio_data');
            const changedLocal = updateStudioCache('assessment_studio_data_local');
            if (changedCanonical || changedLocal) {
                window.dispatchEvent(new CustomEvent('buildzone:data-changed', {
                    detail: { key: 'assessment_studio_data', source: 'assessment_studio_feedback_status' }
                }));
            }

            const notifications = JSON.parse(localStorage.getItem('admin_notifications') || '[]');
            const list = Array.isArray(notifications) ? notifications : [];
            const id = `assessment_studio_feedback_${submissionId}`;
            const idx = list.findIndex(item => item && String(item.id || '') === id);
            if (idx >= 0) {
                list[idx].status = feedbackStatus === 'requested' ? 'open' : 'closed';
                list[idx].updatedAt = new Date().toISOString();
                localStorage.setItem('admin_notifications', JSON.stringify(list));
                if (typeof saveToServer === 'function') saveToServer(['admin_notifications'], false, true).catch(() => {});
                if (typeof updateNotifications === 'function') updateNotifications();
            }
            return true;
        } catch (error) {
            console.warn('[Assessment Studio Loader] Feedback notification update failed:', error);
            return false;
        }
    },

    bindWindowMessageBridge: function() {
        if (this._windowMessageBound) return;
        this._windowMessageBound = true;
        window.addEventListener('message', (event) => {
            const data = event && event.data ? event.data : null;
            if (!data) return;
            if (data.type === 'assessment-studio-save') this.handleStudioSave(data.payload || null);
            if (data.type === 'assessment-studio-feedback-status') this.handleFeedbackStatus(data.payload || null);
        });
    },

    syncHostDataToWebview: function(webview) {
        if (!webview || typeof webview.executeJavaScript !== 'function') return;
        let content = null;
        try {
            const canonical = JSON.parse(localStorage.getItem('assessment_studio_data') || 'null');
            const local = JSON.parse(localStorage.getItem('assessment_studio_data_local') || 'null');
            const itemTime = (item) => Date.parse(item && (item.updatedAt || item.gradedAt || item.submittedAt || item.createdAt) || 0) || 0;
            const mergeById = (leftItems, rightItems, leftDocTime = 0, rightDocTime = 0, options = {}) => {
                const map = new Map();
                const leftMap = new Map();
                const rightMap = new Map();
                const indexItems = (items, target) => (Array.isArray(items) ? items : []).forEach(item => {
                    if (!item || typeof item !== 'object') return;
                    const id = String(item.id || '').trim();
                    if (!id) return;
                    const existing = target.get(id);
                    if (!existing || itemTime(item) >= itemTime(existing)) target.set(id, item);
                });
                indexItems(leftItems, leftMap);
                indexItems(rightItems, rightMap);
                if (options.preserveRightWhenLeftEmpty && leftMap.size === 0 && rightMap.size > 0) return Array.from(rightMap.values());
                if (rightMap.size === 0 && leftMap.size > 0) return Array.from(leftMap.values());
                new Set([...leftMap.keys(), ...rightMap.keys()]).forEach(id => {
                    const left = leftMap.get(id);
                    const right = rightMap.get(id);
                    if (left && right) {
                        map.set(id, itemTime(right) >= itemTime(left) ? right : left);
                    } else if (left) {
                        if (!rightDocTime || itemTime(left) >= rightDocTime) map.set(id, left);
                    } else if (!leftDocTime || itemTime(right) >= leftDocTime) {
                        map.set(id, right);
                    }
                });
                return Array.from(map.values());
            };
            if (canonical && local && typeof canonical === 'object' && typeof local === 'object') {
                const canonicalTime = itemTime(canonical);
                const localTime = itemTime(local);
                const canonicalAuthoringEmpty = ['questionBucket', 'generators', 'groupings', 'tags']
                    .every(field => !Array.isArray(canonical[field]) || canonical[field].length === 0);
                content = {
                    ...(canonicalTime >= localTime ? local : canonical),
                    ...(canonicalTime >= localTime ? canonical : local),
                    questionBucket: mergeById(canonical.questionBucket, local.questionBucket, canonicalTime, localTime, { preserveRightWhenLeftEmpty: canonicalAuthoringEmpty }),
                    generators: mergeById(canonical.generators, local.generators, canonicalTime, localTime, { preserveRightWhenLeftEmpty: canonicalAuthoringEmpty }),
                    submissions: mergeById(canonical.submissions, local.submissions, canonicalTime, localTime),
                    groupings: mergeById(canonical.groupings, local.groupings, canonicalTime, localTime, { preserveRightWhenLeftEmpty: canonicalAuthoringEmpty }),
                    tags: mergeById(canonical.tags, local.tags, canonicalTime, localTime, { preserveRightWhenLeftEmpty: canonicalAuthoringEmpty })
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
                    localStorage.setItem('assessment_studio_data', JSON.stringify(content));
                    localStorage.setItem('assessment_studio_data_local', JSON.stringify(content));
                    if (window.AssessmentStudioData && AssessmentStudioData.state && AssessmentStudioData.state.studio) {
                        AssessmentStudioData.state.studio = AssessmentStudioData.normalizeStudio
                            ? AssessmentStudioData.normalizeStudio(content)
                            : content;
                    }
                    if (window.App && typeof App.render === 'function') App.render();
                } catch (error) {
                    console.warn('[Assessment Studio] Host data injection failed:', error);
                }
            })();
        `;
        webview.executeJavaScript(script, true).catch(error => {
            console.warn('[Assessment Studio Loader] Host data sync failed:', error);
        });
    },

    renderCatchupUI: function() {
        const container = document.getElementById('assessment-studio-content');
        if (!container) {
            console.error('[Assessment Studio Loader] Container not found.');
            return;
        }

        if (!CURRENT_USER || !['admin', 'super_admin'].includes(CURRENT_USER.role)) {
            container.innerHTML = `
                <div class="card" style="max-width:760px; margin:24px auto; text-align:center; border-color:#ff5252;">
                    <h3 style="color:#ff5252; margin-bottom:8px;">Access Denied</h3>
                    <p style="color:var(--text-muted); margin:0;">Assessment Studio is restricted to Admin and Super Admin sessions only.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="embedded-program-shell">
                <div class="embedded-program-header">
                    <div>
                        <div class="embedded-program-title"><i class="fas fa-paper-plane"></i> Assessment Studio Catch-up Push</div>
                        <div class="embedded-program-subtitle">Select an Assessment Studio generator, choose catch-up, then assign it to one trainee.</div>
                    </div>
                    <div class="embedded-program-actions">
                        <button class="btn-secondary btn-sm" onclick="goWorkspaceHome()"><i class="fas fa-house"></i> Home</button>
                        <button class="btn-secondary btn-sm" onclick="AssessmentStudioLoader.renderUI()"><i class="fas fa-clipboard-list"></i> Studio</button>
                        <button class="btn-secondary btn-sm" onclick="AssessmentStudioLoader.renderCatchupUI()"><i class="fas fa-rotate-right"></i> Refresh</button>
                    </div>
                </div>
                <div class="embedded-program-body">
                    <div id="assessmentStudioCatchupPanel"></div>
                </div>
            </div>
        `;

        if (typeof mountManualAssessmentPushPanel === 'function') {
            mountManualAssessmentPushPanel({
                hostId: 'assessmentStudioCatchupPanel',
                mode: 'assessment_studio',
                assessmentFirst: true,
                title: 'Catch-up Assignment',
                description: 'Push one generated Assessment Studio test directly to a selected trainee without using a Schedule Studio timeline item.',
                buttonLabel: 'Push Catch-up'
            });
        } else {
            const panel = document.getElementById('assessmentStudioCatchupPanel');
            if (panel) panel.innerHTML = '<div class="card"><p style="margin:0; color:var(--text-muted);">Manual catch-up tools are not loaded. Refresh the app and try again.</p></div>';
        }
    },

    renderUI: function() {
        const container = document.getElementById('assessment-studio-content');
        if (!container) {
            console.error('[Assessment Studio Loader] Container not found.');
            return;
        }

        if (!CURRENT_USER || !['admin', 'super_admin'].includes(CURRENT_USER.role)) {
            container.innerHTML = `
                <div class="card" style="max-width:760px; margin:24px auto; text-align:center; border-color:#ff5252;">
                    <h3 style="color:#ff5252; margin-bottom:8px;">Access Denied</h3>
                    <p style="color:var(--text-muted); margin:0;">Assessment Studio is restricted to Admin and Super Admin sessions only.</p>
                </div>
            `;
            return;
        }

        const userParam = encodeURIComponent(JSON.stringify(CURRENT_USER || {}));
        const credsParam = encodeURIComponent(JSON.stringify(window.CLOUD_CREDENTIALS || {}));
        const basePath = window.location.href.substring(0, window.location.href.lastIndexOf('/'));
        const moduleVersion = encodeURIComponent(window.APP_VERSION || window.BUILD_VERSION || 'assessment-picture-20260617');
        const modulePath = `${basePath}/modules/assessment_studio/index.html?v=${moduleVersion}`;

        container.innerHTML = `
            <div class="embedded-program-shell">
                <div class="embedded-program-header">
                    <div>
                        <div class="embedded-program-title"><i class="fas fa-clipboard-list"></i> Assessment Studio</div>
                        <div class="embedded-program-subtitle">Question bucket, generated test snapshots, grading queue, feedback, and universal search.</div>
                    </div>
                    <div class="embedded-program-actions">
                        <button class="btn-secondary btn-sm" onclick="goWorkspaceHome()"><i class="fas fa-house"></i> Home</button>
                        <button class="btn-secondary btn-sm" onclick="AssessmentStudioLoader.renderCatchupUI()"><i class="fas fa-paper-plane"></i> Catch-up Push</button>
                        <button class="btn-secondary btn-sm" onclick="AssessmentStudioLoader.renderUI()"><i class="fas fa-rotate-right"></i> Refresh</button>
                    </div>
                </div>
                <webview
                    id="assessment-studio-webview"
                    class="embedded-program-frame"
                    src="${modulePath}&user=${userParam}&creds=${credsParam}"
                    style="height:calc(100vh - 230px);"
                    nodeintegration
                    webpreferences="nodeIntegration=yes, contextIsolation=no"
                    partition="persist:assessment_studio"
                    allowpopups
                ></webview>
            </div>
        `;

        const webview = document.getElementById('assessment-studio-webview');
        if (webview) {
            webview.addEventListener('dom-ready', () => {
                if (typeof applyThemeToWebview === 'function') applyThemeToWebview(webview);
                AssessmentStudioLoader.syncHostDataToWebview(webview);
            });

            webview.addEventListener('ipc-message', (event) => {
                if (!event || event.channel !== 'assessment-studio-save') return;
                const payload = Array.isArray(event.args) ? event.args[0] : null;
                AssessmentStudioLoader.handleStudioSave(payload);
            });
        }

        this.bindWindowMessageBridge();
    }
};

window.AssessmentStudioLoader = AssessmentStudioLoader;
