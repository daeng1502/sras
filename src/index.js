const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const readline = require('readline');
const fs = require('fs');
const config = require('./config');
const parser = require('./services/parser');
const registrator = require('./services/registrator');
const verification = require('./services/verification');
const historyLogger = require('./services/history');

/**
 * Mendeteksi lokasi Chromium secara otomatis di lingkungan Android Termux
 */
function getTermuxChromiumPath() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    
    // Path standar Chromium di Android Termux
    const termuxChromiumPath = '/data/data/com.termux/files/usr/bin/chromium';
    if (fs.existsSync(termuxChromiumPath)) {
        return termuxChromiumPath;
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
client.on('qr', (qr) => {
    console.log('\n[QR] QR Code terdeteksi! Silakan pindai menggunakan WhatsApp HP Anda:');
    qrcode.generate(qr, { small: true });
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

// Event ketika client siap menerima pesan
client.on('ready', () => {
    console.log('[READY] WhatsApp Client siap dan aktif!');
    console.log(`[SYSTEM] Menunggu pesan lowongan dari Admin di grup target "${config.targetGroupName}"...`);
    historyLogger.logEvent('SYSTEM', 'Bot dimulai dan siap memantau grup.');
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

        // 2. Deteksi pengirim adalah salah satu admin yang dipantau
        const senderId = msg.author;
        const isFromMonitoredAdmin = config.monitoredAdmins.includes(senderId);

        // 3. Deteksi otomatis Target Group JID jika belum teridentifikasi
        if (isFromMonitoredAdmin && !targetGroupJid) {
            const isOpening = parser.isShiftOpening(msg.body);
            const isVerify = verification.isVerificationMessage(msg.body);

            if (isOpening || isVerify) {
                try {
                    // Validasi nama grup secara online
                    const chat = await msg.getChat();
                    if (chat.isGroup && chat.name.toLowerCase().includes(config.targetGroupName.toLowerCase())) {
                        targetGroupJid = msg.from;
                        console.log(`[SYSTEM] Target grup terdeteksi secara otomatis dan terverifikasi! JID: "${targetGroupJid}"`);
                    }
                } catch (err) {
                    // Fallback jika getChat() gagal karena error 'r' CDP:
                    // Kita kunci grup ini secara langsung karena pengirim adalah admin sah dan pesan berformat shift
                    targetGroupJid = msg.from;
                    console.log(`[SYSTEM] Gagal memvalidasi nama grup secara online (CDP error). Menetapkan JID: "${targetGroupJid}" secara otomatis.`);
                }
            }
        }

        // Pastikan pesan berasal dari grup target yang sudah terdeteksi
        if (!targetGroupJid || msg.from !== targetGroupJid) {
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

                // Balas pesan ke grup secara otomatis dengan template terisi (BR-004 & BR-006)
                await client.sendMessage(msg.from, textToSend);
                console.log('[KIRIM] Berhasil mengirimkan daftar pendaftaran terbaru ke grup.');
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
 * Menanyakan kata kunci target shift ke pengguna secara interaktif sebelum memulai koneksi.
 */
function askTargetKeywords() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question('\n[INPUT] Masukkan kata kunci shift target (contoh: 11.00 atau malam, tekan ENTER untuk memantau semua): ', (answer) => {
            rl.close();
            const inputKeywords = answer.trim()
                .split(',')
                .map(kw => kw.trim().toLowerCase())
                .filter(kw => kw.length > 0);
            
            resolve(inputKeywords);
        });
    });
}

/**
 * Alur utama inisialisasi sistem
 */
async function startSystem() {
    console.log('=== Shift Registration Automation System (SRAS) ===');
    console.log('Memulai sistem...');
    console.log(`Pengguna: ${config.userName} (${config.userOptId})`);
    console.log(`Grup Target: ${config.targetGroupName}`);
    console.log(`Daftar Admin: ${config.monitoredAdmins.join(', ')}`);

    // Dapatkan masukan kata kunci dari pengguna secara interaktif
    const keywords = await askTargetKeywords();
    if (keywords.length > 0) {
        config.targetShiftKeywords = keywords;
        console.log(`[INFO] Bot dikonfigurasi untuk HANYA menargetkan shift dengan kata kunci: "${keywords.join(', ')}"`);
    } else {
        config.targetShiftKeywords = [];
        console.log('[INFO] Bot dikonfigurasi untuk memantau SEMUA shift (Tanpa filter spesifik).');
    }

    console.log('\n[SYSTEM] Menginisialisasi koneksi WhatsApp Web...');
    client.initialize();
}

// Jalankan sistem
startSystem();
