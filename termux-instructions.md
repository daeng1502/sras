# Panduan Instalasi dan Penggunaan SRAS di HP Android (Termux)

Dokumen ini menjelaskan langkah-demi-langkah cara memasang dan menjalankan bot **Shift Registration Automation System (SRAS)** langsung di HP Android menggunakan aplikasi **Termux**.

---

## 🛠️ Persiapan Awal (di HP Android)

### 1. Unduh Aplikasi Termux yang Benar
*   **PENTING**: Jangan unduh Termux dari Google Play Store karena sudah usang dan tidak diperbarui lagi.
*   Unduh aplikasi **Termux** versi terbaru melalui:
    *   **F-Droid**: [Kunjungi tautan unduh F-Droid](https://f-droid.org/en/packages/com.termux/)
    *   **Github resmi Termux**: [Kunjungi rilis Github](https://github.com/termux/termux-app/releases)

---

## 📂 Memindahkan Berkas Proyek ke HP

Ada dua cara utama untuk memindahkan folder proyek `sras` dari laptop ke HP Anda:

### Cara A: Menggunakan Git (Paling Direkomendasikan)
1.  Upload folder proyek Anda ke Github pribadi.
2.  Di terminal Termux, unduh (clone) folder tersebut:
    ```bash
    git clone https://github.com/username/sras.git
    cd sras
    ```

### Cara B: Salin Manual Menggunakan Penyimpanan HP
1.  Kompres folder proyek `sras` menjadi file zip (misal `sras.zip`). *Catatan: Jangan ikut sertakan folder `node_modules` dan `.wwebjs_auth` saat mengompres.*
2.  Kirim file `sras.zip` tersebut ke penyimpanan internal HP Anda (misal ke folder `Downloads`).
3.  Di aplikasi Termux, izinkan akses penyimpanan internal HP:
    ```bash
    termux-setup-storage
    ```
4.  Pindahkan berkas zip ke direktori lokal Termux dan ekstrak:
    ```bash
    pkg install unzip -y
    cp ~/storage/shared/Download/sras.zip ~/
    unzip ~/sras.zip -d ~/
    cd ~/sras
    ```

---

## 🚀 Proses Instalasi Otomatis di Termux

1.  Pastikan Anda sudah berada di dalam folder proyek Anda di Termux (`cd sras`).
2.  Beri izin eksekusi pada skrip instalasi pembantu:
    ```bash
    chmod +x termux-setup.sh
    ```
3.  Jalankan skrip instalasi otomatis:
    ```bash
    ./termux-setup.sh
    ```
    *Proses ini akan memakan waktu 5-10 menit tergantung kecepatan koneksi internet HP Anda karena menginstal Chromium pendukung dan pustaka grafis sistem.*

---

## 🔋 Pengaturan Penting: Matikan Optimasi Baterai HP
Sistem Android secara bawaan akan mematikan paksa aplikasi latar belakang (seperti Termux) agar baterai awet. Agar bot tidak mati saat HP terkunci:
1.  Buka **Pengaturan (Settings)** HP Android Anda.
2.  Masuk ke menu **Aplikasi / Kelola Aplikasi** -> Pilih **Termux**.
3.  Masuk ke bagian **Penghemat Baterai / Battery Saver**.
4.  Ubah setelan menjadi **Tidak Ada Batasan / No Restrictions** (agar Android membiarkan Termux berjalan terus di latar belakang).
5.  Pastikan Anda juga mengaktifkan opsi "Acquire wake-lock" di Termux dengan cara menarik bilah notifikasi HP ke bawah, lalu ketuk opsi **Acquire wake-lock** pada notifikasi Termux.

---

## 🟢 Cara Menjalankan Bot di Termux

Setelah instalasi selesai, untuk menjalankan bot selanjutnya Anda hanya perlu mengetik:
```bash
./start-termux.sh
```
1.  Bot akan berjalan dan menanyakan filter kata kunci target Anda di layar HP.
2.  Jika dijalankan pertama kali, terminal Termux akan menampilkan **QR Code**. Pindai QR Code tersebut menggunakan WhatsApp di HP lain (atau screenshot lalu scan menggunakan web scanner jika WA yang dipakai berada di HP yang sama).
3.  Setelah terhubung, bot akan aktif memantau pendaftaran Anda secara mandiri di latar belakang!
