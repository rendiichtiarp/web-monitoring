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
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,        // Naikkan timeout ping
  pingInterval: 25000,       // Sesuaikan interval ping
  upgradeTimeout: 30000,     // Naikkan timeout upgrade
  maxHttpBufferSize: 1e6,
  allowEIO3: true,
  path: '/socket.io/',
  serveClient: true,
  connectTimeout: 45000,     // Naikkan timeout koneksi
  reconnection: true,        // Aktifkan reconnection
  reconnectionAttempts: 5,   // Maksimal 5 kali percobaan
  reconnectionDelay: 1000,   // Delay 1 detik sebelum mencoba lagi
  reconnectionDelayMax: 5000 // Maksimal delay 5 detik
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
    transports: ['websocket', 'polling']
  }));
});

// Konstanta
const UPDATE_INTERVAL = 3000;  // Naikkan ke 3 detik
const CACHE_DURATION = 2000;   // Naikkan ke 2 detik
const MAX_RETRIES = 3;        // Kurangi max retries
const SOCKET_RETRY_DELAY = 3000; // Naikkan delay retry
const ACTIVE_CONNECTIONS = new Map();
const HISTORY_FILE = path.join(__dirname, 'data', 'history.json');
const STATS_FILE = path.join(__dirname, 'data', 'stats.json');
const MAX_HISTORY_LENGTH = 30;  // Kurangi panjang history
const DEBUG = true; // Enable debugging

// Fungsi helper untuk logging
const debugLog = (message, data) => {
  if (DEBUG) {
    console.log(`[DEBUG] ${message}:`, data);
  }
};

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
        value: parseFloat(networkData.rx_sec) || 0,
        timestamp: Date.now()
      });
      if (systemHistory.network.download.length > MAX_HISTORY_LENGTH) {
        systemHistory.network.download.shift();
      }

      // Upload history
      systemHistory.network.upload.push({
        time: currentTime,
        value: parseFloat(networkData.tx_sec) || 0,
        timestamp: Date.now()
      });
      if (systemHistory.network.upload.length > MAX_HISTORY_LENGTH) {
        systemHistory.network.upload.shift();
      }

      // Debug log untuk network
      debugLog('Network history updated', {
        interface: networkData.iface,
        download: systemHistory.network.download[systemHistory.network.download.length - 1],
        upload: systemHistory.network.upload[systemHistory.network.upload.length - 1]
      });
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
    // Dapatkan semua interface network yang aktif
    const networkInterfaces = await si.networkInterfaces();
    const currentStats = await si.networkStats();
    const [cpuData, mem, disk, osInfo] = await Promise.all([
      si.currentLoad().then(data => ({
        ...data,
        cpus: data.cpus || []
      })),
      si.mem(),
      si.fsSize(),
      si.osInfo()
    ]);

    const currentTime = Date.now();
    
    // Filter hanya interface yang aktif
    const activeInterfaces = networkInterfaces.filter(iface => 
      iface.operstate === 'up' && !iface.internal
    );
    
    // Hitung network speed untuk semua interface aktif
    const networkStats = currentStats
      .filter(stat => activeInterfaces.some(iface => iface.iface === stat.iface))
      .map((current) => {
        let rx_speed = 0;
        let tx_speed = 0;

        if (lastNetworkStats && lastNetworkTime) {
          const timeDiff = (currentTime - lastNetworkTime) / 1000; // Konversi ke detik
          const lastStat = lastNetworkStats.find(stat => stat.iface === current.iface);
          
          if (lastStat && timeDiff > 0) {
            rx_speed = Math.max(0, (current.rx_bytes - lastStat.rx_bytes) / timeDiff);
            tx_speed = Math.max(0, (current.tx_bytes - lastStat.tx_bytes) / timeDiff);
          }
        }

        return {
          iface: current.iface,
          rx_sec: rx_speed,
          tx_sec: tx_speed,
          rx_bytes: current.rx_bytes,
          tx_bytes: current.tx_bytes,
          operstate: activeInterfaces.find(i => i.iface === current.iface)?.operstate || 'unknown'
        };
    });

    // Update data terakhir untuk perhitungan berikutnya
    lastNetworkStats = currentStats;
    lastNetworkTime = currentTime;

    // Format data untuk response
    return {
      cpu: {
        load: cpuData.currentLoad ? cpuData.currentLoad.toFixed(1) : '0.0',
        cores: os.cpus().length,
        perCore: cpuData.cpus.map((core, index) => ({
          core: index + 1,
          load: core.load ? core.load.toFixed(1) : '0.0'
        }))
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
      network: networkStats,
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
  try {
    debugLog('New client connected', socket.id);
    ACTIVE_CONNECTIONS.set(socket.id, {
      connected: true,
      lastPing: Date.now()
    });

    // Kirim data awal
    const initialData = await getSystemInfo();
    debugLog('Initial network interfaces', initialData.network);
    socket.emit('systemInfo', initialData);

    socket.on('disconnect', () => {
      debugLog('Client disconnected', socket.id);
      ACTIVE_CONNECTIONS.delete(socket.id);
    });

    socket.on('pong', () => {
      const connection = ACTIVE_CONNECTIONS.get(socket.id);
      if (connection) {
        connection.lastPing = Date.now();
        debugLog('Client pong received', { socketId: socket.id, lastPing: connection.lastPing });
      }
    });

  } catch (error) {
    console.error('Error in socket connection:', error);
  }
});

// Update interval untuk monitoring
setInterval(async () => {
  try {
    const data = await getSystemInfo();
    debugLog('Network statistics', data.network);
    io.emit('systemInfo', data);
    saveHistory(data);
  } catch (error) {
    console.error('Error in update interval:', error);
  }
}, UPDATE_INTERVAL);

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