const fs = require('fs');
const path = require('path');

describe('Device assessment sessions', () => {
    beforeEach(() => {
        localStorage.clear();
        global.window = {
            CURRENT_USER: { user: 'Alice', role: 'trainee' },
            supabaseClient: null
        };
        global.CURRENT_USER = global.window.CURRENT_USER;
        global.document = {
            getElementById: jest.fn(() => null)
        };
        global.showToast = jest.fn();
        const src = fs.readFileSync(path.resolve(__dirname, '../js/device_assessment_sessions.js'), 'utf8');
        eval(src);
    });

    test('claims only an available configured device session', async () => {
        localStorage.setItem('device_assessment_sessions', JSON.stringify({
            enabled: true,
            selected: { type: 'test_engine', id: 'test_router', title: 'Router Setup' },
            sessions: [
                { slot: 1, clientCode: 'C1', macAddress: 'AA', pppoeName: 'pppoe1', status: 'available' },
                { slot: 2, clientCode: 'C2', macAddress: 'BB', pppoeName: 'pppoe2', status: 'offline' },
                { slot: 3, clientCode: 'C3', macAddress: 'CC', pppoeName: 'pppoe3', status: 'requires_attention' },
                { slot: 4, clientCode: 'C4', macAddress: 'DD', pppoeName: 'pppoe4', status: 'in_use' }
            ]
        }));

        const updatePayloads = [];
        window.supabaseClient = {
            from: jest.fn(table => {
                if (table === 'app_documents') {
                    return {
                        select: jest.fn(() => ({
                            eq: jest.fn(() => ({
                                maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null })
                            }))
                        }))
                    };
                }
                if (table === 'assessment_device_sessions') {
                    return {
                        select: jest.fn(() => ({
                            eq: jest.fn(() => ({
                                eq: jest.fn(() => ({
                                    order: jest.fn().mockResolvedValue({
                                        data: [
                                            { id: 'slot_1', slot_number: 1, status: 'available', client_code: 'C1', mac_address: 'AA', pppoe_name: 'pppoe1', assessment_type: 'test_engine', assessment_id: 'test_router' },
                                            { id: 'slot_2', slot_number: 2, status: 'offline', client_code: 'C2', mac_address: 'BB', pppoe_name: 'pppoe2', assessment_type: 'test_engine', assessment_id: 'test_router' }
                                        ],
                                        error: null
                                    })
                                }))
                            }))
                        })),
                        update: jest.fn(payload => {
                            updatePayloads.push(payload);
                            return {
                                eq: jest.fn(() => ({
                                    eq: jest.fn(() => ({
                                        select: jest.fn(() => ({
                                            maybeSingle: jest.fn().mockResolvedValue({
                                                data: { id: 'slot_1', slot_number: 1, client_code: 'C1', mac_address: 'AA', pppoe_name: 'pppoe1', assessment_type: 'test_engine', assessment_id: 'test_router', claimed_at: 'now' },
                                                error: null
                                            })
                                        }))
                                    }))
                                }))
                            };
                        })
                    };
                }
                throw new Error(`Unexpected table ${table}`);
            })
        };

        const claim = await window.DeviceAssessmentSessions.claimForAssessment({
            type: 'test_engine',
            id: 'test_router',
            title: 'Router Setup'
        });

        expect(claim.ok).toBe(true);
        expect(claim.required).toBe(true);
        expect(claim.session).toMatchObject({ slot: 1, clientCode: 'C1', macAddress: 'AA', pppoeName: 'pppoe1' });
        expect(updatePayloads[0]).toMatchObject({ status: 'in_use', claimed_by: 'Alice' });
    });
});
