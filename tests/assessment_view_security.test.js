const fs = require('fs');
const path = require('path');

describe('Marked script access control', () => {
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
        global.alert = jest.fn();
        global.window = global.window || {};
        global.window.crypto = { randomUUID: () => 'session_1' };
        global.CURRENT_USER = { role: 'trainee', user: 'alice' };
    });

    test('trainees cannot open the admin marking workbench', async () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../js/assessment_admin.js'), 'utf8');
        eval(src);

        await openAdminMarking('sub_1');

        expect(alert).toHaveBeenCalledWith("Access denied. Trainees cannot open marked scripts after review.");
    });

    test('trainees cannot reopen completed tests from history links', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../js/assessment_admin.js'), 'utf8');
        eval(src);

        localStorage.setItem('submissions', JSON.stringify([
            { id: 'sub_1', trainee: 'alice', testTitle: '1st Vetting - Email ENS', status: 'completed' }
        ]));

        viewCompletedTest('sub_1', null, 'view');

        expect(alert).toHaveBeenCalledWith("Access denied. Trainees cannot view marked scripts after review.");
    });

    test('viewer rejects legacy trainee+assessment lookup and expects submission id', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../js/assessment_admin.js'), 'utf8');
        eval(src);

        global.CURRENT_USER = { role: 'admin', user: 'manager' };
        localStorage.setItem('submissions', JSON.stringify([
            { id: 'sub_1', trainee: 'alice', testTitle: '1st Vetting - Email ENS', status: 'completed' }
        ]));

        viewCompletedTest('alice', '1st Vetting - Email ENS', 'view');

        expect(alert).toHaveBeenCalledWith("Digital submission file not found for submission ID: alice.");
    });
});
