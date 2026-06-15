const DataModule = require('../js/data.js');

describe('Data Sync Module', () => {
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
        global.CURRENT_USER = null;
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

    test('performSmartMerge keeps Assessment Studio server deletes during pull', () => {
        const server = {
            assessment_studio_data: {
                updatedAt: '2026-06-10T10:00:00.000Z',
                questionBucket: [{ id: 'q1', text: 'Server question', updatedAt: '2026-06-10T10:00:00.000Z' }],
                generators: [],
                submissions: [{ id: 's1', trainee: 'Alice', status: 'completed', percent: 80, updatedAt: '2026-06-10T10:00:00.000Z' }],
                groupings: [],
                tags: []
            }
        };
        const local = {
            assessment_studio_data: {
                updatedAt: '2026-06-10T09:00:00.000Z',
                questionBucket: [
                    { id: 'q1', text: 'Old local question', updatedAt: '2026-06-10T09:00:00.000Z' },
                    { id: 'q_deleted', text: 'Deleted question', updatedAt: '2026-06-10T09:00:00.000Z' }
                ],
                generators: [{ id: 'g_deleted', assessment: 'Deleted generator', updatedAt: '2026-06-10T09:00:00.000Z' }],
                submissions: [
                    { id: 's1', trainee: 'Alice', status: 'pending_review', percent: 0, updatedAt: '2026-06-10T09:00:00.000Z' },
                    { id: 's_deleted', trainee: 'Alice', status: 'pending_review', updatedAt: '2026-06-10T09:00:00.000Z' }
                ],
                groupings: [],
                tags: []
            }
        };

        const merged = DataModule.performSmartMerge(server, local, 'server_wins').assessment_studio_data;

        expect(merged.questionBucket.map(item => item.id)).toEqual(['q1']);
        expect(merged.questionBucket[0].text).toBe('Server question');
        expect(merged.generators).toEqual([]);
        expect(merged.submissions.map(item => item.id)).toEqual(['s1']);
        expect(merged.submissions[0].status).toBe('completed');
        expect(merged.submissions[0].percent).toBe(80);
    });

    test('performSmartMerge keeps newer current trainee Assessment Studio draft during pull', () => {
        global.CURRENT_USER = { user: 'Alice', role: 'trainee' };
        const server = {
            assessment_studio_data: {
                updatedAt: '2026-06-10T10:00:00.000Z',
                questionBucket: [],
                generators: [],
                submissions: [],
                groupings: [],
                tags: []
            }
        };
        const local = {
            assessment_studio_data: {
                updatedAt: '2026-06-10T10:01:00.000Z',
                questionBucket: [],
                generators: [],
                submissions: [
                    { id: 's_new', trainee: 'Alice', status: 'pending_review', updatedAt: '2026-06-10T10:01:00.000Z' },
                    { id: 's_other', trainee: 'Bob', status: 'pending_review', updatedAt: '2026-06-10T10:01:00.000Z' }
                ],
                groupings: [],
                tags: []
            }
        };

        const merged = DataModule.performSmartMerge(server, local, 'server_wins').assessment_studio_data;

        expect(merged.submissions.map(item => item.id)).toEqual(['s_new']);
    });

    test('performSmartMerge keeps completed Assessment Studio grading over stale pending locks', () => {
        const server = {
            assessment_studio_data: {
                updatedAt: '2026-06-12T10:00:00.000Z',
                questionBucket: [],
                generators: [],
                submissions: [{
                    id: 's_done',
                    trainee: 'Shane Jacobs',
                    status: 'completed',
                    percent: 82,
                    gradedAt: '2026-06-12T10:00:00.000Z',
                    gradedBy: 'Netta',
                    gradingLock: null,
                    updatedAt: '2026-06-12T10:00:00.000Z'
                }],
                groupings: [],
                tags: []
            }
        };
        const local = {
            assessment_studio_data: {
                updatedAt: '2026-06-12T10:05:00.000Z',
                questionBucket: [],
                generators: [],
                submissions: [{
                    id: 's_done',
                    trainee: 'Shane Jacobs',
                    status: 'pending_review',
                    percent: 0,
                    gradingLock: {
                        marker: 'Netta',
                        markerSession: 'Netta::old',
                        expiresAt: '2026-06-12T10:35:00.000Z'
                    },
                    updatedAt: '2026-06-12T10:05:00.000Z'
                }],
                groupings: [],
                tags: []
            }
        };

        const pulled = DataModule.performSmartMerge(server, local, 'server_wins').assessment_studio_data;
        const pushing = DataModule.performSmartMerge(server, local, 'local_wins').assessment_studio_data;

        expect(pulled.submissions[0].status).toBe('completed');
        expect(pulled.submissions[0].gradingLock).toBeNull();
        expect(pulled.submissions[0].percent).toBe(82);
        expect(pushing.submissions[0].status).toBe('completed');
        expect(pushing.submissions[0].gradingLock).toBeNull();
    });

    test('performSmartMerge keeps Q&A admin library server-authoritative during pull', () => {
        const server = {
            qa_data: {
                updatedAt: '2026-06-11T10:00:00.000Z',
                questions: [{ id: 'qa_live', question: 'Server FAQ', answer: 'Yes', updatedAt: '2026-06-11T10:00:00.000Z' }],
                submissions: [{ id: 'ask_1', question: 'Server ask', trainee: 'Alice', createdAt: '2026-06-11T09:00:00.000Z' }]
            }
        };
        const local = {
            qa_data: {
                updatedAt: '2026-06-11T09:00:00.000Z',
                questions: [
                    { id: 'qa_live', question: 'Old local FAQ', answer: 'Old', updatedAt: '2026-06-11T09:00:00.000Z' },
                    { id: 'qa_deleted', question: 'Deleted FAQ', answer: 'No', updatedAt: '2026-06-11T09:00:00.000Z' }
                ],
                submissions: [
                    { id: 'ask_1', question: 'Old ask', trainee: 'Alice', createdAt: '2026-06-11T08:00:00.000Z' },
                    { id: 'ask_new', question: 'Newer local ask', trainee: 'Bob', createdAt: '2026-06-11T10:01:00.000Z' }
                ]
            }
        };

        const merged = DataModule.performSmartMerge(server, local, 'server_wins').qa_data;

        expect(merged.questions.map(item => item.id)).toEqual(['qa_live']);
        expect(merged.questions[0].question).toBe('Server FAQ');
        expect(merged.submissions.map(item => item.id).sort()).toEqual(['ask_1', 'ask_new']);
    });

    test('performSmartMerge keeps Content Creator modules server-authoritative during pull', () => {
        const server = {
            content_studio_data: {
                updatedAt: '2026-06-11T10:00:00.000Z',
                entries: [{ id: 'entry_live', scheduleKey: 'module-live', scheduleLabel: 'Server Module', updatedAt: '2026-06-11T10:00:00.000Z' }],
                analytics: [{ id: 'entry_live:subject_1:Alice', entryId: 'entry_live', subjectId: 'subject_1', username: 'Alice', updatedAt: '2026-06-11T09:00:00.000Z' }],
                annotations: []
            }
        };
        const local = {
            content_studio_data: {
                updatedAt: '2026-06-11T09:00:00.000Z',
                entries: [
                    { id: 'entry_live', scheduleKey: 'module-live', scheduleLabel: 'Old Local Module', updatedAt: '2026-06-11T09:00:00.000Z' },
                    { id: 'entry_deleted', scheduleKey: 'module-deleted', scheduleLabel: 'Deleted Module', updatedAt: '2026-06-11T09:00:00.000Z' }
                ],
                analytics: [
                    { id: 'entry_live:subject_1:Alice', entryId: 'entry_live', subjectId: 'subject_1', username: 'Alice', updatedAt: '2026-06-11T09:30:00.000Z' },
                    { id: 'entry_live:subject_1:Bob', entryId: 'entry_live', subjectId: 'subject_1', username: 'Bob', updatedAt: '2026-06-11T10:01:00.000Z' }
                ],
                annotations: []
            }
        };

        const merged = DataModule.performSmartMerge(server, local, 'server_wins').content_studio_data;

        expect(merged.entries.map(item => item.scheduleKey)).toEqual(['module-live']);
        expect(merged.entries[0].scheduleLabel).toBe('Server Module');
        expect(merged.analytics.map(item => item.username).sort()).toEqual(['Alice', 'Bob']);
    });

    test('server-authority blob guard rejects malformed shared documents', () => {
        expect(DataModule.validateServerAuthorityBlob('schedules', { A: { assigned: 'G1' } })).toMatchObject({ ok: false });
        expect(DataModule.validateServerAuthorityBlob('qa_data', { questions: [] })).toMatchObject({ ok: false });
        expect(DataModule.validateServerAuthorityBlob('assessment_studio_data', {
            questionBucket: [],
            generators: [],
            submissions: [],
            groupings: []
        })).toMatchObject({ ok: false });
        expect(DataModule.validateServerAuthorityBlob('content_studio_data', {
            entries: [],
            analytics: [],
            annotations: []
        })).toMatchObject({ ok: true });
    });

    test('server-authority local writes keep backup and mirror embedded caches', () => {
        localStorage.setItem('content_studio_data', JSON.stringify({
            updatedAt: '2026-06-11T08:00:00.000Z',
            entries: [{ id: 'old', scheduleKey: 'old', scheduleLabel: 'Old' }],
            analytics: [],
            annotations: []
        }));

        const incoming = {
            updatedAt: '2026-06-11T09:00:00.000Z',
            entries: [{ id: 'new', scheduleKey: 'new', scheduleLabel: 'New' }],
            analytics: [],
            annotations: []
        };

        DataModule.writeServerAuthorityBlobToLocal('content_studio_data', incoming, 'test');

        expect(JSON.parse(localStorage.getItem('content_studio_data'))).toEqual(incoming);
        expect(JSON.parse(localStorage.getItem('content_studio_data_local'))).toEqual(incoming);
        const backup = JSON.parse(localStorage.getItem('server_authority_backup_content_studio_data'));
        expect(backup.source).toBe('test');
        expect(backup.previous.entries[0].scheduleKey).toBe('old');
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

    test('realtime queue diagnostics do not block the app with a full-screen overlay', () => {
        window.SYNC_DIAGNOSTICS = {
            status: 'idle',
            statusText: 'Idle',
            direction: 'idle',
            phase: 'Waiting',
            item: '-',
            server: '-',
            progressDone: 0,
            progressTotal: 0,
            bytesDone: 0,
            bytesTotal: 0,
            queuedIncoming: 0,
            queuedSaves: 0,
            pendingDeletes: 0,
            latencyMs: 0,
            startedAt: 0,
            updatedAt: Date.now(),
            lastSuccessAt: 0,
            lastError: ''
        };
        window.updateAppBusyOverlay = jest.fn();
        window.hideAppBusyOverlay = jest.fn();

        DataModule.updateSyncDiagnostics({
            status: 'processing_queue',
            statusText: 'Realtime queue waiting',
            phase: 'Queued incoming updates',
            item: '85 waiting',
            progressDone: 0,
            progressTotal: 85
        });

        expect(window.updateAppBusyOverlay).not.toHaveBeenCalled();
        expect(window.hideAppBusyOverlay).toHaveBeenCalled();
    });

    test('upload and download diagnostics can still update the app busy overlay', () => {
        window.SYNC_DIAGNOSTICS = {
            status: 'idle',
            statusText: 'Idle',
            direction: 'idle',
            phase: 'Waiting',
            item: '-',
            server: '-',
            progressDone: 0,
            progressTotal: 0,
            bytesDone: 0,
            bytesTotal: 0,
            queuedIncoming: 0,
            queuedSaves: 0,
            pendingDeletes: 0,
            latencyMs: 0,
            startedAt: 0,
            updatedAt: Date.now(),
            lastSuccessAt: 0,
            lastError: ''
        };
        window.updateAppBusyOverlay = jest.fn();
        window.hideAppBusyOverlay = jest.fn();

        DataModule.updateSyncDiagnostics({
            status: 'busy',
            statusText: 'Uploading changes',
            item: 'assessment_studio_data',
            progressDone: 0,
            progressTotal: 1
        });

        expect(window.updateAppBusyOverlay).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Uploading changes',
            detail: 'assessment_studio_data'
        }));
        expect(window.hideAppBusyOverlay).not.toHaveBeenCalled();
    });

    test('Assessment Studio and admin library documents are high-priority realtime payloads', () => {
        expect(DataModule.isHighPriorityIncomingPayload({
            type: 'app_documents',
            payload: { new: { key: 'assessment_studio_data' } }
        })).toBe(true);
        expect(DataModule.isHighPriorityIncomingPayload({
            type: 'app_documents',
            payload: { new: { key: 'content_studio_data' } }
        })).toBe(true);
        expect(DataModule.isHighPriorityIncomingPayload({
            type: 'app_documents',
            payload: { new: { key: 'qa_data' } }
        })).toBe(true);
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

    test('saveToServer does not mark row hashes synced when a row table upload is not confirmed', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => {});

        localStorage.setItem('monitor_history', JSON.stringify([
            { id: 'monitor_history_alice_2026-06-11', user: 'Alice', date: '2026-06-11', details: [] }
        ]));

        const upsertMock = jest.fn().mockResolvedValue({
            error: { code: 'PGRST205', message: 'does not exist' }
        });

        global.window.supabaseClient.from = jest.fn((table) => {
            if (table === 'monitor_history') {
                return { upsert: upsertMock };
            }
            return {
                select: jest.fn(() => ({
                    eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) }))
                })),
                upsert: jest.fn().mockResolvedValue({ error: null }),
                delete: jest.fn(() => ({ neq: jest.fn().mockResolvedValue({ error: null }) }))
            };
        });

        const result = await DataModule.saveToServer(['monitor_history'], true, true);

        expect(result).toBe(false);
        expect(upsertMock).toHaveBeenCalled();
        expect(localStorage.getItem('hash_map_monitor_history')).toBeNull();
    });

    test('saveToServer fails loudly for Assessment Studio explicit blob save errors', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});

        localStorage.setItem('assessment_studio_data', JSON.stringify({
            questionBucket: [],
            generators: [],
            submissions: [],
            groupings: [],
            tags: [],
            updatedAt: '2026-06-11T08:00:00.000Z'
        }));

        const blobUpsertMock = jest.fn(() => ({
            select: jest.fn().mockResolvedValue({
                data: null,
                error: { message: 'permission denied for table app_documents' }
            })
        }));

        global.window.supabaseClient.from = jest.fn(() => ({
            select: jest.fn(() => ({
                eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) }))
            })),
            upsert: blobUpsertMock,
            delete: jest.fn(() => ({ neq: jest.fn().mockResolvedValue({ error: null }) }))
        }));

        const result = await DataModule.saveToServer(['assessment_studio_data'], true, true);

        expect(result).toBe(false);
        expect(blobUpsertMock).toHaveBeenCalled();
    });

    test('saveToServer refuses invalid server-authority blob payloads before upload', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});

        localStorage.setItem('schedules', JSON.stringify({ A: { assigned: 'Group A' } }));

        const blobUpsertMock = jest.fn(() => ({
            select: jest.fn().mockResolvedValue({ data: [{ updated_at: '2026-06-11T09:00:00.000Z' }], error: null })
        }));

        global.window.supabaseClient.from = jest.fn(() => ({
            select: jest.fn(() => ({
                eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) }))
            })),
            upsert: blobUpsertMock,
            delete: jest.fn(() => ({ neq: jest.fn().mockResolvedValue({ error: null }) }))
        }));

        const result = await DataModule.saveToServer(['schedules'], true, true);

        expect(result).toBe(false);
        expect(blobUpsertMock).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'schedules' }));
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

    test('loadFromServer batches stale app document fetches for smoother startup', async () => {
        const mockContent = [
            { key: 'system_config', updated_at: '2026-06-15T08:00:00.000Z', content: { security: {} } },
            { key: 'revokedUsers', updated_at: '2026-06-15T08:00:00.000Z', content: [] },
            { key: 'accessControl', updated_at: '2026-06-15T08:00:00.000Z', content: { enabled: false, whitelist: [] } },
            { key: 'sso_login_config', updated_at: '2026-06-15T08:00:00.000Z', content: {} },
            { key: 'rosters', updated_at: '2026-06-15T08:00:00.000Z', content: {} },
            { key: 'schedules', updated_at: '2026-06-15T08:00:00.000Z', content: { G1: { items: [] } } },
            { key: 'qa_data', updated_at: '2026-06-15T08:00:00.000Z', content: { questions: [], submissions: [] } },
            {
                key: 'assessment_studio_data',
                updated_at: '2026-06-15T08:00:00.000Z',
                content: { questionBucket: [], generators: [], submissions: [], groupings: [], tags: [] }
            },
            {
                key: 'content_studio_data',
                updated_at: '2026-06-15T08:00:00.000Z',
                content: { entries: [], analytics: [], annotations: [] }
            }
        ];
        const mockMeta = mockContent.map(({ key, updated_at }) => ({ key, updated_at }));
        const batchRequests = [];

        const buildRowQuery = () => {
            const chain = {
                gt: jest.fn(() => chain),
                order: jest.fn(() => chain),
                eq: jest.fn(() => chain),
                ilike: jest.fn(() => chain),
                limit: jest.fn().mockResolvedValue({ data: [], error: null })
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
                    in: jest.fn((column, keys) => {
                        expect(column).toBe('key');
                        batchRequests.push(keys);
                        return Promise.resolve({
                            data: mockContent.filter(row => keys.includes(row.key)),
                            error: null
                        });
                    })
                };
            }

            throw new Error(`Unexpected app_documents select: ${columns}`);
        });

        global.window.supabaseClient.from = jest.fn((table) => {
            if (table === 'app_documents') return { select: appDocumentsSelect };
            return { select: jest.fn(() => buildRowQuery()) };
        });

        await DataModule.loadFromServer(true);

        expect(batchRequests.length).toBeGreaterThan(1);
        expect(batchRequests.every(keys => keys.length <= 4)).toBe(true);
        expect(batchRequests[0]).toEqual(['system_config', 'revokedUsers', 'accessControl', 'sso_login_config']);
        expect(JSON.parse(localStorage.getItem('qa_data') || '{}')).toEqual({ questions: [], submissions: [] });
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
