#!/usr/bin/env node

/*
 * Focused retrain archive cleanup.
 *
 * Default mode is dry-run. Use --apply to update the retrain_archives app document.
 * The script keeps the earliest retrain archive for the configured users, relabels
 * it as Attempt 1, and removes later duplicate/manual snapshots from archive history.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'ops', 'reports');

const USERS_TO_CLEAN = new Set([
    'sichumilemakaula',
    'nompumelelodzingwa',
    'santinofransman'
]);

function readCredentials() {
    const envUrl = process.env.SUPABASE_URL || '';
    const envKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';
    if (envUrl && envKey) return { url: envUrl.replace(/\/$/, ''), key: envKey, source: 'environment' };

    const configPath = path.join(ROOT, 'js', 'config.js');
    const text = fs.readFileSync(configPath, 'utf8');
    const urlMatch = text.match(/url:\s*['"]([^'"]+)['"]/);
    const keyMatch = text.match(/key:\s*['"]([^'"]+)['"]/);
    if (!urlMatch || !keyMatch) throw new Error('Could not read Supabase credentials.');
    return { url: urlMatch[1].replace(/\/$/, ''), key: keyMatch[1], source: 'js/config.js' };
}

function normalizeIdentity(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[._-]+/g, ' ')
        .replace(/\s+/g, '')
        .trim();
}

function archiveTime(entry) {
    return Date.parse(entry && (entry.movedDate || entry.graduatedDate || entry.createdAt || entry.date)) || 0;
}

async function fetchJson(url, key, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            apikey: key,
            authorization: `Bearer ${key}`,
            accept: 'application/json',
            'content-type': 'application/json',
            'ngrok-skip-browser-warning': 'true',
            ...(options.headers || {})
        }
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`${response.status} ${response.statusText}${text ? `: ${text.slice(0, 300)}` : ''}`);
    }
    if (response.status === 204) return null;
    return response.json();
}

function buildCleanup(content) {
    const archives = Array.isArray(content) ? content : [];
    const byUser = new Map();
    archives.forEach((entry, index) => {
        const userKey = normalizeIdentity(entry && entry.user);
        if (!USERS_TO_CLEAN.has(userKey)) return;
        if (!byUser.has(userKey)) byUser.set(userKey, []);
        byUser.get(userKey).push({ entry, index });
    });

    const removeIndexes = new Set();
    const plan = [];
    byUser.forEach((items, userKey) => {
        const sorted = [...items].sort((a, b) => archiveTime(a.entry) - archiveTime(b.entry));
        const keep = sorted[0];
        const remove = sorted.slice(1);
        remove.forEach(item => removeIndexes.add(item.index));

        plan.push({
            user: keep && keep.entry ? keep.entry.user : userKey,
            userKey,
            keep: keep ? {
                id: keep.entry.id,
                movedDate: keep.entry.movedDate || keep.entry.graduatedDate || keep.entry.createdAt || '',
                records: Array.isArray(keep.entry.records) ? keep.entry.records.length : 0,
                submissions: Array.isArray(keep.entry.submissions) ? keep.entry.submissions.length : 0,
                attendance: Array.isArray(keep.entry.attendance) ? keep.entry.attendance.length : 0
            } : null,
            remove: remove.map(item => ({
                id: item.entry.id,
                movedDate: item.entry.movedDate || item.entry.graduatedDate || item.entry.createdAt || '',
                reason: item.entry.reason || '',
                records: Array.isArray(item.entry.records) ? item.entry.records.length : 0,
                submissions: Array.isArray(item.entry.submissions) ? item.entry.submissions.length : 0,
                attendance: Array.isArray(item.entry.attendance) ? item.entry.attendance.length : 0
            }))
        });
    });

    const cleaned = archives
        .filter((entry, index) => !removeIndexes.has(index))
        .map(entry => {
            const userKey = normalizeIdentity(entry && entry.user);
            if (!USERS_TO_CLEAN.has(userKey)) return entry;
            return {
                ...entry,
                attemptNumber: 1,
                attemptLabel: 'Attempt 1',
                cleanupNote: 'Retained as the only first-attempt archive; current live data represents attempt 2.',
                cleanupUpdatedAt: new Date().toISOString()
            };
        });

    return { cleaned, plan, removedCount: removeIndexes.size };
}

async function main() {
    const apply = process.argv.includes('--apply');
    const { url, key, source } = readCredentials();
    const rows = await fetchJson(`${url}/rest/v1/app_documents?select=key,content,updated_at&key=eq.retrain_archives&limit=1`, key);
    const row = rows && rows[0];
    if (!row) throw new Error('retrain_archives document not found.');

    const original = Array.isArray(row.content) ? row.content : [];
    const { cleaned, plan, removedCount } = buildCleanup(original);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const backupPath = path.join(REPORT_DIR, `retrain_archives_backup_${stamp}.json`);
    const planPath = path.join(REPORT_DIR, `retrain_archives_cleanup_plan_${stamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify({ updated_at: row.updated_at, content: original }, null, 2));
    fs.writeFileSync(planPath, JSON.stringify({ generatedAt: new Date().toISOString(), apply, source, removedCount, plan }, null, 2));

    if (apply && removedCount > 0) {
        await fetchJson(`${url}/rest/v1/app_documents?key=eq.retrain_archives`, key, {
            method: 'PATCH',
            headers: { prefer: 'return=minimal' },
            body: JSON.stringify({ content: cleaned, updated_at: new Date().toISOString() })
        });
    }

    console.log(JSON.stringify({
        mode: apply ? 'applied' : 'dry_run',
        removedCount,
        backupPath,
        planPath,
        plan
    }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
