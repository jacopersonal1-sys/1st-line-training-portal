#!/usr/bin/env node

/*
 * One-time Supabase cleanup for duplicate logical user rows.
 *
 * Dry-run by default. With --apply, it merges each duplicate set into one
 * keeper row, upserts that keeper, deletes the duplicate row ids, then verifies
 * no duplicate logical users remain.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'ops', 'reports');
const APPLY = process.argv.includes('--apply');

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

function normalize(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[._-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function token(value) {
    return normalize(value).replace(/\s+/g, '');
}

function canonicalUserId(name) {
    const slug = String(name || '').trim().toLowerCase().replace(/\s+/g, '_');
    return slug ? `user_${slug}` : '';
}

function dataOf(row) {
    return row && row.data && typeof row.data === 'object' ? row.data : {};
}

function ownerOf(row) {
    const data = dataOf(row);
    return String(data.user || data.username || '').trim();
}

function timeOf(row) {
    const data = dataOf(row);
    return Date.parse(data.lastModified || data.updatedAt || data.createdAt || row.updated_at || '') || 0;
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
    return JSON.parse(JSON.stringify(value || {}));
}

function mergeFresh(base, incoming) {
    const merged = clone(base);
    Object.entries(incoming || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        if (isPlainObject(value) && isPlainObject(merged[key])) {
            merged[key] = mergeFresh(merged[key], value);
            return;
        }
        merged[key] = clone(value);
    });
    return merged;
}

function chooseKeeper(rows) {
    const named = ownerOf(rows[0]);
    const canonical = canonicalUserId(named);
    const canonicalRow = rows.find(row => String(row.id || '') === canonical || String(dataOf(row).id || '') === canonical);
    if (canonicalRow) return canonicalRow;
    const deterministicRow = rows.find(row => String(row.id || '').startsWith('user_') || String(dataOf(row).id || '').startsWith('user_'));
    if (deterministicRow) return deterministicRow;

    return [...rows].sort((a, b) => {
        const dataA = dataOf(a);
        const dataB = dataOf(b);
        const scoreA = (dataA.status ? 20 : 0) + (dataA.pass ? 10 : 0) + (dataA.role ? 10 : 0) + (dataA.traineeData ? 5 : 0);
        const scoreB = (dataB.status ? 20 : 0) + (dataB.pass ? 10 : 0) + (dataB.role ? 10 : 0) + (dataB.traineeData ? 5 : 0);
        if (scoreA !== scoreB) return scoreB - scoreA;
        return timeOf(b) - timeOf(a);
    })[0];
}

function buildPlan(rows) {
    const groups = new Map();
    rows.forEach(row => {
        const key = token(ownerOf(row));
        if (!key) return;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(row);
    });

    const actions = [];
    groups.forEach(groupRows => {
        if (groupRows.length < 2) return;
        const keeper = chooseKeeper(groupRows);
        const keeperId = String(keeper.id || dataOf(keeper).id || '');
        const sorted = [...groupRows].sort((a, b) => timeOf(a) - timeOf(b));
        const mergedData = sorted.reduce((acc, row) => mergeFresh(acc, dataOf(row)), {});
        mergedData.id = keeperId;
        mergedData.user = mergedData.user || ownerOf(keeper);
        mergedData.lastModified = new Date().toISOString();
        mergedData.modifiedBy = mergedData.modifiedBy || 'duplicate-user-cleanup';

        const deleteIds = groupRows
            .map(row => String(row.id || ''))
            .filter(id => id && id !== keeperId);

        actions.push({
            userKey: token(ownerOf(keeper)),
            user: ownerOf(keeper),
            keeperId,
            rowCount: groupRows.length,
            deleteIds,
            mergedData
        });
    });

    return actions;
}

async function fetchJson(url, key, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            apikey: key,
            authorization: `Bearer ${key}`,
            accept: 'application/json',
            'content-type': 'application/json',
            ...(options.headers || {})
        }
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`${response.status} ${response.statusText}${text ? `: ${text.slice(0, 240)}` : ''}`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text);
}

async function fetchAllUsers(baseUrl, key) {
    const rows = [];
    const pageSize = 1000;
    for (let offset = 0; offset < 50000; offset += pageSize) {
        const page = await fetchJson(`${baseUrl}/rest/v1/users?select=*&limit=${pageSize}&offset=${offset}`, key);
        if (!Array.isArray(page) || page.length === 0) break;
        rows.push(...page);
        if (page.length < pageSize) break;
    }
    return rows;
}

async function upsertKeeper(baseUrl, key, action) {
    await fetchJson(`${baseUrl}/rest/v1/users`, key, {
        method: 'POST',
        headers: { prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({
            id: action.keeperId,
            data: action.mergedData,
            updated_at: new Date().toISOString()
        })
    });
}

async function deleteIds(baseUrl, key, ids) {
    if (!ids.length) return 0;
    const escaped = ids.map(id => `"${String(id).replace(/"/g, '\\"')}"`).join(',');
    await fetchJson(`${baseUrl}/rest/v1/users?id=in.(${escaped})`, key, { method: 'DELETE' });
    return ids.length;
}

async function main() {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const creds = readCredentials();

    const beforeRows = await fetchAllUsers(creds.url, creds.key);
    const actions = buildPlan(beforeRows);
    const backupPath = path.join(REPORT_DIR, `duplicate_users_cleanup_backup_${stamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        source: creds.source,
        mode: APPLY ? 'apply' : 'dry_run',
        rows: actions.flatMap(action => beforeRows.filter(row => row.id === action.keeperId || action.deleteIds.includes(row.id)))
    }, null, 2));

    let deleted = 0;
    if (APPLY) {
        for (const action of actions) {
            await upsertKeeper(creds.url, creds.key, action);
            deleted += await deleteIds(creds.url, creds.key, action.deleteIds);
        }
    }

    const afterRows = APPLY ? await fetchAllUsers(creds.url, creds.key) : beforeRows;
    const remaining = buildPlan(afterRows);
    const report = {
        generatedAt: new Date().toISOString(),
        source: creds.source,
        mode: APPLY ? 'apply' : 'dry_run',
        backupPath,
        totals: {
            duplicateGroups: actions.length,
            plannedDeletes: actions.reduce((sum, action) => sum + action.deleteIds.length, 0),
            deleted,
            remainingDuplicateGroups: APPLY ? remaining.length : actions.length
        },
        actions: actions.map(action => ({
            user: action.user,
            keeperId: action.keeperId,
            rowCount: action.rowCount,
            deleteCount: action.deleteIds.length,
            deleteIds: action.deleteIds
        })).slice(0, 200)
    };

    const reportPath = path.join(REPORT_DIR, `duplicate_users_cleanup_${APPLY ? 'apply' : 'dry_run'}_${stamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ reportPath, ...report }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
