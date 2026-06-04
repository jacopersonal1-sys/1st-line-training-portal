/* ================= ADMIN: USERS & ROSTERS ================= */
/* Responsibility: Handling Rosters, Users, Groups, and Permissions */

// Global State for User Operations
let userToMove = null;
let editTargetIndex = -1;
let editTargetUsername = '';
let _legacyRetrainArchiveSplitRunning = false;
const USER_ROLE_RANK = {
    trainee: 1,
    teamleader: 2,
    special_viewer: 3,
    admin: 4,
    super_admin: 5
};

function normalizeUserIdentityValue(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[._-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getUserIdentityToken(value) {
    return normalizeUserIdentityValue(value).replace(/\s+/g, '');
}

function userIdentityMatches(left, right) {
    const leftToken = getUserIdentityToken(left);
    const rightToken = getUserIdentityToken(right);
    return !!leftToken && !!rightToken && leftToken === rightToken;
}

function readAdminUsersJson(key, fallback) {
    if (typeof safeLocalParse === 'function') return safeLocalParse(key, fallback);
    try {
        const raw = localStorage.getItem(key);
        if (raw === null || raw === undefined || raw === 'undefined') return fallback;
        return JSON.parse(raw);
    } catch (error) {
        console.warn(`Admin Users: failed parsing localStorage['${key}']`, error);
        return fallback;
    }
}

function getRoleRank(role) {
    return USER_ROLE_RANK[String(role || '').toLowerCase()] || 0;
}

function findUserByIdentityIndex(users, username) {
    const targetToken = getUserIdentityToken(username);
    if (!targetToken || !Array.isArray(users)) return -1;
    return users.findIndex(u => userIdentityMatches(u && (u.user || u.username), username));
}

function mergeUserEntries(existingUser, incomingUser) {
    if (!existingUser) return { ...incomingUser };
    if (!incomingUser) return existingUser;

    const merged = { ...existingUser };
    const mergedRole = getRoleRank(incomingUser.role) >= getRoleRank(existingUser.role)
        ? incomingUser.role
        : existingUser.role;
    merged.role = mergedRole;

    if ((!merged.pass || merged.pass === '') && incomingUser.pass) merged.pass = incomingUser.pass;
    if (!merged.user && incomingUser.user) merged.user = incomingUser.user;
    if (!merged.username && incomingUser.username) merged.username = incomingUser.username;

    if (incomingUser.traineeData && typeof incomingUser.traineeData === 'object') {
        merged.traineeData = { ...(existingUser.traineeData || {}), ...incomingUser.traineeData };
    }

    if (typeof incomingUser.blocked !== 'undefined') merged.blocked = !!incomingUser.blocked;
    if (typeof existingUser.blocked !== 'undefined' && typeof incomingUser.blocked === 'undefined') merged.blocked = !!existingUser.blocked;
    if (incomingUser.status) merged.status = incomingUser.status;
    if (!merged.status) merged.status = merged.blocked ? 'blocked' : 'active';

    if (incomingUser.boundClientId) merged.boundClientId = incomingUser.boundClientId;

    const incomingTs = new Date(incomingUser.lastModified || incomingUser.updatedAt || 0).getTime() || 0;
    const existingTs = new Date(existingUser.lastModified || existingUser.updatedAt || 0).getTime() || 0;
    if (incomingTs >= existingTs) {
        merged.lastModified = incomingUser.lastModified || merged.lastModified;
        merged.modifiedBy = incomingUser.modifiedBy || merged.modifiedBy;
    }

    return merged;
}

function dedupeUsersSnapshot(inputUsers) {
    const users = Array.isArray(inputUsers) ? inputUsers : [];
    const deduped = [];
    const userMap = new Map();

    users.forEach(raw => {
        if (!raw || typeof raw !== 'object') return;
        const originalName = String(raw.user || raw.username || '').trim();
        if (!originalName) return;

        const key = getUserIdentityToken(originalName);
        if (!key) return;

        const candidate = { ...raw, user: raw.user || raw.username || originalName };
        if (!userMap.has(key)) {
            userMap.set(key, deduped.length);
            deduped.push(candidate);
            return;
        }

        const idx = userMap.get(key);
        deduped[idx] = mergeUserEntries(deduped[idx], candidate);
    });

    return deduped;
}

function dedupeRosterSnapshot(inputRosters) {
    const rosters = (inputRosters && typeof inputRosters === 'object') ? { ...inputRosters } : {};
    const result = {};

    Object.entries(rosters).forEach(([groupId, members]) => {
        if (!Array.isArray(members)) {
            result[groupId] = [];
            return;
        }

        const seen = new Set();
        const cleanMembers = [];
        members.forEach(member => {
            const value = String(member || '').trim();
            if (!value) return;
            const key = getUserIdentityToken(value);
            if (!key || seen.has(key)) return;
            seen.add(key);
            cleanMembers.push(value);
        });
        result[groupId] = cleanMembers;
    });

    return result;
}

function sanitizeUsersAndRosters() {
    const rawUsers = readAdminUsersArray('users');
    const rawRosters = readAdminUsersObject('rosters');

    const users = dedupeUsersSnapshot(rawUsers);
    const rosters = dedupeRosterSnapshot(rawRosters);

    const usersChanged = JSON.stringify(users) !== JSON.stringify(Array.isArray(rawUsers) ? rawUsers : []);
    const rostersChanged = JSON.stringify(rosters) !== JSON.stringify((rawRosters && typeof rawRosters === 'object') ? rawRosters : {});

    if (usersChanged) localStorage.setItem('users', JSON.stringify(users));
    if (rostersChanged) localStorage.setItem('rosters', JSON.stringify(rosters));

    return { users, rosters, usersChanged, rostersChanged };
}

function isRetrainArchiveEntry(entry) {
    const reason = String((entry && entry.reason) || '').toLowerCase().trim();
    return reason.startsWith('moved to ');
}

function readRetrainArchives() {
    const archives = readAdminUsersJson('retrain_archives', []);
    return Array.isArray(archives) ? archives : [];
}

function readProgressConfigSnapshot() {
    const config = readAdminUsersJson('insight_progress_config', {});
    return config && typeof config === 'object' && !Array.isArray(config) ? config : {};
}

function readAdminUsersArray(key) {
    const value = readAdminUsersJson(key, []);
    return Array.isArray(value) ? value : [];
}

function readAdminUsersObject(key) {
    const value = readAdminUsersJson(key, {});
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function rowsForMoveArchive(key, identityFields, targetToken) {
    const fields = Array.isArray(identityFields) ? identityFields : [identityFields];
    return readAdminUsersArray(key).filter(row => {
        if (!row || typeof row !== 'object') return false;
        return fields.some(field => getUserIdentityToken(row[field]) === targetToken);
    });
}

function mergeArchiveRows(existingRows, incomingRows) {
    const out = Array.isArray(existingRows) ? [...existingRows] : [];
    const rowKey = (row) => {
        if (!row || typeof row !== 'object') return '';
        if (row.id) return `id:${String(row.id)}`;
        try {
            return `row:${JSON.stringify(row)}`;
        } catch (error) {
            return '';
        }
    };
    const seen = new Set(out.map(rowKey).filter(Boolean));
    (Array.isArray(incomingRows) ? incomingRows : []).forEach(row => {
        if (!row || typeof row !== 'object') return;
        const key = rowKey(row);
        if (key && seen.has(key)) return;
        if (key) seen.add(key);
        out.push(row);
    });
    return out;
}

const RETRAIN_ARCHIVE_MAX_STRING_LENGTH = 12000;
const RETRAIN_ARCHIVE_MAX_DEPTH = 5;
const RETRAIN_ARCHIVE_OMIT_FIELD = '[omitted from retrain archive to keep migration safe]';
const RETRAIN_ARCHIVE_OMIT_KEY_RE = /(base64|blob|binary|dataurl|data_url|screenshot|screenshots|image|images|attachment|attachments|reporthtml|renderedhtml|contenthtml|html)$/i;

function compactArchivePrimitive(value, keyName) {
    if (typeof value !== 'string') return value;
    const normalizedKey = String(keyName || '').replace(/[^a-z0-9_]/gi, '').toLowerCase();
    if (RETRAIN_ARCHIVE_OMIT_KEY_RE.test(normalizedKey)) return RETRAIN_ARCHIVE_OMIT_FIELD;
    if (value.length <= RETRAIN_ARCHIVE_MAX_STRING_LENGTH) return value;
    return `${value.slice(0, RETRAIN_ARCHIVE_MAX_STRING_LENGTH)}\n[truncated ${value.length - RETRAIN_ARCHIVE_MAX_STRING_LENGTH} chars for retrain archive]`;
}

function compactArchiveValue(value, keyName, depth) {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') return compactArchivePrimitive(value, keyName);
    if (depth >= RETRAIN_ARCHIVE_MAX_DEPTH) return '[nested object omitted from retrain archive]';

    if (Array.isArray(value)) {
        return value.map(item => compactArchiveValue(item, keyName, depth + 1));
    }

    const out = {};
    Object.entries(value).forEach(([key, child]) => {
        const normalizedKey = String(key || '').replace(/[^a-z0-9_]/gi, '').toLowerCase();
        if (RETRAIN_ARCHIVE_OMIT_KEY_RE.test(normalizedKey)) {
            out[key] = RETRAIN_ARCHIVE_OMIT_FIELD;
            return;
        }
        out[key] = compactArchiveValue(child, key, depth + 1);
    });
    return out;
}

function compactArchiveRow(row, mode) {
    if (!row || typeof row !== 'object') return row;
    if (mode === 'identity') {
        const out = {};
        [
            'id', 'sessionId', 'user', 'username', 'user_id', 'trainee', 'group', 'groupID',
            'date', 'createdAt', 'created_at', 'updatedAt', 'updated_at', 'status',
            'type', 'source', 'summary', 'title', 'assessment', 'testTitle'
        ].forEach(key => {
            if (typeof row[key] !== 'undefined') out[key] = compactArchiveValue(row[key], key, 0);
        });
        return out;
    }
    return compactArchiveValue(row, '', 0);
}

function compactArchiveRows(rows, mode) {
    if (!Array.isArray(rows)) return [];
    return rows.map(row => compactArchiveRow(row, mode));
}

function summarizeArchiveNotes(notes) {
    if (!notes) return null;
    const list = Array.isArray(notes) ? notes : [notes];
    return list.map(note => compactArchiveValue(note, 'note', 0));
}

function compactRetrainArchiveEntry(entry) {
    if (!entry || typeof entry !== 'object') return entry;
    const next = { ...entry };
    next.records = compactArchiveRows(next.records, 'full');
    next.submissions = compactArchiveRows(next.submissions, 'full');
    next.attendance = compactArchiveRows(next.attendance, 'full');
    next.reports = compactArchiveRows(next.reports, 'full');
    next.reviews = compactArchiveRows(next.reviews, 'full');
    next.exemptions = compactArchiveRows(next.exemptions, 'full');
    next.liveBookings = compactArchiveRows(next.liveBookings, 'full');
    next.liveSessions = compactArchiveRows(next.liveSessions, 'full');
    next.linkRequests = compactArchiveRows(next.linkRequests, 'full');
    next.monitorHistory = compactArchiveRows(next.monitorHistory, 'identity');
    next.tlTaskSubmissions = compactArchiveRows(next.tlTaskSubmissions, 'identity');
    next.notes = summarizeArchiveNotes(next.notes);
    next.officialProgress = compactArchiveValue(next.officialProgress, 'officialProgress', 0);
    next.progressConfigSnapshot = compactArchiveValue(next.progressConfigSnapshot, 'progressConfigSnapshot', 0);
    next.archiveCompaction = {
        compactedAt: new Date().toISOString(),
        heavyFieldsOmitted: true,
        monitorHistoryRows: Array.isArray(entry.monitorHistory) ? entry.monitorHistory.length : 0,
        tlTaskSubmissionRows: Array.isArray(entry.tlTaskSubmissions) ? entry.tlTaskSubmissions.length : 0
    };
    return next;
}

function compactRetrainArchivesForStorage(archives) {
    return (Array.isArray(archives) ? archives : []).map(compactRetrainArchiveEntry);
}

function removeUserFromScheduleExceptions(schedules, userToken) {
    if (!schedules || typeof schedules !== 'object' || !userToken) return { schedules, changed: false, removed: 0 };
    let changed = false;
    let removed = 0;
    const nextSchedules = { ...schedules };

    Object.keys(nextSchedules).forEach(scheduleId => {
        const schedule = nextSchedules[scheduleId];
        if (!schedule || typeof schedule !== 'object') return;
        const nextSchedule = { ...schedule };
        const items = Array.isArray(nextSchedule.items) ? nextSchedule.items : [];
        nextSchedule.items = items.map(item => {
            if (!item || typeof item !== 'object' || !Array.isArray(item.availabilityExceptionUsers)) return item;
            const before = item.availabilityExceptionUsers.length;
            const filtered = item.availabilityExceptionUsers.filter(user => getUserIdentityToken(user) !== userToken);
            if (filtered.length === before) return item;
            changed = true;
            removed += before - filtered.length;
            return { ...item, availabilityExceptionUsers: filtered };
        });
        if (nextSchedule !== schedule) nextSchedules[scheduleId] = nextSchedule;
    });

    return { schedules: nextSchedules, changed, removed };
}

function findResumableRetrainArchiveIndex(archives, userToken, targetGroup) {
    const target = String(targetGroup || '').trim();
    const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    for (let i = archives.length - 1; i >= 0; i--) {
        const entry = archives[i];
        if (!entry || typeof entry !== 'object') continue;
        if (getUserIdentityToken(entry.user || entry.trainee || entry.username) !== userToken) continue;
        if (String(entry.targetGroup || '').trim() !== target) continue;
        const movedTs = new Date(entry.movedDate || entry.archivedAt || entry.createdAt || 0).getTime() || 0;
        if (movedTs && movedTs < weekAgo) continue;
        return i;
    }
    return -1;
}

function getArchiveGroupForProgress(entry) {
    if (!entry || typeof entry !== 'object') return '';
    return String(
        entry.fromGroup ||
        entry.group ||
        entry.groupID ||
        (Array.isArray(entry.records) && entry.records[0] && entry.records[0].groupID) ||
        ''
    ).trim();
}

function buildOfficialProgressForArchive(entry) {
    if (!entry || typeof entry !== 'object') return null;
    if (!window.ProgressCatalog || typeof window.ProgressCatalog.getTraineeProgress !== 'function') return null;
    const username = String(entry.user || entry.trainee || entry.username || '').trim();
    if (!username) return null;
    const progressConfig = (entry.progressConfigSnapshot && typeof entry.progressConfigSnapshot === 'object')
        ? entry.progressConfigSnapshot
        : readProgressConfigSnapshot();
    const officialItems = (typeof window.ProgressCatalog.getOfficialItemsFromConfig === 'function')
        ? window.ProgressCatalog.getOfficialItemsFromConfig(progressConfig, { includeAuto: true })
        : null;

    return window.ProgressCatalog.getTraineeProgress(username, getArchiveGroupForProgress(entry), {
        includeAuto: true,
        items: officialItems,
        ignoreExemptionGroup: true,
        data: {
            records: Array.isArray(entry.records) ? entry.records : [],
            submissions: Array.isArray(entry.submissions) ? entry.submissions : [],
            savedReports: Array.isArray(entry.reports) ? entry.reports : [],
            insightReviews: Array.isArray(entry.reviews) ? entry.reviews : [],
            liveBookings: Array.isArray(entry.liveBookings) ? entry.liveBookings : [],
            exemptions: Array.isArray(entry.exemptions) ? entry.exemptions : []
        }
    });
}

function enrichArchiveSnapshot(entry, archiveType) {
    if (!entry || typeof entry !== 'object') return { entry, changed: false, repairable: false };
    const next = { ...entry };
    let changed = false;
    const hasArchiveRows = [
        next.records,
        next.submissions,
        next.reports,
        next.reviews,
        next.liveBookings,
        next.exemptions
    ].some(rows => Array.isArray(rows) && rows.length > 0);

    if (!next.id) {
        const prefix = archiveType === 'retrain' ? 'retrain_repair' : 'graduate_repair';
        next.id = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        changed = true;
    }

    if (!next.archiveType) {
        next.archiveType = archiveType;
        changed = true;
    }

    if (!next.progressConfigSnapshot || typeof next.progressConfigSnapshot !== 'object') {
        next.progressConfigSnapshot = readProgressConfigSnapshot();
        changed = true;
    }

    if (!next.officialProgress && hasArchiveRows) {
        const officialProgress = buildOfficialProgressForArchive(next);
        if (officialProgress) {
            next.officialProgress = officialProgress;
            changed = true;
        }
    }

    if (changed) {
        next.archiveRepair = {
            repairedAt: new Date().toISOString(),
            source: 'archive_snapshot_backfill',
            repairable: hasArchiveRows
        };
    }

    return { entry: next, changed, repairable: hasArchiveRows };
}

async function repairArchiveSnapshots() {
    const message = [
        'Repair existing archive snapshots?',
        '',
        'This will add missing Progress Builder snapshots and official progress calculations to existing Graduated and Retrain archives where the archived rows still exist.',
        '',
        'It will not change live trainee data.'
    ].join('\n');
    if (!confirm(message)) return;

    let graduated = readAdminUsersArray('graduated_agents');
    let retrain = readRetrainArchives();
    if (!Array.isArray(graduated)) graduated = [];
    if (!Array.isArray(retrain)) retrain = [];

    let changedGraduated = 0;
    let changedRetrain = 0;
    let repairableGraduated = 0;
    let repairableRetrain = 0;

    graduated = graduated.map(entry => {
        const result = enrichArchiveSnapshot(entry, isRetrainArchiveEntry(entry) ? 'retrain' : 'graduated');
        if (result.repairable) repairableGraduated += 1;
        if (result.changed) changedGraduated += 1;
        return result.entry;
    });

    retrain = retrain.map(entry => {
        const result = enrichArchiveSnapshot(entry, 'retrain');
        if (result.repairable) repairableRetrain += 1;
        if (result.changed) changedRetrain += 1;
        return result.entry;
    });

    if (changedGraduated > 0) localStorage.setItem('graduated_agents', JSON.stringify(graduated));
    if (changedRetrain > 0) localStorage.setItem('retrain_archives', JSON.stringify(retrain));

    if (changedGraduated > 0 || changedRetrain > 0) {
        if (typeof saveToServer === 'function') {
            await saveToServer(['graduated_agents', 'retrain_archives'], true);
        }
        if (typeof InsightStudioLoader !== 'undefined' && typeof InsightStudioLoader.refresh === 'function') {
            InsightStudioLoader.refresh();
        }
    }

    const summary = [
        'Archive repair complete.',
        '',
        `Graduated archives updated: ${changedGraduated}`,
        `Retrain archives updated: ${changedRetrain}`,
        '',
        `Graduated archives with usable row snapshots: ${repairableGraduated}`,
        `Retrain archives with usable row snapshots: ${repairableRetrain}`,
        '',
        'Archives that no longer contain their original rows cannot have historical scores recreated automatically.'
    ].join('\n');
    alert(summary);
    if (typeof loadGraduatedAgents === 'function') loadGraduatedAgents();
}

function queueRetrainArchiveServerDeletes(archiveData) {
    if (!archiveData || typeof archiveData !== 'object') return { queued: 0, skipped: 0 };

    const deleteTargets = [
        { rows: archiveData.records, table: 'records' },
        { rows: archiveData.submissions, table: 'submissions' },
        { rows: archiveData.attendance, table: 'attendance' },
        { rows: archiveData.reports, table: 'saved_reports' },
        { rows: archiveData.reviews, table: 'insight_reviews' },
        { rows: archiveData.exemptions, table: 'exemptions' },
        { rows: archiveData.liveBookings, table: 'live_bookings' },
        { rows: archiveData.liveSessions, table: 'live_sessions' },
        { rows: archiveData.linkRequests, table: 'link_requests' },
        { rows: archiveData.monitorHistory, table: 'monitor_history' },
        { rows: archiveData.tlTaskSubmissions, table: 'tl_task_submissions' }
    ];

    const pendingKey = 'system_pending_deletes';
    const tombstoneKey = 'system_tombstones';
    const rawQueue = readAdminUsersJson(pendingKey, []);
    const rawTombstones = readAdminUsersJson(tombstoneKey, []);
    const queue = Array.isArray(rawQueue) ? rawQueue : [];
    const tombstones = Array.isArray(rawTombstones) ? rawTombstones : [];
    const tombstoneSet = new Set(Array.isArray(tombstones) ? tombstones.map(String) : []);
    const queueSet = new Set((Array.isArray(queue) ? queue : [])
        .filter(item => item && item.type === 'id')
        .map(item => `${item.table}:${item.id}`));

    let queued = 0;
    let skipped = 0;
    let tombstoneChanged = false;
    deleteTargets.forEach(target => {
        const rows = Array.isArray(target.rows) ? target.rows : [];
        rows.forEach(row => {
            const id = row && (row.id || row.sessionId);
            if (!id) {
                skipped += 1;
                return;
            }
            const idValue = String(id);
            const key = `${target.table}:${idValue}`;
            if (!queueSet.has(key)) {
                queue.push({ type: 'id', table: target.table, id: idValue, ts: Date.now(), reason: 'retrain_archive' });
                queueSet.add(key);
                queued += 1;
            }
            if (!tombstoneSet.has(idValue)) {
                tombstones.push(idValue);
                tombstoneSet.add(idValue);
                tombstoneChanged = true;
            }
        });
    });

    if (queued > 0) localStorage.setItem(pendingKey, JSON.stringify(queue));
    if (tombstoneChanged) localStorage.setItem(tombstoneKey, JSON.stringify(tombstones));
    return { queued, skipped };
}

function getRetrainArchiveDeleteTargets(archiveData) {
    if (!archiveData || typeof archiveData !== 'object') return [];
    return [
        { rows: archiveData.records, table: 'records' },
        { rows: archiveData.submissions, table: 'submissions' },
        { rows: archiveData.attendance, table: 'attendance' },
        { rows: archiveData.reports, table: 'saved_reports' },
        { rows: archiveData.reviews, table: 'insight_reviews' },
        { rows: archiveData.exemptions, table: 'exemptions' },
        { rows: archiveData.liveBookings, table: 'live_bookings' },
        { rows: archiveData.liveSessions, table: 'live_sessions' },
        { rows: archiveData.linkRequests, table: 'link_requests' },
        { rows: archiveData.monitorHistory, table: 'monitor_history' },
        { rows: archiveData.tlTaskSubmissions, table: 'tl_task_submissions' }
    ];
}

async function executeRetrainArchiveServerDeletes(archiveData) {
    const client = window.supabaseClient;
    const summary = { deleted: 0, queued: 0, skipped: 0, failed: [] };
    if (!client) {
        const queued = queueRetrainArchiveServerDeletes(archiveData);
        return { ...summary, queued: queued.queued, skipped: queued.skipped };
    }

    for (const target of getRetrainArchiveDeleteTargets(archiveData)) {
        const ids = [...new Set((Array.isArray(target.rows) ? target.rows : [])
            .map(row => row && (row.id || row.sessionId))
            .filter(id => id !== undefined && id !== null && id !== '')
            .map(String))];
        const rowCount = Array.isArray(target.rows) ? target.rows.length : 0;
        summary.skipped += Math.max(0, rowCount - ids.length);
        if (!ids.length) continue;

        const { error } = await client.from(target.table).delete().in('id', ids);
        if (error) {
            summary.failed.push({ table: target.table, ids, error: error.message || String(error) });
            const pendingKey = 'system_pending_deletes';
            const tombstoneKey = 'system_tombstones';
            const queue = readAdminUsersJson(pendingKey, []);
            const tombstones = readAdminUsersJson(tombstoneKey, []);
            const queueSet = new Set((Array.isArray(queue) ? queue : [])
                .filter(item => item && item.type === 'id')
                .map(item => `${item.table}:${item.id}`));
            const tombstoneSet = new Set((Array.isArray(tombstones) ? tombstones : []).map(String));
            ids.forEach(id => {
                const key = `${target.table}:${id}`;
                if (!queueSet.has(key)) {
                    queue.push({ type: 'id', table: target.table, id, ts: Date.now(), reason: 'retrain_archive_direct_delete_failed' });
                    queueSet.add(key);
                    summary.queued += 1;
                }
                if (!tombstoneSet.has(id)) {
                    tombstones.push(id);
                    tombstoneSet.add(id);
                }
            });
            localStorage.setItem(pendingKey, JSON.stringify(queue));
            localStorage.setItem(tombstoneKey, JSON.stringify(tombstones));
            continue;
        }
        summary.deleted += ids.length;
    }

    return summary;
}

async function verifyRetrainArchiveServerCleanup(userName) {
    const client = window.supabaseClient;
    const userToken = getUserIdentityToken(userName);
    const summary = { records: 0, submissions: 0, liveSessions: 0 };
    if (!client || !userToken) return summary;

    const checks = [
        { key: 'records', table: 'records' },
        { key: 'submissions', table: 'submissions' },
        { key: 'liveSessions', table: 'live_sessions' }
    ];

    for (const check of checks) {
        const { data, error } = await client.from(check.table).select('id, data').limit(10000);
        if (error || !Array.isArray(data)) continue;
        summary[check.key] = data.filter(row => {
            const payload = row && row.data && typeof row.data === 'object' ? row.data : row;
            return getUserIdentityToken(payload && (payload.trainee || payload.user || payload.user_id)) === userToken;
        }).length;
    }

    return summary;
}

async function splitLegacyRetrainArchives() {
    if (_legacyRetrainArchiveSplitRunning) return;
    if (localStorage.getItem('archive_split_v268') === 'true') return;

    _legacyRetrainArchiveSplitRunning = true;
    try {
        const graduates = readAdminUsersArray('graduated_agents');
        if (!Array.isArray(graduates) || graduates.length === 0) {
            localStorage.setItem('archive_split_v268', 'true');
            return;
        }

        const retrainLegacy = graduates.filter(isRetrainArchiveEntry);
        if (retrainLegacy.length === 0) {
            localStorage.setItem('archive_split_v268', 'true');
            return;
        }

        const keepGraduates = graduates.filter(g => !isRetrainArchiveEntry(g));
        const currentRetrain = readRetrainArchives();
        const seen = new Set(currentRetrain.map(r => String(r.id || '').trim()).filter(Boolean));

        retrainLegacy.forEach((entry, idx) => {
            const id = entry.id || (`retrain_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`);
            const reason = String(entry.reason || '');
            const targetGroup = reason.replace(/^Moved to\s*/i, '').trim() || 'Unknown';
            if (seen.has(id)) return;
            seen.add(id);
            currentRetrain.push({
                ...entry,
                id,
                archiveType: 'retrain',
                targetGroup,
                movedDate: entry.movedDate || entry.graduatedDate || new Date().toISOString()
            });
        });

        localStorage.setItem('graduated_agents', JSON.stringify(keepGraduates));
        localStorage.setItem('retrain_archives', JSON.stringify(currentRetrain));
        localStorage.setItem('archive_split_v268', 'true');

        if (typeof saveToServer === 'function') {
            await saveToServer(['graduated_agents', 'retrain_archives'], true, true);
        }
    } catch (e) {
        console.warn('Legacy retrain archive split failed:', e);
    } finally {
        _legacyRetrainArchiveSplitRunning = false;
    }
}

// --- HELPER: INSTANT SAVE ---
// Uses force=true to skip the fetch/merge process for Admin actions.
// This ensures deletions and edits are authoritative and instant.
async function secureUserSave() {
    const includeRevoked = arguments.length > 0 ? Boolean(arguments[0]) : false;
    if (typeof saveToServer === 'function') {
        const btn = document.activeElement;
        let originalText = "";
        
        if(btn && btn.tagName === 'BUTTON') {
            originalText = btn.innerText;
            btn.innerText = "Saving...";
            btn.disabled = true;
        }

        try {
            // UPDATED: Use force=true to ensure User/Roster edits are authoritative.
            // This prevents "Ghost Reverts" when changing passwords or updating groups.
            const keys = ['users', 'rosters'];
            if (includeRevoked) keys.push('revokedUsers');
            await saveToServer(keys, true); 
        } catch(e) {
            console.error("User Save Error:", e);
        } finally {
            if(btn && btn.tagName === 'BUTTON') {
                btn.innerText = originalText;
                btn.disabled = false;
            }
        }
    }
}

// --- MENU VISIBILITY CONTROL ---
function restrictTraineeMenu() {
    if(!CURRENT_USER) return;
    const nav = document.querySelector('.admin-sub-nav');
    if(!nav) return;
    
    const btns = nav.querySelectorAll('.sub-tab-btn');
    const isRestricted = (CURRENT_USER.role === 'trainee' || CURRENT_USER.role === 'teamleader');

    btns.forEach(btn => {
        const txt = btn.innerText;
        if(isRestricted) {
            if (txt.includes("Manage Users") || txt.includes("Theme Settings") || txt.includes("System Updates")) {
                btn.style.display = ''; 
            } else {
                btn.style.display = 'none'; 
            }
        } else {
            btn.style.display = ''; 
        }
    });
}

// --- ROSTER / GROUP MANAGEMENT ---

function populateYearSelect() { 
    const s = document.getElementById('newGroupYear'); 
    if (s) { 
        s.innerHTML = ''; 
        const currentYear = new Date().getFullYear();
        for(let i = currentYear + 1; i >= 2021; i--) { 
            s.add(new Option(i,i)); 
        } 
        s.value = currentYear;
    } 
}

function toggleGroupMode() {
    const radio = document.querySelector('input[name="groupMode"]:checked');
    if(!radio) return;

    const mode = radio.value;
    const createDiv = document.getElementById('groupCreateControls');
    const existDiv = document.getElementById('groupExistControls');
    
    if(mode === 'new') {
        createDiv.classList.remove('hidden');
        existDiv.classList.add('hidden');
    } else {
        createDiv.classList.add('hidden');
        existDiv.classList.remove('hidden');
        loadRostersToSelect('addToGroupSelect');
    }
}

async function saveRoster() {
    const radio = document.querySelector('input[name="groupMode"]:checked');
    const mode = radio ? radio.value : 'new';
    
    const rawInput = document.getElementById('newGroupNames').value;
    
    // PARSE EMAILS & EXTRACT NAMES
    // Expected format: username.surname@herotel.com
    const lines = rawInput.split('\n').map(l => l.trim()).filter(l => l);
    
    if(!lines.length) return alert("Please enter at least one trainee email address.");

    const names = [];
    const emails = [];
    const emailMap = {}; // Map Name -> Email for user creation

    lines.forEach(line => {
        // Basic email validation/extraction
        if (line.includes('@')) {
            // Validation Check
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(line)) {
                alert(`Invalid email format detected: "${line}". Please correct it.`);
                throw new Error("Validation Error"); // Break loop and stop execution
            }
            emails.push(line);
            // Extract name: "john.doe@..." -> "John Doe"
            const namePart = line.split('@')[0];
            const fullName = namePart.split(/[._]/).map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
            names.push(fullName);
            emailMap[fullName] = line;
        } else {
            names.push(line); // Fallback for plain names
        }
    });

    const rosters = readAdminUsersObject('rosters');
    let targetGroupId = "";

    if (mode === 'new') {
        const y = document.getElementById('newGroupYear').value; 
        const m = document.getElementById('newGroupMonth').value; 
        let baseId = `${y}-${m}`; 
        
        targetGroupId = baseId; 
        if (rosters[baseId]) { 
            let suffixCode = 65; // 'A'
            while (rosters[`${baseId}-${String.fromCharCode(suffixCode)}`]) { 
                suffixCode++; 
            } 
            targetGroupId = `${baseId}-${String.fromCharCode(suffixCode)}`; 
        }
        rosters[targetGroupId] = names;
    } else {
        targetGroupId = document.getElementById('addToGroupSelect').value;
        if(!targetGroupId) return alert("Please select an existing group to add to.");
        
        const currentMembers = rosters[targetGroupId] || [];
        names.forEach(n => {
            if(!currentMembers.includes(n)) currentMembers.push(n);
        });
        rosters[targetGroupId] = currentMembers;
    }

    localStorage.setItem('rosters', JSON.stringify(rosters));

    // 3. Clear Input
    document.getElementById('newGroupNames').value = ''; 
    
    // 1. Generate Users (Safely)
    await scanAndGenerateUsers(false, emailMap); 
    
    // 2. INSTANT SAVE
    await secureUserSave();
    
    refreshAllDropdowns();
    
    // TRIGGER OUTLOOK EMAIL GENERATION
    if (emails.length > 0 && typeof generateOnboardingEmail === 'function') {
        generateOnboardingEmail(emails);
    }

    if(typeof logAuditAction === 'function') logAuditAction(CURRENT_USER.user, 'Roster Update', `${mode === 'new' ? 'Created' : 'Updated'} group ${targetGroupId}`);
    
    alert(`Successfully ${mode === 'new' ? 'created' : 'updated'} group: ${getGroupLabel(targetGroupId, rosters[targetGroupId].length)}`);
}

// Helper to refresh all dropdowns across tabs
function refreshAllDropdowns() {
    // 1. Always update the login screen dropdown (public)
    if(typeof populateTraineeDropdown === 'function') populateTraineeDropdown();

    // 2. STOP if not logged in (Prevents 'cannot read properties of null' errors in renderSchedule)
    if (typeof CURRENT_USER === 'undefined' || !CURRENT_USER) return;

    // 3. Update Authenticated UI components
    loadRostersList(); 
    loadRostersToSelect('selectedGroup'); // Capture Tab
    loadRostersToSelect('addToGroupSelect'); // Manage Tab
    
    // Schedule Tab Dropdowns
    if(typeof renderSchedule === 'function') renderSchedule();
    
    // Reporting Tab Filters
    if(typeof populateMonthlyFilters === 'function') populateMonthlyFilters();
}

function loadRostersList() { 
    if(document.activeElement && document.activeElement.id === 'newGroupNames') return;

    const sanitized = sanitizeUsersAndRosters();
    const r = sanitized.rosters; 
    if (sanitized.rostersChanged && typeof saveToServer === 'function') {
        saveToServer(['rosters'], true, true).catch(() => {});
    }
    const list = document.getElementById('rosterList');
    if(list) {
        list.innerHTML = Object.keys(r).sort().reverse().map(k => {
            const memberCount = r[k] ? r[k].length : 0;
            const label = (typeof getGroupLabel === 'function') ? getGroupLabel(k, memberCount) : k;
            const safeId = k.replace(/[^a-zA-Z0-9]/g, '_');
            
            // Generate member list HTML
            const members = r[k] || [];
            const membersHtml = members.map(m => {
                const safeName = m.replace(/'/g, "\\'");
                return `<li style="display:flex; justify-content:space-between; align-items:center; padding:4px 0; border-bottom:1px solid var(--border-color); font-size:0.85rem;">
                    <span>${m}</span>
                    <button class="btn-danger btn-sm" onclick="deleteAgentFromSystem('${safeName}', '${safeId}')" style="padding:2px 6px; font-size:0.7rem;" title="Permanently Delete Agent & All Data"><i class="fas fa-trash"></i></button>
                </li>`;
            }).join('');

            return `
            <li style="margin-bottom:10px; background:var(--bg-input); padding:10px; border-radius:6px; border:1px solid var(--border-color);">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong>${label}</strong>
                    <div>
                        <button class="btn-secondary btn-sm" onclick="document.getElementById('members_${safeId}').classList.toggle('hidden')" style="margin-right:5px; font-size:0.7rem;">Manage Agents</button>
                        <button class="btn-danger btn-sm" onclick="deleteGroup('${k}')" style="font-size:0.7rem;">Delete Group</button>
                    </div>
                </div>
                <div id="members_${safeId}" class="hidden" style="margin-top:10px; padding-top:10px; border-top:1px dashed var(--border-color);">
                    <ul style="list-style:none; padding:0; margin:0;">
                        ${membersHtml.length > 0 ? membersHtml : '<li style="color:var(--text-muted); font-style:italic;">No agents in this group.</li>'}
                    </ul>
                </div>
            </li>`;
        }).join(''); 
    }
}

async function deleteGroup(groupId) {
    if(!confirm(`Delete group ${groupId} and all associated data? This cannot be undone.`)) return;
    
    const previousRostersJson = localStorage.getItem('rosters') || '{}';
    const rosters = readAdminUsersObject('rosters');
    delete rosters[groupId];
    localStorage.setItem('rosters', JSON.stringify(rosters));
    
    // AUTHORITATIVE DELETE: Persist updated local state to server.
    if(typeof saveToServer === 'function') {
        const success = await saveToServer(['rosters'], true);
        if (!success) {
            localStorage.setItem('rosters', previousRostersJson);
            alert("Failed to delete group from server. Please check your connection and try again.");
            return; // Abort on failure
        }
    }
    
    if(typeof logAuditAction === 'function') logAuditAction(CURRENT_USER.user, 'Delete Group', `Deleted group ${groupId}`);
    refreshAllDropdowns();
    setTimeout(loadRostersList, 50); // Force reload of the list with slight delay for stability
}

async function deleteAgentFromSystem(agentName, groupKey) {
    // groupKey might be safeId (with underscores), so we need to find the real key if passed incorrectly, 
    // but for rosters, we iterate all groups anyway to be safe.
    if(!confirm(`CRITICAL WARNING:\n\nYou are about to PERMANENTLY DELETE '${agentName}' from the entire system.\n\nThis will remove:\n- User Login & Password\n- Assessment Records & Submissions\n- Attendance History\n- Live Bookings\n- Reports & Notes\n\nThis action CANNOT be undone.\n\nProceed?`)) return;
    
    const btn = document.activeElement;
    if(btn) { btn.disabled = true; btn.innerText = 'Deleting...'; }
    const targetToken = getUserIdentityToken(agentName);

    try {
        // 1. Remove from ALL Rosters (just in case they are in multiple)
        const rosters = readAdminUsersObject('rosters');
        Object.keys(rosters).forEach(gid => {
            if (rosters[gid]) {
                rosters[gid] = rosters[gid].filter(m => getUserIdentityToken(m) !== targetToken);
            }
        });
        localStorage.setItem('rosters', JSON.stringify(rosters));
        
        // 2. Remove User Account
        let users = readAdminUsersArray('users');
        users = users.filter(u => getUserIdentityToken(u && (u.user || u.username)) !== targetToken);
        localStorage.setItem('users', JSON.stringify(users));
        
        // 3. Add to Revoked (Blacklist) to prevent resurrection
        let revoked = readAdminUsersArray('revokedUsers');
        if(!revoked.some(name => getUserIdentityToken(name) === targetToken)) {
            revoked.push(agentName);
            localStorage.setItem('revokedUsers', JSON.stringify(revoked));
        }
        
        // 4. Wipe Data (Local)
        const wipeData = (key, userField) => {
            let data = readAdminUsersJson(key, []);
            if(Array.isArray(data)) {
                const originalLen = data.length;
                // Case insensitive check just to be sure
                data = data.filter(item => {
                    const val = item[userField];
                    return !val || getUserIdentityToken(val) !== targetToken;
                });
                if(data.length !== originalLen) localStorage.setItem(key, JSON.stringify(data));
            }
        };
        
        wipeData('records', 'trainee');
        wipeData('submissions', 'trainee');
        wipeData('attendance_records', 'user');
        wipeData('liveBookings', 'trainee');
        wipeData('savedReports', 'trainee');
        wipeData('insightReviews', 'trainee');
        wipeData('exemptions', 'trainee');
        wipeData('linkRequests', 'trainee');
        wipeData('retrain_archives', 'user');
        // Also clean up Monitor History (might be large)
        wipeData('monitor_history', 'user');
        // Also clean up Access Logs
        wipeData('accessLogs', 'user');
        
        // Object based data
        const wipeObjectData = (key) => {
            let data = readAdminUsersJson(key, {});
            if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
            Object.keys(data || {}).forEach(objKey => {
                if (getUserIdentityToken(objKey) === targetToken) delete data[objKey];
            });
            localStorage.setItem(key, JSON.stringify(data));
        };
        wipeObjectData('agentNotes');
        wipeObjectData('monitor_data');
        wipeObjectData('cancellationCounts');
        
        // 4.5. CLOUD WIPE (Critical for Row-Level Sync)
        if (typeof hardDeleteByQuery === 'function') {
            // Fire off deletes in parallel for speed
            const promises = [
                hardDeleteByQuery('records', 'trainee', agentName),
                hardDeleteByQuery('submissions', 'trainee', agentName),
                hardDeleteByQuery('attendance', 'user_id', agentName),
                hardDeleteByQuery('live_bookings', 'trainee', agentName),
                hardDeleteByQuery('saved_reports', 'trainee', agentName),
                hardDeleteByQuery('insight_reviews', 'trainee', agentName),
                hardDeleteByQuery('exemptions', 'trainee', agentName),
                hardDeleteByQuery('link_requests', 'trainee', agentName),
                hardDeleteByQuery('monitor_state', 'user_id', agentName),
                hardDeleteByQuery('tl_task_submissions', 'user_id', agentName),
                hardDeleteByQuery('monitor_history', 'user_id', agentName),
                hardDeleteByQuery('access_logs', 'user_id', agentName)
            ];
            
            const results = await Promise.allSettled(promises);
            const failed = results.filter(result => result.status === 'rejected');
            if (failed.length) {
                console.warn(`Delete Agent: ${failed.length} cloud row delete operation(s) failed and were left in the pending delete queue.`, failed.map(result => result.reason));
            }
        }

        // 5. Force Sync (Update Blobs)
        if(typeof saveToServer === 'function') {
            await saveToServer([
                'rosters', 'users', 'revokedUsers', 'records', 'submissions', 
                'attendance_records', 'liveBookings', 'savedReports', 'tl_task_submissions',
                'insightReviews', 'exemptions', 'agentNotes', 'monitor_data', 'linkRequests', 'cancellationCounts', 'retrain_archives',
                'monitor_history', 'accessLogs'
            ], true);
        }
        
        if(typeof logAuditAction === 'function') logAuditAction(CURRENT_USER.user, 'Delete Agent', `Obliterated agent ${agentName}`);
        
        // Refresh UI
        loadRostersList(); // Re-render the list immediately
        if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns();
        if(typeof showToast === 'function') showToast(`Agent ${agentName} obliterated from system.`, "success");

    } catch (e) {
        console.error("Delete Agent Error:", e);
        alert("Error deleting agent: " + e.message);
    } finally {
        if(btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-trash"></i>'; } // Restore icon button state
    }
}

function loadRostersToSelect(elementId = 'selectedGroup') { 
    const r = readAdminUsersObject('rosters');
    const s = document.getElementById(elementId); 
    if(!s) return;
    
    const currentVal = s.value; 
    s.innerHTML='<option value="">-- Select Group --</option>'; 
    
    Object.keys(r).sort().reverse().forEach(k => { 
        s.add(new Option(getGroupLabel(k, r[k].length), k)); 
    }); 
    
    if(currentVal && r[currentVal]) s.value = currentVal;
}

function populateTraineeDropdown() { 
    const users = readAdminUsersArray('users');
    const list = document.getElementById('traineeOptions'); 
    
     if(list) {
          list.innerHTML = ''; 
          const seen = new Set();
          users.filter(u => (u.user || u.username) && u.role && u.role.trim().toLowerCase() === 'trainee')
                 .sort((a,b) => (String(a.user || a.username)).localeCompare(String(b.user || b.username)))
                 .forEach(u => { 
                     const uname = String(u.user || u.username || '').trim();
                     if (!uname) return;
                     const key = uname.toLowerCase();
                     if (seen.has(key)) return; // Prevent duplicate options
                     seen.add(key);
                     let opt = document.createElement('option'); 
                     opt.value = uname; 
                     list.appendChild(opt); 
                 }); 
     }
}

// --- USER & TRAINEE MANAGEMENT ---

async function scanAndGenerateUsers(silent = false, emailMap = {}) { 
    const sanitized = sanitizeUsersAndRosters();
    const users = Array.isArray(sanitized.users) ? sanitized.users : [];
    const rosters = (sanitized.rosters && typeof sanitized.rosters === 'object') ? sanitized.rosters : {};
    const revoked = readAdminUsersArray('revokedUsers');
    const revokedSet = new Set(revoked.map(r => String(r || '').trim().toLowerCase()));

    let allNames = new Set(); 
    
    // Harvest from Rosters
    Object.values(rosters).forEach(g => {
        if(Array.isArray(g)) g.forEach(n => { if(n && n.trim()) allNames.add(n.trim()); });
    }); 
    
    let createdCount = 0; 
    
    allNames.forEach(name => { 
        const normalized = name.toLowerCase();
        // Do not auto-resurrect deleted users; restore must be explicit.
        if (revokedSet.has(normalized)) return;

        // Case-insensitive check
        const exists = findUserByIdentityIndex(users, name) > -1;

        if(!exists) { 
            // Secure native browser RNG
            const arr = new Uint16Array(1);
            window.crypto.getRandomValues(arr);
            const pin = ((arr[0] % 9000) + 1000).toString();
            
            const newUser = { user: name, pass: pin, role: 'trainee', createdBy: 'System Auto-Gen', lastModified: new Date().toISOString() };
            
            // Inject Email if available from Roster creation
            if (emailMap && emailMap[name]) {
                newUser.traineeData = {
                    email: emailMap[name],
                    contact: emailMap[name]
                };
            }
            
            users.push(newUser); 
            createdCount++; 
        } 
    }); 
    
    if(createdCount > 0) { 
        localStorage.setItem('users', JSON.stringify(users)); 

        // FIX: Ensure cloud sync happens immediately
        await secureUserSave();
        if(!silent) alert(`Generated ${createdCount} missing accounts.`); 
        loadAdminUsers(); 
        populateTraineeDropdown(); 
    } else {
        if(!silent) alert("No missing users found based on current Rosters/Records.");
    }
}

function renderAdminUsersHeaderStats(stats) {
    const box = document.getElementById('adminUsersLiveSummary');
    if (!box) return;

    const items = [
        { label: 'Visible', value: stats.visible },
        { label: 'Accounts', value: stats.accounts },
        { label: 'Trainees', value: stats.trainees },
        { label: 'Groups', value: stats.groups },
        { label: 'Active Now', value: stats.activeNow }
    ];

    box.innerHTML = items.map(item => `
        <div style="flex:1; min-width:110px; background:var(--bg-input); border:1px solid var(--border-color); border-radius:10px; padding:8px 10px;">
            <div style="font-size:0.72rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em;">${item.label}</div>
            <div style="font-size:1.05rem; font-weight:700; color:var(--text-main);">${item.value}</div>
        </div>
    `).join('');
}

function isUserBlockedAccount(user) {
    if (!user || typeof user !== 'object') return false;
    if (user.blocked === true) return true;
    return String(user.status || '').toLowerCase().trim() === 'blocked';
}

function getUserRoleBadge(role) {
    const normalizedRole = String(role || '').toLowerCase().trim();
    if (normalizedRole === 'super_admin') {
        return `<span style="color:#9b59b6; font-weight:bold; background:rgba(155, 89, 182, 0.1); padding:2px 8px; border-radius:999px;"><i class="fas fa-user-astronaut"></i> Super Admin</span>`;
    }
    if (normalizedRole === 'admin') {
        return `<span style="color:var(--primary); font-weight:bold; background:rgba(243, 112, 33, 0.1); padding:2px 8px; border-radius:999px;"><i class="fas fa-user-shield"></i> Admin</span>`;
    }
    if (normalizedRole === 'teamleader') {
        return `<span style="color:#2ecc71; font-weight:bold; background:rgba(46, 204, 113, 0.1); padding:2px 8px; border-radius:999px;"><i class="fas fa-users"></i> Team Leader</span>`;
    }
    if (normalizedRole === 'special_viewer') {
        return `<span style="color:#00bcd4; font-weight:bold; background:rgba(0, 188, 212, 0.1); padding:2px 8px; border-radius:999px;"><i class="fas fa-eye"></i> Special Viewer</span>`;
    }
    return `<span style="color:var(--text-muted); font-size:0.85rem;">Trainee</span>`;
}

function getUserGroupLabels(username, rosters) {
    const labels = [];
    Object.entries(rosters || {}).forEach(([gid, members]) => {
        if (!Array.isArray(members)) return;
        if (!members.some(member => userIdentityMatches(member, username))) return;
        labels.push(typeof getGroupLabel === 'function' ? getGroupLabel(gid, members.length) : gid);
    });
    return labels;
}

function renderAdminUserCard(u, idx, rosters, savedReports) {
    const safeUser = String(u.user || '').replace(/'/g, "\\'");
    const displayUser = (typeof escapeHTML === 'function') ? escapeHTML(String(u.user || '')) : String(u.user || '');
    const normalizedRole = String(u.role || '').toLowerCase().trim();
    const isBlocked = isUserBlockedAccount(u);
    const isSelf = userIdentityMatches(u.user, CURRENT_USER.user);
    const isCoreAdmin = userIdentityMatches(u.user, 'admin');
    const canManage = CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin';
    const groups = getUserGroupLabels(u.user, rosters);

    const initials = String(u.user || '').substring(0, 2).toUpperCase();
    let hash = 0;
    for (let j = 0; j < String(u.user || '').length; j++) hash = String(u.user || '').charCodeAt(j) + ((hash << 5) - hash);
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
    const color = "#" + "00000".substring(0, 6 - c.length) + c;
    const avatarHtml = `<span style="width:28px; height:28px; border-radius:50%; background:${color}; color:#fff; display:inline-flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:bold; box-shadow:0 2px 4px rgba(0,0,0,0.2);">${initials || 'U'}</span>`;

    const email = (u.traineeData && u.traineeData.email) ? u.traineeData.email : '';
    const phone = (u.traineeData && u.traineeData.phone) ? u.traineeData.phone : '';
    const roleChip = getUserRoleBadge(normalizedRole);
    const statusChip = `<span class="admin-user-status-pill ${isBlocked ? 'blocked' : 'active'}">${isBlocked ? 'Blocked' : 'Active'}</span>`;
    const groupText = groups.length > 0 ? groups.join(', ') : 'No Group';
    const contactText = [email, phone].filter(Boolean).join(' | ') || 'No Contact';

    let passDisplay = '';
    const isHashed = u.pass && u.pass.length === 64 && /^[0-9a-fA-F]+$/.test(u.pass);
    if (isHashed) {
        passDisplay = `<span style="color:var(--text-muted); font-style:italic;"><i class="fas fa-lock"></i> Encrypted Password</span>`;
    } else {
        const passId = `pass-display-${getUserIdentityToken(u.user || `user_${idx}`)}-${idx}`;
        const safeRealPass = String(u.pass || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        passDisplay = `
            <span id="${passId}" data-real="${safeRealPass}" style="font-family:monospace; margin-right:5px; color:var(--primary);">******</span>
            <button class="btn-secondary btn-sm" style="padding:2px 5px;" onclick="togglePasswordView('${passId}')"><i class="fas fa-eye"></i></button>
        `;
    }

    let actions = '';
    if (canManage && !isCoreAdmin) {
        const hasReport = savedReports.some(r => userIdentityMatches(r && r.trainee, u.user));
        const moveBtn = hasReport
            ? `<button class="btn-warning btn-sm" onclick="openMoveUserModal('${safeUser}')" title="Move to another group"><i class="fas fa-exchange-alt"></i></button>`
            : `<button class="btn-secondary btn-sm" disabled title="Onboard Report Required to Move"><i class="fas fa-exchange-alt" style="opacity:0.5;"></i></button>`;
        const impBtn = (CURRENT_USER.role === 'super_admin' && !isSelf)
            ? `<button class="btn-primary btn-sm" onclick="impersonateUser('${safeUser}')" title="Impersonate"><i class="fas fa-mask"></i></button>`
            : '';
        let demoteBtn = '';
        if (CURRENT_USER.role === 'super_admin' && normalizedRole === 'super_admin' && !isSelf) {
            demoteBtn = `<button class="btn-warning btn-sm" onclick="demoteSuperAdmin('${safeUser}')" title="Demote to Admin"><i class="fas fa-level-down-alt"></i></button>`;
        }
        const blockBtn = !isSelf
            ? `<button class="${isBlocked ? 'btn-success' : 'btn-warning'} btn-sm" onclick="toggleBlockUser('${safeUser}')" title="${isBlocked ? 'Unblock User' : 'Block User'}"><i class="fas ${isBlocked ? 'fa-unlock' : 'fa-ban'}"></i></button>`
            : '';
        actions = `${demoteBtn} ${impBtn} ${moveBtn} <button class="btn-secondary btn-sm" onclick="openUserEdit('${safeUser}')" title="Advanced Edit"><i class="fas fa-user-edit"></i></button> ${blockBtn} <button class="btn-danger btn-sm" onclick="remUser('${safeUser}')" title="Delete User"><i class="fas fa-trash"></i></button>`;
    } else if (CURRENT_USER.role === 'special_viewer') {
        actions = `<span style="color:var(--text-muted); font-style:italic;">View Only</span>`;
    } else if (isSelf) {
        actions = `<button class="btn-secondary btn-sm" onclick="openUserEdit('${safeUser}')"><i class="fas fa-pen"></i> Edit Password</button>`;
    }

    return `
        <div class="admin-user-row ${isBlocked ? 'row-error' : ''}">
            <div class="admin-user-row-header">
                <div class="admin-user-name">${avatarHtml}<span>${displayUser}</span></div>
                <div class="admin-user-header-right">${roleChip}${statusChip}</div>
            </div>
            <div class="admin-user-meta">
                <span class="admin-user-chip"><i class="fas fa-layer-group"></i> ${groupText}</span>
                <span class="admin-user-chip"><i class="fas fa-address-card"></i> ${contactText}</span>
                <span class="admin-user-chip admin-user-pass-wrap">${passDisplay}</span>
            </div>
            <div class="admin-user-actions">${actions}</div>
        </div>
    `;
}

function loadAdminUsers(forceRender = false) {
    if (!CURRENT_USER) return;

    if (!forceRender && document.activeElement &&
       (document.activeElement.id === 'userSearch' ||
        document.activeElement.id === 'addUserNameModal' ||
        document.activeElement.id === 'addUserPassModal')) {
        return;
    }

    restrictTraineeMenu();
    splitLegacyRetrainArchives().catch(() => {});

    const sanitized = sanitizeUsersAndRosters();
    const users = sanitized.users;
    const savedReports = readAdminUsersArray('savedReports');
    const rosters = sanitized.rosters;

    if (sanitized.usersChanged || sanitized.rostersChanged) {
        if (typeof saveToServer === 'function') {
            const keys = [];
            if (sanitized.usersChanged) keys.push('users');
            if (sanitized.rostersChanged) keys.push('rosters');
            if (keys.length > 0) saveToServer(keys, true, true).catch(() => {});
        }
    }

    const search = String(document.getElementById('userSearch')?.value || '').toLowerCase().trim();
    const roleFilter = String(document.getElementById('userRoleFilter')?.value || '').toLowerCase().trim();
    const groupSelect = document.getElementById('userGroupFilter');

    let groupFilter = '';
    if (groupSelect) {
        const existingValue = groupSelect.value;
        if (document.activeElement !== groupSelect || forceRender) {
            groupSelect.innerHTML = '<option value="">All Trainee Groups</option>';
            Object.keys(rosters).sort().reverse().forEach(gid => {
                const label = (typeof getGroupLabel === 'function') ? getGroupLabel(gid, (rosters[gid] || []).length) : gid;
                groupSelect.add(new Option(label, gid));
            });
            groupSelect.value = existingValue;
        }
        groupFilter = groupSelect.value;
    }

    const canManage = CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin';
    const addBtn = document.getElementById('btnAddUserPopup');
    if (addBtn) addBtn.classList.toggle('hidden', !canManage);

    let displayUsers = [];
    if (canManage) {
        displayUsers = users;
    } else if (CURRENT_USER.role === 'special_viewer') {
        displayUsers = users;
    } else {
        displayUsers = users.filter(u => userIdentityMatches(u.user, CURRENT_USER.user));
    }

    displayUsers = displayUsers.filter(u => {
        const role = String(u.role || '').toLowerCase().trim();
        const email = String((u.traineeData && u.traineeData.email) || '').toLowerCase();
        const phone = String((u.traineeData && u.traineeData.phone) || '').toLowerCase();
        const groupLabels = getUserGroupLabels(u.user, rosters).join(' ').toLowerCase();
        const statusText = isUserBlockedAccount(u) ? 'blocked' : 'active';
        const matchesSearch = !search || [u.user, role, email, phone, groupLabels, statusText].some(v => String(v || '').toLowerCase().includes(search));
        const matchesRole = !roleFilter || role === roleFilter;

        let matchesGroup = true;
        if (groupFilter) {
            const members = rosters[groupFilter] || [];
            const inTargetGroup = members.some(member => userIdentityMatches(member, u.user));
            if (role === 'trainee') matchesGroup = inTargetGroup;
            else if (roleFilter === 'trainee') matchesGroup = false;
        }
        return matchesSearch && matchesRole && matchesGroup;
    });

    displayUsers.sort((a, b) => {
        const aRank = getRoleRank(a.role);
        const bRank = getRoleRank(b.role);
        if (aRank !== bRank) return bRank - aRank;
        return String(a.user || '').localeCompare(String(b.user || ''));
    });

    const now = Date.now();
    const activeNow = Object.values(window.ACTIVE_USERS_CACHE || {}).filter(u => (now - (u.local_received_at || 0)) < 90000).length;
    renderAdminUsersHeaderStats({
        visible: displayUsers.length,
        accounts: users.length,
        trainees: users.filter(u => String(u.role || '').toLowerCase() === 'trainee').length,
        groups: Object.keys(rosters || {}).length,
        activeNow
    });

    const unifiedList = document.getElementById('adminUserUnifiedList');
    if (!unifiedList) {
        const userList = document.getElementById('userList');
        if (userList) userList.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">New user manager layout unavailable in this runtime.</td></tr>';
        return;
    }

    const rows = displayUsers.map((u, i) => renderAdminUserCard(u, i, rosters, savedReports));
    unifiedList.innerHTML = rows.length > 0 ? rows.join('') : '<div class="admin-user-empty">No users match the current filters.</div>';
}

function togglePasswordView(elementId) {
    const el = document.getElementById(elementId);
    if(el.innerText === '******') {
        el.innerText = el.getAttribute('data-real');
    } else {
        el.innerText = '******';
    }
}

function openMoveUserModal(username) {
    userToMove = username;
    const rosters = readAdminUsersObject('rosters');
    let currentGroup = "None";
    
    for (const [gid, members] of Object.entries(rosters)) {
        if (Array.isArray(members) && members.some(member => userIdentityMatches(member, username))) {
            currentGroup = getGroupLabel(gid);
            break;
        }
    }
    
    document.getElementById('moveUserTitle').innerText = `Move Agent: ${username}`;
    document.getElementById('moveUserCurrent').innerText = currentGroup;
    
    const select = document.getElementById('moveUserTargetSelect');
    select.innerHTML = '<option value="">-- Select New Group --</option>';
    Object.keys(rosters).sort().reverse().forEach(gid => {
        select.add(new Option(getGroupLabel(gid, rosters[gid].length), gid));
    });

    document.getElementById('moveUserModal').classList.remove('hidden');
}

async function confirmMoveUser() {
    const targetGid = document.getElementById('moveUserTargetSelect').value;
    if(!targetGid) return alert("Please select a destination group.");
    const normalizedUserToMove = getUserIdentityToken(userToMove);
    if (!normalizedUserToMove) return alert("No agent selected for migration. Please reopen the move dialog.");

    if(!confirm(`Move ${userToMove} to ${targetGid}?\n\nWARNING: This will ARCHIVE all their current progress, records, and attendance to start fresh in the new group (Retrain Mode).\n\nProceed?`)) return;

    const btn = document.querySelector('#moveUserModal .btn-warning');
    if(btn) { btn.innerText = "Moving & Archiving..."; btn.disabled = true; }

    try {
        if (typeof loadFromServer === 'function') {
            try {
                await loadFromServer(true);
            } catch (syncError) {
                console.warn('Pre-migration refresh failed; continuing with local cache.', syncError);
            }
        }

        const targetToken = normalizedUserToMove;
        const currentRosters = readAdminUsersObject('rosters');
        let previousGroup = 'Ungrouped';
        Object.keys(currentRosters).forEach((gid) => {
            const members = Array.isArray(currentRosters[gid]) ? currentRosters[gid] : [];
            if (members.some(member => getUserIdentityToken(member) === targetToken)) previousGroup = gid;
        });

        // 1. ARCHIVE DATA (Snapshot)
        let archives = readRetrainArchives();
        const resumeIndex = findResumableRetrainArchiveIndex(archives, targetToken, targetGid);
        const existingAttempts = archives.filter(entry => getUserIdentityToken(entry && entry.user) === targetToken).length;
        const attemptNumber = existingAttempts + 1;
        const progressConfigSnapshot = resumeIndex > -1 && archives[resumeIndex].progressConfigSnapshot
            ? archives[resumeIndex].progressConfigSnapshot
            : readProgressConfigSnapshot();
        const officialProgressItems = (window.ProgressCatalog && typeof window.ProgressCatalog.getOfficialItemsFromConfig === 'function')
            ? window.ProgressCatalog.getOfficialItemsFromConfig(progressConfigSnapshot, { includeAuto: true })
            : null;
        const liveSnapshot = {
            records: rowsForMoveArchive('records', ['trainee', 'user', 'user_id'], targetToken),
            submissions: rowsForMoveArchive('submissions', ['trainee', 'user', 'user_id'], targetToken),
            attendance: rowsForMoveArchive('attendance_records', ['user', 'user_id', 'trainee'], targetToken),
            reports: rowsForMoveArchive('savedReports', ['trainee', 'user', 'user_id'], targetToken),
            reviews: rowsForMoveArchive('insightReviews', ['trainee', 'user', 'user_id'], targetToken),
            exemptions: rowsForMoveArchive('exemptions', ['trainee', 'user', 'user_id'], targetToken),
            liveBookings: rowsForMoveArchive('liveBookings', ['trainee', 'user', 'user_id'], targetToken),
            liveSessions: rowsForMoveArchive('liveSessions', ['trainee', 'user', 'user_id'], targetToken),
            linkRequests: rowsForMoveArchive('linkRequests', ['trainee', 'user', 'user_id'], targetToken),
            monitorHistory: rowsForMoveArchive('monitor_history', ['user', 'user_id'], targetToken),
            tlTaskSubmissions: rowsForMoveArchive('tl_task_submissions', ['user', 'user_id', 'trainee'], targetToken),
            notes: (() => {
                const allNotes = readAdminUsersObject('agentNotes');
                const key = Object.keys(allNotes).find(k => getUserIdentityToken(k) === targetToken);
                return key ? allNotes[key] : null;
            })()
        };
        let archiveData = resumeIndex > -1
            ? {
                ...archives[resumeIndex],
                user: archives[resumeIndex].user || userToMove,
                attemptNumber: archives[resumeIndex].attemptNumber || Math.max(1, existingAttempts),
                attemptLabel: archives[resumeIndex].attemptLabel || `Attempt ${Math.max(1, existingAttempts)}`,
                archiveType: 'retrain',
                reason: archives[resumeIndex].reason || ('Moved to ' + targetGid),
                fromGroup: archives[resumeIndex].fromGroup || previousGroup,
                targetGroup: targetGid,
                records: mergeArchiveRows(archives[resumeIndex].records, liveSnapshot.records),
                submissions: mergeArchiveRows(archives[resumeIndex].submissions, liveSnapshot.submissions),
                attendance: mergeArchiveRows(archives[resumeIndex].attendance, liveSnapshot.attendance),
                reports: mergeArchiveRows(archives[resumeIndex].reports, liveSnapshot.reports),
                reviews: mergeArchiveRows(archives[resumeIndex].reviews, liveSnapshot.reviews),
                exemptions: mergeArchiveRows(archives[resumeIndex].exemptions, liveSnapshot.exemptions),
                liveBookings: mergeArchiveRows(archives[resumeIndex].liveBookings, liveSnapshot.liveBookings),
                liveSessions: mergeArchiveRows(archives[resumeIndex].liveSessions, liveSnapshot.liveSessions),
                linkRequests: mergeArchiveRows(archives[resumeIndex].linkRequests, liveSnapshot.linkRequests),
                monitorHistory: mergeArchiveRows(archives[resumeIndex].monitorHistory, liveSnapshot.monitorHistory),
                tlTaskSubmissions: mergeArchiveRows(archives[resumeIndex].tlTaskSubmissions, liveSnapshot.tlTaskSubmissions),
                notes: archives[resumeIndex].notes || liveSnapshot.notes,
                progressConfigSnapshot,
                resumedAt: new Date().toISOString()
            }
            : {
                id: `retrain_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                user: userToMove,
                movedDate: new Date().toISOString(),
                attemptNumber,
                attemptLabel: `Attempt ${attemptNumber}`,
                archiveType: 'retrain',
                reason: 'Moved to ' + targetGid,
                fromGroup: previousGroup,
                targetGroup: targetGid,
                ...liveSnapshot,
                progressConfigSnapshot
            };
        if (window.ProgressCatalog && typeof window.ProgressCatalog.getTraineeProgress === 'function') {
            archiveData.officialProgress = window.ProgressCatalog.getTraineeProgress(userToMove, previousGroup, {
                includeAuto: true,
                items: officialProgressItems || undefined,
                ignoreExemptionGroup: true,
                data: {
                    records: archiveData.records,
                    submissions: archiveData.submissions,
                    savedReports: archiveData.reports,
                    insightReviews: archiveData.reviews,
                    liveBookings: archiveData.liveBookings,
                    exemptions: archiveData.exemptions
                }
            });
        }

        archiveData = compactRetrainArchiveEntry(archiveData);
        if (resumeIndex > -1) {
            archives[resumeIndex] = archiveData;
        } else {
            archives.push(archiveData);
        }
        archives = compactRetrainArchivesForStorage(archives);
        archiveData = archives.find(entry => entry && entry.id === archiveData.id) || archiveData;
        localStorage.setItem('retrain_archives', JSON.stringify(archives));

        // Persist the archive snapshot before clearing live rows. This avoids a half-migration
        // where deletes succeed but the retrain archive does not reach the server.
        if(typeof saveToServer === 'function') {
            const archiveSaved = await saveToServer(['retrain_archives'], true, true);
            if (!archiveSaved) {
                throw new Error('Retrain archive could not be saved to the server. No live data was cleared. The archive was kept locally and this move can be retried after refresh.');
            }
        }

        const deleteSummary = await executeRetrainArchiveServerDeletes(archiveData);
        archiveData.serverCleanup = {
            directDeletes: deleteSummary.deleted,
            queuedDeletes: deleteSummary.queued,
            skippedRowsWithoutId: deleteSummary.skipped,
            failedTables: deleteSummary.failed,
            cleanedAt: new Date().toISOString()
        };
        archives = readRetrainArchives();
        const archiveIndex = archives.findIndex(entry => entry && entry.id === archiveData.id);
        if (archiveIndex > -1) {
            archives[archiveIndex] = compactRetrainArchiveEntry(archiveData);
            archives = compactRetrainArchivesForStorage(archives);
            archiveData = archives.find(entry => entry && entry.id === archiveData.id) || archiveData;
            localStorage.setItem('retrain_archives', JSON.stringify(archives));
        }

        // 2. WIPE ACTIVE DATA (Clean Slate)
        const wipe = (key, fields) => {
            const fieldList = Array.isArray(fields) ? fields : [fields];
            let data = readAdminUsersArray(key);
            const newData = data.filter(item => {
                if (!item) return true;
                return !fieldList.some(field => getUserIdentityToken(item[field] || '') === normalizedUserToMove);
            });
            if (data.length !== newData.length) localStorage.setItem(key, JSON.stringify(newData));
        };
        
        wipe('records', ['trainee', 'user', 'user_id']);
        wipe('submissions', ['trainee', 'user', 'user_id']);
        wipe('attendance_records', ['user', 'user_id', 'trainee']);
        wipe('savedReports', ['trainee', 'user', 'user_id']);
        wipe('insightReviews', ['trainee', 'user', 'user_id']);
        wipe('exemptions', ['trainee', 'user', 'user_id']);
        wipe('liveBookings', ['trainee', 'user', 'user_id']);
        wipe('liveSessions', ['trainee', 'user', 'user_id']);
        wipe('linkRequests', ['trainee', 'user', 'user_id']);
        wipe('monitor_history', ['user', 'user_id']);
        wipe('tl_task_submissions', ['user', 'user_id', 'trainee']);
        
        let notes = readAdminUsersObject('agentNotes');
        const noteKey = Object.keys(notes).find(k => getUserIdentityToken(k) === normalizedUserToMove);
        if(noteKey) { delete notes[noteKey]; localStorage.setItem('agentNotes', JSON.stringify(notes)); }

        // 3. MOVE ROSTER
        const rosters = readAdminUsersObject('rosters');
        for (const gid in rosters) {
            if (!Array.isArray(rosters[gid])) continue;
            rosters[gid] = rosters[gid].filter(member => getUserIdentityToken(member) !== normalizedUserToMove);
        }
        if(!rosters[targetGid]) rosters[targetGid] = [];
        rosters[targetGid] = rosters[targetGid].filter((member, idx, arr) => {
            const memberNorm = getUserIdentityToken(member);
            return memberNorm && arr.findIndex(x => getUserIdentityToken(x) === memberNorm) === idx;
        });
        if(!rosters[targetGid].some(member => getUserIdentityToken(member) === normalizedUserToMove)) rosters[targetGid].push(userToMove);
        localStorage.setItem('rosters', JSON.stringify(rosters));

        // Schedule item exceptions are trainee-specific and can keep old timelines visible
        // after the roster move. A retrain move starts a clean schedule slate.
        const scheduleCleanup = removeUserFromScheduleExceptions(readAdminUsersObject('schedules'), normalizedUserToMove);
        if (scheduleCleanup.changed) {
            localStorage.setItem('schedules', JSON.stringify(scheduleCleanup.schedules));
        }

        // 4. SYNC EVERYTHING
        if(typeof saveToServer === 'function') {
            const movedSaved = await saveToServer([
                'rosters', 'schedules', 'retrain_archives', 'records', 'submissions', 'attendance_records',
                'savedReports', 'insightReviews', 'agentNotes', 'exemptions', 'liveBookings',
                'liveSessions', 'linkRequests', 'monitor_history', 'tl_task_submissions', 'system_tombstones'
            ], true);
            if (!movedSaved) {
                throw new Error('Move changes could not be fully saved to the server. Please refresh before retrying.');
            }
        }

        const cleanupCheck = await verifyRetrainArchiveServerCleanup(userToMove);
        const leftoverRows = Number(cleanupCheck.records || 0) + Number(cleanupCheck.submissions || 0) + Number(cleanupCheck.liveSessions || 0);
        if (leftoverRows > 0) {
            alert([
                `${userToMove} was moved to ${targetGid}, but server cleanup still sees old live rows.`,
                '',
                `Remaining records: ${cleanupCheck.records || 0}`,
                `Remaining submissions: ${cleanupCheck.submissions || 0}`,
                `Remaining live sessions: ${cleanupCheck.liveSessions || 0}`,
                '',
                'The archive snapshot was saved. Please refresh Data Studio and run Archive + Reset again for this user before they retake assessments.'
            ].join('\n'));
            return;
        }

        alert(`${userToMove} moved to ${targetGid}. Previous data archived.`);
        document.getElementById('moveUserModal').classList.add('hidden');
        loadAdminUsers();
        refreshAllDropdowns();

    } catch(e) {
        console.error("Move Error:", e);
        alert("Error moving user: " + e.message);
    } finally {
        if(btn) { btn.innerText = "Confirm Move"; btn.disabled = false; }
    }
}

async function demoteSuperAdmin(username) {
    if (!confirm(`Demote ${username} from Super Admin to Admin?`)) return;

    const users = readAdminUsersArray('users');
    const idx = findUserByIdentityIndex(users, username);
    
    if (idx > -1) {
        users[idx].role = 'admin';
        localStorage.setItem('users', JSON.stringify(users));
        await secureUserSave();
        loadAdminUsers();
        if (typeof showToast === 'function') showToast(`${username} demoted to Admin.`, "success");
    }
}

function generatePassword(targetInputId = '') {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$";
    let pass = "";
    const arr = new Uint8Array(12);
    window.crypto.getRandomValues(arr);
    for(let i=0; i<12; i++) {
        pass += chars.charAt(arr[i] % chars.length);
    }
    const targetId = targetInputId || (document.getElementById('addUserPassModal') ? 'addUserPassModal' : 'newUserPass');
    const field = document.getElementById(targetId);
    if (field) field.value = pass;
    return pass;
}

function openAddUserModal() {
    if (CURRENT_USER.role !== 'admin' && CURRENT_USER.role !== 'super_admin') {
        alert("You do not have permission to create users.");
        return;
    }

    const allowSuperAdmin = CURRENT_USER.role === 'super_admin';
    const roleOptions = [
        '<option value="trainee">Trainee</option>',
        '<option value="teamleader">Team Leader</option>',
        '<option value="admin">Admin</option>',
        '<option value="special_viewer">Special Viewer</option>',
        allowSuperAdmin ? '<option value="super_admin">Super Admin</option>' : ''
    ].join('');

    document.getElementById('adminEditTitle').innerHTML = 'Add User';
    document.getElementById('adminEditContent').innerHTML = `
        <label>Username</label>
        <input type="text" id="addUserNameModal" placeholder="Username">
        <label>Role</label>
        <select id="addUserRoleModal">${roleOptions}</select>
        <label>Password</label>
        <div style="display:flex; gap:6px;">
            <input type="text" id="addUserPassModal" placeholder="Password" autocomplete="off">
            <button class="btn-secondary" style="width:auto;" onclick="generatePassword('addUserPassModal')">Gen</button>
        </div>
        <label>Email (Optional)</label>
        <input type="text" id="addUserEmailModal" placeholder="name@example.com">
        <label>Phone (Optional)</label>
        <input type="text" id="addUserPhoneModal" placeholder="082...">
    `;
    document.getElementById('adminEditModal').classList.remove('hidden');
    document.getElementById('adminEditSaveBtn').onclick = async () => {
        const userPayload = {
            user: document.getElementById('addUserNameModal')?.value || '',
            pass: document.getElementById('addUserPassModal')?.value || '',
            role: document.getElementById('addUserRoleModal')?.value || 'trainee',
            email: document.getElementById('addUserEmailModal')?.value || '',
            phone: document.getElementById('addUserPhoneModal')?.value || ''
        };
        const created = await addUser(userPayload);
        if (created) document.getElementById('adminEditModal').classList.add('hidden');
    };
}

async function addUser(payload = null) {
    const fromPayload = payload && typeof payload === 'object';
    const u = String(fromPayload ? payload.user : (document.getElementById('newUserName')?.value || '')).trim();
    const p = String(fromPayload ? payload.pass : (document.getElementById('newUserPass')?.value || ''));
    const r = String(fromPayload ? payload.role : (document.getElementById('newUserRole')?.value || 'trainee')).toLowerCase().trim();
    const email = String(fromPayload ? payload.email : '').trim();
    const phone = String(fromPayload ? payload.phone : '').trim();
    const normalizedUser = getUserIdentityToken(u);
    
    // SECURITY: Prevent Privilege Escalation
    if (r === 'super_admin' && CURRENT_USER.role !== 'super_admin') {
        alert("Access Denied: Only Super Admins can create Super Admins.");
        return false;
    }

    if(!u || !p) {
        alert("Username and password are required.");
        return false;
    }
    const users = readAdminUsersArray('users');
    if(findUserByIdentityIndex(users, u) > -1) {
        alert("User exists");
        return false;
    }
    
    // --- TOMBSTONE CHECK ---
    // If this user was previously deleted (revoked), remove them from blacklist
    // so they can be re-created successfully.
    let revoked = readAdminUsersArray('revokedUsers');
    let revokedChanged = false;
    if(revoked.some(name => getUserIdentityToken(name) === normalizedUser)) {
        revoked = revoked.filter(name => getUserIdentityToken(name) !== normalizedUser);
        localStorage.setItem('revokedUsers', JSON.stringify(revoked));
        revokedChanged = true;
    }

    let finalPass = p;
    if (typeof hashPassword === 'function') {
        finalPass = await hashPassword(p);
    }

    const newUser = {
        user: u,
        pass: finalPass,
        role: r,
        blocked: false,
        status: 'active',
        lastModified: new Date().toISOString(),
        modifiedBy: CURRENT_USER.user
    };

    if (email || phone) {
        newUser.traineeData = {
            email,
            phone,
            contact: `${email} | ${phone}`.trim()
        };
    }

    users.push(newUser);
    localStorage.setItem('users', JSON.stringify(users)); 
    
    await secureUserSave(revokedChanged);

    const oldName = document.getElementById('newUserName');
    const oldPass = document.getElementById('newUserPass');
    if (oldName) oldName.value = '';
    if (oldPass) oldPass.value = '';

    loadAdminUsers(); 
    populateTraineeDropdown();
    if (typeof showToast === 'function') showToast(`${u} created successfully.`, "success");
    return true;
}

async function setUserBlocked(username, shouldBlock) {
    const target = String(username || '').trim();
    if (!target) return false;
    if (CURRENT_USER.role !== 'admin' && CURRENT_USER.role !== 'super_admin') {
        alert("You do not have permission to change user status.");
        return false;
    }
    if (userIdentityMatches(target, CURRENT_USER.user)) {
        alert("You cannot block your own account.");
        return false;
    }
    if (userIdentityMatches(target, 'admin')) {
        alert("The default admin account cannot be blocked.");
        return false;
    }

    const users = readAdminUsersArray('users');
    const idx = findUserByIdentityIndex(users, target);
    if (idx === -1) {
        alert("User not found.");
        return false;
    }

    users[idx].blocked = !!shouldBlock;
    users[idx].status = shouldBlock ? 'blocked' : 'active';
    users[idx].lastModified = new Date().toISOString();
    users[idx].modifiedBy = CURRENT_USER.user;

    localStorage.setItem('users', JSON.stringify(users));
    await secureUserSave();
    loadAdminUsers(true);
    return true;
}

async function toggleBlockUser(username) {
    const users = readAdminUsersArray('users');
    const idx = findUserByIdentityIndex(users, username);
    if (idx === -1) return;

    const currentlyBlocked = isUserBlockedAccount(users[idx]);
    const actionLabel = currentlyBlocked ? 'unblock' : 'block';
    if (!confirm(`Are you sure you want to ${actionLabel} '${users[idx].user}'?`)) return;

    const changed = await setUserBlocked(users[idx].user, !currentlyBlocked);
    if (changed && typeof showToast === 'function') {
        showToast(`${users[idx].user} ${currentlyBlocked ? 'unblocked' : 'blocked'}.`, currentlyBlocked ? "success" : "warning");
    }
}

// FIXED: Now uses Tombstone (Blacklist) and Instant Save
async function remUser(username) { 
    if(confirm(`Permanently delete user '${username}'?`)) { 
        const target = String(username || '').trim();
        if (!target) return;
        const targetNorm = getUserIdentityToken(target);

        // 1) Remove account (case-insensitive)
        let users = readAdminUsersArray('users');
        users = users.filter(u => getUserIdentityToken(u && (u.user || u.username)) !== targetNorm);
        localStorage.setItem('users', JSON.stringify(users));

        // 2) Add to blacklist/tombstone (case-insensitive dedupe)
        let revoked = readAdminUsersArray('revokedUsers');
        if (!revoked.some(r => getUserIdentityToken(r) === targetNorm)) {
            revoked.push(target);
        }
        localStorage.setItem('revokedUsers', JSON.stringify(revoked));

        // 3) Remove from all rosters so auto-generation cannot recreate
        const rosters = readAdminUsersObject('rosters');
        Object.keys(rosters).forEach(gid => {
            if (!Array.isArray(rosters[gid])) return;
            rosters[gid] = rosters[gid].filter(m => getUserIdentityToken(m) !== targetNorm);
        });
        localStorage.setItem('rosters', JSON.stringify(rosters));

        // 4) Purge common user-linked local data to prevent resurrection side-effects
        const purgeArray = (key, fields) => {
            let arr = readAdminUsersArray(key);
            if (!Array.isArray(arr)) return;
            arr = arr.filter(item => {
                return !fields.some(field => getUserIdentityToken((item && item[field]) || '') === targetNorm);
            });
            localStorage.setItem(key, JSON.stringify(arr));
        };
        purgeArray('records', ['trainee', 'user', 'user_id']);
        purgeArray('submissions', ['trainee', 'user', 'user_id']);
        purgeArray('attendance_records', ['user', 'user_id']);
        purgeArray('liveBookings', ['trainee', 'user', 'user_id']);
        purgeArray('savedReports', ['trainee', 'user', 'user_id']);
        purgeArray('insightReviews', ['trainee', 'user', 'user_id']);
        purgeArray('exemptions', ['trainee', 'user', 'user_id']);
        purgeArray('linkRequests', ['trainee', 'user', 'user_id']);
        purgeArray('tl_task_submissions', ['trainee', 'user', 'user_id']);
        purgeArray('retrain_archives', ['user']);

        const purgeObjectKey = (key) => {
            const obj = readAdminUsersObject(key);
            if (!obj || typeof obj !== 'object') return;
            Object.keys(obj).forEach(k => {
                if (getUserIdentityToken(k) === targetNorm) delete obj[k];
            });
            localStorage.setItem(key, JSON.stringify(obj));
        };
        purgeObjectKey('agentNotes');
        purgeObjectKey('monitor_data');
        purgeObjectKey('cancellationCounts');
        purgeObjectKey('trainee_notes');
        purgeObjectKey('trainee_bookmarks');
        
        // 5) Authoritative sync
        if(typeof saveToServer === 'function') {
            await saveToServer([
                'users', 'revokedUsers', 'rosters', 'records', 'submissions',
                'attendance_records', 'liveBookings', 'savedReports', 'insightReviews',
                'exemptions', 'linkRequests', 'tl_task_submissions',
                'agentNotes', 'monitor_data', 'cancellationCounts', 'retrain_archives',
                'trainee_notes', 'trainee_bookmarks'
            ], true);
        }

        if(typeof logAuditAction === 'function') logAuditAction(CURRENT_USER.user, 'Delete User', `Deleted user ${username}`);
        loadAdminUsers(); 
        populateTraineeDropdown(); 
    } 
}

function openUserEdit(username) {
    const users = readAdminUsersArray('users');
    const targetNorm = getUserIdentityToken(username);
    // FIX: Find index by username
    const index = users.findIndex(u => getUserIdentityToken(u && (u.user || u.username)) === targetNorm);
    if(index === -1) return;

    editTargetIndex = index;
    editTargetUsername = users[index].user;
    const u = users[index];

    const isSuper = CURRENT_USER.role === 'super_admin';
    const canManage = CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin';
    const safeUser = u.user.replace(/'/g, "\\'");
    const safeAttr = (value) => String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const email = (u.traineeData && u.traineeData.email) ? u.traineeData.email : '';
    const phone = (u.traineeData && u.traineeData.phone) ? u.traineeData.phone : '';
    const ssoEmail = u.ssoEmail || u.ssoLoginEmail || (u.traineeData && u.traineeData.ssoEmail) || '';
    const ssoProviderId = u.ssoProviderId || u.ssoObjectId || u.ssoLoginId || (u.traineeData && (u.traineeData.ssoProviderId || u.traineeData.ssoObjectId)) || '';
    const status = isUserBlockedAccount(u) ? 'blocked' : 'active';
    const groups = getUserGroupLabels(u.user, readAdminUsersObject('rosters'));
    const groupDisplay = groups.length > 0 ? groups.join(', ') : 'No Group';
    const lastModified = u.lastModified ? new Date(u.lastModified).toLocaleString() : 'Unknown';
    const modifiedBy = u.modifiedBy || 'Unknown';

    const bindingInfo = u.boundClientId 
        ? `<div style="margin-bottom:10px; font-size:0.8rem; color:var(--text-muted);">Bound to Client: <code>${u.boundClientId}</code> <button class="btn-danger btn-sm" onclick="unbindUserClient('${safeUser}')" style="padding:0 5px; margin-left:5px;">Unbind</button></div>` 
        : `<div style="margin-bottom:10px; font-size:0.8rem; color:var(--text-muted);">No Client Binding (Will bind on next login)</div>`;

    document.getElementById('adminEditTitle').innerHTML = `Advanced Edit: ${u.user} <button class="btn-secondary btn-sm" onclick="renameUser('${u.user.replace(/'/g, "\\'")}')" style="font-size:0.7rem; margin-left:10px; padding:2px 8px;">Rename</button>`;
    
    document.getElementById('adminEditContent').innerHTML = `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <div>
                <label>Email Address</label>
                <input type="text" id="editUserEmail" value="${safeAttr(email)}" placeholder="name@example.com">
            </div>
            <div>
                <label>Phone Number</label>
                <input type="text" id="editUserPhone" value="${safeAttr(phone)}" placeholder="082...">
            </div>
            <div>
                <label>Password Reset</label>
                <input type="text" id="editUserPass" placeholder="Enter new password to change..." autocomplete="off">
            </div>
            <div>
                <label>Role</label>
                <select id="editUserRole">
                    <option value="trainee">Trainee</option>
                    <option value="teamleader">Team Leader</option>
                    <option value="admin">Admin</option>
                    <option value="special_viewer">Special Viewer</option>
                    ${isSuper ? '<option value="super_admin">Super Admin</option>' : ''}
                </select>
            </div>
            <div>
                <label>Account Status</label>
                <select id="editUserStatus">
                    <option value="active">Active</option>
                    <option value="blocked">Blocked</option>
                </select>
            </div>
            <div>
                <label>Primary Group(s)</label>
                <input type="text" value="${safeAttr(groupDisplay)}" disabled>
            </div>
            <div>
                <label>Microsoft SSO Email</label>
                <input type="text" id="editUserSsoEmail" value="${safeAttr(ssoEmail)}" placeholder="exact.microsoft.account@example.com">
            </div>
            <div>
                <label>Microsoft SSO ID</label>
                <input type="text" id="editUserSsoProviderId" value="${safeAttr(ssoProviderId)}" placeholder="optional provider/object id">
            </div>
        </div>
        <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
            ${canManage && !userIdentityMatches(u.user, CURRENT_USER.user) && !userIdentityMatches(u.user, 'admin')
                ? `<button class="${status === 'blocked' ? 'btn-success' : 'btn-warning'} btn-sm" onclick="document.getElementById('editUserStatus').value='${status === 'blocked' ? 'active' : 'blocked'}'">${status === 'blocked' ? 'Mark As Active' : 'Mark As Blocked'}</button>`
                : ''
            }
            <button class="btn-secondary btn-sm" onclick="generatePassword('editUserPass')">Generate Password</button>
        </div>
        <div style="margin-top:10px; font-size:0.8rem; color:var(--text-muted); border-top:1px solid var(--border-color); padding-top:8px;">
            Last Modified: <strong>${safeAttr(lastModified)}</strong> by <strong>${safeAttr(modifiedBy)}</strong>
        </div>
        ${bindingInfo}`;
    
    if (CURRENT_USER.role !== 'admin' && CURRENT_USER.role !== 'super_admin') {
        const roleSelect = document.getElementById('editUserRole');
        if(roleSelect) roleSelect.disabled = true;
    } else {
        const roleSelect = document.getElementById('editUserRole');
        if(roleSelect) roleSelect.disabled = false;
    }

    document.getElementById('editUserRole').value = u.role;
    const editStatus = document.getElementById('editUserStatus');
    if (editStatus) editStatus.value = status;
    document.getElementById('adminEditModal').classList.remove('hidden');
    document.getElementById('adminEditSaveBtn').onclick = saveUserEdit;
}

window.unbindUserClient = async function(username) {
    if(!confirm("Remove Client ID binding? This allows the user to login from a new machine.")) return;
    const users = readAdminUsersArray('users');
    const targetNorm = getUserIdentityToken(username);
    const index = users.findIndex(u => getUserIdentityToken(u && (u.user || u.username)) === targetNorm);
    if (index === -1) return;
    delete users[index].boundClientId;
    localStorage.setItem('users', JSON.stringify(users));
    await secureUserSave();
    
    // Refresh Modal
    document.getElementById('adminEditModal').classList.add('hidden');
    openUserEdit(users[index].user);
};

window.renameUser = async function(oldName) {
    const newName = await customPrompt("Rename User", `Enter new username for ${oldName}:`, oldName);
    if (!newName || newName === oldName) return;
    
    // Check if exists
    const users = readAdminUsersArray('users');
    if (findUserByIdentityIndex(users, newName) > -1) return alert("Username already exists.");
    
    if (!confirm(`Rename '${oldName}' to '${newName}'?\n\nThis will update all records, attendance, and reports associated with this user.`)) return;
    
    // Perform Migration
    // 1. Users
    const oldToken = getUserIdentityToken(oldName);
    const uIdx = users.findIndex(u => getUserIdentityToken(u && (u.user || u.username)) === oldToken);
    if (uIdx > -1) users[uIdx].user = newName;
    localStorage.setItem('users', JSON.stringify(users));
    
    // 2. Rosters
    const rosters = readAdminUsersObject('rosters');
    Object.keys(rosters).forEach(gid => {
        const idx = Array.isArray(rosters[gid])
            ? rosters[gid].findIndex(member => getUserIdentityToken(member) === oldToken)
            : -1;
        if (idx > -1) rosters[gid][idx] = newName;
        if (Array.isArray(rosters[gid])) {
            const seen = new Set();
            rosters[gid] = rosters[gid].filter(member => {
                const key = getUserIdentityToken(member);
                if (!key || seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }
    });
    localStorage.setItem('rosters', JSON.stringify(rosters));
    
    // 3. Records, Submissions, Attendance, etc.
    const migrate = (key, field) => {
        const data = readAdminUsersArray(key);
        let changed = false;
        data.forEach(item => {
            if (getUserIdentityToken(item && item[field]) === oldToken) {
                item[field] = newName;
                changed = true;
            }
        });
        if (changed) localStorage.setItem(key, JSON.stringify(data));
    };
    
    migrate('records', 'trainee');
    migrate('submissions', 'trainee');
    migrate('attendance_records', 'user');
    migrate('liveBookings', 'trainee');
    migrate('savedReports', 'trainee');
    migrate('insightReviews', 'trainee');
    migrate('exemptions', 'trainee');
    migrate('linkRequests', 'trainee');
    migrate('tl_task_submissions', 'user');
    migrate('retrain_archives', 'user');
    
    // Object keys (Agent Notes, Monitor Data)
    const migrateObj = (key) => {
        const data = readAdminUsersObject(key);
        let changed = false;
        Object.keys(data).forEach(existingKey => {
            if (getUserIdentityToken(existingKey) === oldToken && existingKey !== newName) {
                data[newName] = data[existingKey];
                delete data[existingKey];
                changed = true;
            }
        });
        if (changed) localStorage.setItem(key, JSON.stringify(data));
    };
    migrateObj('agentNotes');
    migrateObj('monitor_data');
    migrateObj('cancellationCounts');
    
    // Sync
    if (typeof saveToServer === 'function') {
        await saveToServer(['users', 'rosters', 'records', 'submissions', 'attendance_records', 'liveBookings', 'savedReports', 'insightReviews', 'exemptions', 'linkRequests', 'agentNotes', 'monitor_data', 'cancellationCounts', 'tl_task_submissions', 'retrain_archives'], true);
    }
    
    alert("User renamed successfully.");
    document.getElementById('adminEditModal').classList.add('hidden');
    loadAdminUsers();
};

async function saveUserEdit() {
    const users = readAdminUsersArray('users');
    const targetNorm = getUserIdentityToken(editTargetUsername);
    const liveIndex = users.findIndex(u => getUserIdentityToken(u && (u.user || u.username)) === targetNorm);
    if (liveIndex === -1) {
        alert("User no longer exists. The list will refresh.");
        document.getElementById('adminEditModal').classList.add('hidden');
        loadAdminUsers();
        return;
    }

    editTargetIndex = liveIndex;
    const newPass = document.getElementById('editUserPass').value;
    
    if(newPass && newPass.trim() !== "") {
        if (typeof hashPassword === 'function') {
            users[liveIndex].pass = await hashPassword(newPass);
        } else {
            users[liveIndex].pass = newPass;
        }
    }
    
    if(CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'super_admin') {
        const newRole = document.getElementById('editUserRole').value;
        const newStatus = String(document.getElementById('editUserStatus')?.value || 'active').toLowerCase().trim();
        
        // SECURITY: Prevent Privilege Escalation
        if (newRole === 'super_admin' && CURRENT_USER.role !== 'super_admin') {
            alert("Security Alert: Only existing Super Admins can promote users to Super Admin.");
            return;
        }
        if (newStatus === 'blocked' && userIdentityMatches(users[liveIndex].user, CURRENT_USER.user)) {
            alert("You cannot block your own account.");
            return;
        }
        if (newStatus === 'blocked' && userIdentityMatches(users[liveIndex].user, 'admin')) {
            alert("The default admin account cannot be blocked.");
            return;
        }
        
        users[liveIndex].role = newRole;
        users[liveIndex].status = (newStatus === 'blocked') ? 'blocked' : 'active';
        users[liveIndex].blocked = users[liveIndex].status === 'blocked';
    }

    // Update Contact Info (traineeData)
    if (!users[liveIndex].traineeData) users[liveIndex].traineeData = {};
    
    const newEmail = document.getElementById('editUserEmail').value.trim();
    const newPhone = document.getElementById('editUserPhone').value.trim();
    const newSsoEmail = String(document.getElementById('editUserSsoEmail')?.value || '').trim().toLowerCase();
    const newSsoProviderId = String(document.getElementById('editUserSsoProviderId')?.value || '').trim();
    
    users[liveIndex].traineeData.email = newEmail;
    users[liveIndex].traineeData.phone = newPhone;
    users[liveIndex].traineeData.contact = `${newEmail} | ${newPhone}`; // Legacy support
    users[liveIndex].ssoEmail = newSsoEmail;
    users[liveIndex].ssoProviderId = newSsoProviderId;
    users[liveIndex].traineeData.ssoEmail = newSsoEmail;
    users[liveIndex].traineeData.ssoProviderId = newSsoProviderId;
    users[liveIndex].lastModified = new Date().toISOString();
    users[liveIndex].modifiedBy = CURRENT_USER.user;

    localStorage.setItem('users', JSON.stringify(users));

    // FIX: Update current session if editing self
    if (CURRENT_USER && userIdentityMatches(users[liveIndex].user, CURRENT_USER.user)) {
        CURRENT_USER = { ...CURRENT_USER, ...users[liveIndex] };
        sessionStorage.setItem('currentUser', JSON.stringify(CURRENT_USER));
    }
    
    await secureUserSave();
    
    editTargetUsername = users[liveIndex].user;
    document.getElementById('adminEditModal').classList.add('hidden');
    loadAdminUsers();
}

// --- GRADUATED AGENTS MANAGEMENT ---

function loadGraduatedAgents() {
    const container = document.getElementById('graduateList');
    if (!container) return;

    const graduates = readAdminUsersArray('graduated_agents').filter(g => !isRetrainArchiveEntry(g));
    const search = document.getElementById('graduateSearch') ? document.getElementById('graduateSearch').value.toLowerCase() : '';

    const filtered = graduates.filter(g => g.user.toLowerCase().includes(search));
    
    // Sort by graduation date desc
    filtered.sort((a,b) => new Date(b.graduatedDate) - new Date(a.graduatedDate));

    if (filtered.length === 0) {
        container.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No archived agents found.</td></tr>';
        return;
    }

    container.innerHTML = filtered.map(g => {
        const dateStr = new Date(g.graduatedDate).toLocaleDateString();
        // Try to find group from archived records
        let group = "Unknown";
        if (g.records && g.records.length > 0) group = g.records[0].groupID || "Unknown";
        
        const safeUser = g.user.replace(/'/g, "\\'");

        return `
            <tr>
                <td><strong>${g.user}</strong></td>
                <td>${dateStr}</td>
                <td>${group}</td>
                <td>
                    <button class="btn-warning btn-sm" onclick="restoreAgent('${safeUser}')"><i class="fas fa-undo"></i> Restore</button>
                </td>
            </tr>
        `;
    }).join('');
}

async function restoreAgent(username) {
    if(!confirm(`Restore ${username} to active duty?\n\nThis will move their data back to the active database and re-enable login access.`)) return;

    const graduates = readAdminUsersArray('graduated_agents');
    const targetToken = getUserIdentityToken(username);
    const idx = graduates.findIndex(g => getUserIdentityToken(g && g.user) === targetToken);
    
    if (idx === -1) return alert("Agent not found in archive.");
    
    const agentData = graduates[idx];
    
    // 1. Restore Data
    const restore = (key, data) => {
        if (!data || data.length === 0) return;
        const current = readAdminUsersArray(key);
        // Merge avoiding duplicates (simple ID check if available, else push)
        data.forEach(item => {
            if (item.id) {
                if (!current.some(c => c.id === item.id)) current.push(item);
            } else {
                current.push(item);
            }
        });
        localStorage.setItem(key, JSON.stringify(current));
    };

    restore('records', agentData.records);
    restore('submissions', agentData.submissions);
    restore('attendance_records', agentData.attendance);
    restore('savedReports', agentData.reports);
    restore('insightReviews', agentData.reviews);
    
    if (agentData.notes) {
        const notes = readAdminUsersObject('agentNotes');
        notes[username] = agentData.notes;
        localStorage.setItem('agentNotes', JSON.stringify(notes));
    }

    // 2. Restore User Account (Re-create)
    let users = readAdminUsersArray('users');
    if (findUserByIdentityIndex(users, username) === -1) {
        // Generate temp pin
        const pin = Math.floor(1000 + Math.random() * 9000).toString();
        users.push({ user: username, pass: pin, role: 'trainee', lastModified: new Date().toISOString(), modifiedBy: CURRENT_USER.user });
        localStorage.setItem('users', JSON.stringify(users));
        alert(`User restored. Temporary PIN: ${pin}`);
    }

    // 3. Remove from Blacklist
    let revoked = readAdminUsersArray('revokedUsers');
    const restoreToken = getUserIdentityToken(username);
    revoked = revoked.filter(u => getUserIdentityToken(u) !== restoreToken);
    localStorage.setItem('revokedUsers', JSON.stringify(revoked));

    // 4. Remove from Archive
    graduates.splice(idx, 1);
    localStorage.setItem('graduated_agents', JSON.stringify(graduates));

    // 5. Sync
    if(typeof saveToServer === 'function') {
        await saveToServer([
            'records', 'submissions', 'attendance_records', 'savedReports', 
            'insightReviews', 'agentNotes', 'users', 'revokedUsers', 'graduated_agents'
        ], true);
    }

    if(typeof logAuditAction === 'function') logAuditAction(CURRENT_USER.user, 'Restore Agent', `Restored ${username} from archive`);
    loadGraduatedAgents();
    if(typeof refreshAllDropdowns === 'function') refreshAllDropdowns();
    if(typeof showToast === 'function') showToast("Agent restored successfully.", "success");
}

// --- NEW: GRADUATE TRAINEE FUNCTION ---
async function graduateTrainee(username) {
    if(!confirm(`Graduate ${username}?\n\nThis will ARCHIVE all their data and remove their login access.\n\nThey will be moved to the 'Graduated Agents' archive.`)) return;

    const btn = document.activeElement;
    if(btn && btn.tagName === 'BUTTON') {
        btn.innerText = "Graduating...";
        btn.disabled = true;
    }

    try {
        const targetToken = getUserIdentityToken(username);
        const existingAttempts = readAdminUsersArray('graduated_agents')
            .filter(entry => getUserIdentityToken(entry && entry.user) === targetToken).length;
        const attemptNumber = existingAttempts + 1;
        // 1. ARCHIVE DATA (Snapshot)
        const archiveData = {
            user: username,
            graduatedDate: new Date().toISOString(),
            attemptNumber,
            attemptLabel: `Attempt ${attemptNumber}`,
            reason: 'Graduated',
            records: readAdminUsersArray('records').filter(r => getUserIdentityToken(r && r.trainee) === targetToken),
            submissions: readAdminUsersArray('submissions').filter(s => getUserIdentityToken(s && s.trainee) === targetToken),
            attendance: readAdminUsersArray('attendance_records').filter(r => getUserIdentityToken(r && r.user) === targetToken),
            reports: readAdminUsersArray('savedReports').filter(r => getUserIdentityToken(r && r.trainee) === targetToken),
            reviews: readAdminUsersArray('insightReviews').filter(r => getUserIdentityToken(r && r.trainee) === targetToken),
            exemptions: readAdminUsersArray('exemptions').filter(r => getUserIdentityToken(r && r.trainee) === targetToken),
            liveBookings: readAdminUsersArray('liveBookings').filter(r => getUserIdentityToken(r && r.trainee) === targetToken),
            linkRequests: readAdminUsersArray('linkRequests').filter(r => getUserIdentityToken(r && r.trainee) === targetToken),
            monitorHistory: readAdminUsersArray('monitor_history').filter(r => getUserIdentityToken(r && (r.user || r.user_id)) === targetToken),
            tlTaskSubmissions: readAdminUsersArray('tl_task_submissions').filter(r => getUserIdentityToken(r && (r.user || r.trainee)) === targetToken),
            notes: (() => {
                const allNotes = readAdminUsersObject('agentNotes');
                const key = Object.keys(allNotes).find(k => getUserIdentityToken(k) === targetToken);
                return key ? allNotes[key] : null;
            })(),
            progressConfigSnapshot: readProgressConfigSnapshot()
        };
        if (window.ProgressCatalog && typeof window.ProgressCatalog.getTraineeProgress === 'function') {
            const archiveGroup = archiveData.records && archiveData.records[0] ? archiveData.records[0].groupID : '';
            archiveData.officialProgress = window.ProgressCatalog.getTraineeProgress(username, archiveGroup, {
                includeAuto: true,
                data: {
                    records: archiveData.records,
                    submissions: archiveData.submissions,
                    savedReports: archiveData.reports,
                    insightReviews: archiveData.reviews,
                    liveBookings: archiveData.liveBookings,
                    exemptions: archiveData.exemptions
                }
            });
        }

        let archives = readAdminUsersArray('graduated_agents');
        archives.push(archiveData);
        localStorage.setItem('graduated_agents', JSON.stringify(archives));

        // 2. WIPE ACTIVE DATA
        const wipe = (key, field) => {
            let data = readAdminUsersArray(key);
            const newData = data.filter(item => {
                const val = item[field];
                return !val || getUserIdentityToken(val) !== targetToken;
            });
            if (data.length !== newData.length) localStorage.setItem(key, JSON.stringify(newData));
        };
        
        wipe('records', 'trainee');
        wipe('submissions', 'trainee');
        wipe('attendance_records', 'user');
        wipe('savedReports', 'trainee');
        wipe('insightReviews', 'trainee');
        wipe('liveBookings', 'trainee');
        wipe('linkRequests', 'trainee');
        wipe('exemptions', 'trainee');
        wipe('monitor_history', 'user');
        wipe('tl_task_submissions', 'user');
        
        let notes = readAdminUsersObject('agentNotes');
        Object.keys(notes).forEach(noteKey => {
            if (getUserIdentityToken(noteKey) === targetToken) delete notes[noteKey];
        });
        localStorage.setItem('agentNotes', JSON.stringify(notes));

        let monitor = readAdminUsersObject('monitor_data');
        Object.keys(monitor).forEach(monKey => {
            if (getUserIdentityToken(monKey) === targetToken) delete monitor[monKey];
        });
        localStorage.setItem('monitor_data', JSON.stringify(monitor));

        // 3. REMOVE USER & ROSTER
        let users = readAdminUsersArray('users');
        users = users.filter(u => getUserIdentityToken(u && (u.user || u.username)) !== targetToken);
        localStorage.setItem('users', JSON.stringify(users));

        const rosters = readAdminUsersObject('rosters');
        for (const gid in rosters) {
            rosters[gid] = rosters[gid].filter(m => getUserIdentityToken(m) !== targetToken);
        }
        localStorage.setItem('rosters', JSON.stringify(rosters));

        // 4. BLACKLIST (Prevent regeneration)
        let revoked = readAdminUsersArray('revokedUsers');
        if(!revoked.some(entry => getUserIdentityToken(entry) === targetToken)) {
            revoked.push(username);
            localStorage.setItem('revokedUsers', JSON.stringify(revoked));
        }

        // 5. SYNC
        if(typeof saveToServer === 'function') {
            await saveToServer([
                'rosters', 'graduated_agents', 'records', 'submissions', 
                'attendance_records', 'savedReports', 'insightReviews', 
                'agentNotes', 'users', 'revokedUsers', 'liveBookings', 
                'linkRequests', 'exemptions', 'monitor_data', 'monitor_history', 'tl_task_submissions'
            ], true);
        }

        if(typeof logAuditAction === 'function') logAuditAction(CURRENT_USER.user, 'Graduate Agent', `Graduated ${username}`);
        alert(`${username} has been graduated and archived.`);
        
        // Refresh UI if on Insight page
        if(typeof InsightStudioLoader !== 'undefined' && typeof InsightStudioLoader.refresh === 'function') InsightStudioLoader.refresh();

    } catch(e) {
        console.error("Graduation Error:", e);
        alert("Error graduating user: " + e.message);
    } finally {
        if(btn && btn.tagName === 'BUTTON') {
            btn.innerText = "Graduate Trainee"; 
            btn.disabled = false;
        }
    }
}

// --- EMAIL AUTOMATION ---
function generateOnboardingEmail(emails) {
    if (!emails || emails.length === 0) return;

    const toAddress = "systemsupport@herotel.com";
    const ccAddresses = "darren.tupper@herotel.com,jaco.prince@herotel.com,soanette.wilken@herotel.com";
    const subject = "Access Request for New Onboards";
    
    const body = `Good day.

Hope this finds you well.

Kindly assist with acess to the followings programs (the error the onbaords are getting is either there email address is not found or incorrect username & password :

Q-Contact
Corteza (CRM Instance present)
ACS
Radius

Please find the onbaords whom require access below : 
${emails.join('\n')}

Kind regards.`;

    const mailtoLink = `mailto:${toAddress}?cc=${ccAddresses}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoLink;
}

function clearAppCache() {
    if(!confirm("Clear local session cache? This can fix login loops or display issues.\n\n(Your data will not be deleted)")) return;
    sessionStorage.clear();
    localStorage.removeItem('rememberedUser');
    window.location.reload();
}
