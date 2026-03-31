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

    test('loadFromServer fetches updates when local is stale', async () => {
        // Mock Supabase response
        const mockMeta = [{ key: 'users', updated_at: '2026-01-02T00:00:00.000Z' }];
        const mockContent = [{ key: 'users', content: [{ user: 'admin' }], updated_at: '2026-01-02T00:00:00.000Z' }];

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

        await DataModule.loadFromServer(true);

        expect(fromMock).toHaveBeenCalledWith('app_documents');
        expect(localStorage.getItem('users')).toContain('admin');
        expect(localStorage.getItem('sync_ts_users')).toBe('2026-01-02T00:00:00.000Z');
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
});
