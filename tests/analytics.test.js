const AnalyticsEngine = require('../js/analyticsDashboard.js');

describe('AnalyticsEngine', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    test('calculateAtRiskScore returns 0 for clean user', () => {
        // Setup clean data
        localStorage.setItem('monitor_history', JSON.stringify([
            { user: 'testUser', summary: { study: 100, total: 100 } } // 100% Focus
        ]));
        localStorage.setItem('attendance_records', '[]');
        localStorage.setItem('insightReviews', '[]');
        localStorage.setItem('records', '[]');

        const score = AnalyticsEngine.calculateAtRiskScore('testUser');
        expect(score).toBe(0);
    });

    test('calculateAtRiskScore detects low focus', () => {
        // Setup low focus data (< 40%)
        localStorage.setItem('monitor_history', JSON.stringify([
            { user: 'distractedUser', summary: { study: 20, total: 100 } } // 20% Focus
        ]));
        
        const score = AnalyticsEngine.calculateAtRiskScore('distractedUser');
        // Expect 30 points for focus risk
        expect(score).toBe(30);
    });

    test('calculateAtRiskScore detects lateness', () => {
        // Setup 3 late records
        localStorage.setItem('attendance_records', JSON.stringify([
            { user: 'lateUser', isLate: true },
            { user: 'lateUser', isLate: true },
            { user: 'lateUser', isLate: true }
        ]));
        
        const score = AnalyticsEngine.calculateAtRiskScore('lateUser');
        // Expect 30 points for attendance risk
        expect(score).toBe(30);
    });

    test('calculateAtRiskScore caps at 100', () => {
        // Setup worst case scenario
        localStorage.setItem('monitor_history', JSON.stringify([{ user: 'badUser', summary: { study: 0, total: 100 } }])); // +30
        localStorage.setItem('attendance_records', JSON.stringify([{ user: 'badUser', isLate: true }, { user: 'badUser', isLate: true }, { user: 'badUser', isLate: true }])); // +30
        localStorage.setItem('insightReviews', JSON.stringify([{ trainee: 'badUser', status: 'Critical' }])); // +40
        
        // Total would be 100
        const score = AnalyticsEngine.calculateAtRiskScore('badUser');
        expect(score).toBe(100);
    });

    test('calculateDepartmentHealth aggregates global stats correctly', () => {
        localStorage.setItem('users', JSON.stringify([
            { user: 'A', role: 'trainee' },
            { user: 'B', role: 'trainee' },
            { user: 'C', role: 'trainee' }
        ]));
        
        localStorage.setItem('records', JSON.stringify([
            { trainee: 'B', score: 75 }, // Warning (< 80)
            { trainee: 'C', score: 50 }  // Critical (< 60)
        ]));
        
        const health = AnalyticsEngine.calculateDepartmentHealth();
        
        expect(health.total).toBe(3);
        expect(health.onTrack).toBe(33); // A (No records = On Track)
        expect(health.warning).toBe(33); // B
        expect(health.critical).toBe(33); // C
    });

    test('calculateDepartmentHealth filters by group', () => {
        localStorage.setItem('users', JSON.stringify([{ user: 'A', role: 'trainee' }, { user: 'B', role: 'trainee' }]));
        localStorage.setItem('rosters', JSON.stringify({ 'G1': ['A'] }));
        localStorage.setItem('records', JSON.stringify([{ trainee: 'B', score: 20 }])); // Critical but not in group

        const health = AnalyticsEngine.calculateDepartmentHealth('G1');
        expect(health.total).toBe(1);
        expect(health.onTrack).toBe(100); // A is on track
    });

    test('calculateGroupGaps identifies most failed questions', () => {
        localStorage.setItem('rosters', JSON.stringify({ 'G1': ['A', 'B'] }));
        
        // Mock Test Definition
        const testDef = {
            id: 't1',
            title: 'Test 1',
            questions: [
                { text: 'Easy Question', points: 1 },
                { text: 'Hard Question', points: 1 }
            ]
        };
        localStorage.setItem('tests', JSON.stringify([testDef]));

        // Mock Submissions (A passed both, B failed Hard Question)
        // Note: calculateGroupGaps uses 'scores' array { qIdx: score }
        localStorage.setItem('submissions', JSON.stringify([
            { trainee: 'A', testId: 't1', testTitle: 'Test 1', scores: { 0: 1, 1: 1 } },
            { trainee: 'B', testId: 't1', testTitle: 'Test 1', scores: { 0: 1, 1: 0 } }
        ]));

        const gaps = AnalyticsEngine.calculateGroupGaps('G1');
        
        // Expect 'Hard Question' to be in the list with 50% failure rate (1 out of 2 failed)
        expect(gaps.length).toBeGreaterThan(0);
        expect(gaps[0].question).toBe('Hard Question');
        expect(gaps[0].failureRate).toBe(50);
        
        // 'Easy Question' should not be listed as failure rate is 0
    });
});