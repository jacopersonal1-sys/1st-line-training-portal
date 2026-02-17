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

        // Setup mocks
        const selectMock = jest.fn();
        const fromMock = jest.fn(() => ({ select: selectMock }));
        
        global.window.supabaseClient.from = fromMock;
        
        // 1. Metadata fetch
        selectMock.mockReturnValueOnce({ data: mockMeta, error: null });
        
        // 2. Content fetch (chained .in())
        const inMock = jest.fn().mockResolvedValue({ data: mockContent, error: null });
        selectMock.mockReturnValueOnce({ in: inMock });

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

    test('performSmartMerge prevents duplicate liveSessions', () => {
        const sessionA = { sessionId: '123', active: true, currentQ: 1 };
        const sessionB = { sessionId: '123', active: true, currentQ: 2 }; // Newer state
        
        const server = { liveSessions: [sessionA] };
        const local = { liveSessions: [sessionB] };
        
        const merged = DataModule.performSmartMerge(server, local);
        
        expect(merged.liveSessions.length).toBe(1);
        expect(merged.liveSessions[0].currentQ).toBe(2); // Should prefer local (newer)
    });
});