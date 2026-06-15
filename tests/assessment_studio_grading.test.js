const fs = require('fs');
const path = require('path');

describe('Assessment Studio grading auto scoring', () => {
    let App;
    let Data;

    beforeEach(() => {
        localStorage.clear();
        global.AppContext = { user: { user: 'Admin', role: 'admin' } };
        global.AssessmentStudioData = {
            esc(value) {
                return String(value === undefined || value === null ? '' : value)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#39;');
            },
            normalizeText(value) {
                return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
            },
            editor() {
                return 'Admin';
            },
            state: { studio: { submissions: [] } },
            saveStudio: jest.fn().mockResolvedValue({}),
            normalizeSubmission(submission) {
                return { ...(submission || {}) };
            },
            normalizeStudio(studio) {
                return {
                    questionBucket: [],
                    generators: [],
                    submissions: Array.isArray(studio && studio.submissions) ? studio.submissions : [],
                    groupings: [],
                    tags: [],
                    updatedAt: studio && studio.updatedAt || '2026-06-12T10:00:00.000Z',
                    updatedBy: studio && studio.updatedBy || 'Admin'
                };
            },
            mergeStudio(remote) {
                return this.normalizeStudio(remote);
            }
        };

        const src = fs.readFileSync(path.resolve(__dirname, '../modules/assessment_studio/js/main.js'), 'utf8');
        eval(`${src}\nglobal.__AssessmentStudioApp = App;`);
        App = global.__AssessmentStudioApp;
        const dataSrc = fs.readFileSync(path.resolve(__dirname, '../modules/assessment_studio/js/data.js'), 'utf8');
        eval(`${dataSrc}\nglobal.__AssessmentStudioDataModule = AssessmentStudioData;`);
        Data = global.__AssessmentStudioDataModule;
    });

    test('Assessment Studio data normalizer loads questions and completed submissions', () => {
        const studio = Data.normalizeStudio({
            questionBucket: [{
                id: 'q_bucket',
                assessment: 'Course 2',
                type: 'multiple_choice',
                text: 'Choose one.',
                points: 2,
                options: ['A', 'B'],
                correct: 0
            }],
            generators: [{
                id: 'gen_1',
                assessment: 'Course 2',
                totalPoints: 2,
                allowedTypes: ['multiple_choice']
            }],
            submissions: [{
                id: 's_done',
                trainee: 'Shane Jacobs',
                assessment: 'Course 2',
                status: 'pending_review',
                gradedAt: '2026-06-12T10:00:00.000Z',
                gradedBy: 'Netta',
                gradingLock: { marker: 'Netta' },
                testSnapshot: {
                    title: 'Course 2',
                    questions: [{
                        id: 'q_snap',
                        assessment: 'Course 2',
                        type: 'multiple_choice',
                        text: 'Choose one.',
                        points: 2,
                        options: ['A', 'B'],
                        correct: 0
                    }]
                }
            }],
            groupings: [],
            tags: []
        });

        expect(studio.questionBucket).toHaveLength(1);
        expect(studio.generators).toHaveLength(1);
        expect(studio.submissions).toHaveLength(1);
        expect(studio.submissions[0].status).toBe('completed');
        expect(studio.submissions[0].gradingLock).toBeNull();
        expect(studio.submissions[0].testSnapshot.questions).toHaveLength(1);
    });

    test('Assessment Studio keeps formatted question and suggested answer text', () => {
        const formattedQuestion = '\n\nReview the following:\n\n  - First bullet\n  - Second bullet\n\nThen answer below.\n';
        const formattedSuggested = 'Expected points:\n  1. Check details\n  2. Confirm outcome\n';
        const question = Data.normalizeQuestion({
            assessment: 'Course 2',
            type: 'text',
            text: formattedQuestion,
            suggestedAnswer: formattedSuggested,
            points: 2
        });

        expect(question.text).toBe('Review the following:\n\n  - First bullet\n  - Second bullet\n\nThen answer below.');
        expect(question.suggestedAnswer).toBe('Expected points:\n  1. Check details\n  2. Confirm outcome');
    });

    test('pending grading uses fresh auto scores for complex and choice questions', () => {
        const questions = [
            { type: 'multiple_choice', points: 2, options: ['A', 'B', 'C'], correct: 1 },
            { type: 'multi_select', points: 3, options: ['A', 'B', 'C'], correct: [0, 2] },
            { type: 'matching', points: 4, pairs: [{ left: 'ADS', right: 'Auth' }, { left: 'PPPoE', right: 'Public IP' }] },
            { type: 'matrix', points: 6, rows: ['On Queue', 'Paused', 'Training'], cols: ['Receives customer comms', 'Internal calls only'], matrixCorrect: { 0: 0, 1: 0, 2: 1 } }
        ];
        const sub = {
            status: 'pending_review',
            answers: {
                0: 1,
                1: [0, 2],
                2: { 0: 'Auth', 1: 'Public IP' },
                3: { 0: 0, 1: 0, 2: 1 }
            },
            questionScores: { 0: 0, 1: 0, 2: 0, 3: 0 }
        };

        expect(App.scoreAt(sub, questions[0], 0)).toBe(2);
        expect(App.scoreAt(sub, questions[1], 1)).toBe(3);
        expect(App.scoreAt(sub, questions[2], 2)).toBe(4);
        expect(App.scoreAt(sub, questions[3], 3)).toBe(6);
    });

    test('completed grading keeps admin corrected scores', () => {
        const question = { type: 'matrix', points: 6, rows: ['On Queue'], cols: ['Correct', 'Wrong'], matrixCorrect: { 0: 0 } };
        const sub = {
            status: 'completed',
            answers: { 0: { 0: 0 } },
            questionScores: { 0: 4.5 }
        };

        expect(App.autoScoreQuestion(question, sub.answers[0]).score).toBe(6);
        expect(App.scoreAt(sub, question, 0)).toBe(4.5);
    });

    test('multiple answer gives partial credit and deducts for extra selections', () => {
        const question = {
            type: 'multi_select',
            points: 5,
            options: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
            correct: [0, 1, 2, 3, 4]
        };

        expect(App.autoScoreQuestion(question, [0, 1, 2, 3, 4]).score).toBe(5);
        expect(App.autoScoreQuestion(question, [0, 1, 2, 3, 4, 5]).score).toBe(4);
        expect(App.autoScoreQuestion(question, [0, 1, 2, 5]).score).toBe(2);
    });

    test('ranking order gives credit for every correct position, including later positions', () => {
        const question = {
            type: 'ranking',
            points: 5,
            items: ['First', 'Second', 'Third', 'Fourth', 'Fifth']
        };

        expect(App.autoScoreQuestion(question, ['Second', 'First', 'Third', 'Fourth', 'Fifth']).score).toBe(3);
        expect(App.autoScoreQuestion(question, ['Wrong', 'Second', 'Wrong', 'Fourth', 'Fifth']).score).toBe(3);
    });

    test('question safety catches invalid scoring setup before generation or grading', () => {
        expect(App.questionSafetyErrors({
            assessment: 'Course 2',
            type: 'multi_select',
            text: 'Select correct answers.',
            points: 5,
            options: ['A', 'A', 'B'],
            correct: [0, 1]
        }).join(' ')).toContain('options must be unique');

        expect(App.questionSafetyErrors({
            assessment: 'Course 2',
            type: 'ranking',
            text: 'Order steps.',
            points: 5,
            items: ['Open', 'Open']
        }).join(' ')).toContain('Ranking items must be unique');

        expect(App.questionSafetyErrors({
            assessment: 'Course 2',
            type: 'matrix',
            text: 'Match rows.',
            points: 5,
            rows: ['Row 1'],
            cols: ['Col 1'],
            matrixCorrect: { 0: 3 }
        }).join(' ')).toContain('must match an available column');
    });

    test('grade score collection blocks duplicate or missing score inputs', () => {
        const questions = [{ points: 5 }, { points: 5 }];
        const good = [
            { dataset: { qidx: '0' }, value: '4', max: '5' },
            { dataset: { qidx: '1' }, value: '5', max: '5' }
        ];
        const duplicate = [
            { dataset: { qidx: '0' }, value: '4', max: '5' },
            { dataset: { qidx: '0' }, value: '5', max: '5' }
        ];
        const missing = [
            { dataset: { qidx: '1' }, value: '5', max: '5' },
            { dataset: { qidx: '2' }, value: '5', max: '5' }
        ];

        expect(App.collectGradeScores(good, questions)).toMatchObject({ ok: true, scores: { 0: 4, 1: 5 } });
        expect(App.collectGradeScores(duplicate, questions)).toMatchObject({ ok: false });
        expect(App.collectGradeScores(missing, questions)).toMatchObject({ ok: false });
    });

    test('completed submissions do not keep stale active grading locks', () => {
        const staleLockedCompleted = {
            status: 'completed',
            gradingLock: {
                marker: 'Other Admin',
                markerSession: 'other::session',
                expiresAt: new Date(Date.now() + 60000).toISOString()
            }
        };
        const activePending = {
            status: 'pending_review',
            gradingLock: {
                marker: 'Other Admin',
                markerSession: 'other::session',
                expiresAt: new Date(Date.now() + 60000).toISOString()
            }
        };

        expect(App.getActiveGradingLock(staleLockedCompleted)).toBeNull();
        expect(App.getActiveGradingLock(activePending)).toBe(activePending.gradingLock);
    });

    test('repairCompletedSubmissionLocks clears stale pending locks from graded submissions', async () => {
        global.AssessmentStudioData.state = {
            studio: {
                submissions: [{
                    id: 's_done',
                    trainee: 'Shane Jacobs',
                    assessment: 'Course 2',
                    status: 'pending_review',
                    gradedAt: '2026-06-12T10:00:00.000Z',
                    gradedBy: 'Netta',
                    gradingLock: {
                        marker: 'Netta',
                        markerSession: 'Netta::old',
                        expiresAt: new Date(Date.now() + 60000).toISOString()
                    }
                }]
            }
        };

        await App.repairCompletedSubmissionLocks();

        const repaired = global.AssessmentStudioData.state.studio.submissions[0];
        expect(repaired.status).toBe('completed');
        expect(repaired.gradingLock).toBeNull();
        expect(global.AssessmentStudioData.saveStudio).toHaveBeenCalled();
        expect(App.gradingLockBadge(repaired)).toContain('Available');
    });

    test('completed queue rows do not render stale grading lock badges', () => {
        const html = App.renderCompletedRow({
            id: 's_done',
            source: 'studio',
            trainee: 'Shane Jacobs',
            assessment: 'Course 2',
            groupID: '2026-06',
            status: 'completed',
            percent: 82,
            submittedAt: '2026-06-12T10:00:00.000Z',
            gradingLock: {
                marker: 'Netta',
                markerSession: 'Netta::old',
                expiresAt: new Date(Date.now() + 60000).toISOString()
            }
        }, { gradingAction: true });

        expect(html).not.toContain('Netta is grading');
        expect(html).not.toContain('ast-row-lock');
        expect(html).toContain('completed');
        expect(html).toContain('82%');
    });

    test('own abandoned grading locks are cleared while preserving the active target lock', async () => {
        App.markerSessionId = 'session_a';
        const ownSession = App.markerSessionKey();
        global.AssessmentStudioData.state = {
            studio: {
                submissions: [
                    {
                        id: 'keep',
                        trainee: 'Alice',
                        assessment: 'Course 2',
                        status: 'pending_review',
                        gradingLock: { marker: 'Admin', markerSession: ownSession, expiresAt: new Date(Date.now() + 60000).toISOString() }
                    },
                    {
                        id: 'clear',
                        trainee: 'Bob',
                        assessment: 'Course 2',
                        status: 'pending_review',
                        gradingLock: { marker: 'Admin', markerSession: ownSession, expiresAt: new Date(Date.now() + 60000).toISOString() }
                    },
                    {
                        id: 'other',
                        trainee: 'Charlie',
                        assessment: 'Course 2',
                        status: 'pending_review',
                        gradingLock: { marker: 'Other Admin', markerSession: 'Other::session', expiresAt: new Date(Date.now() + 60000).toISOString() }
                    }
                ]
            }
        };

        await App.repairOwnAbandonedGradingLocks({ keepId: 'keep' });

        const rows = global.AssessmentStudioData.state.studio.submissions;
        expect(rows.find(item => item.id === 'keep').gradingLock).toBeTruthy();
        expect(rows.find(item => item.id === 'clear').gradingLock).toBeNull();
        expect(rows.find(item => item.id === 'other').gradingLock).toBeTruthy();
        expect(global.AssessmentStudioData.saveStudio).toHaveBeenCalled();
    });

    test('failed grading lock claim rolls back local lock instead of showing a false owner badge', async () => {
        App.markerSessionId = 'session_fail';
        global.AssessmentStudioData.state = {
            studio: {
                submissions: [{
                    id: 's_lock_fail',
                    trainee: 'Alice',
                    assessment: 'Course 2',
                    status: 'pending_review',
                    gradingLock: null
                }]
            }
        };
        global.AssessmentStudioData.saveStudio = jest.fn().mockRejectedValue(new Error('network timeout'));

        const claimed = await App.claimSubmissionLock('s_lock_fail');

        expect(claimed).toBe(false);
        expect(global.AssessmentStudioData.state.studio.submissions[0].gradingLock).toBeNull();
    });

    test('completed queue rows show retry action when grade upload failed', () => {
        App.setGradingUploadStatus('s_done', { state: 'failed', message: 'Upload failed' });

        const html = App.renderCompletedRow({
            id: 's_done',
            source: 'studio',
            trainee: 'Shane Jacobs',
            assessment: 'Course 2',
            groupID: '2026-06',
            status: 'completed',
            percent: 82,
            submittedAt: '2026-06-12T10:00:00.000Z'
        }, { gradingAction: true });

        expect(html).toContain('Grade Upload Failed');
        expect(html).toContain('retryCompletedGradeUpload');
        expect(html).toContain('Re-upload Grade');
    });

    test('verifyCompletedGradeUploads flags completed local grades missing from Supabase', async () => {
        global.AssessmentStudioData.state = {
            studio: {
                submissions: [{
                    id: 's_missing',
                    trainee: 'Shane Jacobs',
                    assessment: 'Course 2',
                    status: 'completed',
                    gradedAt: '2026-06-12T10:00:00.000Z',
                    updatedAt: '2026-06-12T10:00:00.000Z'
                }]
            }
        };
        global.AppContext.supabase = {
            from: jest.fn(() => ({
                select: jest.fn(() => ({
                    eq: jest.fn(() => ({
                        maybeSingle: jest.fn(() => Promise.resolve({
                            data: { content: { submissions: [] }, updated_at: '2026-06-12T09:00:00.000Z' },
                            error: null
                        }))
                    }))
                }))
            }))
        };

        await App.verifyCompletedGradeUploads({ silent: true });

        expect(App.gradingUploadStatusMap().s_missing).toMatchObject({ state: 'missing' });
    });

    test('recoverCompletedGradeToServer uploads local completed grade and clears retry status', async () => {
        global.AssessmentStudioData.state = {
            studio: {
                submissions: [{
                    id: 's_retry',
                    trainee: 'Shane Jacobs',
                    assessment: 'Course 2',
                    status: 'completed',
                    percent: 82,
                    gradedAt: '2026-06-12T10:00:00.000Z',
                    updatedAt: '2026-06-12T10:00:00.000Z'
                }]
            }
        };
        const upsert = jest.fn(() => ({
            select: jest.fn(() => Promise.resolve({ data: [{ updated_at: '2026-06-12T10:02:00.000Z' }], error: null }))
        }));
        global.AppContext.supabase = {
            from: jest.fn(() => ({
                select: jest.fn(() => ({
                    eq: jest.fn(() => ({
                        maybeSingle: jest.fn(() => Promise.resolve({
                            data: { content: { submissions: [] }, updated_at: '2026-06-12T09:00:00.000Z' },
                            error: null
                        }))
                    }))
                })),
                upsert
            }))
        };
        App.setGradingUploadStatus('s_retry', { state: 'failed' });

        const ok = await App.recoverCompletedGradeToServer('s_retry', { silent: true });

        expect(ok).toBe(true);
        expect(upsert).toHaveBeenCalled();
        expect(App.gradingUploadStatusMap().s_retry).toBeUndefined();
    });

    test('matrix grading answer keeps column labels in headers only', () => {
        const question = {
            type: 'matrix',
            rows: ['Number of wrap-ups completed today'],
            cols: ['Wrap-up types', 'Queue wait time'],
            matrixCorrect: { 0: 1 }
        };

        const html = App.renderMatrixAnswer(question, { 0: 1 });
        expect(html.match(/Wrap-up types/g) || []).toHaveLength(1);
        expect(html.match(/Queue wait time/g) || []).toHaveLength(1);
        expect(html).toContain('ast-review-radio');
    });

    test('multiple choice grading answer shows all trainee options', () => {
        const question = { type: 'multiple_choice', options: ['Alpha', 'Bravo', 'Charlie'], correct: 2 };

        const html = App.renderAnswer(question, 1);

        expect(html).toContain('Alpha');
        expect(html).toContain('Bravo');
        expect(html).toContain('Charlie');
        expect(html).toContain('ast-review-choice-row incorrect');
        expect(html).toContain('ast-review-choice-row expected');
    });

    test('matrix grading answer marks selected wrong and correct cells', () => {
        const question = {
            type: 'matrix',
            rows: ['First row'],
            cols: ['Wrong option', 'Correct option'],
            matrixCorrect: { 0: 1 }
        };

        const html = App.renderMatrixAnswer(question, { 0: 0 });

        expect(html).toContain('ast-review-matrix-cell selected  incorrect');
        expect(html).toContain('ast-review-matrix-cell  correct');
        expect(html).toContain('fa-xmark');
        expect(html).toContain('fa-check');
    });

    test('ranking grading answer shows each position correctness', () => {
        const question = { type: 'ranking', items: ['Open profile', 'Search ticket', 'Add note'] };

        const html = App.renderAnswer(question, ['Open profile', 'Add note', 'Search ticket']);

        expect(html).toContain('ast-review-rank-row correct');
        expect(html).toContain('ast-review-rank-row incorrect');
        expect(html).toContain('Open profile');
        expect(html).toContain('Search ticket');
        expect(html).toContain('Add note');
    });
});
