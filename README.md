# VPS Server Monitoring Dashboard

Aplikasi web untuk monitoring server VPS Debian 12 yang menampilkan metrics sistem secara real-time.

## Fitur

- Monitoring CPU usage dengan grafik real-time
- Monitoring Memory usage dengan grafik real-time
- Monitoring Disk usage untuk setiap partisi
- Monitoring Network traffic (download/upload)
- Informasi proses sistem
- Tampilan dark mode yang modern
- Update data real-time menggunakan WebSocket

## Persyaratan Sistem

- Debian 12 VPS
- Node.js v18 atau lebih tinggi
- NPM v6 atau lebih tinggi
- Nginx
- Git

## Instalasi Otomatis (Rekomendasi)

Untuk instalasi otomatis, gunakan script berikut:

```bash
# Download script instalasi
wget https://raw.githubusercontent.com/rendiichtiarp/web-monitoring/main/install.sh

# Beri izin eksekusi
chmod +x install.sh

# Jalankan script instalasi
sudo ./install.sh
```

Script akan melakukan semua langkah instalasi secara otomatis, termasuk:
- Update sistem
- Instalasi dependencies
- Konfigurasi Nginx
- Setup service
- Konfigurasi firewall
- Dan lainnya

Setelah instalasi selesai, dashboard dapat diakses di:
- http://localhost (jika mengakses dari server)
- http://IP_SERVER (jika mengakses dari luar)

## Instalasi Manual

Jika Anda ingin melakukan instalasi manual, ikuti langkah-langkah berikut:

## Langkah Instalasi di Debian 12

### 1. Persiapan Server
```bash
# Update sistem
sudo apt update && sudo apt upgrade -y

# Install Node.js dan npm
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install Nginx
sudo apt install -y nginx

# Install Git
sudo apt install -y git

# Verifikasi instalasi
node --version
npm --version
nginx -v
```

### 2. Clone dan Setup Aplikasi
```bash
# Buat direktori untuk aplikasi
mkdir -p /var/www
cd /var/www

# Clone repository
git clone https://github.com/rendiichtiarp/web-monitoring.git web-monitoring
cd web-monitoring

# Install dependencies backend
npm install

# Install dependencies frontend
cd client
npm install
npm run build
cd ..
```

### 3. Konfigurasi Environment
```bash
# Buat file .env di root folder
cat << EOF > .env
PORT=5000
NODE_ENV=production
EOF
```

### 4. Setup Service Systemd
```bash
# Buat file service
sudo nano /etc/systemd/system/web-monitoring.service
```

Isi dengan konfigurasi berikut:
```ini
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
```

### 5. Konfigurasi Nginx
```bash
# Buat konfigurasi Nginx
sudo nano /etc/nginx/sites-available/web-monitoring
```

Isi dengan konfigurasi berikut:
```nginx
server {
    listen 80;
    server_name your-domain.com; # Ganti dengan domain Anda

    root /var/www/web-monitoring/client/build;
    index index.html;

    # Frontend static files
    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    # Backend API dan WebSocket
    location /socket.io/ {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # WebSocket timeout settings yang dioptimalkan
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
        proxy_connect_timeout 60s;
        proxy_buffer_size 64k;
        proxy_buffers 8 32k;
        proxy_busy_buffers_size 128k;
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-XSS-Protection "1; mode=block";
    add_header X-Content-Type-Options "nosniff";
    add_header Cache-Control "no-cache, no-store, must-revalidate";
    add_header Pragma "no-cache";
    add_header Expires "0";

    # Logging
    access_log /var/log/nginx/web-monitoring.access.log;
    error_log /var/log/nginx/web-monitoring.error.log;
}
```

### 6. Aktifkan Konfigurasi
```bash
# Buat symlink
sudo ln -s /etc/nginx/sites-available/web-monitoring /etc/nginx/sites-enabled/

# Set permissions
sudo chown -R www-data:www-data /var/www/web-monitoring
sudo chmod -R 755 /var/www/web-monitoring

# Test konfigurasi Nginx
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx

# Start dan enable service monitoring
sudo systemctl start web-monitoring
sudo systemctl enable web-monitoring
```

### 7. Setup Firewall (UFW)
```bash
# Install UFW jika belum ada
sudo apt install -y ufw

# Konfigurasi firewall
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 22/tcp

# Aktifkan firewall
sudo ufw enable
```

### 8. SSL/HTTPS (Opsional)
```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Setup SSL
sudo certbot --nginx -d your-domain.com

# Auto-renewal SSL
sudo systemctl status certbot.timer
```

## Monitoring dan Troubleshooting

### Monitor Log
```bash
# Log aplikasi
sudo journalctl -u web-monitoring -f

# Log Nginx
sudo tail -f /var/log/nginx/web-monitoring.error.log
sudo tail -f /var/log/nginx/web-monitoring.access.log
```

### Cek Status Service
```bash
# Status aplikasi
sudo systemctl status web-monitoring

# Status Nginx
sudo systemctl status nginx
```

### Restart Service
```bash
# Restart aplikasi
sudo systemctl restart web-monitoring

# Restart Nginx
sudo systemctl restart nginx
```

## Pemeliharaan

### Update Aplikasi
```bash
cd /var/www/web-monitoring
git pull
npm install
cd client
npm install
npm run build
cd ..
sudo systemctl restart web-monitoring
```

### Backup Konfigurasi
```bash
# Backup Nginx config
sudo cp /etc/nginx/sites-available/web-monitoring /etc/nginx/sites-available/web-monitoring.backup

# Backup .env
cp .env .env.backup
```

## Troubleshooting Umum

### 1. Masalah WebSocket
Jika mengalami error "websocket error":
- Periksa konfigurasi Nginx terutama bagian location /socket.io/
- Pastikan port 5000 tidak diblokir firewall
- Cek log aplikasi untuk error spesifik

### 2. Masalah Permission
```bash
# Reset permissions jika diperlukan
sudo chown -R www-data:www-data /var/www/web-monitoring
sudo chmod -R 755 /var/www/web-monitoring
```

### 3. Masalah Service Tidak Jalan
```bash
# Cek status dan log
sudo systemctl status web-monitoring
sudo journalctl -u web-monitoring -n 100 --no-pager
```

## Catatan Penting

1. Ganti `your-domain.com` dengan domain Anda yang sebenarnya
2. Pastikan DNS sudah dikonfigurasi dengan benar jika menggunakan domain
3. Backup konfigurasi sebelum melakukan perubahan besar
4. Monitor penggunaan resource server secara berkala
5. Update sistem dan dependencies secara teratur

## Keamanan

1. Selalu gunakan HTTPS di production
2. Update sistem secara berkala
3. Monitor log untuk aktivitas mencurigakan
4. Batasi akses SSH hanya dari IP yang dipercaya
5. Gunakan strong password atau SSH key

## Support

Jika mengalami masalah atau butuh bantuan:
1. Cek log aplikasi dan Nginx
2. Periksa status service
3. Pastikan semua port yang diperlukan terbuka
4. Verifikasi konfigurasi Nginx

## Penggunaan

Dashboard akan menampilkan metrics server secara real-time, termasuk:
- Grafik penggunaan CPU
- Grafik penggunaan Memory
- Informasi penggunaan Disk
- Statistik Network
- Informasi Proses

Data akan diperbarui setiap 2 detik secara otomatis. 