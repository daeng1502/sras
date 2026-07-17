const parser = require('../src/services/parser');
const config = require('../src/config');

describe('Parser Service Tests', () => {
    
    beforeEach(() => {
        // Reset kata kunci filter setiap kali memulai pengujian baru
        config.targetShiftKeywords = [];
    });

    describe('isShiftOpening', () => {
        test('harus mendeteksi pesan pembukaan shift dengan benar', () => {
            const msg = `Daftar Shift Pagi 16 Juli:\n1.\n2.\n3.`;
            expect(parser.isShiftOpening(msg)).toBe(true);
        });

        test('harus mengabaikan pesan chat biasa tanpa daftar bernomor', () => {
            const msg = 'Halo semuanya, tolong siap-siap ya untuk shift pagi.';
            expect(parser.isShiftOpening(msg)).toBe(false);
        });

        test('harus mengabaikan pesan kosong', () => {
            expect(parser.isShiftOpening('')).toBe(false);
            expect(parser.isShiftOpening(null)).toBe(false);
        });

        test('harus mendeteksi pembukaan shift dengan kuota tanpa slot kosong eksplisit (Skenario B)', () => {
            const msg = `Dear Team\nProvide DW SOC Padang Under Vendor [PSD]\n16 Juli 2026\n\n09.00 : 5 orang\n1. budi 12345\n2. andi 87654`;
            expect(parser.isShiftOpening(msg)).toBe(true);
        });

        test('harus mengabaikan pembukaan shift jika pendaftaran sudah penuh sesuai batas kuota', () => {
            const msg = `Dear Team\nProvide DW SOC Padang Under Vendor [PSD]\n16 Juli 2026\n\n09.00 : 2 orang\n1. budi 12345\n2. andi 87654`;
            expect(parser.isShiftOpening(msg)).toBe(false);
        });

        test('harus mendeteksi pembukaan shift jika salah satu shift dalam multi-shift masih belum penuh', () => {
            const msg = `Dear Team\nProvide DW SOC Padang Under Vendor [PSD]\n16 Juli 2026\n\n09.00 : 2 orang\n1. budi 12345\n2. andi 87654\n\n11.00 : 2 orang\n1. cika 55555`;
            expect(parser.isShiftOpening(msg)).toBe(true);
        });

        test('harus mengabaikan pembukaan shift jika seluruh shift dalam multi-shift sudah penuh', () => {
            const msg = `Dear Team\nProvide DW SOC Padang Under Vendor [PSD]\n16 Juli 2026\n\n09.00 : 2 orang\n1. budi 12345\n2. andi 87654\n\n11.00 : 1 orang\n1. cika 55555`;
            expect(parser.isShiftOpening(msg)).toBe(false);
        });

        test('harus mendeteksi pembukaan shift jika memuat kata kunci filter target spesifik', () => {
            config.targetShiftKeywords = ['11.00'];
            const msg = `Dear Team\nProvide DW SOC Padang Under Vendor [PSD]\n16 Juli 2026\n\n09.00 : 2 orang\n1. budi 12345\n\n11.00 : 2 orang\n1. cika 55555`;
            expect(parser.isShiftOpening(msg)).toBe(true);
        });

        test('harus mengabaikan pembukaan shift jika tidak ada blok shift yang memuat kata kunci filter target spesifik', () => {
            config.targetShiftKeywords = ['malam'];
            const msg = `Dear Team\nProvide DW SOC Padang Under Vendor [PSD]\n16 Juli 2026\n\n09.00 : 2 orang\n1. budi 12345\n\n11.00 : 2 orang\n1. cika 55555`;
            expect(parser.isShiftOpening(msg)).toBe(false);
        });

        test('harus mendeteksi pembukaan shift pada format kuota-saja tanpa template nomor urut list (Quota-Only)', () => {
            const msg = `Dear Team\nProvide DW JABODETABEK\n11.00 : 2 orang`;
            expect(parser.isShiftOpening(msg)).toBe(true);
        });
    });

    describe('isUserAlreadyRegistered', () => {
        const sampleList = `Daftar Shift A:\n1. Ahmad - OPT-001\n2. Budi Santoso - OPT-9982\n3.`;
        
        test('harus mendeteksi jika nama pengguna sudah ada dalam daftar', () => {
            expect(parser.isUserAlreadyRegistered(sampleList, 'Budi Santoso', 'OPT-9982')).toBe(true);
        });

        test('harus mendeteksi jika hanya OPT ID pengguna yang ada', () => {
            expect(parser.isUserAlreadyRegistered(sampleList, 'Budi Lain', 'OPT-9982')).toBe(true);
        });

        test('harus mengembalikan false jika pengguna belum ada dalam daftar', () => {
            expect(parser.isUserAlreadyRegistered(sampleList, 'Candra', 'OPT-005')).toBe(false);
        });
    });

    describe('extractShiftTitle', () => {
        test('harus mengekstrak judul shift dari baris pertama pesan', () => {
            const msg = `Shift Malam Uji Coba\n1. Ahmad - OPT-001\n2.`;
            expect(parser.extractShiftTitle(msg)).toBe('Shift Malam Uji Coba');
        });

        test('harus melewati baris nomor jika diletakkan di paling atas', () => {
            const msg = `1. Ahmad - OPT-001\n2. Budi\nShift Pagi`;
            expect(parser.extractShiftTitle(msg)).toBe('Shift Pagi');
        });
    });

    describe('registerUserInTemplate', () => {
        test('harus mengisi slot kosong pertama yang tersedia', () => {
            const template = `Daftar Shift:\n1. Ahmad - OPT-001\n2. [ ]\n3. ...`;
            const result = parser.registerUserInTemplate(template, 'Budi Santoso', 'OPT-9982');
            
            expect(result).toContain('2. Budi Santoso OPT-9982');
            expect(result).toContain('3. ...');
        });

        test('harus menambahkan nomor urut baru di akhir jika semua slot sudah terisi (Fallback)', () => {
            const template = `Daftar Shift:\n1. Ahmad - OPT-001\n2. Candra - OPT-003`;
            const result = parser.registerUserInTemplate(template, 'Budi Santoso', 'OPT-9982');
            
            expect(result).toContain('3. Budi Santoso OPT-9982');
        });

        test('harus melompati shift pertama yang penuh dan mendaftar di shift kedua yang masih kosong', () => {
            const template = `Dear Team\nProvide DW SOC Padang Under Vendor [PSD]\n16 Juli 2026\n\n09.00 : 2 orang\n1. budi 12345\n2. andi 87654\n\n11.00 : 2 orang\n1. cika 55555`;
            const result = parser.registerUserInTemplate(template, 'Daeng', '1234567');
            
            expect(result).toContain('11.00 : 2 orang\n1. cika 55555\n2. Daeng 1234567');
            expect(result).toContain('09.00 : 2 orang\n1. budi 12345\n2. andi 87654');
        });

        test('harus mengabaikan shift pertama yang masih kosong dan mendaftar di shift kedua karena kecocokan kata kunci filter', () => {
            config.targetShiftKeywords = ['11.00'];
            const template = `Dear Team\nProvide DW SOC Padang Under Vendor [PSD]\n16 Juli 2026\n\n09.00 : 2 orang\n1. budi 12345\n\n11.00 : 2 orang\n1. cika 55555`;
            const result = parser.registerUserInTemplate(template, 'Daeng', '1234567');
            
            expect(result).toContain('11.00 : 2 orang\n1. cika 55555\n2. Daeng 1234567');
            // Pastikan shift jam 9 TIDAK diisi oleh bot (tetap seperti semula tanpa nama Daeng)
            expect(result).toContain('09.00 : 2 orang\n1. budi 12345\n\n11.00');
        });

        test('harus mengembalikan null jika seluruh shift sudah penuh', () => {
            const template = `Dear Team\nProvide DW SOC Padang Under Vendor [PSD]\n16 Juli 2026\n\n09.00 : 2 orang\n1. budi 12345\n2. andi 87654\n\n11.00 : 1 orang\n1. cika 55555`;
            const result = parser.registerUserInTemplate(template, 'Daeng', '1234567');
            
            expect(result).toBeNull();
        });

        test('harus mengembalikan null jika tidak ada shift yang cocok dengan kata kunci filter target', () => {
            config.targetShiftKeywords = ['malam'];
            const template = `Dear Team\nProvide DW SOC Padang Under Vendor [PSD]\n16 Juli 2026\n\n09.00 : 2 orang\n1. budi 12345\n\n11.00 : 2 orang\n1. cika 55555`;
            const result = parser.registerUserInTemplate(template, 'Daeng', '1234567');
            
            expect(result).toBeNull();
        });

        test('harus menginisialisasi list pendaftaran baru bernomor 1 pada format kuota-saja (Quota-Only)', () => {
            const template = `Dear Team\nProvide DW JABODETABEK\n11.00 : 2 orang`;
            const result = parser.registerUserInTemplate(template, 'Daeng', '1234567');
            expect(result).toContain('11.00 : 2 orang\n1. Daeng 1234567');
        });
    });

    describe('isQuotaFull', () => {
        test('harus mengembalikan true jika jumlah pendaftar sama dengan kuota', () => {
            const list = `09.00 : 2 orang\n1. budi 12345\n2. andi 87654`;
            expect(parser.isQuotaFull(list)).toBe(true);
        });

        test('harus mengembalikan true jika jumlah pendaftar melebihi kuota', () => {
            const list = `09.00 : 2 orang\n1. budi 12345\n2. andi 87654\n3. cika 55555`;
            expect(parser.isQuotaFull(list)).toBe(true);
        });

        test('harus mengembalikan false jika jumlah pendaftar kurang dari kuota', () => {
            const list = `09.00 : 2 orang\n1. budi 12345`;
            expect(parser.isQuotaFull(list)).toBe(false);
        });

        test('harus mengembalikan false jika format kuota tidak valid atau tidak ditemukan', () => {
            const list = `09.00 Pagi\n1. budi 12345`;
            expect(parser.isQuotaFull(list)).toBe(false);
        });
    });
});
