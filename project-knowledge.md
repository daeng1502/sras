# Project Knowledge

**Project**: Shift Registration Automation System (SRAS)  
**Status**: Discovery Complete  
**Source**: `baca ini.md` / Project Owner Knowledge Transfer  

---

## 1. Project Overview & Vision

### Visi Proyek
Membangun sistem otomatisasi yang memantau grup WhatsApp vendor, mendeteksi pembukaan shift, melakukan pendaftaran sesuai aturan vendor, memantau hasil verifikasi admin, serta mengelola status kelayakan mengikuti shift secara otomatis.

### Tujuan Proyek (Goal)
Mengurangi keterlambatan pendaftaran shift dan membantu pekerja mengikuti proses pendaftaran secara konsisten tanpa melanggar aturan vendor.

---

## 2. Business Context & Process

### Latar Belakang (Background)
*   Vendor mengumumkan lowongan kerja harian melalui grup WhatsApp.
*   Seluruh pekerja harus melakukan daftar nama menggunakan format template yang diberikan admin.
*   Kuota pekerja terbatas sehingga kecepatan merespons sangat menentukan keberhasilan pendaftaran.

### Alur Proses Saat Ini (As-Is Process)
1.  Admin membuka shift baru.
2.  Admin mengirimkan pesan berisi template pendaftaran.
3.  Pekerja secara manual menyalin template pesan tersebut.
4.  Pekerja mengisi nama mereka dan mengirimkannya kembali ke grup.
5.  Admin memilih pekerja berdasarkan daftar yang masuk.
6.  Admin mengumumkan hasil seleksi/verifikasi pekerja yang terpilih.

### Alur Proses Masa Depan (To-Be Process)
1.  **Bot Memantau Grup**: Sistem secara otomatis memantau lalu lintas chat di grup WhatsApp yang ditargetkan.
2.  **Deteksi Pembukaan Shift**: Bot mengenali pesan pembukaan shift dari admin terdaftar.
3.  **Pemeriksaan Kelayakan (Eligibility)**: Bot mengecek apakah status pengguna saat ini mengizinkannya untuk mendaftar (sesuai aturan kelayakan).
4.  **Sinkronisasi Daftar Terbaru**: Bot memproses chat terbaru untuk mengekstrak nomor urut dan daftar nama pendaftar terakhir agar tidak menimpa pendaftar lain.
5.  **Pendaftaran Otomatis**: Bot menambahkan identitas pengguna ke dalam daftar dan mengirimkan pesan pendaftaran yang telah diperbarui ke grup dengan format yang persis sama.
6.  **Pemantauan Verifikasi**: Bot memantau pengumuman admin untuk mengetahui apakah status pengguna diterima (*Accepted*) atau ditolak (*Rejected*).
7.  **Pembaruan Status**: Bot memperbarui status kelayakan pengguna berdasarkan hasil verifikasi tersebut.

---

## 3. Business Rules (Aturan Bisnis)

Sistem wajib mematuhi aturan bisnis berikut:

| ID | Aturan Bisnis | Deskripsi / Validasi |
|---|---|---|
| **BR-001** | Sumber Informasi Tunggal | Informasi pembukaan shift hanya diumumkan melalui grup WhatsApp yang dipantau. |
| **BR-002** | Otoritas Admin | Hanya admin tertentu (terdaftar) yang memiliki wewenang untuk membuka shift kerja. |
| **BR-003** | Pembatasan Respons Admin | Bot hanya boleh merespons pesan pembukaan shift yang dikirim oleh nomor admin yang terdaftar dalam konfigurasi. |
| **BR-004** | Konsistensi Format | Bot wajib menggunakan format pesan template terbaru yang dikirimkan oleh admin saat membuka shift. |
| **BR-005** | Larangan Pembuatan Template | Bot dilarang keras membuat atau memodifikasi template pesan pendaftarannya sendiri secara sepihak. |
| **BR-006** | Sinkronisasi Riwayat Chat | Bot harus membaca dan menggunakan daftar nama pendaftar paling mutakhir yang dikirim di grup sebelum mengirimkan pendaftaran. |
| **BR-007** | Pencegahan Duplikasi | Bot tidak boleh mengirimkan pendaftaran jika nama atau identitas pengguna sudah tercatat di dalam daftar pendaftar terbaru grup. |
| **BR-008** | Konsekuensi Status *Accepted* | Jika status akhir verifikasi pengguna adalah **Accepted**, bot dilarang mendaftarkan pengguna ke shift lain yang berada pada hari yang sama. |
| **BR-009** | Konsekuensi Status *Rejected* | Jika status akhir verifikasi pengguna adalah **Rejected**, bot diperbolehkan secara otomatis mengikuti/mendaftar pada shift berikutnya. |
| **BR-010** | Konsekuensi Status *Waiting Verification* | Selama status pengguna masih **Waiting Verification** (menunggu pengumuman seleksi), bot dilarang mendaftarkan pengguna ke shift kerja lainnya. |

