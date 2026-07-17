const https = require('https');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
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
 * Memicu getaran, suara Text-to-Speech, dan ringtone kencang secara lokal di HP Android Termux
 */
function triggerLocalAndroidAlarm() {
    // Cari alarm.mp3 kustom terlebih dahulu, jika tidak ada gunakan default alarm.wav
    let alarmPath = path.join(__dirname, '../../assets/alarm.mp3');
    if (!fs.existsSync(alarmPath)) {
        alarmPath = path.join(__dirname, '../../assets/alarm.wav');
    }

    if (!fs.existsSync(alarmPath)) {
        console.log('[LOCAL ALARM] Berkas alarm tidak ditemukan.');
        return;
    }

    // Ambil volume musik media saat ini agar bisa dikembalikan ke keadaan semula nanti
    exec('termux-volume', (err, stdout, stderr) => {
        let originalVolume = 7; // nilai default aman
        try {
            if (!err && stdout) {
                const streams = JSON.parse(stdout);
                const musicStream = streams.find(s => s.stream === 'music');
                if (musicStream) {
                    originalVolume = musicStream.volume;
                }
            }
        } catch (e) {
            // Abaikan kegagalan parsing volume
        }

        console.log(`[LOCAL ALARM] Menaikkan volume media dari level ${originalVolume} ke 15 (Maksimal)...`);
        
        // 1. Set volume media ke maksimal (15)
        exec('termux-volume music 15', () => {
            // 2. Getarkan HP selama 1.5 detik
            exec('termux-vibrate -d 1500');
            
            // 3. HP berbicara langsung lewat Text-to-Speech
            exec('termux-tts-speak "Ada shift baru! Segera cek WhatsApp Anda."');
            
            // 4. Putar nada dering alarm.wav
            console.log('[LOCAL ALARM] Memutar nada dering alarm.wav...');
            exec(`termux-media-player play "${alarmPath}"`, () => {
                // 5. Kembalikan volume HP ke level awal setelah nada dering selesai berbunyi
                console.log(`[LOCAL ALARM] Nada dering selesai. Mengembalikan volume media ke level semula: ${originalVolume}`);
                exec(`termux-volume music ${originalVolume}`);
            });
        });
    });
}

/**
 * Memicu alarm dengan mengirimkan push notifikasi ntfy.sh ke HP dan membunyikan alarm fisik lokal di Termux.
 * @param {string} type - Tipe kejadian ('REGISTER' untuk pendaftaran terkirim, 'ACCEPTED' untuk diterima)
 * @param {string} details - Informasi detail pendaftaran
 */
function triggerAlarm(type = 'REGISTER', details = 'Shift Baru') {
    console.log(`[ALARM] Memicu peringatan HP [${type}] untuk: ${details}`);

    // 1. Kirim notifikasi ntfy online (sebagai cadangan)
    sendNtfyNotification(type, details);

    // 2. Jika bot berjalan di lingkungan Android Termux, picu alarm fisik & kontrol volume secara lokal
    const isAndroid = process.platform === 'android' || fs.existsSync('/data/data/com.termux');
    if (isAndroid) {
        triggerLocalAndroidAlarm();
    }
}

module.exports = {
    triggerAlarm
};
