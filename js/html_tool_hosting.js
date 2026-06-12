/* ================= HOSTED HTML TOOL MANAGEMENT ================= */

const HTML_TOOL_HOSTING_DOC_KEY = 'hosted_html_tool';
const HTML_TOOL_HOSTING_BUCKET = 'tool_exports';
const HTML_TOOL_HOSTING_SLOTS = {
    main: {
        id: 'main',
        label: 'Main HTML Tool',
        description: 'The editable builder or primary tool file.',
        path: 'first-line-troubleshooting/main/current.html'
    },
    export: {
        id: 'export',
        label: 'Exported HTML Tool',
        description: 'The finished exported tool shared with viewers.',
        path: 'first-line-troubleshooting/export/current.html'
    }
};

function normalizeHostedToolSlot(slot) {
    const key = String(slot || '').trim().toLowerCase();
    return HTML_TOOL_HOSTING_SLOTS[key] ? key : 'main';
}

function escapeHostedHtml(value) {
    return String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getHostedToolEditor() {
    const user = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) ? CURRENT_USER : null;
    return String((user && (user.user || user.email || user.name)) || 'unknown_user');
}

function getHostedHtmlPublicUrl(slot, version) {
    const slotKey = normalizeHostedToolSlot(slot);
    const activeUrl = String(window.SUPABASE_ACTIVE_URL || '').replace(/\/+$/, '');
    if (activeUrl) {
        const stamp = version || Date.now();
        return `${activeUrl}/functions/v1/hosted-html-tool?slot=${encodeURIComponent(slotKey)}&v=${encodeURIComponent(stamp)}`;
    }
    if (!window.supabaseClient || !window.supabaseClient.storage) return '';
    const { data } = window.supabaseClient.storage
        .from(HTML_TOOL_HOSTING_BUCKET)
        .getPublicUrl(HTML_TOOL_HOSTING_SLOTS[slotKey].path);
    const baseUrl = data && data.publicUrl ? data.publicUrl : '';
    if (!baseUrl) return '';
    const stamp = version || Date.now();
    return `${baseUrl}?v=${encodeURIComponent(stamp)}`;
}

function setHostedToolStatus(html) {
    const el = document.getElementById('htmlToolHostingStatus');
    if (el) el.innerHTML = html;
}

function getHostedToolRecords(raw) {
    if (raw && raw.slots && typeof raw.slots === 'object') return raw.slots;
    if (raw && raw.path) return { main: raw };
    return {};
}

function renderHostedToolSlot(slotKey, record, message) {
    const slot = HTML_TOOL_HOSTING_SLOTS[slotKey];
    const hasRecord = !!(record && record.path);
    const url = hasRecord ? String(record.url || getHostedHtmlPublicUrl(slotKey, record.version)).trim() : '';
    const fileName = String(record && record.fileName ? record.fileName : 'current.html');
    const updatedAt = record && record.updatedAt ? new Date(record.updatedAt).toLocaleString() : 'Unknown';
    const updatedBy = String(record && record.updatedBy ? record.updatedBy : 'Unknown');

    return `
        <div style="display:flex; flex-direction:column; gap:10px;">
            <div>
                <strong>${escapeHostedHtml(slot.label)}</strong>
                <div style="color:var(--text-muted); font-size:0.86rem;">${escapeHostedHtml(slot.description)}</div>
            </div>
            <input type="file" id="htmlToolFileInput_${escapeHostedHtml(slotKey)}" accept=".html,.htm,text/html" style="margin:0;">
            ${hasRecord && url ? `
                <div style="color:var(--text-muted); font-size:0.82rem;">${escapeHostedHtml(fileName)} · updated ${escapeHostedHtml(updatedAt)} by ${escapeHostedHtml(updatedBy)}</div>
                <input id="htmlToolPublicUrl_${escapeHostedHtml(slotKey)}" value="${escapeHostedHtml(url)}" readonly style="margin:0; font-size:0.82rem;" aria-label="${escapeHostedHtml(slot.label)} public URL">
            ` : `
                <div style="color:var(--text-muted); font-size:0.86rem;">${escapeHostedHtml(message || 'No file hosted in this slot yet.')}</div>
            `}
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <button class="btn-primary btn-sm" onclick="uploadHostedHtmlTool('${escapeHostedHtml(slotKey)}')" style="width:auto;"><i class="fas fa-cloud-upload-alt"></i> Upload / Replace</button>
                <button class="btn-secondary btn-sm" onclick="removeHostedHtmlTool('${escapeHostedHtml(slotKey)}')" style="width:auto;"><i class="fas fa-trash"></i> Remove</button>
                ${hasRecord && url ? `
                    <button class="btn-secondary btn-sm" onclick="copyHostedHtmlToolUrl('${escapeHostedHtml(slotKey)}')" style="width:auto;"><i class="fas fa-copy"></i> Copy URL</button>
                    <button class="btn-secondary btn-sm" onclick="openHostedHtmlToolUrl('${escapeHostedHtml(slotKey)}')" style="width:auto;"><i class="fas fa-up-right-from-square"></i> Open</button>
                ` : ''}
            </div>
        </div>
    `;
}

