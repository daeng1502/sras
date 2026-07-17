const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

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
        let maxVolume = 15; // nilai default aman jika parsing gagal
        try {
            if (!err && stdout) {
                const streams = JSON.parse(stdout);
                const musicStream = streams.find(s => s.stream === 'music');
                if (musicStream) {
                    originalVolume = musicStream.volume;
                    if (musicStream.max_volume) {
                        maxVolume = musicStream.max_volume;
                    }
                }
            }
        } catch (e) {
            // Abaikan kegagalan parsing volume
        }

        console.log(`[LOCAL ALARM] Menaikkan volume media dari level ${originalVolume} ke ${maxVolume} (Maksimal)...`);
        
        // 1. Set volume media ke maksimal dinamis sesuai perangkat HP Anda
        exec(`termux-volume music ${maxVolume}`, () => {
            // 2. Getarkan HP selama 1.5 detik
            exec('termux-vibrate -d 1500');
            
            // 3. HP berbicara langsung lewat Text-to-Speech
            exec('termux-tts-speak "Ada shift baru! Segera cek WhatsApp Anda."');
            
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
        triggerLocalAndroidAlarm();
    } else {
        console.log('[ALARM] (Lokal Non-Android) Membunyikan alarm di konsol laptop.');
    }
}

module.exports = {
    triggerAlarm
};
