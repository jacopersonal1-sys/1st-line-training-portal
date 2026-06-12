const fs = require('fs');
const path = require('path');

describe('Assessment Studio trainee runtime', () => {
    let runtimeRoot;

    function loadRuntime() {
        const src = fs.readFileSync(path.resolve(__dirname, '../js/assessment_studio_trainee.js'), 'utf8');
        eval(src);
    }

    function makeStore(submission) {
        return {
            questionBucket: [],
            generators: [],
            submissions: submission ? [submission] : [],
            groupings: [],
            tags: [],
            updatedAt: '2026-06-12T10:00:00.000Z',
            updatedBy: 'Admin'
        };
    }

    function makeSubmission(overrides = {}) {
        return {
            id: 'ast_1',
            trainee: 'Alice',
            assessment: 'Q Contact Assessment',
            phase: 'Assessment',
            status: 'assigned',
            maxPoints: 2,
            generatedAt: '2026-06-12T10:00:00.000Z',
            updatedAt: '2026-06-12T10:00:00.000Z',
            answers: {},
            testSnapshot: {
                title: 'Q Contact Assessment',
                questions: [
                    {
                        id: 'q1',
                        assessment: 'Q Contact Assessment',
                        type: 'multiple_choice',
                        text: 'Choose the correct Q Contact action.',
                        options: ['Open the contact', 'Close the contact'],
                        correct: 0,
                        points: 2
                    }
                ]
            },
            ...overrides
        };
    }

    beforeEach(() => {
        localStorage.clear();
        runtimeRoot = {
            innerHTML: '',
            contains: jest.fn(() => false)
        };
        global.window = {
            CURRENT_USER: { user: 'Alice', role: 'trainee' },
            LAST_INTERACTION: Date.now(),
            addEventListener: jest.fn(),
            supabaseClient: null
        };
        global.CURRENT_USER = global.window.CURRENT_USER;
        global.document = {
            getElementById: jest.fn((id) => id === 'assessmentStudioTraineeRuntime' ? runtimeRoot : null),
            querySelectorAll: jest.fn(() => []),
            addEventListener: jest.fn(),
            activeElement: null
        };
        global.showTab = jest.fn();
        global.showToast = jest.fn();
        global.loadTraineeTests = jest.fn();
        global.saveToServer = jest.fn(() => Promise.resolve(true));
        loadRuntime();
    });

    test('keeps an active assessment open when realtime refresh briefly omits the submission', () => {
        const submission = makeSubmission();
        const initialStore = makeStore(submission);
        localStorage.setItem('assessment_studio_data', JSON.stringify(initialStore));
        localStorage.setItem('assessment_studio_data_local', JSON.stringify(initialStore));

        window.openAssessmentStudioTraineeRuntime('ast_1');
        expect(runtimeRoot.innerHTML).toContain('Choose the correct Q Contact action.');
        expect(runtimeRoot.innerHTML).not.toContain('No Assessment Studio test is currently selected.');

        const emptyServerStore = makeStore(null);
        emptyServerStore.updatedAt = '2026-06-12T10:00:03.000Z';
        localStorage.setItem('assessment_studio_data', JSON.stringify(emptyServerStore));
        localStorage.setItem('assessment_studio_data_local', JSON.stringify(emptyServerStore));

        window.renderAssessmentStudioTraineeRuntime();

        expect(runtimeRoot.innerHTML).toContain('Choose the correct Q Contact action.');
        expect(runtimeRoot.innerHTML).not.toContain('No Assessment Studio test is currently selected.');
        const restored = JSON.parse(localStorage.getItem('assessment_studio_data_local'));
        expect(restored.submissions).toHaveLength(1);
        expect(restored.submissions[0].id).toBe('ast_1');
        expect(restored.submissions[0].status).toBe('in_progress');
    });

    test('does not reopen submitted assessments through the active runtime fallback', () => {
        const submission = {
            id: 'ast_submitted',
            trainee: 'Alice',
            assessment: 'Submitted Assessment',
            status: 'pending_review',
            updatedAt: '2026-06-12T10:00:00.000Z',
            testSnapshot: { questions: [{ type: 'text', text: 'Submitted question', points: 1 }] }
        };
        const store = makeStore(submission);
        localStorage.setItem('assessment_studio_data', JSON.stringify(store));
        localStorage.setItem('assessment_studio_data_local', JSON.stringify(store));

        window.openAssessmentStudioTraineeRuntime('ast_submitted');

        expect(showTab).toHaveBeenCalledWith('my-tests');
        expect(runtimeRoot.innerHTML).not.toContain('Submitted question');
    });

    test('does not rerender and steal focus while trainee is typing', () => {
        const submission = makeSubmission({
            status: 'in_progress',
            answers: { 0: 'A' },
            testSnapshot: {
                title: 'Q Contact Assessment',
                questions: [{ id: 'q1', assessment: 'Q Contact Assessment', type: 'text', text: 'Type answer', points: 1 }]
            }
        });
        const store = makeStore(submission);
        localStorage.setItem('assessment_studio_data', JSON.stringify(store));
        localStorage.setItem('assessment_studio_data_local', JSON.stringify(store));
        window.openAssessmentStudioTraineeRuntime('ast_1');
        const before = runtimeRoot.innerHTML;
        runtimeRoot.innerHTML = `${before}<span id="typing-marker">still typing</span>`;
        const activeTextarea = { tagName: 'TEXTAREA', isContentEditable: false };
        runtimeRoot.contains = jest.fn((node) => node === activeTextarea);
        document.activeElement = activeTextarea;

        window.renderAssessmentStudioTraineeRuntime();

        expect(runtimeRoot.innerHTML).toContain('typing-marker');
        expect(runtimeRoot.contains).toHaveBeenCalledWith(activeTextarea);
    });

    test('recovers local submitted Studio submissions missing from the server document', async () => {
        const localSubmission = makeSubmission({
            id: 'ast_sydney',
            trainee: 'Alice',
            status: 'pending_review',
            answers: { 0: 0 },
            submittedAt: '2026-06-12T12:00:00.000Z',
            updatedAt: '2026-06-12T12:00:00.000Z'
        });
        const localStore = makeStore(localSubmission);
        const remoteStore = makeStore(null);
        localStorage.setItem('assessment_studio_data_local', JSON.stringify(localStore));
        localStorage.setItem('assessment_studio_data', JSON.stringify(remoteStore));

        const maybeSingle = jest.fn().mockResolvedValue({
            data: { content: remoteStore, updated_at: '2026-06-12T11:00:00.000Z' },
            error: null
        });
        const selectRead = jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle })) }));
        let upsertPayload = null;
        const selectWrite = jest.fn().mockResolvedValue({ data: [{ updated_at: '2026-06-12T12:01:00.000Z' }], error: null });
        const upsert = jest.fn((payload) => {
            upsertPayload = payload;
            return { select: selectWrite };
        });
        window.supabaseClient = {
            from: jest.fn(() => ({
                select: selectRead,
                upsert
            }))
        };

        await window.recoverLocalAssessmentStudioSubmissionsToServer({ silent: false });

        expect(upsert).toHaveBeenCalled();
        expect(upsertPayload.content.submissions.map(item => item.id)).toContain('ast_sydney');
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Recovered 1 submitted'), 'success');
        const recoveredLocal = JSON.parse(localStorage.getItem('assessment_studio_data_local'));
        expect(recoveredLocal.submissions.map(item => item.id)).toContain('ast_sydney');
    });

    test('shows re-upload action when submitted Studio assessment is missing on Supabase', () => {
        const localSubmission = makeSubmission({
            id: 'ast_upload_failed',
            status: 'pending_review',
            submittedAt: '2026-06-12T12:00:00.000Z',
            updatedAt: '2026-06-12T12:00:00.000Z'
        });
        const localStore = makeStore(localSubmission);
        localStorage.setItem('assessment_studio_data', JSON.stringify(localStore));
        localStorage.setItem('assessment_studio_data_local', JSON.stringify(localStore));
        localStorage.setItem('assessment_studio_upload_status', JSON.stringify({
            ast_upload_failed: { state: 'missing', message: 'Submitted locally but not found on Supabase.' }
        }));

        const html = window.renderAssessmentStudioAssignmentsHtml();

        expect(html).toContain('Upload Failed');
        expect(html).toContain('retryAssessmentStudioSubmissionUpload');
        expect(html).toContain('Re-upload');
    });
});
