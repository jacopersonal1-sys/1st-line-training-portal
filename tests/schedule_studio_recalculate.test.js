global.AppContext = { host: null };

const ScheduleData = require('../modules/schedule_studio/js/data.js');

describe('Schedule Studio recalculation', () => {
    beforeEach(() => {
        localStorage.clear();
        global.window = { localStorage };
    });

    test('recalculates dates sequentially while preserving step metadata', () => {
        const items = [
            {
                courseName: 'Course 1 - Terms',
                dateRange: '2026/03/02 - 2026/03/03',
                dueDate: '2026/03/03',
                durationDays: 2,
                materialLink: 'https://example.com/material',
                linkedTestId: 'terms-test',
                openTime: '09:00',
                closeTime: '16:00',
                ignoreTime: true,
                isVetting: true
            },
            {
                courseName: 'Course 2 - ACS',
                dateRange: '2026/03/04',
                dueDate: '2026/03/04',
                durationDays: 1,
                assessmentLink: 'https://example.com/assessment',
                isLive: true
            }
        ];

        const recalculated = ScheduleData.recalculateScheduleItems(items, '2026-05-08');

        expect(recalculated).toHaveLength(2);
        expect(recalculated[0]).toMatchObject({
            courseName: 'Course 1 - Terms',
            durationDays: 2,
            dateRange: '2026/05/08 - 2026/05/11',
            dueDate: '2026/05/11',
            materialLink: 'https://example.com/material',
            linkedTestId: 'terms-test',
            openTime: '09:00',
            closeTime: '16:00',
            ignoreTime: true,
            isVetting: true
        });
        expect(recalculated[1]).toMatchObject({
            courseName: 'Course 2 - ACS',
            durationDays: 1,
            dateRange: '2026/05/12',
            dueDate: '2026/05/12',
            assessmentLink: 'https://example.com/assessment',
            isLive: true
        });
    });

    test('moves a weekend start date to the next business day', () => {
        const recalculated = ScheduleData.recalculateScheduleItems([
            { courseName: 'Weekend Start', dateRange: '2026/05/08', durationDays: 1 }
        ], '2026-05-09');

        expect(recalculated[0].dateRange).toBe('2026/05/11');
        expect(recalculated[0].dueDate).toBe('2026/05/11');
    });
});
