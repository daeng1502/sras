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
        
        // Garansi struktur multi-akun dan profil baru ada
        if (!parsed.user1) {
            parsed.user1 = {
                status: parsed.status || 'NULL',
                lastShiftDate: parsed.lastShiftDate || null,
                registeredShiftId: parsed.registeredShiftId || null
            };
        }
        if (!parsed.user2) {
            parsed.user2 = { status: 'NULL', lastShiftDate: null, registeredShiftId: null };
        }
        
        // Garansi semua profil yang dimuat di config ada di store
        if (config.profiles && config.profiles.length > 0) {
            config.profiles.forEach(profile => {
                if (!parsed[profile.key]) {
                    // Coba migrasi dari user1 / user2 jika key-nya cocok
                    if (profile.key === 'user1' && parsed.user1) {
                        parsed[profile.key] = parsed.user1;
                    } else if (profile.key === 'user2' && parsed.user2) {
                        parsed[profile.key] = parsed.user2;
                    } else {
                        parsed[profile.key] = { status: 'NULL', lastShiftDate: null, registeredShiftId: null };
                    }
                }
            });
        }
        
        return parsed;
    } catch (error) {
        console.error('Gagal membaca store.json, menggunakan data default:', error.message);
        return defaultStore;
    }
}

function writeStore(data) {
    try {
        // Cari key untuk profil pertama (Master)
        const masterKey = (config.profiles && config.profiles[0]) ? config.profiles[0].key : 'user1';
        
        // Sinkronisasi data master ke top-level dan user1 untuk kompatibilitas mundur
        if (data[masterKey]) {
            data.status = data[masterKey].status;
            data.lastShiftDate = data[masterKey].lastShiftDate;
            data.registeredShiftId = data[masterKey].registeredShiftId;
            
            data.user1 = data[masterKey];
        }
        
        // Sinkronisasi data user2 jika ada
        const secondKey = (config.profiles && config.profiles[1]) ? config.profiles[1].key : 'user2';
        if (data[secondKey]) {
            data.user2 = data[secondKey];
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

    // Deteksi tanda parameter backward compatible:
    // Jika userKey bukan string profile key yang valid, lakukan pergeseran parameter (mapping ke master profile/user1)
    const validKeys = ['user1', 'user2', ...(config.profiles || []).map(p => p.key)];
    if (!validKeys.includes(userKey)) {
        actualUserKey = (config.profiles && config.profiles[0]) ? config.profiles[0].key : 'user1';
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
