const eligibility = require('../src/services/eligibility');
const storeManager = require('../src/services/store');

// Mock modul storeManager agar tidak melakukan operasi baca/tulis file riil
jest.mock('../src/services/store');

describe('Eligibility Service Tests', () => {
    
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('harus mengizinkan pendaftaran jika status pengguna adalah NULL', () => {
        storeManager.readStore.mockReturnValue({
            status: 'NULL',
            lastShiftDate: null,
            registeredShiftId: null
        });

        const result = eligibility.checkEligibility('2026-07-16');
        expect(result.eligible).toBe(true);
        expect(result.reason).toContain('tidak memiliki pendaftaran aktif');
    });

    test('harus menolak pendaftaran jika status pengguna adalah ACCEPTED pada tanggal yang sama (BR-008)', () => {
        storeManager.readStore.mockReturnValue({
            status: 'ACCEPTED',
            lastShiftDate: '2026-07-16',
            registeredShiftId: 'Shift Pagi'
        });

        const result = eligibility.checkEligibility('2026-07-16');
        expect(result.eligible).toBe(false);
        expect(result.reason).toContain('BR-008');
    });

    test('harus mengizinkan pendaftaran jika status pengguna adalah ACCEPTED tetapi pada tanggal yang berbeda/kemarin (Reset otomatis)', () => {
        storeManager.readStore.mockReturnValue({
            status: 'ACCEPTED',
            lastShiftDate: '2026-07-15',
            registeredShiftId: 'Shift Kemarin'
        });

        const result = eligibility.checkEligibility('2026-07-16');
        expect(result.eligible).toBe(true);
        expect(result.reason).toContain('telah kedaluwarsa');
    });

    test('harus menolak pendaftaran jika status pengguna adalah WAITING_VERIFICATION pada tanggal yang sama (BR-010)', () => {
        storeManager.readStore.mockReturnValue({
            status: 'WAITING_VERIFICATION',
            lastShiftDate: '2026-07-16',
            registeredShiftId: 'Shift Pagi'
        });

        const result = eligibility.checkEligibility('2026-07-16');
        expect(result.eligible).toBe(false);
        expect(result.reason).toContain('BR-010');
    });

    test('harus mengizinkan pendaftaran jika status pengguna adalah REJECTED pada tanggal yang sama (BR-009)', () => {
        storeManager.readStore.mockReturnValue({
            status: 'REJECTED',
            lastShiftDate: '2026-07-16',
            registeredShiftId: 'Shift Pagi'
        });

        const result = eligibility.checkEligibility('2026-07-16');
        expect(result.eligible).toBe(true);
        expect(result.reason).toContain('BR-009');
    });
});
