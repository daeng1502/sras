const registrator = require('../src/services/registrator');
const eligibility = require('../src/services/eligibility');
const storeManager = require('../src/services/store');
const historyLogger = require('../src/services/history');
const config = require('../src/config');
const alarm = require('../src/services/alarm');

// Mock dependensi eksternal agar test terisolasi
jest.mock('../src/services/eligibility');
jest.mock('../src/services/store');
jest.mock('../src/services/history');
jest.mock('../src/services/alarm');

// Konfigurasi manual variabel untuk testing
config.userName = 'Budi Santoso';
config.userOptId = 'OPT-9982';

describe('Registrator Service Tests', () => {
    
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('harus menolak pendaftaran jika pengguna dinyatakan tidak layak oleh eligibility checker', () => {
        eligibility.checkEligibility.mockReturnValue({
            eligible: false,
            reason: 'BR-008: Sudah diterima untuk shift hari ini.'
        });

        const incomingText = `List Shift Pagi:\n1.\n2.`;
        const result = registrator.processRegistration(incomingText);

        expect(result.success).toBe(false);
        expect(result.message).toBe('BR-008: Sudah diterima untuk shift hari ini.');
        expect(result.replyText).toBeNull();
    });

    test('harus menolak pendaftaran jika nama pengguna sudah ada dalam daftar pesan (BR-007)', () => {
        eligibility.checkEligibility.mockReturnValue({
            eligible: true,
            reason: 'Eligible'
        });

        const incomingText = `List Shift Pagi:\n1. Budi Santoso - OPT-9982\n2.`;
        const result = registrator.processRegistration(incomingText);

        expect(result.success).toBe(false);
        expect(result.message).toContain('BR-007');
        expect(result.replyText).toBeNull();
    });

    test('harus berhasil memproses pendaftaran, menulis log, memicu alarm, dan memperbarui status menjadi WAITING_VERIFICATION', () => {
        eligibility.checkEligibility.mockReturnValue({
            eligible: true,
            reason: 'Eligible'
        });

        const incomingText = `List Shift Pagi:\n1. Ahmad - OPT-001\n2.`;
        const result = registrator.processRegistration(incomingText);

        expect(result.success).toBe(true);
        expect(result.replyText).toContain('2. Budi Santoso OPT-9982');
        
        // Memastikan alarm dipicu
        expect(alarm.triggerAlarm).toHaveBeenCalled();

        // Memastikan status diubah ke WAITING_VERIFICATION
        expect(storeManager.updateStatus).toHaveBeenCalledWith(
            'WAITING_VERIFICATION',
            'List Shift Pagi:',
            expect.any(String)
        );

        // Memastikan log ditulis ke riwayat
        expect(historyLogger.logEvent).toHaveBeenCalledWith(
            'REGISTER',
            expect.any(String)
        );
    });
});
