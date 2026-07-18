const config = require('../config');

/**
 * Mengekstrak batas kuota pendaftar dari sebuah baris teks.
 * @param {string} line - Baris teks
 * @returns {number|null} - Batas kuota, atau null jika tidak terdeteksi
 */
function getQuotaFromLine(line) {
    if (!line) return null;
    const lowerLine = line.toLowerCase();
    
    // Pola 1: Format waktu diikuti angka kuota, misal "09.00 : 5" atau "09:00 : 5 orang"
    const timeQuotaMatch = line.match(/(?:\d{2}[.:]\d{2})\s*:\s*(\d+)/);
    if (timeQuotaMatch) {
        return parseInt(timeQuotaMatch[1], 10);
    }
    
    // Pola 2: Mengandung kata kunci kuota, misal "butuh 5 orang", "5 pax", "5 slots"
    const keywords = ['orang', 'org', 'pax', 'person', 'slot', 'butuh', 'kebutuhan'];
    const hasKeyword = keywords.some(kw => lowerLine.includes(kw));
    if (hasKeyword) {
        const numMatch = line.match(/\b(\d+)\b/);
        if (numMatch) {
            return parseInt(numMatch[1], 10);
        }
    }
    return null;
}

/**
 * Mengekstrak batas kuota pendaftar dari teks pesan admin secara keseluruhan.
 * @param {string} text - Teks pesan
 * @returns {number|null} - Batas kuota, atau null jika tidak terdeteksi
 */
function getQuota(text) {
    if (!text) return null;
    const lines = text.split('\n').map(line => line.trim());
    for (let line of lines) {
        const quota = getQuotaFromLine(line);
        if (quota !== null) return quota;
    }
    return null;
}

/**
 * Memecah teks pesan pendaftaran menjadi segmen-segmen blok shift.
 * @param {string} text - Teks pesan WhatsApp
 * @returns {Array} - Daftar objek blok shift
 */
function getBlocks(text) {
    const lines = text.split('\n');
    const blocks = [];
    let currentBlock = null;

    const timeQuotaRegex = /(?:\d{2}[.:]\d{2})/;
    const numberedLineRegex = /^\s*(\d+)\.(?!\d)\s*(.*)$/;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const isHeader = timeQuotaRegex.test(line) || line.toLowerCase().includes('orang') || line.toLowerCase().includes('pax');
        const isList = numberedLineRegex.test(line);

        if (isHeader && !isList) {
            if (currentBlock) {
                blocks.push(currentBlock);
            }
            currentBlock = {
                headerIndex: i,
                headerText: line,
                entries: []
            };
        } else if (isList && currentBlock) {
            currentBlock.entries.push({
                index: i,
                text: line
            });
        }
    }
    if (currentBlock) {
        blocks.push(currentBlock);
    }

    if (blocks.length === 0) {
        // Fallback: anggap seluruh teks sebagai satu block tunggal
        const entries = [];
        for (let i = 0; i < lines.length; i++) {
            if (numberedLineRegex.test(lines[i])) {
                entries.push({ index: i, text: lines[i] });
            }
        }
        blocks.push({
            headerIndex: -1,
            headerText: lines[0] || '',
            entries: entries
        });
    }

    return blocks;
}

/**
 * Memeriksa apakah pesan teks merupakan pembukaan shift baru.
 * @param {string} text - Teks pesan WhatsApp
 * @returns {boolean}
 */
