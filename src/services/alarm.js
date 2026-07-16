const https = require('https');
const config = require('../config');

/**
 * Mengirimkan push notifikasi darurat gratis ke HP melalui ntfy.sh.
 * @param {string} type - Tipe kejadian ('REGISTER' atau 'ACCEPTED')
 * @param {string} details - Detail informasi kejadian
 */
function sendNtfyNotification(type, details) {
    if (!config.ntfyTopic) {
        console.log('[NTFY] Notifikasi tidak dikirim karena NTFY_TOPIC belum dikonfigurasi di .env');
        return;
    }

    const url = `https://ntfy.sh/${config.ntfyTopic}`;
    const message = `KARAJO OI`;

    const options = {
        method: 'POST',
        headers: {
            'Title': `SRAS Alert: ${type}`,
            'Priority': type === 'ACCEPTED' ? 'max' : 'high', // max memicu alarm bypass DND di ntfy app
            'Tags': type === 'ACCEPTED' ? 'rotating_light,alert' : 'bell,incoming_envelope',
            'Content-Type': 'text/plain; charset=utf-8'
        }
    };

    console.log(`[NTFY] Mengirimkan notifikasi push ke topik: ${config.ntfyTopic}...`);

    const req = https.request(url, options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
            console.log(`[NTFY] Notifikasi terkirim. Status: ${res.statusCode}.`);
        });
    });

    req.on('error', (e) => {
        console.error(`[NTFY] Gagal mengirim notifikasi ke HP: ${e.message}`);
    });

    req.write(message);
    req.end();
}

/**
 * Memicu alarm dengan mengirimkan push notifikasi ntfy.sh ke HP.
 * @param {string} type - Tipe kejadian ('REGISTER' untuk pendaftaran terkirim, 'ACCEPTED' untuk diterima)
 * @param {string} details - Informasi detail pendaftaran
 */
function triggerAlarm(type = 'REGISTER', details = 'Shift Baru') {
    console.log(`[ALARM] Memicu peringatan HP [${type}] untuk: ${details}`);

    // Kirim notifikasi ntfy ke HP Android Anda (Gratis selamanya)
    sendNtfyNotification(type, details);
}

module.exports = {
    triggerAlarm
};
