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

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
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
const backupManager = require('./services/backup');

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
const client1 = new Client({
    authStrategy: new LocalAuth({
        clientId: 'user1',
        dataPath: './.wwebjs_auth'
    }),
    webVersion: '2.2412.54',
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html'
    },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/122.0.0.0',
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
            '--disable-backgrounding-occluded-windows',
            '--disk-cache-size=10485760',
            '--media-cache-size=5242880'
        ]
    }
});

const client2 = new Client({
    authStrategy: new LocalAuth({
        clientId: 'user2',
        dataPath: './.wwebjs_auth'
    }),
    webVersion: '2.2412.54',
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/{version}.html'
    },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/122.0.0.0',
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
            '--disable-backgrounding-occluded-windows',
            '--disk-cache-size=10485760',
            '--media-cache-size=5242880'
        ]
    }
});

function setupClientListeners(clientInstance, userLabel, userHp) {
    clientInstance.on('qr', async (qr) => {
        if (userHp) {
            console.log(`\n[LINKING - ${userLabel}] Meminta kode penautan untuk nomor HP: ${userHp}...`);
            try {
                let code = null;
                let retries = 3;
                while (retries > 0) {
                    try {
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        code = await clientInstance.requestPairingCode(userHp);
                        break;
                    } catch (retryErr) {
                        retries--;
                        if (retries === 0) throw retryErr;
                        console.log(`[LINKING - ${userLabel}] API Penautan belum siap. Mencoba kembali (${3 - retries}/3)...`);
                    }
                }

                console.log(`\n========================================`);
                console.log(`   [${userLabel}] KODE PENAUTAN: ${code.slice(0, 4)}-${code.slice(4)}`);
                console.log(`========================================`);
                console.log(`Silakan buka WhatsApp di HP [${userLabel}]:`);
                console.log(`1. Buka Perangkat Tertaut (Linked Devices).`);
                console.log(`2. Ketuk "Tautkan dengan nomor telepon" (Link with phone number).`);
                console.log(`3. Masukkan kode di atas.`);
                console.log(`========================================\n`);
            } catch (err) {
                console.error(`[ERROR - ${userLabel}] Gagal meminta kode penautan:`, err.message || err);
                console.log(`\n[FALLBACK - ${userLabel}] Beralih ke QR Code sebagai cadangan...`);
                qrcode.generate(qr, { small: true });
            }
        } else {
            console.log(`\n[QR - ${userLabel}] QR Code terdeteksi! Silakan pindai menggunakan WhatsApp HP Anda:`);
            qrcode.generate(qr, { small: true });
        }
    });

    clientInstance.on('authenticated', () => {
        console.log(`[AUTH - ${userLabel}] Autentikasi berhasil!`);
    });

    clientInstance.on('auth_failure', (msg) => {
        console.error(`[AUTH - ${userLabel}] Otentikasi gagal:`, msg);
        historyLogger.logEvent('ERROR', `Autentikasi gagal [${userLabel}]: ${msg}`);
    });
}

setupClientListeners(client1, 'AKUN 1', config.user1.hp);
setupClientListeners(client2, 'AKUN 2', config.user2.hp);

// Variabel state lokal (menghindari pemanggilan getChat / getChats CDP Puppeteer yang rawan bug 'r')
let targetGroupJid = null;
const groupMessageCache = {};
let isAutoSendEnabled = true;
let isMultiAccountMode = false;

// State & Fungsionalitas Dasbor Kartu Vertikal
const recentLogs = [];
let redrawTimeout = null;

function triggerRedraw() {
    if (redrawTimeout) clearTimeout(redrawTimeout);
    redrawTimeout = setTimeout(() => {
        redrawDashboard();
    }, 50); // Jeda 50ms untuk mengonsolidasikan cetakan simultan
}

function logToDashboard(message) {
    const timeStr = new Date().toLocaleTimeString('id-ID', { hour12: false });
    recentLogs.push(`[${timeStr}] ${message}`);
    if (recentLogs.length > 5) recentLogs.shift();
    triggerRedraw();
}

