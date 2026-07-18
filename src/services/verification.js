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
 * @param {string|null} quotedText - Teks pesan yang direply oleh admin
 * @returns {Object} - { processed: boolean, status: string|null, reason: string }
 */
function processVerification(text, cache = null, quotedText = null) {
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

    const cleanUserName = config.userName.toLowerCase().trim();
    const cleanOptId = config.userOptId.toLowerCase().trim();

    let textToAnalyze = text;
    const lowerText = text.toLowerCase().trim();
    
    // Cek apakah pesan hanyalah pesan konfirmasi "done" pendek tanpa daftar nama
    const isShortDone = lowerText === 'done' || (lowerText.startsWith('done') && text.length < 25 && !text.includes('1.'));

    if (isShortDone) {
        let foundNameInQuoted = false;
        if (quotedText) {
            historyLogger.logEvent('VERIFY-DEBUG', 'Mendeteksi pesan "done" pendek dengan reply. Menganalisis pesan yang di-reply...');
            const lowerQuoted = quotedText.toLowerCase();
            if (lowerQuoted.includes(cleanUserName) || lowerQuoted.includes(cleanOptId)) {
                textToAnalyze = quotedText;
                foundNameInQuoted = true;
                historyLogger.logEvent('VERIFY-DEBUG', 'Nama pengguna ditemukan di dalam pesan reply.');
            } else {
                historyLogger.logEvent('VERIFY-DEBUG', 'Nama pengguna tidak ditemukan di dalam pesan reply. Melakukan fallback ke pencarian cache...');
            }
        }

        if (!foundNameInQuoted && cache && Array.isArray(cache)) {
            if (!quotedText) {
                historyLogger.logEvent('VERIFY-DEBUG', 'Mendeteksi pesan "done" pendek tanpa reply. Mencari daftar nama terakhir di cache lokal...');
            }
            historyLogger.logEvent('VERIFY-DEBUG', `Cache length: ${cache.length}`);
            const cacheBodies = cache.map((c, idx) => `[${idx}]: "${c.body.replace(/\n/g, ' ').slice(0, 60)}..."`).join(' | ');
            historyLogger.logEvent('VERIFY-DEBUG', `Cache items: ${cacheBodies}`);
            historyLogger.logEvent('DEBUG-CACHE', `Cache length: ${cache.length} | Items: ${cacheBodies}`);
            // Cari dari belakang cache untuk menemukan pesan list pendaftaran terakhir
            for (let i = cache.length - 1; i >= 0; i--) {
                const body = cache[i].body || '';
                const isProbablyList = /^\s*[-*•+\d+.]\s*/m.test(body) || 
                                       body.toLowerCase().includes('team') || 
                                       body.toLowerCase().includes(cleanUserName) || 
                                       body.toLowerCase().includes(cleanOptId);
                if (isProbablyList) {
                    historyLogger.logEvent('VERIFY-DEBUG', 'Menemukan daftar nama terakhir di cache lokal.');
                    textToAnalyze = body;
                    break;
                }
            }
        }
    }

    const lowerTextToAnalyze = textToAnalyze.toLowerCase();

    historyLogger.logEvent('VERIFY-DEBUG', `Teks analisis (panjang: ${textToAnalyze.length}): ${textToAnalyze.replace(/\n/g, ' ')}`);
    historyLogger.logEvent('VERIFY-DEBUG', `Mencari username: "${cleanUserName}" | OPT ID: "${cleanOptId}"`);



    let newStatus = null;
    let logMessage = '';

    // Pembagian teks berdasarkan label Accepted/Rejected jika ada
    const hasAcceptedSection = lowerTextToAnalyze.includes('accepted') || lowerTextToAnalyze.includes('lolos') || lowerTextToAnalyze.includes('diterima');
    const hasRejectedSection = lowerTextToAnalyze.includes('rejected') || lowerTextToAnalyze.includes('tidak lolos') || lowerTextToAnalyze.includes('ditolak') || lowerTextToAnalyze.includes('coret');

    // Cek keberadaan nama/ID pengguna di dalam teks yang dianalisis
    const isNameInText = lowerTextToAnalyze.includes(cleanUserName) || lowerTextToAnalyze.includes(cleanOptId);
    historyLogger.logEvent('VERIFY-DEBUG', `Hasil pencarian nama: ${isNameInText}`);


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

        historyLogger.logEvent('VERIFY', `Verifikasi selesai: status diubah menjadi ${newStatus}. Detail: ${logMessage} (Analisis textToAnalyze: "${textToAnalyze.replace(/\n/g, ' ')}", userName: "${cleanUserName}", optId: "${cleanOptId}", isNameInText: ${isNameInText})`);
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
