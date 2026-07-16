const storeManager = require('./store');
const historyLogger = require('./history');
const config = require('../config');
const alarm = require('./alarm');

/**
 * Memeriksa apakah pesan berisi hasil verifikasi/seleksi shift.
 * @param {string} text - Teks pesan
 * @returns {boolean}
 */
function isVerificationMessage(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase().trim();
    
    // Kata kunci penanda pengumuman hasil seleksi/verifikasi
    return lowerText === 'done' ||
           lowerText.startsWith('done ') ||
           lowerText.includes('hasil') || 
           lowerText.includes('verifikasi') || 
           lowerText.includes('seleksi') || 
           lowerText.includes('accepted') || 
           lowerText.includes('rejected') || 
           lowerText.includes('fix list') || 
           lowerText.includes('final list') ||
           lowerText.includes('acc list');
}

/**
 * Memproses pesan hasil seleksi dari admin dan memperbarui status pengguna.
 * @param {string} text - Teks pesan dari admin
 * @param {Array} cache - Larik cache pesan terakhir untuk pencarian context
 * @returns {Object} - { processed: boolean, status: string|null, reason: string }
 */
function processVerification(text, cache = null) {
    const store = storeManager.readStore();
    
    // Hanya memproses verifikasi jika status pengguna saat ini sedang menunggu verifikasi
    if (store.status !== 'WAITING_VERIFICATION') {
        return {
            processed: false,
            status: null,
            reason: 'Sistem mengabaikan pesan verifikasi karena pengguna tidak sedang dalam status WAITING_VERIFICATION.'
        };
    }

    if (!isVerificationMessage(text)) {
        return {
            processed: false,
            status: null,
            reason: 'Pesan bukan merupakan format pengumuman hasil verifikasi.'
        };
    }

    let textToAnalyze = text;
    const lowerText = text.toLowerCase().trim();
    
    // Cek apakah pesan hanyalah pesan konfirmasi "done" pendek tanpa daftar nama
    const isShortDone = lowerText === 'done' || (lowerText.startsWith('done') && text.length < 25 && !text.includes('1.'));

    if (isShortDone && cache && Array.isArray(cache)) {
        console.log('[VERIFIKASI] Mendeteksi pesan "done" pendek. Mencari daftar nama terakhir di cache lokal...');
        // Cari dari belakang cache untuk menemukan pesan list pendaftaran terakhir
        for (let i = cache.length - 1; i >= 0; i--) {
            const body = cache[i].body || '';
            if (body.includes('1.') || body.includes('2.')) {
                console.log('[VERIFIKASI] Menemukan daftar nama terakhir di cache lokal.');
                textToAnalyze = body;
                break;
            }
        }
    }

    const lowerTextToAnalyze = textToAnalyze.toLowerCase();
    const cleanUserName = config.userName.toLowerCase().trim();
    const cleanOptId = config.userOptId.toLowerCase().trim();

    let newStatus = null;
    let logMessage = '';

    // Pembagian teks berdasarkan label Accepted/Rejected jika ada
    const hasAcceptedSection = lowerTextToAnalyze.includes('accepted') || lowerTextToAnalyze.includes('lolos') || lowerTextToAnalyze.includes('diterima');
    const hasRejectedSection = lowerTextToAnalyze.includes('rejected') || lowerTextToAnalyze.includes('tidak lolos') || lowerTextToAnalyze.includes('ditolak') || lowerTextToAnalyze.includes('coret');

    // Cek keberadaan nama/ID pengguna di dalam teks yang dianalisis
    const isNameInText = lowerTextToAnalyze.includes(cleanUserName) || lowerTextToAnalyze.includes(cleanOptId);

    if (isNameInText) {
        if (hasAcceptedSection && hasRejectedSection) {
            // Teks memiliki kedua segmen. Kita cek nama kita ada di baris/bagian mana.
            const acceptedIdx = lowerTextToAnalyze.indexOf('accepted') !== -1 ? lowerTextToAnalyze.indexOf('accepted') : lowerTextToAnalyze.indexOf('lolos');
            const rejectedIdx = lowerTextToAnalyze.indexOf('rejected') !== -1 ? lowerTextToAnalyze.indexOf('rejected') : lowerTextToAnalyze.indexOf('rejected');
            const userIdx = lowerTextToAnalyze.indexOf(cleanUserName) !== -1 ? lowerTextToAnalyze.indexOf(cleanUserName) : lowerTextToAnalyze.indexOf(cleanOptId);

            if (userIdx > rejectedIdx && rejectedIdx > acceptedIdx) {
                newStatus = 'REJECTED';
                logMessage = 'Ditolak: Nama terdeteksi di segmen Rejected/Ditolak.';
            } else {
                newStatus = 'ACCEPTED';
                logMessage = 'Diterima: Nama terdeteksi di segmen Accepted/Lolos.';
            }
        } else {
            // Jika tidak ada pembagian segmen yang jelas tetapi nama tercantum, cek anotasi di baris nama
            const lines = textToAnalyze.split('\n');
            let matchedLine = '';
            for (let line of lines) {
                if (line.toLowerCase().includes(cleanUserName) || line.toLowerCase().includes(cleanOptId)) {
                    matchedLine = line.toLowerCase();
                    break;
                }
            }

            if (matchedLine.includes('rejected') || matchedLine.includes('ditolak') || matchedLine.includes('coret') || matchedLine.includes('cancel')) {
                newStatus = 'REJECTED';
                logMessage = 'Ditolak: Baris pendaftaran diberi label penolakan.';
            } else {
                newStatus = 'ACCEPTED';
                logMessage = 'Diterima: Nama tercantum dalam daftar terverifikasi.';
            }
        }
    } else {
        // Nama TIDAK ADA di dalam teks hasil verifikasi.
        if (isShortDone || lowerTextToAnalyze.includes('fix') || lowerTextToAnalyze.includes('final') || lowerTextToAnalyze.includes('hasil')) {
            newStatus = 'REJECTED';
            logMessage = 'Ditolak: Nama tidak terdaftar di pengumuman daftar final/fix list admin.';
        }
    }

    if (newStatus) {
        const todayStr = new Date().toISOString().split('T')[0];
        storeManager.updateStatus(newStatus, null, todayStr);
        
        // Memicu alarm suara jika pengguna telah resmi DITERIMA (ACCEPTED) kerja
        if (newStatus === 'ACCEPTED') {
            alarm.triggerAlarm('ACCEPTED', store.registeredShiftId || 'Shift Anda');
        }

        historyLogger.logEvent('VERIFY', `Verifikasi selesai: status diubah menjadi ${newStatus}. Detail: ${logMessage}`);
        return {
            processed: true,
            status: newStatus,
            reason: logMessage
        };
    }

    return {
        processed: false,
        status: null,
        reason: 'Nama pengguna tidak terdeteksi secara eksplisit dan format pengumuman tidak tergolong daftar final.'
    };
}

module.exports = {
    isVerificationMessage,
    processVerification
};
