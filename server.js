const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/gateway' });

const PORT = process.env.PORT || 10000;
const TARGET_HOST = 'donutsmp.net';
const TARGET_PORT = 25565;

// Verified Microsoft Client IDs
const CLIENT_IDS = [
  'c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb',
  '1f907974-e22b-4810-a9de-d9647380c97e'
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

// 1. Microsoft Device Code Generator
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

// 2. Eaglercraft-Aware Gateway to DonutSMP
wss.on('connection', (clientWs) => {
  console.log('[Gateway] Client connected! Routing through Eagler Handshake Bridge...');

  // Connects to EagPAAS bridge targeting DonutSMP
  const upstreamUrl = `wss://eaglerproxy.q13x.com/?ip=${TARGET_HOST}&port=${TARGET_PORT}&authType=ONLINE`;
  const upstreamWs = new WebSocket(upstreamUrl);

  // Pipe Client <-> Upstream Gateway
  clientWs.on('message', (msg, isBinary) => {
    if (upstreamWs.readyState === WebSocket.OPEN) {
      upstreamWs.send(msg, { binary: isBinary });
    }
  });

  upstreamWs.on('message', (msg, isBinary) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(msg, { binary: isBinary });
    }
  });

  upstreamWs.on('open', () => {
    console.log('[Gateway] Bridge established to DonutSMP!');
  });

  upstreamWs.on('close', () => clientWs.close());
  clientWs.on('close', () => upstreamWs.close());
  upstreamWs.on('error', (err) => {
    console.error('[Upstream Error]', err.message);
    clientWs.close();
  });
  clientWs.on('error', (err) => {
    console.error('[Client Error]', err.message);
    upstreamWs.close();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('DonutSMP Gateway Online on port ' + PORT);
});
