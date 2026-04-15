const fs = require('fs');
const path = require('path');

function makeClassList(initial = []) {
    const set = new Set(initial);
    return {
        contains: (name) => set.has(name),
        add: (name) => set.add(name),
        remove: (name) => set.delete(name)
    };
}

describe('Submission realtime UI refresh', () => {
    beforeEach(() => {
        if (typeof localStorage !== 'undefined' && localStorage.clear) localStorage.clear();
        jest.clearAllMocks();
    });

    test('submission realtime refreshes active admin views immediately', () => {
        const dataSrc = fs.readFileSync(path.resolve(__dirname, '../js/data.js'), 'utf8');
        eval(dataSrc);

        const elements = {
            'test-manage': { classList: makeClassList(['active']) },
            'engine-view-history': { classList: makeClassList() },
            'dashboard-view': { classList: makeClassList() },
            'my-tests': { classList: makeClassList() },
            'test-records': { classList: makeClassList() }
        };

        global.document = {
            getElementById: jest.fn((id) => elements[id] || null),
            activeElement: null
        };

        global.loadAssessmentDashboard = jest.fn();
        global.loadManageTests = jest.fn();
        global.loadMarkingQueue = jest.fn();
        global.loadCompletedHistory = jest.fn();
        global.validateActiveMarkingModalLock = jest.fn();

        handleRowRealtime({
            table: 'submissions',
            eventType: 'INSERT',
            new: {
                id: 'sub_1',
                data: {
                    id: 'sub_1',
                    testId: 'T1',
                    testTitle: '1st Vetting - Email ENS',
                    trainee: 'alice',
                    status: 'completed',
                    archived: false
                }
            }
        });

        const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
        expect(subs).toHaveLength(1);
        expect(subs[0].testTitle).toBe('1st Vetting - Email ENS');
        expect(loadAssessmentDashboard).toHaveBeenCalled();
        expect(loadManageTests).toHaveBeenCalled();
        expect(loadMarkingQueue).toHaveBeenCalled();
        expect(loadCompletedHistory).toHaveBeenCalled();
        expect(validateActiveMarkingModalLock).toHaveBeenCalled();
    });
});
