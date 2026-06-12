const fs = require('fs');
const path = require('path');

describe('Assessment Studio grading auto scoring', () => {
    let App;

    beforeEach(() => {
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
            }
        };

        const src = fs.readFileSync(path.resolve(__dirname, '../modules/assessment_studio/js/main.js'), 'utf8');
        eval(`${src}\nglobal.__AssessmentStudioApp = App;`);
        App = global.__AssessmentStudioApp;
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
