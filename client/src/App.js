import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Container, 
  Grid, 
  Typography, 
  Box,
  ThemeProvider,
  createTheme,
  CssBaseline,
  IconButton,
  Tooltip,
  Card,
  CardContent,
  LinearProgress,
  Chip,
  Alert,
  Divider
} from '@mui/material';
import { 
  XAxis, 
  YAxis,
  Tooltip as RechartsTooltip, 
  ResponsiveContainer,
  Area,
  AreaChart,
  PieChart,
  Pie,
  Cell,
  CartesianGrid
} from 'recharts';
import {
  Brightness4,
  Brightness7,
  Memory,
  Storage,
  Speed,
  NetworkCheck,
  Computer,
  Timer,
  Info,
  Memory as MemoryIcon
} from '@mui/icons-material';
import io from 'socket.io-client';
import { debounce } from '@mui/material/utils';

const SOCKET_URL = 'http://localhost:5000';
let socket;

// Konstanta
const HISTORY_LENGTH = 20;
const CHART_UPDATE_INTERVAL = 3000;
const RECONNECT_INTERVAL = 5000;
const MAX_RECONNECT_ATTEMPTS = 3;
const PING_INTERVAL = 25000;
const CONNECTION_TIMEOUT = 45000;

// Fungsi debounce untuk update data
const debouncedUpdate = debounce((callback) => {
  callback();
}, 300);

