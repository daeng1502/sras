const puppeteer = require('puppeteer');
const originalLaunch = puppeteer.launch;
puppeteer.launch = async function(options) {
    const browser = await originalLaunch.call(puppeteer, options);
    browser.on('targetcreated', async (target) => {
        if (target.type() === 'page') {
            const page = await target.page();
            if (page) {
                try {
                    await page.setRequestInterception(true);
                    page.on('request', (req) => {
                        const resourceType = req.resourceType();
                        if (['image', 'media', 'font'].includes(resourceType)) {
                            req.abort();
                        } else {
                            req.continue();
                        }
                    });
                } catch (err) {
                    // Abaikan jika halaman sudah tertutup saat interseptor dipasang
                }
            }
        }
    });
    return browser;
};
console.log('[SYSTEM-PUPPETEER] Pemblokiran media (gambar/video/font) aktif untuk menghemat kuota internet.');

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
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
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
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-extensions',
            '--mute-audio',
            '--no-default-browser-check',
            '--disable-background-networking',
            '--disable-renderer-backgrounding',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows'
        ]
    }
});

// Event ketika QR Code didapatkan untuk dipindai
client.on('qr', async (qr) => {
    // Jika nomor HP dikonfigurasi di .env, gunakan Pairing Code
    if (config.userHp) {
        console.log(`\n[LINKING] Meminta kode penautan untuk nomor HP: ${config.userHp}...`);
        try {
            let code = null;
            let retries = 3;
            while (retries > 0) {
                try {
                    // Tunggu 3 detik agar sistem penautan internal WA Web siap penuh
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    code = await client.requestPairingCode(config.userHp);
                    break;
                } catch (retryErr) {
                    retries--;
                    if (retries === 0) throw retryErr;
                    console.log(`[LINKING] API Penautan belum siap. Mencoba kembali (${3 - retries}/3)...`);
                }
            }

            console.log(`\n========================================`);
            console.log(`   KODE PENAUTAN WHATSAPP: ${code.slice(0, 4)}-${code.slice(4)}`);
            console.log(`========================================`);
            console.log(`Silakan buka WhatsApp di HP Anda:`);
            console.log(`1. Buka Perangkat Tertaut (Linked Devices).`);
            console.log(`2. Ketuk "Tautkan dengan nomor telepon" (Link with phone number).`);
            console.log(`3. Masukkan kode di atas.`);
            console.log(`========================================\n`);
        } catch (err) {
            console.error('[ERROR] Gagal meminta kode penautan setelah beberapa kali percobaan:', err.message || err);
            console.log('\n[FALLBACK] Beralih ke QR Code sebagai cadangan...');
            // Fallback ke QR jika request pairing code tetap gagal
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

// State & Fungsionalitas Dasbor Kartu Vertikal
const recentLogs = [];
function logToDashboard(message) {
    const timeStr = new Date().toLocaleTimeString('id-ID', { hour12: false });
    recentLogs.push(`[${timeStr}] ${message}`);
    if (recentLogs.length > 5) recentLogs.shift();
    redrawDashboard();
}

function redrawDashboard() {
    // Pindahkan kursor ke pojok kiri atas (0,0) tanpa menghapus layar untuk mencegah kedipan (Anti-Flicker)
    process.stdout.write('\x1B[H');
    const store = storeManager.readStore();
    const currentStatus = store.status || 'ELIGIBLE';
    const currentShift = store.shiftTitle || 'Belum Ada';
    const dateStr = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = new Date().toLocaleTimeString('id-ID', { hour12: false });
    
    console.log('============================================================');
    console.log('                 SRAS PANEL - MONITORING SHIFT              ');
    console.log('============================================================');
    console.log(` WAKTU: ${dateStr} ${timeStr} | PHANTOM LIMIT: UNLIMITED | DATA: SAVED`);
    console.log('------------------------------------------------------------');
    console.log('  PROFIL PENGGUNA:');
    console.log(`  • Nama        : ${config.userName}`);
    console.log(`  • ID OPT      : ${config.userOptId}`);
    console.log(`  • Target JID  : ${targetGroupJid || config.targetGroupName || 'Mencari JID...'}`);
    console.log('  ');
    console.log('  KONFIGURASI MONITOR:');
    const kwString = config.targetShiftKeywords && config.targetShiftKeywords.length > 0
        ? config.targetShiftKeywords.join(', ')
        : 'Semua Shift (Tanpa Filter)';
    console.log(`  • Kata Kunci  : ${kwString}`);
    const sendMode = isAutoSendEnabled ? 'OTOMATIS (Mode Auto-Register)' : 'PANTAU SAJA (Alarm Tanpa Chat)';
    console.log(`  • Kirim Chat  : ${sendMode}`);
    console.log('  ');
    console.log('  STATUS VERIFIKASI:');
    console.log(`  • Status Saat Ini : [ ${currentStatus} ]`);
    console.log(`  • Shift Terpilih  : ${currentShift}`);
    console.log('------------------------------------------------------------');
    console.log('  AKTIVITAS TERBARU (LOG LOKAL):');
    if (recentLogs.length === 0) {
        console.log('  (Belum ada aktivitas)');
    } else {
        recentLogs.forEach(log => {
            console.log(`  ${log}`);
        });
    }
    console.log('============================================================');
    console.log('Tekan Ctrl+C untuk menghentikan pemantauan.');

    // Bersihkan sisa baris di bawahnya jika ada (menghindari sisa karakter teks lama)
    readline.clearScreenDown(process.stdout);
}

// Event ketika client siap menerima pesan
client.on('ready', async () => {
    console.log('\n[READY] WhatsApp Client siap dan aktif!');
    historyLogger.logEvent('SYSTEM', 'Bot terhubung dan siap.');

    try {
        console.log(`[SYSTEM] Mencari JID grup target "${config.targetGroupName}"...`);
        if (config.targetGroupName && (config.targetGroupName.endsWith('@g.us') || /^\d+-\d+@g\.us$/.test(config.targetGroupName))) {
            targetGroupJid = config.targetGroupName;
            console.log(`[SYSTEM] Target grup berhasil dikunci via JID langsung! JID: "${targetGroupJid}"`);
        } else {
            const chats = await client.getChats();
            const targetChat = chats.find(c => c.isGroup && c.name && c.name.toLowerCase().includes(config.targetGroupName.toLowerCase()));
            if (targetChat) {
                targetGroupJid = targetChat.id._serialized;
                console.log(`[SYSTEM] Target grup berhasil dikunci! JID: "${targetGroupJid}"`);
            } else {
                console.log(`[PERINGATAN] Grup dengan nama "${config.targetGroupName}" tidak ditemukan di daftar chat Anda.`);
            }
        }
    } catch (e) {
        console.log(`[DIAGNOSTIK] Gagal memuat JID grup di awal: ${e.message || e}`);
    }

    console.log('\n==================================================');
    console.log('          MEMULAI MONITORING SHIFT');
    console.log('==================================================');
    console.log(`Pengguna: ${config.userName} (${config.userOptId})`);
    console.log(`Grup Target: ${config.targetGroupName}`);
    const adminsString = config.monitoredAdmins.map(a => a.split('@')[0]).join(',');
    console.log(`Daftar Admin: ${adminsString}`);

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

    historyLogger.logEvent('SYSTEM', 'Bot mulai memantau grup.');
    
    // Masuk ke mode Alternate Screen Buffer (Layar alternatif bersih, tanpa scrollback)
    process.stdout.write('\x1B[?1049h\x1B[H');
    
    logToDashboard('Bot terhubung dan siap memantau grup.');
    
    // Jalankan pembaruan waktu dasbor otomatis setiap 10 detik
    setInterval(() => {
        redrawDashboard();
    }, 10000);
});

// Mendengarkan pesan masuk & pesan keluar (message_create)
client.on('message_create', async (msg) => {
    try {
        // 1. Validasi apakah pesan berasal dari grup (Offline & cepat)
        const groupJid = msg.from.endsWith('@g.us') ? msg.from : (msg.to && msg.to.endsWith('@g.us') ? msg.to : null);
        historyLogger.logEvent('DEBUG-MSG', `message_create terpicu | fromMe: ${msg.fromMe} | from: ${msg.from} | to: ${msg.to} | groupJid: ${groupJid} | idExists: ${!!msg.id} | idSerialized: ${msg.id ? msg.id._serialized : 'undefined'} | body: "${msg.body ? msg.body.replace(/\n/g, ' ').slice(0, 50) : ''}..."`);
        if (!groupJid) return;

        // Inisialisasi cache lokal untuk grup ini jika belum ada
        if (!groupMessageCache[groupJid]) {
            groupMessageCache[groupJid] = [];
        }
        
        // Simpan pesan ke cache lokal grup (untuk sinkronisasi & verifikasi)
        const cache = groupMessageCache[groupJid];
        
        // Hindari duplikasi penyimpanan di cache
        const msgId = (msg.id && msg.id._serialized) ? msg.id._serialized : Math.random().toString(36).slice(2);
        const isDuplicate = cache.some(m => m.id === msgId || (m.body === msg.body && Math.abs(m.timestamp - Date.now()) < 3000));
        if (!isDuplicate) {
            cache.push({
                body: msg.body,
                author: msg.author || msg.from,
                id: msgId,
                timestamp: Date.now()
            });
            if (cache.length > 10) cache.shift(); // Batasi cache hingga 10 pesan terakhir
        }

        // Jika pesan dikirim oleh bot sendiri, cukup masukkan ke cache lalu hentikan proses
        if (msg.fromMe) return;

        // 2. Deteksi apakah pengirim adalah salah satu admin yang dipantau (dinamis & fleksibel terhadap suffix @c.us / @lid / Phone vs LID mapping)
        const senderId = msg.author;
        let senderContactNumber = '';
        try {
            const contact = await msg.getContact();
            senderContactNumber = contact.number || '';
        } catch (e) {
            // Fallback jika getContact gagal
        }
        const senderIdNumber = senderId ? senderId.split('@')[0] : '';
        let isFromMonitoredAdmin = config.monitoredAdmins.some(adminJid => {
            const adminNumber = adminJid.split('@')[0];
            return adminJid === senderId || 
                   adminNumber === senderIdNumber || 
                   (senderContactNumber && adminNumber === senderContactNumber);
        });

        // 3. Deteksi Otomatis Target Group JID & Perekaman Admin Dinamis Selama Monitoring
        let isMessageFromTargetGroup = false;
        if (targetGroupJid && msg.from === targetGroupJid) {
            isMessageFromTargetGroup = true;
        } else {
            // Cek apakah TARGET_GROUP_NAME diatur sebagai JID langsung
            if (config.targetGroupName && (config.targetGroupName.endsWith('@g.us') || /^\d+-\d+@g\.us$/.test(config.targetGroupName))) {
                if (msg.from === config.targetGroupName) {
                    targetGroupJid = msg.from;
                    isMessageFromTargetGroup = true;
                }
            } else if (!targetGroupJid) {
                try {
                    const chats = await client.getChats();
                    const currentChat = chats.find(c => c.id._serialized === msg.from);
                    if (currentChat && currentChat.isGroup && currentChat.name && currentChat.name.toLowerCase().includes(config.targetGroupName.toLowerCase())) {
                        targetGroupJid = msg.from;
                        isMessageFromTargetGroup = true;
                        logToDashboard(`Target grup terdeteksi secara otomatis! JID: "${targetGroupJid}"`);
                    }
                } catch (err) {
                    // Abaikan secara aman
                }
            }
        }

        if (isMessageFromTargetGroup && !isFromMonitoredAdmin) {
            const isPotentialShift = parser.isShiftOpening(msg.body);
            let isPotentialVerification = verification.isVerificationMessage(msg.body);

            // Cek apakah pesan verifikasi berupa reply ke list shift yang penuh
            if (msg.hasQuotedMsg && !isPotentialVerification) {
                try {
                    const quotedMsg = await msg.getQuotedMessage();
                    if (parser.isShiftOpening(quotedMsg.body) && parser.isQuotaFull(quotedMsg.body)) {
                        isPotentialVerification = true;
                    }
                } catch (e) {}
            }

            if (isPotentialShift || isPotentialVerification) {
                // Verifikasi peran admin grup menggunakan cache chat list
                let isVerifiedAdmin = false;
                try {
                    const chats = await client.getChats();
                    const targetChat = chats.find(c => c.id._serialized === msg.from);
                    if (targetChat && targetChat.isGroup && targetChat.participants) {
                        const participant = targetChat.participants.find(p => p.id._serialized === senderId);
                        if (participant && (participant.isAdmin || participant.isSuperAdmin)) {
                            isVerifiedAdmin = true;
                            logToDashboard(`Pengirim ${senderId.split('@')[0]} terverifikasi sebagai admin grup.`);
                        }
                    }
                } catch (e) {
                    // Abaikan secara aman
                }

                // Fallback jika tidak terverifikasi via cache (misal cache chat belum lengkap)
                if (!isVerifiedAdmin) {
                    logToDashboard(`Perekaman admin baru: ${senderId.split('@')[0]}`);
                    isVerifiedAdmin = true;
                }

                if (isVerifiedAdmin) {
                    logToDashboard(`Aktivitas shift dari admin baru terdeteksi: ${senderId.split('@')[0]}`);
                    
                    const currentAdmins = config.monitoredAdmins.map(a => a.split('@')[0]);
                    const cleanSenderNumber = senderId.split('@')[0];
                    if (!currentAdmins.includes(cleanSenderNumber)) {
                        currentAdmins.push(cleanSenderNumber);
                        const newAdminsString = currentAdmins.join(',');
                        saveToEnv('MONITORED_ADMINS', newAdminsString);
                        logToDashboard(`Admin baru direkam ke .env: ${cleanSenderNumber}`);
                    }
                    isFromMonitoredAdmin = true;
                }
            }
        }

        // Pastikan pesan berasal dari grup target yang sudah terdeteksi
        if (!targetGroupJid || msg.from !== targetGroupJid) {
            return;
        }

        // Tampilkan aktivitas chat masuk di grup pada dasbor (dibatasi panjang karakternya)
        const cleanSenderNumber = msg.author ? msg.author.split('@')[0] : msg.from.split('@')[0];
        const cleanBody = msg.body ? msg.body.replace(/\n/g, ' ').slice(0, 30) : '';
        const roleLabel = isFromMonitoredAdmin ? 'Admin' : 'Member';
        logToDashboard(`[${roleLabel}] ${cleanSenderNumber}: "${cleanBody}..."`);

        // Pastikan pengirim adalah Admin
        if (!isFromMonitoredAdmin) return;

        const messageText = msg.body;

        // 4. Deteksi Pembukaan Shift Kerja Baru
        if (parser.isShiftOpening(messageText)) {
            logToDashboard('Pesan pembukaan shift baru terdeteksi!');
            
            const regResult = registrator.processRegistration(messageText);
            
            if (regResult.success) {
                logToDashboard(`Pendaftaran diproses: ${regResult.message}`);
                
                if (!regResult.replyText) {
                    logToDashboard('Nama Anda sudah terdaftar di list (Diabaikan).');
                    return;
                }

                try {
                    // Pemicu status "Sedang Mengetik..." di grup WA secara instan untuk kamuflase alami
                    const chat = await msg.getChat();
                    await chat.sendStateTyping();
                } catch (err) {
                    // Diabaikan secara aman jika getChat() memicu error
                }

                // Mengatur jeda yang sangat cepat namun tetap aman (1.0 s.d 1.8 detik)
                const competitiveDelayMs = Math.floor(Math.random() * (1800 - 1000 + 1)) + 1000;
                logToDashboard(`Mengetik selama ${competitiveDelayMs / 1000} detik sebelum mengirim...`);
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
                        logToDashboard('Sinkronisasi ulang pendaftar lain terdeteksi...');
                        
                        // Batal jika ternyata nama kita sudah dimasukkan oleh orang lain
                        if (parser.isUserAlreadyRegistered(lastCachedMsg.body, config.userName, config.userOptId)) {
                            logToDashboard('Batal kirim: Sudah didaftarkan oleh pendaftar lain.');
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
                    logToDashboard('Pesan pendaftaran berhasil terkirim ke grup!');
                } else {
                    logToDashboard('Pendaftaran dibunyikan (Mode Pantau Saja).');
                }
            } else {
                logToDashboard(`Dilewati: ${regResult.message}`);
                historyLogger.logEvent('SKIP', `Pendaftaran dilewati karena: ${regResult.message}`);
            }
            return;
        }

        // 5. Deteksi Pengumuman Hasil Verifikasi/Seleksi Admin (Bisa berupa kata kunci atau reply list kuota penuh)
        let isVerifyMsg = verification.isVerificationMessage(messageText);
        let quotedText = null;

        if (msg.hasQuotedMsg) {
            try {
                const quotedMsg = await msg.getQuotedMessage();
                const isList = /^\s*\d+\.\s*/m.test(quotedMsg.body) || quotedMsg.body.toLowerCase().includes('team') || parser.isShiftOpening(quotedMsg.body);
                if (isList) {
                    quotedText = quotedMsg.body;
                    logToDashboard('Admin me-reply list pendaftaran...');
                }
            } catch (err) {
                // Abaikan error quoted message fetch
            }
        }

        let shouldVerify = isVerifyMsg;
        if (quotedText && (isVerifyMsg || parser.isQuotaFull(quotedText))) {
            shouldVerify = true;
        }

        if (shouldVerify) {
            logToDashboard('Hasil verifikasi/seleksi terdeteksi!');
            
            // Proses verifikasi secara sinkron menggunakan cache lokal & quotedText
            const verResult = verification.processVerification(messageText, cache, quotedText);
            
            if (verResult.processed) {
                logToDashboard(`Status terupdate menjadi: [${verResult.status}]. Alasan: ${verResult.reason}`);
            } else {
                logToDashboard(`Verifikasi dilewati: ${verResult.reason}`);
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

// Kembalikan layar normal ketika proses keluar/dihentikan dari mode alternate buffer (Anti-Jejak Scroll)
const restoreScreen = () => {
    process.stdout.write('\x1B[?1049l');
};
process.on('exit', restoreScreen);
process.on('SIGINT', () => {
    restoreScreen();
    process.exit(0);
});
process.on('SIGTERM', () => {
    restoreScreen();
    process.exit(0);
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
    else if (key === 'MONITORED_ADMINS') {
        config.monitoredAdmins = processedValue
            .split(',')
            .map(admin => admin.trim())
            .filter(admin => admin.length > 0)
            .map(admin => {
                let clean = admin;
                if (clean.startsWith('0')) {
                    clean = '62' + clean.slice(1);
                }
                return clean.includes('@') ? clean : `${clean}@c.us`;
            });
    }

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
 * Wizard untuk merekam JID Admin yang mengirim pesan di grup target secara otomatis.
 */
async function recordAdminJidWizard() {
    console.clear();
    console.log('\n==================================================');
    console.log('         WIZARD REKAM ID ADMIN OTOMATIS');
    console.log('==================================================');
    console.log(`Grup Target Dipantau: "${config.targetGroupName || '(Kosong)'}"`);
    console.log('Pastikan Nama Grup Target sudah diatur dengan benar.');
    console.log('Wizard ini akan mendeteksi chat masuk dari grup target');
    console.log('dan menyimpan ID Admin pengirimnya secara otomatis.');
    console.log('==================================================\n');

    if (!config.targetGroupName) {
        console.log('[PERINGATAN] Nama Grup WA Target masih kosong. Silakan atur terlebih dahulu!');
        await askQuestion('\nTekan ENTER untuk kembali...');
        return;
    }

    console.log('[SYSTEM] Menginisialisasi koneksi WhatsApp sementara...');
    
    const tempClient = new Client({
        authStrategy: new LocalAuth({
            dataPath: './.wwebjs_auth'
        }),
        webVersion: '2.2412.54',
        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html'
        },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
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
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--disable-extensions',
                '--mute-audio',
                '--no-default-browser-check',
                '--disable-background-networking',
                '--disable-renderer-backgrounding',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows'
            ]
        }
    });

    let pairingCodePrinted = false;

    tempClient.on('qr', async (qr) => {
        if (config.userHp && !pairingCodePrinted) {
            pairingCodePrinted = true;
            console.log(`\n[LINKING] Meminta kode penautan untuk nomor HP: ${config.userHp}...`);
            try {
                let code = null;
                let retries = 3;
                while (retries > 0) {
                    try {
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        code = await tempClient.requestPairingCode(config.userHp);
                        break;
                    } catch (retryErr) {
                        retries--;
                        if (retries === 0) throw retryErr;
                        console.log(`[LINKING] API Penautan belum siap. Mencoba kembali (${3 - retries}/3)...`);
                    }
                }

                console.log(`\n========================================`);
                console.log(`   KODE PENAUTAN WHATSAPP: ${code.slice(0, 4)}-${code.slice(4)}`);
                console.log(`========================================`);
                console.log(`Silakan buka WhatsApp di HP Anda:`);
                console.log(`1. Buka Perangkat Tertaut (Linked Devices).`);
                console.log(`2. Ketuk "Tautkan dengan nomor telepon" (Link with phone number).`);
                console.log(`3. Masukkan kode di atas.`);
                console.log(`========================================\n`);
            } catch (err) {
                console.error('[ERROR] Gagal meminta kode penautan:', err.message || err);
                console.log('\n[FALLBACK] Beralih ke QR Code...');
                qrcode.generate(qr, { small: true });
            }
        } else if (!config.userHp) {
            console.log('\n[QR] Silakan pindai QR Code menggunakan WhatsApp HP Anda:');
            qrcode.generate(qr, { small: true });
        }
    });

    tempClient.on('authenticated', () => {
        console.log('[AUTH] Autentikasi berhasil!');
    });

    tempClient.on('auth_failure', (msg) => {
        console.error('[AUTH] Otentikasi gagal:', msg);
    });

    let wizardFinished = false;

    return new Promise((resolve) => {
        let wizardTargetGroupJid = null;

        tempClient.on('message', async (msg) => {
            if (wizardFinished) return;
            try {
                if (!msg.from.endsWith('@g.us')) return;

                console.log(`[WIZARD-DIAGNOSTIK] Menerima pesan di JID: "${msg.from}" | Pengirim: "${msg.author || msg.from}"`);

                let isTargetGroup = false;
                let matchedGroupName = config.targetGroupName;

                if (wizardTargetGroupJid && msg.from === wizardTargetGroupJid) {
                    isTargetGroup = true;
                    console.log(`[WIZARD-DIAGNOSTIK] JID cocok dengan grup target teresolusi ("${wizardTargetGroupJid}").`);
                } else if (!wizardTargetGroupJid) {
                    try {
                        const chats = await tempClient.getChats();
                        const targetChat = chats.find(c => c.isGroup && c.name && c.name.toLowerCase().includes(config.targetGroupName.toLowerCase()));
                        if (targetChat) {
                            wizardTargetGroupJid = targetChat.id._serialized;
                            matchedGroupName = targetChat.name;
                            if (msg.from === wizardTargetGroupJid) {
                                isTargetGroup = true;
                            }
                        }
                    } catch (e) {
                        // Abaikan secara aman
                    }

                    if (!isTargetGroup) {
                        console.log(`[WIZARD-FALLBACK] Memverifikasi grup JID "${msg.from}" berdasarkan aktivitas pesan.`);
                        isTargetGroup = true;
                    }
                }

                if (isTargetGroup) {
                    const senderId = msg.author;
                    if (!senderId) {
                        console.log(`[WIZARD-DIAGNOSTIK] msg.author kosong. Menggunakan msg.from/sender...`);
                    }

                    let senderContactNumber = '';
                    try {
                        const contact = await msg.getContact();
                        senderContactNumber = contact.number || '';
                    } catch (e) {}

                    console.log(`\n[WIZARD] Terdeteksi pesan di grup target "${matchedGroupName}"!`);
                    console.log(`[WIZARD] Pengirim JID: "${senderId || msg.from}"`);
                    if (senderContactNumber) {
                        console.log(`[WIZARD] Nomor Kontak: "${senderContactNumber}"`);
                    }

                    const adminJidClean = senderId || msg.from;
                    const alreadyExists = config.monitoredAdmins.some(admin => admin.split('@')[0] === adminJidClean.split('@')[0]);

                    if (alreadyExists) {
                        console.log(`[WIZARD] ID "${adminJidClean}" sudah terdaftar sebagai admin.`);
                        wizardFinished = true;
                        console.log('[SYSTEM] Menutup koneksi WhatsApp sementara...');
                        try {
                            await tempClient.destroy();
                        } catch (e) {}
                        await new Promise(resolveDelay => setTimeout(resolveDelay, 1500));
                        resolve();
                    } else {
                        wizardFinished = true;
                        console.log(`\n[WIZARD] Menambahkan "${adminJidClean}" ke daftar admin...`);
                        
                        const currentAdmins = config.monitoredAdmins.map(a => a.split('@')[0]);
                        currentAdmins.push(adminJidClean.split('@')[0]);
                        const newAdminsString = currentAdmins.join(',');

                        saveToEnv('MONITORED_ADMINS', newAdminsString);
                        console.log(`[SUKSES] ID Admin berhasil disimpan ke .env!`);
                        console.log(`[INFO] Daftar Admin saat ini: ${newAdminsString}`);

                        console.log('[SYSTEM] Menutup koneksi WhatsApp sementara...');
                        try {
                            await tempClient.destroy();
                        } catch (e) {}
                        await new Promise(resolveDelay => setTimeout(resolveDelay, 1500));
                        resolve();
                    }
                }
            } catch (err) {
                console.error('[ERROR] Wizard gagal memproses pesan:', err);
            }
        });

        tempClient.on('ready', async () => {
            console.log('\n[READY] WhatsApp Client sementara siap!');
            try {
                console.log(`[WIZARD] Mencari JID grup target "${config.targetGroupName}" di WhatsApp Anda...`);
                const chats = await tempClient.getChats();
                const targetChat = chats.find(c => c.isGroup && c.name && c.name.toLowerCase().includes(config.targetGroupName.toLowerCase()));
                if (targetChat) {
                    wizardTargetGroupJid = targetChat.id._serialized;
                    console.log(`[WIZARD] Target grup berhasil ditemukan! JID: "${wizardTargetGroupJid}"`);
                } else {
                    console.log(`[WIZARD-PERINGATAN] Grup "${config.targetGroupName}" tidak ditemukan di chat list.`);
                }
            } catch (e) {
                console.log(`[WIZARD-DIAGNOSTIK] Gagal memuat daftar chat: ${e.message || e}`);
            }
            console.log(`\n[WIZARD] Silakan minta Admin mengirim chat sembarang di grup target "${config.targetGroupName}".`);
            console.log('[WIZARD] Menunggu pesan masuk... (Ketik "batal" di terminal untuk keluar dari wizard)');
        });

        tempClient.initialize().catch(err => {
            console.error('[ERROR] Gagal menginisialisasi client wizard:', err);
            resolve();
        });

        (async () => {
            while (!wizardFinished) {
                const action = await askQuestion('');
                if (action.trim().toLowerCase() === 'batal') {
                    wizardFinished = true;
                    console.log('\n[WIZARD] Membatalkan wizard...');
                    console.log('[SYSTEM] Menutup koneksi WhatsApp sementara...');
                    try {
                        await tempClient.destroy();
                    } catch (e) {}
                    resolve();
                    break;
                }
            }
        })();
    });
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
        console.log(`1. Ubah Nama Pengguna      [${config.userName || '(Kosong)'}]`);
        console.log(`2. Ubah OPT ID             [${config.userOptId || '(Kosong)'}]`);
        console.log(`3. Ubah Nomor HP Anda      [${config.userHp || '(Kosong)'}]`);
        console.log(`4. Ubah Nama Grup WA       [${config.targetGroupName || '(Kosong)'}]`);
        console.log(`5. Rekam ID Admin Otomatis`);
        const adminsString = config.monitoredAdmins.map(a => a.split('@')[0]).join(',');
        console.log(`6. Ubah Nomor HP Admin     [${adminsString || '(Kosong)'}]`);
        console.log('7. Kembali ke Menu Utama');
        console.log('==================================================');

        const choice = await askQuestion('Pilih setelan yang ingin diubah (1-7): ');
        const trimmed = choice.trim();

        if (trimmed === '7') {
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
            case '5':
                await recordAdminJidWizard();
                continue;
            case '6':
                key = 'MONITORED_ADMINS';
                promptText = `Masukkan Daftar HP Admin (pisahkan koma) [Saat ini: ${adminsString}]: `;
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