function redrawDashboard() {
    const store = storeManager.readStore();
    const dateStr = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = new Date().toLocaleTimeString('id-ID', { hour12: false });
    
    let output = '';
    output += '\x1B[H'; // Pindahkan kursor ke pojok kiri atas (0,0) tanpa menghapus layar
    
    if (!isMultiAccountMode) {
        // ================= SINGLE ACCOUNT LAYOUT =================
        const s1 = store.user1 || { status: 'NULL', registeredShiftId: null };
        output += '============================================================\x1B[K\n';
        output += '                 SRAS PANEL - MONITORING SHIFT              \x1B[K\n';
        output += '============================================================\x1B[K\n';
        output += ` WAKTU: ${dateStr} ${timeStr} | PHANTOM LIMIT: UNLIMITED | DATA: SAVED\x1B[K\n`;
        output += '------------------------------------------------------------\x1B[K\n';
        output += '  PROFIL PENGGUNA:\x1B[K\n';
        output += `  • Nama        : ${config.user1.name}\x1B[K\n`;
        output += `  • ID OPT      : ${config.user1.optId}\x1B[K\n`;
        output += `  • Status      : [ ${s1.status} ]\x1B[K\n`;
        output += `  • Shift       : ${s1.registeredShiftId || 'Belum Ada'}\x1B[K\n`;
        output += '  \x1B[K\n';
        output += '  KONFIGURASI MONITOR:\x1B[K\n';
        const kwString = config.targetShiftKeywords && config.targetShiftKeywords.length > 0
            ? config.targetShiftKeywords.join(', ')
            : 'Semua Shift (Tanpa Filter)';
        output += `  • Kata Kunci  : ${kwString}\x1B[K\n`;
        const sendMode = isAutoSendEnabled ? 'OTOMATIS (Mode Auto-Register)' : 'PANTAU SAJA (Alarm Tanpa Chat)';
        output += `  • Kirim Chat  : ${sendMode}\x1B[K\n`;
        output += `  • Target JID  : ${targetGroupJid || config.targetGroupName || 'Mencari JID...'}\x1B[K\n`;
    } else {
        // ================= DUAL ACCOUNT LAYOUT =================
        const s1 = store.user1 || { status: 'NULL', registeredShiftId: null };
        const s2 = store.user2 || { status: 'NULL', registeredShiftId: null };
        output += '============================================================\x1B[K\n';
        output += '             SRAS PANEL - DUAL-ACCOUNT MONITORING           \x1B[K\n';
        output += '============================================================\x1B[K\n';
        output += ` WAKTU: ${dateStr} ${timeStr} | PHANTOM LIMIT: UNLIMITED | DATA: SAVED\x1B[K\n`;
        output += '------------------------------------------------------------\x1B[K\n';
        output += '  PROFIL AKUN 1 (MASTER):\x1B[K\n';
        output += `  • Nama        : ${config.user1.name}\x1B[K\n`;
        output += `  • ID OPT      : ${config.user1.optId}\x1B[K\n`;
        output += `  • Status      : [ ${s1.status} ]\x1B[K\n`;
        output += `  • Shift       : ${s1.registeredShiftId || 'Belum Ada'}\x1B[K\n`;
        output += '  \x1B[K\n';
        output += '  PROFIL AKUN 2 (MEMBER):\x1B[K\n';
        output += `  • Nama        : ${config.user2.name}\x1B[K\n`;
        output += `  • ID OPT      : ${config.user2.optId}\x1B[K\n`;
        output += `  • Status      : [ ${s2.status} ]\x1B[K\n`;
        output += `  • Shift       : ${s2.registeredShiftId || 'Belum Ada'}\x1B[K\n`;
        output += '  \x1B[K\n';
        output += '  KONFIGURASI MONITOR:\x1B[K\n';
        const kwString = config.targetShiftKeywords && config.targetShiftKeywords.length > 0
            ? config.targetShiftKeywords.join(', ')
            : 'Semua Shift (Tanpa Filter)';
        output += `  • Kata Kunci  : ${kwString}\x1B[K\n`;
        const sendMode = isAutoSendEnabled ? 'OTOMATIS (Sequential Register)' : 'PANTAU SAJA (Alarm Tanpa Chat)';
        output += `  • Kirim Chat  : ${sendMode}\x1B[K\n`;
        output += `  • Target JID  : ${targetGroupJid || config.targetGroupName || 'Mencari JID...'}\x1B[K\n`;
    }
    
    output += '------------------------------------------------------------\x1B[K\n';
    output += '  AKTIVITAS TERBARU (LOG LOKAL):\x1B[K\n';
    if (recentLogs.length === 0) {
        output += '  (Belum ada aktivitas)\x1B[K\n';
    } else {
        recentLogs.forEach(log => {
            output += `  ${log}\x1B[K\n`;
        });
    }
    output += '============================================================\x1B[K\n';
    output += 'Tekan Ctrl+C untuk menghentikan pemantauan.\x1B[K\n';

    // Cetak seluruh string dasbor dalam satu operasi I/O tunggal
    process.stdout.write(output);

    // Bersihkan sisa baris di bawahnya jika ada
    readline.clearScreenDown(process.stdout);
}

let isClient1Ready = false;
let isClient2Ready = false;
let isStarted = false;

