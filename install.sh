#!/bin/bash

# Warna untuk output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Fungsi untuk logging
log() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Cek jika script dijalankan sebagai root
if [ "$EUID" -ne 0 ]; then 
    error "Script harus dijalankan sebagai root"
    exit 1
fi

# Cek sistem operasi
if [ ! -f /etc/debian_version ]; then
    error "Script ini hanya untuk Debian"
    exit 1
fi

# Konfirmasi sebelum melanjutkan
echo -e "${YELLOW}Script ini akan menginstal Web Monitoring Dashboard pada Debian 12${NC}"
echo -e "${YELLOW}Pastikan sistem Anda terhubung ke internet${NC}"
read -p "Lanjutkan instalasi? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
fi

# 1. Update sistem
log "Memperbarui sistem..."
apt update && apt upgrade -y || {
    error "Gagal memperbarui sistem"
    exit 1
}

# 2. Install dependencies
log "Menginstal dependencies..."
apt install -y curl git nginx || {
    error "Gagal menginstal dependencies"
    exit 1
}

# 3. Install Node.js
log "Menginstal Node.js..."
curl -fsSL https://deb.nodesource.com/setup_18.x | bash - || {
    error "Gagal mengunduh script Node.js"
    exit 1
}
apt install -y nodejs || {
    error "Gagal menginstal Node.js"
    exit 1
}

# 4. Verifikasi instalasi
log "Verifikasi instalasi..."
node_version=$(node --version)
npm_version=$(npm --version)
nginx_version=$(nginx -v 2>&1)

log "Node.js version: $node_version"
log "NPM version: $npm_version"
log "Nginx version: $nginx_version"

# 5. Setup aplikasi
log "Menyiapkan aplikasi..."
mkdir -p /var/www
cd /var/www

# Clone repository
log "Mengunduh aplikasi..."
git clone https://github.com/rendiichtiarp/web-monitoring.git web-monitoring || {
    error "Gagal mengunduh aplikasi"
    exit 1
}
cd web-monitoring

# Install dependencies backend
log "Menginstal dependencies backend..."
npm install || {
    error "Gagal menginstal dependencies backend"
    exit 1
}

# Install dependencies frontend dan build
log "Menginstal dan membangun frontend..."
cd client
npm install || {
    error "Gagal menginstal dependencies frontend"
    exit 1
}
npm run build || {
    error "Gagal membangun frontend"
    exit 1
}
cd ..

# 6. Konfigurasi environment
log "Menyiapkan konfigurasi environment..."
cat << EOF > .env
PORT=5000
NODE_ENV=production
EOF

# 7. Setup service systemd
log "Menyiapkan service systemd..."
cat << EOF > /etc/systemd/system/web-monitoring.service
[Unit]
Description=Web Monitoring Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/web-monitoring
ExecStart=/usr/bin/node server.js
Restart=always
Environment=NODE_ENV=production
Environment=PORT=5000

[Install]
WantedBy=multi-user.target
EOF

# 8. Konfigurasi Nginx
log "Menyiapkan konfigurasi Nginx..."
cat << EOF > /etc/nginx/sites-available/web-monitoring
server {
    listen 80;
    server_name localhost;

    root /var/www/web-monitoring/client/build;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    location /socket.io/ {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
    }

    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-XSS-Protection "1; mode=block";
    add_header X-Content-Type-Options "nosniff";

    access_log /var/log/nginx/web-monitoring.access.log;
    error_log /var/log/nginx/web-monitoring.error.log;
}
EOF

# 9. Aktifkan konfigurasi
log "Mengaktifkan konfigurasi..."
ln -sf /etc/nginx/sites-available/web-monitoring /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# 10. Set permissions
log "Mengatur permissions..."
chown -R www-data:www-data /var/www/web-monitoring
chmod -R 755 /var/www/web-monitoring

# 11. Verifikasi dan restart services
log "Memverifikasi konfigurasi Nginx..."
nginx -t || {
    error "Konfigurasi Nginx tidak valid"
    exit 1
}

# 12. Setup Firewall
log "Menyiapkan firewall..."
apt install -y ufw || {
    error "Gagal menginstal UFW"
    exit 1
}

ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 22/tcp

# Aktifkan UFW tanpa konfirmasi
echo "y" | ufw enable

# 13. Restart dan enable services
log "Memulai services..."
systemctl daemon-reload
systemctl enable web-monitoring
systemctl restart web-monitoring
systemctl restart nginx

# 14. Tampilkan informasi akhir
echo
echo -e "${GREEN}Instalasi selesai!${NC}"
echo -e "Dashboard dapat diakses di: http://localhost atau http://SERVER_IP"
echo
echo -e "${YELLOW}Informasi penting:${NC}"
echo "- Log aplikasi: sudo journalctl -u web-monitoring -f"
echo "- Log Nginx: sudo tail -f /var/log/nginx/web-monitoring.error.log"
echo "- Restart aplikasi: sudo systemctl restart web-monitoring"
echo "- Status aplikasi: sudo systemctl status web-monitoring"
echo
echo -e "${YELLOW}Untuk keamanan tambahan, pertimbangkan untuk:${NC}"
echo "1. Mengkonfigurasi SSL/HTTPS dengan Certbot"
echo "2. Membatasi akses SSH"
echo "3. Mengatur firewall tambahan"
echo
echo -e "${GREEN}Selamat menggunakan Web Monitoring Dashboard!${NC}" 