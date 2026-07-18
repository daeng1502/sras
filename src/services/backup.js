const fs = require('fs');
const path = require('path');

// Folder sesi asli (.wwebjs_auth) di dalam root project sras
const sessionSrc = path.join(__dirname, '../../.wwebjs_auth');
// Folder cadangan sesi aman satu level di luar repositori Git agar bebas dari operasi Git
const sessionBackup = path.join(__dirname, '../../../sras_session_backup');

/**
 * Mencadangkan seluruh folder sesi login .wwebjs_auth ke folder aman di luar repositori Git.
 */
function backupSession() {
    if (!fs.existsSync(sessionSrc)) {
        console.log('\n[PERINGATAN] Sesi aktif (.wwebjs_auth) belum terbentuk. Silakan masuk menu 1 terlebih dahulu.');
        return false;
    }
    try {
        // Buat folder backup jika belum ada
        fs.mkdirSync(sessionBackup, { recursive: true });
        
        // Salin folder secara rekursif
        fs.cpSync(sessionSrc, sessionBackup, { recursive: true, force: true });
        console.log(`\n[SUKSES] Sesi login berhasil dicadangkan ke: ${sessionBackup}`);
        return true;
    } catch (error) {
        console.error('\n[ERROR] Gagal melakukan cadangan sesi:', error.message);
        return false;
    }
}

/**
 * Memulihkan seluruh folder sesi login dari folder cadangan aman ke dalam root project.
 */
function restoreSession() {
    if (!fs.existsSync(sessionBackup)) {
        console.log('\n[PERINGATAN] Folder cadangan (sras_session_backup) tidak ditemukan. Anda belum pernah membackup sesi.');
        return false;
    }
    try {
        // Buat folder tujuan jika belum ada
        fs.mkdirSync(sessionSrc, { recursive: true });
        
        // Salin balik secara rekursif
        fs.cpSync(sessionBackup, sessionSrc, { recursive: true, force: true });
        console.log(`\n[SUKSES] Sesi login berhasil dipulihkan dari: ${sessionBackup}`);
        return true;
    } catch (error) {
        console.error('\n[ERROR] Gagal memulihkan sesi login:', error.message);
        return false;
    }
}

module.exports = {
    backupSession,
    restoreSession
};
