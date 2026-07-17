const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const parser = require('./services/parser');
const registrator = require('./services/registrator');
const verification = require('./services/verification');
const historyLogger = require('./services/history');
const storeManager = require('./services/store');

/**
 * Mendeteksi lokasi Chromium secara otomatis di lingkungan Android Termux
 */
function getTermuxChromiumPath() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    
    // Path standar Chromium di Android Termux
    const termuxPaths = [
        '/data/data/com.termux/files/usr/bin/chromium-browser',
        '/data/data/com.termux/files/usr/bin/chromium'
    ];
    for (const path of termuxPaths) {
        if (fs.existsSync(path)) {
            return path;
        }
    }
    
    return undefined;
}

const chromiumPath = getTermuxChromiumPath();
if (chromiumPath) {
    console.log(`[SYSTEM] Terdeteksi Chromium Termux di: "${chromiumPath}"`);
}

// Inisialisasi WhatsApp Client dengan autentikasi lokal & remote cache version
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './.wwebjs_auth'
    }),
    webVersion: '2.2412.54',
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html'
    },
    puppeteer: {
        executablePath: chromiumPath,
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// Event ketika QR Code didapatkan untuk dipindai
client.on('qr', async (qr) => {
    // Jika nomor HP dikonfigurasi di .env, gunakan Pairing Code
    if (config.userHp) {
        console.log(`\n[LINKING] Meminta kode penautan untuk nomor HP: ${config.userHp}...`);
        try {
            const code = await client.requestPairingCode(config.userHp);
            console.log(`\n========================================`);
            console.log(`   KODE PENAUTAN WHATSAPP: ${code.slice(0, 4)}-${code.slice(4)}`);
            console.log(`========================================`);
            console.log(`Silakan buka WhatsApp di HP Anda:`);
            console.log(`1. Buka Perangkat Tertaut (Linked Devices).`);
            console.log(`2. Ketuk "Tautkan dengan nomor telepon" (Link with phone number).`);
            console.log(`3. Masukkan kode di atas.`);
            console.log(`========================================\n`);
        } catch (err) {
            console.error('[ERROR] Gagal meminta kode penautan:', err);
            // Fallback ke QR jika request pairing code gagal
            qrcode.generate(qr, { small: true });
        }
    } else {
        // Tampilkan QR Code jika USER_HP tidak diisi
        console.log('\n[QR] QR Code terdeteksi! Silakan pindai menggunakan WhatsApp HP Anda:');
        qrcode.generate(qr, { small: true });
    }
});

// Event ketika otentikasi berhasil
client.on('authenticated', () => {
    console.log('[AUTH] Autentikasi berhasil!');
});

client.on('auth_failure', (msg) => {
    console.error('[AUTH] Otentikasi gagal:', msg);
    historyLogger.logEvent('ERROR', `Autentikasi gagal: ${msg}`);
});

// Variabel state lokal (menghindari pemanggilan getChat / getChats CDP Puppeteer yang rawan bug 'r')
let targetGroupJid = null;
const groupMessageCache = {};
let isAutoSendEnabled = true;
let targetGroupAdmins = []; // Daftar admin grup target yang dimuat secara otomatis dari WhatsApp

/**
 * Memperbarui daftar admin grup target dari data peserta obrolan secara dinamis langsung dari server WhatsApp
 */
async function refreshGroupAdmins(chatId) {
    try {
        console.log('[DIAGNOSTIK] Meminta data detail grup segar langsung dari server WhatsApp...');
        const activeChat = await client.getChatById(chatId);

        if (activeChat.isGroup && activeChat.participants) {
            console.log(`[DIAGNOSTIK] Jumlah total anggota di grup target: ${activeChat.participants.length}`);
            
            if (activeChat.participants.length > 0) {
                console.log(`[DIAGNOSTIK] Raw data peserta pertama: ${JSON.stringify(activeChat.participants[0])}`);
            }

            targetGroupAdmins = activeChat.participants
                .filter(p => p.isAdmin || p.isSuperAdmin || p.role === 'admin' || p.role === 'creator')
                .map(p => p.id._serialized);
            
            console.log(`[SYSTEM] Berhasil memperbarui daftar admin grup target secara otomatis. Ditemukan ${targetGroupAdmins.length} admin.`);
            
            const sampleAdmins = targetGroupAdmins.map(a => a.split('@')[0]);
            console.log(`[DIAGNOSTIK] Daftar JID Admin terdeteksi: [${sampleAdmins.join(', ')}]`);
        } else {
            console.log('[DIAGNOSTIK] Gagal membaca list participants grup target (Bernilai kosong/undefined).');
        }
    } catch (err) {
        console.error('[ERROR] Gagal memperbarui daftar admin grup target:', err.message);
    }
}

// Event ketika client siap menerima pesan
client.on('ready', async () => {
    console.log('\n[READY] WhatsApp Client siap dan aktif!');
    historyLogger.logEvent('SYSTEM', 'Bot terhubung dan siap.');

    console.log('\n==================================================');
    console.log('          MEMULAI MONITORING SHIFT');
    console.log('==================================================');
    console.log(`Pengguna: ${config.userName} (${config.userOptId})`);
    console.log(`Grup Target: ${config.targetGroupName}`);
    console.log('Daftar Admin: (Akan dideteksi secara otomatis dari grup target)');

    const answer = await askQuestion('\n[INPUT] Masukkan kata kunci shift target (contoh: 11.00 atau malam, tekan ENTER untuk memantau semua): ');
    const inputKeywords = answer.trim()
        .split(',')
        .map(kw => kw.trim().toLowerCase())
        .filter(kw => kw.length > 0);

    if (inputKeywords.length > 0) {
        config.targetShiftKeywords = inputKeywords;
        console.log(`[INFO] Bot dikonfigurasi untuk HANYA menargetkan shift dengan kata kunci: "${inputKeywords.join(', ')}"`);
    } else {
        config.targetShiftKeywords = [];
        console.log('[INFO] Bot dikonfigurasi untuk memantau SEMUA shift (Tanpa filter spesifik).');
    }

    const autoSendAns = await askQuestion('\n[INPUT] Apakah ingin mengaktifkan Kirim Chat Otomatis? (y/N): ');
    const cleanAutoSend = autoSendAns.trim().toLowerCase();
    if (cleanAutoSend === 'y' || cleanAutoSend === 'yes') {
        isAutoSendEnabled = true;
        console.log('[INFO] MODE OTOMATIS aktif. Bot akan membunyikan alarm dan mengirim chat otomatis ke grup.');
    } else {
        isAutoSendEnabled = false;
        console.log('[INFO] MODE PANTAU SAJA aktif. Bot hanya akan membunyikan alarm tanpa mengirim chat otomatis.');
    }

    console.log(`\n[SYSTEM] Menunggu pesan lowongan dari Admin di grup target "${config.targetGroupName}"...`);
    historyLogger.logEvent('SYSTEM', 'Bot mulai memantau grup.');
});

// Mendengarkan pesan masuk
client.on('message', async (msg) => {
    try {
        // 1. Validasi apakah pesan berasal dari grup (Offline & cepat)
        if (!msg.from.endsWith('@g.us')) return;

        console.log(`[DIAGNOSTIK] Menerima pesan di grup JID: "${msg.from}" | Pengirim: "${msg.author}" | Isi: "${msg.body.replace(/\n/g, ' ').slice(0, 60)}..."`);

        // Inisialisasi cache lokal untuk grup ini jika belum ada
        if (!groupMessageCache[msg.from]) {
            groupMessageCache[msg.from] = [];
        }
        
        // Simpan pesan ke cache lokal grup (untuk sinkronisasi & verifikasi)
        const cache = groupMessageCache[msg.from];
        cache.push({
            body: msg.body,
            author: msg.author,
            id: msg.id._serialized,
            timestamp: Date.now()
        });
        if (cache.length > 10) cache.shift(); // Batasi cache hingga 10 pesan terakhir

        // 2. Deteksi otomatis Target Group JID & admin jika belum teridentifikasi
        if (!targetGroupJid) {
            try {
                const chat = await msg.getChat();
                if (chat.isGroup && chat.name.toLowerCase().includes(config.targetGroupName.toLowerCase())) {
                    targetGroupJid = msg.from;
                    console.log(`[SYSTEM] Target grup terdeteksi secara otomatis dan terverifikasi! JID: "${targetGroupJid}"`);
                    await refreshGroupAdmins(msg.from);
                }
            } catch (err) {
                // Abaikan jika getChat gagal di awal
            }
        }

        // Jika JID sudah terkunci tetapi admin list masih kosong, muat ulang admin list
        if (msg.from === targetGroupJid && targetGroupAdmins.length === 0) {
            try {
                await refreshGroupAdmins(msg.from);
            } catch (err) {}
        }

        // 3. Deteksi apakah pengirim adalah salah satu admin yang dipantau (dinamis & fleksibel terhadap suffix @c.us / @lid)
        const senderId = msg.author;
        const senderNumber = senderId ? senderId.split('@')[0] : '';
        const isFromMonitoredAdmin = targetGroupAdmins.some(adminJid => {
            const adminNumber = adminJid.split('@')[0];
            return adminNumber === senderNumber;
        });

        // CETAK LOG PEMBANTU DIAGNOSTIK
        if (isFromMonitoredAdmin) {
            console.log(`[DIAGNOSTIK] Pengirim cocok sebagai Admin yang dipantau! (${senderId})`);
        } else {
            const isPotentialShift = parser.isShiftOpening(msg.body);
            if (isPotentialShift) {
                console.log(`[DIAGNOSTIK] Deteksi pesan pembukaan shift, tapi diabaikan karena pengirim (${senderId}) bukan Admin grup target ini.`);
            }
        }

        // Pastikan pesan berasal dari grup target yang sudah terdeteksi
        if (!targetGroupJid || msg.from !== targetGroupJid) {
            if (isFromMonitoredAdmin && parser.isShiftOpening(msg.body)) {
                console.log(`[DIAGNOSTIK] Pesan shift diabaikan karena targetGroupJid belum terkunci atau berbeda (targetGroupJid saat ini: ${targetGroupJid || 'belum terkunci'}).`);
            }
            return;
        }

        // Pastikan pengirim adalah Admin
        if (!isFromMonitoredAdmin) return;

        const messageText = msg.body;
        console.log(`\n[MSG] Menerima pesan baru dari admin (${senderId}) di grup target`);

        // 4. Deteksi Pembukaan Shift Kerja Baru
        if (parser.isShiftOpening(messageText)) {
            console.log('[DETEKSI] Pesan pembukaan shift baru teridentifikasi!');
            
            const regResult = registrator.processRegistration(messageText);
            
            if (regResult.success) {
                console.log(`[SUKSES] ${regResult.message}`);
                
                try {
                    // Pemicu status "Sedang Mengetik..." di grup WA secara instan untuk kamuflase alami
                    const chat = await msg.getChat();
                    await chat.sendStateTyping();
                } catch (err) {
                    // Diabaikan secara aman jika getChat() memicu error
                }

                // Mengatur jeda yang sangat cepat namun tetap aman (1.0 s.d 1.8 detik)
                const competitiveDelayMs = Math.floor(Math.random() * (1800 - 1000 + 1)) + 1000;
                console.log(`[JEDA] Mengetik selama ${competitiveDelayMs / 1000} detik sebelum mengirim...`);
                await new Promise(resolve => setTimeout(resolve, competitiveDelayMs));

                // SINKRONISASI DETIK TERAKHIR (Anti-Race Condition) menggunakan cache lokal
                let textToSend = regResult.replyText;
                if (cache.length > 0) {
                    // Cari pesan terakhir sebelum kita mengirim (pesan di index terakhir atau sebelum terakhir jika index terakhir adalah pesan kita sendiri)
                    let lastCachedMsg = null;
                    for (let i = cache.length - 1; i >= 0; i--) {
                        if (cache[i].id !== msg.id._serialized) {
                            lastCachedMsg = cache[i];
                            break;
                        }
                    }

                    if (lastCachedMsg && parser.isShiftOpening(lastCachedMsg.body)) {
                        console.log('[SINKRONISASI] Mendeteksi pendaftar lain mengirimkan list selama jeda (via cache local). Melakukan sinkronisasi ulang...');
                        
                        // Batalkan jika ternyata nama kita sudah dimasukkan oleh orang lain
                        if (parser.isUserAlreadyRegistered(lastCachedMsg.body, config.userName, config.userOptId)) {
                            console.log('[ABAI] Nama pengguna sudah didaftarkan oleh pendaftar lain.');
                            return;
                        }

                        // Susun ulang teks pendaftaran berdasarkan pesan terbaru tersebut
                        const syncReplyText = parser.registerUserInTemplate(lastCachedMsg.body, config.userName, config.userOptId);
                        if (syncReplyText) {
                            textToSend = syncReplyText;
                        }
                    }
                }

                // Kirim pesan pendaftaran otomatis jika mode otomatis aktif
                if (isAutoSendEnabled) {
                    // Balas pesan ke grup secara otomatis dengan template terisi (BR-004 & BR-006)
                    await client.sendMessage(msg.from, textToSend);
                    console.log('[KIRIM] Berhasil mengirimkan daftar pendaftaran terbaru ke grup.');
                } else {
                    console.log('[INFO] MODE PANTAU SAJA aktif. Chat otomatis tidak dikirim ke grup.');
                }
            } else {
                console.log(`[ABAI] ${regResult.message}`);
                historyLogger.logEvent('SKIP', `Pendaftaran dilewati karena: ${regResult.message}`);
            }
            return;
        }

        // 5. Deteksi Pengumuman Hasil Verifikasi/Seleksi Admin
        if (verification.isVerificationMessage(messageText)) {
            console.log('[DETEKSI] Pesan hasil verifikasi/seleksi teridentifikasi!');
            
            // Proses verifikasi secara sinkron menggunakan cache lokal (bebas dari getChat)
            const verResult = verification.processVerification(messageText, cache);
            
            if (verResult.processed) {
                console.log(`[VERIFIKASI] Status terupdate menjadi: ${verResult.status}. Alasan: ${verResult.reason}`);
            } else {
                console.log(`[ABAI] ${verResult.reason}`);
            }
            return;
        }

    } catch (error) {
        console.error('[ERROR] Terjadi kesalahan dalam memproses pesan:', error);
        historyLogger.logEvent('ERROR', `Kesalahan runtime: ${error.message}`);
    }
});

// Menangani crash/error tak terduga agar bot tetap tangguh
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    historyLogger.logEvent('ERROR', `Unhandled Rejection: ${reason}`);
});

