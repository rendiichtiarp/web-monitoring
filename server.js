const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const si = require('systeminformation');
const cors = require('cors');
const path = require('path');
const os = require('os');
const fs = require('fs');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Middleware CORS yang dioptimalkan
app.use(cors({
  origin: "http://localhost:3000",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept"],
  credentials: true,
  maxAge: 86400
}));

// Konfigurasi Socket.IO yang dioptimalkan
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Accept"],
    credentials: true
  },
  transports: ['websocket'],
  pingTimeout: 30000,        // Kurangi timeout ping
  pingInterval: 10000,       // Sesuaikan interval ping
  upgradeTimeout: 15000,     // Kurangi timeout upgrade
  maxHttpBufferSize: 1e6,
  allowEIO3: true,
  path: '/socket.io/',
  serveClient: true,
  connectTimeout: 20000,     // Kurangi timeout koneksi
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 500,    // Kurangi delay reconnection
  reconnectionDelayMax: 2000 // Kurangi max delay
});

// Tambahkan middleware untuk menangani OPTIONS request
app.options('*', cors());

// Tambahkan route untuk mengecek koneksi Socket.IO
app.get('/socket.io/', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.send(JSON.stringify({ 
    status: 'ok', 
    message: 'Socket.IO endpoint aktif',
    transports: ['websocket']
  }));
});

// Konstanta
const UPDATE_INTERVAL = 1000;  // Ubah ke 1 detik untuk update lebih real-time
const CACHE_DURATION = 500;   // Kurangi cache duration
const MAX_RETRIES = 3;
const SOCKET_RETRY_DELAY = 1000; // Kurangi delay retry
const ACTIVE_CONNECTIONS = new Map();
const HISTORY_FILE = path.join(__dirname, 'data', 'history.json');
const STATS_FILE = path.join(__dirname, 'data', 'stats.json');
const MAX_HISTORY_LENGTH = 60;  // Tambah panjang history untuk data lebih detail

// Buat direktori data jika belum ada
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}

// Inisialisasi data historis dan statistik
let systemHistory = {
  cpu: [],
  memory: [],
  network: {
    download: [],
    upload: []
  },
  timestamp: new Date().toISOString()
};

let lastStats = {
  cpu: { load: 0, cores: 0 },
  memory: { total: 0, used: 0, usedPercent: 0 },
  disk: [],
  network: [],
  os: {},
  timestamp: new Date().toISOString()
};

// Load data historis dan statistik jika ada
try {
  if (fs.existsSync(HISTORY_FILE)) {
    const historyData = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    systemHistory = {
      cpu: Array.isArray(historyData.cpu) ? historyData.cpu : [],
      memory: Array.isArray(historyData.memory) ? historyData.memory : [],
      network: {
        download: Array.isArray(historyData.network?.download) ? historyData.network.download : [],
        upload: Array.isArray(historyData.network?.upload) ? historyData.network.upload : []
      },
      timestamp: historyData.timestamp || new Date().toISOString()
    };
  }

  if (fs.existsSync(STATS_FILE)) {
    lastStats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  }
} catch (error) {
  console.error('Error loading data:', error);
}

// Fungsi untuk menyimpan statistik terakhir
const saveStats = (data) => {
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error saving stats:', error);
  }
};

// Modifikasi fungsi saveHistory untuk menyimpan data dengan format yang lebih baik
const saveHistory = (data) => {
  try {
    const currentTime = new Date().toLocaleTimeString('id-ID');
    
    // Update CPU history
    systemHistory.cpu.push({
      time: currentTime,
      value: parseFloat(data.cpu.load) || 0,
      timestamp: Date.now()
    });
    if (systemHistory.cpu.length > MAX_HISTORY_LENGTH) {
      systemHistory.cpu.shift();
    }

    // Update Memory history
    systemHistory.memory.push({
      time: currentTime,
      value: parseFloat(data.memory.usedPercent) || 0,
      timestamp: Date.now()
    });
    if (systemHistory.memory.length > MAX_HISTORY_LENGTH) {
      systemHistory.memory.shift();
    }

    // Update Network history
    if (data.network && Array.isArray(data.network) && data.network.length > 0) {
      const networkData = data.network[0];
      
      // Download history
      systemHistory.network.download.push({
        time: currentTime,
        value: parseFloat(networkData.rx_speed_raw) || 0,
        timestamp: Date.now()
      });
      if (systemHistory.network.download.length > MAX_HISTORY_LENGTH) {
        systemHistory.network.download.shift();
      }

      // Upload history
      systemHistory.network.upload.push({
        time: currentTime,
        value: parseFloat(networkData.tx_speed_raw) || 0,
        timestamp: Date.now()
      });
      if (systemHistory.network.upload.length > MAX_HISTORY_LENGTH) {
        systemHistory.network.upload.shift();
      }
    }

    systemHistory.timestamp = new Date().toISOString();

    // Simpan history ke file
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(systemHistory, null, 2));
    
    // Simpan statistik terakhir
    lastStats = { ...data, timestamp: new Date().toISOString() };
    saveStats(lastStats);
  } catch (error) {
    console.error('Error saving history:', error);
  }
};