---

## 4. Stakeholder & User Profiles

### Aktor Utama & Sekunder
*   **Primary User**: *Daily Worker Sorter* (Pekerja Harian yang menggunakan bot untuk melakukan pendaftaran otomatis).
*   **Secondary User**: *Tidak ada*.
*   **External Actor**: *Admin Vendor* (Pihak eksternal dari vendor yang membuka lowongan kerja dan memverifikasi daftar pekerja di grup WhatsApp).

### Profil Konfigurasi Pengguna (User Profile)
Untuk menjalankan operasional pendaftaran otomatis, sistem membutuhkan data profil pengguna berikut:
*   **Nama**: Nama lengkap pekerja (sesuai format yang diminta admin).
*   **OPT ID**: Identitas unik pekerja yang digunakan dalam proses pendaftaran.
*   **Nomor HP**: Nomor telepon pengguna yang digunakan untuk mengirim pesan.
*   **Daftar Admin yang Dipantau**: Nomor-nomor telepon admin vendor yang sah.
*   **Daftar Grup yang Dipantau**: ID/Nama grup WhatsApp tempat pemantauan dilakukan.

---

## 5. Ruang Lingkup Fungsional (10 Modul)

1.  **Shift Monitoring**: Pemantauan grup WhatsApp secara real-time untuk mendeteksi setiap pesan baru yang masuk.
2.  **Admin Detection**: Verifikasi apakah pengirim pesan pembukaan/seleksi shift adalah admin yang sah.
3.  **Shift Detection**: Identifikasi pesan yang bermakna sebagai pembukaan kesempatan kerja baru (shift).
4.  **Template Parser**: Pengekstrakan struktur/format template teks yang dikirim oleh admin untuk disalin secara akurat.
5.  **List Synchronizer**: Pembacaan chat di grup untuk mengunduh daftar peserta yang sudah mendaftar sebelumnya agar urutan pendaftaran bot tetap konsisten dan runtut.
6.  **Auto Registration**: Penyisipan identitas pengguna (Nama & OPT ID) ke dalam daftar terbaru dengan nomor urut berikutnya, lalu mengirimkannya kembali ke grup.
7.  **Verification Monitor**: Pemantauan pesan pengumuman dari admin pasca-pendaftaran untuk mendeteksi status seleksi pengguna.
8.  **Eligibility Checker**: Pemeriksaan status kelayakan pengguna berdasarkan aturan transisi status (*Accepted*, *Rejected*, *Waiting Verification*).
9.  **History**: Pencatatan log riwayat pendaftaran, waktu respons, dan status seleksi yang pernah dialami pengguna.
10. **Configuration**: Pengelolaan data profil pengguna dan nomor admin/grup yang dipantau agar mudah diubah tanpa merusak kode program.

---

## 6. Batasan & Kriteria Keberhasilan

### Batasan Sistem (Constraints)
*   Sistem hanya memantau dan beroperasi pada grup WhatsApp yang terkonfigurasi secara spesifik.
*   Sistem hanya merespons pesan dari daftar admin yang telah didaftarkan.
*   Sistem tidak boleh memodifikasi template dasar yang diberikan admin.
*   Sistem tidak boleh menghapus atau merusak data pendaftar lain dalam daftar.
*   Sistem tidak boleh mengirimkan pesan pendaftaran ganda untuk pengguna yang sama pada satu shift.

