global.document = {
    ...global.document,
    addEventListener: jest.fn(),
    querySelector: jest.fn(() => null),
    createElement: jest.fn(() => ({ innerHTML: '' }))
};

const {
    getLiveBookingTimeSlots,
    getDefaultLiveActiveSlots,
    getLiveSlotInputId,
    normalizeLiveActiveSlots,
    getLiveBookingRulesDisplayHtml
} = require('../js/schedule.js');

describe('Live assessment booking slots', () => {
    test('exposes the expanded business-hour slot list in order', () => {
        expect(getLiveBookingTimeSlots()).toEqual([
            '8:00 AM',
            '9:00 AM',
            '10:00 AM',
            '11:00 AM',
            '1:00 PM',
            '2:00 PM',
            '3:00 PM',
            '4:00 PM',
            '5:00 PM'
        ]);
    });

    test('uses every configured slot as the default active set', () => {
        expect(getDefaultLiveActiveSlots()).toEqual(getLiveBookingTimeSlots());
    });

    test('normalizes selected slots and ignores unknown values', () => {
        expect(normalizeLiveActiveSlots(['9:00 AM', 'Bad', '1:00 PM', '9:00 AM'])).toEqual([
            '9:00 AM',
            '1:00 PM'
        ]);
    });

    test('creates stable checkbox ids for each hour', () => {
        expect(getLiveBookingTimeSlots().map(getLiveSlotInputId)).toEqual([
            'slot_800AM',
            'slot_900AM',
            'slot_1000AM',
            'slot_1100AM',
            'slot_100PM',
            'slot_200PM',
            'slot_300PM',
            'slot_400PM',
            'slot_500PM'
        ]);
    });

    test('reads editable live booking rules from local config', () => {
        localStorage.setItem('live_booking_rules_config', JSON.stringify({
            rulesHtml: '<ul><li>Custom booking rule</li></ul>'
        }));

        expect(getLiveBookingRulesDisplayHtml()).toContain('Custom booking rule');
    });
});