async function checkTargetJid() {
    try {
        console.log(`[SYSTEM] Mencari JID grup target "${config.targetGroupName}"...`);
        if (config.targetGroupName && (config.targetGroupName.endsWith('@g.us') || /^\d+-\d+@g\.us$/.test(config.targetGroupName))) {
            targetGroupJid = config.targetGroupName;
            console.log(`[SYSTEM] Target grup berhasil dikunci via JID langsung! JID: "${targetGroupJid}"`);
        } else {
            const chats = await client1.getChats();
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
}

async function startSystemMonitoring() {
    if (isStarted) return;
    isStarted = true;

    await checkTargetJid();

    console.log('\n==================================================');
    if (isMultiAccountMode) {
        console.log('          MEMULAI MONITORING SHIFT DUAL-AKUN');
    } else {
        console.log('          MEMULAI MONITORING SHIFT');
    }
    console.log('==================================================');
    console.log(`Akun 1 (Master) : ${config.user1.name} (${config.user1.optId})`);
    if (isMultiAccountMode) {
        console.log(`Akun 2 (Member) : ${config.user2.name} (${config.user2.optId})`);
    }
    console.log(`Grup Target     : ${config.targetGroupName}`);

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
        console.log('[INFO] MODE OTOMATIS aktif. Bot akan membunyikan alarm dan mengirim pendaftaran berurutan.');
    } else {
        isAutoSendEnabled = false;
        console.log('[INFO] MODE PANTAU SAJA aktif. Bot hanya akan membunyikan alarm tanpa mengirim chat otomatis.');
    }

    historyLogger.logEvent('SYSTEM', 'Bot mulai memantau grup.');
    
    // Masuk ke mode Alternate Screen Buffer (Layar alternatif bersih, tanpa scrollback)
    process.stdout.write('\x1B[?1049h\x1B[H');
    
    logToDashboard('Bot terhubung dan siap memantau grup.');
    
    // Jalankan pembaruan waktu dasbor otomatis setiap 10 detik dengan aman
    setInterval(() => {
        triggerRedraw();
    }, 10000);

    // Jalankan pembersihan memori RAM secara paksa setiap 30 menit jika didukung Node.js (--expose-gc)
    setInterval(() => {
        if (global.gc) {
            try {
                global.gc();
                logToDashboard('RAM optimization: Garbage Collection force-triggered.');
            } catch (err) {
                // Abaikan secara aman
            }
        }
    }, 1800000); // 30 menit
}

// Event ketika client siap menerima pesan
client1.on('ready', async () => {
    isClient1Ready = true;
    console.log('\n[READY] WhatsApp Client 1 (Master) siap dan aktif!');
    historyLogger.logEvent('SYSTEM', 'Akun 1 terhubung dan siap.');

    if (isMultiAccountMode && !isClient2Ready) {
        console.log('[SYSTEM] Menginisialisasi koneksi WhatsApp Client 2 (Member)...');
        client2.initialize().catch(err => {
            console.error('[ERROR] Gagal menginisialisasi client 2:', err);
            startSystemMonitoring();
        });
    } else {
        startSystemMonitoring();
    }
});

client2.on('ready', async () => {
    isClient2Ready = true;
    console.log('\n[READY] WhatsApp Client 2 (Member) siap dan aktif!');
    historyLogger.logEvent('SYSTEM', 'Akun 2 terhubung dan siap.');
    startSystemMonitoring();
});

async function triggerAccount2Registration(baseText, groupJid) {
    if (!isMultiAccountMode) return;
    
    // Cek kelayakan Akun 2
    const regResult2 = registrator.processRegistration(baseText, 'user2');
    if (regResult2.success) {
        if (!regResult2.replyText) {
            logToDashboard('[Akun 2] Nama sudah terdaftar di list (Diabaikan).');
            return;
        }

        const competitiveDelay2 = Math.floor(Math.random() * (1800 - 1000 + 1)) + 1000;
        logToDashboard(`[Akun 2] Mengetik selama ${competitiveDelay2 / 1000} detik sebelum mengirim...`);
        
        await new Promise(resolve => setTimeout(resolve, competitiveDelay2));

        if (isAutoSendEnabled) {
            try {
                await client2.sendMessage(groupJid, regResult2.replyText);
                logToDashboard('[Akun 2] Pendaftaran terkoordinasi berhasil terkirim!');
            } catch (err) {
                logToDashboard(`[Akun 2] Gagal mengirim pendaftaran Akun 2: ${err.message}`);
            }
        } else {
            logToDashboard('[Akun 2] Pendaftaran dibunyikan (Mode Pantau Saja).');
        }
    } else {
        logToDashboard(`[Akun 2] Dilewati: ${regResult2.message}`);
    }
}

async function handleWhatsAppCommand(msg) {
    const rawText = msg.body.trim();
    const parts = rawText.split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    let replyText = '';

    switch (command) {
        case '#help':
            replyText = `📋 *KENDALI BOT SRAS (HELP)*\n` +
                        `• \`#status\` - Cek status bot & profil\n` +
                        `• \`#keyword <kw1, kw2>\` - Set kata kunci shift\n` +
                        `• \`#mode <single/dual>\` - Ganti mode akun\n` +
                        `• \`#autosend <on/off>\` - Toggle kirim pendaftaran otomatis\n` +
                        `• \`#setgroup <Nama/JID>\` - Ganti grup WA target\n` +
                        `• \`#reset\` - Reset status harian\n` +
                        `• \`#ss [1/2]\` - Kirim screenshot halaman WA Web\n` +
                        `• \`#ping\` - Cek latensi respon bot\n` +
                        `• \`#log\` - Kirim 10 baris riwayat log terakhir\n` +
                        `• \`#uptime\` - Cek pemakaian RAM & durasi aktif bot\n` +
                        `• \`#restart\` - Restart bot secara jarak jauh\n` +
                        `• \`#help\` - Tampilkan bantuan ini`;
            break;

        case '#status':
            const store = storeManager.readStore();
            const s1 = store.user1 || { status: 'NULL', registeredShiftId: null };
            const s2 = store.user2 || { status: 'NULL', registeredShiftId: null };
            const kwString = config.targetShiftKeywords && config.targetShiftKeywords.length > 0
                ? config.targetShiftKeywords.join(', ')
                : 'Semua Shift (Tanpa Filter)';
            const sendMode = isAutoSendEnabled ? 'AKTIF (Otomatis)' : 'NONAKTIF (Pantau Saja)';
            
            replyText = `🤖 *STATUS MONITORING BOT*\n` +
                        `• *Mode*: ${isMultiAccountMode ? 'Dual-Account' : 'Single-Account'}\n` +
                        `• *Kirim Chat*: ${sendMode}\n` +
                        `• *Kata Kunci*: ${kwString}\n` +
                        `• *Grup Target*: ${targetGroupJid || config.targetGroupName || 'Belum Terkunci'}\n\n` +
                        `*AKUN 1 (MASTER)*:\n` +
                        `• Nama: ${config.user1.name}\n` +
                        `• Status: [ ${s1.status} ]\n` +
                        `• Shift Terdaftar: ${s1.registeredShiftId || '-'}\n\n`;
            
            if (isMultiAccountMode) {
                replyText += `*AKUN 2 (MEMBER)*:\n` +
                             `• Nama: ${config.user2.name}\n` +
                             `• Status: [ ${s2.status} ]\n` +
                             `• Shift Terdaftar: ${s2.registeredShiftId || '-'}`;
            }
            break;

        case '#keyword':
            if (!args) {
                config.targetShiftKeywords = [];
                replyText = `✅ *Kata kunci shift dikosongkan.* Bot sekarang memantau semua shift.`;
            } else {
                const keywords = args.split(',')
                    .map(kw => kw.trim().toLowerCase())
                    .filter(kw => kw.length > 0);
                config.targetShiftKeywords = keywords;
                replyText = `✅ *Kata kunci shift diperbarui*: "${keywords.join(', ')}"`;
            }
            triggerRedraw();
            break;

        case '#mode':
            const targetMode = args.toLowerCase().trim();
            if (targetMode === 'single') {
                isMultiAccountMode = false;
                replyText = `✅ *Mode diubah ke Single-Account.* Bot hanya memantau Akun 1.`;
            } else if (targetMode === 'dual' || targetMode === 'multi') {
                if (!config.user2.name || !config.user2.optId) {
                    replyText = `⚠️ *Gagal*: Konfigurasi Akun 2 di .env belum lengkap!`;
                } else {
                    isMultiAccountMode = true;
                    replyText = `✅ *Mode diubah ke Dual-Account.* Bot memantau Akun 1 & Akun 2.`;
                    if (!isClient2Ready) {
                        logToDashboard('Menginisialisasi Akun 2 via perintah chat...');
                        client2.initialize().catch(err => {
                            logToDashboard(`Gagal inisialisasi Akun 2: ${err.message}`);
                        });
                    }
                }
            } else {
                replyText = `⚠️ *Format Salah.* Gunakan: \`#mode single\` or \`#mode dual\``;
            }
            triggerRedraw();
            break;

        case '#autosend':
            const state = args.toLowerCase().trim();
            if (state === 'on' || state === '1' || state === 'true') {
                isAutoSendEnabled = true;
                replyText = `✅ *Kirim Chat Otomatis AKTIF.* Bot akan otomatis mendaftar.`;
            } else if (state === 'off' || state === '0' || state === 'false') {
                isAutoSendEnabled = false;
                replyText = `✅ *Kirim Chat Otomatis NONAKTIF.* Bot hanya membunyikan alarm.`;
            } else {
                replyText = `⚠️ *Format Salah.* Gunakan: \`#autosend on\` atau \`#autosend off\``;
            }
            triggerRedraw();
            break;

        case '#reset':
            storeManager.writeStore(storeManager.defaultStore);
            replyText = `✅ *Status pendaftaran harian berhasil di-reset menjadi NULL.* Anda sekarang dapat mensimulasikan ulang pendaftaran hari ini.`;
            triggerRedraw();
            break;

        case '#setgroup':
            if (!args) {
                replyText = `⚠️ *Format Salah.* Gunakan: \`#setgroup <Nama atau JID Grup>\``;
            } else {
                const targetGroup = args.trim();
                saveToEnv('TARGET_GROUP_NAME', targetGroup);
                logToDashboard(`Grup target diubah via chat menjadi: "${targetGroup}"`);
                replyText = `✅ *Grup target diperbarui*: "${targetGroup}". Bot sedang mengunci JID grup baru...`;
                
                checkTargetJid().then(() => {
                    triggerRedraw();
                }).catch(e => {
                    logToDashboard(`Gagal mengunci JID grup baru: ${e.message}`);
                });
            }
            break;

        case '#ping':
            const msgTimestampMs = msg.timestamp * 1000;
            const latency = Date.now() - msgTimestampMs;
            replyText = `🏓 *PONG!*\n• *Latensi Respon*: ${latency} ms\n• *Status Bot*: Aktif & Memantau`;
            break;

        case '#log':
            if (!fs.existsSync(config.historyPath)) {
                replyText = `⚠️ *Gagal*: File log tidak ditemukan.`;
                break;
            }
            try {
                const logs = fs.readFileSync(config.historyPath, 'utf8');
                const logLines = logs.trim().split('\n');
                const lastLines = logLines.slice(-10).join('\n');
                replyText = `📋 *10 BARIS LOG TERAKHIR*:\n\`\`\`${lastLines}\`\`\``;
            } catch (err) {
                replyText = `⚠️ *Gagal membaca log*: ${err.message}`;
            }
            break;

        case '#uptime':
            const uptimeSeconds = process.uptime();
            const days = Math.floor(uptimeSeconds / (3600 * 24));
            const hours = Math.floor((uptimeSeconds % (3600 * 24)) / 3600);
            const minutes = Math.floor((uptimeSeconds % 3600) / 60);
            const seconds = Math.floor(uptimeSeconds % 60);

            const memoryUsage = process.memoryUsage();
            const rssMb = (memoryUsage.rss / (1024 * 1024)).toFixed(2);
            const heapTotalMb = (memoryUsage.heapTotal / (1024 * 1024)).toFixed(2);
            const heapUsedMb = (memoryUsage.heapUsed / (1024 * 1024)).toFixed(2);

            replyText = `🤖 *SISTEM STATS / UPTIME*\n` +
                        `• *Uptime*: ${days} Hari, ${hours} Jam, ${minutes} Menit, ${seconds} Detik\n` +
                        `• *RSS Memory*: ${rssMb} MB\n` +
                        `• *Heap Memory*: ${heapUsedMb} / ${heapTotalMb} MB\n` +
                        `• *Platform*: ${process.platform} (${process.arch})`;
            break;

        case '#restart':
            replyText = `🤖 *Bot sedang memulai ulang (shutdown)...* Jika dijalankan dengan PM2 atau skrip auto-restart, bot akan aktif kembali secara bersih dalam beberapa detik.`;
            try {
                await msg.reply(replyText);
                logToDashboard('Bot di-restart via perintah chat.');
                setTimeout(() => {
                    process.exit(0);
                }, 2000);
                return;
            } catch (err) {
                process.exit(0);
            }
            break;

        case '#ss':
        case '#ss1':
        case '#ss2': {
            const isTarget2 = command === '#ss2' || args.trim() === '2';
            const targetClient = isTarget2 ? client2 : client1;
            const targetLabel = isTarget2 ? 'AKUN 2' : 'AKUN 1';
            
            if (isTarget2 && !isMultiAccountMode) {
                replyText = `⚠️ *Gagal*: Akun 2 tidak aktif dalam mode saat ini.`;
                break;
            }

            try {
                const page = await targetClient.pupPage;
                if (!page) {
                    replyText = `⚠️ *Gagal*: Halaman browser ${targetLabel} tidak tersedia.`;
                    break;
                }

                logToDashboard(`Mengambil screenshot ${targetLabel}...`);
                const screenshotBase64 = await page.screenshot({ encoding: 'base64' });
                const media = new MessageMedia('image/png', screenshotBase64, 'screenshot.png');
                
                await msg.reply(media, undefined, { caption: `📸 *Screenshot halaman WhatsApp Web (${targetLabel})*` });
                logToDashboard(`Screenshot ${targetLabel} berhasil dikirim.`);
                return;
            } catch (err) {
                replyText = `⚠️ *Gagal mengambil screenshot ${targetLabel}*: ${err.message}`;
            }
            break;
        }

        default:
            return;
    }

    if (replyText) {
        try {
            await msg.reply(replyText);
            logToDashboard(`Perintah WA dieksekusi: ${command}`);
        } catch (e) {
            logToDashboard(`Gagal membalas perintah WA: ${e.message}`);
        }
    }
}

// Mendengarkan pesan masuk & pesan keluar (message_create) menggunakan client1 selaku Master
client1.on('message_create', async (msg) => {
    try {
        // Intersept perintah kendali jarak jauh (WhatsApp Command Center) dari pemilik bot
        if (msg.fromMe && msg.body && msg.body.trim().startsWith('#')) {
            await handleWhatsAppCommand(msg);
            return;
        }

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

        // 2. Deteksi apakah pengirim adalah salah satu admin yang dipantau
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
                    const chats = await client1.getChats();
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
                    const chats = await client1.getChats();
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
            
            let user1Sent = false;
            let textToSend1 = null;

            const regResult1 = registrator.processRegistration(messageText, 'user1');
            if (regResult1.success && regResult1.replyText) {
                textToSend1 = regResult1.replyText;
            }

            // Pasang pengaman (Safety Timeout) 3 detik untuk Akun 2
            const safetyTimeout = setTimeout(async () => {
                if (!user1Sent && config.user2.name) {
                    const store = storeManager.readStore();
                    const s2 = store.user2 || { status: 'NULL' };
                    if (s2.status !== 'WAITING_VERIFICATION' && s2.status !== 'ACCEPTED') {
                        logToDashboard('[WARNING] Akun 1 lambat/terhambat. Mendaftarkan Akun 2 secara mandiri...');
                        const regResult2 = registrator.processRegistration(messageText, 'user2');
                        if (regResult2.success && regResult2.replyText && isAutoSendEnabled) {
                            try {
                                await client2.sendMessage(msg.from, regResult2.replyText);
                                logToDashboard('[Akun 2] Pendaftaran mandiri berhasil terkirim!');
                            } catch (err) {
                                logToDashboard(`[Akun 2] Gagal mengirim pendaftaran mandiri: ${err.message}`);
                            }
                        }
                    }
                }
            }, 3000);

            if (regResult1.success && regResult1.replyText) {
                logToDashboard(`[Akun 1] Pendaftaran diproses: ${regResult1.message}`);

                logToDashboard('[Akun 1] Mengirim pendaftaran secara instan...');

                // Sinkronisasi detik terakhir menggunakan cache
                if (cache.length > 0) {
                    let lastCachedMsg = null;
                    for (let i = cache.length - 1; i >= 0; i--) {
                        if (cache[i].id !== msg.id._serialized) {
                            lastCachedMsg = cache[i];
                            break;
                        }
                    }

                    if (lastCachedMsg && parser.isShiftOpening(lastCachedMsg.body)) {
                        logToDashboard('[Akun 1] Sinkronisasi ulang pendaftar lain terdeteksi...');
                        if (parser.isUserAlreadyRegistered(lastCachedMsg.body, config.user1.name, config.user1.optId)) {
                            logToDashboard('[Akun 1] Batal kirim: Sudah didaftarkan oleh pendaftar lain.');
                            textToSend1 = null;
                        } else {
                            const syncReplyText = parser.registerUserInTemplate(lastCachedMsg.body, config.user1.name, config.user1.optId);
                            if (syncReplyText) {
                                textToSend1 = syncReplyText;
                            }
                        }
                    }
                }

                if (textToSend1) {
                    if (isAutoSendEnabled) {
                        try {
                            await client1.sendMessage(msg.from, textToSend1);
                            logToDashboard('[Akun 1] Pesan pendaftaran terkirim!');
                            user1Sent = true;
                            clearTimeout(safetyTimeout);
                            
                            // Pemicu pendaftaran Akun 2 berurutan secara terkoordinasi
                            await triggerAccount2Registration(textToSend1, msg.from);
                        } catch (err) {
                            logToDashboard(`[Akun 1] Gagal mengirim chat: ${err.message}`);
                        }
                    } else {
                        logToDashboard('[Akun 1] Pendaftaran terdeteksi (Mode Pantau Saja).');
                        user1Sent = true;
                        clearTimeout(safetyTimeout);
                        await triggerAccount2Registration(textToSend1, msg.from);
                    }
                } else {
                    // Akun 1 batal/tidak mendaftar, trigger Akun 2 dari teks asli
                    clearTimeout(safetyTimeout);
                    await triggerAccount2Registration(messageText, msg.from);
                }
            } else {
                logToDashboard(`[Akun 1] Dilewati: ${regResult1.message}`);
                clearTimeout(safetyTimeout);
                
                // Trigger Akun 2 langsung
                await triggerAccount2Registration(messageText, msg.from);
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
            
            // Verifikasi Akun 1
            const verResult1 = verification.processVerification(messageText, cache, quotedText, 'user1');
            if (verResult1.processed) {
                logToDashboard(`[Akun 1] Status terupdate menjadi: [${verResult1.status}]. Alasan: ${verResult1.reason}`);
            } else {
                logToDashboard(`[Akun 1] Verifikasi dilewati: ${verResult1.reason}`);
            }
            
            // Verifikasi Akun 2 jika terdaftar
            if (config.user2.name) {
                const verResult2 = verification.processVerification(messageText, cache, quotedText, 'user2');
                if (verResult2.processed) {
                    logToDashboard(`[Akun 2] Status terupdate menjadi: [${verResult2.status}]. Alasan: ${verResult2.reason}`);
                } else {
                    logToDashboard(`[Akun 2] Verifikasi dilewati: ${verResult2.reason}`);
                }
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

    // Pembersihan nomor HP agar fleksibel
    let processedValue = value;
    if (key === 'USER_HP' || key === 'USER1_HP' || key === 'USER2_HP') {
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
    if (key === 'USER_NAME' || key === 'USER1_NAME') {
        config.userName = processedValue;
    } else if (key === 'USER_OPT_ID' || key === 'USER1_OPT_ID') {
        config.userOptId = processedValue;
    } else if (key === 'USER_HP' || key === 'USER1_HP') {
        config.userHp = processedValue;
    } else if (key === 'USER2_NAME') {
        config.user2.name = processedValue;
    } else if (key === 'USER2_OPT_ID') {
        config.user2.optId = processedValue;
    } else if (key === 'USER2_HP') {
        config.user2.hp = processedValue;
    } else if (key === 'TARGET_GROUP_NAME') {
        config.targetGroupName = processedValue;
    } else if (key === 'MONITORED_ADMINS') {
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
        console.log('              SUB-MENU PENGATURAN BOT DUAL-AKUN');
        console.log('==================================================');
        console.log(`1. Nama Akun 1         [${config.user1.name || '(Kosong)'}]`);
        console.log(`2. OPT ID Akun 1       [${config.user1.optId || '(Kosong)'}]`);
        console.log(`3. No HP Akun 1        [${config.user1.hp || '(Kosong)'}]`);
        console.log(`4. Nama Akun 2         [${config.user2.name || '(Kosong)'}]`);
        console.log(`5. OPT ID Akun 2       [${config.user2.optId || '(Kosong)'}]`);
        console.log(`6. No HP Akun 2        [${config.user2.hp || '(Kosong)'}]`);
        console.log(`7. Nama Grup WA        [${config.targetGroupName || '(Kosong)'}]`);
        console.log('8. Rekam ID Admin Otomatis (Wizard)');
        console.log('9. Kembali ke Menu Utama');
        console.log('==================================================');

        const choice = await askQuestion('Pilih setelan yang ingin diubah (1-9): ');
        const trimmed = choice.trim();

        if (trimmed === '9') {
            break;
        }

        let key = '';
        let promptText = '';

        switch (trimmed) {
            case '1':
                key = 'USER1_NAME';
                promptText = `Masukkan Nama Pengguna Akun 1 [Saat ini: ${config.user1.name}]: `;
                break;
            case '2':
                key = 'USER1_OPT_ID';
                promptText = `Masukkan OPT ID Akun 1 [Saat ini: ${config.user1.optId}]: `;
                break;
            case '3':
                key = 'USER1_HP';
                promptText = `Masukkan Nomor HP Akun 1 [Saat ini: ${config.user1.hp}]: `;
                break;
            case '4':
                key = 'USER2_NAME';
                promptText = `Masukkan Nama Pengguna Akun 2 [Saat ini: ${config.user2.name}]: `;
                break;
            case '5':
                key = 'USER2_OPT_ID';
                promptText = `Masukkan OPT ID Akun 2 [Saat ini: ${config.user2.optId}]: `;
                break;
            case '6':
                key = 'USER2_HP';
                promptText = `Masukkan Nomor HP Akun 2 [Saat ini: ${config.user2.hp}]: `;
                break;
            case '7':
                key = 'TARGET_GROUP_NAME';
                promptText = `Masukkan Nama Grup WA Target [Saat ini: ${config.targetGroupName}]: `;
                break;
            case '8':
                await recordAdminJidWizard();
                continue;
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
 * Menampilkan sub-menu cadangkan / pulihkan sesi login (Anti-Limit)
 */
async function showBackupMenu() {
    while (true) {
        console.clear();
        console.log('\n==================================================');
        console.log('      SUB-MENU CADANGAN / PULIHKAN SESI (ANTI-LIMIT)');
        console.log('==================================================');
        console.log('1. Cadangkan Sesi Login Saat Ini (Backup)');
        console.log('2. Pulihkan Sesi Login dari Cadangan (Restore)');
        console.log('3. Kembali ke Menu Utama');
        console.log('==================================================');

        const choice = await askQuestion('Pilih Opsi (1-3): ');
        const trimmed = choice.trim();

        if (trimmed === '3') {
            break;
        }

        if (trimmed === '1') {
            backupManager.backupSession();
            await askQuestion('\nTekan ENTER untuk kembali...');
        } else if (trimmed === '2') {
            backupManager.restoreSession();
            await askQuestion('\nTekan ENTER untuk kembali...');
        } else {
            console.log('[ERROR] Pilihan tidak valid.');
            await askQuestion('\nTekan ENTER untuk kembali...');
        }
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
        console.log('3. Cadangkan / Pulihkan Sesi Login (Anti-Limit)');
        console.log('4. Reset Status Harian (Uji Coba Ulang)');
        console.log('5. Logout WhatsApp (Hapus Sesi)');
        console.log('6. Keluar');
        console.log('==================================================');

        const choice = await askQuestion('Pilih Menu (1-6): ');
        const trimmed = choice.trim();

        if (trimmed === '6') {
            console.log('[SYSTEM] Keluar dari program. Sampai jumpa!');
            process.exit(0);
        } else if (trimmed === '5') {
            logoutWhatsApp();
            await askQuestion('\nTekan ENTER untuk kembali ke Menu Utama...');
        } else if (trimmed === '4') {
            storeManager.writeStore(storeManager.defaultStore);
            console.log('\n[SUKSES] Status pendaftaran hari ini berhasil di-reset menjadi NULL.');
            console.log('[INFO] Anda sekarang dapat melakukan simulasi pendaftaran ulang hari ini.');
            await askQuestion('\nTekan ENTER untuk kembali ke Menu Utama...');
        } else if (trimmed === '3') {
            await showBackupMenu();
        } else if (trimmed === '2') {
            await showConfigMenu();
        } else if (trimmed === '1') {
            console.clear();
            console.log('\n==================================================');
            console.log('             PILIH MODE MONITORING BOT');
            console.log('==================================================');
            console.log('1. Single-Account (Hanya Akun 1/Master)');
            console.log('2. Dual-Account (Akun 1 & Akun 2 Terkoordinasi)');
            console.log('3. Kembali ke Menu Utama');
            console.log('==================================================');
            
            const modeChoice = await askQuestion('Pilih Opsi (1-3): ');
            const cleanModeChoice = modeChoice.trim();
            
            if (cleanModeChoice === '3') {
                continue;
            }
            
            if (cleanModeChoice === '1') {
                if (!config.user1.name || !config.user1.optId || !config.targetGroupName) {
                    console.log('\n[PERINGATAN] Konfigurasi Akun 1 belum lengkap! Silakan atur profil Anda terlebih dahulu.');
                    await askQuestion('\nTekan ENTER untuk kembali ke Menu Utama...');
                    continue;
                }
                isMultiAccountMode = false;
            } else if (cleanModeChoice === '2') {
                if (!config.user1.name || !config.user1.optId || !config.user2.name || !config.user2.optId || !config.targetGroupName) {
                    console.log('\n[PERINGATAN] Konfigurasi Akun 1 atau Akun 2 belum lengkap! Silakan lengkapi profil di Menu 2.');
                    await askQuestion('\nTekan ENTER untuk kembali ke Menu Utama...');
                    continue;
                }
                isMultiAccountMode = true;
            } else {
                console.log('[ERROR] Opsi tidak valid.');
                await askQuestion('\nTekan ENTER untuk kembali ke Menu Utama...');
                continue;
            }

            console.clear();
            console.log('\n[SYSTEM] Menginisialisasi koneksi WhatsApp Web...');
            client1.initialize().catch(err => {
                console.error('[ERROR] Gagal menginisialisasi client 1:', err);
            });
            break; // Keluar dari menu loop karena client sedang berjalan
        } else {
            console.log('[ERROR] Pilihan tidak valid.');
            await askQuestion('\nTekan ENTER untuk kembali ke Menu Utama...');
        }
    }
}

// Jalankan sistem menu utama
startSystem();
