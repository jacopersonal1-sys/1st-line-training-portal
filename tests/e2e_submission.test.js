const fs = require('fs');
const path = require('path');

describe('E2E: Trainee submit -> save flow', () => {
    beforeEach(() => {
        // Clear storage and set safe globals
        if (typeof localStorage !== 'undefined' && localStorage.clear) localStorage.clear();
        global.alert = () => {};
        global.confirm = () => true;
        global.showToast = () => {};
        global.NPSSystem = { triggerCompletionSurvey: () => {} };
        global.console = global.console || console;
        global.document = {
            getElementById: () => null,
            querySelector: () => null,
            activeElement: null
        };
    });

    test('submitTest stores submission and calls saveToServer', async () => {
        const dataSrc = fs.readFileSync(path.resolve(__dirname, '../js/data.js'), 'utf8');
        const assessmentSrc = fs.readFileSync(path.resolve(__dirname, '../js/assessment_trainee.js'), 'utf8');

        // Eval core sync + assessment code into the test VM (jsdom provides window/localStorage)
        eval(dataSrc);
        eval(assessmentSrc);

        // Set a simple trainee and test environment
        window.CURRENT_USER = { user: 'alice', role: 'trainee' };
        global.CURRENT_USER = window.CURRENT_USER;
        localStorage.setItem('tests', JSON.stringify([{ id: 'T1', title: 'T1', questions: [], type: 'standard' }]));
        localStorage.setItem('rosters', JSON.stringify({ 'G1': ['alice'] }));
        localStorage.setItem('schedules', JSON.stringify({
            'S1': { assigned: 'G1', items: [{ linkedTestId: 'T1', dateRange: [], dueDate: new Date().toISOString() }] }
        }));

        // Prepare CURRENT_TEST and answers
        window.CURRENT_TEST = { id: 'T1', title: 'T1', questions: [], remainingSeconds: 0 };
        window.USER_ANSWERS = {};
        window.calculateAssessmentAutoResult = () => ({ autoPoints: 0, maxPoints: 0, percent: 95, needsManual: false });

        // Stub saveToServer to capture calls
        const calls = [];
        const saveStub = async function(keys, force = false, silent = false) { calls.push({ keys, force, silent }); return true; };
        window.saveToServer = saveStub;
        global.saveToServer = saveStub;
        saveToServer = saveStub;

        // Ensure fresh state
        expect(JSON.parse(localStorage.getItem('submissions') || '[]').length).toBe(0);

        // Run submit
        await submitTest();

        const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
        expect(subs.length).toBe(1);
        expect(subs[0].testId).toBe('T1');
        expect(subs[0].trainee.toLowerCase()).toBe('alice');
        expect(subs[0].status).toBe('completed');
        expect(calls.some(c => Array.isArray(c.keys) && c.keys.includes('submissions') && c.force === true)).toBe(true);

    }, 20000);
});
