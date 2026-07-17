const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const config = {
    userName: process.env.USER_NAME || '',
    userOptId: process.env.USER_OPT_ID || '',
    userHp: (() => {
        let clean = (process.env.USER_HP || '').replace(/[^0-9]/g, '');
        if (clean.startsWith('0')) {
            clean = '62' + clean.slice(1);
        }
        return clean;
    })(),
    targetGroupName: process.env.TARGET_GROUP_NAME || '',

    storePath: path.join(__dirname, './database/store.json'),
    historyPath: path.join(__dirname, './database/history.log'),
    targetShiftKeywords: []
};

module.exports = config;
