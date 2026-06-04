const fs = require('fs');
const path = require('path');

describe('Retrain migration clean slate', () => {
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
        global.CURRENT_USER = { user: 'manager', role: 'admin' };
        window.CURRENT_USER = global.CURRENT_USER;
        global.confirm = jest.fn(() => true);
        global.alert = jest.fn();
        global.loadFromServer = jest.fn(async () => true);
        global.saveToServer = jest.fn(async () => true);
        global.loadAdminUsers = jest.fn();
        global.refreshAllDropdowns = jest.fn();
        global.getGroupLabel = (gid) => gid;

        const elements = {
            moveUserTargetSelect: { value: 'group-b' },
            moveUserModal: { classList: { add: jest.fn(), remove: jest.fn() } }
        };

        global.document = {
            getElementById: jest.fn((id) => elements[id] || null),
            querySelector: jest.fn((selector) => {
                if (selector === '#moveUserModal .btn-warning') return { innerText: '', disabled: false };
                if (selector === '.admin-sub-nav') return { querySelectorAll: () => [] };
                return null;
            })
        };
        window.document = global.document;

        const progressCatalog = fs.readFileSync(path.resolve(__dirname, '../js/progress_catalog.js'), 'utf8');
        eval(progressCatalog);
        const adminUsers = fs.readFileSync(path.resolve(__dirname, '../js/admin_users.js'), 'utf8');
        eval(`${adminUsers}\nwindow.__confirmMoveUser = confirmMoveUser;\nwindow.__setUserToMove = (value) => { userToMove = value; };\nwindow.__repairRetrainRosterDuplicates = repairRetrainRosterDuplicates;\nwindow.__prepareRetrainArchivesForServerSave = prepareRetrainArchivesForServerSave;\nwindow.__getRetrainArchivePayloadBytes = getRetrainArchivePayloadBytes;`);
    });

    test('moving a trainee archives attempt 1 from Progress Builder and clears live rows including active live sessions', async () => {
        const deleteCalls = [];
        window.supabaseClient = {
            from: (table) => ({
                delete: () => ({
                    in: async (column, ids) => {
                        deleteCalls.push({ table, column, ids });
                        return { error: null };
                    }
                }),
                select: () => ({
                    limit: async () => ({ data: [], error: null })
                })
            })
        };

        localStorage.setItem('users', JSON.stringify([{ user: 'Alice', role: 'trainee' }]));
        localStorage.setItem('rosters', JSON.stringify({
            'group-a': ['Alice'],
            'group-b': []
        }));
        localStorage.setItem('insight_progress_config', JSON.stringify({
            requiredItems: [
                {
                    name: 'Fiber Basics',
                    type: 'test',
                    source: 'test-engine',
                    reportSections: { trainingGoal: true, assessmentScores: true }
                }
            ]
        }));
        localStorage.setItem('records', JSON.stringify([
            { id: 'rec_1', trainee: 'Alice', groupID: 'group-a', assessment: 'Fiber Basics', score: 82 }
        ]));
        localStorage.setItem('submissions', JSON.stringify([
            { id: 'sub_1', trainee: 'Alice', groupID: 'group-a', testTitle: 'Fiber Basics', status: 'completed', score: 82 }
        ]));
        localStorage.setItem('attendance_records', JSON.stringify([
            { id: 'att_1', user_id: 'Alice', date: '2026-06-01', clockIn: '08:00' }
        ]));
        localStorage.setItem('liveBookings', JSON.stringify([
            { id: 'book_1', trainee: 'Alice', assessment: 'Live Fiber', status: 'completed' }
        ]));
        localStorage.setItem('liveSessions', JSON.stringify([
            { sessionId: 'live_1', trainee: 'Alice', trainer: 'manager', active: true }
        ]));
        localStorage.setItem('savedReports', JSON.stringify([
            { id: 'rep_1', trainee: 'Alice', title: 'Onboard Report' }
        ]));
        localStorage.setItem('insightReviews', JSON.stringify([
            { id: 'review_1', user_id: 'Alice', status: 'done' }
        ]));
        localStorage.setItem('monitor_history', JSON.stringify([
            {
                id: 'mon_1',
                user_id: 'Alice',
                summary: 'Focused study activity',
                details: { screenshot: 'data:image/png;base64,' + 'a'.repeat(20000), windows: ['Teams'] }
            }
        ]));
        localStorage.setItem('tl_task_submissions', JSON.stringify([
            {
                id: 'tl_1',
                user_id: 'Alice',
                title: 'QA Check',
                payload: { evidenceImage: 'data:image/png;base64,' + 'b'.repeat(20000) }
            }
        ]));
        localStorage.setItem('schedules', JSON.stringify({
            oldTimeline: {
                assigned: 'group-a',
                items: [
                    { courseName: 'Old course', availabilityExceptionUsers: ['Alice', 'Bob'] }
                ]
            },
            newTimeline: {
                assigned: 'group-b',
                items: [
                    { courseName: 'New course', availabilityExceptionUsers: ['Charlie'] }
                ]
            }
        }));

        window.__setUserToMove('Alice');
        await window.__confirmMoveUser();

        const rosters = JSON.parse(localStorage.getItem('rosters'));
        expect(rosters['group-a']).toEqual([]);
        expect(rosters['group-b']).toEqual(['Alice']);

        expect(JSON.parse(localStorage.getItem('records'))).toEqual([]);
        expect(JSON.parse(localStorage.getItem('submissions'))).toEqual([]);
        expect(JSON.parse(localStorage.getItem('attendance_records'))).toEqual([]);
        expect(JSON.parse(localStorage.getItem('liveBookings'))).toEqual([]);
        expect(JSON.parse(localStorage.getItem('liveSessions'))).toEqual([]);
        expect(JSON.parse(localStorage.getItem('savedReports'))).toEqual([]);
        expect(JSON.parse(localStorage.getItem('insightReviews'))).toEqual([]);
        expect(JSON.parse(localStorage.getItem('monitor_history'))).toEqual([]);
        expect(JSON.parse(localStorage.getItem('tl_task_submissions'))).toEqual([]);
        expect(JSON.parse(localStorage.getItem('schedules'))).toEqual({
            oldTimeline: {
                assigned: 'group-a',
                items: [
                    { courseName: 'Old course', availabilityExceptionUsers: ['Bob'] }
                ]
            },
            newTimeline: {
                assigned: 'group-b',
                items: [
                    { courseName: 'New course', availabilityExceptionUsers: ['Charlie'] }
                ]
            }
        });

        const archives = JSON.parse(localStorage.getItem('retrain_archives'));
        expect(archives).toHaveLength(1);
        expect(archives[0]).toMatchObject({
            user: 'Alice',
            attemptNumber: 1,
            attemptLabel: 'Attempt 1',
            archiveType: 'retrain',
            fromGroup: 'group-a',
            targetGroup: 'group-b'
        });
        expect(archives[0].progressConfigSnapshot.requiredItems[0].name).toBe('Fiber Basics');
        expect(archives[0].officialProgress.items.some(item => item.name === 'Fiber Basics' && item.completed)).toBe(true);
        expect(archives[0].liveSessions).toHaveLength(1);
        expect(archives[0].monitorHistory).toEqual([
            expect.objectContaining({ id: 'mon_1', user_id: 'Alice', summary: 'Focused study activity' })
        ]);
        expect(archives[0].monitorHistory[0].details).toBeUndefined();
        expect(archives[0].tlTaskSubmissions).toEqual([
            expect.objectContaining({ id: 'tl_1', user_id: 'Alice', title: 'QA Check' })
        ]);
        expect(archives[0].tlTaskSubmissions[0].payload).toBeUndefined();
        expect(archives[0].archiveCompaction.heavyFieldsOmitted).toBe(true);

        expect(deleteCalls).toEqual(expect.arrayContaining([
            { table: 'records', column: 'id', ids: ['rec_1'] },
            { table: 'submissions', column: 'id', ids: ['sub_1'] },
            { table: 'attendance', column: 'id', ids: ['att_1'] },
            { table: 'live_bookings', column: 'id', ids: ['book_1'] },
            { table: 'live_sessions', column: 'id', ids: ['live_1'] },
            { table: 'saved_reports', column: 'id', ids: ['rep_1'] },
            { table: 'insight_reviews', column: 'id', ids: ['review_1'] },
            { table: 'monitor_history', column: 'id', ids: ['mon_1'] },
            { table: 'tl_task_submissions', column: 'id', ids: ['tl_1'] }
        ]));

        expect(global.saveToServer).toHaveBeenCalledWith(['retrain_archives'], true, true);
        expect(global.saveToServer).toHaveBeenCalledWith(expect.arrayContaining(['rosters', 'schedules', 'retrain_archives', 'liveSessions', 'system_tombstones']), true);
    });

    test('archive save failure stops before clearing or moving live data', async () => {
        global.saveToServer = jest.fn(async (keys) => {
            if (Array.isArray(keys) && keys.length === 1 && keys[0] === 'retrain_archives') return false;
            return true;
        });

        localStorage.setItem('users', JSON.stringify([{ user: 'Nomphelo Jack', role: 'trainee' }]));
        localStorage.setItem('rosters', JSON.stringify({
            'group-a': ['Nomphelo Jack'],
            'group-b': []
        }));
        localStorage.setItem('records', JSON.stringify([
            { id: 'rec_keep', trainee: 'Nomphelo Jack', groupID: 'group-a', assessment: 'Fiber Slow Speed' }
        ]));
        localStorage.setItem('submissions', JSON.stringify([
            { id: 'sub_keep', trainee: 'Nomphelo Jack', groupID: 'group-a', testTitle: 'Fiber Slow Speed' }
        ]));
        localStorage.setItem('liveSessions', JSON.stringify([
            { sessionId: 'live_keep', trainee: 'Nomphelo Jack', active: true }
        ]));

        window.__setUserToMove('Nomphelo Jack');
        await window.__confirmMoveUser();

        expect(JSON.parse(localStorage.getItem('records'))).toHaveLength(1);
        expect(JSON.parse(localStorage.getItem('submissions'))).toHaveLength(1);
        expect(JSON.parse(localStorage.getItem('liveSessions'))).toHaveLength(1);
        expect(JSON.parse(localStorage.getItem('rosters'))).toEqual({
            'group-a': ['Nomphelo Jack'],
            'group-b': []
        });
        expect(JSON.parse(localStorage.getItem('retrain_archives'))).toHaveLength(1);
        expect(global.alert).toHaveBeenCalledWith(expect.stringContaining('No live data was cleared'));
    });

    test('retrain roster repair removes duplicate old group only when target group is present', () => {
        const result = window.__repairRetrainRosterDuplicates({
            april: ['Alice', 'Bob', 'Cara'],
            june: ['Alice'],
            july: ['Dana']
        }, [
            { user: 'Alice', movedDate: '2026-06-01T10:00:00.000Z', targetGroup: 'june' },
            { user: 'Dana', movedDate: '2026-06-01T10:00:00.000Z', targetGroup: 'june' }
        ]);

        expect(result.changed).toBe(true);
        expect(result.rosters).toEqual({
            april: ['Bob', 'Cara'],
            june: ['Alice'],
            july: ['Dana']
        });
    });

    test('large retrain archives are compacted before server save', () => {
        const hugeText = 'x'.repeat(700000);
        const prepared = window.__prepareRetrainArchivesForServerSave([
            {
                id: 'old_archive',
                user: 'Hloni Masenkane',
                targetGroup: 'June 2026',
                records: [{ id: 'rec_hloni', trainee: 'Hloni Masenkane', assessment: 'Fiber', score: 90, questions: hugeText }],
                submissions: [{ id: 'sub_hloni', trainee: 'Hloni Masenkane', testTitle: 'Fiber', score: 90, testSnapshot: { questions: [hugeText] } }],
                reports: [{ id: 'rep_hloni', trainee: 'Hloni Masenkane', title: 'Onboard Report', html: hugeText }],
                monitorHistory: [{ id: 'mon_hloni', user_id: 'Hloni Masenkane', screenshot: hugeText }],
                officialProgress: { items: [{ name: 'Fiber', completed: true, score: 90 }] }
            },
            {
                id: 'new_archive',
                user: 'Courage Mahlaule',
                targetGroup: 'June 2026',
                records: [{ id: 'rec_courage', trainee: 'Courage Mahlaule', assessment: 'Fiber', score: 88, questions: hugeText }],
                submissions: [{ id: 'sub_courage', trainee: 'Courage Mahlaule', testTitle: 'Fiber', score: 88, testSnapshot: { questions: [hugeText] } }],
                reports: [{ id: 'rep_courage', trainee: 'Courage Mahlaule', title: 'Onboard Report', html: hugeText }],
                officialProgress: { items: [{ name: 'Fiber', completed: true, score: 88 }] }
            }
        ]);

        expect(window.__getRetrainArchivePayloadBytes(prepared)).toBeLessThan(900000);
        expect(prepared[0].records[0].id).toBe('rec_hloni');
        expect(prepared[0].submissions[0].id).toBe('sub_hloni');
        expect(prepared[0].reports[0].id).toBe('rep_hloni');
        expect(prepared[0].officialProgress.items[0].completed).toBe(true);
        expect(prepared[0].archiveCompaction.compactionLevel).toBeGreaterThanOrEqual(1);
        expect(prepared[0].records[0].questions).toBe('[omitted from retrain archive to keep migration safe]');
        expect(prepared[0].submissions[0].testSnapshot).toBe('[omitted from retrain archive to keep migration safe]');
        expect(prepared[0].reports[0].html).toBe('[omitted from retrain archive to keep migration safe]');
    });
});
