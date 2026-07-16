#!/data/data/com.termux/files/usr/bin/bash

# Pastikan script berhenti jika terjadi kesalahan
set -e

echo "=================================================="
echo "    SRAS - Termux Automated Installer Script"
echo "=================================================="

echo "\n[1/5] Memperbarui paket-paket sistem Termux..."
apt update && apt upgrade -y

echo "\n[2/5] Menginstal paket dasar: Node.js, Git, dan repositori X11/TUR..."
apt install nodejs git -y
apt install x11-repo -y
# Install repositori komunitas tambahan (TUR) untuk Chromium
apt install tur-repo -y

echo "\n[3/5] Menginstal Chromium dan pustaka grafis sistem pendukung..."
apt install chromium -y
apt install pango libx11 libxcomposite libxdamage libxext libxfixes libxrandr libxrender libxtst libxxf86vm libdrm mesa -y

echo "\n[4/5] Mengatur variabel lingkungan dan menginstal modul NPM..."
# Blokir download browser Chromium internal bawaan Puppeteer
export PUPPETEER_SKIP_DOWNLOAD=true
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
export PUPPETEER_EXECUTABLE_PATH=$(command -v chromium)

echo "Menjalankan npm install..."
npm install

echo "\n[5/5] Membuat script pintasan startup khusus Termux..."
cat << 'EOF' > start-termux.sh
#!/data/data/com.termux/files/usr/bin/bash
export PUPPETEER_SKIP_DOWNLOAD=true
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
export PUPPETEER_EXECUTABLE_PATH=$(command -v chromium)
node src/index.js
EOF

chmod +x start-termux.sh

echo "\n=================================================="
echo "               INSTALLASI SUKSES!"
echo "=================================================="
echo "Untuk menjalankan bot di Termux, gunakan perintah:"
echo "./start-termux.sh"
echo "=================================================="
