import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ThemeProvider } from 'next-themes';
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

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './components/ui/card';
import { Progress } from './components/ui/progress';

const SOCKET_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:5000'
  : `${window.location.protocol}//${window.location.hostname}:5000`;
let socket;

// Constants
const HISTORY_LENGTH = 30;
const CHART_UPDATE_INTERVAL = 3000;
const RECONNECT_INTERVAL = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;
const PING_INTERVAL = 10000;
const CONNECTION_TIMEOUT = 30000;

// Debounced update function
const debouncedUpdate = debounce((callback) => {
  callback();
}, 300);

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

  // Format time function
  const formatTime = useCallback((date) => {
    if (!date) return '';
    try {
      return new Date(date).toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
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

    // Update network history jika ada data network
    if (data.network && data.network.length > 0) {
      const networkData = data.network[0];
      setNetworkHistory(prev => ({
        download: updateHistory(prev.download, parseFloat(networkData.rx_sec), timestamp),
        upload: updateHistory(prev.upload, parseFloat(networkData.tx_sec), timestamp)
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
        
        socket = io(SOCKET_URL, {
          ...socketOptions,
          query: { t: Date.now() }
        });

        socket.connect();

        socket.io.on("error", (error) => {
          console.error('Transport error:', error);
          setError(`Error koneksi: ${error.message}`);
          setSocketStatus('error');
          
          if (!isManuallyDisconnected && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            const delay = Math.min(1000 * (reconnectAttempts + 1), 5000);
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(connectSocket, delay);
          }
        });

        socket.on('connect_error', (error) => {
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

        socket.on('connect', () => {
          console.log('Socket terhubung');
          setIsConnected(true);
          setSocketStatus('connected');
          setError(null);
          setReconnectAttempts(0);

          // Set up ping interval
          if (pingInterval) clearInterval(pingInterval);
          pingInterval = setInterval(() => {
            if (socket?.connected) {
              socket.emit('ping');
            }
          }, PING_INTERVAL);
        });

        socket.on('disconnect', (reason) => {
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

        socket.on('pong', () => {
          setError(null);
        });

        socket.on('systemInfo', (data) => {
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

  // Loading state
  if (!isConnected || !systemInfo) {
    return (
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
    );
  }

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <div className="min-h-screen bg-background">
        <div className="container mx-auto p-4">
          {/* Header */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 space-y-4 md:space-y-0">
            <div>
              <h1 className="text-3xl font-bold">Dashboard Monitoring Server</h1>
              <div className="flex flex-col md:flex-row items-start md:items-center space-y-2 md:space-y-0 md:space-x-4 mt-2">
                <div className="flex items-center space-x-2">
                  <ServerIcon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {systemInfo?.os?.hostname || 'Loading...'}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  <InfoIcon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    {systemInfo?.os ? `${systemInfo.os.distro || ''} ${systemInfo.os.release || ''}` : 'Loading...'}
                  </span>
                </div>
                {lastUpdate && (
                  <span className="text-xs text-muted-foreground">
                    Pembaruan terakhir: {formatTime(lastUpdate)}
                  </span>
                )}
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* CPU Card */}
            <Card>
              <CardHeader className="p-4">
                <CardTitle className="flex items-center space-x-2 text-lg">
                  <CpuIcon className="h-4 w-4" />
                  <span>CPU Usage</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xl font-semibold">{systemInfo.cpu.load}%</span>
                      <span className="text-xs text-muted-foreground">
                        {systemInfo.cpu.cores} Cores
                      </span>
                    </div>
                    <Progress value={parseFloat(systemInfo.cpu.load)} className="h-2" />
                  </div>
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

            {/* Memory Card */}
            <Card>
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

            {/* Network Cards dengan Grafik */}
            {systemInfo?.network?.map((net, index) => (
              <Card key={index} className="col-span-2">
                <CardHeader className="p-4">
                  <CardTitle className="flex items-center space-x-2 text-lg">
                    <NetworkIcon className="h-4 w-4" />
                    <span>Network ({net.interface})</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="grid grid-cols-2 gap-4">
                    {/* Download Graph */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xl font-semibold text-emerald-500">{net.rx_sec} KB/s</span>
                        <span className="text-xs text-muted-foreground">Download</span>
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
                            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}KB/s`} width={50}/>
                            <RechartsTooltip
                              content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                  return (
                                    <div className="rounded-lg border bg-card px-3 py-2 shadow-md">
                                      <p className="text-xs font-medium text-muted-foreground">{label}</p>
                                      <p className="text-sm font-semibold text-emerald-500">
                                        {payload[0].value.toFixed(2)} KB/s
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
                    </div>

                    {/* Upload Graph */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xl font-semibold text-sky-500">{net.tx_sec} KB/s</span>
                        <span className="text-xs text-muted-foreground">Upload</span>
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
                            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}KB/s`} width={50}/>
                            <RechartsTooltip
                              content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                  return (
                                    <div className="rounded-lg border bg-card px-3 py-2 shadow-md">
                                      <p className="text-xs font-medium text-muted-foreground">{label}</p>
                                      <p className="text-sm font-semibold text-sky-500">
                                        {payload[0].value.toFixed(2)} KB/s
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
                    </div>

                    <div>
                      <p className="text-xs text-muted-foreground">Total Download</p>
                      <p className="text-sm font-medium">{net.rx_bytes}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total Upload</p>
                      <p className="text-sm font-medium">{net.tx_bytes}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Disk Cards */}
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
      </div>
      <Toaster />
    </ThemeProvider>
  );
}

export default App; 