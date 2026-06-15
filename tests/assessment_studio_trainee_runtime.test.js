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

    test('renders formatted question text without flattening bullets or spacing', () => {
        const submission = makeSubmission({
            testSnapshot: {
                title: 'Q Contact Assessment',
                questions: [{
                    id: 'q_format',
                    assessment: 'Q Contact Assessment',
                    type: 'text',
                    text: '\nExplain the checks:\n\n  - Verify account\n  - Confirm contact\n',
                    points: 2
                }]
            }
        });
        const store = makeStore(submission);
        localStorage.setItem('assessment_studio_data', JSON.stringify(store));
        localStorage.setItem('assessment_studio_data_local', JSON.stringify(store));

        window.openAssessmentStudioTraineeRuntime('ast_1');

        expect(runtimeRoot.innerHTML).toContain('ast-trainee-question-text');
        expect(runtimeRoot.innerHTML).toContain('Explain the checks:\n\n  - Verify account\n  - Confirm contact');
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

    test('keeps local submitted snapshot when newer server data is missing it', async () => {
        const submitted = makeSubmission({
            id: 'ast_failed_upload',
            generatorId: 'gen_1',
            status: 'pending_review',
            submittedAt: '2026-06-12T12:00:00.000Z',
            updatedAt: '2026-06-12T12:00:00.000Z',
            answers: { 0: 0 },
            testSnapshot: {
                title: 'Original Snapshot',
                signature: 'original_snapshot',
                questions: [{
                    id: 'q_original',
                    assessment: 'Q Contact Assessment',
                    type: 'multiple_choice',
                    text: 'Original submitted question.',
                    options: ['A', 'B'],
                    correct: 0,
                    points: 2
                }]
            }
        });
        const localStore = makeStore(submitted);
        localStore.updatedAt = '2026-06-12T12:00:00.000Z';
        const remoteStore = {
            questionBucket: [{
                id: 'q_new',
                assessment: 'Q Contact Assessment',
                type: 'multiple_choice',
                text: 'New question that must not replace submitted work.',
                options: ['A', 'B'],
                correct: 1,
                points: 2,
                status: 'active'
            }],
            generators: [{
                id: 'gen_1',
                assessment: 'Q Contact Assessment',
                phase: 'Assessment',
                totalPoints: 2,
                pointLeeway: 0,
                allowedTypes: ['multiple_choice'],
                status: 'active'
            }],
            submissions: [],
            groupings: [],
            tags: [],
            updatedAt: '2026-06-12T12:05:00.000Z',
            updatedBy: 'Admin'
        };
        localStorage.setItem('assessment_studio_data_local', JSON.stringify(localStore));
        localStorage.setItem('assessment_studio_data', JSON.stringify(remoteStore));

        const opened = await window.openAssessmentStudioFromSchedule('gen_1', { courseName: 'Course 2' });

        expect(opened).toBe(false);
        expect(showToast).toHaveBeenCalledWith('This Assessment Studio test has already been submitted and cannot be reopened.', 'warning');
        const merged = JSON.parse(localStorage.getItem('assessment_studio_data_local'));
        const rows = merged.submissions.filter(item => String(item.generatorId) === 'gen_1');
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe('ast_failed_upload');
        expect(rows[0].testSnapshot.signature).toBe('original_snapshot');
    });

    test('prefers submitted assignment over duplicate newly generated assignment for the same generator', async () => {
        const submitted = makeSubmission({
            id: 'ast_original_submitted',
            generatorId: 'gen_1',
            status: 'pending_review',
            submittedAt: '2026-06-12T12:00:00.000Z',
            updatedAt: '2026-06-12T12:00:00.000Z',
            answers: { 0: 0 },
            testSnapshot: {
                title: 'Original Snapshot',
                signature: 'original_snapshot',
                questions: [{
                    id: 'q_original',
                    assessment: 'Q Contact Assessment',
                    type: 'multiple_choice',
                    text: 'Original submitted question.',
                    options: ['A', 'B'],
                    correct: 0,
                    points: 2
                }]
            }
        });
        const duplicateAssigned = makeSubmission({
            id: 'ast_duplicate_new',
            generatorId: 'gen_1',
            status: 'assigned',
            generatedAt: '2026-06-12T12:10:00.000Z',
            updatedAt: '2026-06-12T12:10:00.000Z',
            testSnapshot: {
                title: 'New Snapshot',
                signature: 'new_snapshot',
                questions: [{
                    id: 'q_new',
                    assessment: 'Q Contact Assessment',
                    type: 'multiple_choice',
                    text: 'New question trainee must not write.',
                    options: ['A', 'B'],
                    correct: 1,
                    points: 2
                }]
            }
        });
        const store = makeStore(null);
        store.submissions = [duplicateAssigned, submitted];
        localStorage.setItem('assessment_studio_data', JSON.stringify(store));
        localStorage.setItem('assessment_studio_data_local', JSON.stringify(store));

        const html = window.renderAssessmentStudioAssignmentsHtml();
        const opened = await window.openAssessmentStudioFromSchedule('gen_1', { courseName: 'Course 2' });

        expect(html).toContain('original_sna');
        expect(html).not.toContain('new_snapshot');
        expect(opened).toBe(false);
        expect(showToast).toHaveBeenCalledWith('This Assessment Studio test has already been submitted and cannot be reopened.', 'warning');
    });

    test('failed submit leaves submitted local snapshot with upload retry instead of reopening questions', async () => {
        const submission = makeSubmission({
            id: 'ast_submit_fails',
            status: 'in_progress',
            answers: { 0: 0 }
        });
        const store = makeStore(submission);
        localStorage.setItem('assessment_studio_data', JSON.stringify(store));
        localStorage.setItem('assessment_studio_data_local', JSON.stringify(store));
        global.saveToServer = jest.fn(() => Promise.resolve(false));
        window.supabaseClient = null;
        window.openAssessmentStudioTraineeRuntime('ast_submit_fails');

        await window.submitAssessmentStudioTest();

        const saved = JSON.parse(localStorage.getItem('assessment_studio_data_local'));
        const submitted = saved.submissions.find(item => item.id === 'ast_submit_fails');
        expect(submitted.status).toBe('pending_review');
        expect(submitted.answers['0']).toBe(0);
        expect(submitted.testSnapshot.questions[0].text).toBe('Choose the correct Q Contact action.');
        expect(JSON.parse(localStorage.getItem('assessment_studio_upload_status')).ast_submit_fails.state).toBe('failed');
        expect(showTab).toHaveBeenCalledWith('my-tests');
        expect(loadTraineeTests).toHaveBeenCalled();
    });

    test('submit stores partial auto scores for multiple answer and ranking questions', async () => {
        const submission = makeSubmission({
            id: 'ast_partial_scores',
            status: 'in_progress',
            answers: {
                0: [0, 1, 2, 3, 4, 5],
                1: ['Second', 'First', 'Third', 'Fourth', 'Fifth']
            },
            testSnapshot: {
                title: 'Partial Score Assessment',
                questions: [
                    {
                        id: 'q_multi',
                        assessment: 'Partial Score Assessment',
                        type: 'multi_select',
                        text: 'Select all correct answers.',
                        points: 5,
                        options: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
                        correct: [0, 1, 2, 3, 4]
                    },
                    {
                        id: 'q_rank',
                        assessment: 'Partial Score Assessment',
                        type: 'ranking',
                        text: 'Order the steps.',
                        points: 5,
                        items: ['First', 'Second', 'Third', 'Fourth', 'Fifth']
                    }
                ]
            }
        });
        const store = makeStore(submission);
        localStorage.setItem('assessment_studio_data', JSON.stringify(store));
        localStorage.setItem('assessment_studio_data_local', JSON.stringify(store));
        window.openAssessmentStudioTraineeRuntime('ast_partial_scores');

        await window.submitAssessmentStudioTest();

        const saved = JSON.parse(localStorage.getItem('assessment_studio_data_local'));
        const submitted = saved.submissions.find(item => item.id === 'ast_partial_scores');
        expect(submitted.status).toBe('pending_review');
        expect(submitted.questionScores['0']).toBe(4);
        expect(submitted.questionScores['1']).toBe(3);
        expect(submitted.earnedPoints).toBe(7);
    });

    test('submit blocks invalid complete-looking ranking answers before grading', async () => {
        const submission = makeSubmission({
            id: 'ast_bad_ranking',
            status: 'in_progress',
            answers: {
                0: ['First', 'Second', 'Second']
            },
            testSnapshot: {
                title: 'Ranking Guard Assessment',
                questions: [{
                    id: 'q_rank',
                    assessment: 'Ranking Guard Assessment',
                    type: 'ranking',
                    text: 'Order the steps.',
                    points: 3,
                    items: ['First', 'Second', 'Third']
                }]
            }
        });
        const store = makeStore(submission);
        localStorage.setItem('assessment_studio_data', JSON.stringify(store));
        localStorage.setItem('assessment_studio_data_local', JSON.stringify(store));
        window.openAssessmentStudioTraineeRuntime('ast_bad_ranking');

        await window.submitAssessmentStudioTest();

        const saved = JSON.parse(localStorage.getItem('assessment_studio_data_local'));
        const blocked = saved.submissions.find(item => item.id === 'ast_bad_ranking');
        expect(blocked.status).toBe('in_progress');
        expect(global.showToast).toHaveBeenCalledWith('Question 1 still needs an answer.', 'warning');
    });
});
