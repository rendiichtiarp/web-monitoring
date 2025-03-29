#!/bin/bash

# Warna untuk output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}    Server Monitoring Installer      ${NC}"
echo -e "${GREEN}    System Dashboard v1.0           ${NC}"
echo -e "${GREEN}=====================================${NC}"

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo -e "${RED}Please run as root${NC}"
  exit 1
fi

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

# Periksa instalasi yang sudah ada
echo -e "\n${BLUE}Memeriksa instalasi yang sudah ada...${NC}"
NGINX_INSTALLED=$(check_package "nginx")
NODEJS_INSTALLED=$(check_package "nodejs")
NPM_INSTALLED=$(check_package "npm")
GIT_INSTALLED=$(check_package "git")

echo -e "\n${BLUE}Memeriksa konfigurasi...${NC}"
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
apt update && apt upgrade -y

# Install dependencies jika belum ada
echo -e "\n${YELLOW}Installing dependencies...${NC}"
if [ "$NGINX_INSTALLED" == 1 ]; then apt install -y nginx; fi
if [ "$NODEJS_INSTALLED" == 1 ]; then 
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    apt install -y nodejs
fi
if [ "$NPM_INSTALLED" == 1 ]; then apt install -y npm; fi
if [ "$GIT_INSTALLED" == 1 ]; then apt install -y git; fi

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

# Configure Nginx
echo -e "\n${YELLOW}Configuring Nginx...${NC}"
cat > /etc/nginx/sites-available/web-monitoring << EOL
server {
    listen 80;
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
    }

    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOL

# Enable site
ln -sf /etc/nginx/sites-available/web-monitoring /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test Nginx config
nginx -t

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

# Tampilkan status dan URL
echo -e "\n${GREEN}=====================================${NC}"
echo -e "${GREEN}Installation completed!${NC}"
echo -e "${GREEN}You can access the dashboard at:${NC}"
echo -e "${GREEN}http://YOUR_SERVER_IP${NC}"
echo -e "${GREEN}=====================================${NC}"

# Display service status
echo -e "\n${YELLOW}Service status:${NC}"
systemctl status web-monitoring --no-pager
systemctl status nginx --no-pager 