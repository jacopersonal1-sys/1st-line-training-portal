const InsightDataService = require('../modules/insight_studio/js/data.js');

describe('Insight Knowledge Gaps', () => {
    beforeEach(() => {
        localStorage.clear();
        global.AppContext = { user: { user: 'Admin User', role: 'admin' }, supabase: null };
        InsightDataService.state.users = [];
        InsightDataService.state.rosters = {};
        InsightDataService.state.records = [];
        InsightDataService.state.submissions = [];
        InsightDataService.state.hrEvidence = [];
        InsightDataService.resetIndexes();
    });

    test('builds question gaps from Test Engine scores plus testSnapshot questions', () => {
        localStorage.setItem('rosters', JSON.stringify({ G1: ['Agent A', 'Agent B'] }));
        localStorage.setItem('submissions', JSON.stringify([
            {
                id: 'sub-a',
                trainee: 'Agent A',
                testId: 'course-1',
                testTitle: 'Course 1',
                status: 'completed',
                scores: { 0: 1, 1: 1 },
                answers: { 0: 'A', 1: 'B' },
                testSnapshot: {
                    title: 'Course 1',
                    questions: [
                        { text: 'Easy Question', points: 1 },
                        { text: 'Hard Question', points: 1 }
                    ]
                }
            },
            {
                id: 'sub-b',
                trainee: 'Agent B',
                testId: 'course-1',
                testTitle: 'Course 1',
                status: 'completed',
                scores: { 0: 1, 1: 0 },
                answers: { 0: 'A', 1: 'Wrong answer' },
                testSnapshot: {
                    title: 'Course 1',
                    questions: [
                        { text: 'Easy Question', points: 1 },
                        { text: 'Hard Question', points: 1 }
                    ]
                }
            }
        ]));

        InsightDataService.hydrateFromLocalStorage();
        const gaps = InsightDataService.buildKnowledgeGaps({ groupFilter: 'G1' });

        expect(gaps.stats.failedQuestionCount).toBe(1);
        expect(gaps.byAssessment).toHaveLength(1);
        expect(gaps.byAssessment[0].assessment).toBe('Course 1');
        expect(gaps.byAssessment[0].questions[0].question).toBe('Hard Question');
        expect(gaps.byAssessment[0].questions[0].failCount).toBe(1);
        expect(gaps.byAssessment[0].questions[0].failRate).toBe(50);
        expect(gaps.byAssessment[0].questions[0].agentCount).toBe(1);
        expect(gaps.byIndividual[0].agent).toBe('Agent B');
        expect(gaps.byIndividual[0].questions[0].answer).toBe('Wrong answer');
        expect(gaps.byIndividual[0].questions[0].scoreLabel).toBe('0/1');
        expect(gaps.byGroup[0].questions[0].question).toBe('Hard Question');
        expect(gaps.byGroup[0].questions[0].agentCount).toBe(1);
    });

    test('filters group knowledge gaps by assessment', () => {
        localStorage.setItem('rosters', JSON.stringify({ G1: ['Agent A', 'Agent B'] }));
        localStorage.setItem('submissions', JSON.stringify([
            {
                id: 'sub-a',
                trainee: 'Agent A',
                testTitle: 'Course 1',
                status: 'completed',
                scores: { 0: 0 },
                answers: { 0: 'Wrong' },
                testSnapshot: { title: 'Course 1', questions: [{ text: 'Course 1 Question', points: 1 }] }
            },
            {
                id: 'sub-b',
                trainee: 'Agent B',
                testTitle: 'Course 2',
                status: 'completed',
                scores: { 0: 0 },
                answers: { 0: 'Wrong' },
                testSnapshot: { title: 'Course 2', questions: [{ text: 'Course 2 Question', points: 1 }] }
            }
        ]));

        InsightDataService.hydrateFromLocalStorage();
        const gaps = InsightDataService.buildKnowledgeGaps({ groupFilter: 'G1', assessmentFilter: 'Course 2' });

        expect(gaps.byGroup).toHaveLength(1);
        expect(gaps.byGroup[0].questions).toHaveLength(1);
        expect(gaps.byGroup[0].questions[0].assessment).toBe('Course 2');
        expect(gaps.byGroup[0].questions[0].question).toBe('Course 2 Question');
        expect(gaps.byGroup[0].questions[0].agentCount).toBe(1);
    });

    test('HR evidence saves against canonical trainee identity', async () => {
        localStorage.setItem('users', JSON.stringify([
            { user: 'Themba Tatsi', role: 'trainee' }
        ]));
        localStorage.setItem('rosters', JSON.stringify({ 'April 2026': ['Themba Tatsi'] }));

        InsightDataService.hydrateFromLocalStorage();
        const result = await InsightDataService.saveHrEvidenceEntry({
            trainee: 'themba   tatsi',
            triggers: ['Communication', 'Dependability'],
            description: 'Needs clearer handover notes.'
        });

        expect(result.ok).toBe(true);
        expect(result.entry.trainee).toBe('Themba Tatsi');
        expect(result.entry.traineeKey).toBe('thembatatsi');
        expect(result.entry.groupID).toBe('April 2026');

        const rows = InsightDataService.getHrEvidenceForAgent('Themba Tatsi');
        expect(rows).toHaveLength(1);
        expect(rows[0].triggers).toEqual(['Communication', 'Dependability']);
        expect(rows[0].description).toContain('handover');

        const update = await InsightDataService.saveHrEvidenceEntry({
            id: rows[0].id,
            trainee: 'Themba Tatsi',
            triggers: ['Communication'],
            description: 'Updated note.'
        });
        expect(update.ok).toBe(true);

        const updatedRows = InsightDataService.getHrEvidenceForAgent('Themba Tatsi');
        expect(updatedRows).toHaveLength(1);
        expect(updatedRows[0].triggers).toEqual(['Communication']);
        expect(updatedRows[0].description).toBe('Updated note.');

        const deleted = await InsightDataService.deleteHrEvidenceEntry(updatedRows[0].id);
        expect(deleted.ok).toBe(true);
        expect(InsightDataService.getHrEvidenceForAgent('Themba Tatsi')).toHaveLength(0);
    });
});
