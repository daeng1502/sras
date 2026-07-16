const fs = require('fs');
const path = require('path');
const config = require('../config');

const defaultStore = {
    status: 'NULL', // NULL, WAITING_VERIFICATION, ACCEPTED, REJECTED
    lastShiftDate: null, // YYYY-MM-DD
    registeredShiftId: null // ID/Nama shift terakhir
};

// Pastikan direktori database ada
const dbDir = path.dirname(config.storePath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

function readStore() {
    try {
        if (!fs.existsSync(config.storePath)) {
            writeStore(defaultStore);
            return defaultStore;
        }
        const data = fs.readFileSync(config.storePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Gagal membaca store.json, menggunakan data default:', error.message);
        return defaultStore;
    }
}

function writeStore(data) {
    try {
        fs.writeFileSync(config.storePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('Gagal menulis ke store.json:', error.message);
        return false;
    }
}

function updateStatus(status, shiftId = null, dateStr = null) {
    const store = readStore();
    store.status = status;
    if (shiftId !== null) {
        store.registeredShiftId = shiftId;
    }
    if (dateStr !== null) {
        store.lastShiftDate = dateStr;
    } else if (status === 'ACCEPTED' || status === 'WAITING_VERIFICATION') {
        // Default ke hari ini jika tidak dispesifikasikan
        store.lastShiftDate = new Date().toISOString().split('T')[0];
    }
    return writeStore(store);
}

module.exports = {
    readStore,
    writeStore,
    updateStatus,
    defaultStore
};
