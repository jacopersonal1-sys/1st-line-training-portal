const InsightApp = require('../modules/insight_studio/js/main.js');

describe('Insight Compare Viewer', () => {
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

    test('builds attendance and focus graph points per date', () => {
        const row = InsightApp.buildComparisonRowFromData(
            { name: 'Agent A', group: 'G1' },
            {
                records: [],
                submissions: [],
                attendance: [
                    { user: 'Agent A', date: '2026-05-07', isLate: false },
                    { user: 'Agent A', date: '2026-05-08', isLate: true }
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
});
