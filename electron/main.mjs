import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { createReadStream, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_PORT = Number(process.env.BOARDROOM_BACKEND_PORT || 8765);

let mainWindow;
let backendServer;

function normalizeHost(input) {
  return String(input || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
}

async function fetchJson(ip, route, options = {}) {
  const host = normalizeHost(ip);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 2500);
  try {
    const response = await fetch(`http://${host}${route}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(body.error || `HTTP ${response.status}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function probeDevice(ip) {
  const host = normalizeHost(ip);
  try {
    const [info, gpio, logs] = await Promise.all([
      fetchJson(host, '/api/info'),
      fetchJson(host, '/api/gpio').catch(() => ({ pins: [] })),
      fetchJson(host, '/api/logs').catch(() => ({ logs: [] })),
    ]);
    return {
      ok: true,
      ip: host,
      info,
      gpio: Array.isArray(gpio.pins) ? gpio.pins : [],
      logs: Array.isArray(logs.logs) ? logs.logs : [],
    };
  } catch (error) {
    return {
      ok: false,
      ip: host,
      error: error instanceof Error ? error.message : 'Device did not respond',
    };
  }
}

function parseRange(range) {
  const trimmed = String(range || '').trim();
  const match = trimmed.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.)(\d{1,3})-(\d{1,3})$/);
  if (!match) return [];
  const [, prefix, startRaw, endRaw] = match;
  const start = Math.max(1, Math.min(254, Number(startRaw)));
  const end = Math.max(1, Math.min(254, Number(endRaw)));
  const [low, high] = start <= end ? [start, end] : [end, start];
  return Array.from({ length: high - low + 1 }, (_, index) => `${prefix}${low + index}`);
}

async function scanRange(range) {
  const hosts = parseRange(range);
  const results = [];
  const concurrency = 24;
  let cursor = 0;

  async function worker() {
    while (cursor < hosts.length) {
      const host = hosts[cursor++];
      const result = await probeDevice(host);
      if (result.ok) results.push(result);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker));
  return results;
}

async function setGpio({ ip, pin, value }) {
  const host = normalizeHost(ip);
  try {
    await fetchJson(host, '/api/gpio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, value }),
    });
    return probeDevice(host);
  } catch (error) {
    return {
      ok: false,
      ip: host,
      error: error instanceof Error ? error.message : 'GPIO update failed',
    };
  }
}

async function getLogs(ip) {
  try {
    const body = await fetchJson(ip, '/api/logs');
    return { ok: true, logs: Array.isArray(body.logs) ? body.logs : [] };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to fetch logs',
    };
  }
}

function uploadFirmware({ ip, filePath, requestId }) {
  return new Promise((resolve) => {
    const host = normalizeHost(ip);
    const fileSize = statSync(filePath).size;
    const fileName = path.basename(filePath);
    const boundary = `----Boardroom${Date.now().toString(16)}`;
    const prefix = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="firmware"; filename="${fileName}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n',
    );
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
    const total = prefix.length + fileSize + suffix.length;
    let sent = 0;

    const request = http.request(
      {
        hostname: host,
        port: 80,
        path: '/update',
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': total,
        },
        timeout: 120000,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            statusCode: response.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );

    function report(delta = 0) {
      sent += delta;
      mainWindow?.webContents.send('firmware:upload-progress', {
        requestId,
        sent,
        total,
        percent: Math.round((sent / total) * 100),
      });
    }

    request.on('error', (error) => resolve({ ok: false, error: error.message }));
    request.on('timeout', () => {
      request.destroy(new Error('Upload timed out'));
    });

    request.write(prefix);
    report(prefix.length);

    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => report(chunk.length));
    stream.on('error', (error) => {
      request.destroy(error);
      resolve({ ok: false, error: error.message });
    });
    stream.on('end', () => {
      request.write(suffix);
      report(suffix.length);
      request.end();
    });
    stream.pipe(request, { end: false });
  });
}

function createBackendServer() {
  backendServer = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', `http://127.0.0.1:${BACKEND_PORT}`);
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    if (url.pathname === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, port: BACKEND_PORT }));
      return;
    }
    if (url.pathname === '/api/probe') {
      const result = await probeDevice(url.searchParams.get('ip'));
      response.writeHead(result.ok ? 200 : 502, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(result));
      return;
    }
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Not found' }));
  });
  backendServer.listen(BACKEND_PORT, '127.0.0.1');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#f5f1e8',
    title: 'Boardroom',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (!app.isPackaged && process.env.npm_lifecycle_event === 'dev:desktop') {
    mainWindow.loadURL('http://127.0.0.1:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  createBackendServer();
  ipcMain.handle('backend:status', () => ({ port: BACKEND_PORT, url: `http://127.0.0.1:${BACKEND_PORT}` }));
  ipcMain.handle('device:probe', (_event, ip) => probeDevice(ip));
  ipcMain.handle('device:scan-range', (_event, range) => scanRange(range));
  ipcMain.handle('device:set-gpio', (_event, payload) => setGpio(payload));
  ipcMain.handle('device:get-logs', (_event, ip) => getLogs(ip));
  ipcMain.handle('firmware:select-file', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select ESP32 firmware binary',
      properties: ['openFile'],
      filters: [{ name: 'Firmware binary', extensions: ['bin'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const stats = statSync(filePath);
    return { path: filePath, name: path.basename(filePath), size: stats.size };
  });
  ipcMain.handle('firmware:upload', (_event, payload) => uploadFirmware(payload));

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  backendServer?.close();
  if (process.platform !== 'darwin') app.quit();
});
