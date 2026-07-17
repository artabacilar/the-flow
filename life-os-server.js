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
const crypto = require('crypto');
const { URL } = require('url');

// ── Auth ────────────────────────────────────────────────────
// One password protects the whole app. First login on a device sets a
// long-lived cookie, so you never log in again on that device (phone or
// computer) until you clear it or ~10 years pass.
//   Set APP_PASSWORD in the environment. If unset, the app is OPEN (no login).
const APP_PASSWORD = process.env.APP_PASSWORD || '';
// A secret used to sign the auth cookie so it can't be forged. Falls back to
// a value derived from the password so it's stable across restarts.
const AUTH_SECRET = process.env.AUTH_SECRET || (APP_PASSWORD ? 'flow$' + APP_PASSWORD : 'flow-open');
const COOKIE_NAME = 'flow_auth';
const COOKIE_MAXAGE = 60 * 60 * 24 * 3650; // ~10 years, in seconds

function authToken() { return crypto.createHmac('sha256', AUTH_SECRET).update('ok').digest('hex'); }
function parseCookies(req) {
  const h = req.headers.cookie || ''; const o = {};
  h.split(';').forEach((p) => { const i = p.indexOf('='); if (i > -1) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return o;
}
function isAuthed(req) {
  if (!APP_PASSWORD) return true; // no password configured → open
  return parseCookies(req)[COOKIE_NAME] === authToken();
}

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
    fetch(e.request).then(r=>{
      // only cache clean, same-origin 200s — never redirects (login gate) or errors
      if(r.ok && r.status===200 && r.type==='basic'){ const cp=r.clone(); caches.open(CACHE).then(c=>c.put(e.request,cp)); }
      return r;
    }).catch(()=>caches.match(e.request).then(m=>m||caches.match('./')))
  );
});`;

// ── Login page ──────────────────────────────────────────────
function loginPage(err) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0a0b0d"><title>The Flow — Sign in</title>
<link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icon-192.png">
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(1200px 600px at 50% -10%,#12303a 0%,#0a0b0d 60%);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e8eef7;padding:24px}
.box{width:100%;max-width:360px;text-align:center}
.logo{width:78px;height:78px;margin:0 auto 18px;display:block}
h1{font-size:26px;font-weight:800;margin:0 0 4px;letter-spacing:-.5px}
p{color:#8b97a8;font-size:14px;margin:0 0 26px}
form{display:flex;flex-direction:column;gap:12px}
input{width:100%;background:#151922;border:1px solid #2a313d;color:#e8eef7;border-radius:14px;
  padding:15px 16px;font-size:16px;outline:none;text-align:center}
input:focus{border-color:#00d1a6}
button{width:100%;border:0;border-radius:14px;padding:15px;font-size:16px;font-weight:700;cursor:pointer;
  color:#052318;background:linear-gradient(135deg,#00e88a,#00b7e0)}
.err{color:#ffb3ba;font-size:13px;min-height:18px;margin-top:2px}
</style></head><body>
<div class="box">
  <svg class="logo" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="f" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#00e88a"/><stop offset=".55" stop-color="#00d1a6"/><stop offset="1" stop-color="#00b7e0"/>
    </linearGradient></defs>
    <rect width="512" height="512" rx="118" fill="#12161d"/>
    <g fill="none" stroke-linecap="round">
      <path d="M96 256 q 59 -70 118 0 t 118 0 t 118 0" stroke="url(#f)" stroke-width="34"/>
      <path d="M110 190 q 59 -66 118 0 t 118 0 t 118 0" stroke="url(#f)" stroke-width="24" opacity=".3"/>
      <path d="M110 322 q 59 66 118 0 t 118 0 t 118 0" stroke="url(#f)" stroke-width="24" opacity=".3"/>
    </g></svg>
  <h1>The Flow</h1>
  <p>Enter your password to continue</p>
  <form method="POST" action="/login">
    <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password" required>
    <button type="submit">Sign in</button>
    <div class="err">${err ? 'Wrong password — try again.' : ''}</div>
  </form>
</div></body></html>`;
}

// ── Server ──────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  try {
    const p = u.pathname;

    // ── Auth: login / logout ──
    if (p === '/login' && req.method === 'GET') {
      if (isAuthed(req)) { res.writeHead(302, { Location: '/' }); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(loginPage(u.searchParams.get('e')));
    }
    if (p === '/login' && req.method === 'POST') {
      const body = await readBody(req);
      let pw = '';
      const ct = req.headers['content-type'] || '';
      if (ct.includes('application/json')) { try { pw = (JSON.parse(body) || {}).password || ''; } catch (_) {} }
      else { pw = new URLSearchParams(body).get('password') || ''; }
      if (APP_PASSWORD && pw === APP_PASSWORD) {
        res.writeHead(302, {
          Location: '/',
          'Set-Cookie': `${COOKIE_NAME}=${authToken()}; Path=/; Max-Age=${COOKIE_MAXAGE}; SameSite=Lax; HttpOnly`,
        });
        return res.end();
      }
      res.writeHead(302, { Location: '/login?e=1' });
      return res.end();
    }
    if (p === '/logout') {
      res.writeHead(302, { Location: '/login', 'Set-Cookie': `${COOKIE_NAME}=; Path=/; Max-Age=0` });
      return res.end();
    }

    // ── Health check (for cloud hosts) — always open ──
    if (p === '/healthz') return json(res, 200, { ok: true });

    // ── PWA assets (must be reachable pre-login so the icon/manifest work) ──
    if (p === '/manifest.webmanifest') { res.writeHead(200, { 'Content-Type': 'application/manifest+json' }); return res.end(MANIFEST); }
    if (p === '/sw.js') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end(SW); }
    if (p === '/icon-192.png') return sendFile(res, 'icon-192.png', 'image/png');
    if (p === '/icon-512.png') return sendFile(res, 'icon-512.png', 'image/png');
    if (p === '/favicon.ico') return sendFile(res, 'icon-192.png', 'image/png');

    // ── Everything below requires login ──
    if (!isAuthed(req)) {
      if (p.startsWith('/api/')) return json(res, 401, { error: 'auth required' });
      res.writeHead(302, { Location: '/login' });
      return res.end();
    }

    // ── App shell ──
    if (p === '/' || p === '/index.html') return sendFile(res, 'life-dashboard.html', 'text/html; charset=utf-8');
    if (p === '/languages' || p === '/languages.html' || p === '/lingua') return sendFile(res, 'LinguaCoach.html', 'text/html; charset=utf-8');

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
  console.log('  Login:  ' + (APP_PASSWORD ? 'password ON (set via APP_PASSWORD)' : 'OPEN — no password set'));
  console.log('');
  console.log('  On THIS computer:      http://localhost:' + PORT);
  if (ip) {
    console.log('  On your PHONE (same WiFi):  http://' + ip + ':' + PORT);
    console.log('  → Open that link in Safari/Chrome on your phone,');
    console.log('    then "Add to Home Screen" to install The Flow as an app.');
  }
  console.log('─────────────────────────────────────────────');
});