### Kriteria Keberhasilan (Success Criteria)
*   Setiap shift baru terdeteksi dengan cepat dan akurat.
*   Nomor urut pendaftaran bot selalu benar dan sinkron dengan pendaftar terakhir di grup WhatsApp.
*   Tidak ada duplikasi nama pengguna dalam daftar.
*   Bot mematuhi aturan kelayakan: tidak mengikuti shift baru saat status **Accepted** atau **Waiting Verification**, serta otomatis bergerak mendaftar ke shift berikutnya ketika status **Rejected**.
*   Semua log transaksi dan aktivitas tersimpan dengan baik di dalam riwayat sistem.

---

## 7. Risiko & Fokus Mitigasi

*   **R-001: Perubahan Format Pesan Admin secara Mendadak**
    *   *Dampak*: Parser gagal mendeteksi template atau merusak urutan daftar.
    *   *Fokus Mitigasi*: Membuat mesin parser teks yang fleksibel berbasis kecocokan pola (pattern matching/regex) atau validasi string terstruktur.
*   **R-002: Perubahan Protokol/API WhatsApp**
    *   *Dampak*: Bot kehilangan koneksi ke grup WhatsApp.
    *   *Fokus Mitigasi*: Memilih pustaka WhatsApp Gateway/Client yang teruji dengan pemeliharaan komunitas yang aktif.
*   **R-003: Kondisi Balapan (Race Condition)**
    *   *Dampak*: Bot mengirimkan nomor urut yang sama dengan anggota grup lain yang mendaftar pada detik yang sama.
    *   *Fokus Mitigasi*: Sinkronisasi ulang daftar pesan beberapa milidetik sebelum mengirimkan chat pendaftaran ke grup.
*   **R-004: Inkonsistensi Pesan Admin**
    *   *Dampak*: Hasil seleksi atau template pembukaan gagal diidentifikasi.
*   **R-005: Koneksi Terputus**
    *   *Dampak*: Bot melewatkan pembukaan shift.

---

## 8. Persyaratan Non-Fungsional (Non-Functional Requirements)

*   **Kecepatan Respon (Performance)**: Bot harus merespons pesan pembukaan shift dan mengirimkan pendaftaran dalam hitungan detik setelah pesan terdeteksi.
*   **Konsistensi Status (Consistency)**: State status kelayakan pengguna (*Accepted*, *Rejected*, *Waiting*) harus konsisten dan tahan terhadap kegagalan daya atau crash aplikasi.
*   **Ketertelusuran (Traceability)**: Log riwayat pendaftaran dan pembacaan pesan harus terdokumentasi dengan baik untuk tujuan audit mandiri.
*   **Ketahanan Operasional (Robustness)**: Bot harus dapat otomatis berjalan kembali (*auto-restart*) setelah sistem mengalami kegagalan daya atau koneksi internet terputus.
*   **Kemudahan Konfigurasi (Maintainability)**: Seluruh data profil pekerja, nomor telepon admin, dan grup WhatsApp sasaran harus disimpan dalam file konfigurasi terpisah (seperti `.env` atau berkas JSON/YAML) sehingga dapat disunting tanpa menyentuh source code utama.

---

## 9. Glossary (Kamus Istilah)

| Istilah | Definisi |
|---|---|
| **Shift** | Kesempatan kerja harian yang dibuka secara resmi oleh Admin Vendor di grup WhatsApp. |
| **Admin** | Pengelola grup WhatsApp dari pihak vendor yang bertugas membuka lowongan shift, memposting template, dan memverifikasi daftar pekerja. |
| **List** | Daftar nama-nama pekerja beserta nomor urutnya yang terdaftar untuk mengikuti suatu shift. |
| **Accepted** | Status di mana nama pengguna telah resmi diverifikasi dan dipilih oleh Admin Vendor untuk bekerja pada shift tersebut. |
| **Rejected** | Status di mana nama pengguna dicoret atau tidak dipilih oleh Admin Vendor untuk bekerja pada shift tersebut. |
| **Waiting Verification** | Status transisi di mana pengguna telah mendaftar pada suatu shift, namun admin belum merilis pengumuman verifikasi final. |
| **OPT ID** | Identitas unik (Operator/Worker ID) milik pekerja yang wajib dicantumkan di samping nama saat melakukan pendaftaran. |
