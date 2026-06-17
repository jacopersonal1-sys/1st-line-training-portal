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
        const manualSrc = fs.readFileSync(path.resolve(__dirname, '../js/manual_assessment_assignments.js'), 'utf8');
        const assessmentSrc = fs.readFileSync(path.resolve(__dirname, '../js/assessment_trainee.js'), 'utf8');

        // Eval core sync + assessment code into the test VM (jsdom provides window/localStorage)
        eval(dataSrc);
        eval(manualSrc);
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

    test('manual Test Engine catch-up submit marks assignment submitted and syncs assignment state', async () => {
        const dataSrc = fs.readFileSync(path.resolve(__dirname, '../js/data.js'), 'utf8');
        const manualSrc = fs.readFileSync(path.resolve(__dirname, '../js/manual_assessment_assignments.js'), 'utf8');
        const assessmentSrc = fs.readFileSync(path.resolve(__dirname, '../js/assessment_trainee.js'), 'utf8');

        eval(dataSrc);
        eval(manualSrc);
        eval(assessmentSrc);

        window.CURRENT_USER = { user: 'alice', role: 'trainee' };
        global.CURRENT_USER = window.CURRENT_USER;
        localStorage.setItem('tests', JSON.stringify([{ id: 'T_MANUAL', title: 'Catch-up Test', questions: [], type: 'standard' }]));
        localStorage.setItem('manual_assessment_assignments', JSON.stringify([{
            id: 'manual_test_1',
            type: 'test_engine',
            targetId: 'T_MANUAL',
            title: 'Catch-up Test',
            targetTrainee: 'alice',
            status: 'in_progress',
            createdAt: '2026-06-12T10:00:00.000Z'
        }]));

        window.CURRENT_TEST = { id: 'T_MANUAL', title: 'Catch-up Test', questions: [], remainingSeconds: 0 };
        window.CURRENT_TEST_CONTEXT = { manualAssignmentId: 'manual_test_1' };
        window.USER_ANSWERS = {};
        window.calculateAssessmentAutoResult = () => ({ autoPoints: 0, maxPoints: 0, percent: 100, needsManual: false });
        const calls = [];
        const saveStub = async function(keys, force = false, silent = false) { calls.push({ keys, force, silent }); return true; };
        window.saveToServer = saveStub;
        global.saveToServer = saveStub;
        saveToServer = saveStub;

        await submitTest();

        const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
        const assignments = JSON.parse(localStorage.getItem('manual_assessment_assignments') || '[]');
        expect(subs).toHaveLength(1);
        expect(subs[0].manualAssignmentId).toBe('manual_test_1');
        expect(assignments[0].status).toBe('submitted');
        expect(assignments[0].submissionId).toBe(subs[0].id);
        expect(calls.some(c => Array.isArray(c.keys) && c.keys.includes('manual_assessment_assignments') && c.force === true)).toBe(true);
    }, 20000);

    test('vetting arena enters sync-hold if cloud save fails after local submission', async () => {
        const dataSrc = fs.readFileSync(path.resolve(__dirname, '../js/data.js'), 'utf8');
        const assessmentSrc = fs.readFileSync(path.resolve(__dirname, '../js/assessment_trainee.js'), 'utf8');

        eval(dataSrc);
        eval(assessmentSrc);

        window.CURRENT_USER = { user: 'alice', role: 'trainee' };
        global.CURRENT_USER = window.CURRENT_USER;
        localStorage.setItem('tests', JSON.stringify([{ id: 'V1', title: 'Final Vetting', questions: [], type: 'vetting' }]));
        localStorage.setItem('rosters', JSON.stringify({ 'G1': ['alice'] }));

        window.CURRENT_TEST = { id: 'V1', title: 'Final Vetting', questions: [], type: 'vetting', remainingSeconds: 0 };
        window.USER_ANSWERS = {};
        window.IS_LIVE_ARENA = true;
        window.calculateAssessmentAutoResult = () => ({ autoPoints: 0, maxPoints: 0, percent: 88, needsManual: false });
        window.saveToServer = jest.fn(async () => { throw new Error('network down'); });
        global.saveToServer = window.saveToServer;
        saveToServer = window.saveToServer;
        window.exitArena = jest.fn(async () => true);
        global.exitArena = window.exitArena;
        exitArena = window.exitArena;
        window.VettingRuntimeV2 = { renderTraineeArena: jest.fn() };
        jest.spyOn(console, 'error').mockImplementation(() => {});

        await submitTest(true);

        const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
        expect(subs).toHaveLength(1);
        expect(subs[0].testId).toBe('V1');
        expect(subs[0].status).toBe('pending');
        expect(window.exitArena).toHaveBeenCalledWith(true);
        expect(window.VettingRuntimeV2.renderTraineeArena).toHaveBeenCalled();
    }, 20000);

    test('vetting submissions wait in the grading queue even when auto-scorable', async () => {
        const dataSrc = fs.readFileSync(path.resolve(__dirname, '../js/data.js'), 'utf8');
        const assessmentSrc = fs.readFileSync(path.resolve(__dirname, '../js/assessment_trainee.js'), 'utf8');

        eval(dataSrc);
        eval(assessmentSrc);

        window.CURRENT_USER = { user: 'alice', role: 'trainee' };
        global.CURRENT_USER = window.CURRENT_USER;
        localStorage.setItem('tests', JSON.stringify([{ id: 'V2', title: 'test test', questions: [], type: 'vetting' }]));
        localStorage.setItem('rosters', JSON.stringify({ 'G1': ['alice'] }));

        window.CURRENT_TEST = { id: 'V2', title: 'test test', questions: [], type: 'vetting', remainingSeconds: 0 };
        window.USER_ANSWERS = {};
        window.IS_LIVE_ARENA = true;
        window.calculateAssessmentAutoResult = () => ({ autoPoints: 5, maxPoints: 5, percent: 100, needsManual: false });
        window.saveToServer = jest.fn(async () => true);
        global.saveToServer = window.saveToServer;
        saveToServer = window.saveToServer;
        window.exitArena = jest.fn(async () => true);
        global.exitArena = window.exitArena;
        exitArena = window.exitArena;

        await submitTest(true);

        const subs = JSON.parse(localStorage.getItem('submissions') || '[]');
        const records = JSON.parse(localStorage.getItem('records') || '[]');
        expect(subs).toHaveLength(1);
        expect(subs[0].testTitle).toBe('test test');
        expect(subs[0].testSnapshot.type).toBe('vetting');
        expect(subs[0].status).toBe('pending');
        expect(records).toHaveLength(0);
        expect(window.saveToServer).toHaveBeenCalledWith(['submissions', 'records'], true);
    }, 20000);
});
