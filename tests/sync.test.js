const DataModule = require('../js/data.js');

describe('Data Sync Module', () => {
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
    });

    test('performSmartMerge merges arrays without duplicates', () => {
        const server = { users: [{ user: 'A', role: 'admin' }] };
        const local = { users: [{ user: 'A', role: 'trainee' }, { user: 'B', role: 'trainee' }] };
        
        const merged = DataModule.performSmartMerge(server, local);
        
        expect(merged.users.length).toBe(2);
        // Local 'A' (trainee) should overwrite server 'A' (admin) based on logic "Prefer local version"
        const userA = merged.users.find(u => u.user === 'A');
        expect(userA.role).toBe('trainee');
    });

    test('performSmartMerge merges Assessment Studio bucket, generators, submissions and feedback independently', () => {
        const server = {
            assessment_studio_data: {
                questionBucket: [{ id: 'q1', text: 'Server question', updatedAt: '2026-06-01T00:00:00.000Z' }],
                generators: [{ id: 'g1', assessment: 'Server Gen', updatedAt: '2026-06-01T00:00:00.000Z' }],
                submissions: [{ id: 's1', trainee: 'Alice', status: 'pending_review', updatedAt: '2026-06-01T00:00:00.000Z' }],
                groupings: [{ id: 'grp1', name: 'Server Group', updatedAt: '2026-06-01T00:00:00.000Z' }],
                tags: []
            }
        };
        const local = {
            assessment_studio_data: {
                questionBucket: [
                    { id: 'q1', text: 'Local question', updatedAt: '2026-06-02T00:00:00.000Z' },
                    { id: 'q2', text: 'New local question', updatedAt: '2026-06-02T00:00:00.000Z' }
                ],
                generators: [{ id: 'g2', assessment: 'Local Gen', updatedAt: '2026-06-02T00:00:00.000Z' }],
                submissions: [
                    { id: 's1', trainee: 'Alice', status: 'completed', feedbackStatus: 'received', updatedAt: '2026-06-03T00:00:00.000Z' },
                    { id: 's2', trainee: 'Bob', status: 'pending_review', updatedAt: '2026-06-02T00:00:00.000Z' }
                ],
                groupings: [],
                tags: [{ id: 'tag1', name: 'Tag One', updatedAt: '2026-06-02T00:00:00.000Z' }]
            }
        };

        const merged = DataModule.performSmartMerge(server, local).assessment_studio_data;

        expect(merged.questionBucket.map(item => item.id).sort()).toEqual(['q1', 'q2']);
        expect(merged.questionBucket.find(item => item.id === 'q1').text).toBe('Local question');
        expect(merged.generators.map(item => item.id).sort()).toEqual(['g1', 'g2']);
        expect(merged.submissions.map(item => item.id).sort()).toEqual(['s1', 's2']);
        expect(merged.submissions.find(item => item.id === 's1').feedbackStatus).toBe('received');
        expect(merged.groupings.map(item => item.id)).toEqual(['grp1']);
        expect(merged.tags.map(item => item.id)).toEqual(['tag1']);
    });

    test('loadFromServer fetches stale blob keys and ignores row-synced blob keys', async () => {
        // Mock Supabase response
        const mockMeta = [
            { key: 'users', updated_at: '2026-01-02T00:00:00.000Z' },
            { key: 'assessments', updated_at: '2026-01-02T00:00:00.000Z' }
        ];
        const mockContent = [
            { key: 'assessments', content: [{ name: 'Course 1' }], updated_at: '2026-01-02T00:00:00.000Z' }
        ];

        const buildRowQuery = (rows = []) => {
            const chain = {
                gt: jest.fn(() => chain),
                order: jest.fn(() => chain),
                eq: jest.fn(() => chain),
                limit: jest.fn().mockResolvedValue({ data: rows, error: null })
            };
            return chain;
        };

        const appDocumentsSelect = jest.fn((columns) => {
            if (columns === 'key, updated_at') {
                return {
                    not: jest.fn().mockResolvedValue({ data: mockMeta, error: null }),
                    like: jest.fn().mockResolvedValue({ data: mockMeta, error: null })
                };
            }

            if (columns === 'key, content, updated_at') {
                return {
                    in: jest.fn().mockResolvedValue({ data: mockContent, error: null })
                };
            }

            throw new Error(`Unexpected app_documents select: ${columns}`);
        });

        const fromMock = jest.fn((table) => {
            if (table === 'app_documents') {
                return { select: appDocumentsSelect };
            }

            return {
                select: jest.fn(() => buildRowQuery())
            };
        });

        global.window.supabaseClient.from = fromMock;

        // Set local state to stale
        localStorage.setItem('sync_ts_users', '2025-01-01T00:00:00.000Z');
        localStorage.setItem('sync_ts_assessments', '2025-01-01T00:00:00.000Z');

        await DataModule.loadFromServer(true);

        expect(fromMock).toHaveBeenCalledWith('app_documents');
        expect(localStorage.getItem('assessments')).toContain('Course 1');
        expect(localStorage.getItem('sync_ts_assessments')).toBe('2026-01-02T00:00:00.000Z');
        expect(localStorage.getItem('users')).toBeNull();
        expect(localStorage.getItem('sync_ts_users')).toBe('2025-01-01T00:00:00.000Z');
    });

    test('performSmartMerge respects revokedUsers blacklist', () => {
        const server = { 
            users: [{ user: 'DeletedUser', role: 'trainee' }, { user: 'ActiveUser', role: 'trainee' }] 
        };
        const local = { 
            users: [{ user: 'ActiveUser', role: 'trainee' }],
            revokedUsers: ['DeletedUser'] 
        };
        
        const merged = DataModule.performSmartMerge(server, local);
        
        expect(merged.users.length).toBe(1);
        expect(merged.users[0].user).toBe('ActiveUser');
        expect(merged.revokedUsers).toContain('DeletedUser');
    });

    test('performSmartMerge merges same-day monitor history segments', () => {
        const morning = { start: 1761721200000, end: 1761724800000, activity: 'Study Tool: Notes' };
        const afternoon = { start: 1761746400000, end: 1761750000000, activity: 'Portal Navigation: dashboard' };
        const server = {
            monitor_history: [{
                id: 'random_server_id',
                user: 'Alice',
                date: '2025-10-29',
                details: [afternoon]
            }]
        };
        const local = {
            monitor_history: [{
                id: 'random_local_id',
                user: 'alice',
                date: '2025-10-29',
                details: [morning]
            }]
        };

        const merged = DataModule.performSmartMerge(server, local, 'server_wins');

        expect(merged.monitor_history).toHaveLength(1);
        expect(merged.monitor_history[0].id).toBe('monitor_history_alice_2025-10-29');
        expect(merged.monitor_history[0].details.map(s => s.activity)).toEqual([
            'Study Tool: Notes',
            'Portal Navigation: dashboard'
        ]);
    });

    test('monitor history pull repair detects duplicate archived day rows', () => {
        const merged = [{
            id: 'monitor_history_alice_2025-10-29',
            user: 'Alice',
            date: '2025-10-29',
            details: [
                { start: 1761721200000, end: 1761724800000, activity: 'Study Tool: Notes' },
                { start: 1761746400000, end: 1761750000000, activity: 'Portal Navigation: dashboard' }
            ]
        }];
        const source = [
            {
                id: 'old_morning_random',
                user: 'Alice',
                date: '2025-10-29',
                details: [{ start: 1761721200000, end: 1761724800000, activity: 'Study Tool: Notes' }]
            },
            {
                id: 'old_afternoon_random',
                user: 'alice',
                date: '2025-10-29',
                details: [{ start: 1761746400000, end: 1761750000000, activity: 'Portal Navigation: dashboard' }]
            }
        ];

        const repairs = DataModule.getMonitorHistoryRepairRows(merged, source);

        expect(repairs).toHaveLength(1);
        expect(repairs[0].id).toBe('monitor_history_alice_2025-10-29');
        expect(repairs[0].details).toHaveLength(2);
    });

    test('saveToServer fails loudly for critical explicit row save errors', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});

        localStorage.setItem('records', JSON.stringify([
            { id: 'rec_1', trainee: 'Alice', assessment: 'Assessment A', score: 80 }
        ]));

        const upsertMock = jest.fn().mockResolvedValue({
            error: { message: 'ON CONFLICT DO UPDATE command cannot affect row a second time' }
        });

        global.window.supabaseClient.from = jest.fn((table) => {
            if (table === 'records') {
                return { upsert: upsertMock };
            }
            return {
                select: jest.fn(() => ({
                    eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) })),
                    not: jest.fn().mockResolvedValue({ data: [], error: null }),
                    in: jest.fn().mockResolvedValue({ data: [], error: null })
                })),
                upsert: jest.fn().mockResolvedValue({ error: null }),
                delete: jest.fn(() => ({ neq: jest.fn().mockResolvedValue({ error: null }) }))
            };
        });

        const result = await DataModule.saveToServer(['records'], true, true);

        expect(result).toBe(false);
        expect(upsertMock).toHaveBeenCalled();
        expect(localStorage.getItem('hash_map_records')).toBeNull();
    });

    test('violation report sync strips inline screenshot payloads', () => {
        const reports = DataModule.sanitizeViolationReportsForSync([
            {
                id: 'vio_1',
                user: 'Alice',
                evidence: {
                    screenCount: 1,
                    screenshots: [{ data: 'base64-data', mime: 'image/jpeg' }],
                    files: [{ path: 'alice/vio_1/screen.jpg' }]
                }
            }
        ]);

        expect(reports[0].evidence.screenshots).toEqual([]);
        expect(reports[0].evidence.files).toEqual([{ path: 'alice/vio_1/screen.jpg' }]);
        expect(reports[0].evidence.traineeVisible).toBe(false);
        expect(reports[0].evidence.legacyScreenshotCount).toBe(1);
    });

    test('violation report sync respects deletion tombstones', () => {
        localStorage.setItem('system_tombstones', JSON.stringify(['violation_report:vio_deleted']));

        const reports = DataModule.sanitizeViolationReportsForSync([
            { id: 'vio_deleted', user: 'Alice', evidence: {} },
            { id: 'vio_active', user: 'Alice', evidence: {} }
        ]);

        expect(reports).toHaveLength(1);
        expect(reports[0].id).toBe('vio_active');
    });

    test('loadFromServer fetches tombstones with violation reports before merging', async () => {
        const mockMeta = [
            { key: 'violation_reports', updated_at: '2026-05-28T08:00:00.000Z' },
            { key: 'system_tombstones', updated_at: '2026-05-28T07:00:00.000Z' }
        ];
        const mockContent = [
            {
                key: 'violation_reports',
                updated_at: '2026-05-28T08:00:00.000Z',
                content: [
                    { id: 'vio_deleted', user: 'Alice', evidence: {} },
                    { id: 'vio_active', user: 'Alice', evidence: {} }
                ]
            },
            {
                key: 'system_tombstones',
                updated_at: '2026-05-28T07:00:00.000Z',
                content: ['violation_report:vio_deleted']
            }
        ];

        const buildRowQuery = (rows = []) => {
            const chain = {
                gt: jest.fn(() => chain),
                order: jest.fn(() => chain),
                eq: jest.fn(() => chain),
                ilike: jest.fn(() => chain),
                limit: jest.fn().mockResolvedValue({ data: rows, error: null })
            };
            return chain;
        };

        const appDocumentsSelect = jest.fn((columns) => {
            if (columns === 'key, updated_at') {
                return {
                    not: jest.fn().mockResolvedValue({ data: mockMeta, error: null }),
                    like: jest.fn().mockResolvedValue({ data: mockMeta, error: null })
                };
            }

            if (columns === 'key, content, updated_at') {
                return {
                    in: jest.fn().mockResolvedValue({ data: mockContent, error: null })
                };
            }

            throw new Error(`Unexpected app_documents select: ${columns}`);
        });

        global.window.supabaseClient.from = jest.fn((table) => {
            if (table === 'app_documents') {
                return { select: appDocumentsSelect };
            }

            return {
                select: jest.fn(() => buildRowQuery())
            };
        });

        localStorage.setItem('sync_ts_violation_reports', '2026-05-27T00:00:00.000Z');
        localStorage.setItem('sync_ts_system_tombstones', '2026-05-28T07:00:00.000Z');

        await DataModule.loadFromServer(true);

        const reports = JSON.parse(localStorage.getItem('violation_reports') || '[]');
        expect(reports).toHaveLength(1);
        expect(reports[0].id).toBe('vio_active');
        expect(JSON.parse(localStorage.getItem('system_tombstones') || '[]')).toEqual(['violation_report:vio_deleted']);
    });

    test('trainee violation report cache hides evidence pointers', () => {
        global.CURRENT_USER = { user: 'Alice', role: 'trainee' };

        const reports = DataModule.sanitizeViolationReportsForTrainee([
            {
                id: 'vio_1',
                user: 'Alice',
                evidence: {
                    screenCount: 1,
                    screenshots: [{ data: 'base64-data' }],
                    files: [{ path: 'alice/vio_1/screen.jpg' }]
                }
            },
            {
                id: 'vio_2',
                user: 'Bob',
                evidence: {
                    files: [{ path: 'bob/vio_2/screen.jpg' }]
                }
            }
        ]);

        expect(reports).toHaveLength(1);
        expect(reports[0].user).toBe('Alice');
        expect(reports[0].evidence.screenshots).toEqual([]);
        expect(reports[0].evidence.files).toEqual([]);
        expect(reports[0].evidence.hiddenFromTrainee).toBe(true);
    });
});
