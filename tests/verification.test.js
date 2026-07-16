const verification = require('../src/services/verification');
const storeManager = require('../src/services/store');
const historyLogger = require('../src/services/history');
const config = require('../src/config');
const alarm = require('../src/services/alarm');

// Mock dependensi eksternal
jest.mock('../src/services/store');
jest.mock('../src/services/history');
jest.mock('../src/services/alarm');

config.userName = 'Budi Santoso';
config.userOptId = 'OPT-9982';

describe('Verification Service Tests', () => {

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('isVerificationMessage', () => {
        test('harus mendeteksi pesan pengumuman verifikasi', () => {
            expect(verification.isVerificationMessage('Hasil Seleksi Shift Pagi')).toBe(true);
            expect(verification.isVerificationMessage('Fix List Pekerja Shift Malam')).toBe(true);
            expect(verification.isVerificationMessage('Berikut daftar accepted hari ini')).toBe(true);
            expect(verification.isVerificationMessage('done')).toBe(true);
            expect(verification.isVerificationMessage('done team')).toBe(true);
        });

        test('harus mengabaikan pesan biasa', () => {
            expect(verification.isVerificationMessage('Daftar Shift Pagi dibuka sekarang. Silakan isi.')).toBe(false);
        });
    });

    describe('processVerification', () => {
        test('harus mengabaikan verifikasi jika status pengguna bukan WAITING_VERIFICATION', () => {
            storeManager.readStore.mockReturnValue({ status: 'NULL' });
            
            const result = verification.processVerification('Hasil Seleksi:\nAccepted:\n1. Budi Santoso - OPT-9982');
            expect(result.processed).toBe(false);
            expect(result.reason).toContain('tidak sedang dalam status WAITING_VERIFICATION');
        });

        test('harus mendeteksi status ACCEPTED jika nama ada di segmen Accepted', () => {
            storeManager.readStore.mockReturnValue({ status: 'WAITING_VERIFICATION' });

            const msg = 'Hasil Seleksi:\nACCEPTED:\n1. Ahmad\n2. Budi Santoso - OPT-9982\n\nREJECTED:\n1. Candra';
            const result = verification.processVerification(msg);

            expect(result.processed).toBe(true);
            expect(result.status).toBe('ACCEPTED');
            expect(alarm.triggerAlarm).toHaveBeenCalled();
            expect(storeManager.updateStatus).toHaveBeenCalledWith('ACCEPTED', null, expect.any(String));
        });

        test('harus mendeteksi status REJECTED jika nama ada di segmen Rejected', () => {
            storeManager.readStore.mockReturnValue({ status: 'WAITING_VERIFICATION' });

            const msg = 'Hasil Seleksi:\nACCEPTED:\n1. Ahmad\n\nREJECTED:\n1. Budi Santoso - OPT-9982';
            const result = verification.processVerification(msg);

            expect(result.processed).toBe(true);
            expect(result.status).toBe('REJECTED');
            expect(storeManager.updateStatus).toHaveBeenCalledWith('REJECTED', null, expect.any(String));
        });

        test('harus mendeteksi status REJECTED jika nama TIDAK ADA di final fix list', () => {
            storeManager.readStore.mockReturnValue({ status: 'WAITING_VERIFICATION' });

            const msg = 'Daftar Fix List Shift Malam:\n1. Ahmad - OPT-001\n2. Candra - OPT-003';
            const result = verification.processVerification(msg);

            expect(result.processed).toBe(true);
            expect(result.status).toBe('REJECTED');
            expect(storeManager.updateStatus).toHaveBeenCalledWith('REJECTED', null, expect.any(String));
        });

        test('harus mencari di cache lokal dan menandai ACCEPTED jika pesan "done" pendek diterima dan nama kita ada di chat list sebelumnya', () => {
            storeManager.readStore.mockReturnValue({ status: 'WAITING_VERIFICATION' });

            // Mock cache lokal grup (larik pesan terakhir)
            const mockCache = [
                { body: 'Pesan biasa lain' },
                { body: 'Dear Team, provide DW SOC...\n1. Ahmad\n2. Budi Santoso OPT-9982' }
            ];

            const result = verification.processVerification('done', mockCache);

            expect(result.processed).toBe(true);
            expect(result.status).toBe('ACCEPTED');
            expect(alarm.triggerAlarm).toHaveBeenCalled();
            expect(storeManager.updateStatus).toHaveBeenCalledWith('ACCEPTED', null, expect.any(String));
        });

        test('harus mencari di cache lokal dan menandai REJECTED jika pesan "done" pendek diterima tetapi nama kita TIDAK ada di chat list sebelumnya', () => {
            storeManager.readStore.mockReturnValue({ status: 'WAITING_VERIFICATION' });

            const mockCache = [
                { body: 'Pesan biasa lain' },
                { body: 'Dear Team, provide DW SOC...\n1. Ahmad\n2. Andi 12345' }
            ];

            const result = verification.processVerification('done', mockCache);

            expect(result.processed).toBe(true);
            expect(result.status).toBe('REJECTED');
            expect(storeManager.updateStatus).toHaveBeenCalledWith('REJECTED', null, expect.any(String));
        });
    });
});
