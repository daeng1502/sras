const config = require('../config');
const eligibility = require('./eligibility');
const parser = require('./parser');
const storeManager = require('./store');
const historyLogger = require('./history');
const alarm = require('./alarm');

/**
 * Memproses pesan pembukaan shift dan menghasilkan teks pendaftaran baru jika layak.
 * @param {string} incomingMessageText - Pesan asli berisi daftar dari admin
 * @returns {Object} - { success: boolean, message: string, replyText: string|null }
 */
function processRegistration(incomingMessageText) {
    // 1. Cek kelayakan pengguna berdasarkan state status saat ini
    const eligibilityCheck = eligibility.checkEligibility();
    if (!eligibilityCheck.eligible) {
        return {
            success: false,
            message: eligibilityCheck.reason,
            replyText: null
        };
    }

    // 2. Cek apakah pengguna sudah terdaftar di daftar pesan tersebut
    const alreadyRegistered = parser.isUserAlreadyRegistered(
        incomingMessageText,
        config.userName,
        config.userOptId
    );
    if (alreadyRegistered) {
        return {
            success: false,
            message: 'BR-007: Nama atau OPT ID pengguna sudah terdaftar di dalam list chat grup ini.',
            replyText: null
        };
    }

    // 3. Masukkan pengguna ke dalam template list admin
    const replyText = parser.registerUserInTemplate(
        incomingMessageText,
        config.userName,
        config.userOptId
    );

    if (!replyText) {
        return {
            success: false,
            message: 'Gagal memasukkan nama pengguna ke dalam template pendaftaran.',
            replyText: null
        };
    }

    // 4. Sukses! Update status kelayakan di database lokal menjadi WAITING_VERIFICATION
    const shiftTitle = parser.extractShiftTitle(incomingMessageText);
    const todayStr = new Date().toISOString().split('T')[0];
    storeManager.updateStatus('WAITING_VERIFICATION', shiftTitle, todayStr);

    // Memicu alarm suara laptop & webhook IFTTT HP secara fisik
    alarm.triggerAlarm('REGISTER', shiftTitle);

    // 5. Catat riwayat pendaftaran ke log history
    historyLogger.logEvent('REGISTER', `Mendaftar pada shift "${shiftTitle}" dengan nomor urut baru.`);

    return {
        success: true,
        message: `Berhasil memproses pendaftaran untuk shift "${shiftTitle}".`,
        replyText: replyText
    };
}

module.exports = {
    processRegistration
};