// Fungsi untuk memformat uptime
const formatUptime = (seconds) => {
  if (!seconds || isNaN(seconds)) return 'Calculating...';
  
  const days = Math.floor(seconds / (3600 * 24));
  const hours = Math.floor((seconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  let result = [];
  if (days > 0) result.push(`${days} hari`);
  if (hours > 0) result.push(`${hours} jam`);
  if (minutes > 0 || (days === 0 && hours === 0)) result.push(`${minutes} menit`);
  
  return result.join(' ');
};

function App() {
  const [systemInfo, setSystemInfo] = useState(null);
  const [cpuHistory, setCpuHistory] = useState(Array(20).fill({ time: '', value: 0 }));
  const [memoryHistory, setMemoryHistory] = useState(Array(20).fill({ time: '', value: 0 }));
  const [darkMode, setDarkMode] = useState(true);
  const [error, setError] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [socketStatus, setSocketStatus] = useState('disconnected');
  const [chartUpdateTimer, setChartUpdateTimer] = useState(null);

  const theme = useMemo(() => createTheme({
    palette: {
      mode: darkMode ? 'dark' : 'light',
      primary: {
        main: '#2196f3',
      },
      secondary: {
        main: '#f50057',
      },
      background: {
        default: darkMode ? '#0a1929' : '#f5f5f5',
        paper: darkMode ? '#1a2027' : '#ffffff',
      },
    },
    typography: {
      fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
      h4: {
        fontWeight: 600,
        fontSize: {
          xs: '1.25rem',
          sm: '1.5rem',
        },
      },
      h6: {
        fontWeight: 500,
        fontSize: '1rem',
      },
      subtitle1: {
        fontSize: '0.875rem',
      },
      body1: {
        fontSize: '0.875rem',
      },
      body2: {
        fontSize: '0.75rem',
      },
    },
    components: {
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            transition: 'all 0.2s ease-in-out',
            '&:hover': {
              transform: 'translateY(-2px)',
              boxShadow: darkMode 
                ? '0 4px 12px rgba(0, 0, 0, 0.4)'
                : '0 4px 12px rgba(0, 0, 0, 0.1)',
            },
          },
        },
      },
      MuiCardContent: {
        styleOverrides: {
          root: {
            padding: '16px',
            '&:last-child': {
              paddingBottom: '16px',
            },
          },
        },
      },
      MuiContainer: {
        styleOverrides: {
          root: {
            paddingBottom: '1rem',
          },
        },
      },
      MuiGrid: {
        styleOverrides: {
          root: {
            '& > .MuiGrid-item': {
              paddingTop: '12px',
              paddingBottom: '12px',
            },
          },
        },
      },
    },
  }), [darkMode]);

  // Optimized formatTime function
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

  // Optimized history update function
  const updateHistory = useCallback((currentHistory, newValue, timestamp) => {
    if (!Array.isArray(currentHistory) || currentHistory.length !== HISTORY_LENGTH) {
      return Array(HISTORY_LENGTH).fill({ time: '', value: 0 });
    }
    return [...currentHistory.slice(1), { 
      time: timestamp,
      value: typeof newValue === 'number' ? Math.min(Math.max(newValue, 0), 100) : 0
    }];
  }, []);

  // Optimasi update data sistem
  const updateSystemData = useCallback((data) => {
    if (!data) return;

    debouncedUpdate(() => {
      setSystemInfo(prev => {
        // Jika tidak ada perubahan signifikan, gunakan data sebelumnya
        if (prev && !hasSignificantChanges(data, prev)) {
          return prev;
        }
        return data;
      });
      
      const timestamp = formatTime(data.timestamp);
      const cpuValue = parseFloat(data.cpu.load) || 0;
      const memoryValue = parseFloat(data.memory.usedPercent) || 0;

      setLastUpdate(data.timestamp);
      setError(null);

      // Update histories dengan debounce
      if (!chartUpdateTimer) {
        const timer = setTimeout(() => {
          setCpuHistory(prev => updateHistory(prev, cpuValue, timestamp));
          setMemoryHistory(prev => updateHistory(prev, memoryValue, timestamp));
          setChartUpdateTimer(null);
        }, CHART_UPDATE_INTERVAL);
        setChartUpdateTimer(timer);
      }
    });
  }, [formatTime, updateHistory, chartUpdateTimer]);

  // Fungsi untuk memeriksa perubahan signifikan
  const hasSignificantChanges = useCallback((newData, oldData) => {
    if (!oldData) return true;
    
    // Periksa perubahan CPU
    const cpuDiff = Math.abs(parseFloat(newData.cpu.load) - parseFloat(oldData.cpu.load));
    if (cpuDiff >= 1) return true;
    
    // Periksa perubahan Memory
    const memDiff = Math.abs(parseFloat(newData.memory.usedPercent) - parseFloat(oldData.memory.usedPercent));
    if (memDiff >= 1) return true;
    
    return false;
  }, []);

  // Socket connection management
  useEffect(() => {
    let reconnectTimer;
    let pingInterval;
    let connectionTimeout;
    let isManuallyDisconnected = false;

    const resetConnectionTimeout = () => {
      if (connectionTimeout) {
        clearTimeout(connectionTimeout);
      }
      connectionTimeout = setTimeout(() => {
        console.log('Connection timeout, attempting to reconnect...');
        if (socket && !isManuallyDisconnected) {
          socket.disconnect();
          connectSocket();
        }
      }, CONNECTION_TIMEOUT);
    };

    const setupPingInterval = () => {
      if (pingInterval) {
        clearInterval(pingInterval);
      }
      pingInterval = setInterval(() => {
        if (socket && socket.connected) {
          socket.emit('ping');
          resetConnectionTimeout();
        }
      }, PING_INTERVAL);
    };

    const connectSocket = () => {
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        setError('Batas maksimum percobaan koneksi tercapai. Silakan muat ulang halaman.');
        isManuallyDisconnected = true;
        return;
      }

      if (socket) {
        socket.removeAllListeners();
        socket.close();
      }

      setSocketStatus('connecting');
      console.log('Mencoba menghubungkan ke server...');
      
      socket = io(SOCKET_URL, {
        reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
        reconnectionDelay: RECONNECT_INTERVAL,
        transports: ['websocket'],
        timeout: CONNECTION_TIMEOUT,
        withCredentials: true,
        forceNew: true,
        reconnection: false,
        autoConnect: true
      });

      socket.on('connect', () => {
        console.log('Terhubung ke server');
        setIsConnected(true);
        setSocketStatus('connected');
        setError(null);
        setReconnectAttempts(0);
        setupPingInterval();
        resetConnectionTimeout();
        isManuallyDisconnected = false;
      });

      socket.on('connect_error', (error) => {
        console.error('Kesalahan koneksi:', error);
        setSocketStatus('error');
        setError(`Gagal terhubung ke server: ${error.message}`);
        setReconnectAttempts(prev => prev + 1);
        
        if (!isManuallyDisconnected && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connectSocket, RECONNECT_INTERVAL);
        }
      });

      socket.on('disconnect', (reason) => {
        console.log('Terputus dari server:', reason);
        setIsConnected(false);
        setSocketStatus('disconnected');
        setError(`Koneksi terputus (${reason})`);
        
        if (!isManuallyDisconnected && ['transport error', 'ping timeout'].includes(reason)) {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
              connectSocket();
            }
          }, RECONNECT_INTERVAL);
        }
      });

      socket.on('error', (error) => {
        console.error('Socket error:', error);
        setError(error.message);
      });

      socket.on('pong', () => {
        setError(null);
        resetConnectionTimeout();
      });

      socket.on('systemInfo', updateSystemData);
    };

    connectSocket();

    // Cleanup function
    return () => {
      isManuallyDisconnected = true;
      if (socket) {
        socket.removeAllListeners();
        socket.close();
      }
      if (chartUpdateTimer) {
        clearTimeout(chartUpdateTimer);
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (pingInterval) {
        clearInterval(pingInterval);
      }
      if (connectionTimeout) {
        clearTimeout(connectionTimeout);
      }
    };
  }, [updateSystemData]);

  const MetricCard = ({ title, value, unit, icon, color }) => (
    <Card sx={{ 
      height: '100%',
      minHeight: '120px',
      transition: 'all 0.3s ease-in-out',
    }}>
      <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Box display="flex" alignItems="center" mb={1}>
          {React.cloneElement(icon, { sx: { fontSize: '1.25rem' } })}
          <Typography variant="subtitle1" ml={1} fontWeight="500">
            {title}
          </Typography>
        </Box>
        <Box flex={1} display="flex" flexDirection="column" justifyContent="center">
          <Typography variant="h4" color={color} mb={1} align="center">
            {value}{unit}
          </Typography>
          <LinearProgress 
            variant="determinate" 
            value={parseFloat(value)} 
            sx={{ 
              height: 6,
              borderRadius: 3,
              backgroundColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
              '& .MuiLinearProgress-bar': {
                backgroundColor: color,
                transition: 'transform 0.3s ease-in-out'
              }
            }}
          />
        </Box>
      </CardContent>
    </Card>
  );

  const DetailedMetricCard = ({ title, value, total, used, free, usedPercent, icon, color, chartData }) => (
    <Card sx={{ 
      height: '100%',
      transition: 'all 0.3s ease-in-out',
    }}>
      <CardContent>
        <Box display="flex" alignItems="center" mb={2}>
          {React.cloneElement(icon, { sx: { fontSize: '1.25rem' } })}
          <Typography variant="subtitle1" ml={1} fontWeight="500">
            {title}
          </Typography>
        </Box>
        
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={7}>
            <Box mb={1.5}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Penggunaan
              </Typography>
              <Typography variant="h4" color={color} sx={{ fontSize: '1.75rem' }}>
                {parseFloat(usedPercent).toFixed(1)}%
              </Typography>
              <LinearProgress 
                variant="determinate" 
                value={parseFloat(usedPercent)} 
                sx={{ 
                  mt: 1,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                  '& .MuiLinearProgress-bar': {
                    backgroundColor: color,
                  }
                }}
              />
            </Box>

            <Grid container spacing={1}>
              <Grid item xs={6}>
                <Typography variant="body2" color="text.secondary">
                  Total
                </Typography>
                <Typography variant="body1" fontWeight="500">
                  {typeof total === 'number' ? total.toFixed(1) : total} {title !== 'CPU' && 'GB'}
                </Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="body2" color="text.secondary">
                  Tersedia
                </Typography>
                <Typography variant="body1" fontWeight="500" color="success.main">
                  {typeof free === 'number' ? free.toFixed(1) : free} {title !== 'CPU' && 'GB'}
                </Typography>
              </Grid>
            </Grid>
          </Grid>

          <Grid item xs={5}>
            <Box height={120} position="relative">
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Digunakan', value: parseFloat(used) || 0 },
                      { name: 'Kosong', value: parseFloat(free) || 0 }
                    ]}
                    cx="50%"
                    cy="50%"
                    innerRadius={25}
                    outerRadius={40}
                    paddingAngle={2}
                    dataKey="value"
                    isAnimationActive={false}
                    startAngle={90}
                    endAngle={-270}
                  >
                    <Cell fill={color} />
                    <Cell fill={darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'} />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <Box
                position="absolute"
                top="50%"
                left="50%"
                sx={{
                  transform: 'translate(-50%, -50%)',
                  textAlign: 'center'
                }}
              >
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                  Digunakan
                </Typography>
                <Typography variant="body2" fontWeight="bold">
                  {typeof used === 'number' ? used.toFixed(1) : used} {title !== 'CPU' && 'GB'}
                </Typography>
              </Box>
            </Box>
          </Grid>
        </Grid>

        <Divider sx={{ my: 1.5 }} />

        <Box height={120}>
          <ResponsiveContainer>
            <AreaChart 
              data={chartData.filter(item => item.time !== '')}
              margin={{ top: 5, right: 0, bottom: 0, left: 0 }}
            >
              <defs>
                <linearGradient id={`color${title}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.8}/>
                  <stop offset="95%" stopColor={color} stopOpacity={0.1}/>
                </linearGradient>
                <filter id="shadow" height="200%">
                  <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor={color} floodOpacity="0.2"/>
                </filter>
              </defs>
              <CartesianGrid 
                strokeDasharray="3 3" 
                vertical={false}
                stroke={darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}
              />
              <XAxis 
                dataKey="time" 
                stroke={darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'}
                tick={{ fontSize: 10 }}
                interval="preserveStartEnd"
                tickLine={false}
                axisLine={false}
              />
              <YAxis 
                domain={[0, 100]}
                stroke={darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'}
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `${value}%`}
                width={25}
              />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: darkMode ? 'rgba(26, 32, 39, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                  border: 'none',
                  borderRadius: 6,
                  boxShadow: '0 2px 10px rgba(0,0,0,0.2)',
                  padding: '6px 8px'
                }}
                formatter={(value) => [`${value.toFixed(1)}%`, title]}
                labelStyle={{
                  color: darkMode ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)',
                  fontSize: '10px',
                  marginBottom: '2px'
                }}
                itemStyle={{
                  color: color,
                  fontSize: '12px',
                  fontWeight: '500'
                }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                fillOpacity={1}
                fill={`url(#color${title})`}
                isAnimationActive={false}
                dot={false}
                activeDot={{
                  r: 3,
                  strokeWidth: 2,
                  stroke: color,
                  fill: darkMode ? '#1a2027' : '#fff',
                  filter: 'url(#shadow)'
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Box>
      </CardContent>
    </Card>
  );

  // Komponen untuk statistik sistem yang lebih compact
  const SystemStatsCard = ({ systemInfo }) => (
    <Card sx={{ mb: 4 }}>
      <CardContent>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <Box display="flex" alignItems="center" mb={1}>
              <Timer sx={{ fontSize: '1.25rem', color: 'info.main' }} />
              <Typography variant="subtitle1" ml={1} fontWeight="500">
                Uptime Server
              </Typography>
            </Box>
            <Typography variant="body1" color="text.secondary">
              {systemInfo && typeof systemInfo.uptime === 'number' 
                ? formatUptime(systemInfo.uptime)
                : 'Calculating...'}
            </Typography>
          </Grid>

          <Grid item xs={12} md={4}>
            <Box display="flex" alignItems="center" mb={1}>
              <MemoryIcon sx={{ fontSize: '1.25rem', color: 'info.main' }} />
              <Typography variant="subtitle1" ml={1} fontWeight="500">
                Informasi CPU
              </Typography>
            </Box>
            <Box display="flex" gap={2}>
              <Typography variant="body1" color="text.secondary">
                Core: {systemInfo.cpu.cores.length}
              </Typography>
              <Typography variant="body1" color="text.secondary">
                Load: {systemInfo.cpu.load}%
              </Typography>
            </Box>
          </Grid>

          <Grid item xs={12} md={4}>
            <Box display="flex" alignItems="center" mb={1}>
              <Info sx={{ fontSize: '1.25rem', color: 'info.main' }} />
              <Typography variant="subtitle1" ml={1} fontWeight="500">
                Informasi Sistem
              </Typography>
            </Box>
            <Box display="flex" flexDirection="column" gap={0.5}>
              <Typography variant="body1" color="text.secondary" noWrap>
                {systemInfo.os.distro} {systemInfo.os.release}
              </Typography>
              <Typography variant="body1" color="text.secondary">
                {systemInfo.os.platform === 'win32' ? 'Windows' : systemInfo.os.platform}
              </Typography>
            </Box>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );

  // Optimized loading state
  if (!isConnected || !systemInfo) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Container>
          <Box sx={{ 
            mt: 4, 
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2
          }}>
            <Typography variant="h4" gutterBottom>
              {socketStatus === 'connecting' ? 'Menghubungkan ke Server' : 
               socketStatus === 'disconnected' ? 'Terputus dari Server' :
               'Memuat Informasi Sistem'}
            </Typography>
            <Typography variant="body1" color="text.secondary" gutterBottom>
              {socketStatus === 'connecting' ? 'Mohon tunggu sebentar...' :
               socketStatus === 'disconnected' ? 'Mencoba menghubungkan kembali...' :
               'Sedang mengambil data sistem...'}
            </Typography>
            <Box sx={{ width: '100%', maxWidth: 400 }}>
              <LinearProgress 
                sx={{ 
                  height: 10, 
                  borderRadius: 5,
                  backgroundColor: darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                }} 
              />
            </Box>
            {error && (
              <Alert 
                severity="error" 
                sx={{ 
                  mt: 2, 
                  width: '100%', 
                  maxWidth: 400,
                  '& .MuiAlert-message': {
                    width: '100%'
                  }
                }}
              >
                {error}
                {reconnectAttempts > 0 && (
                  <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                    Percobaan koneksi: {reconnectAttempts}/{MAX_RECONNECT_ATTEMPTS}
                  </Typography>
                )}
              </Alert>
            )}
          </Box>
        </Container>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Container maxWidth="xl">
        <Box sx={{ mt: { xs: 2, sm: 4 }, px: { xs: 1, sm: 2 } }}>
          <Box 
            display="flex" 
            flexDirection={{ xs: 'column', sm: 'row' }} 
            justifyContent="space-between" 
            alignItems={{ xs: 'flex-start', sm: 'center' }} 
            mb={{ xs: 2, sm: 4 }}
            gap={2}
          >
            <Box>
              <Typography variant="h4" gutterBottom>
                Dashboard Monitoring Server
              </Typography>
              <Box 
                display="flex" 
                flexDirection={{ xs: 'column', sm: 'row' }}
                gap={1} 
                alignItems={{ xs: 'flex-start', sm: 'center' }}
              >
                <Box display="flex" alignItems="center" gap={1}>
                  <Computer fontSize="small" />
                  <Typography variant="subtitle1" color="text.secondary" noWrap>
                    {systemInfo.os.hostname}
                  </Typography>
                </Box>
                <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                  <Typography variant="subtitle1" color="text.secondary">
                    {systemInfo.os.distro} {systemInfo.os.release}
                  </Typography>
                  <Chip 
                    label={systemInfo.os.platform === 'win32' ? 'Windows' : systemInfo.os.platform} 
                    size="small"
                    color="primary"
                  />
                </Box>
                {lastUpdate && (
                  <Typography 
                    variant="caption" 
                    color="text.secondary"
                    sx={{ 
                      display: 'block',
                      mt: { xs: 1, sm: 0 }
                    }}
                  >
                    Pembaruan terakhir: {formatTime(lastUpdate)}
                  </Typography>
                )}
              </Box>
            </Box>
            <Tooltip title={darkMode ? 'Mode Terang' : 'Mode Gelap'}>
              <IconButton 
                onClick={() => setDarkMode(!darkMode)} 
                color="inherit"
                sx={{
                  position: { xs: 'absolute', sm: 'static' },
                  right: { xs: 16, sm: 'auto' },
                  top: { xs: 16, sm: 'auto' },
                }}
              >
                {darkMode ? <Brightness7 /> : <Brightness4 />}
              </IconButton>
            </Tooltip>
          </Box>

          <SystemStatsCard systemInfo={systemInfo} />

          <Grid container spacing={3}>
            <Grid item xs={12} md={6}>
              <DetailedMetricCard 
                title="CPU"
                value={systemInfo.cpu.load}
                total={100}
                used={parseFloat(systemInfo.cpu.load)}
                free={100 - parseFloat(systemInfo.cpu.load)}
                usedPercent={systemInfo.cpu.load}
                icon={<Speed color="primary" />}
                color="#2196f3"
                chartData={cpuHistory}
              />
            </Grid>

            <Grid item xs={12} md={6}>
              <DetailedMetricCard 
                title="Memory"
                value={systemInfo.memory.usedPercent}
                total={parseFloat(systemInfo.memory.total)}
                used={parseFloat(systemInfo.memory.used)}
                free={parseFloat(systemInfo.memory.free)}
                usedPercent={systemInfo.memory.usedPercent}
                icon={<Memory color="secondary" />}
                color="#f50057"
                chartData={memoryHistory}
              />
            </Grid>

            <Grid item xs={12} md={4}>
              <MetricCard 
                title="CPU Load"
                value={systemInfo.cpu.load}
                unit="%"
                icon={<Speed color="primary" />}
                color="#2196f3"
              />
            </Grid>

            <Grid item xs={12} md={4}>
              <MetricCard 
                title="Memory Used"
                value={systemInfo.memory.usedPercent}
                unit="%"
                icon={<Memory color="secondary" />}
                color="#f50057"
              />
            </Grid>

            {systemInfo.disk.map((partition, index) => (
              <Grid item xs={12} md={4} key={index}>
                <MetricCard 
                  title={`Disk (${partition.fs})`}
                  value={partition.usedPercent}
                  unit="%"
                  icon={<Storage color="info" />}
                  color="#00bcd4"
                />
              </Grid>
            ))}

            {systemInfo.network.map((net, index) => (
              <Grid item xs={12} md={6} key={index}>
                <Card>
                  <CardContent>
                    <Box display="flex" alignItems="center" mb={2}>
                      <NetworkCheck color="success" />
                      <Typography variant="h6" ml={1}>
                        Network ({net.interface})
                      </Typography>
                    </Box>
                    <Box sx={{ pl: 4 }}>
                      <Typography variant="body1" color="success.main">
                        ↓ Download: {net.rx_sec} KB/s
                      </Typography>
                      <Typography variant="body1" color="warning.main" mt={1}>
                        ↑ Upload: {net.tx_sec} KB/s
                      </Typography>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Box>
      </Container>
    </ThemeProvider>
  );
}

export default App; 