function isShiftOpening(text) {
    if (!text) return false;
    const lowerText = text.toLowerCase();
    
    // 1. Validasi Kata Kunci Utama (Termasuk format admin baru: DW, provide, vendor, soc, pds, psd)
    const hasKeywords = lowerText.includes('shift') || 
                        lowerText.includes('daftar') || 
                        lowerText.includes('list') ||
                        lowerText.includes('opt id') ||
                        lowerText.includes('lowongan') ||
                        lowerText.includes('dw') ||
                        lowerText.includes('provide') ||
                        lowerText.includes('vendor') ||
                        lowerText.includes('soc') ||
                        lowerText.includes('pds') ||
                        lowerText.includes('psd');
                        
    if (!hasKeywords) return false;

    // 2. Dapatkan blok-blok shift
    const blocks = getBlocks(text);
    let hasAnyOpenSlot = false;
    let totalWordCount = 0;
    let totalFilledLines = 0;
    let matchingBlocksCount = 0;
    let matchingBlocksWithEntriesCount = 0;

    const lines = text.split('\n');
    const numberedLineRegex = /^\s*(\d+)\.(?!\d)\s*(.*)$/;
    const emptySlotRegex = /^\s*(\d+)\.\s*(?:-|_|\.|\s|\[\s*\])*$/;

    for (let block of blocks) {
        // Cek filter kata kunci target (jika dikonfigurasi)
        let matchesKeyword = true;
        if (config.targetShiftKeywords && config.targetShiftKeywords.length > 0) {
            const blockHeaderText = block.headerText.toLowerCase();
            
            // Dapatkan seluruh teks sebelum block ini dimulai (header global)
            let headerText = '';
            if (block.headerIndex > 0) {
                headerText = lines.slice(0, block.headerIndex).join('\n').toLowerCase();
            } else {
                headerText = extractShiftTitle(text).toLowerCase();
            }
            
            matchesKeyword = config.targetShiftKeywords.some(kw => 
                blockHeaderText.includes(kw) || headerText.includes(kw)
            );
        }

        if (!matchesKeyword) {
            continue; // Lewati blok ini jika tidak sesuai kriteria filter kata kunci target
        }

        matchingBlocksCount++;
        if (block.entries.length > 0) {
            matchingBlocksWithEntriesCount++;
        }

        let blockHasExplicitEmpty = false;
        let blockFilledCount = 0;

        for (let entry of block.entries) {
            if (emptySlotRegex.test(entry.text)) {
                blockHasExplicitEmpty = true;
            } else {
                const match = entry.text.match(numberedLineRegex);
                if (match && match[2].trim().length > 0) {
                    blockFilledCount++;
                    const content = match[2].trim();
                    const words = content.split(/\s+/).filter(w => w.length > 0);
                    totalWordCount += words.length;
                    totalFilledLines++;
                }
            }
        }

        // Cek kuota untuk block ini
        const quota = getQuotaFromLine(block.headerText);
        let blockHasImplicitEmpty = false;
        if (quota === null || blockFilledCount < quota) {
            blockHasImplicitEmpty = true;
        }

        if (blockHasExplicitEmpty || blockHasImplicitEmpty) {
            hasAnyOpenSlot = true;
        }
    }

    // Jika tidak ada satu pun blok yang cocok dengan kata kunci filter, tolak
    if (matchingBlocksCount === 0) return false;

    if (totalFilledLines === 0) {
        // Jika tidak ada list terisi sama sekali (baik karena kosong atau karena belum ada list),
        // maka ini otomatis dianggap sebagai slot terbuka yang sah.
        hasAnyOpenSlot = true;
    }

    // Jika tidak ada list bernomor sama sekali di semua blok yang cocok,
    // kita tolak HANYA jika tidak ada informasi batas kuota yang valid (contoh: "11.00 : 2 orang")
    if (matchingBlocksWithEntriesCount === 0) {
        let hasValidQuota = false;
        for (let block of blocks) {
            const quota = getQuotaFromLine(block.headerText);
            if (quota !== null && quota > 0) {
                hasValidQuota = true;
                break;
            }
        }
        if (!hasValidQuota) return false;
    }

    const averageWordCount = totalFilledLines > 0 ? (totalWordCount / totalFilledLines) : 0;

    // Rata-rata kata pendaftar tidak boleh terlalu panjang
    return hasAnyOpenSlot && averageWordCount <= 5;
}

/**
 * Memeriksa apakah nama pengguna atau OPT ID sudah terdaftar di dalam pesan teks.
 * @param {string} text - Teks pesan WhatsApp berisi daftar
 * @param {string} name - Nama pengguna
 * @param {string} optId - OPT ID pengguna
 * @returns {boolean}
 */
function isUserAlreadyRegistered(text, name, optId) {
    if (!text) return false;
    const cleanText = text.toLowerCase().replace(/\s+/g, ' ');
    const cleanName = name.toLowerCase().replace(/\s+/g, ' ');
    const cleanOptId = optId.toLowerCase().trim();

    return cleanText.includes(cleanName) || cleanText.includes(cleanOptId);
}

/**
 * Mengekstrak judul/ID shift dari pesan admin.
 * @param {string} text - Teks pesan WhatsApp
 * @returns {string}
 */
function extractShiftTitle(text) {
    if (!text) return 'Shift Tidak Dikenal';
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    const skipKeywords = ['dear team', 'dear all', 'dear team,', 'dear all,', 'hallo team', 'hallo all', 'dear', 'team'];
    // Cari baris pertama yang tidak dimulai dengan angka pendaftaran (misal "1.") dan bukan baris salam
    for (let line of lines) {
        if (!/^\s*\d+\.\s*/.test(line)) {
            const cleanLine = line.toLowerCase().replace(/[,.:]/g, '').trim();
            if (skipKeywords.includes(cleanLine) || cleanLine === 'dear team' || cleanLine === 'dear all') {
                continue; // Skip baris salam pembuka
            }
            return line;
        }
    }
    return lines[0] || 'Shift Baru';
}



