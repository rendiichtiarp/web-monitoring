# Server Monitoring Dashboard

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-1.0-blue.svg)](https://github.com/rendiichtiarp/web-monitoring)

Aplikasi web untuk monitoring server VPS Debian 12 yang menampilkan metrics sistem secara real-time dengan tampilan modern dan responsif.

## Fitur

- **CPU Monitoring**
  - Monitoring CPU usage secara real-time dengan grafik
  - Tampilan detail untuk setiap core CPU
  - Riwayat penggunaan CPU dalam grafik area
  - Alert untuk penggunaan CPU tinggi

- **Memory Monitoring**
  - Monitoring RAM usage secara real-time
  - Visualisasi penggunaan memory dengan progress bar
  - Grafik penggunaan memory overtime
  - Informasi total, used, dan available memory

- **Disk Monitoring**
  - Monitoring penggunaan disk untuk setiap partisi
  - Informasi space tersedia dan terpakai
  - Progress bar untuk visualisasi penggunaan
  - Alert untuk disk space yang hampir penuh

- **Network Monitoring**
  - Monitoring traffic jaringan (download/upload)
  - Grafik real-time untuk bandwidth usage
  - Riwayat 5 detik terakhir untuk analisis cepat
  - Konversi otomatis unit (bps, Kbps, Mbps, Gbps)

- **Fitur Tambahan**
  - Dark/Light mode yang dapat disesuaikan
  - Responsive design untuk semua ukuran layar
  - WebSocket untuk update data real-time
  - Penyimpanan data historis dalam format JSON
  - Auto-reconnect saat koneksi terputus
  - Sistem alert dan notifikasi

## Persyaratan Sistem

- Debian 12 VPS
- Node.js v18 atau lebih tinggi
- NPM v6 atau lebih tinggi
- Nginx
- Git
- Minimal RAM: 1GB
- Minimal Storage: 1GB free space

## Instalasi

### 1. Instalasi Otomatis

```bash
# Download script instalasi
wget https://raw.githubusercontent.com/rendiichtiarp/web-monitoring/main/install.sh

# Beri izin eksekusi
chmod +x install.sh

# Jalankan script instalasi
sudo ./install.sh
```

Script instalasi akan:
1. Memeriksa dan memverifikasi dependensi yang dibutuhkan
2. Mendeteksi instalasi yang sudah ada (jika ada)
3. Memberikan opsi untuk instalasi baru atau upgrade
4. Mengkonfigurasi semua komponen yang diperlukan
5. Memverifikasi instalasi di akhir proses

### 2. Instalasi Manual

Jika Anda ingin melakukan instalasi secara manual, ikuti langkah-langkah berikut:

#### A. Persiapan Sistem
```bash
# Update sistem
sudo apt update && sudo apt upgrade -y

# Install dependensi yang dibutuhkan
sudo apt install -y curl git nginx

# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verifikasi instalasi
node --version  # Minimal v18
npm --version   # Minimal v6
```

#### B. Instalasi Aplikasi
```bash
# Buat direktori aplikasi
sudo mkdir -p /var/www/web-monitoring
cd /var/www/web-monitoring

# Clone repository
sudo git clone https://github.com/rendiichtiarp/web-monitoring.git .

# Install dependensi Node.js
sudo npm install
cd client && sudo npm install && sudo npm run build && cd ..

# Buat direktori data
sudo mkdir -p /var/www/web-monitoring/data
sudo touch /var/www/web-monitoring/data/history.json
sudo touch /var/www/web-monitoring/data/stats.json

# Set permissions
sudo chown -R www-data:www-data /var/www/web-monitoring
sudo chmod -R 755 /var/www/web-monitoring
```

#### C. Konfigurasi Environment
```bash
# Buat file .env
sudo cat > /var/www/web-monitoring/.env << EOL
PORT=5000
NODE_ENV=production
CORS_ORIGIN=http://localhost
HISTORY_FILE=/var/www/web-monitoring/data/history.json
STATS_FILE=/var/www/web-monitoring/data/stats.json
EOL
```

#### D. Konfigurasi Service
```bash
# Buat service systemd
sudo cat > /etc/systemd/system/web-monitoring.service << EOL
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

# Aktifkan service
sudo systemctl daemon-reload
sudo systemctl enable web-monitoring
sudo systemctl start web-monitoring
```

#### E. Konfigurasi Nginx

1. **Tanpa Domain (IP Only)**
```bash
sudo cat > /etc/nginx/sites-available/web-monitoring << EOL
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
```

2. **Dengan Domain dan SSL**
```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Konfigurasi Nginx dengan domain
sudo cat > /etc/nginx/sites-available/web-monitoring << EOL
server {
    listen 80;
    server_name your-domain.com;

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
}
EOL

# Aktifkan konfigurasi
sudo ln -sf /etc/nginx/sites-available/web-monitoring /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

# Setup SSL (ganti your-domain.com dengan domain Anda)
sudo certbot --nginx -d your-domain.com

# Aktifkan auto-renewal SSL
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
```

#### F. Konfigurasi Firewall
```bash
# Buka port yang diperlukan
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 5000/tcp
```

#### G. Verifikasi Instalasi
```bash
# Cek status service
sudo systemctl status web-monitoring
sudo systemctl status nginx

# Cek log
sudo journalctl -u web-monitoring -f
sudo tail -f /var/log/nginx/error.log
```

## Konfigurasi

### Port yang Digunakan
- 80: HTTP (Nginx)
- 443: HTTPS (jika SSL dikonfigurasi)
- 5000: Backend API dan WebSocket

### File Konfigurasi Utama
- `/var/www/web-monitoring/.env`: Environment variables
- `/etc/nginx/sites-available/web-monitoring`: Nginx configuration
- `/etc/systemd/system/web-monitoring.service`: Service configuration

### Data Storage
- `/var/www/web-monitoring/data/history.json`: Historical data
- `/var/www/web-monitoring/data/stats.json`: Current statistics

## Penggunaan

Dashboard menampilkan:

### 1. System Overview
- Hostname dan OS info
- Uptime server
- Jumlah CPU core
- Total memory

### 2. CPU Metrics
- Overall CPU usage
- Per-core usage
- Load history graph
- Usage trends

### 3. Memory Metrics
- Current memory usage
- Usage percentage
- Memory history graph
- Available/Used memory

### 4. Network Statistics
- Current upload/download rates
- Network usage graphs
- 5-second history
- Total transferred data

### 5. Disk Information
- Usage per partition
- Available space
- Used space
- Usage percentage

## Pemeliharaan

### Backup Data
```bash
# Backup file konfigurasi
sudo cp /var/www/web-monitoring/.env /var/www/web-monitoring/.env.backup

# Backup data historis
sudo cp -r /var/www/web-monitoring/data /var/www/web-monitoring/data.backup
```

### Update Aplikasi
```bash
cd /var/www/web-monitoring
git pull
npm install
cd client && npm install && npm run build
sudo systemctl restart web-monitoring
```

### Troubleshooting

#### 1. Masalah Koneksi
```bash
# Cek status service
sudo systemctl status web-monitoring

# Cek log
sudo journalctl -u web-monitoring -f
```

#### 2. Masalah Data
```bash
# Reset data historis
sudo rm /var/www/web-monitoring/data/*.json
sudo systemctl restart web-monitoring
```

#### 3. Masalah Nginx
```bash
# Test konfigurasi
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

## Keamanan

1. Firewall dikonfigurasi untuk membatasi akses
2. Semua service berjalan sebagai user www-data
3. File permissions diatur dengan ketat
4. Support untuk HTTPS/SSL
5. Rate limiting untuk API endpoints

## Monitoring dan Logging

### Log Files
- Nginx: `/var/log/nginx/web-monitoring.access.log`
- Application: `journalctl -u web-monitoring`
- System: `dmesg` atau `/var/log/syslog`

### Metrics Storage
- Data disimpan dalam format JSON
- Auto-cleanup untuk data lama
- Configurable retention period
- Backup otomatis (opsional)

## Support

Jika mengalami masalah:
1. Periksa log aplikasi dan sistem
2. Pastikan semua service berjalan
3. Verifikasi koneksi network
4. Cek penggunaan resource
5. Hubungi support jika diperlukan

## Credit

Dikembangkan untuk Server Monitoring System.
Version 1.0

## Lisensi

Proyek ini dilisensikan di bawah Lisensi MIT - lihat file [LICENSE](LICENSE) untuk detail.

### Ketentuan Penggunaan

1. Anda bebas menggunakan aplikasi ini untuk keperluan pribadi maupun komersial
2. Anda dapat memodifikasi dan mendistribusikan ulang kode sumber
3. Anda wajib menyertakan file LICENSE dan copyright notice pada setiap salinan
4. Tidak ada jaminan apapun atas penggunaan aplikasi ini
5. Pemilik aplikasi tidak bertanggung jawab atas kerusakan yang mungkin timbul

### Kontribusi

Kontribusi selalu diterima dengan senang hati. Untuk berkontribusi:

1. Fork repositori ini
2. Buat branch fitur baru (`git checkout -b fitur-baru`)
3. Commit perubahan (`git commit -am 'Menambahkan fitur baru'`)
4. Push ke branch (`git push origin fitur-baru`)
5. Buat Pull Request baru 