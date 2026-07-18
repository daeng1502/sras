const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Memicu lampu senter berkedip (strobo) untuk alarm visual di Termux
 */
function strobeFlashlight(times = 8, intervalMs = 250) {
    let count = 0;
    function run() {
        if (count >= times) {
            exec('termux-torch off');
            return;
        }
        exec('termux-torch on', () => {
            setTimeout(() => {
                exec('termux-torch off', () => {
                    count++;
                    setTimeout(run, intervalMs);
                });
            }, intervalMs);
        });
    }
    run();
}

/**
 * Memicu getaran, suara Text-to-Speech, dan ringtone kencang secara lokal di HP Android Termux
 */
function triggerLocalAndroidAlarm(type) {
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

        const targetVolume = 150; // Menggunakan level 150 sesuai permintaan khusus untuk HP Anda
        console.log(`[LOCAL ALARM] Menaikkan volume media dari level ${originalVolume} ke ${targetVolume} (Maksimal)...`);
        
        // 1. Set volume media ke level 150 (Android akan mencocokkan ke level tertinggi perangkat Anda)
        exec(`termux-volume music ${targetVolume}`, () => {
            // 2. Getarkan HP selama 1.5 detik
            exec('termux-vibrate -d 1500');
            
            // Strobo senter visual untuk notifikasi kejadian
            if (type === 'ACCEPTED') {
                console.log('[LOCAL ALARM] Memicu strobo senter HP CEPAT (termux-torch)...');
                strobeFlashlight(8, 200); // 8 kali berkedip cepat (sukses diterima)
            } else if (type === 'REGISTER') {
                console.log('[LOCAL ALARM] Memicu strobo senter HP LAMBAT (termux-torch)...');
                strobeFlashlight(4, 500); // 4 kali berkedip lambat (pendaftaran terkirim)
            }
            
            // 3. HP berbicara langsung lewat Text-to-Speech (Dinamis sesuai tipe kejadian)
            let ttsText = 'Ada shift baru! Segera cek WhatsApp Anda.';
            if (type === 'ACCEPTED') {
                ttsText = 'Selamat! Pendaftaran shift Anda telah diterima.';
            }
            exec(`termux-tts-speak "${ttsText}"`);
            
            // 4. Putar nada dering alarm
            console.log('[LOCAL ALARM] Memutar nada dering alarm...');
            exec(`termux-media-player play "${alarmPath}"`);

            // Jeda 5 menit 26 detik agar nada dering berbunyi penuh, lalu hentikan media player dan kembalikan volume HP
            setTimeout(() => {
                console.log(`[LOCAL ALARM] Menghentikan nada dering dan mengembalikan volume media ke level semula: ${originalVolume}`);
                exec('termux-media-player stop');
                exec(`termux-volume music ${originalVolume}`);
            }, 326000); // Durasi alarm berbunyi: 5 menit 26 detik (326000 ms)
        });
    });
}

/**
 * Memicu alarm fisik lokal di Termux jika berjalan di lingkungan HP Android.
 * @param {string} type - Tipe kejadian ('REGISTER' untuk pendaftaran terkirim, 'ACCEPTED' untuk diterima)
 * @param {string} details - Informasi detail pendaftaran
 */
function triggerAlarm(type = 'REGISTER', details = 'Shift Baru') {
    console.log(`[ALARM] Memicu peringatan HP [${type}] untuk: ${details}`);

    // Jika bot berjalan di lingkungan Android Termux, picu alarm fisik & kontrol volume secara lokal
    const isAndroid = process.platform === 'android' || fs.existsSync('/data/data/com.termux');
    if (isAndroid) {
        triggerLocalAndroidAlarm(type);
    } else {
        console.log('[ALARM] (Lokal Non-Android) Membunyikan alarm di konsol laptop.');
    }
}

module.exports = {
    triggerAlarm
};
