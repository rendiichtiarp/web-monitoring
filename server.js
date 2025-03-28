const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const si = require('systeminformation');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Fungsi untuk mendapatkan informasi sistem
async function getSystemInfo() {
  try {
    const cpu = await si.currentLoad();
    const mem = await si.mem();
    const disk = await si.fsSize();
    const network = await si.networkStats();
    const temp = await si.cpuTemperature();
    const processes = await si.processes();

    return {
      cpu: {
        load: cpu.currentLoad.toFixed(2),
        cores: cpu.cpus.map(core => ({
          load: core.load.toFixed(2)
        }))
      },
      memory: {
        total: (mem.total / (1024 * 1024 * 1024)).toFixed(2),
        used: (mem.used / (1024 * 1024 * 1024)).toFixed(2),
        free: (mem.free / (1024 * 1024 * 1024)).toFixed(2),
        usedPercent: ((mem.used / mem.total) * 100).toFixed(2)
      },
      disk: disk.map(partition => ({
        fs: partition.fs,
        size: (partition.size / (1024 * 1024 * 1024)).toFixed(2),
        used: (partition.used / (1024 * 1024 * 1024)).toFixed(2),
        available: (partition.available / (1024 * 1024 * 1024)).toFixed(2),
        usedPercent: partition.use.toFixed(2)
      })),
      network: network.map(net => ({
        interface: net.iface,
        rx_sec: (net.rx_sec / 1024).toFixed(2),
        tx_sec: (net.tx_sec / 1024).toFixed(2)
      })),
      temperature: {
        main: temp.main,
        cores: temp.cores
      },
      processes: {
        total: processes.all,
        running: processes.running,
        blocked: processes.blocked
      }
    };
  } catch (error) {
    console.error('Error getting system information:', error);
    return null;
  }
}

// Route untuk mendapatkan informasi sistem
app.get('/api/system-info', async (req, res) => {
  const systemInfo = await getSystemInfo();
  res.json(systemInfo);
});

// Socket.IO untuk real-time updates
io.on('connection', (socket) => {
  console.log('Client connected');

  // Kirim update sistem setiap 2 detik
  const interval = setInterval(async () => {
    const systemInfo = await getSystemInfo();
    socket.emit('systemInfo', systemInfo);
  }, 2000);

  socket.on('disconnect', () => {
    console.log('Client disconnected');
    clearInterval(interval);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server berjalan pada port ${PORT}`);
}); 