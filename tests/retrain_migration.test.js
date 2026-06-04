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
        eval(`${adminUsers}\nwindow.__confirmMoveUser = confirmMoveUser;\nwindow.__setUserToMove = (value) => { userToMove = value; };`);
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

        expect(deleteCalls).toEqual(expect.arrayContaining([
            { table: 'records', column: 'id', ids: ['rec_1'] },
            { table: 'submissions', column: 'id', ids: ['sub_1'] },
            { table: 'attendance', column: 'id', ids: ['att_1'] },
            { table: 'live_bookings', column: 'id', ids: ['book_1'] },
            { table: 'live_sessions', column: 'id', ids: ['live_1'] },
            { table: 'saved_reports', column: 'id', ids: ['rep_1'] },
            { table: 'insight_reviews', column: 'id', ids: ['review_1'] }
        ]));

        expect(global.saveToServer).toHaveBeenCalledWith(['retrain_archives'], true, true);
        expect(global.saveToServer).toHaveBeenCalledWith(expect.arrayContaining(['rosters', 'retrain_archives', 'liveSessions', 'system_tombstones']), true);
    });
});