// Cache untuk menyimpan data sistem
let systemInfoCache = {
  data: null,
  timestamp: 0,
  retryCount: 0
};

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client/build')));

// Tambahkan route untuk health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Fungsi helper untuk memformat bytes
const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

// Fungsi helper untuk memformat network speed
const formatNetworkSpeed = (bytesPerSec, decimals = 2) => {
  if (bytesPerSec === 0) return '0 bps';
  const bits = bytesPerSec * 8; // Konversi bytes ke bits
  const k = 1000;
  const sizes = ['bps', 'Kbps', 'Mbps', 'Gbps'];
  const i = Math.floor(Math.log(bits) / Math.log(k));
  return parseFloat((bits / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[Math.min(i, sizes.length - 1)];
};

// Simpan data network terakhir untuk perhitungan delta
let lastNetworkStats = null;
let lastNetworkTime = null;

// Modifikasi fungsi getSystemInfo untuk mengoptimalkan data
async function getSystemInfo() {
  try {
    const [currentStats, cpu, mem, disk, osInfo] = await Promise.all([
      si.networkStats(),
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.osInfo()
    ]);

    const currentTime = Date.now();
    
    // Hitung network speed berdasarkan delta waktu yang sebenarnya
    const networkStats = currentStats.map((current) => {
      let rx_speed = 0;
      let tx_speed = 0;

      if (lastNetworkStats && lastNetworkTime) {
        const timeDiff = (currentTime - lastNetworkTime) / 1000; // Konversi ke detik
        const lastStat = lastNetworkStats.find(stat => stat.iface === current.iface);
        
        if (lastStat) {
          // Hitung kecepatan berdasarkan delta bytes dan waktu sebenarnya
          rx_speed = (current.rx_bytes - lastStat.rx_bytes) / timeDiff;
          tx_speed = (current.tx_bytes - lastStat.tx_bytes) / timeDiff;
          
          // Pastikan tidak ada nilai negatif
          rx_speed = Math.max(0, rx_speed);
          tx_speed = Math.max(0, tx_speed);
        }
      }

      return {
        iface: current.iface,
        rx_sec: rx_speed,
        tx_sec: tx_speed,
        rx_bytes: current.rx_bytes,
        tx_bytes: current.tx_bytes
      };
    });

    // Update data terakhir untuk perhitungan berikutnya
    lastNetworkStats = currentStats;
    lastNetworkTime = currentTime;

    // Format data untuk response
    return {
      cpu: {
        load: cpu.currentLoad ? cpu.currentLoad.toFixed(1) : '0.0',
        cores: os.cpus().length
      },
      memory: {
        total: (mem.total / (1024 * 1024 * 1024)).toFixed(1),
        used: (mem.used / (1024 * 1024 * 1024)).toFixed(1),
        usedPercent: ((mem.used / mem.total) * 100).toFixed(1)
      },
      disk: disk.map(partition => ({
        fs: partition.fs,
        size: formatBytes(partition.size),
        used: formatBytes(partition.used),
        available: formatBytes(partition.available),
        usedPercent: ((partition.used / partition.size) * 100).toFixed(1)
      })),
      network: networkStats.map(net => ({
        interface: net.iface,
        rx_sec: formatNetworkSpeed(net.rx_sec),
        tx_sec: formatNetworkSpeed(net.tx_sec),
        rx_bytes: formatBytes(net.rx_bytes),
        tx_bytes: formatBytes(net.tx_bytes),
        // Tambahkan nilai raw untuk grafik
        rx_speed_raw: net.rx_sec,
        tx_speed_raw: net.tx_sec
      })),
      os: {
        platform: osInfo.platform,
        distro: osInfo.distro,
        release: osInfo.release,
        hostname: os.hostname(),
        uptime: os.uptime()
      },
      timestamp: currentTime
    };
  } catch (error) {
    console.error('Error in getSystemInfo:', error);
    throw error;
  }
}

// Routes
app.get('/', (req, res) => {
  res.json({
    status: 'Server berjalan',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    endpoints: {
      systemInfo: '/api/system-info',
      websocket: 'ws://localhost:5000'
    },
    updateInterval: UPDATE_INTERVAL
  });
});

app.get('/api/system-info', async (req, res) => {
  try {
    const systemInfo = await getSystemInfo();
    res.json(systemInfo);
  } catch (error) {
    res.status(500).json({ 
      error: 'Gagal mendapatkan informasi sistem',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Tambahkan route untuk mendapatkan data historis
app.get('/api/history', (req, res) => {
  res.json({
    history: systemHistory,
    lastStats: lastStats
  });
});

// Error handling
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Route tidak ditemukan',
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Terjadi kesalahan pada server',
    details: err.message,
    timestamp: new Date().toISOString()
  });
});

// Modifikasi event handler connection
io.on('connection', async (socket) => {
  console.log('Client terhubung:', socket.id);
  
  let updateInterval;
  let retryCount = 0;
  
  const connection = {
    id: socket.id,
    connected: true,
    lastPing: Date.now(),
    updateInterval: null,
    retryCount: 0,
    reconnecting: false,
    lastData: null
  };
  
  ACTIVE_CONNECTIONS.set(socket.id, connection);

  // Handle ping dengan timeout yang lebih lama
  socket.on('ping', () => {
    if (!socket.connected) return;
    socket.emit('pong', { 
      timestamp: new Date().toISOString(),
      id: socket.id 
    });
    const conn = ACTIVE_CONNECTIONS.get(socket.id);
    if (conn) {
      conn.lastPing = Date.now();
      conn.retryCount = 0;
      conn.reconnecting = false;
    }
  });

  // Handle error
  socket.on('error', (error) => {
    console.error(`Socket error (${socket.id}):`, error);
    const conn = ACTIVE_CONNECTIONS.get(socket.id);
    if (conn) {
      conn.retryCount++;
      if (conn.retryCount <= MAX_RETRIES) {
        conn.reconnecting = true;
        setTimeout(() => {
          if (socket.connected) {
            startUpdateInterval();
          }
        }, SOCKET_RETRY_DELAY);
      }
    }
  });

  // Handle disconnect dengan reconnect yang lebih baik
  socket.on('disconnect', (reason) => {
    console.log(`Client terputus (${socket.id}). Alasan:`, reason);
    
    const conn = ACTIVE_CONNECTIONS.get(socket.id);
    if (conn) {
      conn.connected = false;
      conn.disconnectTime = Date.now();
      
      if (conn.updateInterval) {
        clearInterval(conn.updateInterval);
        conn.updateInterval = null;
      }

      // Coba reconnect jika disconnect bukan karena client sengaja memutuskan
      if (reason !== 'client namespace disconnect' && !conn.reconnecting) {
        conn.reconnecting = true;
        setTimeout(() => {
          if (socket.connected) {
            conn.connected = true;
            conn.reconnecting = false;
            startUpdateInterval();
          }
        }, SOCKET_RETRY_DELAY);
      }
    }

    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = null;
    }
  });

  const startUpdateInterval = async () => {
    try {
      const conn = ACTIVE_CONNECTIONS.get(socket.id);
      if (!conn || !socket.connected) return;

      // Kirim data awal
      const initialData = await getSystemInfo();
      if (socket.connected) {
        socket.emit('systemInfo', initialData);
        saveHistory(initialData);
        conn.lastData = initialData;
      }

      // Set interval untuk update
      if (conn.updateInterval) {
        clearInterval(conn.updateInterval);
      }

      conn.updateInterval = setInterval(async () => {
        try {
          if (!socket.connected) {
            clearInterval(conn.updateInterval);
            return;
          }

          const newData = await getSystemInfo();
          if (socket.connected) {
            // Hanya kirim data jika ada perubahan signifikan
            if (hasSignificantChanges(newData, conn.lastData)) {
              socket.emit('systemInfo', newData);
              saveHistory(newData);
              conn.lastData = newData;
              conn.retryCount = 0;
            }
          }
        } catch (err) {
          console.error('Error in update interval:', err);
          conn.retryCount++;

          if (conn.retryCount > MAX_RETRIES) {
            clearInterval(conn.updateInterval);
            socket.disconnect();
          }
        }
      }, UPDATE_INTERVAL);

      ACTIVE_CONNECTIONS.set(socket.id, conn);

    } catch (err) {
      console.error('Error starting update interval:', err);
      retryCount++;
      
      if (retryCount <= MAX_RETRIES && socket.connected) {
        setTimeout(() => startUpdateInterval(), SOCKET_RETRY_DELAY);
      } else {
        socket.disconnect();
      }
    }
  };

  await startUpdateInterval();
});

// Tambahkan interval untuk monitoring koneksi aktif
setInterval(() => {
  const now = Date.now();
  io.sockets.emit('ping');
  
  // Log status koneksi aktif
  console.log(`Koneksi aktif: ${ACTIVE_CONNECTIONS.size}`);
  for (const [socketId, connection] of ACTIVE_CONNECTIONS.entries()) {
    if (connection.connected) {
      console.log(`- Socket ${socketId}: Last ping ${Math.floor((now - connection.lastPing) / 1000)}s ago`);
    }
  }
}, 30000);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Performing graceful shutdown...');
  server.close(() => {
    console.log('Server closed. Exiting process.');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server berjalan pada port ${PORT}`);
  console.log(`Interval pembaruan: ${UPDATE_INTERVAL}ms`);
  console.log(`Cache duration: ${CACHE_DURATION}ms`);
}); 