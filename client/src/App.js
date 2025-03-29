import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ThemeProvider, useTheme } from 'next-themes';
import { Toaster } from 'sonner';
import io from 'socket.io-client';
import { debounce } from 'lodash';
import {
  XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, Area, AreaChart,
  PieChart, Pie, Cell, CartesianGrid
} from 'recharts';
import {
  MonitorIcon, ServerIcon, CpuIcon, 
  HardDriveIcon, NetworkIcon, SunIcon, 
  MoonIcon, TimerIcon, InfoIcon, MemoryStickIcon
} from 'lucide-react';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './components/ui/card';
import { Progress } from './components/ui/progress';

const SOCKET_URL = window.location.protocol === 'https:' 
  ? `https://${window.location.hostname}`
  : `http://${window.location.hostname}:5000`;

// Constants
const HISTORY_LENGTH = 5; // Tampilkan hanya 5 detik terakhir untuk data network
const CHART_UPDATE_INTERVAL = 3000;
const RECONNECT_INTERVAL = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;
const PING_INTERVAL = 10000;
const CONNECTION_TIMEOUT = 30000;

// Debounced update function
const debouncedUpdate = debounce((callback) => {
  callback();
}, 300);

// Format bytes function
const formatBytes = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Format uptime function
const formatUptime = (seconds) => {
  if (typeof seconds !== 'number' || isNaN(seconds) || seconds < 0) {
    return 'Calculating...';
  }
  
  const days = Math.floor(seconds / (3600 * 24));
  const hours = Math.floor((seconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  let result = [];
  if (days > 0) result.push(`${days} hari`);
  if (hours > 0) result.push(`${hours} jam`);
  if (minutes > 0 || (days === 0 && hours === 0)) result.push(`${minutes} menit`);
  
  return result.length > 0 ? result.join(' ') : '1 menit';
};

// Tambahkan fungsi formatNetworkSpeed di bagian atas file, setelah import
const formatNetworkSpeed = (bitsPerSec) => {
  if (bitsPerSec === 0) return '0 bps';
  const k = 1000;
  const sizes = ['bps', 'Kbps', 'Mbps', 'Gbps'];
  const i = Math.floor(Math.log(bitsPerSec) / Math.log(k));
  return parseFloat((bitsPerSec / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[Math.min(i, sizes.length - 1)];
};

// Socket connection configuration
const socketOptions = {
  transports: ['websocket', 'polling'],
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 30000,
  path: '/socket.io/',
  autoConnect: false,
  withCredentials: true,
  forceNew: true,
  query: { t: Date.now() }
};

// Pindahkan ThemeSwitcher ke luar fungsi App
const ThemeSwitcher = () => {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="w-9 h-9 rounded-full transition-colors"
      aria-label="Toggle theme"
    >
      {theme === 'dark' ? (
        <SunIcon className="h-4 w-4 transition-transform duration-200" />
      ) : (
        <MoonIcon className="h-4 w-4 transition-transform duration-200" />
      )}
    </Button>
  );
};

function App() {
  const [systemInfo, setSystemInfo] = useState(null);
  const [cpuHistory, setCpuHistory] = useState(Array(60).fill({ time: '', value: 0 }));
  const [memoryHistory, setMemoryHistory] = useState(Array(60).fill({ time: '', value: 0 }));
  const [networkHistory, setNetworkHistory] = useState({
    download: Array(60).fill({ time: '', value: 0 }),
    upload: Array(60).fill({ time: '', value: 0 })
  });
  const [error, setError] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [socketStatus, setSocketStatus] = useState('disconnected');
  const [mounted, setMounted] = useState(false);
  const [socket, setSocket] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const { theme, setTheme } = useTheme();

  // Fungsi untuk memuat data historis
  const loadHistoricalData = useCallback(async () => {
    try {
      const response = await fetch(`${SOCKET_URL}/api/history`);
      const data = await response.json();
      
      if (data.history) {
        setCpuHistory(data.history.cpu);
        setMemoryHistory(data.history.memory);
        setNetworkHistory({
          download: data.history.network.download,
          upload: data.history.network.upload
        });
      }

      if (data.lastStats) {
        setSystemInfo(data.lastStats);
        setLastUpdate(data.lastStats.timestamp);
      }
    } catch (err) {
      console.error('Error loading historical data:', err);
      setError('Gagal memuat data historis');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Effect untuk memuat data historis saat komponen dimount
  useEffect(() => {
    loadHistoricalData();
  }, [loadHistoricalData]);

  // Format time function
  const formatTime = useCallback((date) => {
    if (!date) return '';
    try {
      return new Date(date).toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).replace(/\./g, ':');
    } catch (error) {
      console.error('Error formatting time:', error);
      return '';
    }
  }, []);

  // Update history function
  const updateHistory = useCallback((currentHistory, newValue, timestamp) => {
    if (!Array.isArray(currentHistory)) {
      return Array(HISTORY_LENGTH).fill({ time: '', value: 0 });
    }
    
    // Hapus data yang lebih tua dari 1 jam
    const oneHourAgo = Date.now() - 3600000;
    const filteredHistory = currentHistory.filter(item => 
      item.timestamp && new Date(item.timestamp).getTime() > oneHourAgo
    );
    
    return [...filteredHistory, { 
      time: timestamp,
      value: typeof newValue === 'number' ? newValue : 0,
      timestamp: Date.now()
    }].slice(-HISTORY_LENGTH);
  }, []);

  // System data update function
  const updateSystemData = useCallback((data) => {
    if (!data) return;

    setSystemInfo(data);
    
    const timestamp = formatTime(data.timestamp);
    const cpuValue = parseFloat(data.cpu.load) || 0;
    const memoryValue = parseFloat(data.memory.usedPercent) || 0;

    // Update network history dengan nilai raw
    if (data.network && data.network.length > 0) {
      const networkData = data.network[0];
      setNetworkHistory(prev => ({
        download: updateHistory(prev.download, networkData.rx_speed_raw * 8, timestamp), // Konversi ke bits
        upload: updateHistory(prev.upload, networkData.tx_speed_raw * 8, timestamp) // Konversi ke bits
      }));
    }

    setLastUpdate(data.timestamp);
    setError(null);

    setCpuHistory(prev => updateHistory(prev, cpuValue, timestamp));
    setMemoryHistory(prev => updateHistory(prev, memoryValue, timestamp));
  }, [formatTime, updateHistory]);

  // Check for significant changes
  const hasSignificantChanges = useCallback((newData, oldData) => {
    if (!oldData) return true;
    
    const cpuDiff = Math.abs(parseFloat(newData.cpu.load) - parseFloat(oldData.cpu.load));
    if (cpuDiff >= 0.1) return true;
    
    const memDiff = Math.abs(parseFloat(newData.memory.usedPercent) - parseFloat(oldData.memory.usedPercent));
    if (memDiff >= 1) return true;
    
    const diskChanged = newData.disk.some((newDisk, index) => {
      const oldDisk = oldData.disk[index];
      if (!oldDisk) return true;
      return Math.abs(parseFloat(newDisk.usedPercent) - parseFloat(oldDisk.usedPercent)) >= 1;
    });
    if (diskChanged) return true;
    
    return false;
  }, []);

  // Socket connection effect
  useEffect(() => {
    let reconnectTimer;
    let pingInterval;
    let isManuallyDisconnected = false;

    const connectSocket = () => {
      try {
        if (socket?.connected) {
          socket.disconnect();
        }

        setSocketStatus('connecting');
        console.log('Mencoba koneksi ke:', SOCKET_URL);
        
        const newSocket = io(SOCKET_URL, {
          ...socketOptions,
          query: { t: Date.now() }
        });

        setSocket(newSocket);
        newSocket.connect();

        newSocket.io.on("error", (error) => {
          console.error('Transport error:', error);
          setError(`Error koneksi: ${error.message}`);
          setSocketStatus('error');
          
          if (!isManuallyDisconnected && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            const delay = Math.min(1000 * (reconnectAttempts + 1), 5000);
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(connectSocket, delay);
          }
        });

        newSocket.on('connect_error', (error) => {
          console.error('Connection error:', error);
          setError(`Error koneksi: ${error.message}`);
          setSocketStatus('error');

          if (!isManuallyDisconnected && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            setReconnectAttempts(prev => prev + 1);
            const delay = Math.min(1000 * (reconnectAttempts + 1), 5000);
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(connectSocket, delay);
          }
        });

        newSocket.on('connect', () => {
          console.log('Socket terhubung');
          setIsConnected(true);
          setSocketStatus('connected');
          setError(null);
          setReconnectAttempts(0);

          // Set up ping interval
          if (pingInterval) clearInterval(pingInterval);
          pingInterval = setInterval(() => {
            if (newSocket?.connected) {
              newSocket.emit('ping');
            }
          }, PING_INTERVAL);
        });

        newSocket.on('disconnect', (reason) => {
          console.log('Socket terputus:', reason);
          setIsConnected(false);
          setSocketStatus('disconnected');
          
          if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
          }

          if (!isManuallyDisconnected && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            setReconnectAttempts(prev => prev + 1);
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(connectSocket, RECONNECT_INTERVAL);
          }
        });

        newSocket.on('pong', () => {
          setError(null);
        });

        newSocket.on('systemInfo', (data) => {
          if (!data) return;
          try {
            updateSystemData(data);
          } catch (err) {
            console.error('Error updating system data:', err);
          }
        });
      } catch (err) {
        console.error('Error in connectSocket:', err);
        setError(`Error koneksi: ${err.message}`);
        setSocketStatus('error');
      }
    };

    connectSocket();

    return () => {
      isManuallyDisconnected = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingInterval) clearInterval(pingInterval);
      if (socket) {
        socket.removeAllListeners();
        socket.disconnect();
      }
    };
  }, []);

  // Tambahkan useEffect untuk mengatasi hydration
  useEffect(() => {
    setMounted(true);
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <div className="min-h-screen bg-background">
          <div className="container mx-auto px-4 py-8">
            <div className="flex flex-col items-center justify-center space-y-4">
              <MonitorIcon className="h-12 w-12 text-primary animate-pulse" />
              <h1 className="text-2xl font-bold text-center">
                Memuat Data Historis
              </h1>
              <p className="text-muted-foreground text-center">
                Mohon tunggu sebentar...
              </p>
              <Progress value={100} className="w-full max-w-md animate-pulse" />
            </div>
          </div>
        </div>
      </ThemeProvider>
    );
  }

  if (!isConnected || !systemInfo) {
    return (
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <div className="min-h-screen bg-background">
          <div className="container mx-auto px-4 py-8">
            <div className="flex flex-col items-center justify-center space-y-4">
              <MonitorIcon className="h-12 w-12 text-primary animate-pulse" />
              <h1 className="text-2xl font-bold text-center">
                {socketStatus === 'connecting' ? 'Menghubungkan ke Server' : 
                 socketStatus === 'disconnected' ? 'Terputus dari Server' :
                 'Memuat Informasi Sistem'}
              </h1>
              <p className="text-muted-foreground text-center">
                {socketStatus === 'connecting' ? 'Mohon tunggu sebentar...' :
                 socketStatus === 'disconnected' ? 'Mencoba menghubungkan kembali...' :
                 'Sedang mengambil data sistem...'}
              </p>
              <Progress value={reconnectAttempts / MAX_RECONNECT_ATTEMPTS * 100} className="w-full max-w-md" />
              {error && (
                <div className="bg-destructive/10 text-destructive p-4 rounded-lg max-w-md w-full">
                  <p className="text-sm">{error}</p>
                  {reconnectAttempts > 0 && (
                    <p className="text-xs mt-2">
                      Percobaan koneksi: {reconnectAttempts}/{MAX_RECONNECT_ATTEMPTS}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <div className="min-h-screen bg-background transition-colors duration-300 flex flex-col">
        <div className="container mx-auto p-4 flex-grow">
          {/* Header dengan Theme Switcher yang Ditingkatkan */}
          <div className="bg-card rounded-lg shadow-lg p-6 mb-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center space-y-4 md:space-y-0">
              <div className="w-full">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    <MonitorIcon className="h-8 w-8 text-primary animate-pulse" />
                    <div>
                      <h1 className="text-3xl font-bold bg-gradient-to-r from-primary via-blue-500 to-purple-500 bg-clip-text text-transparent">
                        Server Monitoring
                      </h1>
                      <p className="text-sm text-muted-foreground mt-1">
                        Real-time System Metrics
                      </p>
                    </div>
                  </div>
                  <ThemeSwitcher />
                </div>
                <div className="flex flex-col md:flex-row items-start md:items-center space-y-2 md:space-y-0 md:space-x-6 mt-2 border-t pt-4 border-border/50">
                  <div className="flex items-center space-x-2">
                    <ServerIcon className="h-4 w-4 text-primary" />
                    <span className="text-sm">
                      {systemInfo?.os?.hostname || 'Loading...'}
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <InfoIcon className="h-4 w-4 text-primary" />
                    <span className="text-sm">
                      {systemInfo?.os ? `${systemInfo.os.distro || ''} ${systemInfo.os.release || ''}` : 'Loading...'}
                    </span>
                  </div>
                  {lastUpdate && (
                    <div className="flex items-center space-x-2">
                      <TimerIcon className="h-4 w-4 text-primary" />
                      <span className="text-sm">
                        Update: {formatTime(lastUpdate)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* System Stats Card */}
          <Card className="mb-6">
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4">
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <TimerIcon className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-medium">Uptime Server</h3>
                </div>
                <p className="text-xl font-semibold">{formatUptime(systemInfo?.os?.uptime || 0)}</p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <CpuIcon className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-medium">Informasi CPU</h3>
                </div>
                <div className="flex space-x-4">
                  <p className="text-xl font-semibold">Core: {systemInfo?.cpu?.cores || 0}</p>
                  <p className="text-xl font-semibold">Load: {systemInfo?.cpu?.load || 0}%</p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <InfoIcon className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-medium">Informasi Sistem</h3>
                </div>
                <div className="space-y-1">
                  <p className="text-sm">{systemInfo?.os?.distro || 'Loading...'}</p>
                  <p className="text-sm">{systemInfo?.os?.platform === 'win32' ? 'Windows' : systemInfo?.os?.platform || 'Loading...'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Main Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* CPU Card - Full Width */}
            <Card className="lg:col-span-2">
              <CardHeader className="p-4">
                <CardTitle className="flex items-center space-x-2 text-lg">
                  <CpuIcon className="h-4 w-4" />
                  <span>CPU Usage</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="space-y-6">
                  {/* Overall CPU Usage */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xl font-semibold">{systemInfo.cpu.load}%</span>
                      <span className="text-xs text-muted-foreground">
                        {systemInfo.cpu.cores} Cores
                      </span>
                    </div>
                    <Progress value={parseFloat(systemInfo.cpu.load)} className="h-2" />
                  </div>

                  {/* CPU Cores Grid */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {systemInfo.cpu.perCore?.map((core, index) => (
                      <div key={index} className="space-y-2 bg-card/50 p-3 rounded-lg">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Core {core.core}</span>
                          <span className="text-sm font-semibold">{core.load}%</span>
                        </div>
                        <Progress value={parseFloat(core.load)} className="h-1.5" />
                      </div>
                    ))}
                  </div>

                  {/* CPU History Graph */}
                  <div className="h-[180px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={cpuHistory.filter(item => item.time !== '')}>
                        <defs>
                          <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.1}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid 
                          strokeDasharray="3 3" 
                          vertical={false}
                          stroke="hsl(var(--muted))"
                        />
                        <XAxis 
                          dataKey="time" 
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={10}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          domain={[0, 100]}
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={10}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(value) => `${value}%`}
                          width={35}
                        />
                        <RechartsTooltip
                          content={({ active, payload, label }) => {
                            if (active && payload && payload.length) {
                              return (
                                <div className="rounded-lg border bg-card px-3 py-2 shadow-md">
                                  <p className="text-xs font-medium text-muted-foreground">{label}</p>
                                  <p className="text-sm font-semibold text-primary">
                                    {payload[0].value.toFixed(1)}%
                                  </p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="value"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#colorCpu)"
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Memory Card - Full Width */}
            <Card className="lg:col-span-2">
              <CardHeader className="p-4">
                <CardTitle className="flex items-center space-x-2 text-lg">
                  <MemoryStickIcon className="h-4 w-4" />
                  <span>Memory Usage</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xl font-semibold">{systemInfo.memory.usedPercent}%</span>
                      <span className="text-xs text-muted-foreground">
                        {systemInfo.memory.used}GB / {systemInfo.memory.total}GB
                      </span>
                    </div>
                    <Progress value={parseFloat(systemInfo.memory.usedPercent)} className="h-2" />
                  </div>
                  <div className="h-[180px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={memoryHistory.filter(item => item.time !== '')}>
                        <defs>
                          <linearGradient id="colorMemory" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.1}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid 
                          strokeDasharray="3 3" 
                          vertical={false}
                          stroke="hsl(var(--muted))"
                        />
                        <XAxis 
                          dataKey="time" 
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={10}
                          tickLine={false}
                          axisLine={false}
                        />
                        <YAxis
                          domain={[0, 100]}
                          stroke="hsl(var(--muted-foreground))"
                          fontSize={10}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(value) => `${value}%`}
                          width={35}
                        />
                        <RechartsTooltip
                          content={({ active, payload, label }) => {
                            if (active && payload && payload.length) {
                              return (
                                <div className="rounded-lg border bg-card px-3 py-2 shadow-md">
                                  <p className="text-xs font-medium text-muted-foreground">{label}</p>
                                  <p className="text-sm font-semibold text-primary">
                                    {payload[0].value.toFixed(1)}%
                                  </p>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="value"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                          fillOpacity={1}
                          fill="url(#colorMemory)"
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Network Cards - Full Width */}
            {systemInfo?.network?.filter(net => net.operstate === 'up').map((net, index) => (
              <Card key={index} className="lg:col-span-2">
                <CardHeader className="p-4">
                  <CardTitle className="flex items-center space-x-2 text-lg">
                    <NetworkIcon className="h-4 w-4" />
                    <span>Network ({net.iface})</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      Status: {net.operstate}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="flex flex-col gap-4">
                    {/* Upload Graph */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xl font-semibold text-sky-500">
                          {formatNetworkSpeed(net.tx_sec * 8)} {/* Convert to bits */}
                        </span>
                        <div className="flex items-center space-x-2">
                          <span className="text-xs text-muted-foreground">Upload</span>
                          <span className="text-xs text-muted-foreground">
                            Last {HISTORY_LENGTH} seconds
                          </span>
                        </div>
                      </div>
                      <div className="h-[120px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={networkHistory.upload.filter(item => item.time !== '')}>
                            <defs>
                              <linearGradient id="colorUpload" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.8}/>
                                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.1}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted))"/>
                            <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false}/>
                            <YAxis 
                              stroke="hsl(var(--muted-foreground))" 
                              fontSize={10} 
                              tickLine={false} 
                              axisLine={false} 
                              tickFormatter={(value) => formatNetworkSpeed(value)}
                              width={80}
                            />
                            <RechartsTooltip
                              content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                  return (
                                    <div className="rounded-lg border bg-card px-3 py-2 shadow-md">
                                      <p className="text-xs font-medium text-muted-foreground">{label}</p>
                                      <p className="text-sm font-semibold text-sky-500">
                                        {formatNetworkSpeed(payload[0].value)}
                                      </p>
                                    </div>
                                  );
                                }
                                return null;
                              }}
                            />
                            <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} fillOpacity={1} fill="url(#colorUpload)" isAnimationActive={false}/>
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <div>
                          <p>Total Upload</p>
                          <p className="text-sm font-medium">{formatBytes(net.tx_bytes)}</p>
                        </div>
                      </div>
                    </div>

                    {/* Download Graph */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xl font-semibold text-emerald-500">
                          {formatNetworkSpeed(net.rx_sec * 8)} {/* Convert to bits */}
                        </span>
                        <div className="flex items-center space-x-2">
                          <span className="text-xs text-muted-foreground">Download</span>
                          <span className="text-xs text-muted-foreground">
                            Last {HISTORY_LENGTH} seconds
                          </span>
                        </div>
                      </div>
                      <div className="h-[120px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={networkHistory.download.filter(item => item.time !== '')}>
                            <defs>
                              <linearGradient id="colorDownload" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.8}/>
                                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.1}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted))"/>
                            <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false}/>
                            <YAxis 
                              stroke="hsl(var(--muted-foreground))" 
                              fontSize={10} 
                              tickLine={false} 
                              axisLine={false} 
                              tickFormatter={(value) => formatNetworkSpeed(value)}
                              width={80}
                            />
                            <RechartsTooltip
                              content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                  return (
                                    <div className="rounded-lg border bg-card px-3 py-2 shadow-md">
                                      <p className="text-xs font-medium text-muted-foreground">{label}</p>
                                      <p className="text-sm font-semibold text-emerald-500">
                                        {formatNetworkSpeed(payload[0].value)}
                                      </p>
                                    </div>
                                  );
                                }
                                return null;
                              }}
                            />
                            <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} fillOpacity={1} fill="url(#colorDownload)" isAnimationActive={false}/>
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <div>
                          <p>Total Download</p>
                          <p className="text-sm font-medium">{formatBytes(net.rx_bytes)}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Disk Cards - Half Width on Large Screens */}
            {systemInfo?.disk?.map((partition, index) => (
              <Card key={index}>
                <CardHeader className="p-4">
                  <CardTitle className="flex items-center space-x-2 text-lg">
                    <HardDriveIcon className="h-4 w-4" />
                    <span>Disk ({partition.fs})</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xl font-semibold">{partition.usedPercent}%</span>
                        <span className="text-xs text-muted-foreground">
                          {partition.used} / {partition.size}
                        </span>
                      </div>
                      <Progress value={parseFloat(partition.usedPercent)} className="h-2" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Used Space</p>
                        <p className="text-sm font-medium">{partition.used}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Free Space</p>
                        <p className="text-sm font-medium">{partition.available}</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Footer Baru */}
        <footer className="w-full bg-card shadow-lg mt-8">
          <div className="container mx-auto px-4 py-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold flex items-center space-x-2">
                  <MonitorIcon className="h-5 w-5 text-primary" />
                  <span>System Monitor</span>
                </h3>
                <p className="text-sm text-muted-foreground">
                  Monitoring server performance and system resources in real-time
                </p>
              </div>
              
              <div className="space-y-2">
                <h3 className="text-lg font-semibold flex items-center space-x-2">
                  <InfoIcon className="h-5 w-5 text-primary" />
                  <span>System Info</span>
                </h3>
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>Update Interval: {CHART_UPDATE_INTERVAL/1000}s</p>
                  <p>History Length: {HISTORY_LENGTH} points</p>
                  <p>Status: {socketStatus === 'connected' ? 'System Active' : 'System Inactive'}</p>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-lg font-semibold flex items-center space-x-2">
                  <ServerIcon className="h-5 w-5 text-primary" />
                  <span>Server Info</span>
                </h3>
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>Uptime: {formatUptime(systemInfo?.os?.uptime || 0)}</p>
                  <p>CPU: {systemInfo?.cpu?.cores || 0} Cores</p>
                  <p>RAM: {systemInfo?.memory?.total || 0}GB Total</p>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-4 border-t border-border/50 flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
              <p className="text-sm text-muted-foreground">
                © {new Date().getFullYear()} Server Monitoring Dashboard. All rights reserved.
              </p>
              <div className="flex items-center space-x-4">
                <span className="text-sm text-muted-foreground flex items-center space-x-1">
                  <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                  <span>{isConnected ? 'System Online' : 'System Offline'}</span>
                </span>
              </div>
            </div>
          </div>
        </footer>
      </div>
      <Toaster />
    </ThemeProvider>
  );
}

export default App; 