#!/usr/bin/env node

/*
 * Deep read-only audit for root data integrity problems.
 *
 * Focuses on lifecycle leaks, assessment/test/schedule wiring, and row/document
 * mismatches that can make UI graphs, locks, reports, and learning material look
 * wrong even when individual screens seem to work.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, 'ops', 'reports');

const ROW_TABLES = [
    'users',
    'records',
    'submissions',
    'attendance',
    'saved_reports',
    'insight_reviews',
    'exemptions',
    'live_bookings',
    'live_sessions',
    'monitor_history',
    'link_requests',
    'tl_task_submissions'
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

function scoreOf(row) {
    const n = Number(dataOf(row).score);
    return Number.isFinite(n) ? n : null;
}

function timeOf(row) {
    const data = dataOf(row);
    return Date.parse(data.lastEditedDate || data.lastModified || data.createdAt || data.date || row.updated_at || '') || 0;
}

function isInactive(row) {
    const data = dataOf(row);
    const status = String(data.status || '').trim().toLowerCase();
    return data.archived === true || ['archived', 'deleted', 'invalid', 'retake_allowed'].includes(status);
}

function sameIdentity(a, b) {
    return token(a) && token(a) === token(b);
}

function groupBy(list, keyFn) {
    const map = new Map();
    (list || []).forEach((item) => {
        const key = keyFn(item);
        if (!key) return;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(item);
    });
    return map;
}

function firstN(list, limit = 25) {
    return (list || []).slice(0, limit);
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
        throw new Error(`${response.status} ${response.statusText}${text ? `: ${text.slice(0, 240)}` : ''}`);
    }
    if (response.status === 204) return null;
    return response.json();
}

async function fetchTable(baseUrl, key, table, options = {}) {
    const pageSize = 1000;
    const maxRows = Number(options.maxRows || 50000);
    const rows = [];
    for (let offset = 0; offset < maxRows; offset += pageSize) {
        const page = await fetchJson(`${baseUrl}/rest/v1/${encodeURIComponent(table)}?select=*&limit=${pageSize}&offset=${offset}`, key);
        if (!Array.isArray(page) || page.length === 0) break;
        rows.push(...page);
        if (page.length < pageSize) break;
    }
    return rows;
}

async function fetchRowsByIds(baseUrl, key, table, ids) {
    const uniqueIds = [...new Set((ids || []).filter(Boolean).map(String))];
    const rows = [];
    for (let index = 0; index < uniqueIds.length; index += 80) {
        const chunk = uniqueIds.slice(index, index + 80);
        if (!chunk.length) continue;
        const inList = chunk.map(encodeURIComponent).join(',');
        const page = await fetchJson(`${baseUrl}/rest/v1/${encodeURIComponent(table)}?select=*&id=in.(${inList})`, key);
        if (Array.isArray(page)) rows.push(...page);
    }
    return rows;
}

function docContent(docs, key) {
    const row = docs.find(item => item && item.key === key);
    return row ? row.content : null;
}

function collectArchiveRows(archives, bucket) {
    const byId = new Map();
    (archives || []).forEach((archive) => {
        const movedTs = Date.parse(archive && (archive.movedDate || archive.graduatedDate || archive.createdAt || '')) || 0;
        const rows = Array.isArray(archive && archive[bucket]) ? archive[bucket] : [];
        rows.forEach((row) => {
            const id = idOf(row);
            if (!id) return;
            if (!byId.has(id)) byId.set(id, []);
            byId.get(id).push({
                archiveId: archive.id || '',
                user: archive.user || archive.username || '',
                movedDate: archive.movedDate || archive.graduatedDate || '',
                movedTs
            });
        });
    });
    return byId;
}

function auditArchiveLeakage(tables, docs) {
    const archives = Array.isArray(docContent(docs, 'retrain_archives')) ? docContent(docs, 'retrain_archives') : [];
    const graduated = Array.isArray(docContent(docs, 'graduated_agents')) ? docContent(docs, 'graduated_agents') : [];
    const allArchives = [...archives, ...graduated];
    const bucketMap = [
        ['records', 'records'],
        ['submissions', 'submissions'],
        ['attendance', 'attendance'],
        ['liveBookings', 'live_bookings'],
        ['reports', 'saved_reports'],
        ['reviews', 'insight_reviews'],
        ['exemptions', 'exemptions'],
        ['linkRequests', 'link_requests'],
        ['tlTaskSubmissions', 'tl_task_submissions']
    ];

    const duplicatedLiveArchiveRows = [];
    bucketMap.forEach(([bucket, table]) => {
        const liveRows = tables[table] || [];
        const archiveById = collectArchiveRows(allArchives, bucket);
        liveRows.forEach((row) => {
            const id = idOf(row);
            if (!id || !archiveById.has(id)) return;
            duplicatedLiveArchiveRows.push({
                table,
                id,
                owner: ownerOf(row),
                title: titleOf(row),
                archives: archiveById.get(id)
            });
        });
    });

    const activeAfterRetrainByUser = [];
    const archivesByUser = groupBy(archives, entry => token(entry && (entry.user || entry.username)));
    archivesByUser.forEach((items, userKey) => {
        const latestMoveTs = Math.max(...items.map(item => Date.parse(item.movedDate || item.graduatedDate || '') || 0));
        if (!Number.isFinite(latestMoveTs) || latestMoveTs <= 0) return;
        const name = (items.find(Boolean) || {}).user || userKey;
        const staleRecords = (tables.records || []).filter(row => token(ownerOf(row)) === userKey && timeOf(row) <= latestMoveTs);
        const staleSubmissions = (tables.submissions || []).filter(row => token(ownerOf(row)) === userKey && timeOf(row) <= latestMoveTs && !isInactive(row));
        if (staleRecords.length || staleSubmissions.length) {
            activeAfterRetrainByUser.push({
                user: name,
                latestMoveDate: new Date(latestMoveTs).toISOString(),
                activePreMoveRecords: staleRecords.length,
                activePreMoveSubmissions: staleSubmissions.length,
                recordSamples: firstN(staleRecords.map(row => ({ id: idOf(row), title: titleOf(row), date: dataOf(row).date || '', groupID: dataOf(row).groupID || '' })), 8),
                submissionSamples: firstN(staleSubmissions.map(row => ({ id: idOf(row), title: titleOf(row), status: dataOf(row).status || '', archived: dataOf(row).archived === true, date: dataOf(row).date || '' })), 8)
            });
        }
    });

    return {
        retrainArchiveCount: archives.length,
        graduatedArchiveCount: graduated.length,
        duplicatedLiveArchiveRows: duplicatedLiveArchiveRows.length,
        duplicatedLiveArchiveSamples: firstN(duplicatedLiveArchiveRows, 40),
        activeAfterRetrainUsers: activeAfterRetrainByUser.length,
        activeAfterRetrainSamples: firstN(activeAfterRetrainByUser, 25)
    };
}

function auditLearningWiring(tables, docs) {
    const tests = Array.isArray(docContent(docs, 'tests')) ? docContent(docs, 'tests') : [];
    const schedules = docContent(docs, 'schedules') && typeof docContent(docs, 'schedules') === 'object' ? docContent(docs, 'schedules') : {};
    const rosters = docContent(docs, 'rosters') && typeof docContent(docs, 'rosters') === 'object' ? docContent(docs, 'rosters') : {};
    const testsById = new Map(tests.map(test => [String(test && test.id), test]));
    const testsByTitle = new Map(tests.map(test => [normalize(test && (test.title || test.name)), test]).filter(([key]) => key));

    const scheduleItems = [];
    Object.entries(schedules || {}).forEach(([scheduleId, schedule]) => {
        const items = Array.isArray(schedule && schedule.items) ? schedule.items : [];
        items.forEach((item, index) => scheduleItems.push({ scheduleId, assigned: schedule.assigned || '', index, item }));
    });

    const scheduleMissingTests = scheduleItems.filter(({ item }) => item && item.linkedTestId && !testsById.has(String(item.linkedTestId)));
    const scheduleBlankMaterials = scheduleItems.filter(({ item }) => {
        const url = String(item && (item.materialLink || item.materialUrl || item.link || '') || '').trim();
        return !url;
    });
    const scheduleBadMaterialUrls = scheduleItems.filter(({ item }) => {
        const url = String(item && (item.materialLink || item.materialUrl || item.link || '') || '').trim();
        if (!url) return false;
        return !/^(https?:\/\/|file:|app:)/i.test(url);
    });
    const scheduleMissingRoster = scheduleItems.filter(({ assigned }) => assigned && !Object.prototype.hasOwnProperty.call(rosters, assigned));

    const activeSubmissions = (tables.submissions || []).filter(row => !isInactive(row));
    const submissionsMissingTests = activeSubmissions.filter(row => {
        const data = dataOf(row);
        if (data.testId && testsById.has(String(data.testId))) return false;
        if (titleOf(row) && testsByTitle.has(normalize(titleOf(row)))) return false;
        return true;
    });
    const submissionsTitleMismatch = activeSubmissions.filter(row => {
        const data = dataOf(row);
        if (!data.testId || !testsById.has(String(data.testId))) return false;
        const test = testsById.get(String(data.testId));
        const expected = normalize(test && (test.title || test.name));
        const actual = normalize(data.testTitle || data.assessment || '');
        return expected && actual && expected !== actual;
    });

    const records = tables.records || [];
    const recordsMissingSubmissions = records.filter(row => {
        const subId = String(dataOf(row).submissionId || '').trim();
        if (!subId) return false;
        return !(tables.submissions || []).some(sub => idOf(sub) === subId);
    });
    const completedSubmissionsMissingRecords = activeSubmissions.filter(row => {
        const data = dataOf(row);
        if (String(data.status || '').toLowerCase() !== 'completed') return false;
        return !(tables.records || []).some(record => String(dataOf(record).submissionId || '') === idOf(row));
    });

    return {
        tests: tests.length,
        schedules: Object.keys(schedules || {}).length,
        scheduleItems: scheduleItems.length,
        scheduleMissingTests: scheduleMissingTests.length,
        scheduleMissingTestSamples: firstN(scheduleMissingTests.map(({ scheduleId, assigned, index, item }) => ({
            scheduleId,
            assigned,
            index,
            linkedTestId: item.linkedTestId || '',
            courseName: item.courseName || item.title || ''
        })), 30),
        scheduleBlankMaterials: scheduleBlankMaterials.length,
        scheduleBlankMaterialSamples: firstN(scheduleBlankMaterials.map(({ scheduleId, assigned, index, item }) => ({
            scheduleId,
            assigned,
            index,
            linkedTestId: item.linkedTestId || '',
            courseName: item.courseName || item.title || ''
        })), 30),
        scheduleBadMaterialUrls: scheduleBadMaterialUrls.length,
        scheduleBadMaterialUrlSamples: firstN(scheduleBadMaterialUrls.map(({ scheduleId, assigned, index, item }) => ({
            scheduleId,
            assigned,
            index,
            materialLink: item.materialLink || item.materialUrl || item.link || '',
            courseName: item.courseName || item.title || ''
        })), 30),
        scheduleMissingRoster: scheduleMissingRoster.length,
        scheduleMissingRosterSamples: firstN(scheduleMissingRoster.map(({ scheduleId, assigned }) => ({ scheduleId, assigned })), 20),
        activeSubmissionsMissingTests: submissionsMissingTests.length,
        activeSubmissionMissingTestSamples: firstN(submissionsMissingTests.map(row => ({
            id: idOf(row),
            owner: ownerOf(row),
            testId: dataOf(row).testId || '',
            title: titleOf(row),
            status: dataOf(row).status || ''
        })), 30),
        activeSubmissionTitleMismatches: submissionsTitleMismatch.length,
        activeSubmissionTitleMismatchSamples: firstN(submissionsTitleMismatch.map(row => ({
            id: idOf(row),
            owner: ownerOf(row),
            testId: dataOf(row).testId || '',
            submissionTitle: titleOf(row),
            testTitle: testsById.get(String(dataOf(row).testId))?.title || ''
        })), 30),
        recordsMissingSubmissions: recordsMissingSubmissions.length,
        recordsMissingSubmissionSamples: firstN(recordsMissingSubmissions.map(row => ({
            id: idOf(row),
            owner: ownerOf(row),
            title: titleOf(row),
            submissionId: dataOf(row).submissionId || ''
        })), 30),
        completedSubmissionsMissingRecords: completedSubmissionsMissingRecords.length,
        completedSubmissionMissingRecordSamples: firstN(completedSubmissionsMissingRecords.map(row => ({
            id: idOf(row),
            owner: ownerOf(row),
            title: titleOf(row),
            score: scoreOf(row),
            date: dataOf(row).date || ''
        })), 30)
    };
}

function auditUsers(tables, docs) {
    const users = tables.users || [];
    const rosters = docContent(docs, 'rosters') && typeof docContent(docs, 'rosters') === 'object' ? docContent(docs, 'rosters') : {};
    const usersByToken = groupBy(users, row => token(dataOf(row).user || dataOf(row).username || row.user));
    const duplicateUsers = [...usersByToken.entries()].filter(([, list]) => list.length > 1);
    const rosterNames = new Set();
    Object.values(rosters || {}).forEach(members => (Array.isArray(members) ? members : []).forEach(name => rosterNames.add(token(name))));
    const rosterMissingUser = [...rosterNames].filter(nameToken => nameToken && !usersByToken.has(nameToken));
    const activeUsersNotInRoster = users.filter(row => {
        const data = dataOf(row);
        if (String(data.role || '').toLowerCase() !== 'trainee') return false;
        const status = String(data.status || 'active').toLowerCase();
        if (['blocked', 'archived', 'deleted', 'inactive'].includes(status) || data.archived === true) return false;
        return !rosterNames.has(token(data.user || data.username || row.user));
    });

    return {
        userRows: users.length,
        duplicateLogicalUsers: duplicateUsers.length,
        duplicateUserSamples: firstN(duplicateUsers.map(([userKey, list]) => ({
            userKey,
            rowIds: list.map(row => row.id),
            names: list.map(row => dataOf(row).user || dataOf(row).username || '')
        })), 30),
        rosterMembersMissingUserRows: rosterMissingUser.length,
        rosterMissingUserSamples: firstN(rosterMissingUser, 30),
        activeTraineesNotInRoster: activeUsersNotInRoster.length,
        activeTraineesNotInRosterSamples: firstN(activeUsersNotInRoster.map(row => ({
            id: idOf(row),
            user: dataOf(row).user || dataOf(row).username || '',
            status: dataOf(row).status || ''
        })), 30)
    };
}

function scoreSeverity(summary) {
    return (
        summary.archiveLeakage.duplicatedLiveArchiveRows * 3 +
        summary.archiveLeakage.activeAfterRetrainUsers * 10 +
        summary.learning.activeSubmissionsMissingTests * 2 +
        summary.learning.scheduleMissingTests * 3 +
        summary.learning.recordsMissingSubmissions +
        summary.learning.completedSubmissionsMissingRecords * 2 +
        summary.users.duplicateLogicalUsers
    );
}

function getArchiveIdsByTable(docs) {
    const archives = Array.isArray(docContent(docs, 'retrain_archives')) ? docContent(docs, 'retrain_archives') : [];
    const graduated = Array.isArray(docContent(docs, 'graduated_agents')) ? docContent(docs, 'graduated_agents') : [];
    const allArchives = [...archives, ...graduated];
    const bucketMap = [
        ['records', 'records'],
        ['submissions', 'submissions'],
        ['attendance', 'attendance'],
        ['liveBookings', 'live_bookings'],
        ['reports', 'saved_reports'],
        ['reviews', 'insight_reviews'],
        ['exemptions', 'exemptions'],
        ['linkRequests', 'link_requests'],
        ['tlTaskSubmissions', 'tl_task_submissions']
    ];
    const idsByTable = {};
    bucketMap.forEach(([bucket, table]) => {
        const ids = [];
        allArchives.forEach((archive) => {
            const rows = Array.isArray(archive && archive[bucket]) ? archive[bucket] : [];
            rows.forEach(row => {
                const id = idOf(row);
                if (id) ids.push(id);
            });
        });
        idsByTable[table] = [...new Set(ids)];
    });
    return idsByTable;
}

async function main() {
    const { url, key, source } = readCredentials();
    const docs = await fetchTable(url, key, 'app_documents');
    const archiveIdsByTable = getArchiveIdsByTable(docs);
    const tableRows = await Promise.all(ROW_TABLES.map(async (table) => {
        if (archiveIdsByTable[table] && archiveIdsByTable[table].length > 0 && ['attendance', 'saved_reports', 'insight_reviews', 'exemptions', 'live_bookings', 'link_requests', 'tl_task_submissions'].includes(table)) {
            const archivedLiveRows = await fetchRowsByIds(url, key, table, archiveIdsByTable[table]);
            if (['attendance', 'tl_task_submissions'].includes(table)) return archivedLiveRows;
            const allRows = await fetchTable(url, key, table, { maxRows: 15000 });
            const merged = new Map();
            [...archivedLiveRows, ...allRows].forEach(row => merged.set(String(row.id), row));
            return [...merged.values()];
        }
        return fetchTable(url, key, table, { maxRows: 20000 });
    }));
    const tables = {};
    ROW_TABLES.forEach((table, index) => {
        tables[table] = tableRows[index] || [];
    });

    const summary = {
        generatedAt: new Date().toISOString(),
        source,
        counts: {
            appDocuments: docs.length,
            ...Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length]))
        },
        archiveLeakage: auditArchiveLeakage(tables, docs),
        learning: auditLearningWiring(tables, docs),
        users: auditUsers(tables, docs)
    };
    summary.riskScore = scoreSeverity(summary);

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(REPORT_DIR, `root_integrity_audit_${stamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));

    console.log(JSON.stringify({
        reportPath,
        riskScore: summary.riskScore,
        archiveLeakage: {
            duplicatedLiveArchiveRows: summary.archiveLeakage.duplicatedLiveArchiveRows,
            activeAfterRetrainUsers: summary.archiveLeakage.activeAfterRetrainUsers
        },
        learning: {
            scheduleMissingTests: summary.learning.scheduleMissingTests,
            scheduleBlankMaterials: summary.learning.scheduleBlankMaterials,
            scheduleBadMaterialUrls: summary.learning.scheduleBadMaterialUrls,
            activeSubmissionsMissingTests: summary.learning.activeSubmissionsMissingTests,
            completedSubmissionsMissingRecords: summary.learning.completedSubmissionsMissingRecords
        },
        users: {
            duplicateLogicalUsers: summary.users.duplicateLogicalUsers,
            activeTraineesNotInRoster: summary.users.activeTraineesNotInRoster
        }
    }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
