const fs = require('fs');
const path = require('path');
const config = require('../config');

// Pastikan direktori database ada
const dbDir = path.dirname(config.historyPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

/**
 * Mencatat event penting sistem ke berkas log lokal.
 * @param {string} action - Kategori aksi (contoh: REGISTER, VERIFY, ERROR)
 * @param {string} details - Detail deskripsi kejadian
 * @returns {boolean}
 */
function logEvent(action, details) {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${action.toUpperCase()}] ${details}\n`;
    try {
        fs.appendFileSync(config.historyPath, logLine, 'utf8');
        return true;
    } catch (error) {
        console.error('Gagal menulis ke history.log:', error.message);
        return false;
    }
}

module.exports = {
    logEvent
};
