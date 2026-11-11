/* The plugin catalogue: every MCP server published to the official MCP
 * Registry (registry.modelcontextprotocol.io) that runs on the internet —
 * thousands of them — searchable from the command centre, each one a
 * plugin a click away.
 *
 *   · Only servers with a remote address are listed: a server that has to be
 *     installed and run on a computer (npm, pip, docker) cannot run inside
 *     The Flow, so it is not offered as if it could.
 *   · Read once, kept in memory, refreshed every six hours; the first ask
 *     after a start answers at once with what has arrived so far.
 *   · What a server needs is said from what it published: a header with a
 *     key (put in Render, never pasted), or nothing — in which case it may
 *     still sign you in itself, found when it is connected (flow-mcpauth).
 *   · Listed is not "working". The registry is a directory, not a review:
 *     each server is its publisher's; connecting one lists its tools, and
 *     anything that acts still waits for the owner's yes.
 *
 * GET /api/team/plugins/catalog?q=&cat=&offset=&limit= → { items, total, count, cats, updated, loading }
 */
'use strict';

const FAKE = process.env.FLOW_TEAM_FAKE === '1';
const REGISTRY = (process.env.FLOW_MCP_REGISTRY || 'https://registry.modelcontextprotocol.io').replace(/\/+$/, '');
const REFRESH_MS = 6 * 3600 * 1000;
const MAX_PAGES = 400;
const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

/* Rough shelves, from the words a server uses about itself. */
const CATS = [
  ['Productivity', /\b(notion|calendar|task|todo|notes?|docs?|document|wiki|project|trello|asana|linear|jira|clickup|monday|airtable|spreadsheet|sheets|obsidian|meeting)\b/i],
  ['Sales & CRM', /\b(crm|hubspot|salesforce|pipedrive|leads?|deals?|prospect|sales|outreach|customers?)\b/i],
  ['Marketing & social', /\b(marketing|seo|ads?|campaign|instagram|facebook|meta|tiktok|youtube|linkedin|twitter|x\.com|social|newsletter|mailchimp|brand)\b/i],
  ['Finance', /\b(finance|financial|accounting|invoice|quickbooks|xero|stripe|payments?|bank|banking|crypto|stock|stocks|trading|market data|tax|expense|budget|wallet|defi|btc|bitcoin)\b/i],
  ['Commerce', /\b(shopify|e-?commerce|store|orders?|products?|inventory|woocommerce|amazon|checkout|retail)\b/i],
  ['Communication', /\b(email|mail|gmail|outlook|slack|teams|discord|telegram|whatsapp|sms|chat|messag\w*|calls?|phone|voice)\b/i],
  ['Developer', /\b(github|gitlab|code|api|deploy|devops|kubernetes|docker|cloud|aws|gcp|azure|database|sql|postgres|logs?|monitoring|ci|testing|sdk|repo)\b/i],
  ['Data & search', /\b(search|scrap\w*|crawl\w*|web|browser|data|analytics|research|knowledge|rag|vector|dataset|news)\b/i],
  ['AI & media', /\b(image|video|audio|music|speech|transcri\w*|llm|model|generat\w*|design|figma|canva|3d|photo)\b/i],
  ['Health & life', /\b(health|fitness|whoop|sleep|workout|nutrition|medical|recipe|travel|weather|maps?|flights?|hotel)\b/i]
];
function catOf(text) { for (const [c, re] of CATS) if (re.test(text)) return c; return 'Other'; }

const st = { list: [], byUrl: new Map(), updated: 0, loading: null, error: '' };

