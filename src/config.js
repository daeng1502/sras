const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const config = {
    userName: process.env.USER_NAME || process.env.USER1_NAME || '',
    userOptId: process.env.USER_OPT_ID || process.env.USER1_OPT_ID || '',
    userHp: (() => {
        let clean = (process.env.USER_HP || process.env.USER1_HP || '').replace(/[^0-9]/g, '');
        if (clean.startsWith('0')) {
            clean = '62' + clean.slice(1);
        }
        return clean;
    })(),
    user1: {
        get name() { return config.userName; },
        get optId() { return config.userOptId; },
        get hp() { return config.userHp; }
    },
    user2: {
        name: process.env.USER2_NAME || '',
        optId: process.env.USER2_OPT_ID || '',
        hp: (() => {
            let clean = (process.env.USER2_HP || '').replace(/[^0-9]/g, '');
            if (clean.startsWith('0')) {
                clean = '62' + clean.slice(1);
            }
            return clean;
        })()
    },
    targetGroupName: process.env.TARGET_GROUP_NAME || '',
    monitoredAdmins: (process.env.MONITORED_ADMINS || '')
        .split(',')
        .map(admin => admin.trim())
        .filter(admin => admin.length > 0)
        .map(admin => {
            let clean = admin;
            if (clean.startsWith('0')) {
                clean = '62' + clean.slice(1);
            }
            return clean.includes('@') ? clean : `${clean}@c.us`;
        }),
    storePath: path.join(__dirname, './database/store.json'),
    historyPath: path.join(__dirname, './database/history.log'),
    targetShiftKeywords: [],
    profiles: []
};

// Pemuatan Profil Dinamis
const profilesDir = path.join(__dirname, './profiles');
if (!fs.existsSync(profilesDir)) {
    fs.mkdirSync(profilesDir, { recursive: true });
}

// Cek migrasi dari .env
const u1Name = process.env.USER_NAME || process.env.USER1_NAME || '';
const u1OptId = process.env.USER_OPT_ID || process.env.USER1_OPT_ID || '';
const u1Hp = (() => {
    let clean = (process.env.USER_HP || process.env.USER1_HP || '').replace(/[^0-9]/g, '');
    if (clean.startsWith('0')) clean = '62' + clean.slice(1);
    return clean;
})();

const u2Name = process.env.USER2_NAME || '';
const u2OptId = process.env.USER2_OPT_ID || '';
const u2Hp = (() => {
    let clean = (process.env.USER2_HP || '').replace(/[^0-9]/g, '');
    if (clean.startsWith('0')) clean = '62' + clean.slice(1);
    return clean;
})();

let files = fs.readdirSync(profilesDir).filter(f => f.endsWith('.json'));
if (files.length === 0) {
    if (u1Name || u1OptId) {
        const p1 = { name: u1Name, optId: u1OptId, hp: u1Hp };
        fs.writeFileSync(path.join(profilesDir, 'user1.json'), JSON.stringify(p1, null, 2));
    }
    if (u2Name || u2OptId) {
        const p2 = { name: u2Name, optId: u2OptId, hp: u2Hp };
        fs.writeFileSync(path.join(profilesDir, 'user2.json'), JSON.stringify(p2, null, 2));
    }
    files = fs.readdirSync(profilesDir).filter(f => f.endsWith('.json'));
}

files.forEach(file => {
    try {
        const data = JSON.parse(fs.readFileSync(path.join(profilesDir, file), 'utf8'));
        if (data.name && data.optId) {
            let cleanHp = (data.hp || '').replace(/[^0-9]/g, '');
            if (cleanHp.startsWith('0')) {
                cleanHp = '62' + cleanHp.slice(1);
            }
            config.profiles.push({
                key: path.basename(file, '.json'),
                name: data.name,
                optId: data.optId,
                hp: cleanHp
            });
        }
    } catch (err) {
        console.error(`[ERROR] Gagal memuat profil ${file}:`, err.message);
    }
});

// Jika sesudah pemuatan file profil kosong (misal di test/ci environment), 
// gunakan data user1/user2 dari env sebagai fallback
if (config.profiles.length === 0) {
    if (config.userName && config.userOptId) {
        config.profiles.push({
            key: 'user1',
            name: config.userName,
            optId: config.userOptId,
            hp: config.userHp
        });
    }
    if (config.user2.name && config.user2.optId) {
        config.profiles.push({
            key: 'user2',
            name: config.user2.name,
            optId: config.user2.optId,
            hp: config.user2.hp
        });
    }
}

// Buat berkas template bantuan jika folder benar-benar kosong
if (fs.readdirSync(profilesDir).length === 0) {
    const example = {
        name: "Nama Pengguna",
        optId: "2015000",
        hp: "628123456789"
    };
    fs.writeFileSync(path.join(profilesDir, 'template_daeng.json.example'), JSON.stringify(example, null, 2));
}

module.exports = config;
