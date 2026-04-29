const fs = require('fs');
const path = require('path');

describe('Orphan cleanup stability', () => {
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
        global.confirm = jest.fn(() => true);
        global.alert = jest.fn();
        global.document = {
            activeElement: null,
            getElementById: jest.fn(() => null),
            addEventListener: jest.fn()
        };
        window.document = global.document;
        global.checkRowSyncStatus = jest.fn();
        global.refreshAllDropdowns = jest.fn();
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    test('checks only local IDs instead of scanning whole error_reports table', async () => {
        const src = fs.readFileSync(path.resolve(__dirname, '../js/admin_sys.js'), 'utf8');
        eval(src);

        localStorage.setItem('error_reports', JSON.stringify([
            { id: 'err_keep_1', error: 'kept' },
            { id: 'err_keep_2', error: 'kept' },
            { id: 'err_stale', error: 'remove' }
        ]));

        const inMock = jest.fn(async (_column, ids) => ({
            data: ids
                .filter(id => id !== 'err_stale')
                .map(id => ({ id })),
            error: null
        }));
        const rangeMock = jest.fn(() => {
            throw new Error('orphan cleanup should not scan full tables');
        });

        window.supabaseClient = {
            from: jest.fn(() => ({
                select: jest.fn(() => ({
                    in: inMock,
                    range: rangeMock
                }))
            }))
        };

        await window.performOrphanCleanup(true);

        const reports = JSON.parse(localStorage.getItem('error_reports') || '[]');
        expect(inMock).toHaveBeenCalledWith('id', ['err_keep_1', 'err_keep_2', 'err_stale']);
        expect(rangeMock).not.toHaveBeenCalled();
        expect(reports.map(r => r.id)).toEqual(['err_keep_1', 'err_keep_2']);
    });
});
