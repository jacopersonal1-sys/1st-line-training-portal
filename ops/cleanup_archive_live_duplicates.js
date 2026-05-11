#!/usr/bin/env node

/*
 * Remove live rows that are already preserved inside retrain/graduation archives.
 *
 * Default mode is dry-run. Use --apply to delete exact live row IDs that already
 * exist inside app_documents.retrain_archives or app_documents.graduated_agents.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'ops', 'reports');

const BUCKETS = [
    { archiveKey: 'records', table: 'records' },
    { archiveKey: 'submissions', table: 'submissions' },
    { archiveKey: 'attendance', table: 'attendance' },
    { archiveKey: 'liveBookings', table: 'live_bookings' },
    { archiveKey: 'reports', table: 'saved_reports' },
    { archiveKey: 'reviews', table: 'insight_reviews' },
    { archiveKey: 'exemptions', table: 'exemptions' },
    { archiveKey: 'linkRequests', table: 'link_requests' },
    { archiveKey: 'tlTaskSubmissions', table: 'tl_task_submissions' }
];

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

function dataOf(row) {
    return row && row.data && typeof row.data === 'object' ? row.data : (row || {});
}

function idOf(row) {
    const data = dataOf(row);
    return String(data.id || row.id || '').trim();
}

function ownerOf(row) {
    const data = dataOf(row);
    return String(data.trainee || data.user || data.user_id || data.username || row.trainee || row.user_id || '').trim();
}

function titleOf(row) {
    const data = dataOf(row);
    return String(data.assessment || data.testTitle || data.title || data.name || '').trim();
}

function unique(values) {
    return [...new Set((values || []).filter(Boolean).map(String))];
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
        throw new Error(`${options.method || 'GET'} ${url}: ${response.status} ${text.slice(0, 300)}`);
    }
    if (response.status === 204) return null;
    return response.json();
}

async function fetchTable(baseUrl, key, table) {
    const rows = [];
    const limit = 1000;
    for (let offset = 0; offset < 50000; offset += limit) {
        const page = await fetchJson(`${baseUrl}/rest/v1/${encodeURIComponent(table)}?select=*&limit=${limit}&offset=${offset}`, key);
        if (!Array.isArray(page) || page.length === 0) break;
        rows.push(...page);
        if (page.length < limit) break;
    }
    return rows;
}

async function fetchRowsByIds(baseUrl, key, table, ids) {
    const rows = [];
    const allIds = unique(ids);
    for (let index = 0; index < allIds.length; index += 80) {
        const chunk = allIds.slice(index, index + 80);
        if (!chunk.length) continue;
        const inList = chunk.map(encodeURIComponent).join(',');
        const page = await fetchJson(`${baseUrl}/rest/v1/${encodeURIComponent(table)}?select=*&id=in.(${inList})`, key);
        if (Array.isArray(page)) rows.push(...page);
    }
    return rows;
}

async function deleteRowsByIds(baseUrl, key, table, ids) {
    const deleted = [];
    const allIds = unique(ids);
    for (let index = 0; index < allIds.length; index += 80) {
        const chunk = allIds.slice(index, index + 80);
        if (!chunk.length) continue;
        const inList = chunk.map(encodeURIComponent).join(',');
        const page = await fetchJson(`${baseUrl}/rest/v1/${encodeURIComponent(table)}?id=in.(${inList})`, key, {
            method: 'DELETE',
            headers: { prefer: 'return=representation' }
        });
        if (Array.isArray(page)) deleted.push(...page);
    }
    return deleted;
}

function collectArchivedIds(archives) {
    const result = {};
    BUCKETS.forEach(({ table }) => {
        result[table] = new Map();
    });

    (archives || []).forEach((archive) => {
        BUCKETS.forEach(({ archiveKey, table }) => {
            const rows = Array.isArray(archive && archive[archiveKey]) ? archive[archiveKey] : [];
            rows.forEach((row) => {
                const id = idOf(row);
                if (!id) return;
                if (!result[table].has(id)) result[table].set(id, []);
                result[table].get(id).push({
                    archiveId: archive.id || '',
                    archiveUser: archive.user || archive.username || '',
                    archiveDate: archive.movedDate || archive.graduatedDate || ''
                });
            });
        });
    });

    return result;
}

async function main() {
    const apply = process.argv.includes('--apply');
    const { url, key, source } = readCredentials();
    const docs = await fetchTable(url, key, 'app_documents');
    const retrain = docs.find(row => row.key === 'retrain_archives');
    const graduated = docs.find(row => row.key === 'graduated_agents');
    const archives = [
        ...(Array.isArray(retrain && retrain.content) ? retrain.content : []),
        ...(Array.isArray(graduated && graduated.content) ? graduated.content : [])
    ];
    const archiveIdsByTable = collectArchivedIds(archives);

    const plan = [];
    for (const { table } of BUCKETS) {
        const archivedIds = [...archiveIdsByTable[table].keys()];
        const liveRows = await fetchRowsByIds(url, key, table, archivedIds);
        const matches = (Array.isArray(liveRows) ? liveRows : [])
            .filter(row => archiveIdsByTable[table].has(String(row.id)))
            .map(row => ({
                id: String(row.id),
                owner: ownerOf(row),
                title: titleOf(row),
                data: row.data || row,
                archives: archiveIdsByTable[table].get(String(row.id))
            }));

        plan.push({
            table,
            archivedIds: archivedIds.length,
            liveDuplicateCount: matches.length,
            liveDuplicates: matches
        });
    }

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(REPORT_DIR, `archive_live_duplicate_cleanup_backup_${stamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify({ generatedAt: new Date().toISOString(), mode: apply ? 'apply' : 'dry_run', source, plan }, null, 2));

    const deleteSummary = [];
    if (apply) {
        for (const item of plan) {
            const ids = item.liveDuplicates.map(row => row.id);
            if (!ids.length) {
                deleteSummary.push({ table: item.table, deleted: 0, ids: [] });
                continue;
            }
            const deleted = await deleteRowsByIds(url, key, item.table, ids);
            deleteSummary.push({ table: item.table, deleted: deleted.length, ids });
        }
    }

    const verify = [];
    for (const { table } of BUCKETS) {
        const archivedIds = [...archiveIdsByTable[table].keys()];
        const remaining = await fetchRowsByIds(url, key, table, archivedIds);
        verify.push({
            table,
            remainingDuplicateCount: Array.isArray(remaining) ? remaining.length : 0,
            ids: (Array.isArray(remaining) ? remaining : []).map(row => row.id)
        });
    }

    const reportPath = path.join(REPORT_DIR, `archive_live_duplicate_cleanup_${apply ? 'apply' : 'dry_run'}_${stamp}.json`);
    const report = {
        generatedAt: new Date().toISOString(),
        mode: apply ? 'apply' : 'dry_run',
        source,
        backupPath,
        deleteSummary,
        verify,
        totals: {
            plannedLiveDuplicates: plan.reduce((sum, item) => sum + item.liveDuplicateCount, 0),
            deleted: deleteSummary.reduce((sum, item) => sum + Number(item.deleted || 0), 0),
            remainingAfter: verify.reduce((sum, item) => sum + Number(item.remainingDuplicateCount || 0), 0)
        }
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(JSON.stringify({
        backupPath,
        reportPath,
        mode: report.mode,
        totals: report.totals,
        byTable: (apply ? deleteSummary : plan).map(item => ({
            table: item.table,
            planned: item.liveDuplicateCount,
            deleted: item.deleted
        }))
    }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
