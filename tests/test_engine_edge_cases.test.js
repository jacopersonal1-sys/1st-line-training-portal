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

    test('marking queue keeps actively marked linked pending submissions visible', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../js/assessment_admin.js'), 'utf8');
        eval(src);

        const container = { innerHTML: '' };
        const badge = {
            innerText: '',
            classList: { remove: jest.fn(), add: jest.fn() }
        };
        global.document = {
            getElementById: jest.fn((id) => {
                if (id === 'markingList') return container;
                if (id === 'markingCountBadge') return badge;
                return null;
            })
        };
        window.document = global.document;
        global.saveToServer = jest.fn();
        window.saveToServer = global.saveToServer;
        window.ACTIVE_MARKING_SUBMISSION_ID = 'sub_active';

        const expiresAt = new Date(Date.now() + 60000).toISOString();
        localStorage.setItem('submissions', JSON.stringify([
            {
                id: 'sub_active',
                trainee: 'Alice',
                testId: 'test_1',
                testTitle: 'Assessment A',
                status: 'pending',
                archived: false,
                date: '2026-05-19',
                markingLock: {
                    marker: 'manager',
                    markerSession: getMarkerSessionKey(),
                    expiresAt
                }
            }
        ]));
        localStorage.setItem('records', JSON.stringify([
            { id: 'record_sub_active', submissionId: 'sub_active', trainee: 'Alice', assessment: 'Assessment A', score: 77 }
        ]));

        loadMarkingQueue();

        const submissions = JSON.parse(localStorage.getItem('submissions') || '[]');
        expect(submissions[0].status).toBe('pending');
        expect(submissions[0].archived).toBe(false);
        expect(badge.innerText).toBe(1);
        expect(container.innerHTML).toContain('sub_active');
        expect(global.saveToServer).not.toHaveBeenCalled();

        window.ACTIVE_MARKING_SUBMISSION_ID = null;
    });

    test('marking queue repairs stale linked pending submissions without archiving them', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../js/assessment_admin.js'), 'utf8');
        eval(src);

        const container = { innerHTML: '' };
        const badge = {
            innerText: '',
            classList: { remove: jest.fn(), add: jest.fn() }
        };
        global.document = {
            getElementById: jest.fn((id) => {
                if (id === 'markingList') return container;
                if (id === 'markingCountBadge') return badge;
                return null;
            })
        };
        window.document = global.document;
        global.saveToServer = jest.fn();
        window.saveToServer = global.saveToServer;

        localStorage.setItem('submissions', JSON.stringify([
            {
                id: 'sub_stale',
                trainee: 'Alice',
                testId: 'test_1',
                testTitle: 'Assessment A',
                status: 'pending',
                archived: false,
                date: '2026-05-19'
            }
        ]));
        localStorage.setItem('records', JSON.stringify([
            { id: 'record_sub_stale', submissionId: 'sub_stale', trainee: 'Alice', assessment: 'Assessment A', score: 88 }
        ]));

        loadMarkingQueue();

        const submissions = JSON.parse(localStorage.getItem('submissions') || '[]');
        expect(submissions[0].status).toBe('completed');
        expect(submissions[0].archived).toBe(false);
        expect(submissions[0].score).toBe(88);
        expect(badge.innerText).toBe(0);
        expect(global.saveToServer).toHaveBeenCalledWith(['submissions'], false, true);
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

    test('trainee feedback request is one-time and syncs linked record plus admin notification', async () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../js/assessment_trainee.js'), 'utf8');
        eval(src);

        global.CURRENT_USER = { user: 'Alice', role: 'trainee' };
        window.CURRENT_USER = global.CURRENT_USER;
        global.saveToServer = jest.fn(async () => true);
        window.saveToServer = global.saveToServer;
        global.loadTraineeTests = jest.fn();
        global.updateNotifications = jest.fn();
        global.document = { getElementById: jest.fn(() => null) };
        window.document = global.document;

        localStorage.setItem('submissions', JSON.stringify([
            { id: 'sub_feedback', trainee: 'Alice', testTitle: 'Assessment A', status: 'completed', score: 85 }
        ]));
        localStorage.setItem('records', JSON.stringify([
            { id: 'record_sub_feedback', submissionId: 'sub_feedback', trainee: 'Alice', assessment: 'Assessment A', score: 85 }
        ]));

        await window.requestAssessmentFeedback('sub_feedback');

        const submission = JSON.parse(localStorage.getItem('submissions'))[0];
        const record = JSON.parse(localStorage.getItem('records'))[0];
        const notifications = JSON.parse(localStorage.getItem('admin_notifications'));

        expect(submission.feedbackStatus).toBe('requested');
        expect(submission.feedbackRequestLocked).toBe(true);
        expect(record.feedbackStatus).toBe('requested');
        expect(record.feedbackRequestLocked).toBe(true);
        expect(notifications[0].type).toBe('assessment_feedback_request');
        expect(global.saveToServer).toHaveBeenCalledWith(['submissions', 'records', 'admin_notifications'], false);
        expect(global.saveToServer).toHaveBeenCalledWith('FLUSH');

        await window.requestAssessmentFeedback('sub_feedback');
        expect(global.showToast).toHaveBeenCalledWith('Feedback can only be requested once for this assessment.', 'warning');
    });

    test('trainee my assessments shows live booking even when linked assessment is already scheduled', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../js/assessment_trainee.js'), 'utf8');
        eval(src);

        global.CURRENT_USER = { user: 'Alice', role: 'trainee' };
        window.CURRENT_USER = global.CURRENT_USER;
        const container = { innerHTML: '' };
        global.document = {
            getElementById: jest.fn((id) => id === 'myTestsList' ? container : null)
        };
        window.document = global.document;

        localStorage.setItem('tests', JSON.stringify([
            { id: 'test_1', title: 'Assessment A', type: 'standard', questions: [{ id: 'q1' }] }
        ]));
        localStorage.setItem('rosters', JSON.stringify({ group_1: ['Alice'] }));
        localStorage.setItem('schedules', JSON.stringify({
            sched_1: {
                assigned: 'group_1',
                items: [{ linkedTestId: 'test_1', dateRange: '2999-01-01', dueDate: '2999-01-01' }]
            }
        }));
        localStorage.setItem('liveBookings', JSON.stringify([
            {
                id: 'booking_1',
                trainee: 'Alice',
                assessmentId: 'test_1',
                assessment: 'Assessment A',
                status: 'Booked',
                date: '2999-01-01',
                time: '09:00'
            }
        ]));
        localStorage.setItem('submissions', JSON.stringify([]));
        localStorage.setItem('records', JSON.stringify([]));

        loadTraineeTests();

        expect(container.innerHTML).toContain('Booked 2999-01-01 09:00');
        expect(container.innerHTML).toContain('View Live Booking');
    });

    test('trainee feedback request button uses editable tooltip config', () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../js/assessment_trainee.js'), 'utf8');
        eval(src);

        global.CURRENT_USER = { user: 'Alice', role: 'trainee' };
        window.CURRENT_USER = global.CURRENT_USER;
        const container = { innerHTML: '' };
        global.document = {
            getElementById: jest.fn((id) => id === 'myTestsList' ? container : null)
        };
        window.document = global.document;

        localStorage.setItem('tests', JSON.stringify([
            { id: 'test_1', title: 'Assessment A', type: 'standard', questions: [{ id: 'q1' }] }
        ]));
        localStorage.setItem('rosters', JSON.stringify({ group_1: ['Alice'] }));
        localStorage.setItem('schedules', JSON.stringify({
            sched_1: {
                assigned: 'group_1',
                items: [{ linkedTestId: 'test_1', dateRange: '2026-05-19', dueDate: '2026-05-19' }]
            }
        }));
        localStorage.setItem('submissions', JSON.stringify([
            { id: 'sub_feedback_tip', trainee: 'Alice', testId: 'test_1', testTitle: 'Assessment A', status: 'completed', score: 82 }
        ]));
        localStorage.setItem('records', JSON.stringify([]));
        localStorage.setItem('assessment_feedback_config', JSON.stringify({
            tooltipText: 'Custom feedback tooltip for trainees'
        }));

        loadTraineeTests();

        expect(container.innerHTML).toContain('Feedback Required');
        expect(container.innerHTML).toContain('data-tooltip="Custom feedback tooltip for trainees"');
    });

    test('admin marks requested assessment feedback as given without unlocking trainee request', async () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../js/assessment_trainee.js'), 'utf8');
        eval(src);

        global.CURRENT_USER = { user: 'manager', role: 'admin' };
        window.CURRENT_USER = global.CURRENT_USER;
        global.saveToServer = jest.fn(async () => true);
        window.saveToServer = global.saveToServer;
        global.loadFeedbackSessions = jest.fn();
        global.loadCompletedHistory = jest.fn();
        global.updateNotifications = jest.fn();

        localStorage.setItem('submissions', JSON.stringify([
            { id: 'sub_feedback', trainee: 'Alice', testTitle: 'Assessment A', status: 'completed', score: 85, feedbackStatus: 'requested', feedbackRequestLocked: true }
        ]));
        localStorage.setItem('records', JSON.stringify([
            { id: 'record_sub_feedback', submissionId: 'sub_feedback', trainee: 'Alice', assessment: 'Assessment A', score: 85, feedbackStatus: 'requested', feedbackRequestLocked: true }
        ]));
        localStorage.setItem('admin_notifications', JSON.stringify([
            { id: 'assessment_feedback_sub_feedback', type: 'assessment_feedback_request', submissionId: 'sub_feedback', status: 'open' }
        ]));

        await window.markAssessmentFeedbackGiven('sub_feedback');

        const submission = JSON.parse(localStorage.getItem('submissions'))[0];
        const record = JSON.parse(localStorage.getItem('records'))[0];
        const notification = JSON.parse(localStorage.getItem('admin_notifications'))[0];

        expect(submission.feedbackStatus).toBe('given');
        expect(submission.feedbackRequestLocked).toBe(true);
        expect(record.feedbackStatus).toBe('given');
        expect(record.feedbackRequestLocked).toBe(true);
        expect(notification.status).toBe('closed');
        expect(global.saveToServer).toHaveBeenCalledWith(['submissions', 'records', 'admin_notifications'], false);
        expect(global.saveToServer).toHaveBeenCalledWith('FLUSH');
    });
});