function shape(s) {
  const sv = s && s.server; if (!sv || !Array.isArray(sv.remotes)) return null;
  const rm = sv.remotes.find((r) => r && /^https:\/\//i.test(String(r.url || '')) && /streamable-http/i.test(String(r.type || ''))) || sv.remotes.find((r) => r && /^https:\/\//i.test(String(r.url || '')));
  if (!rm) return null;
  const url = String(rm.url);
  if (/\{[^}]+\}/.test(url)) return null;   /* an address with blanks to fill in: not one click */
  const hdrs = (rm.headers || []).filter((h) => h && h.name && (h.isRequired || h.isSecret)).slice(0, 3);
  const title = str(sv.title || sv.name.split('/').pop().replace(/[-_]/g, ' '), 80);
  const description = str(sv.description, 240);
  const host = (() => { try { return new URL(url).host; } catch (e) { return ''; } })();
  return {
    id: str(sv.name, 160), title, description, url, host,
    website: /^https:\/\//.test(String(sv.websiteUrl || '')) ? str(sv.websiteUrl, 300) : '',
    version: str(sv.version, 20), sse: /sse/i.test(String(rm.type || '')),
    icon: (() => { const ic = (Array.isArray(sv.icons) ? sv.icons : []).find((i) => i && /^https:\/\//i.test(String(i.src || ''))); return ic ? str(ic.src, 400) : ''; })(),
    needs: hdrs.map((h) => ({ header: str(h.name, 60), secret: !!h.isSecret, about: str(h.description, 140) })),
    cat: catOf(title + ' ' + description + ' ' + sv.name)
  };
}

async function load() {
  if (FAKE) { st.list = fakeList(); st.updated = Date.now(); return; }
  const out = [], seen = new Set(); let cursor = '', pages = 0;
  try {
    for (;;) {
      const u = REGISTRY + '/v0/servers?limit=100&version=latest' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '');
      const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 20000);
      let j; try { const r = await fetch(u, { headers: { accept: 'application/json' }, signal: ac.signal }); if (!r.ok) throw new Error('registry ' + r.status); j = await r.json(); } finally { clearTimeout(t); }
      for (const s of (j.servers || [])) { const x = shape(s); if (x && !seen.has(x.id)) { seen.add(x.id); out.push(x); } }
      pages++;
      /* what has arrived is usable at once */
      if (pages % 10 === 0 || !st.list.length) { st.list = out.slice(); index(); }
      cursor = j.metadata && j.metadata.nextCursor;
      if (!cursor || pages >= MAX_PAGES) break;
    }
    st.list = out; index(); st.updated = Date.now(); st.error = '';
  } catch (e) {
    st.error = 'The MCP Registry could not be read just now.';
    if (out.length > st.list.length) { st.list = out; index(); }
    if (!st.updated && st.list.length) st.updated = Date.now();
  }
}
function index() { st.byUrl = new Map(st.list.map((x) => [x.url, x])); st.list.sort((a, b) => a.title.localeCompare(b.title)); }
function ensure() {
  if (st.loading) return st.loading;
  if (st.updated && Date.now() - st.updated < REFRESH_MS) return Promise.resolve();
  st.loading = load().finally(() => { st.loading = null; });
  return st.loading;
}

/* The stand-in for tests: twelve hundred made-up servers, some needing a key. */
function fakeList() {
  const words = ['Notes', 'Invoices', 'Weather', 'Flights', 'Shopify orders', 'CRM leads', 'Image studio', 'Bank feeds', 'Slack bridge', 'Code search', 'Recipes', 'Ad spend'];
  const out = [];
  for (let i = 0; i < 1200; i++) {
    const w = words[i % words.length];
    const needs = i % 5 === 0 ? [{ header: 'X-API-Key', secret: true, about: 'Your API key' }] : [];
    const title = w + ' ' + (i + 1);
    out.push({ id: 'com.example/' + w.toLowerCase().replace(/\s+/g, '-') + '-' + (i + 1), title, description: 'A made-up server about ' + w.toLowerCase() + ' for tests.', url: 'https://mcp.fake.example/s' + (i + 1), host: 'mcp.fake.example', website: '', version: '1.0.0', sse: false, needs, cat: catOf(title + ' ' + w) });
  }
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

async function search(q, cat, offset, limit) {
  const wait = ensure();
  /* the first time, give it a few seconds so the first page is not empty */
  if (!st.list.length) await Promise.race([wait, new Promise((r) => setTimeout(r, 8000))]);
  const terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  let rows = st.list;
  if (cat && cat !== 'All') rows = rows.filter((x) => x.cat === cat);
  if (terms.length) {
    rows = rows.map((x) => { const t = (x.title + ' ' + x.id + ' ' + x.host).toLowerCase(), d = x.description.toLowerCase(); let s = 0; for (const w of terms) { if (t.indexOf(w) >= 0) s += 3; else if (d.indexOf(w) >= 0) s += 1; else return null; } return [s, x]; })
      .filter(Boolean).sort((a, b) => b[0] - a[0] || a[1].title.localeCompare(b[1].title)).map((p) => p[1]);
  }
  const cats = {}; for (const x of st.list) cats[x.cat] = (cats[x.cat] || 0) + 1;
  offset = Math.max(0, Number(offset) || 0); limit = Math.min(100, Math.max(1, Number(limit) || 40));
  return { items: rows.slice(offset, offset + limit), total: st.list.length, count: rows.length, offset, cats, updated: st.updated, loading: !!st.loading, error: st.error };
}
function byUrl(url) { return st.byUrl.get(String(url || '')) || null; }

/* ---------- logos ----------
   Fetched by the server, not the viewer's browser: the publisher's own
   icon, else its site's favicon, else the server's. Kept in memory a day
   (misses too), at most 250 KB each, images only. Served from here with
   no script able to run, whatever the file is. */
const ICON_MAX = 250 * 1024, ICON_KEEP = 800, ICON_TTL = 24 * 3600 * 1000;
const icons = new Map();
/* the stand-in: about half the made-up servers have a logo */
function fakeHasIcon(id) { let n = 0; for (const c of String(id)) n += c.charCodeAt(0); return n % 2 === 0; }
async function grab(u) {
  if (!/^https:\/\//i.test(u)) return null;
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 6000);
  try {
    const r = await fetch(u, { signal: ac.signal, redirect: 'follow', headers: { accept: 'image/*' } });
    const type = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!r.ok || !/^image\/(png|jpeg|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon|avif)$/.test(type)) return null;
    const len = Number(r.headers.get('content-length') || 0); if (len > ICON_MAX) return null;
    const buf = Buffer.from(await r.arrayBuffer()); if (!buf.length || buf.length > ICON_MAX) return null;
    return { type, buf };
  } catch (e) { return null; } finally { clearTimeout(t); }
}
async function iconFor(id) {
  const x = st.list.find((i) => i.id === id); if (!x) return null;
  const have = icons.get(id); if (have && Date.now() - have.at < ICON_TTL) return have.img;
  let img = null;
  if (FAKE) img = fakeHasIcon(id) ? { type: 'image/svg+xml', buf: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#7fd8ff"/></svg>') } : null;
  else {
    const tries = [x.icon];
    try { if (x.website) tries.push(new URL(x.website).origin + '/favicon.ico'); } catch (e) {}
    tries.push('https://' + x.host + '/favicon.ico');
    for (const u of tries) { if (u && (img = await grab(u))) break; }
  }
  icons.set(id, { at: Date.now(), img }); while (icons.size > ICON_KEEP) icons.delete(icons.keys().next().value);
  return img;
}

async function handle(p, req, res, ctx) {
  if (p === '/api/team/plugins/icon' && req.method === 'GET') {
    const q0 = ctx.query || new URL(req.url, 'http://x').searchParams;
    const img = await iconFor(String(q0.get('id') || ''));
    if (!img) { res.writeHead(404, { 'Cache-Control': 'private, max-age=86400' }); res.end(); return true; }
    res.writeHead(200, { 'Content-Type': img.type, 'Content-Length': img.buf.length, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" });
    res.end(img.buf); return true;
  }
  if (p !== '/api/team/plugins/catalog' || req.method !== 'GET') return false;
  const q = ctx.query || new URL(req.url, 'http://x').searchParams;
  ctx.json(res, 200, Object.assign({ ok: true, source: 'The official MCP Registry (registry.modelcontextprotocol.io)' }, await search(q.get('q'), q.get('cat'), q.get('offset'), q.get('limit'))));
  return true;
}

module.exports = { fakeHasIcon, handle, search, byUrl, ensure, shape, catOf, CATS: CATS.map((c) => c[0]).concat('Other'), _st: st };
