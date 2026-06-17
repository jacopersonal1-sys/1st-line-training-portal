const fs = require('fs');
const path = require('path');

describe('Assessment Studio manual catch-up admin view', () => {
    let elements;

    function makeElement(id) {
        let html = '';
        const el = {
            id,
            value: '',
            dataset: {},
            selectedOptions: [],
            get innerHTML() {
                return html;
            },
            set innerHTML(value) {
                html = String(value || '');
                if (html.includes('id="assessmentStudioCatchupPanel"') && !elements.assessmentStudioCatchupPanel) {
                    elements.assessmentStudioCatchupPanel = makeElement('assessmentStudioCatchupPanel');
                }
                if (html.includes('id="manualAssignmentTarget"') && !elements.manualAssignmentTarget) {
                    elements.manualAssignmentTarget = makeElement('manualAssignmentTarget');
                }
                if (html.includes('id="manualAssignmentTrainee"') && !elements.manualAssignmentTrainee) {
                    elements.manualAssignmentTrainee = makeElement('manualAssignmentTrainee');
                }
                if (html.includes('id="manualAssignmentNote"') && !elements.manualAssignmentNote) {
                    elements.manualAssignmentNote = makeElement('manualAssignmentNote');
                }
            }
        };
        return el;
    }

    beforeEach(() => {
        localStorage.clear();
        elements = {
            'assessment-studio-content': makeElement('assessment-studio-content')
        };
        global.document = {
            getElementById: jest.fn(id => elements[id] || null)
        };
        global.CURRENT_USER = { user: 'Admin', role: 'admin' };
        global.window.CURRENT_USER = global.CURRENT_USER;
        global.goWorkspaceHome = jest.fn();
        global.showToast = jest.fn();
        global.updateNotifications = jest.fn();
        global.emitDataChange = jest.fn();
        global.saveToServer = jest.fn(async () => true);
        global.window.saveToServer = global.saveToServer;
        global.window.CLOUD_CREDENTIALS = {};
        global.window.APP_VERSION = '2.7.54';
        localStorage.setItem('users', JSON.stringify([
            { user: 'Alice', role: 'trainee' },
            { user: 'Admin', role: 'admin' }
        ]));
        localStorage.setItem('tests', JSON.stringify([
            { id: 'legacy_1', title: 'Legacy Test', type: 'standard' }
        ]));
        localStorage.setItem('assessment_studio_data', JSON.stringify({
            questionBucket: [],
            generators: [
                { id: 'gen_1', assessment: 'Studio Catch-up Test', status: 'active' }
            ],
            submissions: [],
            groupings: [],
            tags: []
        }));

        const manualSrc = fs.readFileSync(path.resolve(__dirname, '../js/manual_assessment_assignments.js'), 'utf8');
        const loaderSrc = fs.readFileSync(path.resolve(__dirname, '../js/assessment_studio_loader.js'), 'utf8');
        eval(manualSrc);
        eval(loaderSrc);
    });

    test('renders Assessment Studio catch-up push with Studio assessments before trainee selection', () => {
        window.AssessmentStudioLoader.renderCatchupUI();

        const html = `${elements['assessment-studio-content'].innerHTML}${elements.assessmentStudioCatchupPanel.innerHTML}`;
        expect(html).toContain('Assessment Studio Catch-up Push');
        expect(html).toContain('Catch-up Assignment');
        expect(html).toContain('Assessment Studio | Studio Catch-up Test');
        expect(html).not.toContain('Test Engine | Legacy Test');
        expect(html.indexOf('Assessment Studio Test')).toBeLessThan(html.indexOf('Trainee'));
    });

    test('pushes selected Studio catch-up assignment to selected trainee', async () => {
        window.AssessmentStudioLoader.renderCatchupUI();
        elements.manualAssignmentTarget.value = 'assessment_studio|gen_1';
        elements.manualAssignmentTarget.selectedOptions = [{ dataset: { title: 'Studio Catch-up Test' }, textContent: 'Assessment Studio | Studio Catch-up Test' }];
        elements.manualAssignmentTrainee.value = 'Alice';
        elements.manualAssignmentNote.value = '';

        await window.pushManualAssessmentAssignment();

        const assignments = JSON.parse(localStorage.getItem('manual_assessment_assignments'));
        expect(assignments).toHaveLength(1);
        expect(assignments[0].type).toBe('assessment_studio');
        expect(assignments[0].targetId).toBe('gen_1');
        expect(assignments[0].targetTrainee).toBe('Alice');
        expect(global.saveToServer).toHaveBeenCalledWith(['manual_assessment_assignments', 'admin_notifications'], true, true);
    });
});
