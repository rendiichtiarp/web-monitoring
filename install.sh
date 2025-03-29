#!/bin/bash

# Warna untuk output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}   Server Monitoring Installer       ${NC}"
echo -e "${GREEN}   System Dashboard                  ${NC}"
echo -e "${GREEN}=====================================${NC}"

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo -e "${RED}Please run as root${NC}"
  exit
fi

# Update sistem
echo -e "${YELLOW}Updating system...${NC}"
apt update && apt upgrade -y

# Install dependencies
echo -e "${YELLOW}Installing dependencies...${NC}"
apt install -y nginx nodejs npm git

# Create directory
echo -e "${YELLOW}Creating application directory...${NC}"
mkdir -p /var/www/web-monitoring
cd /var/www/web-monitoring

# Clone repository
echo -e "${YELLOW}Cloning repository...${NC}"
git clone https://github.com/rendiichtiarp/web-monitoring.git .

# Install npm packages
echo -e "${YELLOW}Installing Node.js dependencies...${NC}"
npm install
cd client && npm install && npm run build && cd ..

# Create data directory
echo -e "${YELLOW}Setting up data directory...${NC}"
mkdir -p /var/www/web-monitoring/data
touch /var/www/web-monitoring/data/history.json
touch /var/www/web-monitoring/data/stats.json

# Set permissions
echo -e "${YELLOW}Setting permissions...${NC}"
chown -R www-data:www-data /var/www/web-monitoring
chmod -R 755 /var/www/web-monitoring
chmod -R 755 /var/www/web-monitoring/data

# Create .env file
echo -e "${YELLOW}Creating environment file...${NC}"
cat > /var/www/web-monitoring/.env << EOL
PORT=5000
NODE_ENV=production
CORS_ORIGIN=http://localhost
HISTORY_FILE=/var/www/web-monitoring/data/history.json
STATS_FILE=/var/www/web-monitoring/data/stats.json
EOL

# Create service file
echo -e "${YELLOW}Creating service file...${NC}"
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
echo -e "${YELLOW}Configuring Nginx...${NC}"
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
echo -e "${YELLOW}Starting services...${NC}"
systemctl daemon-reload
systemctl enable web-monitoring
systemctl start web-monitoring
systemctl restart nginx

# Configure firewall
echo -e "${YELLOW}Configuring firewall...${NC}"
if command -v ufw >/dev/null; then
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw allow 5000/tcp
fi

echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}Installation completed!${NC}"
echo -e "${GREEN}You can access the dashboard at:${NC}"
echo -e "${GREEN}http://YOUR_SERVER_IP${NC}"
echo -e "${GREEN}=====================================${NC}"

# Display service status
echo -e "${YELLOW}Service status:${NC}"
systemctl status web-monitoring --no-pager
systemctl status nginx --no-pager 