/**
 * Menambahkan pengguna ke dalam list template dengan mempertahankan format persis menggunakan segmentasi blok.
 * @param {string} text - Teks pesan asli dari admin
 * @param {string} userName - Nama pengguna yang mendaftar
 * @param {string} userOptId - OPT ID pengguna
 * @returns {string|null} - Teks pesan baru yang sudah terisi nama, atau null jika gagal/penuh
 */
function registerUserInTemplate(text, userName, userOptId) {
    if (!text) return null;
    
    const lines = text.split('\n');
    const userRegistrationString = `${userName} ${userOptId}`;
    const blocks = getBlocks(text);
    
    const numberedLineRegex = /^\s*(\d+)\.(?!\d)\s*(.*)$/;
    const emptySlotRegex = /^\s*(\d+)\.\s*(?:-|_|\.|\s|\[\s*\])*$/;

    // Iterasi per blok untuk mencari tempat pendaftaran pertama yang tersedia
    for (let block of blocks) {
        // Cek filter kata kunci target (jika dikonfigurasi)
        let matchesKeyword = true;
        if (config.targetShiftKeywords && config.targetShiftKeywords.length > 0) {
            const blockHeaderText = block.headerText.toLowerCase();
            
            // Dapatkan seluruh teks sebelum block ini dimulai (header global)
            let headerText = '';
            if (block.headerIndex > 0) {
                headerText = lines.slice(0, block.headerIndex).join('\n').toLowerCase();
            } else {
                headerText = extractShiftTitle(text).toLowerCase();
            }
            
            matchesKeyword = config.targetShiftKeywords.some(kw => 
                blockHeaderText.includes(kw) || headerText.includes(kw)
            );
        }

        if (!matchesKeyword) {
            continue; // Skip block ini jika tidak cocok dengan kriteria filter kata kunci
        }

        // Skenario A: Cek apakah ada slot kosong eksplisit dalam blok ini
        for (let entry of block.entries) {
            if (emptySlotRegex.test(entry.text)) {
                const match = entry.text.match(numberedLineRegex);
                const number = match[1];
                lines[entry.index] = `${number}. ${userRegistrationString}`;
                return lines.join('\n');
            }
        }

        // Skenario B: Jika tidak ada slot kosong eksplisit, cek kuota vs pendaftar terisi
        const filledEntries = block.entries.filter(e => {
            const match = e.text.match(numberedLineRegex);
            return match && match[2].trim().length > 0 && !emptySlotRegex.test(e.text);
        });
        const filledCount = filledEntries.length;
        const quota = getQuotaFromLine(block.headerText);

        if (quota === null || filledCount < quota) {
            // Masih ada slot kosong implisit atau tidak ada batas kuota!
            const lastNumber = filledCount;
            const nextNumber = lastNumber + 1;
            const newLine = `${nextNumber}. ${userRegistrationString}`;
            
            // Sisipkan baris baru setelah entri terisi terakhir di blok ini
            let insertIndex;
            if (filledEntries.length > 0) {
                insertIndex = filledEntries[filledEntries.length - 1].index + 1;
            } else if (block.headerIndex !== -1) {
                insertIndex = block.headerIndex + 1;
            } else if (block.entries.length > 0) {
                insertIndex = block.entries[block.entries.length - 1].index + 1;
            } else {
                insertIndex = lines.length;
            }
            
            lines.splice(insertIndex, 0, newLine);
            return lines.join('\n');
        }
    }
    
    // Mengembalikan null jika seluruh blok shift sudah penuh atau tidak ada yang lolos kriteria kata kunci
    return null;
}

/**
 * Memeriksa apakah kuota peserta pendaftaran pada teks list telah terisi penuh.
 * @param {string} text - Teks list pendaftaran
 * @returns {boolean}
 */
function isQuotaFull(text) {
    if (!text) return false;

    // 1. Ekstrak judul shift (baris utama, contoh: "11.00 : 2 orang")
    const header = extractShiftTitle(text);
    if (!header || header === 'Shift Tidak Dikenal') return false;

    // 2. Cari angka kuota menggunakan RegEx penangkap angka kuota orang/org/pax
    const quotaMatch = header.match(/:?\s*(\d+)\s*(?:orang|org|pax)/i);
    if (!quotaMatch) return false;

    const quotaLimit = parseInt(quotaMatch[1], 10);
    if (isNaN(quotaLimit) || quotaLimit <= 0) return false;

    // 3. Hitung jumlah nama terdaftar di list (baris yang diawali angka, contoh: "1. Budi")
    const lines = text.split('\n');
    let registeredCount = 0;
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === header.trim()) continue; // Lewati baris judul shift/header
        if (/^\s*\d+\.\s*/.test(trimmed)) {
            registeredCount++;
        }
    }

    return registeredCount >= quotaLimit;
}

module.exports = {
    isShiftOpening,
    isUserAlreadyRegistered,
    extractShiftTitle,
    registerUserInTemplate,
    isQuotaFull
};
