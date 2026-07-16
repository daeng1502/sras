Project Overview
Project Name

Shift Registration Automation System (SRAS)

Project Vision

Membangun sistem otomatisasi yang memantau grup WhatsApp vendor, mendeteksi pembukaan shift, melakukan pendaftaran sesuai aturan vendor, memantau hasil verifikasi admin, serta mengelola status kelayakan mengikuti shift secara otomatis.

Project Goal

Mengurangi keterlambatan pendaftaran shift dan membantu pekerja mengikuti proses pendaftaran secara konsisten tanpa melanggar aturan vendor.

Business Context
Background

Vendor mengumumkan lowongan kerja harian melalui grup WhatsApp.

Seluruh pekerja harus melakukan daftar nama menggunakan format yang diberikan admin.

Kuota pekerja terbatas sehingga kecepatan merespons sangat menentukan.

Existing Process (As-Is)
Admin membuka shift.
Admin mengirim template.
Pekerja menyalin template.
Pekerja mengisi nama.
Admin memilih pekerja.
Admin mengumumkan hasil.
Future Process (To-Be)
Bot memantau grup.
Bot mendeteksi pembukaan shift.
Bot menentukan apakah pengguna masih boleh mengikuti shift.
Bot memperbarui daftar berdasarkan chat terbaru.
Bot mengirim daftar yang telah diperbarui.
Bot memantau hasil verifikasi admin.
Bot memperbarui status pengguna.


Stakeholders
Primary User = Daily Worker Sorter.

Secondary User = Tidak ada

External Actor = Admin Vendor

Communication Channel = WhatsApp Group

Business Rules
BR-001
Informasi shift hanya diumumkan melalui grup WhatsApp.

BR-002
Hanya admin tertentu yang dapat membuka shift.

BR-003
Bot hanya boleh merespons pembukaan shift dari admin yang terdaftar.

BR-004
Bot harus menggunakan format terbaru yang dikirim admin.

BR-005
Bot tidak boleh membuat template sendiri.

BR-006
Bot harus menggunakan daftar terbaru dari grup.

BR-007
Bot tidak boleh mengirim jika nama pengguna sudah ada.

BR-008
Jika status pengguna Accepted, bot tidak boleh mengikuti shift lain pada hari yang sama.

BR-009
Jika status pengguna Rejected, bot boleh mengikuti shift berikutnya.

BR-010
Jika status masih Waiting Verification, bot tidak boleh mengikuti shift lain.

Functional Scope

Saya membaginya menjadi modul.

Shift Monitoring

Memantau grup.

Admin Detection

Mengenali admin.

Shift Detection

Mengenali pembukaan shift.

Template Parser

Mengambil template admin.

List Synchronizer

Mengambil daftar terbaru.

Auto Registration

Menambahkan nama pengguna.

Verification Monitor

Membaca hasil verifikasi admin.

Eligibility Checker

Menentukan apakah pengguna boleh mengikuti shift.

History

Menyimpan riwayat.

Configuration

Menyimpan data pengguna.

User Profile

Nama.

OPT ID.

Nomor HP.

Admin yang dipantau.

Grup yang dipantau.

Constraints
Hanya bekerja pada grup tertentu.
Hanya membaca admin tertentu.
Tidak mengubah format admin.
Tidak menghapus data peserta lain.
Tidak mengirim dua kali.
Success Criteria
Shift baru terdeteksi.
Nomor urut selalu benar.
Tidak terjadi duplikasi nama.
Tidak mengikuti shift saat status Accepted.
Mengikuti shift berikutnya saat status Rejected.
Riwayat tersimpan.
Risks
Admin mengubah format pesan.
WhatsApp mengalami perubahan protokol.
Terjadi balapan (race condition) ketika banyak peserta mengirim hampir bersamaan.
Pesan admin tidak konsisten.
Koneksi bot terputus.
Non-Functional Requirements
Respon cepat terhadap pesan baru.
State pengguna konsisten.
Riwayat dapat ditelusuri.
Bot tetap berjalan setelah restart.
Konfigurasi mudah diubah tanpa mengubah kode.
Sebagai Project Owner, saya juga akan memberikan satu dokumen tambahan

Bukan SRS.

Bukan UML.

Tetapi Glossary.

Karena proyek ini memiliki istilah bisnis yang sangat spesifik.

Misalnya:

Istilah	Definisi
Shift	Kesempatan kerja yang dibuka oleh admin.
Admin	Pengelola grup yang membuka dan memverifikasi shift.
List	Daftar nama peserta yang mendaftar pada suatu shift.
Accepted	Pengguna dipilih oleh admin untuk bekerja pada shift tersebut.
Rejected	Pengguna tidak dipilih pada shift tersebut.
Waiting Verification	Pengguna sudah mendaftar tetapi hasil seleksi belum diumumkan.
OPT ID	Identitas pekerja yang digunakan dalam proses pendaftaran.
