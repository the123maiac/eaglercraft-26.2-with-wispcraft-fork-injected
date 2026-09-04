const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const net = require('net');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/gateway' });

const PORT = process.env.PORT || 10000;
const TARGET_HOST = 'donutsmp.net';
const TARGET_PORT = 25565;

// Verified Minecraft & Xbox Client IDs for Microsoft Device Code Flow
const CLIENT_IDS = [
  'c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb', // Official Prism Launcher Client ID
  '1f907974-e22b-4810-a9de-d9647380c97e'  // Xbox Live Client ID Fallback
];

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Route: Auto-detect index.html
app.get('/', (req, res) => {
  const publicPath = path.join(__dirname, 'public', 'index.html');
  const rootPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(publicPath)) return res.sendFile(publicPath);
  if (fs.existsSync(rootPath)) return res.sendFile(rootPath);
  res.status(404).send('index.html not found');
});

// 1. Microsoft Device Code Generator with Auto-Fallback
app.post('/api/auth/start', async (req, res) => {
  for (const clientId of CLIENT_IDS) {
    try {
      const resp = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          scope: 'XboxLive.signin offline_access'
        })
      });
      const data = await resp.json();
      if (data && data.user_code) {
        return res.json({ ...data, client_id: clientId });
      }
    } catch (e) {
      console.warn('Retrying with next client ID...', e.message);
    }
  }
  res.status(500).json({ error: 'Failed to generate code from Microsoft' });
});

app.post('/api/auth/poll', async (req, res) => {
  try {
    const resp = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: req.body.client_id || CLIENT_IDS[0],
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

// 2. WebSocket to DonutSMP TCP Gateway
wss.on('connection', (ws) => {
  console.log('[Gateway] Client connected! Tunneling to ' + TARGET_HOST);
  const tcp = new net.Socket();

  tcp.connect(TARGET_PORT, TARGET_HOST, () => {
    console.log('[Gateway] Connected to ' + TARGET_HOST);
  });

  ws.on('message', (data) => {
    if (tcp.writable) tcp.write(data);
  });

  tcp.on('data', (chunk) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(chunk);
  });

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
  console.log('DonutSMP Gateway Online on port ' + PORT);
});
