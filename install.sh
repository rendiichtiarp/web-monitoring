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

# Fungsi untuk konfirmasi
confirm() {
    read -p "$1 (y/n) " -n 1 -r
    echo
    [[ $REPLY =~ ^[Yy]$ ]]
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
if ! confirm "Lanjutkan instalasi?"; then
    exit 1
fi

# 1. Update sistem
log "Memeriksa pembaruan sistem..."
if confirm "Apakah Anda ingin memperbarui sistem?"; then
    apt update && apt upgrade -y || {
        error "Gagal memperbarui sistem"
        exit 1
    }
else
    warn "Melewati pembaruan sistem"
fi

# 2. Install dependencies
log "Memeriksa dependencies..."
DEPS="curl git nginx"
DEPS_TO_INSTALL=""
for dep in $DEPS; do
    if ! command -v $dep &> /dev/null; then
        DEPS_TO_INSTALL="$DEPS_TO_INSTALL $dep"
    else
        log "$dep sudah terinstal"
    fi
done

if [ ! -z "$DEPS_TO_INSTALL" ]; then
    log "Menginstal dependencies yang diperlukan:$DEPS_TO_INSTALL"
    apt install -y $DEPS_TO_INSTALL || {
        error "Gagal menginstal dependencies"
        exit 1
    }
fi

# 3. Install Node.js
log "Memeriksa Node.js..."
if ! command -v node &> /dev/null; then
    log "Menginstal Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - || {
        error "Gagal mengunduh script Node.js"
        exit 1
    }
    apt install -y nodejs || {
        error "Gagal menginstal Node.js"
        exit 1
    }
else
    NODE_VER=$(node -v)
    if [[ ${NODE_VER:1:2} -lt 18 ]]; then
        warn "Versi Node.js ($NODE_VER) lebih rendah dari yang direkomendasikan (v18)"
        if confirm "Apakah Anda ingin mengupgrade Node.js ke v18?"; then
            curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
            apt install -y nodejs
        fi
    else
        log "Node.js $NODE_VER sudah terinstal"
    fi
fi

# 4. Verifikasi instalasi
log "Verifikasi instalasi..."
node_version=$(node --version)
npm_version=$(npm --version)
nginx_version=$(nginx -v 2>&1)

log "Node.js version: $node_version"
log "NPM version: $npm_version"
log "Nginx version: $nginx_version"

# 5. Setup aplikasi
log "Memeriksa aplikasi..."
APP_DIR="/var/www/web-monitoring"
if [ -d "$APP_DIR" ]; then
    warn "Direktori aplikasi sudah ada: $APP_DIR"
    if confirm "Apakah Anda ingin menginstal ulang aplikasi?"; then
        rm -rf "$APP_DIR"
    else
        warn "Melewati instalasi aplikasi"
        cd "$APP_DIR"
    fi
fi

if [ ! -d "$APP_DIR" ]; then
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
fi

# Install dependencies backend
log "Memeriksa dependencies backend..."
if [ ! -d "node_modules" ] || confirm "Apakah Anda ingin menginstal ulang dependencies backend?"; then
    log "Menginstal dependencies backend..."
    npm install || {
        error "Gagal menginstal dependencies backend"
        exit 1
    }
fi

# Install dependencies frontend dan build
log "Memeriksa frontend..."
cd client
if [ ! -d "node_modules" ] || confirm "Apakah Anda ingin menginstal ulang dependencies frontend?"; then
    log "Menginstal dependencies frontend..."
    npm install || {
        error "Gagal menginstal dependencies frontend"
        exit 1
    }
fi

if [ ! -d "build" ] || confirm "Apakah Anda ingin membangun ulang frontend?"; then
    log "Membangun frontend..."
    npm run build || {
        error "Gagal membangun frontend"
        exit 1
    }
fi
cd ..

# 6. Konfigurasi environment
log "Memeriksa konfigurasi environment..."
if [ -f ".env" ]; then
    warn "File .env sudah ada"
    if confirm "Apakah Anda ingin menimpa file .env?"; then
        cat << EOF > .env
PORT=5000
NODE_ENV=production
EOF
        log "File .env telah diperbarui"
    fi
else
    log "Membuat file .env..."
    cat << EOF > .env
PORT=5000
NODE_ENV=production
EOF
fi

# 7. Setup service systemd
SERVICE_FILE="/etc/systemd/system/web-monitoring.service"
log "Memeriksa service systemd..."
if [ -f "$SERVICE_FILE" ]; then
    warn "File service sudah ada"
    if confirm "Apakah Anda ingin menimpa file service?"; then
        cat << EOF > $SERVICE_FILE
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
        log "File service telah diperbarui"
    fi
else
    log "Membuat file service..."
    cat << EOF > $SERVICE_FILE
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
fi

# 8. Konfigurasi Nginx
NGINX_CONF="/etc/nginx/sites-available/web-monitoring"
log "Memeriksa konfigurasi Nginx..."
if [ -f "$NGINX_CONF" ]; then
    warn "File konfigurasi Nginx sudah ada"
    if confirm "Apakah Anda ingin menimpa konfigurasi Nginx?"; then
        cat << EOF > $NGINX_CONF
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
        log "Konfigurasi Nginx telah diperbarui"
    fi
else
    log "Membuat konfigurasi Nginx..."
    cat << EOF > $NGINX_CONF
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
fi

# 9. Aktifkan konfigurasi
log "Mengaktifkan konfigurasi..."
ln -sf $NGINX_CONF /etc/nginx/sites-enabled/
if [ -f "/etc/nginx/sites-enabled/default" ]; then
    warn "Menonaktifkan konfigurasi default Nginx"
    rm -f /etc/nginx/sites-enabled/default
fi

# 10. Set permissions
log "Mengatur permissions..."
chown -R www-data:www-data $APP_DIR
chmod -R 755 $APP_DIR

# 11. Verifikasi dan restart services
log "Memverifikasi konfigurasi Nginx..."
nginx -t || {
    error "Konfigurasi Nginx tidak valid"
    exit 1
}

# 12. Setup Firewall
log "Memeriksa firewall..."
if ! command -v ufw &> /dev/null; then
    log "Menginstal UFW..."
    apt install -y ufw || {
        error "Gagal menginstal UFW"
        exit 1
    }
fi

# Cek rules yang sudah ada
if ! ufw status | grep -q "80/tcp"; then
    ufw allow 80/tcp
fi
if ! ufw status | grep -q "443/tcp"; then
    ufw allow 443/tcp
fi
if ! ufw status | grep -q "22/tcp"; then
    ufw allow 22/tcp
fi

# Aktifkan UFW jika belum aktif
if ! ufw status | grep -q "Status: active"; then
    echo "y" | ufw enable
fi

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