const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const si = require('systeminformation');
const cors = require('cors');
const path = require('path');
const os = require('os');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Konfigurasi Socket.IO yang dioptimalkan
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket'],
  pingTimeout: 60000,        // Turunkan timeout
  pingInterval: 25000,       // Naikkan interval ping
  connectTimeout: 45000,
  maxHttpBufferSize: 1e8,
  allowEIO3: true,
  rememberUpgrade: true,
  cookie: {
    name: 'io',
    httpOnly: true,
    path: '/',
    sameSite: 'strict'
  }
});

// Konstanta
const UPDATE_INTERVAL = 3000;  
const CACHE_DURATION = 2000;   
const MAX_RETRIES = 3;         // Kurangi jumlah retry
const SOCKET_RETRY_DELAY = 5000; // Naikkan delay retry
const ACTIVE_CONNECTIONS = new Map();

// Cache untuk menyimpan data sistem
let systemInfoCache = {
  data: null,
  timestamp: 0,
  retryCount: 0
};

// Middleware
app.use(cors({
  origin: "http://localhost:3000",
  credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client/build')));

// Fungsi helper untuk memformat bytes
const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

// Fungsi untuk mendapatkan informasi sistem dengan cache dan retry
async function getSystemInfo() {
  try {
    // Get OS info first
    const osInfo = await si.osInfo();
    console.log('OS Info:', osInfo); // Debug log

    // Get uptime with better error handling
    let uptime = 0;
    try {
      const timeData = await si.time();
      console.log('Time data:', timeData); // Debug log
      
      if (timeData && typeof timeData.uptime === 'number' && timeData.uptime > 0) {
        uptime = Math.floor(timeData.uptime);
        console.log('Using si.time() uptime:', uptime);
      } else {
        uptime = Math.floor(os.uptime());
        console.log('Using os.uptime():', uptime);
      }
    } catch (error) {
      console.error('Error getting uptime from si.time():', error);
      uptime = Math.floor(os.uptime());
      console.log('Fallback to os.uptime():', uptime);
    }

    // Get other system info
    const [cpu, mem, disk, network] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.networkStats()
    ]);

    // Format disk data
    const formattedDisk = disk.map(partition => ({
      fs: osInfo.platform === 'win32' ? partition.fs.split(':')[0] + ':' : partition.fs,
      size: formatBytes(partition.size),
      used: formatBytes(partition.used),
      available: formatBytes(partition.available),
      usedPercent: Math.min(partition.use || (partition.used / partition.size) * 100, 100).toFixed(1)
    }));

    // Format network data
    const formattedNetwork = network.map(net => ({
      interface: net.iface.replace(/\{.*\}/g, '').trim(),
      rx_sec: (net.rx_sec / 1024).toFixed(2),
      tx_sec: (net.tx_sec / 1024).toFixed(2),
      rx_bytes: formatBytes(net.rx_bytes),
      tx_bytes: formatBytes(net.tx_bytes)
    }));

    const systemInfo = {
      os: {
        platform: osInfo.platform || 'unknown',
        distro: osInfo.distro || 'unknown',
        release: osInfo.release || 'unknown',
        hostname: osInfo.hostname || 'unknown'
      },
      cpu: {
        load: cpu.currentLoad ? cpu.currentLoad.toFixed(1) : '0.0',
        cores: cpu.cpus ? cpu.cpus.length : os.cpus().length
      },
      memory: {
        total: (mem.total / (1024 * 1024 * 1024)).toFixed(2),
        used: (mem.used / (1024 * 1024 * 1024)).toFixed(2),
        free: (mem.free / (1024 * 1024 * 1024)).toFixed(2),
        usedPercent: ((mem.used / mem.total) * 100).toFixed(1)
      },
      disk: formattedDisk,
      network: formattedNetwork,
      uptime: uptime,
      timestamp: new Date().toISOString()
    };

    console.log('Final uptime value:', systemInfo.uptime); // Debug log
    return systemInfo;
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

// Socket.IO connection handler
io.on('connection', async (socket) => {
  console.log('Client terhubung:', socket.id);
  let updateInterval;
  let retryTimeout;
  let lastEmittedData = null;
  
  // Tambahkan koneksi ke map
  ACTIVE_CONNECTIONS.set(socket.id, {
    connected: true,
    lastPing: Date.now(),
    updateInterval: null,
    retryCount: 0,
    connectTime: new Date().toISOString(),
    lastEmittedData: null
  });

  const startUpdateInterval = async () => {
    try {
      const connection = ACTIVE_CONNECTIONS.get(socket.id);
      if (!connection || !connection.connected) return;

      // Bersihkan interval yang ada
      if (connection.updateInterval) {
        clearInterval(connection.updateInterval);
      }

      // Kirim data awal
      const initialData = await getSystemInfo();
      if (socket.connected) {
        lastEmittedData = initialData;
        socket.emit('systemInfo', initialData);
      }

      // Set interval baru dengan pengecekan koneksi
      connection.updateInterval = setInterval(async () => {
        try {
          // Periksa koneksi sebelum mengirim data
          if (!socket.connected) {
            clearInterval(connection.updateInterval);
            return;
          }

          const newData = await getSystemInfo();
          if (!lastEmittedData || hasSignificantChanges(newData, lastEmittedData)) {
            socket.emit('systemInfo', newData);
            lastEmittedData = newData;
          }
          
          connection.retryCount = 0;
        } catch (err) {
          console.error('Error in update interval:', err);
          connection.retryCount++;

          if (connection.retryCount > MAX_RETRIES) {
            clearInterval(connection.updateInterval);
            socket.disconnect(true);
          }
        }
      }, UPDATE_INTERVAL);

      // Update connection info
      connection.updateInterval = updateInterval;
      ACTIVE_CONNECTIONS.set(socket.id, connection);

    } catch (err) {
      console.error('Error starting update interval:', err);
      const connection = ACTIVE_CONNECTIONS.get(socket.id);
      if (connection) {
        connection.retryCount++;
        if (connection.retryCount <= MAX_RETRIES && socket.connected) {
          retryTimeout = setTimeout(() => startUpdateInterval(), SOCKET_RETRY_DELAY);
        } else {
          socket.disconnect(true);
        }
      }
    }
  };

  // Fungsi untuk memeriksa perubahan signifikan
  const hasSignificantChanges = (newData, oldData) => {
    if (!oldData) return true;
    
    // Periksa perubahan CPU
    const cpuDiff = Math.abs(parseFloat(newData.cpu.load) - parseFloat(oldData.cpu.load));
    if (cpuDiff >= 0.1) return true;
    
    // Periksa perubahan Memory
    const memDiff = Math.abs(parseFloat(newData.memory.usedPercent) - parseFloat(oldData.memory.usedPercent));
    if (memDiff >= 1) return true;
    
    // Periksa perubahan Disk
    const diskChanged = newData.disk.some((newDisk, index) => {
      const oldDisk = oldData.disk[index];
      if (!oldDisk) return true;
      return Math.abs(parseFloat(newDisk.usedPercent) - parseFloat(oldDisk.usedPercent)) >= 1;
    });
    if (diskChanged) return true;
    
    return false;
  };

  // Mulai interval update
  await startUpdateInterval();

  // Ping-pong untuk menjaga koneksi
  socket.on('ping', () => {
    const connection = ACTIVE_CONNECTIONS.get(socket.id);
    if (connection && socket.connected) {
      connection.lastPing = Date.now();
      socket.emit('pong');
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`[${socket.id}] Client terputus. Alasan:`, reason);
    
    const connection = ACTIVE_CONNECTIONS.get(socket.id);
    if (connection) {
      if (connection.updateInterval) {
        clearInterval(connection.updateInterval);
      }
      connection.connected = false;
      connection.disconnectReason = reason;
      connection.disconnectTime = new Date().toISOString();
      
      // Hanya coba reconnect untuk alasan tertentu
      if (reason === 'transport error' || reason === 'ping timeout') {
        console.log(`[${socket.id}] Mencoba reconnect dalam ${SOCKET_RETRY_DELAY}ms`);
        setTimeout(() => {
          if (ACTIVE_CONNECTIONS.has(socket.id)) {
            socket.connect();
          }
        }, SOCKET_RETRY_DELAY);
      } else {
        console.log(`[${socket.id}] Menghapus koneksi dari active connections`);
        ACTIVE_CONNECTIONS.delete(socket.id);
      }
    }
    if (retryTimeout) {
      clearTimeout(retryTimeout);
    }
  });
});

// Interval untuk membersihkan koneksi yang tidak aktif
setInterval(() => {
  const now = Date.now();
  for (const [socketId, connection] of ACTIVE_CONNECTIONS.entries()) {
    if (!connection.connected || (now - connection.lastPing > 60000)) {
      ACTIVE_CONNECTIONS.delete(socketId);
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