const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const net = require('net');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/gateway' });

// Render dynamically sets PORT (default is 10000)
const PORT = process.env.PORT || 10000;
const TARGET_HOST = 'donutsmp.net';
const TARGET_PORT = 25565;
const CLIENT_ID = '94593cc6-e4a8-4226-8806-03768d4076ea'; // Official Prism Launcher Minecraft OAuth ID

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 1. Direct Microsoft Device Code Auth API (Runs on backend, no CORS limits)
app.post('/api/auth/start', async (req, res) => {
  try {
    const resp = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        scope: 'XboxLive.signin offline_access'
      })
    });
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/poll', async (req, res) => {
  try {
    const resp = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: req.body.device_code
      })
    });
    const data = await resp.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. WebSocket to DonutSMP TCP Socket Gateway
wss.on('connection', (ws) => {
  console.log('[Gateway] Client connected! Tunneling to ' + TARGET_HOST + ':' + TARGET_PORT);
  const tcp = new net.Socket();

  tcp.connect(TARGET_PORT, TARGET_HOST, () => {
    console.log('[Gateway] TCP Connected successfully to ' + TARGET_HOST);
  });

  // Forward Browser WebSocket -> DonutSMP Java TCP
  ws.on('message', (data) => {
    if (tcp.writable) {
      tcp.write(data);
    }
  });

  // Forward DonutSMP Java TCP -> Browser WebSocket
  tcp.on('data', (chunk) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(chunk);
    }
  });

  // Safe close & error cleanup
  tcp.on('close', () => ws.close());
  ws.on('close', () => tcp.end());
  tcp.on('error', (err) => {
    console.error('[TCP Error]', err.message);
    ws.close();
  });
  ws.on('error', (err) => {
    console.error('[WS Error]', err.message);
    tcp.end();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`DonutSMP Gateway server listening on port ${PORT}`);
});