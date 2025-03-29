#!/bin/bash

# Warna untuk output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Versi minimum yang dibutuhkan
REQUIRED_NODEJS_VERSION="18"
REQUIRED_NPM_VERSION="6"

# Variable untuk domain dan SSL
DOMAIN=""
USE_SSL=false
USE_DOMAIN=false

echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}    Server Monitoring Installer      ${NC}"
echo -e "${GREEN}    System Dashboard v1.0           ${NC}"
echo -e "${GREEN}=====================================${NC}"

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo -e "${RED}Please run as root${NC}"
  exit 1
fi

# Fungsi untuk memeriksa apakah command tersedia
check_command() {
    if command -v $1 >/dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Fungsi untuk memeriksa versi Node.js
check_nodejs_version() {
    if check_command "node"; then
        current_version=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$current_version" -ge "$REQUIRED_NODEJS_VERSION" ]; then
            echo -e "${GREEN}✓${NC} Node.js v$current_version terinstall (minimum v$REQUIRED_NODEJS_VERSION)"
            return 0
        else
            echo -e "${RED}✗${NC} Node.js v$current_version terinstall (minimum v$REQUIRED_NODEJS_VERSION dibutuhkan)"
            return 1
        fi
    else
        echo -e "${RED}✗${NC} Node.js belum terinstall"
        return 1
    fi
}

# Fungsi untuk memeriksa versi NPM
check_npm_version() {
    if check_command "npm"; then
        current_version=$(npm -v | cut -d'.' -f1)
        if [ "$current_version" -ge "$REQUIRED_NPM_VERSION" ]; then
            echo -e "${GREEN}✓${NC} NPM v$current_version terinstall (minimum v$REQUIRED_NPM_VERSION)"
            return 0
        else
            echo -e "${RED}✗${NC} NPM v$current_version terinstall (minimum v$REQUIRED_NPM_VERSION dibutuhkan)"
            return 1
        fi
    else
        echo -e "${RED}✗${NC} NPM belum terinstall"
        return 1
    fi
}

# Fungsi untuk memeriksa apakah paket sudah terinstall
check_package() {
    if dpkg -l | grep -q "^ii  $1 "; then
        echo -e "${GREEN}✓${NC} $1 sudah terinstall"
        return 0
    else
        echo -e "${RED}✗${NC} $1 belum terinstall"
        return 1
    fi
}

# Fungsi untuk memeriksa konfigurasi
check_config() {
    local file=$1
    local name=$2
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓${NC} $name sudah terkonfigurasi"
        return 0
    else
        echo -e "${RED}✗${NC} $name belum terkonfigurasi"
        return 1
    fi
}

# Fungsi untuk menginstall Node.js
install_nodejs() {
    echo -e "\n${YELLOW}Menginstall Node.js...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    apt install -y nodejs
    echo -e "${GREEN}✓${NC} Node.js berhasil diinstall: $(node -v)"
}

# Fungsi untuk menginstall NPM
install_npm() {
    echo -e "\n${YELLOW}Menginstall NPM...${NC}"
    apt install -y npm
    echo -e "${GREEN}✓${NC} NPM berhasil diinstall: $(npm -v)"
}

# Fungsi untuk menginstall Nginx
install_nginx() {
    echo -e "\n${YELLOW}Menginstall Nginx...${NC}"
    apt install -y nginx
    echo -e "${GREEN}✓${NC} Nginx berhasil diinstall: $(nginx -v 2>&1)"
}

# Fungsi untuk menginstall Git
install_git() {
    echo -e "\n${YELLOW}Menginstall Git...${NC}"
    apt install -y git
    echo -e "${GREEN}✓${NC} Git berhasil diinstall: $(git --version)"
}

# Fungsi untuk menginstall Certbot
install_certbot() {
    echo -e "\n${YELLOW}Menginstall Certbot...${NC}"
    apt install -y certbot python3-certbot-nginx
    echo -e "${GREEN}✓${NC} Certbot berhasil diinstall"
}

# Fungsi untuk konfigurasi SSL
configure_ssl() {
    echo -e "\n${YELLOW}Mengkonfigurasi SSL untuk domain $DOMAIN...${NC}"
    certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN \
        --redirect --keep-until-expiring
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} SSL berhasil dikonfigurasi untuk $DOMAIN"
        # Setup auto renewal
        systemctl enable certbot.timer
        systemctl start certbot.timer
        echo -e "${GREEN}✓${NC} Auto-renewal SSL telah diaktifkan"
    else
        echo -e "${RED}✗${NC} Gagal mengkonfigurasi SSL"
        return 1
    fi
}

