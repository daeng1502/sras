const storeManager = require('./store');

/**
 * Memeriksa kelayakan pengguna untuk mendaftar shift baru.
 * @param {string} targetDate - Tanggal target pengecekan (default: hari ini, format YYYY-MM-DD)
 * @returns {Object} - { eligible: boolean, reason: string }
 */
function checkEligibility(targetDate = null) {
    const store = storeManager.readStore();
    const today = targetDate || new Date().toISOString().split('T')[0];

    // Jika data tanggal status berbeda dengan tanggal hari ini, status lama dianggap kedaluwarsa (reset)
    if (store.lastShiftDate && store.lastShiftDate !== today) {
        return {
            eligible: true,
            reason: 'Eligible: Status hari sebelumnya telah kedaluwarsa.'
        };
    }

    switch (store.status) {
        case 'ACCEPTED':
            return {
                eligible: false,
                reason: `BR-008: Pengguna sudah DITERIMA (Accepted) untuk shift pada hari ini (${today}). Tidak boleh mengikuti shift lain.`
            };
        case 'WAITING_VERIFICATION':
            return {
                eligible: false,
                reason: `BR-010: Pengguna sedang MENUNGGU VERIFIKASI (Waiting Verification) pada hari ini (${today}). Tidak boleh mengikuti shift lain.`
            };
        case 'REJECTED':
            return {
                eligible: true,
                reason: `BR-009: Pendaftaran sebelumnya DITOLAK (Rejected) hari ini (${today}). Diperbolehkan mengikuti shift berikutnya.`
            };
        case 'NULL':
        default:
            return {
                eligible: true,
                reason: 'Eligible: Pengguna tidak memiliki pendaftaran aktif hari ini.'
            };
    }
}

module.exports = {
    checkEligibility
};
