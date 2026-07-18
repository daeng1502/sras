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
function processRegistration(incomingMessageText, userKey = 'user1') {
    // 1. Cek kelayakan pengguna berdasarkan state status saat ini
    const eligibilityCheck = eligibility.checkEligibility(userKey);
    if (!eligibilityCheck.eligible) {
        return {
            success: false,
            message: eligibilityCheck.reason,
            replyText: null
        };
    }

    const userCfg = config[userKey];
    if (!userCfg || !userCfg.name || !userCfg.optId) {
        return {
            success: false,
            message: `Konfigurasi akun [${userKey}] belum lengkap!`,
            replyText: null
        };
    }

    // 2. Cek apakah pengguna sudah terdaftar di daftar pesan tersebut
    const alreadyRegistered = parser.isUserAlreadyRegistered(
        incomingMessageText,
        userCfg.name,
        userCfg.optId
    );
    if (alreadyRegistered) {
        const shiftTitle = parser.extractShiftTitle(incomingMessageText);
        const todayStr = new Date().toISOString().split('T')[0];
        if (userKey === 'user1') {
            storeManager.updateStatus('WAITING_VERIFICATION', shiftTitle, todayStr);
        } else {
            storeManager.updateStatus(userKey, 'WAITING_VERIFICATION', shiftTitle, todayStr);
        }
        
        alarm.triggerAlarm('REGISTER', shiftTitle);
        historyLogger.logEvent('REGISTER', `[${userKey}] Nama sudah terdaftar pada shift "${shiftTitle}". Masuk ke status WAITING_VERIFICATION.`);

        return {
            success: true,
            message: 'Nama atau OPT ID Anda sudah terdaftar di dalam list chat grup ini. Mengaktifkan pemantauan verifikasi.',
            replyText: null
        };
    }

    // 3. Masukkan pengguna ke dalam template list admin
    const replyText = parser.registerUserInTemplate(
        incomingMessageText,
        userCfg.name,
        userCfg.optId
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
    if (userKey === 'user1') {
        storeManager.updateStatus('WAITING_VERIFICATION', shiftTitle, todayStr);
    } else {
        storeManager.updateStatus(userKey, 'WAITING_VERIFICATION', shiftTitle, todayStr);
    }

    // Memicu alarm suara laptop & webhook IFTTT HP secara fisik
    alarm.triggerAlarm('REGISTER', shiftTitle);

    // 5. Catat riwayat pendaftaran ke log history
    historyLogger.logEvent('REGISTER', `[${userKey}] Mendaftar pada shift "${shiftTitle}" dengan nomor urut baru.`);

    return {
        success: true,
        message: `Berhasil memproses pendaftaran untuk shift "${shiftTitle}".`,
        replyText: replyText
    };
}

module.exports = {
    processRegistration
};