# Periksa dan install dependensi yang dibutuhkan
echo -e "\n${BLUE}Memeriksa dependensi yang dibutuhkan...${NC}"

# Update package list
echo -e "\n${YELLOW}Memperbarui package list...${NC}"
apt update

# Cek dan install Git
if ! check_command "git"; then
    install_git
fi

# Cek dan install Nginx
if ! check_command "nginx"; then
    install_nginx
fi

# Cek dan install Node.js dengan versi yang sesuai
if ! check_nodejs_version; then
    install_nodejs
fi

# Cek dan install NPM dengan versi yang sesuai
if ! check_npm_version; then
    install_npm
fi

# Periksa instalasi yang sudah ada
echo -e "\n${BLUE}Memeriksa instalasi yang sudah ada...${NC}"
NGINX_CONFIG=$(check_config "/etc/nginx/sites-enabled/web-monitoring" "Nginx config")
SERVICE_CONFIG=$(check_config "/etc/systemd/system/web-monitoring.service" "Service systemd")
APP_CONFIG=$(check_config "/var/www/web-monitoring/.env" "Environment file")

# Tanya user apakah ingin melanjutkan jika ada instalasi sebelumnya
if [ -d "/var/www/web-monitoring" ]; then
    echo -e "\n${YELLOW}Instalasi sebelumnya terdeteksi di /var/www/web-monitoring${NC}"
    read -p "Apakah Anda ingin menghapus dan menginstall ulang? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}Instalasi dibatalkan${NC}"
        exit 1
    fi
    echo -e "${YELLOW}Menghapus instalasi sebelumnya...${NC}"
    rm -rf /var/www/web-monitoring
    rm -f /etc/nginx/sites-enabled/web-monitoring
    rm -f /etc/systemd/system/web-monitoring.service
fi

# Update sistem
echo -e "\n${YELLOW}Updating system...${NC}"
apt upgrade -y

# Create directory
echo -e "\n${YELLOW}Creating application directory...${NC}"
mkdir -p /var/www/web-monitoring
cd /var/www/web-monitoring

# Clone repository
echo -e "\n${YELLOW}Cloning repository...${NC}"
git clone https://github.com/rendiichtiarp/web-monitoring.git .

# Install npm packages
echo -e "\n${YELLOW}Installing Node.js dependencies...${NC}"
npm install
cd client && npm install && npm run build && cd ..

# Create data directory
echo -e "\n${YELLOW}Setting up data directory...${NC}"
mkdir -p /var/www/web-monitoring/data
touch /var/www/web-monitoring/data/history.json
touch /var/www/web-monitoring/data/stats.json

# Set permissions
echo -e "\n${YELLOW}Setting permissions...${NC}"
chown -R www-data:www-data /var/www/web-monitoring
chmod -R 755 /var/www/web-monitoring
chmod -R 755 /var/www/web-monitoring/data

# Create .env file
echo -e "\n${YELLOW}Creating environment file...${NC}"
cat > /var/www/web-monitoring/.env << EOL
PORT=5000
NODE_ENV=production
CORS_ORIGIN=http://localhost
HISTORY_FILE=/var/www/web-monitoring/data/history.json
STATS_FILE=/var/www/web-monitoring/data/stats.json
EOL

# Create service file
echo -e "\n${YELLOW}Creating service file...${NC}"
cat > /etc/systemd/system/web-monitoring.service << EOL
[Unit]
Description=Server Monitoring Dashboard
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
EOL

# Tanya user tentang penggunaan domain
echo -e "\n${BLUE}Konfigurasi Domain${NC}"
read -p "Apakah Anda ingin menggunakan domain? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    USE_DOMAIN=true
    read -p "Masukkan domain Anda (contoh: example.com): " DOMAIN
    
    # Validasi format domain sederhana
    if [[ ! $DOMAIN =~ ^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$ ]]; then
        echo -e "${RED}Format domain tidak valid!${NC}"
        exit 1
    fi
    
    # Tanya tentang penggunaan SSL
    echo -e "\n${BLUE}Konfigurasi SSL${NC}"
    read -p "Apakah Anda ingin mengkonfigurasi SSL untuk domain Anda? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        USE_SSL=true
        install_certbot
    fi
fi