function renderHostedToolRecords(records, message) {
    setHostedToolStatus(`
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:14px;">
            ${Object.keys(HTML_TOOL_HOSTING_SLOTS).map(slotKey => `
                <div style="border:1px solid var(--border-color); border-radius:8px; padding:14px; background:var(--bg-card);">
                    ${renderHostedToolSlot(slotKey, records && records[slotKey], message)}
                </div>
            `).join('')}
        </div>
        <div style="color:var(--text-muted); font-size:0.78rem; margin-top:10px;">Expected bucket: <code>${HTML_TOOL_HOSTING_BUCKET}</code></div>
        <div id="htmlToolUsagePanel" style="margin-top:14px; border-top:1px solid var(--border-color); padding-top:14px;">
            Loading usage...
        </div>
    `);
    loadHostedHtmlToolUsage().catch(() => {});
}

function summarizeUserAgent(value) {
    const text = String(value || '').trim();
    if (!text) return 'Unknown browser';
    if (/Edg\//i.test(text)) return 'Edge';
    if (/Chrome\//i.test(text)) return 'Chrome';
    if (/Firefox\//i.test(text)) return 'Firefox';
    if (/Safari\//i.test(text)) return 'Safari';
    return text.slice(0, 42);
}

function renderHostedHtmlToolUsage(counts, recent) {
    const panel = document.getElementById('htmlToolUsagePanel');
    if (!panel) return;

    const rows = Array.isArray(recent) ? recent : [];
    panel.innerHTML = `
        <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:center; margin-bottom:10px;">
            <div>
                <strong>Hosted Tool Usage</strong>
                <div style="color:var(--text-muted); font-size:0.84rem;">Counts update when someone opens a hosted URL.</div>
            </div>
            <button class="btn-secondary btn-sm" onclick="loadHostedHtmlToolUsage()" style="width:auto;"><i class="fas fa-rotate-right"></i> Refresh Usage</button>
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; margin-bottom:12px;">
            ${Object.keys(HTML_TOOL_HOSTING_SLOTS).map(slotKey => `
                <div style="border:1px solid var(--border-color); border-radius:8px; padding:12px; background:var(--bg-card);">
                    <div style="color:var(--text-muted); font-size:0.78rem;">${escapeHostedHtml(HTML_TOOL_HOSTING_SLOTS[slotKey].label)}</div>
                    <div style="font-size:1.5rem; font-weight:700;">${Number(counts && counts[slotKey] || 0)}</div>
                    <div style="color:var(--text-muted); font-size:0.78rem;">total views</div>
                </div>
            `).join('')}
        </div>
        <div style="max-height:260px; overflow:auto;">
            <table class="admin-table" style="margin:0;">
                <thead>
                    <tr>
                        <th>Time</th>
                        <th>Tool</th>
                        <th>Browser</th>
                        <th>Referrer</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.length ? rows.map(row => {
                        const slotKey = normalizeHostedToolSlot(row.slot);
                        const viewedAt = row.viewed_at ? new Date(row.viewed_at).toLocaleString() : 'Unknown';
                        const referrer = String(row.referrer || '').trim() || 'Direct';
                        return `
                            <tr>
                                <td>${escapeHostedHtml(viewedAt)}</td>
                                <td>${escapeHostedHtml(HTML_TOOL_HOSTING_SLOTS[slotKey].label)}</td>
                                <td>${escapeHostedHtml(summarizeUserAgent(row.user_agent))}</td>
                                <td>${escapeHostedHtml(referrer.slice(0, 80))}</td>
                            </tr>
                        `;
                    }).join('') : '<tr><td colspan="4" style="color:var(--text-muted);">No hosted URL views logged yet.</td></tr>'}
                </tbody>
            </table>
        </div>
    `;
}

async function loadHostedHtmlToolUsage() {
    const panel = document.getElementById('htmlToolUsagePanel');
    if (!panel || !window.supabaseClient) return;
    panel.innerHTML = 'Loading usage...';
    try {
        const countResults = await Promise.all(Object.keys(HTML_TOOL_HOSTING_SLOTS).map(async slotKey => {
            const { count, error } = await window.supabaseClient
                .from('hosted_html_tool_views')
                .select('id', { count: 'exact', head: true })
                .eq('slot', slotKey);
            if (error) throw error;
            return [slotKey, count || 0];
        }));

        const { data, error } = await window.supabaseClient
            .from('hosted_html_tool_views')
            .select('slot, viewed_at, referrer, user_agent')
            .order('viewed_at', { ascending: false })
            .limit(30);
        if (error) throw error;

        const counts = Object.fromEntries(countResults);
        renderHostedHtmlToolUsage(counts, data || []);
    } catch (err) {
        panel.innerHTML = `
            <strong>Hosted Tool Usage</strong>
            <div style="color:var(--text-muted); font-size:0.86rem; margin-top:6px;">
                ${escapeHostedHtml(err && err.message ? err.message : 'Usage data could not be loaded.')}
            </div>
        `;
    }
}

async function saveHostedToolRecord(record) {
    if (!window.supabaseClient) throw new Error('Supabase client is not available.');
    const { data, error } = await window.supabaseClient.from('app_documents').upsert({
        key: HTML_TOOL_HOSTING_DOC_KEY,
        content: record || {},
        updated_at: new Date().toISOString()
    }).select('updated_at');
    if (error) throw error;
    const confirmedAt = Array.isArray(data) && data[0] && data[0].updated_at ? data[0].updated_at : '';
    if (!confirmedAt) throw new Error('Supabase did not confirm the hosted tool record save.');
    localStorage.setItem(`sync_ts_${HTML_TOOL_HOSTING_DOC_KEY}`, confirmedAt);
}

async function loadHostedHtmlTool() {
    if (!document.getElementById('htmlToolHostingStatus')) return;
    if (!window.supabaseClient) {
        renderHostedToolRecords({}, 'Supabase is offline. Connect to the server first.');
        return;
    }

    setHostedToolStatus('Loading hosted tool status...');
    try {
        const { data, error } = await window.supabaseClient
            .from('app_documents')
            .select('content')
            .eq('key', HTML_TOOL_HOSTING_DOC_KEY)
            .maybeSingle();
        if (error) throw error;

        const records = getHostedToolRecords(data && data.content ? data.content : null);
        renderHostedToolRecords(records);
    } catch (err) {
        renderHostedToolRecords({}, err && err.message ? err.message : 'Could not load hosted tool status.');
    }
}

async function uploadHostedHtmlTool(slot) {
    const slotKey = normalizeHostedToolSlot(slot);
    const slotConfig = HTML_TOOL_HOSTING_SLOTS[slotKey];
    const input = document.getElementById(`htmlToolFileInput_${slotKey}`) || document.getElementById('htmlToolFileInput');
    const file = input && input.files && input.files[0] ? input.files[0] : null;
    if (!file) {
        if (typeof showToast === 'function') showToast('Choose a HTML file first.', 'warning');
        return;
    }

    const name = String(file.name || '').toLowerCase();
    if (!name.endsWith('.html') && !name.endsWith('.htm') && file.type !== 'text/html') {
        if (typeof showToast === 'function') showToast('Only .html or .htm files can be hosted here.', 'warning');
        return;
    }

    if (!window.supabaseClient || !window.supabaseClient.storage) {
        if (typeof showToast === 'function') showToast('Supabase is offline. Connect to the server first.', 'error');
        return;
    }

    setHostedToolStatus('Uploading HTML file...');
    try {
        const version = Date.now();
        await window.supabaseClient.storage
            .from(HTML_TOOL_HOSTING_BUCKET)
            .remove([slotConfig.path])
            .catch(() => {});

        const htmlBody = new Blob([await file.arrayBuffer()], { type: 'text/html' });
        const { error } = await window.supabaseClient.storage
            .from(HTML_TOOL_HOSTING_BUCKET)
            .upload(slotConfig.path, htmlBody, {
                upsert: false,
                contentType: 'text/html',
                cacheControl: '60'
            });
        if (error) throw error;

        const record = {
            slot: slotKey,
            bucket: HTML_TOOL_HOSTING_BUCKET,
            path: slotConfig.path,
            fileName: file.name || 'current.html',
            size: file.size || 0,
            version,
            url: getHostedHtmlPublicUrl(slotKey, version),
            updatedAt: new Date().toISOString(),
            updatedBy: getHostedToolEditor()
        };

        const existing = await getHostedToolRecordMap();
        existing[slotKey] = record;
        await saveHostedToolRecord({ slots: existing });
        renderHostedToolRecords(existing);
        if (input) input.value = '';
        if (typeof showToast === 'function') showToast(`${slotConfig.label} uploaded.`, 'success');
    } catch (err) {
        renderHostedToolRecords(await getHostedToolRecordMap().catch(() => ({})), err && err.message ? err.message : 'Upload failed.');
        if (typeof showToast === 'function') showToast(err && err.message ? err.message : 'Upload failed.', 'error');
    }
}

async function getHostedToolRecordMap() {
    if (!window.supabaseClient) return {};
    const { data, error } = await window.supabaseClient
        .from('app_documents')
        .select('content')
        .eq('key', HTML_TOOL_HOSTING_DOC_KEY)
        .maybeSingle();
    if (error) throw error;
    return getHostedToolRecords(data && data.content ? data.content : null);
}

async function removeHostedHtmlTool(slot) {
    const slotKey = normalizeHostedToolSlot(slot);
    const slotConfig = HTML_TOOL_HOSTING_SLOTS[slotKey];
    if (!window.supabaseClient || !window.supabaseClient.storage) {
        if (typeof showToast === 'function') showToast('Supabase is offline. Connect to the server first.', 'error');
        return;
    }

    if (!confirm(`Remove the currently hosted ${slotConfig.label} from Supabase Storage?`)) return;

    setHostedToolStatus('Removing hosted HTML file...');
    try {
        const { error } = await window.supabaseClient.storage
            .from(HTML_TOOL_HOSTING_BUCKET)
            .remove([slotConfig.path]);
        if (error) throw error;

        const existing = await getHostedToolRecordMap();
        delete existing[slotKey];
        await saveHostedToolRecord({ slots: existing });
        renderHostedToolRecords(existing, 'The hosted file was removed. Upload a new copy when ready.');
        if (typeof showToast === 'function') showToast(`${slotConfig.label} removed.`, 'success');
    } catch (err) {
        renderHostedToolRecords(await getHostedToolRecordMap().catch(() => ({})), err && err.message ? err.message : 'Remove failed.');
        if (typeof showToast === 'function') showToast(err && err.message ? err.message : 'Remove failed.', 'error');
    }
}

async function copyHostedHtmlToolUrl(slot) {
    const slotKey = normalizeHostedToolSlot(slot);
    const input = document.getElementById(`htmlToolPublicUrl_${slotKey}`);
    const url = input ? String(input.value || '').trim() : '';
    if (!url) return;
    try {
        await navigator.clipboard.writeText(url);
        if (typeof showToast === 'function') showToast('Hosted tool URL copied.', 'success');
    } catch (err) {
        input.select();
        document.execCommand('copy');
        if (typeof showToast === 'function') showToast('Hosted tool URL copied.', 'success');
    }
}

function openHostedHtmlToolUrl(slot) {
    const slotKey = normalizeHostedToolSlot(slot);
    const input = document.getElementById(`htmlToolPublicUrl_${slotKey}`);
    const url = input ? String(input.value || '').trim() : '';
    if (url) window.open(url, '_blank', 'noopener');
}

window.loadHostedHtmlTool = loadHostedHtmlTool;
window.uploadHostedHtmlTool = uploadHostedHtmlTool;
window.removeHostedHtmlTool = removeHostedHtmlTool;
window.copyHostedHtmlToolUrl = copyHostedHtmlToolUrl;
window.openHostedHtmlToolUrl = openHostedHtmlToolUrl;
window.loadHostedHtmlToolUsage = loadHostedHtmlToolUsage;
