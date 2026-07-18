const storeManager = require('./store');

/**
 * Memeriksa kelayakan pengguna untuk mendaftar shift baru.
 * @param {string} targetDate - Tanggal target pengecekan (default: hari ini, format YYYY-MM-DD)
 * @returns {Object} - { eligible: boolean, reason: string }
 */
function checkEligibility(userKey = 'user1', targetDate = null) {
    let actualUserKey = userKey;
    let actualTargetDate = targetDate;
    
    // Kompatibilitas mundur: jika argument pertama bukan 'user1' atau 'user2', asumsikan itu adalah targetDate
    if (userKey !== 'user1' && userKey !== 'user2') {
        actualUserKey = 'user1';
        actualTargetDate = userKey;
    }

    const store = storeManager.readStore();
    const today = actualTargetDate || new Date().toISOString().split('T')[0];
    const userState = store[actualUserKey] || {
        status: store.status || 'NULL',
        lastShiftDate: store.lastShiftDate || null,
        registeredShiftId: store.registeredShiftId || null
    };

    // Jika data tanggal status berbeda dengan tanggal hari ini, status lama dianggap kedaluwarsa (reset)
    if (userState.lastShiftDate && userState.lastShiftDate !== today) {
        return {
            eligible: true,
            reason: 'Eligible: Status hari sebelumnya telah kedaluwarsa.'
        };
    }

    switch (userState.status) {
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
