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
const { exec } = require('child_process');
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
const alarm = require('./services/alarm');

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

// Inisialisasi WhatsApp Clients Dinamis berdasarkan berkas profil yang terdeteksi
const clients = [];
const clientReadyStates = {};

config.profiles.forEach(profile => {
    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: profile.key,
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
    
    client.profile = profile;
    clients.push(client);
    clientReadyStates[profile.key] = false;
});

// Referensi backward compatibility (untuk Jest unit tests dan legacy codes)
const client1 = clients[0] || null;
const client2 = clients[1] || null;

function setupClientListeners(clientInstance, userLabel, userHp) {
    clientInstance.on('qr', async (qr) => {
        let activeHp = userHp;

        // Jika single account dan dalam mode interaktif, tanyakan kepada pengguna opsi pengelolaan nomor HP
        if (!isMultiAccountMode && isInteractiveMode) {
            const currentHp = activeHp ? activeHp : 'Kosong (Menggunakan QR)';
            const answer = await askQuestion(`\n[INPUT - ${userLabel}] Nomor HP saat ini: ${currentHp}\nMasukkan nomor HP baru untuk menautkan perangkat\n(Tekan ENTER untuk tetap menggunakan nomor ini, atau ketik 'qr' untuk masuk dengan QR Code): `);
            const cleanAnswer = answer.trim().toLowerCase();
            
            if (cleanAnswer === 'qr') {
                activeHp = '';
                saveToEnv('USER1_HP', '');
                console.log('[INFO] Nomor HP dikosongkan. Bot akan memuat QR Code.');
            } else if (cleanAnswer !== '') {
                const cleanNumber = cleanAnswer.replace(/[^0-9]/g, '');
                if (cleanNumber) {
                    activeHp = cleanNumber.startsWith('0') ? '62' + cleanNumber.slice(1) : cleanNumber;
                    saveToEnv('USER1_HP', activeHp);
                    console.log(`[INFO] Nomor HP disimpan: ${activeHp}`);
                }
            }
        }

        if (activeHp) {
            console.log(`\n[LINKING - ${userLabel}] Meminta kode penautan untuk nomor HP: ${activeHp}...`);
            try {
                let code = null;
                let retries = 3;
                while (retries > 0) {
                    try {
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        code = await clientInstance.requestPairingCode(activeHp);
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

                // Kirim notifikasi sistem Android via Termux API
                const cleanCode = `${code.slice(0, 4)}-${code.slice(4)}`;
                exec(`termux-notification --title "SRAS Pairing Code (${userLabel})" --content "${cleanCode}" --id 999123 --priority high`, () => {});
            } catch (err) {
                console.error(`[ERROR - ${userLabel}] Gagal meminta kode penautan:`, err.message || err);
                console.log(`\n[FALLBACK - ${userLabel}] Beralih ke QR Code sebagai cadangan...`);
                qrcode.generate(qr, { small: true });

                // Kirim notifikasi sistem Android via Termux API
                exec(`termux-notification --title "SRAS QR Code (${userLabel})" --content "Pencadangan QR Code aktif. Buka terminal untuk memindai." --id 999124 --priority high`, () => {});
            }
        } else {
            console.log(`\n[QR - ${userLabel}] QR Code terdeteksi! Silakan pindai menggunakan WhatsApp HP Anda:`);
            qrcode.generate(qr, { small: true });

            // Kirim notifikasi sistem Android via Termux API
            exec(`termux-notification --title "SRAS QR Code (${userLabel})" --content "WhatsApp meminta pemindaian QR Code. Silakan buka terminal." --id 999124 --priority high`, () => {});
        }
    });

    clientInstance.on('authenticated', () => {
        console.log(`[AUTH - ${userLabel}] Autentikasi berhasil!`);
    });

    clientInstance.on('auth_failure', (msg) => {
        console.error(`[AUTH - ${userLabel}] Otentikasi gagal:`, msg);
        historyLogger.logEvent('ERROR', `Autentikasi gagal [${userLabel}]: ${msg}`);
    });

    clientInstance.on('disconnected', (reason) => {
        console.error(`[DISCONNECTED - ${userLabel}] Koneksi terputus:`, reason);
        historyLogger.logEvent('WARNING', `Koneksi terputus [${userLabel}]: ${reason}`);
        logToDashboard(`[WARNING] Koneksi ${userLabel} terputus: ${reason}. Mencoba menghubungkan kembali...`);
        
        setTimeout(() => {
            logToDashboard(`[RECONNECT - ${userLabel}] Menginisialisasi kembali koneksi...`);
            clientInstance.initialize().catch(err => {
                logToDashboard(`[RECONNECT-ERROR - ${userLabel}] Gagal: ${err.message}`);
            });
        }, 10000);
    });
}

// Pasang event listener ke seluruh client yang terdaftar
clients.forEach((client, idx) => {
    setupClientListeners(client, `AKUN ${idx + 1}`, client.profile.hp);
});

// Variabel state lokal
let targetGroupJid = null;
const groupMessageCache = {};
let isAutoSendEnabled = false;
let isMultiAccountMode = false;
let isInteractiveMode = true;

// State & Fungsionalitas Dasbor Kartu Vertikal
const recentLogs = [];
let redrawTimeout = null;

function triggerRedraw() {
    if (redrawTimeout) clearTimeout(redrawTimeout);
    redrawTimeout = setTimeout(() => {
        redrawDashboard();
    }, 50);
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
    
    output += '============================================================\x1B[K\n';
    if (isMultiAccountMode) {
        output += '             SRAS PANEL - MULTI-ACCOUNT MONITORING          \x1B[K\n';
    } else {
        output += '                 SRAS PANEL - MONITORING SHIFT              \x1B[K\n';
    }
    output += '============================================================\x1B[K\n';
    output += ` WAKTU: ${dateStr} ${timeStr} | BANYAK AKUN: ${isMultiAccountMode ? config.profiles.length : 1} | DATA: SAVED\x1B[K\n`;
    output += '------------------------------------------------------------\x1B[K\n';
    output += ' NO  NAMA     ID OPT    STATUS               SHIFT\x1B[K\n';
    output += '------------------------------------------------------------\x1B[K\n';

    const activeProfiles = isMultiAccountMode ? config.profiles : (config.profiles.slice(0, 1));
    activeProfiles.forEach((profile, idx) => {
        const pStatus = store[profile.key] || { status: 'NULL', registeredShiftId: null };
        const namePart = profile.name.slice(0, 8).padEnd(8);
        const optPart = profile.optId.slice(0, 9).padEnd(9);
        const statusPart = `[ ${pStatus.status} ]`.padEnd(20);
        const shiftPart = pStatus.registeredShiftId || '-';
        output += `  ${(idx + 1).toString().padEnd(2)} ${namePart} ${optPart} ${statusPart} ${shiftPart}\x1B[K\n`;
    });
    output += '  \x1B[K\n';
    
    output += ' KONFIGURASI MONITOR:\x1B[K\n';
    const kwString = config.targetShiftKeywords && config.targetShiftKeywords.length > 0
        ? config.targetShiftKeywords.join(', ')
        : 'Semua Shift (Tanpa Filter)';
    output += ` • Kata Kunci : ${kwString}\x1B[K\n`;
    const sendMode = isAutoSendEnabled 
        ? (isMultiAccountMode ? 'OTOMATIS (Cascading Auto-Register)' : 'OTOMATIS (Mode Auto-Register)')
        : 'PANTAU SAJA (Alarm Tanpa Chat)';
    output += ` • Kirim Chat : ${sendMode}\x1B[K\n`;
    output += ` • Target JID : ${targetGroupJid || config.targetGroupName || 'Mencari JID...'}\x1B[K\n`;
    
    output += '------------------------------------------------------------\x1B[K\n';
    output += ' AKTIVITAS TERBARU (LOG LOKAL):\x1B[K\n';
    if (recentLogs.length === 0) {
        output += ' (Belum ada aktivitas)\x1B[K\n';
    } else {
        recentLogs.forEach(log => {
            output += `  ${log}\x1B[K\n`;
        });
    }
    output += '============================================================\x1B[K\n';
    output += 'Tekan Ctrl+C untuk menghentikan pemantauan.\x1B[K\n';

    process.stdout.write(output);
    readline.clearScreenDown(process.stdout);
}

let isStarted = false;

async function checkTargetJid() {
    try {
        if (!config.targetGroupName) return;
        if (config.targetGroupName.endsWith('@g.us') || /^\d+-\d+@g\.us$/.test(config.targetGroupName)) {
            targetGroupJid = config.targetGroupName;
            return;
        }
        
        if (client1) {
            const chats = await client1.getChats();
            const targetChat = chats.find(c => c.isGroup && c.name && c.name.toLowerCase().includes(config.targetGroupName.toLowerCase()));
            if (targetChat) {
                targetGroupJid = targetChat.id._serialized;
                logToDashboard(`Target grup ditemukan: "${targetChat.name}" (JID: ${targetGroupJid})`);
            } else {
                logToDashboard(`[WARNING] Grup "${config.targetGroupName}" tidak ditemukan di chat list Client 1.`);
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
        console.log('        MEMULAI MONITORING SHIFT MULTI-AKUN');
    } else {
        console.log('          MEMULAI MONITORING SHIFT');
    }
    console.log('==================================================');
    config.profiles.forEach((profile, idx) => {
        console.log(`Akun ${idx + 1} (${profile.key}) : ${profile.name} (${profile.optId})`);
    });
    console.log(`Grup Target     : ${config.targetGroupName}`);

    let inputKeywords = [];
    if (isInteractiveMode) {
        const answer = await askQuestion('\n[INPUT] Masukkan kata kunci shift target (contoh: 11.00 atau malam, tekan ENTER untuk memantau semua): ');
        inputKeywords = answer.trim()
            .split(',')
            .map(kw => kw.trim().toLowerCase())
            .filter(kw => kw.length > 0);
    }

    if (inputKeywords.length > 0) {
        config.targetShiftKeywords = inputKeywords;
        console.log(`[INFO] Bot dikonfigurasi untuk HANYA menargetkan shift dengan kata kunci: "${inputKeywords.join(', ')}"`);
    } else {
        config.targetShiftKeywords = [];
        console.log('[INFO] Bot dikonfigurasi untuk memantau SEMUA shift (Tanpa filter spesifik).');
    }

    if (isInteractiveMode) {
        const autoSendAns = await askQuestion('\n[INPUT] Apakah ingin mengaktifkan Kirim Chat Otomatis? (y/N): ');
        const cleanAutoSend = autoSendAns.trim().toLowerCase();
        if (cleanAutoSend === 'y' || cleanAutoSend === 'yes') {
            isAutoSendEnabled = true;
            console.log('[INFO] MODE OTOMATIS aktif. Bot akan membunyikan alarm dan mengirim pendaftaran berurutan.');
        } else {
            isAutoSendEnabled = false;
            console.log('[INFO] MODE PANTAU SAJA aktif. Bot hanya akan membunyikan alarm tanpa mengirim chat otomatis.');
        }
    } else {
        isAutoSendEnabled = false;
    }

    historyLogger.logEvent('SYSTEM', 'Bot mulai memantau grup.');
    
    // Masuk ke mode Alternate Screen Buffer
    process.stdout.write('\x1B[?1049h\x1B[H');
    logToDashboard('Bot terhubung dan siap memantau grup.');
    
    setInterval(() => {
        triggerRedraw();
    }, 10000);

    setInterval(() => {
        if (global.gc) {
            try {
                global.gc();
                logToDashboard('RAM optimization: Garbage Collection force-triggered.');
            } catch (err) {}
        }
    }, 1800000);
}

// Bind ready listeners ke client yang aktif
clients.forEach((client, idx) => {
    client.on('ready', async () => {
        clientReadyStates[client.profile.key] = true;
        console.log(`\n[READY] WhatsApp Client ${idx + 1} (${client.profile.name}) siap!`);
        historyLogger.logEvent('SYSTEM', `Akun ${idx + 1} (${client.profile.name}) terhubung.`);

        const activeProfiles = isMultiAccountMode ? config.profiles : (config.profiles.slice(0, 1));
        const allReady = activeProfiles.every(p => clientReadyStates[p.key]);
        if (allReady) {
            startSystemMonitoring();
        }
    });
});

// Cascading Registration Queue
async function triggerCascadingRegistration(baseText, groupJid, index, lastRegisteredTemplateText = null) {
    if (!isMultiAccountMode || index >= clients.length) return;

    const client = clients[index];
    const profile = client.profile;
    
    const regResult = registrator.processRegistration(lastRegisteredTemplateText || baseText, profile.key);
    
    if (regResult.success) {
        if (!regResult.replyText) {
            logToDashboard(`[Akun ${index + 1}] Nama sudah terdaftar di list (Diabaikan).`);
            await triggerCascadingRegistration(baseText, groupJid, index + 1, lastRegisteredTemplateText);
            return;
        }

        const competitiveDelay = Math.floor(Math.random() * (1000 - 500 + 1)) + 500;
        logToDashboard(`[Akun ${index + 1}] Mengetik selama ${competitiveDelay / 1000} detik sebelum mengirim...`);
        
        await new Promise(resolve => setTimeout(resolve, competitiveDelay));

        let currentTemplateText = lastRegisteredTemplateText || baseText;
        if (isAutoSendEnabled) {
            try {
                await client.sendMessage(groupJid, regResult.replyText);
                logToDashboard(`[Akun ${index + 1}] Pendaftaran terkoordinasi berhasil terkirim!`);
                currentTemplateText = regResult.replyText;
            } catch (err) {
                logToDashboard(`[Akun ${index + 1}] Gagal mengirim pendaftaran: ${err.message}`);
            }
        } else {
            logToDashboard(`[Akun ${index + 1}] Pendaftaran dibunyikan (Mode Pantau Saja).`);
        }
        
        await triggerCascadingRegistration(baseText, groupJid, index + 1, currentTemplateText);
    } else {
        logToDashboard(`[Akun ${index + 1}] Dilewati: ${regResult.message}`);
        await triggerCascadingRegistration(baseText, groupJid, index + 1, lastRegisteredTemplateText);
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
                        `• \`#mode <single/multi>\` - Ganti mode akun\n` +
                        `• \`#autosend <on/off>\` - Toggle kirim pendaftaran otomatis\n` +
                        `• \`#setgroup <Nama/JID>\` - Ganti grup WA target\n` +
                        `• \`#reset\` - Reset status harian\n` +
                        `• \`#ss [indeks/nama]\` - Kirim screenshot halaman WA Web\n` +
                        `• \`#ping\` - Cek latensi respon bot\n` +
                        `• \`#log\` - Kirim 10 baris riwayat log terakhir\n` +
                        `• \`#uptime\` - Cek pemakaian RAM & durasi aktif bot\n` +
                        `• \`#backup\` - Cadangkan sesi login WA saat ini\n` +
                        `• \`#config <indeks/nama> <nama/optid/hp> <nilai baru>\` - Ubah profil\n` +
                        `• \`#wakelock <on/off>\` - Aktif/nonaktifkan Termux Wake Lock\n` +
                        `• \`#test\` - Uji coba suara alarm lokal\n` +
                        `• \`#restart\` - Restart bot secara jarak jauh\n` +
                        `• \`#help\` - Tampilkan bantuan ini`;
            break;

        case '#status': {
            const store = storeManager.readStore();
            const activeProfiles = isMultiAccountMode ? config.profiles : (config.profiles.slice(0, 1));
            const kwString = config.targetShiftKeywords && config.targetShiftKeywords.length > 0
                ? config.targetShiftKeywords.join(', ')
                : 'Semua Shift (Tanpa Filter)';
            const sendMode = isAutoSendEnabled ? 'AKTIF (Otomatis)' : 'NONAKTIF (Pantau Saja)';
            
            let statusText = `🤖 *STATUS MONITORING BOT*\n` +
                             `• Mode: ${isMultiAccountMode ? 'Multi-Account' : 'Single-Account'}\n` +
                             `• Grup Target: ${config.targetGroupName || 'Belum Diatur'}\n` +
                             `• Kata Kunci: ${kwString}\n` +
                             `• Pendaftaran: ${sendMode}\n\n` +
                             `📋 *STATUS AKUN*:\n`;
                             
            activeProfiles.forEach((profile, idx) => {
                const s = store[profile.key] || { status: 'NULL', registeredShiftId: null };
                statusText += `${idx + 1}. *${profile.name}* (${profile.optId})\n` +
                              `   └ Status: [ ${s.status} ]\n` +
                              `   └ Shift: ${s.registeredShiftId || '-'}\n`;
            });
            replyText = statusText;
            break;
        }

        case '#keyword':
            if (!args) {
                config.targetShiftKeywords = [];
                replyText = '✅ *Filter kata kunci shift telah dihapus.* Memantau semua shift.';
            } else {
                config.targetShiftKeywords = args.split(',').map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
                replyText = `✅ *Filter kata kunci shift diatur ke*: "${config.targetShiftKeywords.join(', ')}"`;
            }
            triggerRedraw();
            break;

        case '#mode': {
            const mode = args.toLowerCase().trim();
            if (mode === 'dual' || mode === 'multi') {
                isMultiAccountMode = true;
                replyText = '✅ *Mode Multi-Akun (N-Account) AKTIF.*';
                triggerRedraw();
                
                clients.forEach((client, idx) => {
                    if (!clientReadyStates[client.profile.key]) {
                        logToDashboard(`Menginisialisasi Akun ${idx + 1} (${client.profile.name})...`);
                        client.initialize().catch(err => {
                            logToDashboard(`Gagal menginisialisasi Akun ${idx + 1}: ${err.message}`);
                        });
                    }
                });
            } else if (mode === 'single') {
                isMultiAccountMode = false;
                replyText = '✅ *Mode Akun Tunggal (Single-Account) AKTIF.*';
                triggerRedraw();
            } else {
                replyText = '⚠️ *Gunakan:* `#mode <single/multi>`';
            }
            break;
        }

        case '#autosend':
            if (args.toLowerCase() === 'on') {
                isAutoSendEnabled = true;
                replyText = '✅ *Kirim Chat Otomatis AKTIF.* Bot akan otomatis melakukan pendaftaran.';
            } else if (args.toLowerCase() === 'off') {
                isAutoSendEnabled = false;
                replyText = '✅ *Kirim Chat Otomatis NONAKTIF.* Bot hanya membunyikan alarm (Mode Pantau).';
            } else {
                replyText = '⚠️ *Gunakan:* `#autosend <on/off>`';
            }
            triggerRedraw();
            break;

        case '#setgroup':
            if (!args) {
                replyText = '⚠️ *Format Salah.* Gunakan: `#setgroup <Nama Grup atau JID>`';
            } else {
                saveToEnv('TARGET_GROUP_NAME', args.trim());
                targetGroupJid = null;
                await checkTargetJid();
                replyText = `✅ *Grup Target berhasil diubah menjadi*: "${args.trim()}"`;
                triggerRedraw();
            }
            break;

        case '#reset':
            storeManager.writeStore(storeManager.defaultStore);
            replyText = '✅ *Status pendaftaran hari ini berhasil di-reset menjadi NULL.*';
            triggerRedraw();
            break;

        case '#ping': {
            const pingTime = Date.now() - msg.timestamp * 1000;
            replyText = `🏓 *Pong!*\n• Latensi Respon: *${pingTime}ms*\n• Status Sistem: *Sehat/Online*`;
            break;
        }

        case '#log':
            try {
                if (fs.existsSync(config.historyPath)) {
                    const logData = fs.readFileSync(config.historyPath, 'utf8');
                    const logLines = logData.trim().split('\n').slice(-10).join('\n');
                    replyText = `📋 *10 BARIS AKTIVITAS TERAKHIR*:\n\`\`\`\n${logLines}\n\`\`\``;
                } else {
                    replyText = '⚠️ *File log aktivitas tidak ditemukan.*';
                }
            } catch (err) {
                replyText = `⚠️ *Gagal membaca log*: ${err.message}`;
            }
            break;

        case '#uptime': {
            const usage = process.memoryUsage();
            const heapUsedMB = (usage.heapUsed / 1024 / 1024).toFixed(2);
            const rssMB = (usage.rss / 1024 / 1024).toFixed(2);
            const uptime = Math.floor(process.uptime());
            const hours = Math.floor(uptime / 3600);
            const minutes = Math.floor((uptime % 3600) / 60);
            const seconds = uptime % 60;
            const uptimeStr = `${hours}j ${minutes}m ${seconds}d`;

            replyText = `📊 *INFORMASI KESEHATAN BOT*:\n` +
                        `• Uptime Bot: *${uptimeStr}*\n` +
                        `• Penggunaan RSS RAM: *${rssMB} MB*\n` +
                        `• Heap Memory Terpakai: *${heapUsedMB} MB*\n` +
                        `• Sistem Operasi: *${process.platform}*`;
            break;
        }

        case '#backup':
            if (backupManager.backupSession()) {
                replyText = '✅ *Folder sesi login berhasil dicadangkan ke direktori aman luar git.*';
            } else {
                replyText = '⚠️ *Gagal mencadangkan sesi login. Silakan cek log lokal.*';
            }
            break;

        case '#config': {
            const configParts = args.split(/\s+/);
            const accountQuery = configParts[0] ? configParts[0].toLowerCase().trim() : '';
            const targetKey = configParts[1] ? configParts[1].toLowerCase().trim() : '';
            const targetVal = configParts.slice(2).join(' ').trim();

            if (!accountQuery || !targetKey || !targetVal) {
                replyText = `⚠️ *Format Salah.* Gunakan: \`#config <indeks/nama_akun> <nama/optid/hp> <nilai baru>\``;
                break;
            }

            let targetProfileIdx = -1;
            const idx = parseInt(accountQuery, 10);
            if (!isNaN(idx) && idx >= 1 && idx <= config.profiles.length) {
                targetProfileIdx = idx - 1;
            } else {
                targetProfileIdx = config.profiles.findIndex(p => p.name.toLowerCase().includes(accountQuery) || p.key.toLowerCase().includes(accountQuery));
            }

            if (targetProfileIdx === -1) {
                replyText = `⚠️ *Akun tidak ditemukan.* Gunakan nomor indeks (1-${config.profiles.length}) atau nama akun.`;
                break;
            }

            const targetProfile = config.profiles[targetProfileIdx];
            let jsonKey = '';
            switch (targetKey) {
                case 'nama':
                case 'name':
                    jsonKey = 'name';
                    break;
                case 'optid':
                case 'opt_id':
                    jsonKey = 'optId';
                    break;
                case 'hp':
                case 'phone':
                    jsonKey = 'hp';
                    break;
                default:
                    replyText = `⚠️ *Field tidak dikenal.* Gunakan salah satu dari: \`nama\`, \`optid\`, \`hp\``;
            }

            if (jsonKey) {
                let processedValue = targetVal;
                if (jsonKey === 'hp') {
                    processedValue = processedValue.replace(/[^0-9]/g, '');
                    if (processedValue.startsWith('0')) {
                        processedValue = '62' + processedValue.slice(1);
                    }
                }

                targetProfile[jsonKey] = processedValue;
                const profileFilePath = path.join(__dirname, './profiles', `${targetProfile.key}.json`);
                try {
                    fs.writeFileSync(profileFilePath, JSON.stringify({
                        name: targetProfile.name,
                        optId: targetProfile.optId,
                        hp: targetProfile.hp
                    }, null, 2), 'utf8');
                    
                    if (targetProfileIdx === 0) {
                        config.userName = targetProfile.name;
                        config.userOptId = targetProfile.optId;
                        config.userHp = targetProfile.hp;
                    } else if (targetProfileIdx === 1) {
                        config.user2.name = targetProfile.name;
                        config.user2.optId = targetProfile.optId;
                        config.user2.hp = targetProfile.hp;
                    }

                    replyText = `✅ *Profil ${targetProfile.name} (${targetKey}) berhasil diperbarui*: "${processedValue}"`;
                    triggerRedraw();
                } catch (err) {
                    replyText = `⚠️ *Gagal menulis perubahan ke disk*: ${err.message}`;
                }
            }
            break;
        }

        case '#ss': {
            let targetIdx = 0;
            if (args) {
                const cleanedArgs = args.trim().toLowerCase();
                const idx = parseInt(cleanedArgs, 10);
                if (!isNaN(idx) && idx >= 1 && idx <= clients.length) {
                    targetIdx = idx - 1;
                } else {
                    const matchIdx = clients.findIndex(c => c.profile.name.toLowerCase().includes(cleanedArgs) || c.profile.key.toLowerCase().includes(cleanedArgs));
                    if (matchIdx !== -1) {
                        targetIdx = matchIdx;
                    } else {
                        replyText = `⚠️ *Akun tidak ditemukan.* Gunakan nomor indeks (1-${clients.length}) atau nama akun.`;
                        break;
                    }
                }
            }

            const targetClient = clients[targetIdx];
            if (!targetClient) {
                replyText = `⚠️ *Gagal.* Client tidak aktif.`;
                break;
            }

            logToDashboard(`Mengambil screenshot untuk ${targetClient.profile.name}...`);
            try {
                if (targetClient.pupBrowser) {
                    const pages = await targetClient.pupBrowser.pages();
                    const page = pages.find(p => p.url().includes('web.whatsapp.com'));
                    if (page) {
                        const ssBuffer = await page.screenshot({ type: 'png' });
                        const base64 = ssBuffer.toString('base64');
                        const media = new MessageMedia('image/png', base64, 'screenshot.png');
                        await msg.reply(media);
                        logToDashboard(`Screenshot ${targetClient.profile.name} berhasil terkirim.`);
                        return;
                    } else {
                        replyText = `⚠️ *Halaman WhatsApp Web tidak ditemukan.*`;
                    }
                } else {
                    replyText = `⚠️ *Browser Puppeteer tidak aktif.*`;
                }
            } catch (err) {
                replyText = `⚠️ *Gagal mengambil screenshot*: ${err.message}`;
            }
            break;
        }

        case '#test':
            try {
                logToDashboard('Memicu pengujian alarm lokal...');
                alarm.triggerAlarm('ACCEPTED', 'Pengujian Alarm Jarak Jauh');
                replyText = `✅ *Pengujian alarm lokal dipicu.* HP/PC lokal seharusnya berbunyi atau bergetar sekarang.`;
            } catch (err) {
                replyText = `⚠️ *Gagal memicu alarm*: ${err.message}`;
            }
            break;

        case '#wakelock': {
            const state = args.toLowerCase().trim();
            if (state === 'on' || state === '1' || state === 'true' || !state) {
                exec('termux-wake-lock', (err) => {
                    if (err) {
                        msg.reply(`⚠️ *Gagal mengaktifkan Wake Lock*: ${err.message}. Pastikan bot berjalan di Termux Android.`);
                    } else {
                        msg.reply(`✅ *Termux Wake Lock AKTIF.* CPU HP tidak akan ditangguhkan oleh Android.`);
                    }
                });
                return;
            } else if (state === 'off' || state === '0' || state === 'false') {
                exec('termux-wake-unlock', (err) => {
                    if (err) {
                        msg.reply(`⚠️ *Gagal menonaktifkan Wake Lock*: ${err.message}`);
                    } else {
                        msg.reply(`✅ *Termux Wake Lock NONAKTIF.*`);
                    }
                });
                return;
            } else {
                replyText = `⚠️ *Format Salah.* Gunakan: \`#wakelock on\` atau \`#wakelock off\``;
            }
            break;
        }

        case '#restart':
            try {
                await msg.reply('🔄 *Bot sedang dimatikan untuk direstart...*');
                logToDashboard('SYSTEM RESTART dipicu jarak jauh. Mematikan proses...');
                setTimeout(() => {
                    process.exit(0);
                }, 1500);
            } catch (e) {
                process.exit(0);
            }
            return;

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

// Mendengarkan pesan masuk & pesan keluar menggunakan client1 selaku Master
if (client1) {
    client1.on('message_create', async (msg) => {
        try {
            if (msg.fromMe && msg.body && msg.body.trim().startsWith('#')) {
                await handleWhatsAppCommand(msg);
                return;
            }

            const groupJid = msg.from.endsWith('@g.us') ? msg.from : (msg.to && msg.to.endsWith('@g.us') ? msg.to : null);
            if (!groupJid) return;

            if (!groupMessageCache[groupJid]) {
                groupMessageCache[groupJid] = [];
            }
            
            const cache = groupMessageCache[groupJid];
            const msgId = (msg.id && msg.id._serialized) ? msg.id._serialized : Math.random().toString(36).slice(2);
            const isDuplicate = cache.some(m => m.id === msgId || (m.body === msg.body && Math.abs(m.timestamp - Date.now()) < 3000));
            if (!isDuplicate) {
                cache.push({
                    body: msg.body,
                    author: msg.author || msg.from,
                    id: msgId,
                    timestamp: Date.now()
                });
                if (cache.length > 10) cache.shift();
            }

            if (msg.fromMe) return;

            const senderId = msg.author;
            let senderContactNumber = '';
            try {
                const contact = await msg.getContact();
                senderContactNumber = contact.number || '';
            } catch (e) {}
            
            const senderIdNumber = senderId ? senderId.split('@')[0] : '';
            let isFromMonitoredAdmin = config.monitoredAdmins.some(adminJid => {
                const adminNumber = adminJid.split('@')[0];
                return adminJid === senderId || 
                       adminNumber === senderIdNumber || 
                       (senderContactNumber && adminNumber === senderContactNumber);
            });

            let isMessageFromTargetGroup = false;
            if (targetGroupJid && msg.from === targetGroupJid) {
                isMessageFromTargetGroup = true;
            } else {
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
                    } catch (err) {}
                }
            }

            if (isMessageFromTargetGroup && !isFromMonitoredAdmin) {
                const isPotentialShift = parser.isShiftOpening(msg.body);
                let isPotentialVerification = verification.isVerificationMessage(msg.body);

                if (msg.hasQuotedMsg && !isPotentialVerification) {
                    try {
                        const quotedMsg = await msg.getQuotedMessage();
                        if (parser.isShiftOpening(quotedMsg.body) && parser.isQuotaFull(quotedMsg.body)) {
                            isPotentialVerification = true;
                        }
                    } catch (e) {}
                }

                if (isPotentialShift || isPotentialVerification) {
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
                    } catch (e) {}

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

            if (!targetGroupJid || msg.from !== targetGroupJid) {
                return;
            }

            const cleanSenderNumber = msg.author ? msg.author.split('@')[0] : msg.from.split('@')[0];
            const cleanBody = msg.body ? msg.body.replace(/\n/g, ' ').slice(0, 30) : '';
            const roleLabel = isFromMonitoredAdmin ? 'Admin' : 'Member';
            logToDashboard(`[${roleLabel}] ${cleanSenderNumber}: "${cleanBody}..."`);

            if (!isFromMonitoredAdmin) return;

            const messageText = msg.body;

            // Deteksi Pembukaan Shift Kerja Baru
            if (parser.isShiftOpening(messageText)) {
                logToDashboard('Pesan pembukaan shift baru terdeteksi!');
                
                let masterSent = false;
                let textToSend1 = null;

                // Verifikasi Master (Client 1)
                const regResult1 = registrator.processRegistration(messageText, client1.profile.key);
                if (regResult1.success && regResult1.replyText) {
                    textToSend1 = regResult1.replyText;
                }

                // Pasang pengaman (Safety Timeout) 3 detik untuk Akun lainnya jika Master lambat/koneksi terputus
                const safetyTimeout = setTimeout(async () => {
                    if (!masterSent && clients.length > 1) {
                        logToDashboard('[WARNING] Akun 1 (Master) lambat/terhambat. Mendaftarkan akun-akun lain secara mandiri...');
                        await triggerCascadingRegistration(messageText, msg.from, 1);
                    }
                }, 3000);

                if (regResult1.success && regResult1.replyText) {
                    logToDashboard(`[Akun 1] Pendaftaran diproses: ${regResult1.message}`);
                    logToDashboard('[Akun 1] Mengirim pendaftaran secara instan...');

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
                            if (parser.isUserAlreadyRegistered(lastCachedMsg.body, client1.profile.name, client1.profile.optId)) {
                                logToDashboard('[Akun 1] Batal kirim: Sudah didaftarkan oleh pendaftar lain.');
                                textToSend1 = null;
                            } else {
                                const syncReplyText = parser.registerUserInTemplate(lastCachedMsg.body, client1.profile.name, client1.profile.optId);
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
                                masterSent = true;
                                clearTimeout(safetyTimeout);
                                await triggerCascadingRegistration(textToSend1, msg.from, 1);
                            } catch (err) {
                                logToDashboard(`[Akun 1] Gagal mengirim chat: ${err.message}`);
                            }
                        } else {
                            logToDashboard('[Akun 1] Pendaftaran terdeteksi (Mode Pantau Saja).');
                            masterSent = true;
                            clearTimeout(safetyTimeout);
                            await triggerCascadingRegistration(textToSend1, msg.from, 1);
                        }
                    } else {
                        clearTimeout(safetyTimeout);
                        await triggerCascadingRegistration(messageText, msg.from, 1);
                    }
                } else {
                    logToDashboard(`[Akun 1] Dilewati: ${regResult1.message}`);
                    clearTimeout(safetyTimeout);
                    await triggerCascadingRegistration(messageText, msg.from, 1);
                }
                return;
            }

            // Deteksi Pengumuman Hasil Verifikasi/Seleksi Admin
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
                } catch (err) {}
            }

            let shouldVerify = isVerifyMsg;
            if (quotedText && (isVerifyMsg || parser.isQuotaFull(quotedText))) {
                shouldVerify = true;
            }

            if (shouldVerify) {
                logToDashboard('Hasil verifikasi/seleksi terdeteksi!');
                clients.forEach((client, idx) => {
                    const verResult = verification.processVerification(messageText, cache, quotedText, client.profile.key);
                    if (verResult.processed) {
                        logToDashboard(`[Akun ${idx + 1}] Status terupdate menjadi: [${verResult.status}]. Alasan: ${verResult.reason}`);
                    } else {
                        logToDashboard(`[Akun ${idx + 1}] Verifikasi dilewati: ${verResult.reason}`);
                    }
                });
            }

        } catch (error) {
            console.error('[ERROR] Terjadi kesalahan dalam memproses pesan:', error);
            historyLogger.logEvent('ERROR', `Kesalahan runtime: ${error.message}`);
        }
    });
}

// Menangani crash/error tak terduga agar bot tetap tangguh
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    historyLogger.logEvent('ERROR', `Unhandled Rejection: ${reason}`);
});

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

