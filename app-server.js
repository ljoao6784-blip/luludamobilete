const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PUBLIC_PORT = Number(process.env.PORT || 3000);
const INTERNAL_PORT = Number(process.env.INTERNAL_PORT || 3101);
const INTERNAL_ADMIN = process.env.ADMIN_TOKEN || ('evo-' + crypto.randomBytes(20).toString('hex'));
const ROOT = __dirname;
let musicState = { current: null, queue: [], config: {} };
let adminSocket = null;
let adminReady = false;
let promoteTimer = null;
let lastSkipAt = 0;

const ASSET_PORT = Number(process.env.ASSET_PORT || 3102);
process.env.PORT = String(ASSET_PORT);
process.env.ADMIN_TOKEN = INTERNAL_ADMIN;
require('./server.js');
process.env.PORT = String(INTERNAL_PORT);
process.env.ASSET_PORT = String(ASSET_PORT);
process.env.ADMIN_TOKEN = INTERNAL_ADMIN;
require('./backend-v6.js');
process.env.PORT = String(PUBLIC_PORT);

function sendAdmin(action, id) {
  if (adminSocket && adminSocket.readyState === WebSocket.OPEN && adminReady) {
    adminSocket.send(JSON.stringify({ type: 'music_admin', action: action, id: id || '' }));
    return true;
  }
  connectAdmin();
  return false;
}
function ensureCurrent() {
  clearTimeout(promoteTimer);
  promoteTimer = setTimeout(function () {
    if (adminReady && !musicState.current && Array.isArray(musicState.queue) && musicState.queue.length) {
      sendAdmin('next');
    }
  }, 120);
}
function connectAdmin() {
  if (adminSocket && (adminSocket.readyState === WebSocket.OPEN || adminSocket.readyState === WebSocket.CONNECTING)) return;
  adminSocket = new WebSocket('ws://127.0.0.1:' + INTERNAL_PORT + '/ws');
  adminSocket.on('open', function () {
    adminReady = false;
    adminSocket.send(JSON.stringify({ type: 'admin_auth', token: INTERNAL_ADMIN }));
  });
  adminSocket.on('message', function (raw) {
    try {
      const d = JSON.parse(raw.toString());
      if (d.type === 'admin_status') { adminReady = !!d.ok; if (adminReady) ensureCurrent(); }
      if (d.type === 'hello' && d.music) { musicState = d.music; ensureCurrent(); }
      if (d.type === 'music_state' && d.music) { musicState = d.music; ensureCurrent(); }
    } catch (e) {}
  });
  adminSocket.on('close', function () { adminReady = false; setTimeout(connectAdmin, 1200); });
  adminSocket.on('error', function () {});
}
setTimeout(connectAdmin, 700);

function readLocal(file, type, res) {
  fs.readFile(path.join(ROOT, file), function (err, body) {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(body);
  });
}
function proxyHttp(req, res, upstreamPath) {
  const headers = Object.assign({}, req.headers, { host: '127.0.0.1:' + INTERNAL_PORT });
  const pr = http.request({ hostname: '127.0.0.1', port: INTERNAL_PORT, path: upstreamPath, method: req.method, headers: headers }, function (ir) {
    res.writeHead(ir.statusCode || 200, ir.headers);
    ir.pipe(res);
  });
  pr.on('error', function () {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('LULUDAMOBILETE iniciando. Atualize em alguns segundos.');
  });
  req.pipe(pr);
}
async function youtubeMeta(url) {
  const endpoint = 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url);
  const ctrl = new AbortController();
  const timer = setTimeout(function () { ctrl.abort(); }, 5000);
  try {
    const r = await fetch(endpoint, { signal: ctrl.signal, headers: { 'User-Agent': 'LULUDAMOBILETE/5.0' } });
    if (!r.ok) throw new Error('metadata');
    const j = await r.json();
    return { title: String(j.title || '').slice(0, 100), author: String(j.author_name || '').slice(0, 80), thumbnail: j.thumbnail_url || '' };
  } finally { clearTimeout(timer); }
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'same-origin' });
  res.end(JSON.stringify(obj));
}

const publicServer = http.createServer(async function (req, res) {
  const u = new URL(req.url || '/', 'http://localhost');
  const pathname = u.pathname;

  if (pathname === '/shell.css') return readLocal('shell.css', 'text/css; charset=utf-8', res);
  if (pathname === '/shell.js') return readLocal('shell.js', 'application/javascript; charset=utf-8', res);
  if (pathname === '/health') return json(res, 200, { ok: true, shell: 'v5', current: musicState.current, queue: (musicState.queue || []).length });

  if (pathname === '/api/youtube-meta' && req.method === 'GET') {
    const target = u.searchParams.get('url') || '';
    if (!/^https:\/\/(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(target)) return json(res, 400, { ok: false, error: 'invalid_url' });
    try { return json(res, 200, Object.assign({ ok: true }, await youtubeMeta(target))); }
    catch (e) { return json(res, 502, { ok: false, error: 'metadata_unavailable' }); }
  }

  if (pathname === '/api/radio/next' && req.method === 'POST') {
    const now = Date.now();
    if (now - lastSkipAt < 1100) return json(res, 429, { ok: false, error: 'rate_limited' });
    lastSkipAt = now;
    let body = '';
    req.on('data', function (c) { if (body.length < 3000) body += c; });
    req.on('end', function () {
      let id = ''; try { id = JSON.parse(body || '{}').id || ''; } catch (e) {}
      if (id && musicState.current && musicState.current.id && id !== musicState.current.id) return json(res, 409, { ok: false, error: 'song_changed' });
      const ok = sendAdmin('next');
      return json(res, ok ? 200 : 503, { ok: ok });
    });
    return;
  }

  if (pathname.indexOf('/__view/') === 0) {
    const stripped = pathname.slice('/__view'.length) || '/';
    return proxyHttp(req, res, stripped + u.search);
  }

  if (pathname === '/overlay.html') return proxyHttp(req, res, pathname + u.search);

  if (pathname === '/' || pathname.endsWith('.html')) return readLocal('shell.html', 'text/html; charset=utf-8', res);

  return proxyHttp(req, res, pathname + u.search);
});

const wss = new WebSocketServer({ noServer: true });
publicServer.on('upgrade', function (req, socket, head) {
  const u = new URL(req.url || '/', 'http://localhost');
  if (u.pathname !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, function (client) {
    const upstream = new WebSocket('ws://127.0.0.1:' + INTERNAL_PORT + '/ws');
    const pending = [];
    client.on('message', function (data) {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data); else pending.push(data);
    });
    upstream.on('open', function () { while (pending.length) upstream.send(pending.shift()); });
    upstream.on('message', function (data) {
      try {
        const d = JSON.parse(data.toString());
        if (d.type === 'hello' && d.music) musicState = d.music;
        if (d.type === 'music_state' && d.music) { musicState = d.music; ensureCurrent(); }
        if (d.type === 'music_added') ensureCurrent();
      } catch (e) {}
      if (client.readyState === WebSocket.OPEN) client.send(data);
    });
    client.on('close', function () { try { upstream.close(); } catch (e) {} });
    upstream.on('close', function () { try { client.close(); } catch (e) {} });
    client.on('error', function () {});
    upstream.on('error', function () { try { client.close(); } catch (e) {} });
  });
});

publicServer.listen(PUBLIC_PORT, function () {
  console.log('LULUDAMOBILETE V5 shell online na porta ' + PUBLIC_PORT);
});