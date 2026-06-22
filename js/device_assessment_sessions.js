/* Device-backed assessment sessions: limits selected assessments to configured physical device slots. */
(function() {
    const CONFIG_KEY = 'device_assessment_sessions';
    const TABLE = 'assessment_device_sessions';
    const STATUS = {
        available: 'available',
        in_use: 'in_use',
        requires_attention: 'requires_attention',
        offline: 'offline'
    };

    function esc(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function readJson(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (raw === null || raw === undefined || raw === '') return fallback;
            return JSON.parse(raw);
        } catch (error) {
            return fallback;
        }
    }

    function normalizeStatus(value) {
        const clean = String(value || '').trim().toLowerCase();
        return Object.values(STATUS).includes(clean) ? clean : STATUS.available;
    }

    function normalizeConfig(config) {
        const raw = config && typeof config === 'object' ? config : {};
        const selected = raw.selected && typeof raw.selected === 'object' ? raw.selected : {};
        const sessions = Array.isArray(raw.sessions) ? raw.sessions : [];
        const normalizedSessions = [1, 2, 3, 4].map(slot => {
            const existing = sessions.find(item => Number(item && item.slot) === slot) || {};
            return {
                slot,
                clientCode: String(existing.clientCode || ''),
                macAddress: String(existing.macAddress || ''),
                pppoeName: String(existing.pppoeName || ''),
                status: normalizeStatus(existing.status)
            };
        });
        return {
            enabled: raw.enabled !== false,
            selected: {
                type: String(selected.type || ''),
                id: String(selected.id || ''),
                title: String(selected.title || '')
            },
            sessions: normalizedSessions,
            updatedAt: raw.updatedAt || '',
            updatedBy: raw.updatedBy || ''
        };
    }

    function assessmentKey(ref) {
        return `${String(ref && ref.type || '')}:${String(ref && ref.id || '')}`;
    }

    function rowIdFor(ref, slot) {
        return `das_${assessmentKey(ref).replace(/[^a-zA-Z0-9]+/g, '_')}_${slot}`;
    }

    function client() {
        return window.supabaseClient || (typeof window.initSupabaseClient === 'function' ? window.initSupabaseClient() : null);
    }

    function localConfig() {
        return normalizeConfig(readJson(CONFIG_KEY, {}));
    }

    async function loadConfig() {
        const local = localConfig();
        const db = client();
        if (!db || typeof db.from !== 'function') return local;
        try {
            const { data, error } = await db
                .from('app_documents')
                .select('content')
                .eq('key', CONFIG_KEY)
                .maybeSingle();
            if (error) throw error;
            const remote = normalizeConfig(data && data.content ? data.content : local);
            localStorage.setItem(CONFIG_KEY, JSON.stringify(remote));
            return remote;
        } catch (error) {
            console.warn('[Device Sessions] config load skipped:', error.message || error);
            return local;
        }
    }

    function assessmentMatches(config, ref) {
        if (!config.enabled) return false;
        return !!config.selected.type && !!config.selected.id && assessmentKey(config.selected) === assessmentKey(ref);
    }

    function listAssessmentOptions() {
        const options = [];
        readJson('tests', []).forEach(test => {
            if (!test || !test.id || !test.title) return;
            options.push({
                type: 'test_engine',
                id: String(test.id),
                title: String(test.title),
                label: `Test Engine - ${test.title}`
            });
        });
        const studio = normalizeStudioDoc(readJson('assessment_studio_data_local', readJson('assessment_studio_data', {})));
        studio.generators.forEach(generator => {
            if (!generator || !generator.id) return;
            const title = generator.assessment || generator.title || generator.name || generator.id;
            options.push({
                type: 'assessment_studio',
                id: String(generator.id),
                title: String(title),
                label: `Assessment Studio - ${title}`
            });
        });
        return options.sort((a, b) => a.label.localeCompare(b.label));
    }

    function normalizeStudioDoc(doc) {
        return {
            generators: Array.isArray(doc && doc.generators) ? doc.generators : []
        };
    }

    function statusLabel(value) {
        const status = normalizeStatus(value);
        if (status === STATUS.in_use) return 'In Use';
        if (status === STATUS.requires_attention) return 'Requires Attention';
        if (status === STATUS.offline) return 'Offline';
        return 'Available';
    }

    function statusOptions(current) {
        return Object.values(STATUS).map(status => `<option value="${status}" ${normalizeStatus(current) === status ? 'selected' : ''}>${statusLabel(status)}</option>`).join('');
    }

    async function saveConfig(config) {
        const normalized = normalizeConfig({
            ...config,
            updatedAt: new Date().toISOString(),
            updatedBy: window.CURRENT_USER && window.CURRENT_USER.user || 'Admin'
        });
        localStorage.setItem(CONFIG_KEY, JSON.stringify(normalized));
        const db = client();
        if (!db || typeof db.from !== 'function') throw new Error('Supabase is not connected.');
        const { error } = await db.from('app_documents').upsert({
            key: CONFIG_KEY,
            content: normalized,
            updated_at: normalized.updatedAt
        });
        if (error) throw error;
        await upsertSessionRows(normalized);
        return normalized;
    }

    async function upsertSessionRows(config) {
        const db = client();
        if (!db || typeof db.from !== 'function') return false;
        if (!config.selected.type || !config.selected.id) return false;
        const rows = config.sessions.map(session => {
            const status = normalizeStatus(session.status);
            const row = {
                id: rowIdFor(config.selected, session.slot),
                assessment_type: config.selected.type,
                assessment_id: config.selected.id,
                assessment_title: config.selected.title || '',
                slot_number: session.slot,
                client_code: session.clientCode || '',
                mac_address: session.macAddress || '',
                pppoe_name: session.pppoeName || '',
                status,
                updated_at: new Date().toISOString()
            };
            if (status !== STATUS.in_use) {
                row.claimed_by = null;
                row.claimed_at = null;
                row.claimed_submission_id = null;
            }
            return row;
        });
        const { error } = await db.from(TABLE).upsert(rows);
        if (error) throw error;
        return true;
    }

    async function fetchRowsForSelected(config) {
        const db = client();
        if (!db || typeof db.from !== 'function' || !config.selected.type || !config.selected.id) return [];
        const { data, error } = await db
            .from(TABLE)
            .select('*')
            .eq('assessment_type', config.selected.type)
            .eq('assessment_id', config.selected.id)
            .order('slot_number', { ascending: true });
        if (error) throw error;
        return Array.isArray(data) ? data : [];
    }

    async function syncConfigStatusesFromRows(config) {
        const rows = await fetchRowsForSelected(config);
        const bySlot = new Map(rows.map(row => [Number(row.slot_number), row]));
        return normalizeConfig({
            ...config,
            sessions: config.sessions.map(session => {
                const row = bySlot.get(Number(session.slot));
                if (!row) return session;
                return {
                    ...session,
                    clientCode: row.client_code || session.clientCode,
                    macAddress: row.mac_address || session.macAddress,
                    pppoeName: row.pppoe_name || session.pppoeName,
                    status: normalizeStatus(row.status)
                };
            })
        });
    }

    async function renderAdminPanel() {
        const root = document.getElementById('deviceSessionsAdminRoot');
        if (!root) return;
        const options = listAssessmentOptions();
        let config = await loadConfig();
        try {
            config = await syncConfigStatusesFromRows(config);
            localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
        } catch (error) {
            console.warn('[Device Sessions] status refresh skipped:', error.message || error);
        }
        const selectedKey = assessmentKey(config.selected);
        root.innerHTML = `
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap;">
                    <div>
                        <h3 style="margin:0;">Device Assessment Sessions</h3>
                        <p style="margin:6px 0 0; color:var(--text-muted); font-size:0.86rem;">Limit one selected assessment to four physical router/device sessions.</p>
                    </div>
                    <button class="btn-secondary btn-sm" onclick="DeviceAssessmentSessions.renderAdminPanel()"><i class="fas fa-sync"></i> Refresh</button>
                </div>
                <div style="display:grid; grid-template-columns:minmax(220px, 1fr) auto; gap:12px; align-items:end; margin-top:14px;">
                    <div>
                        <label>Controlled Assessment</label>
                        <select id="deviceAssessmentSelect">
                            <option value="">No device-controlled assessment</option>
                            ${options.map(option => `<option value="${esc(assessmentKey(option))}" ${selectedKey === assessmentKey(option) ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}
                        </select>
                    </div>
                    <label style="display:flex; align-items:center; gap:8px; margin:0 0 10px;"><input type="checkbox" id="deviceSessionsEnabled" ${config.enabled ? 'checked' : ''}> Enabled</label>
                </div>
                <div class="table-responsive" style="margin-top:14px;">
                    <table class="admin-table compressed-table">
                        <thead><tr><th>Session</th><th>Client Code</th><th>Mac Address</th><th>PPPoE Name</th><th>Status</th><th>Admin Action</th></tr></thead>
                        <tbody>
                            ${config.sessions.map(session => `
                                <tr>
                                    <td>Session ${session.slot}</td>
                                    <td><input id="deviceClientCode${session.slot}" value="${esc(session.clientCode)}" style="margin:0;"></td>
                                    <td><input id="deviceMacAddress${session.slot}" value="${esc(session.macAddress)}" style="margin:0;"></td>
                                    <td><input id="devicePppoeName${session.slot}" value="${esc(session.pppoeName)}" style="margin:0;"></td>
                                    <td><select id="deviceStatus${session.slot}" style="margin:0;">${statusOptions(session.status)}</select></td>
                                    <td><button class="btn-secondary btn-sm" onclick="DeviceAssessmentSessions.setSlotAvailable(${session.slot})">Set Available</button></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:14px;">
                    <button class="btn-primary" onclick="DeviceAssessmentSessions.saveAdminPanel()">Save Device Sessions</button>
                </div>
            </div>
        `;
    }

    function collectAdminConfig() {
        const options = listAssessmentOptions();
        const selectedValue = String(document.getElementById('deviceAssessmentSelect')?.value || '');
        const selected = options.find(option => assessmentKey(option) === selectedValue) || { type: '', id: '', title: '' };
        return normalizeConfig({
            enabled: !!document.getElementById('deviceSessionsEnabled')?.checked,
            selected,
            sessions: [1, 2, 3, 4].map(slot => ({
                slot,
                clientCode: document.getElementById(`deviceClientCode${slot}`)?.value || '',
                macAddress: document.getElementById(`deviceMacAddress${slot}`)?.value || '',
                pppoeName: document.getElementById(`devicePppoeName${slot}`)?.value || '',
                status: document.getElementById(`deviceStatus${slot}`)?.value || STATUS.available
            }))
        });
    }

    async function saveAdminPanel() {
        try {
            const config = collectAdminConfig();
            await saveConfig(config);
            if (typeof showToast === 'function') showToast('Device assessment sessions saved.', 'success');
            await renderAdminPanel();
        } catch (error) {
            console.error('[Device Sessions] save failed:', error);
            alert(error.message || 'Device sessions could not be saved.');
        }
    }

    async function setSlotAvailable(slot) {
        const config = collectAdminConfig();
        const session = config.sessions.find(item => Number(item.slot) === Number(slot));
        if (session) session.status = STATUS.available;
        try {
            await saveConfig(config);
            const db = client();
            if (db && config.selected.id) {
                await db.from(TABLE).update({
                    status: STATUS.available,
                    claimed_by: null,
                    claimed_at: null,
                    claimed_submission_id: null,
                    updated_at: new Date().toISOString()
                }).eq('id', rowIdFor(config.selected, slot));
            }
            await renderAdminPanel();
        } catch (error) {
            alert(error.message || 'Device session could not be reset.');
        }
    }

    async function claimForAssessment(ref) {
        const config = await loadConfig();
        if (!assessmentMatches(config, ref)) return { required: false, ok: true };
        const db = client();
        if (!db || typeof db.from !== 'function') {
            const message = 'Device sessions are not connected. Ask an admin to check Supabase.';
            if (typeof showToast === 'function') showToast(message, 'error');
            return { required: true, ok: false, reason: message };
        }
        let rows = [];
        try {
            rows = await fetchRowsForSelected(config);
        } catch (error) {
            const message = 'Device session table is not ready. Ask an admin to run the device-session SQL setup.';
            if (typeof showToast === 'function') showToast(message, 'error');
            console.warn('[Device Sessions] claim failed:', error.message || error);
            return { required: true, ok: false, reason: message };
        }
        const available = rows.filter(row => normalizeStatus(row.status) === STATUS.available).sort((a, b) => Number(a.slot_number) - Number(b.slot_number));
        for (const row of available) {
            const { data, error } = await db.from(TABLE)
                .update({
                    status: STATUS.in_use,
                    claimed_by: window.CURRENT_USER && window.CURRENT_USER.user || null,
                    claimed_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq('id', row.id)
                .eq('status', STATUS.available)
                .select()
                .maybeSingle();
            if (error) continue;
            if (data) {
                return {
                    required: true,
                    ok: true,
                    session: {
                        rowId: data.id,
                        slot: data.slot_number,
                        clientCode: data.client_code || '',
                        macAddress: data.mac_address || '',
                        pppoeName: data.pppoe_name || '',
                        assessmentType: data.assessment_type,
                        assessmentId: data.assessment_id,
                        claimedAt: data.claimed_at
                    }
                };
            }
        }
        const message = 'All routers are currently in use. Please wait for an admin to make a session available.';
        if (typeof showToast === 'function') showToast(message, 'warning');
        else alert(message);
        return { required: true, ok: false, reason: message };
    }

    async function markRequiresAttention(session, submissionId) {
        if (!session || !session.rowId) return false;
        const db = client();
        if (!db || typeof db.from !== 'function') return false;
        const { error } = await db.from(TABLE).update({
            status: STATUS.requires_attention,
            claimed_submission_id: submissionId || null,
            updated_at: new Date().toISOString()
        }).eq('id', session.rowId);
        if (error) {
            console.warn('[Device Sessions] completion status update failed:', error.message || error);
            return false;
        }
        return true;
    }

    function renderContext(context) {
        const session = context && context.session ? context.session : context;
        if (!session || !session.rowId) return '';
        return `
            <div class="device-session-context" style="border:1px solid var(--border-color); border-left:4px solid var(--primary); border-radius:8px; padding:12px; margin:12px 0; background:var(--bg-card);">
                <strong>Assigned Device Session ${esc(session.slot || '')}</strong>
                <div style="display:flex; gap:12px; flex-wrap:wrap; margin-top:8px; color:var(--text-muted); font-size:0.9rem;">
                    <span>Client Code: <strong>${esc(session.clientCode || '-')}</strong></span>
                    <span>Mac Address: <strong>${esc(session.macAddress || '-')}</strong></span>
                    <span>PPPoE Name: <strong>${esc(session.pppoeName || '-')}</strong></span>
                </div>
            </div>
        `;
    }

    window.DeviceAssessmentSessions = {
        STATUS,
        loadConfig,
        renderAdminPanel,
        saveAdminPanel,
        setSlotAvailable,
        claimForAssessment,
        markRequiresAttention,
        renderContext
    };
})();