function saveToEnv(key, value) {
    const envPath = path.join(__dirname, '../.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, 'utf8');
    }

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

function logoutWhatsApp() {
    const authPath = path.join(__dirname, '../.wwebjs_auth');
    if (fs.existsSync(authPath)) {
        fs.rmSync(authPath, { recursive: true, force: true });
        console.log('\n[SUKSES] Sesi WhatsApp lokal berhasil dihapus (Logout sukses).');
    } else {
        console.log('\n[INFO] Sesi WhatsApp memang belum terdaftar.');
    }
}

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
            clientId: 'temp_wizard',
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
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--disable-extensions',
                '--mute-audio',
                '--disk-cache-size=10485760'
            ]
        }
    });

    let wizardFinished = false;
    let wizardTargetGroupJid = null;
    let matchedGroupName = config.targetGroupName;

    await new Promise((resolve) => {
        tempClient.on('qr', (qr) => {
            console.log('\n[QR - WIZARD] Sesi sementara membutuhkan login. Silakan scan QR ini:');
            qrcode.generate(qr, { small: true });
        });

        tempClient.on('message', async (msg) => {
            try {
                let isTargetGroup = false;
                if (wizardTargetGroupJid && msg.from === wizardTargetGroupJid) {
                    isTargetGroup = true;
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
                    } catch (e) {}
                }

                if (isTargetGroup) {
                    const senderId = msg.author;
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
                        console.log(`[SUKSES] ID Admin berhasil disimpan!`);

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
                console.log(`[WIZARD] Mencari JID grup target "${config.targetGroupName}"...`);
                const chats = await tempClient.getChats();
                const targetChat = chats.find(c => c.isGroup && c.name && c.name.toLowerCase().includes(config.targetGroupName.toLowerCase()));
                if (targetChat) {
                    wizardTargetGroupJid = targetChat.id._serialized;
                    console.log(`[WIZARD] Target grup berhasil ditemukan! JID: "${wizardTargetGroupJid}"`);
                }
            } catch (e) {}
            console.log(`\n[WIZARD] Silakan minta Admin mengirim chat di grup target "${config.targetGroupName}".`);
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

// Menampilkan sub-menu pengaturan konfigurasi
async function showConfigMenu() {
    while (true) {
        console.clear();
        console.log('\n==================================================');
        console.log('              SUB-MENU PENGATURAN PROFIL AKUN');
        console.log('==================================================');
        
        config.profiles.forEach((profile, idx) => {
            console.log(`${idx + 1}. Edit Profil: ${profile.name} (${profile.optId}) - HP: ${profile.hp || 'QR Code'}`);
        });
        
        console.log(`${config.profiles.length + 1}. Tambah Akun Baru (Tambah Profil)`);
        console.log(`${config.profiles.length + 2}. Atur Nama Grup WA Target [Saat ini: ${config.targetGroupName || 'Kosong'}]`);
        console.log(`${config.profiles.length + 3}. Rekam ID Admin Otomatis (Wizard)`);
        console.log(`${config.profiles.length + 4}. Kembali ke Menu Utama`);
        console.log('==================================================');

        const choice = await askQuestion(`Pilih setelan yang ingin diubah (1-${config.profiles.length + 4}): `);
        const trimmed = choice.trim();
        const selectIdx = parseInt(trimmed, 10);

        if (isNaN(selectIdx)) {
            console.log('[ERROR] Pilihan tidak valid.');
            await askQuestion('\nTekan ENTER untuk melanjutkan...');
            continue;
        }

        if (selectIdx === config.profiles.length + 4) {
            break;
        }

        if (selectIdx === config.profiles.length + 1) {
            console.clear();
            console.log('\n==================================================');
            console.log('                 TAMBAH AKUN BARU');
            console.log('==================================================');
            const name = await askQuestion('Masukkan Nama Pengguna Baru: ');
            const optId = await askQuestion('Masukkan OPT ID Baru: ');
            const hp = await askQuestion('Masukkan Nomor HP Baru (Kosongkan jika ingin QR Code): ');
            
            const cleanName = name.trim();
            const cleanOptId = optId.trim();
            let cleanHp = hp.replace(/[^0-9]/g, '');
            if (cleanHp.startsWith('0')) {
                cleanHp = '62' + cleanHp.slice(1);
            }

            if (!cleanName || !cleanOptId) {
                console.log('[ERROR] Nama dan OPT ID wajib diisi!');
                await askQuestion('\nTekan ENTER untuk kembali...');
                continue;
            }

            const fileKey = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '_');
            const newProfile = { name: cleanName, optId: cleanOptId, hp: cleanHp };
            const profileFilePath = path.join(__dirname, './profiles', `${fileKey}.json`);
            
            fs.writeFileSync(profileFilePath, JSON.stringify(newProfile, null, 2), 'utf8');
            console.log(`\n[SUKSES] Profil baru "${cleanName}" berhasil dibuat!`);
            
            config.profiles.push({
                key: fileKey,
                name: cleanName,
                optId: cleanOptId,
                hp: cleanHp
            });
            
            const client = new Client({
                authStrategy: new LocalAuth({
                    clientId: fileKey,
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
            client.profile = { key: fileKey, name: cleanName, optId: cleanOptId, hp: cleanHp };
            clients.push(client);
            clientReadyStates[fileKey] = false;
            
            setupClientListeners(client, `AKUN ${clients.length}`, cleanHp);

            await askQuestion('\nTekan ENTER untuk kembali...');
            continue;
        }

        if (selectIdx === config.profiles.length + 2) {
            const newGroup = await askQuestion(`Masukkan Nama Grup WA Target [Saat ini: ${config.targetGroupName}]: `);
            saveToEnv('TARGET_GROUP_NAME', newGroup.trim());
            console.log(`\n[SUKSES] Grup target berhasil diubah.`);
            await askQuestion('\nTekan ENTER untuk kembali...');
            continue;
        }

        if (selectIdx === config.profiles.length + 3) {
            await recordAdminJidWizard();
            continue;
        }

        if (selectIdx >= 1 && selectIdx <= config.profiles.length) {
            const profile = config.profiles[selectIdx - 1];
            console.clear();
            console.log('\n==================================================');
            console.log(`             EDIT PROFIL: ${profile.name}`);
            console.log('==================================================');
            console.log(`1. Nama Pengguna    [Saat ini: ${profile.name}]`);
            console.log(`2. OPT ID           [Saat ini: ${profile.optId}]`);
            console.log(`3. Nomor HP         [Saat ini: ${profile.hp || '(Kosong/QR Code)'}]`);
            console.log(`4. Hapus Profil Akun Ini`);
            console.log(`5. Batal`);
            console.log('==================================================');

            const editChoice = await askQuestion('Pilih setelan (1-5): ');
            const cleanEditChoice = editChoice.trim();

            if (cleanEditChoice === '5') continue;

            if (cleanEditChoice === '4') {
                const confirm = await askQuestion(`Apakah Anda yakin ingin menghapus profil "${profile.name}"? (y/N): `);
                if (confirm.trim().toLowerCase() === 'y') {
                    const filePath = path.join(__dirname, './profiles', `${profile.key}.json`);
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                    console.log(`\n[SUKSES] Profil "${profile.name}" berhasil dihapus.`);
                    
                    config.profiles.splice(selectIdx - 1, 1);
                    const clientIdx = clients.findIndex(c => c.profile.key === profile.key);
                    if (clientIdx !== -1) {
                        try {
                            await clients[clientIdx].destroy();
                        } catch (e) {}
                        clients.splice(clientIdx, 1);
                    }
                    delete clientReadyStates[profile.key];

                    await askQuestion('\nTekan ENTER untuk kembali...');
                }
                continue;
            }

            let fieldKey = '';
            let fieldLabel = '';
            let valPrompt = '';

            if (cleanEditChoice === '1') {
                fieldKey = 'name';
                fieldLabel = 'Nama Pengguna';
                valPrompt = `Masukkan Nama Baru [Saat ini: ${profile.name}]: `;
            } else if (cleanEditChoice === '2') {
                fieldKey = 'optId';
                fieldLabel = 'OPT ID';
                valPrompt = `Masukkan OPT ID Baru [Saat ini: ${profile.optId}]: `;
            } else if (cleanEditChoice === '3') {
                fieldKey = 'hp';
                fieldLabel = 'Nomor HP';
                valPrompt = `Masukkan Nomor HP Baru [Saat ini: ${profile.hp || 'QR Code'}]: `;
            } else {
                console.log('[ERROR] Pilihan tidak valid.');
                await askQuestion('\nTekan ENTER untuk kembali...');
                continue;
            }

            const val = await askQuestion(valPrompt);
            let processedVal = val.trim();
            if (fieldKey === 'hp') {
                processedVal = processedVal.replace(/[^0-9]/g, '');
                if (processedVal.startsWith('0')) {
                    processedVal = '62' + processedVal.slice(1);
                }
            }

            profile[fieldKey] = processedVal;
            
            const filePath = path.join(__dirname, './profiles', `${profile.key}.json`);
            fs.writeFileSync(filePath, JSON.stringify({
                name: profile.name,
                optId: profile.optId,
                hp: profile.hp
            }, null, 2), 'utf8');

            if (selectIdx - 1 === 0) {
                if (fieldKey === 'name') config.userName = processedVal;
                if (fieldKey === 'optId') config.userOptId = processedVal;
                if (fieldKey === 'hp') config.userHp = processedVal;
            } else if (selectIdx - 1 === 1) {
                if (fieldKey === 'name') config.user2.name = processedVal;
                if (fieldKey === 'optId') config.user2.optId = processedVal;
                if (fieldKey === 'hp') config.user2.hp = processedVal;
            }

            console.log(`\n[SUKSES] Konfigurasi ${fieldLabel} berhasil diperbarui.`);
            await askQuestion('\nTekan ENTER untuk kembali...');
        }
    }
}

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

        if (trimmed === '3') break;

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

async function startSystem() {
    const hasBasicConfig = config.profiles && config.profiles.length > 0 && config.targetGroupName;
    
    if (hasBasicConfig) {
        console.clear();
        console.log('\n==================================================');
        console.log('       AUTOBOT STARTUP - BOT REGISTRASI SHIFT');
        console.log('==================================================');
        console.log('Ketik "m" dan tekan ENTER untuk masuk Menu Utama manual.');
        console.log('Jika tidak ada respon, bot akan otomatis memulai monitoring...\n');

        let countdown = 5;
        let cancelled = false;

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const timer = setInterval(() => {
            if (countdown > 0 && !cancelled) {
                process.stdout.write(`\r⏱️ [AUTOBOT] Memulai monitoring otomatis dalam ${countdown} detik... `);
                countdown--;
            } else if (!cancelled) {
                clearInterval(timer);
                rl.close();
                process.stdout.write('\r\n[AUTOBOT] Memulai inisialisasi otomatis...\n');
                
                isMultiAccountMode = false;
                isInteractiveMode = false;
                
                console.log(`[AUTOBOT] Mode: ${isMultiAccountMode ? 'Multi-Account' : 'Single-Account'}`);
                if (clients.length > 0) {
                    clients[0].initialize().catch(err => {
                        console.error('[ERROR] Gagal mengaktifkan client 1 secara otomatis:', err);
                    });
                }
            }
        }, 1000);

        await new Promise((resolve) => {
            rl.on('line', (line) => {
                if (line.trim().toLowerCase() === 'm') {
                    cancelled = true;
                    clearInterval(timer);
                    rl.close();
                    console.log('\n[STARTUP] Membatalkan auto-boot. Memuat Menu Utama...');
                    resolve();
                }
            });
            setTimeout(() => {
                if (!cancelled) resolve();
            }, 6000);
        });

        if (cancelled) {
            await showMainMenuLoop();
        }
    } else {
        await showMainMenuLoop();
    }
}

async function showMainMenuLoop() {
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
            console.log('2. Multi-Account (Seluruh Profil yang Terdaftar)');
            console.log('3. Kembali ke Menu Utama');
            console.log('==================================================');
            
            const modeChoice = await askQuestion('Pilih Opsi (1-3): ');
            const cleanModeChoice = modeChoice.trim();
            
            if (cleanModeChoice === '3') continue;
            
            if (cleanModeChoice === '1') {
                if (clients.length === 0 || !config.targetGroupName) {
                    console.log('\n[PERINGATAN] Profil atau nama grup target belum dikonfigurasi!');
                    await askQuestion('\nTekan ENTER untuk kembali ke Menu Utama...');
                    continue;
                }
                isMultiAccountMode = false;
            } else if (cleanModeChoice === '2') {
                if (clients.length === 0 || !config.targetGroupName) {
                    console.log('\n[PERINGATAN] Profil atau nama grup target belum dikonfigurasi!');
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
            const activeClients = isMultiAccountMode ? clients : (clients.slice(0, 1));
            
            for (const client of activeClients) {
                try {
                    await client.initialize();
                } catch (err) {
                    console.error(`[ERROR] Gagal menginisialisasi client ${client.profile.name}:`, err);
                }
            }
            break;
        } else {
            console.log('[ERROR] Pilihan tidak valid.');
            await askQuestion('\nTekan ENTER untuk kembali ke Menu Utama...');
        }
    }
}

// Jalankan sistem menu utama
startSystem();
