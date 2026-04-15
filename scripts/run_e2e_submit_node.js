const fs = require('fs');
const vm = require('vm');
const path = require('path');

function makeLocalStorageShim() {
    const store = {};
    return {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        clear: () => { Object.keys(store).forEach(k => delete store[k]); },
        _store: store
    };
}

const localStorage = makeLocalStorageShim();
const document = {
    querySelector: () => null,
    getElementById: () => null,
    addEventListener: () => {},
    createElement: () => ({ style: {}, appendChild: () => {} }),
    body: {}
};

const context = {
    window: {},
    localStorage,
    document,
    console,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout,
    clearTimeout,
    Date,
    // Minimal stubs for optional APIs used by data.js
    alert: () => {},
    confirm: () => true,
    showToast: () => {},
    NPSSystem: { triggerCompletionSurvey: () => {} },
    // Expose an object to collect logs
    __e2e: { logs: [] }
};

vm.createContext(context);

try {
    const dataSrc = fs.readFileSync(path.resolve(__dirname, '../js/data.js'), 'utf8');
    vm.runInContext(dataSrc, context, { filename: 'data.js' });
} catch (e) {
    console.error('Failed to load data.js', e);
    process.exit(2);
}

try {
    const assessSrc = fs.readFileSync(path.resolve(__dirname, '../js/assessment_trainee.js'), 'utf8');
    vm.runInContext(assessSrc, context, { filename: 'assessment_trainee.js' });
} catch (e) {
    console.error('Failed to load assessment_trainee.js', e);
    process.exit(2);
}

// Prepare environment
const user = { user: 'alice', role: 'trainee' };
context.CURRENT_USER = user;
context.window.CURRENT_USER = user;

localStorage.setItem('tests', JSON.stringify([{ id: 'T1', title: 'T1', questions: [], type: 'standard' }]));
localStorage.setItem('rosters', JSON.stringify({ 'G1': ['alice'] }));
localStorage.setItem('schedules', JSON.stringify({ 'S1': { assigned: 'G1', items: [{ linkedTestId: 'T1', dateRange: [], dueDate: new Date().toISOString() }] } }));

context.CURRENT_TEST = { id: 'T1', title: 'T1', questions: [], remainingSeconds: 0, shuffle: false };
context.USER_ANSWERS = {};
context.calculateAssessmentAutoResult = () => ({ autoPoints: 0, maxPoints: 0, percent: 95, needsManual: false });

// Stub saveToServer to capture calls
const calls = [];
context.saveToServer = async function(keys, force = false, silent = false) { calls.push({ keys, force, silent }); return true; };
context.window.saveToServer = context.saveToServer;

(async () => {
    try {
        if (typeof context.submitTest !== 'function') {
            console.error('submitTest not found in context');
            process.exit(3);
        }

        await context.submitTest();

        console.log('submissions:', localStorage.getItem('submissions'));
        console.log('hash_map_submissions:', localStorage.getItem('hash_map_submissions'));
        console.log('saveToServerCalls:', JSON.stringify(calls));
        process.exit(0);
    } catch (e) {
        console.error('Error running submitTest:', e && e.stack ? e.stack : e);
        process.exit(4);
    }
})();
