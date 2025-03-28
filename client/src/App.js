import React, { useState, useEffect } from 'react';
import { 
  Container, 
  Grid, 
  Paper, 
  Typography, 
  Box,
  ThemeProvider,
  createTheme,
  CssBaseline
} from '@mui/material';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import io from 'socket.io-client';

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
  },
});

const socket = io('http://localhost:5000');

function App() {
  const [systemInfo, setSystemInfo] = useState(null);
  const [cpuHistory, setCpuHistory] = useState([]);
  const [memoryHistory, setMemoryHistory] = useState([]);

  useEffect(() => {
    socket.on('systemInfo', (data) => {
      setSystemInfo(data);
      
      // Update histories
      const timestamp = new Date().toLocaleTimeString();
      setCpuHistory(prev => [...prev.slice(-20), { time: timestamp, value: parseFloat(data.cpu.load) }]);
      setMemoryHistory(prev => [...prev.slice(-20), { time: timestamp, value: parseFloat(data.memory.usedPercent) }]);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const MetricCard = ({ title, value, unit }) => (
    <Paper sx={{ p: 2, height: '100%' }}>
      <Typography variant="h6" gutterBottom>
        {title}
      </Typography>
      <Typography variant="h4">
        {value} {unit}
      </Typography>
    </Paper>
  );

  const ChartCard = ({ title, data, dataKey }) => (
    <Paper sx={{ p: 2, height: '100%' }}>
      <Typography variant="h6" gutterBottom>
        {title}
      </Typography>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="time" />
          <YAxis domain={[0, 100]} />
          <Tooltip />
          <Line type="monotone" dataKey="value" stroke="#8884d8" />
        </LineChart>
      </ResponsiveContainer>
    </Paper>
  );

  if (!systemInfo) {
    return (
      <ThemeProvider theme={darkTheme}>
        <CssBaseline />
        <Container>
          <Box sx={{ mt: 4 }}>
            <Typography variant="h4">Loading system information...</Typography>
          </Box>
        </Container>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Container>
        <Box sx={{ mt: 4 }}>
          <Typography variant="h4" gutterBottom>
            Server Monitoring Dashboard
          </Typography>

          <Grid container spacing={3}>
            {/* CPU Usage */}
            <Grid item xs={12} md={6}>
              <ChartCard 
                title="CPU Usage (%)" 
                data={cpuHistory}
              />
            </Grid>

            {/* Memory Usage */}
            <Grid item xs={12} md={6}>
              <ChartCard 
                title="Memory Usage (%)" 
                data={memoryHistory}
              />
            </Grid>

            {/* CPU Load */}
            <Grid item xs={12} md={4}>
              <MetricCard 
                title="CPU Load" 
                value={systemInfo.cpu.load}
                unit="%"
              />
            </Grid>

            {/* Memory Usage */}
            <Grid item xs={12} md={4}>
              <MetricCard 
                title="Memory Used" 
                value={systemInfo.memory.usedPercent}
                unit="%"
              />
            </Grid>

            {/* Disk Usage */}
            {systemInfo.disk.map((partition, index) => (
              <Grid item xs={12} md={4} key={index}>
                <MetricCard 
                  title={`Disk Usage (${partition.fs})`}
                  value={partition.usedPercent}
                  unit="%"
                />
              </Grid>
            ))}

            {/* Network Stats */}
            {systemInfo.network.map((net, index) => (
              <Grid item xs={12} md={6} key={index}>
                <Paper sx={{ p: 2 }}>
                  <Typography variant="h6" gutterBottom>
                    Network ({net.interface})
                  </Typography>
                  <Typography>
                    Download: {net.rx_sec} KB/s
                  </Typography>
                  <Typography>
                    Upload: {net.tx_sec} KB/s
                  </Typography>
                </Paper>
              </Grid>
            ))}

            {/* Process Info */}
            <Grid item xs={12} md={6}>
              <Paper sx={{ p: 2 }}>
                <Typography variant="h6" gutterBottom>
                  Processes
                </Typography>
                <Typography>
                  Total: {systemInfo.processes.total}
                </Typography>
                <Typography>
                  Running: {systemInfo.processes.running}
                </Typography>
                <Typography>
                  Blocked: {systemInfo.processes.blocked}
                </Typography>
              </Paper>
            </Grid>
          </Grid>
        </Box>
      </Container>
    </ThemeProvider>
  );
}

export default App; 