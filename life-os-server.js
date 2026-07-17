#!/usr/bin/env node
/*
 * ─────────────────────────────────────────────────────────────
 *  The Flow · Server  (local + cloud)
 * ─────────────────────────────────────────────────────────────
 *  Runs your dashboard as a real APP with a real database, so
 *  phone + desktop share the same data.
 *
 *  • LOCAL:  node life-os-server.js  → http://localhost:4000
 *            data saved to a file on disk (life-os-data.json / .db)
 *
 *  • CLOUD:  deploy this + life-dashboard.html to a free host.
 *            Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *            and your data persists in the cloud, synced everywhere.
 *
 *  The dashboard is served at "/" and its API at "/api", same origin,
 *  so ONE file works both locally and in the cloud.
 * ─────────────────────────────────────────────────────────────
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL } = require('url');

// Find this machine's local network IP (so a phone on the same WiFi can reach it)
function lanIP() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name]) {
      if (n.family === 'IPv4' && !n.internal) return n.address;
    }
  }
  return null;
}

const PORT = parseInt(process.env.PORT || process.env.LIFEOS_PORT || 4000, 10);
const DATA_DIR = process.env.DATA_DIR || __dirname;      // point at a mounted volume in the cloud
const APP_DIR = __dirname;

// ── Storage engine ──────────────────────────────────────────
// Priority: Upstash Redis (cloud, persistent) → SQLite → JSON file
let store;
const UP_URL = process.env.UPSTASH_REDIS_REST_URL;
const UP_TOK = process.env.UPSTASH_REDIS_REST_TOKEN;

if (UP_URL && UP_TOK) {
  // Cloud key-value via Upstash REST — no npm dependency, just fetch()
  async function cmd(args) {
    const res = await fetch(UP_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + UP_TOK, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    const j = await res.json();
    if (j.error) throw new Error('Upstash: ' + j.error);
    return j.result;
  }
  async function pipeline(cmds) {
    const res = await fetch(UP_URL + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + UP_TOK, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
    return res.json();
  }
  store = {
    engine: 'Upstash Redis (cloud)',
    file: 'cloud',
    async all() {
      const keys = (await cmd(['KEYS', 'ld_*'])) || [];
      if (!keys.length) return {};
      const vals = await cmd(['MGET', ...keys]);
      const o = {}; keys.forEach((k, i) => { if (vals[i] != null) o[k] = vals[i]; });
      return o;
    },
    async get(k) { return await cmd(['GET', k]); },
    async set(k, v) { await cmd(['SET', k, v]); },
    async bulk(obj) { const cmds = Object.keys(obj).map((k) => ['SET', k, obj[k]]); if (cmds.length) await pipeline(cmds); },
    async count() { const keys = (await cmd(['KEYS', 'ld_*'])) || []; return keys.length; },
  };
} else {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(path.join(DATA_DIR, 'life-os.db'));
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE IF NOT EXISTS store (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)');
    const up = db.prepare('INSERT INTO store(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at');
    store = {
      engine: 'SQLite', file: 'life-os.db',
      all() { const o = {}; for (const r of db.prepare('SELECT key,value FROM store').all()) o[r.key] = r.value; return o; },
      get(k) { const r = db.prepare('SELECT value FROM store WHERE key=?').get(k); return r ? r.value : null; },
      set(k, v) { up.run(k, v, Date.now()); },
      bulk(obj) { db.transaction((o) => { for (const k in o) up.run(k, o[k], Date.now()); })(obj); },
      count() { return db.prepare('SELECT COUNT(*) c FROM store').get().c; },
    };
  } catch (e) {
    const FILE = path.join(DATA_DIR, 'life-os-data.json');
    let mem = {}; try { mem = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) {}
    const persist = () => { const t = FILE + '.tmp'; fs.writeFileSync(t, JSON.stringify(mem)); fs.renameSync(t, FILE); };
    store = {
      engine: 'JSON', file: 'life-os-data.json',
      all() { return Object.assign({}, mem); },
      get(k) { return k in mem ? mem[k] : null; },
      set(k, v) { mem[k] = v; persist(); },
      bulk(obj) { Object.assign(mem, obj); persist(); },
      count() { return Object.keys(mem).length; },
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────
function readBody(req) { return new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); }); }
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
function sendFile(res, file, type) {
  fs.readFile(path.join(APP_DIR, file), (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found: ' + file); }
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  });
}

// ── PWA assets (generated inline so there are fewer files to ship) ──
const MANIFEST = JSON.stringify({
  name: "The Flow", short_name: 'The Flow', start_url: '.', scope: '.',
  display: 'standalone', background_color: '#0a0b0d', theme_color: '#0a0b0d',
  description: 'Personal life dashboard — training, diet, habits, WHOOP & more',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ],
});
const SW = `
const CACHE='life-os-v1';
const SHELL=['./','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.pathname.startsWith('/api')) return; // never cache data — always live
  e.respondWith(
    fetch(e.request).then(r=>{ const cp=r.clone(); caches.open(CACHE).then(c=>c.put(e.request,cp)); return r; })
      .catch(()=>caches.match(e.request).then(m=>m||caches.match('./')))
  );
});`;

// ── Server ──────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  try {
    const p = u.pathname;

    // ── App shell + PWA ──
    if (p === '/' || p === '/index.html') return sendFile(res, 'life-dashboard.html', 'text/html; charset=utf-8');
    if (p === '/languages' || p === '/languages.html' || p === '/lingua') return sendFile(res, 'LinguaCoach.html', 'text/html; charset=utf-8');
    if (p === '/manifest.webmanifest') { res.writeHead(200, { 'Content-Type': 'application/manifest+json' }); return res.end(MANIFEST); }
    if (p === '/sw.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(SW); }
    if (p === '/icon-192.png') return sendFile(res, 'icon-192.png', 'image/png');
    if (p === '/icon-512.png') return sendFile(res, 'icon-512.png', 'image/png');
    if (p === '/favicon.ico') return sendFile(res, 'icon-192.png', 'image/png');

    // ── Health check (for cloud hosts) ──
    if (p === '/healthz') return json(res, 200, { ok: true });

    // ── Data API ──
    if (p === '/api/status') return json(res, 200, { ok: true, engine: store.engine, file: store.file, keys: await store.count() });
    if (p === '/api/all') return json(res, 200, await store.all());
    if (p === '/api/get') return json(res, 200, { key: u.searchParams.get('key'), value: await store.get(u.searchParams.get('key')) });
    if (p === '/api/set' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req));
      if (!b.key) return json(res, 400, { error: 'key required' });
      await store.set(b.key, typeof b.value === 'string' ? b.value : JSON.stringify(b.value));
      return json(res, 200, { ok: true });
    }
    if (p === '/api/bulk' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req)); const data = b.data || b; const clean = {};
      for (const k in data) clean[k] = typeof data[k] === 'string' ? data[k] : JSON.stringify(data[k]);
      await store.bulk(clean);
      return json(res, 200, { ok: true, saved: Object.keys(clean).length });
    }
    if (p === '/api/export') return json(res, 200, { exported: new Date().toISOString(), app: 'artur-life-dashboard-v2', data: await store.all() });

    res.writeHead(404); res.end('Not found');
  } catch (err) { json(res, 500, { error: err.message }); }
});

server.listen(PORT, '0.0.0.0', () => {
  const ip = lanIP();
  console.log('─────────────────────────────────────────────');
  console.log('  🌊 The Flow running');
  console.log('  Engine: ' + store.engine);
  console.log('');
  console.log('  On THIS computer:      http://localhost:' + PORT);
  if (ip) {
    console.log('  On your PHONE (same WiFi):  http://' + ip + ':' + PORT);
    console.log('  → Open that link in Safari/Chrome on your phone,');
    console.log('    then "Add to Home Screen" to install The Flow as an app.');
  }
  console.log('─────────────────────────────────────────────');
});
