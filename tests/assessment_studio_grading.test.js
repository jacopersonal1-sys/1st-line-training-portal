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
            normalizeFormattedText(value) {
                return String(value || '').trim();
            },
            editor() {
                return 'Admin';
            },
            makeId(prefix) {
                return `${prefix}_test`;
            },
            state: { studio: { questionBucket: [], generators: [], submissions: [], groupings: [], tags: [] } },
            saveStudio: jest.fn().mockResolvedValue({}),
            normalizeQuestion(question) {
                return { ...(question || {}) };
            },
            normalizeSubmission(submission) {
                return {
                    ...(submission || {}),
                    questionComments: submission && submission.questionComments && typeof submission.questionComments === 'object'
                        ? submission.questionComments
                        : {}
                };
            },
            normalizeStudio(studio) {
                return {
                    questionBucket: Array.isArray(studio && studio.questionBucket) ? studio.questionBucket : [],
                    generators: Array.isArray(studio && studio.generators) ? studio.generators : [],
                    submissions: Array.isArray(studio && studio.submissions) ? studio.submissions : [],
                    groupings: Array.isArray(studio && studio.groupings) ? studio.groupings : [],
                    tags: Array.isArray(studio && studio.tags) ? studio.tags : [],
                    updatedAt: studio && studio.updatedAt || '2026-06-12T10:00:00.000Z',
                    updatedBy: studio && studio.updatedBy || 'Admin'
                };
            },
            mergeStudio(remote) {
                return this.normalizeStudio(remote);
            },
            mergeStudioItems(remoteItems, localItems) {
                const map = new Map();
                (Array.isArray(remoteItems) ? remoteItems : []).forEach(item => map.set(String(item.id || item.name), item));
                (Array.isArray(localItems) ? localItems : []).forEach(item => map.set(String(item.id || item.name), item));
                return Array.from(map.values());
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

    test('Assessment Studio merge keeps local bucket and generator data when remote only has submissions', () => {
        const remote = {
            updatedAt: '2026-06-22T10:00:00.000Z',
            questionBucket: [],
            generators: [],
            submissions: [{ id: 's1', trainee: 'Alice', assessment: 'Course 1', status: 'completed', updatedAt: '2026-06-22T10:00:00.000Z' }],
            groupings: [],
            tags: []
        };
        const local = {
            updatedAt: '2026-06-21T10:00:00.000Z',
            questionBucket: [{ id: 'q1', assessment: 'Course 1', type: 'text', text: 'Saved answer', suggestedAnswer: 'Expected', updatedAt: '2026-06-20T10:00:00.000Z' }],
            generators: [{ id: 'g1', assessment: 'Course 1', updatedAt: '2026-06-20T10:00:00.000Z' }],
            submissions: [],
            groupings: [],
            tags: []
        };

        const studio = Data.mergeStudio(remote, local);

        expect(studio.questionBucket.map(item => item.id)).toEqual(['q1']);
        expect(studio.questionBucket[0].suggestedAnswer).toBe('Expected');
        expect(studio.generators.map(item => item.id)).toEqual(['g1']);
        expect(studio.submissions.map(item => item.id)).toEqual(['s1']);
    });

    test('saveStudio preserves recovered server authoring when local cache only has submissions', async () => {
        const remote = {
            updatedAt: '2026-06-22T14:00:00.000Z',
            questionBucket: [{ id: 'q_recovered', assessment: 'Course 1', type: 'text', text: 'Recovered question' }],
            generators: [{ id: 'g_recovered', assessment: 'Course 1', totalPoints: 10 }],
            submissions: [{ id: 's_remote', trainee: 'Alice', assessment: 'Course 1', status: 'completed', updatedAt: '2026-06-22T13:00:00.000Z' }],
            groupings: [],
            tags: []
        };
        let savedPayload = null;
        global.AppContext.supabase = {
            from: jest.fn(() => ({
                select: jest.fn(() => ({
                    eq: jest.fn(() => ({
                        maybeSingle: jest.fn().mockResolvedValue({
                            data: { content: remote },
                            error: null
                        })
                    }))
                })),
                upsert: jest.fn(payload => {
                    savedPayload = payload;
                    return {
                        select: jest.fn().mockResolvedValue({
                            data: [{ updated_at: '2026-06-22T14:10:00.000Z' }],
                            error: null
                        })
                    };
                })
            }))
        };
        Data.state.studio = {
            updatedAt: '2026-06-22T14:07:00.000Z',
            questionBucket: [],
            generators: [],
            submissions: [{ id: 's_local', trainee: 'Bob', assessment: 'Course 1', status: 'pending_review', updatedAt: '2026-06-22T14:07:00.000Z' }],
            groupings: [],
            tags: []
        };

        const saved = await Data.saveStudio();

        expect(saved.questionBucket.map(item => item.id)).toEqual(['q_recovered']);
        expect(saved.generators.map(item => item.id)).toEqual(['g_recovered']);
        expect(saved.submissions.map(item => item.id).sort()).toEqual(['s_local', 's_remote']);
        expect(savedPayload.content.questionBucket).toHaveLength(1);
        expect(savedPayload.content.generators).toHaveLength(1);
    });

    test('Question Bucket save commits locally before Supabase confirmation', async () => {
        let resolveSave;
        AssessmentStudioData.saveStudio = jest.fn(() => new Promise(resolve => {
            resolveSave = resolve;
        }));
        AssessmentStudioData.state.studio = { questionBucket: [], generators: [], submissions: [], groupings: [], tags: [] };
        App.toast = jest.fn();
        App.resetQuestionModalForNext = jest.fn();
        const saveButton = { disabled: false, innerHTML: '<i class="fas fa-save"></i> Save Question' };
        const bucketRows = { innerHTML: '' };
        const statsRows = { innerHTML: '' };
        const elements = {
            bucketRows,
            bucketStatsRows: statsRows,
            questionForm: { querySelector: jest.fn(() => saveButton) },
            questionId: { value: '' },
            questionAssessment: { value: 'Course 1' },
            questionType: { value: 'text' },
            questionPoints: { value: '2' },
            questionGrouping: { value: 'Basics' },
            questionTag: { value: 'Safety' },
            questionText: { value: 'Explain safe ladder use.' },
            questionImageLink: { value: '' },
            questionSuggestedAnswer: { value: 'Three points of contact.' }
        };
        global.document = {
            getElementById: jest.fn(id => elements[id] || null),
            querySelectorAll: jest.fn(() => []),
            querySelector: jest.fn(() => null)
        };
        global.window.document = global.document;

        const saveTask = App.saveQuestion();
        await Promise.resolve();
        await Promise.resolve();

        expect(AssessmentStudioData.state.studio.questionBucket).toHaveLength(1);
        expect(AssessmentStudioData.state.studio.questionBucket[0]).toMatchObject({
            assessment: 'Course 1',
            text: 'Explain safe ladder use.',
            grouping: 'Basics',
            tags: ['Safety']
        });
        expect(AssessmentStudioData.state.studio.groupings.map(item => item.name)).toContain('Basics');
        expect(AssessmentStudioData.state.studio.tags.map(item => item.name)).toContain('Safety');
        expect(AssessmentStudioData.saveStudio).toHaveBeenCalledTimes(1);
        expect(App.toast).toHaveBeenCalledWith('Question saved locally. Syncing to Supabase...', 'ok');
        expect(bucketRows.innerHTML).toContain('Explain safe ladder use.');
        expect(statsRows.innerHTML).toContain('Course 1');

        resolveSave({});
        await saveTask;
    });

    test('Question Bucket row shows re-upload action when upload is missing', () => {
        App.setQuestionUploadStatus('q_missing', { state: 'missing' });

        const html = App.renderBucketRow({
            id: 'q_missing',
            assessment: 'Course 1',
            grouping: 'Basics',
            tags: ['Safety'],
            type: 'text',
            text: 'Explain safe ladder use.',
            points: 2
        });

        expect(html).toContain('Upload Failed');
        expect(html).toContain('retryQuestionUpload');
        expect(html).toContain('Re-upload Question');
    });

    test('recoverQuestionToServer uploads local bucket question and clears retry status', async () => {
        const localQuestion = {
            id: 'q_retry',
            assessment: 'Course 1',
            type: 'text',
            text: 'Explain safe ladder use.',
            points: 2,
            updatedAt: '2026-06-18T08:00:00.000Z'
        };
        AssessmentStudioData.state.studio = {
            questionBucket: [localQuestion],
            generators: [],
            submissions: [],
            groupings: [{ id: 'grp_1', name: 'Basics' }],
            tags: [{ id: 'tag_1', name: 'Safety' }]
        };
        App.render = jest.fn();
        App.toast = jest.fn();
        App.setQuestionUploadStatus('q_retry', { state: 'missing' });

        const upsertPayloads = [];
        AppContext.supabase = {
            from: jest.fn(() => ({
                select: jest.fn(() => ({
                    eq: jest.fn(() => ({
                        maybeSingle: jest.fn().mockResolvedValue({
                            data: {
                                content: { questionBucket: [], generators: [], submissions: [], groupings: [], tags: [] },
                                updated_at: '2026-06-18T07:00:00.000Z'
                            },
                            error: null
                        })
                    }))
                })),
                upsert: jest.fn(payload => {
                    upsertPayloads.push(payload);
                    return {
                        select: jest.fn().mockResolvedValue({
                            data: [{ updated_at: '2026-06-18T08:01:00.000Z' }],
                            error: null
                        })
                    };
                })
            }))
        };

        const ok = await App.recoverQuestionToServer('q_retry', { silent: true });

        expect(ok).toBe(true);
        expect(upsertPayloads[0].content.questionBucket.map(q => q.id)).toContain('q_retry');
        expect(App.questionUploadStatusMap().q_retry).toBeUndefined();
    });

    test('Assessment Studio feedback status defaults to none and normalizes received states', () => {
        expect(Data.normalizeSubmission({
            id: 's_default',
            trainee: 'Alice',
            assessment: 'Course 2'
        }).feedbackStatus).toBe('none');
        expect(Data.normalizeSubmission({
            id: 's_received',
            trainee: 'Alice',
            assessment: 'Course 2',
            feedbackStatus: 'Recieved'
        }).feedbackStatus).toBe('received');
        expect(Data.normalizeSubmission({
            id: 's_given',
            trainee: 'Alice',
            assessment: 'Course 2',
            feedbackStatus: 'given'
        }).feedbackStatus).toBe('received');
        expect(Data.normalizeSubmission({
            id: 's_invalid',
            trainee: 'Alice',
            assessment: 'Course 2',
            feedbackStatus: 'anything else'
        }).feedbackStatus).toBe('none');
    });

    test('Feedback Sessions actions update the actual Assessment Studio submission status', async () => {
        const submission = {
            id: 's_feedback',
            trainee: 'Alice',
            assessment: 'Course 2',
            status: 'completed',
            feedbackStatus: 'none'
        };
        AssessmentStudioData.state.studio.submissions = [submission];
        AssessmentStudioData.saveStudio.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});
        App.notifyFeedbackStatus = jest.fn();
        App.render = jest.fn();

        await App.setFeedback('s_feedback', 'requested');
        expect(submission.feedbackStatus).toBe('requested');
        expect(App.notifyFeedbackStatus).toHaveBeenLastCalledWith(submission);
        expect(JSON.parse(localStorage.getItem('assessment_studio_data')).submissions[0].feedbackStatus).toBe('requested');

        await App.setFeedback('s_feedback', 'received');
        expect(submission.feedbackStatus).toBe('received');

        await App.setFeedback('s_feedback', 'none');
        expect(submission.feedbackStatus).toBe('none');
        expect(App.render).toHaveBeenCalledTimes(3);
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

    test('Assessment Studio question pictures survive normalization and render in grading', () => {
        const imageLink = 'data:image/png;base64,abc123';
        const question = Data.normalizeQuestion({
            assessment: 'Course 2',
            type: 'multiple_choice',
            text: 'Use the picture below.',
            imageLink,
            points: 2,
            options: ['A', 'B'],
            correct: 0
        });

        expect(question.imageLink).toBe(imageLink);
        expect(App.renderGradeQuestion({ answers: { 0: 0 }, questionScores: {} }, question, 0)).toContain(`<img src="${imageLink}"`);
        expect(App.renderQuestionImage('javascript:alert(1)')).toBe('');
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

    test('Assessment Studio question comments survive normalization and render in grading', () => {
        const normalized = Data.normalizeSubmission({
            trainee: 'Alice',
            assessment: 'Course 2',
            status: 'completed',
            questionComments: { 0: 'Needs more detail.' },
            testSnapshot: {
                questions: [{
                    assessment: 'Course 2',
                    type: 'text',
                    text: 'Explain it.',
                    points: 5
                }]
            }
        });

        expect(normalized.questionComments).toEqual({ 0: 'Needs more detail.' });
        expect(App.renderGradeQuestion(normalized, normalized.testSnapshot.questions[0], 0)).toContain('Needs more detail.');
        expect(App.renderGradeQuestion(normalized, normalized.testSnapshot.questions[0], 0)).toContain('class="grade-comment"');
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
        expect(App.autoScoreQuestion(question, [0, 1, 2, 5]).score).toBe(3);
        expect(App.autoScoreQuestion({ ...question, points: 3, correct: [0, 1, 2] }, [0, 1, 5]).score).toBe(2);
    });

    test('Feedback Sessions keeps filters after changing feedback status', async () => {
        const submission = AssessmentStudioData.normalizeSubmission({
            id: 's_feedback_filter',
            trainee: 'Filter Trainee',
            assessment: 'Filter Assessment',
            groupID: '2026-06',
            status: 'completed',
            feedbackStatus: 'none'
        });
        AssessmentStudioData.state.studio.submissions = [submission];
        App.view = 'feedback';
        const root = { innerHTML: '' };
        const elements = {
            feedbackSearch: { value: 'Filter Trainee' },
            feedbackAssessmentFilter: { value: '' },
            feedbackGroupFilter: { value: '' },
            feedbackReviewStatusFilter: { value: '' },
            feedbackStatusFilter: { value: 'none' },
            feedbackDateFromFilter: { value: '' },
            feedbackDateToFilter: { value: '' }
        };
        const originalGetElementById = document.getElementById;
        const originalQuerySelectorAll = document.querySelectorAll;
        document.getElementById = jest.fn(id => id === 'assessment-studio-app' ? root : elements[id] || null);
        document.querySelectorAll = jest.fn(() => []);
        try {
            App.filterFeedback();
            await App.setFeedback('s_feedback_filter', 'received');
        } finally {
            document.getElementById = originalGetElementById;
            document.querySelectorAll = originalQuerySelectorAll;
        }

        expect(root.innerHTML).toContain('value="Filter Trainee"');
        expect(root.innerHTML).toContain('<option value="none" selected>None</option>');
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

    test('saveGrade stores per-question marker comments on the completed submission', async () => {
        const originalDocument = global.document;
        const sub = {
            id: 's_comment',
            trainee: 'Alice',
            assessment: 'Course 2',
            status: 'pending_review',
            answers: { 0: 0, 1: 'Short answer' },
            testSnapshot: {
                questions: [
                    {
                        id: 'q1',
                        assessment: 'Course 2',
                        type: 'multiple_choice',
                        text: 'Pick one',
                        points: 2,
                        options: ['A', 'B'],
                        correct: 0
                    },
                    {
                        id: 'q2',
                        assessment: 'Course 2',
                        type: 'text',
                        text: 'Explain',
                        points: 3
                    }
                ]
            },
            gradingLock: {
                marker: 'Admin',
                markerSession: App.markerSessionKey(),
                heartbeatAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 60000).toISOString()
            }
        };
        global.AssessmentStudioData.state = { studio: { submissions: [sub] } };
        global.document = {
            querySelectorAll: jest.fn(selector => {
                if (selector === '.grade-score') {
                    return [
                        { dataset: { qidx: '0' }, value: '2', max: '2' },
                        { dataset: { qidx: '1' }, value: '2.5', max: '3' }
                    ];
                }
                if (selector === '.grade-comment') {
                    return [
                        { dataset: { qidx: '0' }, value: 'Good selection.' },
                        { dataset: { qidx: '1' }, value: 'Add more supporting detail.' }
                    ];
                }
                return [];
            }),
            getElementById: jest.fn(id => id === 'graderNotes' ? { value: 'Overall note.' } : null)
        };
        App.render = jest.fn();
        App.toast = jest.fn();

        try {
            await App.saveGrade('s_comment');

            expect(sub.status).toBe('completed');
            expect(sub.questionScores).toEqual({ 0: 2, 1: 2.5 });
            expect(sub.questionComments).toEqual({
                0: 'Good selection.',
                1: 'Add more supporting detail.'
            });
            expect(sub.graderNotes).toBe('Overall note.');
            expect(global.AssessmentStudioData.saveStudio).toHaveBeenCalled();
        } finally {
            global.document = originalDocument;
        }
    });

    test('saveGrade treats confirmed row write as durable when document fallback fails', async () => {
        const originalDocument = global.document;
        const sub = {
            id: 's_row_first',
            trainee: 'Alice',
            assessment: 'Course 2',
            status: 'pending_review',
            answers: { 0: 0 },
            testSnapshot: {
                questions: [{
                    id: 'q1',
                    assessment: 'Course 2',
                    type: 'multiple_choice',
                    text: 'Pick one',
                    points: 2,
                    options: ['A', 'B'],
                    correct: 0
                }]
            },
            gradingLock: {
                marker: 'Admin',
                markerSession: App.markerSessionKey(),
                heartbeatAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 60000).toISOString()
            }
        };
        global.AssessmentStudioData.state = { studio: { submissions: [sub] } };
        global.AssessmentStudioData.syncSubmissionRowOnServer = jest.fn().mockResolvedValue(true);
        global.AssessmentStudioData.saveStudio = jest.fn().mockRejectedValue(new Error('document timeout'));
        global.document = {
            querySelectorAll: jest.fn(selector => {
                if (selector === '.grade-score') return [{ dataset: { qidx: '0' }, value: '2', max: '2' }];
                if (selector === '.grade-comment') return [{ dataset: { qidx: '0' }, value: '' }];
                return [];
            }),
            getElementById: jest.fn(id => id === 'graderNotes' ? { value: '' } : null)
        };
        App.render = jest.fn();
        App.toast = jest.fn();

        try {
            await App.saveGrade('s_row_first');

            expect(global.AssessmentStudioData.syncSubmissionRowOnServer).toHaveBeenCalledWith(sub);
            expect(sub.status).toBe('completed');
            expect(App.clearGradingUploadStatus('s_row_first')).toBeUndefined();
            expect(App.toast).toHaveBeenCalledWith('Grade saved. Scores remain editable from this queue.', 'ok');
            expect(App.gradingUploadStatusMap().s_row_first).toBeUndefined();
        } finally {
            global.document = originalDocument;
        }
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

    test('same admin can reclaim a stranded grading lock from an older app session', async () => {
        App.markerSessionId = 'session_new';
        global.AssessmentStudioData.state = {
            studio: {
                submissions: [{
                    id: 's_same_admin',
                    trainee: 'Alice',
                    assessment: 'Course 2',
                    status: 'pending_review',
                    gradingLock: {
                        marker: 'Admin',
                        markerSession: 'Admin::session_old',
                        expiresAt: new Date(Date.now() + 60000).toISOString()
                    }
                }]
            }
        };

        const html = App.renderCompletedRow({
            ...global.AssessmentStudioData.state.studio.submissions[0],
            source: 'studio'
        }, { gradingAction: true });
        expect(html).toContain('You are grading');
        expect(html).not.toContain('Admin is grading');
        expect(html).not.toContain('disabled');

        const claimed = await App.claimSubmissionLock('s_same_admin');

        expect(claimed).toBe(true);
        expect(global.AssessmentStudioData.state.studio.submissions[0].gradingLock.markerSession).toBe(App.markerSessionKey());
    });

    test('same admin can reopen an existing grading lock locally when Supabase times out', async () => {
        App.markerSessionId = 'session_new';
        global.AssessmentStudioData.state = {
            studio: {
                submissions: [{
                    id: 's_same_admin_timeout',
                    trainee: 'Alice',
                    assessment: 'Course 2',
                    status: 'pending_review',
                    gradingLock: {
                        marker: 'Admin',
                        markerSession: 'Admin::session_old',
                        heartbeatAt: new Date().toISOString(),
                        expiresAt: new Date(Date.now() + 60000).toISOString()
                    }
                }]
            }
        };
        global.AssessmentStudioData.saveStudio = jest.fn().mockRejectedValue(new Error('Timed out acquiring connection from connection pool.'));
        App.toast = jest.fn();

        const claimed = await App.claimSubmissionLock('s_same_admin_timeout');

        expect(claimed).toBe(true);
        expect(global.AssessmentStudioData.state.studio.submissions[0].gradingLock.markerSession).toBe(App.markerSessionKey());
        expect(App.toast).toHaveBeenCalledWith(expect.stringContaining('reopened locally'), 'warn');
    });

    test('old heartbeat grading locks expire even if their old expiresAt was long', () => {
        const stale = {
            id: 's_stale_lock',
            status: 'pending_review',
            gradingLock: {
                marker: 'Other Admin',
                markerSession: 'Other::session',
                claimedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
                heartbeatAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
                expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString()
            }
        };

        expect(App.getActiveGradingLock(stale)).toBeNull();
        expect(App.gradingLockBadge(stale)).toContain('Available');
    });

    test('releaseSubmissionLock clears current admin lock from an older session', async () => {
        App.markerSessionId = 'session_new';
        global.AssessmentStudioData.state = {
            studio: {
                submissions: [{
                    id: 's_release_old',
                    trainee: 'Alice',
                    assessment: 'Course 2',
                    status: 'pending_review',
                    gradingLock: {
                        marker: 'Admin',
                        markerSession: 'Admin::session_old',
                        heartbeatAt: new Date().toISOString(),
                        expiresAt: new Date(Date.now() + 60000).toISOString()
                    }
                }]
            }
        };

        await App.releaseSubmissionLock('s_release_old');

        expect(global.AssessmentStudioData.state.studio.submissions[0].gradingLock).toBeNull();
        expect(global.AssessmentStudioData.saveStudio).toHaveBeenCalled();
    });

    test('selectSubmission releases the grading lock if the grader workspace does not mount', async () => {
        const originalDocument = global.document;
        const root = { querySelector: jest.fn(() => null) };
        global.document = {
            getElementById: jest.fn(id => id === 'assessment-studio-app' ? root : null),
            querySelector: jest.fn()
        };
        try {
            global.AssessmentStudioData.load = jest.fn().mockResolvedValue({});
            global.AssessmentStudioData.state = {
                studio: {
                    submissions: [{
                        id: 's_open_fail',
                        trainee: 'Alice',
                        assessment: 'Course 2',
                        status: 'pending_review',
                        answers: { 0: 0 },
                        testSnapshot: {
                            questions: [{
                                id: 'q1',
                                assessment: 'Course 2',
                                type: 'multiple_choice',
                                text: 'Pick one',
                                points: 1,
                                options: ['A', 'B'],
                                correct: 0
                            }]
                        },
                        gradingLock: null
                    }]
                }
            };
            App.render = jest.fn(() => {});
            App.handleError = jest.fn();

            await App.selectSubmission('s_open_fail');

            const sub = global.AssessmentStudioData.state.studio.submissions[0];
            expect(sub.gradingLock).toBeNull();
            expect(App.selectedSubmissionId).toBeNull();
            expect(App.handleError).toHaveBeenCalledWith(expect.any(Error), 'Could not open the grading workspace.');
        } finally {
            global.document = originalDocument;
        }
    });

    test('selectSubmission starts a heartbeat when the grader workspace mounts', async () => {
        jest.useFakeTimers();
        const originalDocument = global.document;
        const root = { querySelector: jest.fn(() => ({})) };
        global.document = {
            getElementById: jest.fn(id => id === 'assessment-studio-app' ? root : null),
            querySelector: jest.fn()
        };
        try {
            global.AssessmentStudioData.load = jest.fn().mockResolvedValue({});
            global.AssessmentStudioData.state = {
                studio: {
                    submissions: [{
                        id: 's_open_ok',
                        trainee: 'Alice',
                        assessment: 'Course 2',
                        status: 'pending_review',
                        answers: { 0: 0 },
                        testSnapshot: {
                            questions: [{
                                id: 'q1',
                                assessment: 'Course 2',
                                type: 'multiple_choice',
                                text: 'Pick one',
                                points: 1,
                                options: ['A', 'B'],
                                correct: 0
                            }]
                        },
                        gradingLock: null
                    }]
                }
            };
            App.render = jest.fn(() => {});

            await App.selectSubmission('s_open_ok');

            const sub = global.AssessmentStudioData.state.studio.submissions[0];
            expect(App.selectedSubmissionId).toBe('s_open_ok');
            expect(sub.gradingLock).toBeTruthy();
            expect(sub.gradingLock.markerSession).toBe(App.markerSessionKey());
            expect(App.gradingHeartbeatTimer).toBeTruthy();
            App.stopGradingLockHeartbeat();
        } finally {
            global.document = originalDocument;
            jest.useRealTimers();
        }
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

    test('verifyCompletedGradeUploads accepts confirmed row storage when studio document is stale', async () => {
        const completed = {
            id: 's_row_confirmed',
            trainee: 'Shane Jacobs',
            assessment: 'Course 2',
            status: 'completed',
            gradedAt: '2026-06-12T10:00:00.000Z',
            updatedAt: '2026-06-12T10:00:00.000Z'
        };
        global.AssessmentStudioData.state = {
            studio: { submissions: [completed] }
        };
        App.setGradingUploadStatus('s_row_confirmed', { state: 'missing' });
        global.AppContext.supabase = {
            from: jest.fn(table => {
                if (table === 'app_documents') {
                    return {
                        select: jest.fn(() => ({
                            eq: jest.fn(() => ({
                                maybeSingle: jest.fn(() => Promise.resolve({
                                    data: { content: { submissions: [] }, updated_at: '2026-06-12T09:00:00.000Z' },
                                    error: null
                                }))
                            }))
                        }))
                    };
                }
                if (table === 'assessment_studio_submissions') {
                    return {
                        select: jest.fn(() => ({
                            eq: jest.fn(() => ({
                                maybeSingle: jest.fn(() => Promise.resolve({
                                    data: { data: completed, updated_at: '2026-06-12T10:01:00.000Z' },
                                    error: null
                                }))
                            }))
                        }))
                    };
                }
                throw new Error(`Unexpected table ${table}`);
            })
        };

        const changed = await App.verifyCompletedGradeUploads({ silent: true });

        expect(changed).toBe(false);
        expect(App.gradingUploadStatusMap().s_row_confirmed).toBeUndefined();
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
