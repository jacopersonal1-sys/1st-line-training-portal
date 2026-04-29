const fs = require('fs');
const path = require('path');

describe('Test engine edge cases', () => {
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
        global.alert = jest.fn();
        global.confirm = jest.fn(() => true);
        global.showToast = jest.fn();
        global.getAvatarHTML = (name) => `<span>${name}</span>`;
        global.CURRENT_USER = { user: 'manager', role: 'admin' };
        window.CURRENT_USER = global.CURRENT_USER;
    });

    test('completed history keeps separate live attempts visible', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../js/admin_history.js'), 'utf8');
        eval(src);

        const container = { innerHTML: '' };
        global.document = {
            getElementById: jest.fn((id) => id === 'completedHistoryList' ? container : null)
        };
        window.document = global.document;

        localStorage.setItem('submissions', JSON.stringify([
            {
                id: 'live_1',
                trainee: 'Alice',
                testTitle: 'Live Fibre Install',
                type: 'live',
                bookingId: 'booking_1',
                liveSessionId: 'session_1',
                status: 'completed',
                archived: false,
                score: 80,
                date: '2026-04-28',
                lastModified: '2026-04-28T08:00:00.000Z'
            },
            {
                id: 'live_2',
                trainee: 'Alice',
                testTitle: 'Live Fibre Install',
                type: 'live',
                bookingId: 'booking_2',
                liveSessionId: 'session_2',
                status: 'completed',
                archived: false,
                score: 90,
                date: '2026-04-29',
                lastModified: '2026-04-29T08:00:00.000Z'
            }
        ]));

        loadCompletedHistory();

        const submissions = JSON.parse(localStorage.getItem('submissions') || '[]');
        expect(submissions.every(sub => sub.archived === false)).toBe(true);
        expect(container.innerHTML).toContain('live_1');
        expect(container.innerHTML).toContain('live_2');
    });

    test('deleting a submission does not delete an unrelated same-title record', async () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../js/admin_history.js'), 'utf8');
        eval(src);

        const container = { innerHTML: '' };
        global.document = {
            getElementById: jest.fn((id) => id === 'completedHistoryList' ? container : null),
            activeElement: null
        };
        window.document = global.document;
        global.HTMLElement = function HTMLElement() {};
        global.hardDelete = jest.fn(async () => true);

        localStorage.setItem('submissions', JSON.stringify([
            { id: 'sub_delete', trainee: 'Alice', testTitle: 'Assessment A', status: 'completed', score: 50, date: '2026-04-29' }
        ]));
        localStorage.setItem('records', JSON.stringify([
            { id: 'record_other', trainee: 'Alice', assessment: 'Assessment A', submissionId: 'other_submission', score: 99 }
        ]));

        await deleteHistorySubmission('sub_delete');

        const records = JSON.parse(localStorage.getItem('records') || '[]');
        expect(records).toHaveLength(1);
        expect(records[0].id).toBe('record_other');
        expect(global.hardDelete).toHaveBeenCalledWith('submissions', 'sub_delete');
        expect(global.hardDelete).not.toHaveBeenCalledWith('records', 'record_other');
    });

    test('special viewer cannot save test builder changes locally or remotely', async () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../js/admin_builder.js'), 'utf8');
        eval(src);

        global.CURRENT_USER = { user: 'viewer', role: 'special_viewer' };
        window.CURRENT_USER = global.CURRENT_USER;
        global.document = {
            getElementById: jest.fn(() => {
                throw new Error('saveTest should stop before reading builder inputs');
            })
        };
        window.document = global.document;
        global.saveToServer = jest.fn();
        window.saveToServer = global.saveToServer;

        localStorage.setItem('tests', JSON.stringify([{ id: 'existing', title: 'Existing' }]));

        await saveTest();

        expect(JSON.parse(localStorage.getItem('tests'))).toEqual([{ id: 'existing', title: 'Existing' }]);
        expect(global.saveToServer).not.toHaveBeenCalled();
        expect(global.showToast).toHaveBeenCalledWith("View Only Mode: Changes cannot be saved.", "error");
    });

    test('assessment record score edit updates record and linked submission permanently', async () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../js/reporting.js'), 'utf8');
        eval(src);

        global.CURRENT_USER = { user: 'manager', role: 'admin' };
        window.CURRENT_USER = global.CURRENT_USER;
        global.customPrompt = jest.fn(async () => '88');
        global.saveToServer = jest.fn(async () => true);
        window.saveToServer = global.saveToServer;
        renderMonthly = jest.fn();
        loadCompletedHistory = jest.fn();
        loadTestRecords = jest.fn();

        localStorage.setItem('records', JSON.stringify([
            {
                id: 'record_sub_1',
                trainee: 'Alice',
                assessment: 'Assessment A',
                score: 70,
                phase: 'Assessment',
                submissionId: 'sub_1'
            }
        ]));
        localStorage.setItem('submissions', JSON.stringify([
            {
                id: 'sub_1',
                trainee: 'Alice',
                testTitle: 'Assessment A',
                status: 'completed',
                score: 70
            }
        ]));

        await updateRecordScore(0);

        const record = JSON.parse(localStorage.getItem('records'))[0];
        const submission = JSON.parse(localStorage.getItem('submissions'))[0];

        expect(record.score).toBe(88);
        expect(record.modifiedBy).toBe('manager');
        expect(submission.score).toBe(88);
        expect(submission.modifiedBy).toBe('manager');
        expect(submission.markingAudit[0].action).toBe('Assessment record score updated');
        expect(global.saveToServer).toHaveBeenCalledWith(['records', 'submissions'], true);
    });

    test('manual assessment record score edit force-syncs records only', async () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../js/reporting.js'), 'utf8');
        eval(src);

        global.CURRENT_USER = { user: 'manager', role: 'admin' };
        window.CURRENT_USER = global.CURRENT_USER;
        global.customPrompt = jest.fn(async () => '76.5');
        global.saveToServer = jest.fn(async () => true);
        window.saveToServer = global.saveToServer;
        renderMonthly = jest.fn();
        loadCompletedHistory = jest.fn();
        loadTestRecords = jest.fn();

        localStorage.setItem('records', JSON.stringify([
            {
                id: 'manual_1',
                trainee: 'Bob',
                assessment: 'Manual Assessment',
                score: 60,
                phase: 'Assessment'
            }
        ]));
        localStorage.setItem('submissions', JSON.stringify([]));

        await updateRecordScore(0);

        const record = JSON.parse(localStorage.getItem('records'))[0];

        expect(record.score).toBe(76.5);
        expect(record.modifiedBy).toBe('manager');
        expect(global.saveToServer).toHaveBeenCalledWith(['records'], true);
    });
});