/**
 * Membaca input dari terminal menggunakan modul readline secara asinkron
 */
function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise((resolve) => {
        rl.question(query, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

/**
 * Menyimpan nilai konfigurasi secara dinamis ke berkas .env
 */
function saveToEnv(key, value) {
    const envPath = path.join(__dirname, '../.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
    }

    // Pembersihan nomor HP agar fleksibel (bisa 08 atau 628)
    let processedValue = value;
    if (key === 'USER_HP') {
        processedValue = processedValue.replace(/[^0-9]/g, '');
        if (processedValue.startsWith('0')) {
            processedValue = '62' + processedValue.slice(1);
        }
    }

    const lines = envContent.split('\n');
    let found = false;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith(`${key}=`)) {
            lines[i] = `${key}="${processedValue}"`;
            found = true;
            break;
        }
    }

    if (!found) {
        lines.push(`${key}="${processedValue}"`);
    }

    fs.writeFileSync(envPath, lines.join('\n'), 'utf8');
    
    // Sinkronisasi nilai ke variabel RAM konfigurasi secara instan
    if (key === 'USER_NAME') config.userName = processedValue;
    else if (key === 'USER_OPT_ID') config.userOptId = processedValue;
    else if (key === 'USER_HP') config.userHp = processedValue;
    else if (key === 'TARGET_GROUP_NAME') config.targetGroupName = processedValue;

}

/**
 * Menghapus sesi autentikasi lokal WhatsApp Web (Logout)
 */
function logoutWhatsApp() {
    const authPath = path.join(__dirname, '../.wwebjs_auth');
    if (fs.existsSync(authPath)) {
        fs.rmSync(authPath, { recursive: true, force: true });
        console.log('\n[SUKSES] Sesi WhatsApp lokal berhasil dihapus (Logout sukses).');
    } else {
        console.log('\n[INFO] Sesi WhatsApp memang belum terdaftar.');
    }
}

/**
 * Menampilkan sub-menu pengaturan konfigurasi (.env)
 */
async function showConfigMenu() {
    while (true) {
        console.clear();
        console.log('\n==================================================');
        console.log('              SUB-MENU PENGATURAN BOT');
        console.log('==================================================');
        console.log(`1. Ubah Nama Pengguna    [${config.userName || '(Kosong)'}]`);
        console.log(`2. Ubah OPT ID           [${config.userOptId || '(Kosong)'}]`);
        console.log(`3. Ubah Nomor HP Anda    [${config.userHp || '(Kosong)'}]`);
        console.log(`4. Ubah Nama Grup WA     [${config.targetGroupName || '(Kosong)'}]`);
        console.log('5. Kembali ke Menu Utama');
        console.log('==================================================');

        const choice = await askQuestion('Pilih setelan yang ingin diubah (1-5): ');
        const trimmed = choice.trim();

        if (trimmed === '5') {
            break;
        }

        let key = '';
        let promptText = '';

        switch (trimmed) {
            case '1':
                key = 'USER_NAME';
                promptText = `Masukkan Nama Pengguna baru [Saat ini: ${config.userName}]: `;
                break;
            case '2':
                key = 'USER_OPT_ID';
                promptText = `Masukkan OPT ID baru [Saat ini: ${config.userOptId}]: `;
                break;
            case '3':
                key = 'USER_HP';
                promptText = `Masukkan Nomor HP Anda (untuk Pairing Code) [Saat ini: ${config.userHp}]: `;
                break;
            case '4':
                key = 'TARGET_GROUP_NAME';
                promptText = `Masukkan Nama Grup WA Target [Saat ini: ${config.targetGroupName}]: `;
                break;
            default:
                console.log('[ERROR] Pilihan tidak valid.');
                await askQuestion('\nTekan ENTER untuk melanjutkan...');
                continue;
        }

        const newValue = await askQuestion(promptText);
        saveToEnv(key, newValue.trim());
        console.log(`\n[SUKSES] Konfigurasi ${key} berhasil diperbarui.`);
        await askQuestion('\nTekan ENTER untuk kembali ke Sub-Menu...');
    }
}

/**
 * Alur utama inisialisasi sistem dengan menu dasbor utama
 */
async function startSystem() {
    while (true) {
        console.clear();
        console.log('\n==================================================');
        console.log('        MENU UTAMA BOT REGISTRASI SHIFT (SRAS)');
        console.log('==================================================');
        console.log('1. Mulai Monitoring & Otomasi');
        console.log('2. Atur Profil & Konfigurasi (.env)');
        console.log('3. Reset Status Harian (Uji Coba Ulang)');
        console.log('4. Logout WhatsApp (Hapus Sesi)');
        console.log('5. Keluar');
        console.log('==================================================');

        const choice = await askQuestion('Pilih Menu (1-5): ');
        const trimmed = choice.trim();

        if (trimmed === '5') {
            console.log('[SYSTEM] Keluar dari program. Sampai jumpa!');
            process.exit(0);
        } else if (trimmed === '4') {
            logoutWhatsApp();
            await askQuestion('\nTekan ENTER untuk kembali ke Menu Utama...');
        } else if (trimmed === '3') {
            storeManager.writeStore(storeManager.defaultStore);
            console.log('\n[SUKSES] Status pendaftaran hari ini berhasil di-reset menjadi NULL.');
            console.log('[INFO] Anda sekarang dapat melakukan simulasi pendaftaran ulang hari ini.');
            await askQuestion('\nTekan ENTER untuk kembali ke Menu Utama...');
        } else if (trimmed === '2') {
            await showConfigMenu();
        } else if (trimmed === '1') {
            // Cek kelengkapan konfigurasi minimal sebelum memulai bot
            if (!config.userName || !config.userOptId || !config.targetGroupName) {
                console.log('\n[PERINGATAN] Konfigurasi belum lengkap! Silakan atur profil Anda terlebih dahulu di Menu 2.');
                await askQuestion('\nTekan ENTER untuk kembali ke Menu Utama...');
                continue;
            }

            console.clear();
            console.log('\n[SYSTEM] Menginisialisasi koneksi WhatsApp Web...');
            client.initialize();
            break; // Keluar dari menu loop karena client sedang berjalan
        } else {
            console.log('[ERROR] Pilihan tidak valid.');
            await askQuestion('\nTekan ENTER untuk kembali ke Menu Utama...');
        }
    }
}

// Jalankan sistem menu utama
startSystem();
