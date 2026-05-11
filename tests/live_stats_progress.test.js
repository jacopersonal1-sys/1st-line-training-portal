global.document = {
    ...global.document,
    addEventListener: jest.fn(),
    querySelector: jest.fn(() => null),
    createElement: jest.fn(() => ({ innerHTML: '' }))
};

const {
    getLiveAssessmentProgressForTrainee,
    buildLiveStatsProgressRows
} = require('../js/schedule.js');

describe('Live trainee stats progress', () => {
    const assessments = [
        { id: 'live_terms', title: 'Live Terms' },
        { id: 'live_install', title: 'Live Install' },
        { id: 'live_router', title: 'Live Router' }
    ];

    test('counts a completed live submission even when its booking is missing', () => {
        const progress = getLiveAssessmentProgressForTrainee('Tshepo Raselabe', assessments, {
            bookings: [
                { trainee: 'Tshepo Raselabe', assessmentId: 'live_router', assessment: 'Live Router', status: 'Booked' }
            ],
            submissions: [
                {
                    trainee: 'Tshepo Raselabe',
                    assessmentId: 'live_install',
                    testTitle: 'Live Install',
                    status: 'completed',
                    type: 'live',
                    score: 86,
                    date: '2026-05-10'
                }
            ],
            records: []
        });

        expect(progress.completedCount).toBe(1);
        expect(progress.bookedCount).toBe(1);
        expect(progress.remaining).toBe(1);
        expect(progress.progressPct).toBe(33);
        expect(progress.assessments.find(item => item.assessment.id === 'live_install').evidenceLabel).toBe('Submission');
    });

    test('uses permanent live records as completion evidence', () => {
        const progress = getLiveAssessmentProgressForTrainee('Nompumelelo Dzingwa', assessments, {
            bookings: [],
            submissions: [],
            records: [
                {
                    trainee: 'Nompumelelo Dzingwa',
                    assessment: 'Live Terms',
                    cycle: 'Live',
                    score: 92,
                    date: '2026-05-11'
                }
            ]
        });

        expect(progress.completedCount).toBe(1);
        expect(progress.bookedCount).toBe(0);
        expect(progress.remaining).toBe(2);
        expect(progress.assessments.find(item => item.assessment.id === 'live_terms').score).toBe(92);
        expect(progress.assessments.find(item => item.assessment.id === 'live_terms').evidenceLabel).toBe('Record');
    });

    test('builds footer totals from the same per trainee calculation', () => {
        const report = buildLiveStatsProgressRows(['Alice', 'Bob'], assessments, {
            bookings: [
                { trainee: 'Alice', assessmentId: 'live_router', assessment: 'Live Router', status: 'Booked' }
            ],
            submissions: [
                { trainee: 'Alice', assessmentId: 'live_terms', testTitle: 'Live Terms', status: 'completed', type: 'live' },
                { trainee: 'Bob', assessmentId: 'live_install', testTitle: 'Live Install', status: 'completed', type: 'live' }
            ],
            records: []
        });

        expect(report.totals.trainees).toBe(2);
        expect(report.totals.totalAvailable).toBe(6);
        expect(report.totals.completed).toBe(2);
        expect(report.totals.booked).toBe(1);
        expect(report.totals.remaining).toBe(3);
        expect(report.totals.progressPct).toBe(33);
    });
});
