const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadBackfillPlanner(existingRows) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin_sys.js'), 'utf8');
    const start = source.indexOf('function saBackfillParseTime');
    const end = source.indexOf('async function saBackfillCountRows');
    if (start < 0 || end < 0) throw new Error('Could not locate backfill planner helpers');
    const subset = `${source.slice(start, end)}
        globalThis.saBackfillPlanTable = saBackfillPlanTable;
    `;
    const context = {
        window: {
            supabaseClient: {
                from: () => ({
                    select: () => ({
                        limit: async () => ({ data: existingRows, error: null })
                    })
                })
            }
        },
        globalThis: {}
    };
    vm.createContext(context);
    vm.runInContext(subset, context);
    return context.globalThis.saBackfillPlanTable;
}

describe('Super Admin assessment/violation backfill planner', () => {
    test('skips an existing completed Assessment Studio row when legacy document data is older and in progress', async () => {
        const planTable = loadBackfillPlanner([{
            id: 'sub-1',
            data: {
                id: 'sub-1',
                status: 'completed',
                gradedAt: '2026-06-22T10:00:00.000Z',
                updatedAt: '2026-06-22T10:00:00.000Z'
            },
            updated_at: '2026-06-22T10:00:01.000Z'
        }]);

        const plan = await planTable('assessment_studio_submissions', [{
            id: 'sub-1',
            status: 'in_progress',
            data: {
                id: 'sub-1',
                status: 'in_progress',
                updatedAt: '2026-06-22T09:00:00.000Z'
            },
            updated_at: '2026-06-22T09:00:01.000Z'
        }]);

        expect(plan.rows).toHaveLength(0);
        expect(plan.skippedExistingStronger).toEqual(['sub-1']);
    });

    test('copies a missing violation report row', async () => {
        const planTable = loadBackfillPlanner([]);

        const plan = await planTable('violation_reports', [{
            id: 'vio-1',
            trainee: 'Example Trainee',
            status: 'pending_review',
            data: {
                id: 'vio-1',
                user: 'Example Trainee',
                status: 'pending_review',
                reportedAt: '2026-06-22T09:00:00.000Z'
            },
            updated_at: '2026-06-22T09:00:01.000Z'
        }]);

        expect(plan.rows).toHaveLength(1);
        expect(plan.rows[0].id).toBe('vio-1');
        expect(plan.skippedExistingNewer).toHaveLength(0);
        expect(plan.skippedExistingStronger).toHaveLength(0);
    });
});
