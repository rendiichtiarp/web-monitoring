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

## Instalasi Otomatis

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