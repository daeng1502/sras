const path = require('path');
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
    targetShiftKeywords: []
};

module.exports = config;