# Configure Nginx with domain support
echo -e "\n${YELLOW}Configuring Nginx...${NC}"
if [ "$USE_DOMAIN" = true ]; then
    cat > /etc/nginx/sites-available/web-monitoring << EOL
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        root /var/www/web-monitoring/client/build;
        index index.html;
        try_files \$uri \$uri/ /index.html;
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
        proxy_set_header X-Forwarded-Proto \$scheme;

        # Optimized WebSocket settings
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
        proxy_connect_timeout 60s;
        proxy_buffer_size 64k;
        proxy_buffers 8 32k;
        proxy_busy_buffers_size 128k;
    }

    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-XSS-Protection "1; mode=block";
    add_header X-Content-Type-Options "nosniff";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    
    # Logging
    access_log /var/log/nginx/web-monitoring.access.log;
    error_log /var/log/nginx/web-monitoring.error.log;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
    gzip_comp_level 6;
    gzip_min_length 1000;
}
EOL
else
    cat > /etc/nginx/sites-available/web-monitoring << EOL
server {
    listen 80 default_server;
    server_name _;

    location / {
        root /var/www/web-monitoring/client/build;
        index index.html;
        try_files \$uri \$uri/ /index.html;
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
        
        # Optimized WebSocket settings
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
        proxy_connect_timeout 60s;
        proxy_buffer_size 64k;
        proxy_buffers 8 32k;
        proxy_busy_buffers_size 128k;
    }

    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-XSS-Protection "1; mode=block";
    add_header X-Content-Type-Options "nosniff";
    
    # Logging
    access_log /var/log/nginx/web-monitoring.access.log;
    error_log /var/log/nginx/web-monitoring.error.log;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
    gzip_comp_level 6;
    gzip_min_length 1000;
}
EOL
fi

# Enable site
ln -sf /etc/nginx/sites-available/web-monitoring /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test Nginx config
nginx -t

# Configure SSL if requested
if [ "$USE_SSL" = true ]; then
    configure_ssl
fi

# Start services
echo -e "\n${YELLOW}Starting services...${NC}"
systemctl daemon-reload
systemctl enable web-monitoring
systemctl start web-monitoring
systemctl restart nginx

# Configure firewall
echo -e "\n${YELLOW}Configuring firewall...${NC}"
if command -v ufw >/dev/null; then
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw allow 5000/tcp
fi

# Verifikasi instalasi
echo -e "\n${BLUE}Verifikasi instalasi:${NC}"
echo -e "1. Nginx config: $(check_config "/etc/nginx/sites-enabled/web-monitoring" "Nginx")"
echo -e "2. Service systemd: $(check_config "/etc/systemd/system/web-monitoring.service" "Service")"
echo -e "3. Environment file: $(check_config "/var/www/web-monitoring/.env" "Env")"
echo -e "4. Data directory: $(check_config "/var/www/web-monitoring/data/history.json" "Data")"

# Tampilkan versi aplikasi yang terinstall
echo -e "\n${BLUE}Versi aplikasi yang terinstall:${NC}"
echo -e "Node.js: $(node -v)"
echo -e "NPM: $(npm -v)"
echo -e "Nginx: $(nginx -v 2>&1)"
echo -e "Git: $(git --version)"

# Tampilkan status dan URL
echo -e "\n${GREEN}=====================================${NC}"
echo -e "${GREEN}Installation completed!${NC}"
echo -e "${GREEN}You can access the dashboard at:${NC}"
if [ "$USE_DOMAIN" = true ]; then
    if [ "$USE_SSL" = true ]; then
        echo -e "${GREEN}https://$DOMAIN${NC}"
    else
        echo -e "${GREEN}http://$DOMAIN${NC}"
    fi
else
    echo -e "${GREEN}http://YOUR_SERVER_IP${NC}"
fi
echo -e "${GREEN}=====================================${NC}"

# Tampilkan informasi SSL jika digunakan
if [ "$USE_SSL" = true ]; then
    echo -e "\n${BLUE}Informasi SSL:${NC}"
    echo -e "SSL Certificate akan diperbarui secara otomatis"
    echo -e "Certificate location: /etc/letsencrypt/live/$DOMAIN/"
    echo -e "Renewal service: $(systemctl is-active certbot.timer)"
fi

# Display service status
echo -e "\n${YELLOW}Service status:${NC}"
systemctl status web-monitoring --no-pager
systemctl status nginx --no-pager 