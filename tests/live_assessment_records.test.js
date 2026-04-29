const fs = require('fs');
const path = require('path');

describe('Live assessment record finalization', () => {
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();

        global.alert = jest.fn();
        global.confirm = jest.fn(() => true);
        global.showToast = jest.fn();
        global.showTab = jest.fn();
        global.loadFromServer = jest.fn(async () => true);
        window.loadFromServer = global.loadFromServer;
        global.CURRENT_USER = { user: 'trainer', role: 'admin' };
        window.CURRENT_USER = global.CURRENT_USER;

        const scoreInput = { value: '10', getAttribute: (name) => name === 'data-idx' ? '0' : null };
        const commentInput = { value: 'Good pass', getAttribute: (name) => name === 'data-idx' ? '0' : null };
        global.document = {
            querySelectorAll: jest.fn((selector) => {
                if (selector === '.live-final-score') return [scoreInput];
                if (selector === '.live-final-comment') return [commentInput];
                return [];
            }),
            getElementById: jest.fn(() => null)
        };
        window.document = global.document;
    });

    test('saving a second live attempt keeps the previous submission and record intact', async () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../js/live_execution.js'), 'utf8');
        eval(src);

        const saveCalls = [];
        const saveStub = jest.fn(async (keys, force) => {
            saveCalls.push({ keys, force });
            return true;
        });
        global.saveToServer = saveStub;
        window.saveToServer = saveStub;
        saveToServer = saveStub;
        closeLiveSessionAuthoritatively = jest.fn(async () => {});

        localStorage.setItem('tests', JSON.stringify([
            { id: 'live_test_1', title: 'Live Fibre Install', type: 'live', questions: [{ text: 'Practical', type: 'live_practical', points: 10 }] }
        ]));
        localStorage.setItem('rosters', JSON.stringify({ G1: ['Alice'] }));
        localStorage.setItem('liveBookings', JSON.stringify([
            { id: 'booking_old', trainee: 'Alice', assessment: 'Live Fibre Install', status: 'Completed', score: 40 },
            { id: 'booking_new', trainee: 'Alice', assessment: 'Live Fibre Install', status: 'Booked' }
        ]));
        localStorage.setItem('submissions', JSON.stringify([
            {
                id: 'live_old_session',
                bookingId: 'booking_old',
                liveSessionId: 'old_session',
                testId: 'live_test_1',
                testTitle: 'Live Fibre Install',
                trainee: 'Alice',
                date: new Date().toISOString().split('T')[0],
                status: 'completed',
                score: 40,
                type: 'live'
            }
        ]));
        localStorage.setItem('records', JSON.stringify([
            {
                id: 'record_live_old_session',
                trainee: 'Alice',
                assessment: 'Live Fibre Install',
                score: 40,
                phase: 'Assessment',
                cycle: 'Live',
                link: 'Live-Session',
                submissionId: 'live_old_session',
                bookingId: 'booking_old',
                liveSessionId: 'old_session'
            }
        ]));
        localStorage.setItem('liveSession', JSON.stringify({
            sessionId: 'new_session',
            bookingId: 'booking_new',
            testId: 'live_test_1',
            trainee: 'Alice',
            trainer: 'trainer',
            active: true,
            answers: { 0: 'done' },
            scores: { 0: 10 },
            comments: { 0: 'Good pass' }
        }));

        await confirmAndSaveLiveSession();

        const submissions = JSON.parse(localStorage.getItem('submissions') || '[]');
        const records = JSON.parse(localStorage.getItem('records') || '[]');
        const bookings = JSON.parse(localStorage.getItem('liveBookings') || '[]');

        expect(submissions).toHaveLength(2);
        expect(submissions.find(s => s.id === 'live_old_session').score).toBe(40);
        expect(submissions.find(s => s.liveSessionId === 'new_session').score).toBe(100);

        expect(records).toHaveLength(2);
        expect(records.find(r => r.submissionId === 'live_old_session').score).toBe(40);
        const newRecord = records.find(r => r.liveSessionId === 'new_session');
        expect(newRecord).toBeTruthy();
        expect(newRecord.id).toBe(`record_${submissions.find(s => s.liveSessionId === 'new_session').id}`);
        expect(newRecord.score).toBe(100);

        expect(bookings.find(b => b.id === 'booking_new').status).toBe('Completed');
        expect(bookings.find(b => b.id === 'booking_new').score).toBe(100);
        expect(saveCalls.some(call => call.force === true && call.keys.includes('records') && call.keys.includes('submissions'))).toBe(true);
    });

    test('missing live test definition does not crash final save', async () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../js/live_execution.js'), 'utf8');
        eval(src);

        global.saveToServer = jest.fn(async () => true);
        window.saveToServer = global.saveToServer;
        saveToServer = global.saveToServer;
        closeLiveSessionAuthoritatively = jest.fn(async () => {});

        localStorage.setItem('tests', JSON.stringify([]));
        localStorage.setItem('liveSession', JSON.stringify({
            sessionId: 'missing_test_session',
            bookingId: 'booking_missing',
            testId: 'missing_test',
            trainee: 'Alice',
            trainer: 'trainer',
            active: true,
            answers: { 0: 'done' }
        }));

        const result = await confirmAndSaveLiveSession();

        expect(result).toBe(false);
        expect(global.showToast).toHaveBeenCalled();
        expect(global.saveToServer).not.toHaveBeenCalled();
        expect(closeLiveSessionAuthoritatively).not.toHaveBeenCalled();
    });

    test('live score and comment saves initialize missing containers', async () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../js/live_execution.js'), 'utf8');
        eval(src);

        const updateStub = jest.fn(async () => true);
        window.updateGlobalSessionArray = updateStub;
        updateGlobalSessionArray = updateStub;

        localStorage.setItem('liveSession', JSON.stringify({
            sessionId: 'session_missing_maps',
            active: true
        }));

        await saveLiveScore(8, '3.5');
        await saveLiveComment(8, 'Observed practical step');

        const session = JSON.parse(localStorage.getItem('liveSession') || '{}');
        expect(session.scores[8]).toBe(3.5);
        expect(session.comments[8]).toBe('Observed practical step');
        expect(updateStub).toHaveBeenCalled();
    });
});
