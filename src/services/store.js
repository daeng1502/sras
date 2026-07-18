const fs = require('fs');
const path = require('path');
const config = require('../config');

const defaultStore = {
    // Kompatibilitas Mundur (Single-User fallback)
    status: 'NULL',
    lastShiftDate: null,
    registeredShiftId: null,

    // Multi-Akun
    user1: {
        status: 'NULL',
        lastShiftDate: null,
        registeredShiftId: null
    },
    user2: {
        status: 'NULL',
        lastShiftDate: null,
        registeredShiftId: null
    }
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
        const parsed = JSON.parse(data);
        
        // Garansi struktur multi-akun ada
        if (!parsed.user1) parsed.user1 = { status: parsed.status || 'NULL', lastShiftDate: parsed.lastShiftDate || null, registeredShiftId: parsed.registeredShiftId || null };
        if (!parsed.user2) parsed.user2 = { status: 'NULL', lastShiftDate: null, registeredShiftId: null };
        
        return parsed;
    } catch (error) {
        console.error('Gagal membaca store.json, menggunakan data default:', error.message);
        return defaultStore;
    }
}

function writeStore(data) {
    try {
        // Sinkronisasi data user1 ke top-level untuk kompatibilitas mundur
        if (data.user1) {
            data.status = data.user1.status;
            data.lastShiftDate = data.user1.lastShiftDate;
            data.registeredShiftId = data.user1.registeredShiftId;
        }
        fs.writeFileSync(config.storePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('Gagal menulis ke store.json:', error.message);
        return false;
    }
}

function updateStatus(userKey, status, shiftId = null, dateStr = null) {
    let actualUserKey = userKey;
    let actualStatus = status;
    let actualShiftId = shiftId;
    let actualDateStr = dateStr;

    // Deteksi tanda parameter backward compatible: jika userKey bukan 'user1' atau 'user2', maka asumsikan single-user (user1)
    if (userKey !== 'user1' && userKey !== 'user2') {
        actualUserKey = 'user1';
        actualStatus = userKey;
        actualShiftId = status;
        actualDateStr = shiftId;
    }

    const store = readStore();
    if (!store[actualUserKey]) {
        store[actualUserKey] = {
            status: 'NULL',
            lastShiftDate: null,
            registeredShiftId: null
        };
    }
    
    store[actualUserKey].status = actualStatus;
    if (actualShiftId !== null) {
        store[actualUserKey].registeredShiftId = actualShiftId;
    }
    if (actualDateStr !== null) {
        store[actualUserKey].lastShiftDate = actualDateStr;
    } else if (actualStatus === 'ACCEPTED' || actualStatus === 'WAITING_VERIFICATION') {
        store[actualUserKey].lastShiftDate = new Date().toISOString().split('T')[0];
    }
    return writeStore(store);
}

module.exports = {
    readStore,
    writeStore,
    updateStatus,
    defaultStore
};
