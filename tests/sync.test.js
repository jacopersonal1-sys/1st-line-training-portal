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
});
