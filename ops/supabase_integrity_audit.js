#!/usr/bin/env node

/*
 * Read-only Supabase integrity audit for release checks.
 * It fetches row-synced tables plus key app_documents, then reports duplicate,
 * invalid, stale, and lifecycle-skew risks without mutating production data.
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
    'archived_users',
    'saved_reports',
    'insight_reviews',
    'exemptions',
    'live_bookings',
    'live_sessions',
    'monitor_history',
    'link_requests'
];

const ROW_SYNCED_BLOB_KEYS = new Set([
    'users',
    'records',
    'submissions',
    'auditLogs',
    'error_reports',
    'liveBookings',
    'monitor_history',
    'attendance_records',
    'accessLogs',
    'savedReports',
    'insightReviews',
    'exemptions',
    'liveSessions',
    'nps_responses',
    'graduated_agents',
    'linkRequests',
    'calendarEvents',
    'network_diagnostics',
    'tl_task_submissions'
]);

const APP_DOCUMENT_KEYS = [
    'rosters',
    'retrain_archives',
    'graduated_agents',
    'system_tombstones',
    'system_pending_deletes',
    'violation_reports',
    'insight_rule_config',
    'insight_progress_config',
    'training_rules_config',
    'live_assessment_rules_config',
    'test_integrity_overrides'
];

function readCredentials() {
    const envUrl = process.env.SUPABASE_URL || '';
    const envKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';
    if (envUrl && envKey) return { url: envUrl, key: envKey, source: 'environment' };

    const configPath = path.join(ROOT, 'js', 'config.js');
    const text = fs.readFileSync(configPath, 'utf8');
    const urlMatch = text.match(/url:\s*['"]([^'"]+)['"]/);
    const keyMatch = text.match(/key:\s*['"]([^'"]+)['"]/);
    if (!urlMatch || !keyMatch) {
        throw new Error('Could not read Supabase credentials from js/config.js or environment.');
    }
    return { url: urlMatch[1], key: keyMatch[1], source: 'js/config.js' };
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

function pickUser(row) {
    const data = dataOf(row);
    return String(data.user || data.username || data.name || row.user_id || data.email || '').trim();
}

function pickTrainee(row) {
    const data = dataOf(row);
    return String(data.trainee || data.user || data.username || data.agent || row.trainee || row.user_id || '').trim();
}

function pickScore(row) {
    const data = dataOf(row);
    const score = Number(data.score);
    return Number.isFinite(score) ? score : null;
}

function pickDate(row) {
    const data = dataOf(row);
    return String(data.date || data.createdAt || data.lastModified || row.updated_at || '').trim();
}

function pickAssessment(row) {
    const data = dataOf(row);
    return String(data.assessment || data.testTitle || data.title || '').trim();
}

function dateBucket(value) {
    const clean = String(value || '').trim();
    if (!clean) return '';
    const parsed = new Date(clean);
    if (!Number.isFinite(parsed.getTime())) return clean.slice(0, 10);
    return parsed.toISOString().slice(0, 10);
}

function groupBy(rows, keyFn) {
    const map = new Map();
    (rows || []).forEach((row) => {
        const key = keyFn(row);
        if (!key) return;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(row);
    });
    return Array.from(map.entries()).filter(([, list]) => list.length > 1);
}

function sampleRows(rows, mapper, limit = 12) {
    return (rows || []).slice(0, limit).map(mapper);
}

async function fetchJson(url, key) {
    const response = await fetch(url, {
        headers: {
            apikey: key,
            authorization: `Bearer ${key}`,
            accept: 'application/json',
            'ngrok-skip-browser-warning': 'true'
        }
    });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`${response.status} ${response.statusText}${text ? `: ${text.slice(0, 180)}` : ''}`);
    }
    return response.json();
}

async function fetchTable(baseUrl, key, table) {
    const pageSize = 1000;
    let from = 0;
    const rows = [];
    while (from < 50000) {
        const url = `${baseUrl}/rest/v1/${encodeURIComponent(table)}?select=*&order=updated_at.asc.nullsfirst&limit=${pageSize}&offset=${from}`;
        const page = await fetchJson(url, key);
        if (!Array.isArray(page) || !page.length) break;
        rows.push(...page);
        if (page.length < pageSize) break;
        from += pageSize;
    }
    return rows;
}

async function fetchDocuments(baseUrl, key) {
    const docs = await fetchTable(baseUrl, key, 'app_documents');
    const map = {};
    docs.forEach((row) => {
        if (row && row.key) map[row.key] = row;
    });
    return { rows: docs, map };
}

function auditUsers(rows) {
    const duplicateUsers = groupBy(rows, row => token(pickUser(row)));
    const invalid = rows.filter((row) => {
        const data = dataOf(row);
        return !pickUser(row) || !String(data.role || '').trim();
    });
    return {
        count: rows.length,
        duplicateLogicalUsers: duplicateUsers.length,
        invalidUsers: invalid.length,
        duplicateSamples: sampleRows(duplicateUsers, ([key, list]) => ({
            userKey: key,
            rowIds: list.map(row => row.id),
            names: list.map(row => pickUser(row))
        })),
        invalidSamples: sampleRows(invalid, row => ({ id: row.id, user: pickUser(row), role: dataOf(row).role || null }))
    };
}

function pickLatestRow(rows) {
    return [...(rows || [])].sort((a, b) => {
        const ta = Date.parse(a && a.updated_at || dataOf(a).lastModified || dataOf(a).updatedAt || dataOf(a).createdAt || '') || 0;
        const tb = Date.parse(b && b.updated_at || dataOf(b).lastModified || dataOf(b).updatedAt || dataOf(b).createdAt || '') || 0;
        return tb - ta;
    })[0] || null;
}

function chooseCanonicalUserRow(list) {
    const deterministic = (list || []).find(row => String(row.id || '').startsWith('user_'));
    if (deterministic) return deterministic;
    return pickLatestRow(list);
}

function auditRecords(rows, context) {
    const duplicateSubmissionLinks = groupBy(rows, (row) => {
        const data = dataOf(row);
        return data.submissionId ? `submission:${token(data.submissionId)}` : '';
    });
    const duplicateLogicalScores = groupBy(rows, (row) => {
        const data = dataOf(row);
        const trainee = token(pickTrainee(row));
        const assessment = token(data.assessment);
        const group = token(data.groupID || data.groupId || data.group);
        const phase = token(data.phase);
        if (!trainee || !assessment) return '';
        return `${trainee}|${assessment}|${group}|${phase}`;
    });
    const invalid = rows.filter((row) => {
        const data = dataOf(row);
        const score = pickScore(row);
        return !pickTrainee(row)
            || !String(data.assessment || '').trim()
            || score === null
            || score < 0
            || score > 100
            || (pickDate(row) && Number.isNaN(Date.parse(pickDate(row))));
    });
    const hidden = rows.filter((row) => {
        const data = dataOf(row);
        const status = String(data.status || '').toLowerCase();
        return data.archived === true || ['archived', 'deleted', 'invalid', 'retake_allowed'].includes(status);
    });
    const previousGroupRows = rows.filter((row) => {
        const data = dataOf(row);
        const currentGroup = context.groupByUserToken[token(pickTrainee(row))] || '';
        const rowGroup = String(data.groupID || data.groupId || data.group || '').trim();
        return currentGroup && rowGroup && rowGroup !== currentGroup;
    });
    return {
        count: rows.length,
        invalidRecords: invalid.length,
        hiddenOrArchivedRecords: hidden.length,
        duplicateSubmissionLinks: duplicateSubmissionLinks.length,
        duplicateLogicalScores: duplicateLogicalScores.length,
        previousGroupRows: previousGroupRows.length,
        duplicateSubmissionSamples: sampleRows(duplicateSubmissionLinks, ([key, list]) => ({
            key,
            rowIds: list.map(row => row.id),
            trainee: pickTrainee(list[0]),
            assessment: pickAssessment(list[0])
        })),
        duplicateLogicalSamples: sampleRows(duplicateLogicalScores, ([key, list]) => ({
            key,
            count: list.length,
            rowIds: list.map(row => row.id),
            scores: list.map(row => pickScore(row)),
            dates: list.map(row => pickDate(row))
        })),
        invalidSamples: sampleRows(invalid, row => ({
            id: row.id,
            trainee: pickTrainee(row),
            assessment: pickAssessment(row),
            score: pickScore(row),
            date: pickDate(row)
        })),
        previousGroupSamples: sampleRows(previousGroupRows, row => ({
            id: row.id,
            trainee: pickTrainee(row),
            assessment: pickAssessment(row),
            rowGroup: dataOf(row).groupID || dataOf(row).groupId || dataOf(row).group || '',
            currentGroup: context.groupByUserToken[token(pickTrainee(row))] || ''
        }))
    };
}

function auditSubmissions(rows, context) {
    const duplicateIds = groupBy(rows, row => row.id || dataOf(row).id || '');
    const duplicateSessionLinks = groupBy(rows, (row) => {
        const data = dataOf(row);
        const session = data.liveSessionId || data.bookingId || data.sessionId || '';
        return session ? `session:${token(session)}` : '';
    });
    const invalid = rows.filter((row) => {
        const score = pickScore(row);
        return !pickTrainee(row)
            || score === null
            || score < 0
            || score > 100
            || (pickDate(row) && Number.isNaN(Date.parse(pickDate(row))));
    });
    const hidden = rows.filter((row) => {
        const data = dataOf(row);
        const status = String(data.status || '').toLowerCase();
        return data.archived === true || ['archived', 'deleted', 'invalid', 'retake_allowed'].includes(status);
    });
    const previousGroupRows = rows.filter((row) => {
        const data = dataOf(row);
        const currentGroup = context.groupByUserToken[token(pickTrainee(row))] || '';
        const rowGroup = String(data.groupID || data.groupId || data.group || '').trim();
        return currentGroup && rowGroup && rowGroup !== currentGroup;
    });
    return {
        count: rows.length,
        invalidSubmissions: invalid.length,
        hiddenOrArchivedSubmissions: hidden.length,
        duplicateIds: duplicateIds.length,
        duplicateSessionLinks: duplicateSessionLinks.length,
        previousGroupRows: previousGroupRows.length,
        duplicateSessionSamples: sampleRows(duplicateSessionLinks, ([key, list]) => ({
            key,
            rowIds: list.map(row => row.id),
            trainee: pickTrainee(list[0]),
            title: pickAssessment(list[0])
        })),
        invalidSamples: sampleRows(invalid, row => ({
            id: row.id,
            trainee: pickTrainee(row),
            title: pickAssessment(row),
            score: pickScore(row),
            date: pickDate(row)
        })),
        previousGroupSamples: sampleRows(previousGroupRows, row => ({
            id: row.id,
            trainee: pickTrainee(row),
            title: pickAssessment(row),
            rowGroup: dataOf(row).groupID || dataOf(row).groupId || dataOf(row).group || '',
            currentGroup: context.groupByUserToken[token(pickTrainee(row))] || ''
        }))
    };
}

function isHiddenAssessmentRow(row) {
    const data = dataOf(row);
    const status = String(data.status || '').toLowerCase();
    return data.archived === true || ['archived', 'deleted', 'invalid', 'retake_allowed'].includes(status);
}

function isCompletedSubmission(row) {
    const status = String(dataOf(row).status || '').toLowerCase();
    return ['completed', 'submitted', 'done', 'passed', 'pass'].includes(status);
}

function auditSubmissionRecordLinkage(submissionRows, recordRows) {
    const recordsBySubmissionId = new Map();
    (recordRows || []).forEach((record) => {
        const data = dataOf(record);
        const submissionId = String(data.submissionId || '').trim();
        if (!submissionId) return;
        if (!recordsBySubmissionId.has(submissionId)) recordsBySubmissionId.set(submissionId, []);
        recordsBySubmissionId.get(submissionId).push(record);
    });

    const missingRecords = [];
    const duplicateLinkedRecords = [];
    const linkedScoreMismatches = [];

    (submissionRows || []).forEach((submission) => {
        if (isHiddenAssessmentRow(submission) || !isCompletedSubmission(submission)) return;
        const data = dataOf(submission);
        const submissionId = String(data.id || submission.id || '').trim();
        const linkedRecords = recordsBySubmissionId.get(submissionId) || [];
        if (!linkedRecords.length) {
            missingRecords.push(submission);
            return;
        }
        if (linkedRecords.length > 1) duplicateLinkedRecords.push({ submission, linkedRecords });
        linkedRecords.forEach((record) => {
            const submissionScore = pickScore(submission);
            const recordScore = pickScore(record);
            if (submissionScore !== null && recordScore !== null && Math.round(submissionScore) !== Math.round(recordScore)) {
                linkedScoreMismatches.push({ submission, record });
            }
        });
    });

    return {
        completedSubmissionsMissingRecords: missingRecords.length,
        duplicateLinkedRecords: duplicateLinkedRecords.length,
        linkedScoreMismatches: linkedScoreMismatches.length,
        missingRecordSamples: sampleRows(missingRecords, row => ({
            id: dataOf(row).id || row.id,
            trainee: pickTrainee(row),
            title: pickAssessment(row),
            score: pickScore(row),
            status: dataOf(row).status || '',
            date: pickDate(row)
        })),
        duplicateLinkedRecordSamples: sampleRows(duplicateLinkedRecords, item => ({
            submissionId: dataOf(item.submission).id || item.submission.id,
            trainee: pickTrainee(item.submission),
            title: pickAssessment(item.submission),
            recordIds: item.linkedRecords.map(row => dataOf(row).id || row.id),
            scores: item.linkedRecords.map(row => pickScore(row))
        })),
        linkedScoreMismatchSamples: sampleRows(linkedScoreMismatches, item => ({
            submissionId: dataOf(item.submission).id || item.submission.id,
            recordId: dataOf(item.record).id || item.record.id,
            trainee: pickTrainee(item.submission),
            title: pickAssessment(item.submission),
            submissionScore: pickScore(item.submission),
            recordScore: pickScore(item.record),
            date: pickDate(item.submission)
        }))
    };
}

function auditAttendance(rows) {
    const duplicateUserDates = groupBy(rows, (row) => {
        const data = dataOf(row);
        const user = token(data.user || row.user_id || data.trainee);
        const date = String(data.date || '').trim();
        return user && date ? `${user}|${date}` : '';
    });
    const invalid = rows.filter((row) => {
        const data = dataOf(row);
        return !String(data.user || row.user_id || data.trainee || '').trim()
            || !String(data.date || '').trim()
            || Number.isNaN(Date.parse(data.date));
    });
    return {
        count: rows.length,
        invalidAttendance: invalid.length,
        duplicateUserDates: duplicateUserDates.length,
        duplicateSamples: sampleRows(duplicateUserDates, ([key, list]) => ({
            key,
            rowIds: list.map(row => row.id),
            user: dataOf(list[0]).user || list[0].user_id || '',
            date: dataOf(list[0]).date || ''
        })),
        invalidSamples: sampleRows(invalid, row => ({ id: row.id, user: dataOf(row).user || row.user_id || '', date: dataOf(row).date || '' }))
    };
}

function buildRosterContext(docs, usersRows) {
    const rostersDoc = docs.map.rosters && docs.map.rosters.content && typeof docs.map.rosters.content === 'object'
        ? docs.map.rosters.content
        : {};
    const groupByUserToken = {};
    Object.entries(rostersDoc || {}).forEach(([group, members]) => {
        if (!Array.isArray(members)) return;
        members.forEach((member) => {
            const key = token(member);
            if (key) groupByUserToken[key] = group;
        });
    });

    const activeUsers = new Set();
    usersRows.forEach((row) => {
        const data = dataOf(row);
        const name = pickUser(row);
        if (!name) return;
        if (String(data.status || '').toLowerCase() === 'blocked') return;
        activeUsers.add(token(name));
    });

    return { rosters: rostersDoc, groupByUserToken, activeUsers };
}

function auditDocuments(docs) {
    const staleRowSyncedDocs = docs.rows
        .filter(row => ROW_SYNCED_BLOB_KEYS.has(row.key))
        .map(row => ({ key: row.key, updated_at: row.updated_at }));
    const missingConfiguredDocs = APP_DOCUMENT_KEYS.filter(key => !docs.map[key]);
    const retrain = docs.map.retrain_archives && Array.isArray(docs.map.retrain_archives.content)
        ? docs.map.retrain_archives.content
        : [];
    const retrainAttempts = groupBy(retrain, entry => {
        const user = typeof entry.user === 'object' ? (entry.user.user || entry.user.username || entry.user.name) : entry.user;
        return token(user);
    });
    const usersAboveTwoRetrainArchives = retrainAttempts
        .filter(([, list]) => list.length > 2)
        .map(([userKey, list]) => ({ userKey, count: list.length, ids: list.map(item => item.id || item.movedDate || item.date || '') }));

    return {
        appDocumentCount: docs.rows.length,
        staleRowSyncedDocuments: staleRowSyncedDocs.length,
        missingConfiguredDocuments: missingConfiguredDocs,
        retrainArchiveCount: retrain.length,
        usersAboveTwoRetrainArchives: usersAboveTwoRetrainArchives.length,
        staleRowSyncedDocumentSamples: staleRowSyncedDocs.slice(0, 30),
        usersAboveTwoRetrainArchiveSamples: usersAboveTwoRetrainArchives.slice(0, 20)
    };
}

function buildCleanupPlan(tables, docs, context) {
    const plan = {
        readOnly: true,
        notes: [
            'This plan is not applied automatically.',
            'Review samples before deleting rows from production.',
            'Records with duplicate logical scores may represent true retakes; prefer archive/lifecycle fixes before hard deletion.'
        ],
        users: [],
        attendance: [],
        invalidScores: [],
        staleDocuments: [],
        retrainArchivesAboveTwo: []
    };

    groupBy(tables.users || [], row => token(pickUser(row))).forEach(([userKey, list]) => {
        const keep = chooseCanonicalUserRow(list);
        const deleteIds = list.filter(row => keep && row.id !== keep.id).map(row => row.id).filter(Boolean);
        if (keep && deleteIds.length) {
            plan.users.push({
                userKey,
                keepId: keep.id,
                keepName: pickUser(keep),
                deleteIds
            });
        }
    });

    groupBy(tables.attendance || [], (row) => {
        const data = dataOf(row);
        const user = token(data.user || row.user_id || data.trainee);
        const date = String(data.date || '').trim();
        return user && date ? `${user}|${date}` : '';
    }).forEach(([key, list]) => {
        const keep = pickLatestRow(list);
        const deleteIds = list.filter(row => keep && row.id !== keep.id).map(row => row.id).filter(Boolean);
        if (keep && deleteIds.length) {
            plan.attendance.push({
                key,
                keepId: keep.id,
                deleteIds,
                user: dataOf(keep).user || keep.user_id || '',
                date: dataOf(keep).date || ''
            });
        }
    });

    [...(tables.records || []), ...(tables.submissions || [])].forEach((row) => {
        const score = pickScore(row);
        if (score === null || score < 0 || score > 100) {
            plan.invalidScores.push({
                table: (tables.records || []).includes(row) ? 'records' : 'submissions',
                id: row.id,
                trainee: pickTrainee(row),
                title: pickAssessment(row),
                score
            });
        }
    });

    plan.staleDocuments = docs.rows
        .filter(row => ROW_SYNCED_BLOB_KEYS.has(row.key))
        .map(row => ({ key: row.key, updated_at: row.updated_at }));

    const retrain = docs.map.retrain_archives && Array.isArray(docs.map.retrain_archives.content)
        ? docs.map.retrain_archives.content
        : [];
    groupBy(retrain, entry => {
        const user = typeof entry.user === 'object' ? (entry.user.user || entry.user.username || entry.user.name) : entry.user;
        return token(user);
    }).filter(([, list]) => list.length > 2).forEach(([userKey, list]) => {
        const sorted = [...list].sort((a, b) => {
            const ta = Date.parse(a.movedDate || a.archivedAt || a.createdAt || a.date || '') || 0;
            const tb = Date.parse(b.movedDate || b.archivedAt || b.createdAt || b.date || '') || 0;
            return ta - tb;
        });
        plan.retrainArchivesAboveTwo.push({
            userKey,
            keepArchiveIds: sorted.slice(0, 2).map(item => item.id || item.movedDate || ''),
            reviewExtraArchiveIds: sorted.slice(2).map(item => item.id || item.movedDate || '')
        });
    });

    plan.counts = {
        duplicateUserRowsToDelete: plan.users.reduce((sum, item) => sum + item.deleteIds.length, 0),
        duplicateAttendanceRowsToDelete: plan.attendance.reduce((sum, item) => sum + item.deleteIds.length, 0),
        invalidScoreRowsToReview: plan.invalidScores.length,
        staleDocumentsToReview: plan.staleDocuments.length,
        retrainUsersToReview: plan.retrainArchivesAboveTwo.length
    };

    return plan;
}

function riskLevel(summary) {
    const high = (
        summary.users.invalidUsers
        + summary.records.invalidRecords
        + summary.submissions.invalidSubmissions
        + summary.attendance.invalidAttendance
        + summary.assessmentLinks.linkedScoreMismatches
    );
    const duplicateRisk = (
        summary.users.duplicateLogicalUsers
        + summary.records.duplicateSubmissionLinks
        + summary.attendance.duplicateUserDates
        + summary.assessmentLinks.duplicateLinkedRecords
    );
    if (high > 0 || duplicateRisk > 0) return 'action_required';
    if (
        summary.records.duplicateLogicalScores > 0
        || summary.submissions.duplicateSessionLinks > 0
        || summary.documents.usersAboveTwoRetrainArchives > 0
        || summary.assessmentLinks.completedSubmissionsMissingRecords > 0
    ) return 'review_recommended';
    return 'clean';
}

async function main() {
    const creds = readCredentials();
    const baseUrl = creds.url.replace(/\/+$/, '');
    const startedAt = new Date().toISOString();
    const tables = {};
    const errors = {};

    const docs = await fetchDocuments(baseUrl, creds.key);

    for (const table of ROW_TABLES) {
        try {
            tables[table] = await fetchTable(baseUrl, creds.key, table);
        } catch (error) {
            errors[table] = error.message;
            tables[table] = [];
        }
    }

    const context = buildRosterContext(docs, tables.users || []);
    const summary = {
        generatedAt: new Date().toISOString(),
        credentialSource: creds.source,
        supabaseUrl: baseUrl,
        readOnly: true,
        rowCounts: Object.fromEntries(Object.entries(tables).map(([key, rows]) => [key, rows.length])),
        users: auditUsers(tables.users || []),
        records: auditRecords(tables.records || [], context),
        submissions: auditSubmissions(tables.submissions || [], context),
        assessmentLinks: auditSubmissionRecordLinkage(tables.submissions || [], tables.records || []),
        attendance: auditAttendance(tables.attendance || []),
        documents: auditDocuments(docs),
        fetchErrors: errors
    };
    summary.cleanupPlan = buildCleanupPlan(tables, docs, context);
    summary.riskLevel = riskLevel(summary);

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const stamp = startedAt.replace(/[:.]/g, '-');
    const outPath = path.join(REPORT_DIR, `supabase_integrity_audit_${stamp}.json`);
    fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));

    console.log(`Supabase integrity audit complete (${summary.riskLevel}).`);
    console.log(`Report: ${outPath}`);
    console.log(JSON.stringify({
        riskLevel: summary.riskLevel,
        rowCounts: summary.rowCounts,
        users: {
            duplicateLogicalUsers: summary.users.duplicateLogicalUsers,
            invalidUsers: summary.users.invalidUsers
        },
        records: {
            invalidRecords: summary.records.invalidRecords,
            duplicateSubmissionLinks: summary.records.duplicateSubmissionLinks,
            duplicateLogicalScores: summary.records.duplicateLogicalScores,
            previousGroupRows: summary.records.previousGroupRows,
            hiddenOrArchivedRecords: summary.records.hiddenOrArchivedRecords
        },
        submissions: {
            invalidSubmissions: summary.submissions.invalidSubmissions,
            duplicateSessionLinks: summary.submissions.duplicateSessionLinks,
            previousGroupRows: summary.submissions.previousGroupRows,
            hiddenOrArchivedSubmissions: summary.submissions.hiddenOrArchivedSubmissions
        },
        assessmentLinks: {
            completedSubmissionsMissingRecords: summary.assessmentLinks.completedSubmissionsMissingRecords,
            duplicateLinkedRecords: summary.assessmentLinks.duplicateLinkedRecords,
            linkedScoreMismatches: summary.assessmentLinks.linkedScoreMismatches
        },
        attendance: {
            invalidAttendance: summary.attendance.invalidAttendance,
            duplicateUserDates: summary.attendance.duplicateUserDates
        },
        documents: {
            staleRowSyncedDocuments: summary.documents.staleRowSyncedDocuments,
            usersAboveTwoRetrainArchives: summary.documents.usersAboveTwoRetrainArchives,
            missingConfiguredDocuments: summary.documents.missingConfiguredDocuments
        },
        cleanupPlan: summary.cleanupPlan.counts,
        fetchErrors: summary.fetchErrors
    }, null, 2));
}

main().catch((error) => {
    console.error(`Supabase integrity audit failed: ${error.message}`);
    process.exit(1);
});
