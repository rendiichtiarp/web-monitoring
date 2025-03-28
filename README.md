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

- Node.js v14 atau lebih tinggi
- NPM v6 atau lebih tinggi
- Debian 12 VPS

## Instalasi

1. Clone repository ini:
```bash
git clone [url-repository]
cd web-monitoring
```

2. Install dependencies backend:
```bash
npm install
```

3. Install dependencies frontend:
```bash
cd client
npm install
```

4. Kembali ke direktori root dan buat file .env:
```bash
cd ..
echo "PORT=5000" > .env
```

## Menjalankan Aplikasi

1. Jalankan backend server:
```bash
npm run dev
```

2. Di terminal terpisah, jalankan frontend:
```bash
cd client
npm start
```

3. Buka browser dan akses `http://localhost:3000`

## Konfigurasi Nginx (Opsional)

Untuk mengakses dashboard dari luar server, Anda dapat mengkonfigurasi Nginx sebagai reverse proxy:

1. Install Nginx:
```bash
sudo apt update
sudo apt install nginx
```

2. Buat konfigurasi Nginx:
```bash
sudo nano /etc/nginx/sites-available/monitoring
```

3. Tambahkan konfigurasi berikut:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /socket.io/ {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

4. Aktifkan konfigurasi:
```bash
sudo ln -s /etc/nginx/sites-available/monitoring /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## Penggunaan

Dashboard akan menampilkan metrics server secara real-time, termasuk:
- Grafik penggunaan CPU
- Grafik penggunaan Memory
- Informasi penggunaan Disk
- Statistik Network
- Informasi Proses

Data akan diperbarui setiap 2 detik secara otomatis. 