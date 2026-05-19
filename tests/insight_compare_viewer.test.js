const InsightApp = require('../modules/insight_studio/js/main.js');

describe('Insight Compare Viewer', () => {
    afterEach(() => {
        delete global.window.ProgressCatalog;
        delete global.InsightDataService;
    });

    test('prefers final records over duplicate raw submissions with the same title', () => {
        const row = InsightApp.buildComparisonRowFromData(
            { name: 'Nompumelelo Dzingwa', group: '2026-03-A' },
            {
                records: [
                    {
                        trainee: 'Nompumelelo Dzingwa',
                        assessment: 'Course 1 - Terms',
                        score: 97,
                        raw: { score: 97 }
                    }
                ],
                submissions: [
                    {
                        trainee: 'Nompumelelo Dzingwa',
                        testTitle: 'Course 1 - Terms',
                        score: 0,
                        status: 'completed',
                        raw: { score: 0 }
                    }
                ],
                attendance: [],
                activity: { hasData: false, daysTracked: 0, violationCount: 0, focusScore: 0, dataStatus: 'no_data' },
                engagement: { totals: { totalQuizAttempts: 0, totalWatchSeconds: 0 } },
                progressScore: null
            }
        );

        expect(row.assessmentScore).toBe(97);
        expect(row.testScore).toBeNull();
        expect(row.metricMap['Assessment: Course 1 - Terms']).toBe(97);
        expect(row.metricMap['Test: Course 1 - Terms']).toBeUndefined();
    });

    test('keeps true zero scores but ignores missing score fields', () => {
        expect(InsightApp.getComparisonScore({ score: 0, raw: { score: 0 } })).toBe(0);
        expect(InsightApp.getComparisonScore({ score: 0, raw: {} })).toBeNull();
    });

    test('reads archived monitor material and tool time as focused study time', () => {
        expect(InsightApp.getActivityEntryFocusScore({
            summary: {
                material: 30,
                tool: 15,
                external: 10,
                idle: 5,
                total: 60
            }
        })).toBe(75);
    });

    test('sorts Insight Build score breakdowns by type and course number', () => {
        const items = InsightApp.getInsightScoreBreakdownItems({
            metricMap: {
                'Assessment: Course 10 - Advanced': 80,
                'Assessment: Course 2 - Basics': 90,
                'Vetting: Vetting Test 1': 70,
                'Live: Live Assessment 1': 88,
                'Test: Course 1 Quiz': 95
            }
        });

        expect(items.map(item => `${item.type}:${item.name}`)).toEqual([
            'Assessment:Course 2 - Basics',
            'Assessment:Course 10 - Advanced',
            'Vetting:Vetting Test 1',
            'Live:Live Assessment 1',
            'Test:Course 1 Quiz'
        ]);
    });

    test('uses official progress items as the definitive score source when available', () => {
        global.window.ProgressCatalog = {
            getTraineeProgress: jest.fn(() => ({
                progress: 50,
                items: [
                    { name: 'Configured Assessment', type: 'assessment', status: 'completed', score: 80 },
                    { name: 'Configured Live', type: 'live', status: 'completed', score: 90 },
                    { name: 'Missing Configured Test', type: 'test', status: 'missing', score: null }
                ],
                completedCount: 2,
                totalRequired: 3
            }))
        };

        const row = InsightApp.buildComparisonRowFromData(
            { name: 'Agent A', group: 'G1' },
            {
                records: [
                    { trainee: 'Agent A', assessment: 'Configured Assessment', score: 80, raw: { score: 80 } },
                    { trainee: 'Agent A', assessment: 'Old Extra Assessment', score: 5, raw: { score: 5 } }
                ],
                submissions: [],
                attendance: [],
                activity: { hasData: false, daysTracked: 0, violationCount: 0, focusScore: 0, dataStatus: 'no_data' },
                engagement: { totals: { totalQuizAttempts: 0, totalWatchSeconds: 0 } },
                progressScore: null
            }
        );

        expect(row.assessmentScore).toBe(80);
        expect(row.liveScore).toBe(90);
        expect(row.progressScore).toBe(50);
        expect(row.metricMap['Assessment: Configured Assessment']).toBe(80);
        expect(row.metricMap['Live: Configured Live']).toBe(90);
        expect(row.metricMap['Assessment: Old Extra Assessment']).toBeUndefined();
        expect(row.metricMap['Test: Missing Configured Test']).toBeUndefined();
    });

    test('builds attendance and focus graph points per date', () => {
        const row = InsightApp.buildComparisonRowFromData(
            { name: 'Agent A', group: 'G1' },
            {
                records: [],
                submissions: [],
                attendance: [
                    { user: 'Agent A', date: '2026-05-07', isLate: false },
                    { user: 'Agent A', date: '2026-05-08', isLate: true },
                    { user: 'Agent A', date: '2026-05-09', isLate: true, isIgnored: true }
                ],
                activity: {
                    hasData: true,
                    daysTracked: 2,
                    violationCount: 0,
                    focusScore: 50,
                    dataStatus: 'ok',
                    history: [
                        { user: 'Agent A', date: '2026-05-07', summary: { study: 45, total: 60 } },
                        { user: 'Agent A', date: '2026-05-08', summary: { study: 15, total: 60 } }
                    ]
                },
                engagement: { totals: { totalQuizAttempts: 0, totalWatchSeconds: 0 } },
                progressScore: null
            }
        );

        expect(row.metricMap['Attendance: 2026-05-07']).toBe(100);
        expect(row.metricMap['Attendance: 2026-05-08']).toBe(0);
        expect(row.metricMap['Attendance: 2026-05-09']).toBeUndefined();
        expect(row.attendanceDays).toBe(2);
        expect(row.lateCount).toBe(1);
        expect(row.attendanceScore).toBe(50);
        expect(row.metricMap['Focus: 2026-05-07']).toBe(75);
        expect(row.metricMap['Focus: 2026-05-08']).toBe(25);
        expect(InsightApp.getBreakdownMetricLabels([row], 'attendance')).toEqual([
            'Attendance: 2026-05-07',
            'Attendance: 2026-05-08'
        ]);
        expect(InsightApp.getBreakdownMetricLabels([row], 'focus')).toEqual([
            'Focus: 2026-05-07',
            'Focus: 2026-05-08'
        ]);

        const attendanceHtml = InsightApp.renderComparisonTrend([row], 'attendance', 'attendance');
        const focusHtml = InsightApp.renderComparisonTrend([row], 'focus', 'focus');

        expect(attendanceHtml).toContain('<table');
        expect(attendanceHtml).toContain('05-07');
        expect(attendanceHtml).toContain('On time');
        expect(focusHtml).toContain('<table');
        expect(focusHtml).toContain('80-100%');
    });

    test('Insight Build timelines can read archived attempt rows directly', () => {
        const row = {
            label: 'Agent A - Retrain 1',
            personKey: 'Agent A',
            sourceStartTs: Date.parse('2026-03-02'),
            attendanceRows: [
                { user: 'Agent A', date: '2026-03-02', isLate: false, clockIn: '07:55' },
                { user: 'Agent A', date: '2026-03-03', isLate: true, clockIn: '08:12' }
            ],
            activityHistory: [
                { user: 'Agent A', date: '2026-03-02', summary: { study: 50, total: 100 } }
            ],
            metricMap: {
                'Attendance: 2026-03-02': 100,
                'Focus: 2026-03-02': 50
            }
        };

        const window = InsightApp.getProbationDateWindowForRows([row]);
        expect(window.start).toBe('2026-03-02');
        expect(window.days).toContain('2026-03-02');
        expect(InsightApp.getAttendanceStatusForRowDate(row, '2026-03-02').status).toBe('present');
        expect(InsightApp.getAttendanceStatusForRowDate(row, '2026-03-03').status).toBe('late');
        expect(InsightApp.getDailyFocusForRowDate(row, '2026-03-02')).toBe(50);

        const stats = InsightApp.getProbationAttendanceStatsForRow(row, ['2026-03-02', '2026-03-03']);
        expect(stats.present).toBe(1);
        expect(stats.late).toBe(1);
    });

    test('HR evidence uses only manual evaluation triggers and maps into Insight Build rows', () => {
        expect(InsightApp.hrEvidenceTriggers).toEqual([
            'Works to full potential',
            'Quality of work',
            'Work Consistency',
            'Communication',
            'Takes Initiative',
            'Group work',
            'Productivity',
            'Honesty',
            'Integrity',
            'Technical Skills',
            'Dependability',
            'Punctuality',
            'Attendance'
        ]);

        global.InsightDataService = {
            getHrEvidenceForAgent: jest.fn(() => [{
                trainee: 'Agent A',
                trigger: 'Communication',
                description: 'Clear handover issue raised by HR.',
                proofUrl: 'https://sharepoint.example/evidence',
                createdAt: '2026-05-18T10:00:00.000Z',
                createdBy: 'Admin'
            }])
        };

        const rows = InsightApp.getManualPerformanceEvidenceRows({ name: 'Agent A' });
        expect(rows).toHaveLength(1);
        expect(rows[0].area).toBe('Communication');
        expect(rows[0].signal).toBe('Manual HR evidence');
        expect(rows[0].proofUrl).toContain('sharepoint');
    });
});
