/* Sales reports, reviewed by the Finance assistant.
 *
 * ABKO's sales export (TigerLogo "Cari Hesaplara Göre Satış Dağılımı": one
 * block per customer, a line per product with quantity, amount, date, rep and
 * campaign code, a subtotal under each block) arrives as .xlsx or CSV — from
 * the Finance assistant's room in the command centre, or sent to J.A.R.V.I.S.
 * on Telegram. Nothing here is a guess by a model: the numbers are counted in
 * code first (totals, by rep, by campaign, by customer, prices that differ
 * between customers, free-of-charge lines, subtotals that do not add up,
 * repeated lines, missing dates), and that reading becomes the brief. The
 * Finance assistant then reviews it — campaign terms against what was given,
 * discounts, rep and customer patterns, data quality — and reports findings
 * with actions. Nothing goes out from here.
 *
 * GET  /api/team/sales          → { reports }
 * POST /api/team/sales {name, data (base64 .xlsx/.csv) | text, note} → { report, task }
 */
const crypto = require('crypto');

const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const newId = () => crypto.randomBytes(5).toString('hex');
const KEEP = 24, MAX_BYTES = 8 * 1024 * 1024;

const num = (v) => {
  let s = String(v == null ? '' : v).trim();
  if (!s) return NaN;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');   /* 1.234,56 */
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  return Number(s);
};
const money = (n) => (Math.round(n * 100) / 100).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const low = (s) => String(s || '').toLocaleLowerCase('tr');

/* ---------- reading the export ------------------------------------------- */
function split(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const tab = lines.slice(0, 20).some((l) => l.indexOf('\t') >= 0);
  return lines.map((l) => (tab ? l.split('\t') : splitCsv(l)));
}
function splitCsv(line) {
  const out = []; let cur = '', q = false;
  const sep = (line.match(/;/g) || []).length > (line.match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === sep) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}

/* Column positions from the header labels, in Turkish or English. */
function columns(rows) {
  const want = {
    code: /malzeme.*kod|ürün kodu|stok kodu|item code|product code|^kod$/,
    product: /açıklama|ürün adı|malzeme adı|description|product/,
    qty: /miktar|adet|quantity|qty/,
    amount: /tutar|amount|total|toplam/,
    date: /tarih|date/,
    rep: /temsilci|satış temsilcisi|rep|salesperson/,
    campaign: /kampanya|campaign/,
    account: /cari hesap kodu|müşteri kodu|customer code/,
    customer: /cari hesap unvan|müşteri adı|customer name|^customer$/
  };
  const col = {};
  for (const r of rows.slice(0, 12)) {
    r.forEach((cell, i) => {
      const c = low(cell).trim(); if (!c || /:/.test(c)) return;   /* "Cari Hesap Unvanı : X" is a block heading, not a header */
      for (const k of Object.keys(want)) if (col[k] == null && want[k].test(c)) {
        if (k === 'product' && /kod/.test(c)) continue;
        if (k === 'amount' && /miktar/.test(c)) continue;
        if (k === 'customer' && /kod/.test(c)) continue;
        col[k] = i; break;
      }
    });
  }
  if (col.campaign != null && col.campaignText == null) col.campaignText = col.campaign + 1;
  /* a merged header cell: the label sits one column left of its values */
  if (col.code != null) {
    const data = rows.filter((r) => isFinite(num(r[col.qty])) && String(r[col.product] || '').trim()).slice(0, 50);
    const here = data.filter((r) => String(r[col.code] || '').trim()).length, next = data.filter((r) => String(r[col.code + 1] || '').trim()).length;
    if (here < data.length / 2 && next > data.length / 2 && col.code + 1 !== col.account && col.code + 1 !== col.product) col.code = col.code + 1;
  }
  return col;
}

function parse(text) {
  const rows = split(text);
  const col = columns(rows);
  if (col.qty == null || col.amount == null || col.product == null) return { error: 'This does not look like a sales report: no quantity, amount and product columns were found.' };
  const lines = [], subtotals = [];
  let customer = '', blockSum = 0, blockLines = 0;
  for (const r of rows) {
    const joined = r.join(' ');
    const head = joined.match(/Cari Hesap Unvan[ıi]\s*:\s*(.+?)(?:\s{2,}|\t|TAR[İI]H|$)/i);
    if (head) { customer = str(head[1], 160); blockSum = 0; blockLines = 0; continue; }
    const qty = num(r[col.qty]), amount = num(r[col.amount]);
    const product = str(r[col.product], 160);
    if (!product && isFinite(amount) && r.filter((x) => String(x || '').trim()).length === 1) {
      if (customer && blockLines) subtotals.push({ customer, stated: amount, counted: Math.round(blockSum * 100) / 100 });
      continue;
    }
    if (!product || !isFinite(qty) || !isFinite(amount)) continue;
    if (/^satış miktarı$|^quantity$/i.test(String(r[col.qty]).trim())) continue;
    const ln = {
      customer: col.customer != null && str(r[col.customer], 160) ? str(r[col.customer], 160) : customer,
      account: col.account != null ? str(r[col.account], 40) : '',
      code: col.code != null ? str(r[col.code], 40) : '',
      product, qty, amount,
      date: col.date != null ? str(r[col.date], 20) : '',
      rep: col.rep != null ? str(r[col.rep], 60) : '',
      campaign: col.campaign != null ? str(r[col.campaign], 40) : '',
      campaignText: col.campaignText != null ? str(r[col.campaignText], 200) : ''
    };
    /* TigerLogo swaps the two code columns between blocks: an account looks like "0014 EK33" */
    const ACC = /^\d{3,5} [A-ZÇĞİÖŞÜ]{2}\d{2,3}$/;
    if (ACC.test(ln.code) && !ACC.test(ln.account)) { const t = ln.code; ln.code = ln.account; ln.account = t; }
    lines.push(ln); blockSum += amount; blockLines++;
  }
  if (!lines.length) return { error: 'No sales lines were found in that file.' };
  return { lines, subtotals };
}

/* ---------- counting --------------------------------------------------------- */
function analyze(p) {
  const L = p.lines;
  const group = (key) => { const m = new Map(); for (const l of L) { const k = key(l) || '—'; const g = m.get(k) || { key: k, amount: 0, qty: 0, lines: 0, customers: new Set(), reps: new Set() }; g.amount += l.amount; g.qty += l.qty; g.lines++; g.customers.add(l.customer); g.reps.add(l.rep); m.set(k, g); } return [...m.values()].sort((a, b) => b.amount - a.amount); };
  const total = L.reduce((s, l) => s + l.amount, 0);
  const dates = L.map((l) => l.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const byRep = group((l) => l.rep), byCampaign = group((l) => l.campaign), byCustomer = group((l) => l.customer), byMonth = group((l) => (/^\d{4}-\d{2}/.test(l.date) ? l.date.slice(0, 7) : 'no date'));
  const campText = new Map(); for (const l of L) if (l.campaign && l.campaignText && !campText.has(l.campaign)) campText.set(l.campaign, l.campaignText);
  /* the same product sold at different unit prices */
  const prices = new Map();
  for (const l of L) { if (!l.code || l.qty <= 0) continue; const u = l.amount / l.qty; if (u < 2) continue; const g = prices.get(l.code) || { code: l.code, product: l.product, units: [] }; g.units.push({ u, customer: l.customer, campaign: l.campaign, rep: l.rep, qty: l.qty }); prices.set(l.code, g); }
  const spread = [...prices.values()].map((g) => { const us = g.units.map((x) => x.u); const lo = Math.min(...us), hi = Math.max(...us); return Object.assign(g, { lo, hi, gap: hi > 0 ? (hi - lo) / hi : 0 }); })
    .filter((g) => g.units.length > 1 && g.gap >= 0.1).sort((a, b) => b.gap * b.hi - a.gap * a.hi);
  const free = L.filter((l) => l.qty > 0 && l.amount / l.qty < 2);
  const fc = new Map(); for (const l of free) { const k = l.campaign || 'KAMPANYASIZ'; const g = fc.get(k) || { key: k, qty: 0, lines: 0, customers: new Set() }; g.qty += l.qty; g.lines++; g.customers.add(l.customer); fc.set(k, g); }
  const priceDiff = L.filter((l) => /fiyat farkı|fiyat farki|price difference/.test(low(l.product)));
  const noDate = L.filter((l) => !/^\d{4}-\d{2}-\d{2}$/.test(l.date));
  const noRep = L.filter((l) => !l.rep);
  const seen = new Map(); const dup = [];
  for (const l of L) { const k = [l.customer, l.code, l.date, l.qty, l.amount].join('|'); if (seen.has(k)) dup.push(l); else seen.set(k, 1); }
  const badSub = p.subtotals.filter((s) => Math.abs(s.stated - s.counted) > 1);
  return {
    lines: L.length, total, qty: L.reduce((s, l) => s + l.qty, 0), customers: byCustomer.length, reps: byRep.length,
    from: dates[0] || '', to: dates[dates.length - 1] || '',
    byRep: byRep.map((g) => ({ rep: g.key, amount: g.amount, lines: g.lines, customers: g.customers.size })),
    byCampaign: byCampaign.map((g) => ({ code: g.key, text: campText.get(g.key) || '', amount: g.amount, qty: g.qty, lines: g.lines, customers: g.customers.size })),
    byCustomer: byCustomer.map((g) => ({ customer: g.key, amount: g.amount, lines: g.lines, reps: [...g.reps].filter(Boolean) })),
    byMonth: byMonth.map((g) => ({ month: g.key, amount: g.amount, lines: g.lines })).sort((a, b) => a.month.localeCompare(b.month)),
    spread: spread.slice(0, 15).map((g) => ({ code: g.code, product: g.product, lo: g.lo, hi: g.hi, gap: g.gap, sales: g.units.length, cheapest: g.units.reduce((a, b) => (b.u < a.u ? b : a)) })),
    free: { lines: free.length, qty: free.reduce((s, l) => s + l.qty, 0), byCampaign: [...fc.values()].map((g) => ({ code: g.key, qty: g.qty, lines: g.lines, customers: g.customers.size })).sort((a, b) => b.qty - a.qty) },
    priceDiff: { lines: priceDiff.length, amount: priceDiff.reduce((s, l) => s + l.amount, 0), customers: [...new Set(priceDiff.map((l) => l.customer))].slice(0, 10) },
    noDate: { lines: noDate.length, amount: noDate.reduce((s, l) => s + l.amount, 0) },
    noRep: noRep.length,
    duplicates: dup.slice(0, 10).map((l) => ({ customer: l.customer, product: l.product, date: l.date, qty: l.qty, amount: l.amount })), dupCount: dup.length,
    subtotalOff: badSub.slice(0, 10), subtotalChecked: p.subtotals.length
  };
}

/* ---------- the brief ---------------------------------------------------------- */
function brief(a, name, note) {
  const pct = (x) => Math.round(x * 100) + '%';
  const top = (arr, n, f) => arr.slice(0, n).map(f).join('\n');
  return [
    'Satış raporunu incele: "' + name + '"' + (note ? ' — not: ' + note : '') + '.',
    'Kapsam: ' + a.lines + ' satır, ' + a.customers + ' müşteri, ' + a.reps + ' temsilci, ' + (a.from ? a.from + ' → ' + a.to : 'tarih yok') + '. Toplam satış tutarı ' + money(a.total) + ' TL, ' + money(a.qty) + ' adet. (Tutarlar raporda yazdığı gibidir; KDV dahil/hariç olduğu rapordan anlaşılmıyor — bunu belirt.)',
    '',
    'TEMSİLCİYE GÖRE:', top(a.byRep, 10, (g) => '- ' + g.rep + ': ' + money(g.amount) + ' TL, ' + g.lines + ' satır, ' + g.customers + ' müşteri'),
    '', 'AYLARA GÖRE:', top(a.byMonth, 12, (g) => '- ' + g.month + ': ' + money(g.amount) + ' TL (' + g.lines + ' satır)'),
    '', 'KAMPANYAYA GÖRE (kod — koşul — tutar, adet, müşteri):', top(a.byCampaign, 15, (g) => '- ' + g.code + (g.text ? ' — "' + g.text + '"' : '') + ' — ' + money(g.amount) + ' TL, ' + money(g.qty) + ' adet, ' + g.customers + ' müşteri'),
    '', 'EN BÜYÜK MÜŞTERİLER:', top(a.byCustomer, 12, (g) => '- ' + g.customer + ': ' + money(g.amount) + ' TL, ' + g.lines + ' satır' + (g.reps.length ? ' (' + g.reps.join(', ') + ')' : '')),
    '', 'BEDELSİZ / SEMBOLİK FİYATLI SATIRLAR (birim fiyat < 2 TL): ' + a.free.lines + ' satır, ' + money(a.free.qty) + ' adet.', top(a.free.byCampaign, 10, (g) => '- ' + g.code + ': ' + money(g.qty) + ' adet, ' + g.lines + ' satır, ' + g.customers + ' müşteri'),
    '', 'AYNI ÜRÜN, FARKLI BİRİM FİYAT (fark ≥ %10):', a.spread.length ? top(a.spread, 12, (g) => '- ' + g.code + ' ' + g.product + ': ' + money(g.lo) + '–' + money(g.hi) + ' TL/adet (fark ' + pct(g.gap) + ', ' + g.sales + ' satış); en ucuz: ' + g.cheapest.customer + (g.cheapest.campaign ? ' [' + g.cheapest.campaign + ']' : '') + (g.cheapest.rep ? ', ' + g.cheapest.rep : '')) : '- yok',
    '', 'VERİ KALİTESİ:',
    '- "Fiyat farkı" satırları: ' + a.priceDiff.lines + ' satır, ' + money(a.priceDiff.amount) + ' TL' + (a.priceDiff.customers.length ? ' (' + a.priceDiff.customers.join(', ') + ')' : ''),
    '- Tarihi olmayan satırlar: ' + a.noDate.lines + ' (' + money(a.noDate.amount) + ' TL); temsilcisi olmayan: ' + a.noRep,
    '- Tekrarlanan satır (aynı müşteri, ürün, tarih, adet, tutar): ' + a.dupCount + (a.duplicates.length ? '\n' + a.duplicates.slice(0, 5).map((d) => '  · ' + d.customer + ' — ' + d.product + ' ' + d.date + ' ' + d.qty + ' adet ' + money(d.amount) + ' TL').join('\n') : ''),
    '- Ara toplam kontrolü: ' + a.subtotalChecked + ' müşteri bloğu; tutmayan ' + a.subtotalOff.length + (a.subtotalOff.length ? '\n' + a.subtotalOff.map((s) => '  · ' + s.customer + ': raporda ' + money(s.stated) + ', satırların toplamı ' + money(s.counted)).join('\n') : ''),
    '',
    'YAPILACAK: Bir finans uzmanı gibi incele ve Türkçe raporla. 1) Kampanya uyumu: her kampanyanın koşulu ("60 adet alana 120 bedelsiz" gibi) ile verilen bedelsiz adetler ve müşteri alımları tutarlı mı; koşulu karşılamadan bedelsiz alan var mı. 2) İskonto ve fiyat: aynı ürünün farklı fiyatla satıldığı yerler, gerekçesi kampanya mı, yoksa kontrolsüz iskonto mu. 3) Temsilci ve müşteri dağılımı: yoğunlaşma riski, kampanyasız satış payı, dikkat çeken temsilci. 4) Veri kalitesi: tarihsiz, tekrarlanan, "fiyat farkı" ve tutmayan ara toplamlar. 5) Sonuç: en önemli 5 bulgu (rakamlarla) ve her biri için somut bir aksiyon (kim, ne yapmalı). Yukarıdaki sayıları kullan; rapor dışında bir şey uydurma; emin olmadığın yeri soru olarak yaz. Hiçbir şey dışarı gönderme.'
  ].join('\n');
}

/* ---------- storing and starting the review ------------------------------------ */
async function reports(ctx) { const v = await ctx.get('team:sales'); return Array.isArray(v) ? v : []; }
function financeAgent(list) {
  const live = list.filter((a) => !a.archived);
  return live.find((a) => a.id === 'finance') || live.find((a) => /financ|finans|muhasebe|account/i.test(a.role + ' ' + a.name)) || null;
}

async function ingest(ctx, deps, uid, input) {
  const name = str(input.name || 'Sales report', 120);
  let text = '';
  if (input.text) text = String(input.text);
  else if (input.data) {
    const buf = Buffer.isBuffer(input.data) ? input.data : Buffer.from(String(input.data), 'base64');
    if (!buf.length) return { error: 'The file was empty.', status: 400 };
    if (buf.length > MAX_BYTES) return { error: 'That file is larger than 8 MB.', status: 413 };
    if (buf[0] === 0x50 && buf[1] === 0x4b) { try { text = deps.xlsxToText(buf); } catch (e) { return { error: 'That spreadsheet could not be opened. Save it again as .xlsx or CSV.', status: 400 }; } }
    else if (buf[0] === 0xd0 && buf[1] === 0xcf) return { error: 'That is an old-style .xls file. Open it and save it as .xlsx, then send it again.', status: 400 };
    else text = deps.decodeText ? deps.decodeText(buf) : buf.toString('utf8');
  }
  if (!text.trim()) return { error: 'Send the report as .xlsx or CSV.', status: 400 };
  const p = parse(text);
  if (p.error) return { error: p.error, status: 400 };
  const a = analyze(p);
  const agent = financeAgent(await deps.agents(ctx));
  const rec = { id: 'sr' + newId(), name, at: Date.now(), via: str(input.via || 'app', 20), note: str(input.note, 300), lines: a.lines, total: a.total, customers: a.customers, reps: a.reps, from: a.from, to: a.to, task: '', agent: agent ? agent.id : '', analysis: a };
  let task = null;
  if (agent && !((await ctx.get('team:paused')) === true)) {
    const title = 'Satış raporu incelemesi: ' + str(name, 60);
    try { task = await deps.newTask(ctx, uid, { title, brief: brief(a, name, rec.note), agent: agent.id, by: 'jarvis', lang: 'tr', steps: [{ agent: agent.id, title, brief: brief(a, name, rec.note) }], via: 'sales', from: { sales: rec.id, title: name } }); rec.task = task.id; }
    catch (e) { rec.error = str(e.message, 200); }
  }
  const list = (await reports(ctx)).concat([rec]).slice(-KEEP);
  await ctx.set('team:sales', list);
  if (deps.log) await deps.log(ctx, agent ? agent.id : 'jarvis', 'Sales report "' + name + '": ' + a.lines + ' lines, ' + money(a.total) + ' TL' + (task ? ' — review started' : agent ? '' : ' — no Finance assistant on the team'));
  const say = agent
    ? (task ? agent.name + ' is reviewing "' + name + '": ' + a.lines + ' lines, ' + a.customers + ' customers, ' + money(a.total) + ' TL' + (a.from ? ' (' + a.from + ' → ' + a.to + ')' : '') + '. You will hear when it is ready.' : 'Read "' + name + '", but the review could not start' + (rec.error ? ': ' + rec.error : ' (the team is paused).'))
    : 'Read "' + name + '" (' + a.lines + ' lines), but there is no Finance assistant on the team to review it. Add one under Add agent.';
  return { ok: true, report: Object.assign({}, rec, { analysis: undefined }), task: task ? { id: task.id, title: task.title, agent: task.agent } : null, say, sayTr: agent && task ? agent.name + ' "' + name + '" raporunu inceliyor: ' + a.lines + ' satır, ' + a.customers + ' müşteri, ' + money(a.total) + ' TL. Hazır olunca haber veririm.' : say };
}

async function view(ctx, deps) {
  const tl = await deps.tasks(ctx); const byId = new Map(tl.map((t) => [t.id, t]));
  return (await reports(ctx)).slice().reverse().map((r) => { const t = byId.get(r.task); return { id: r.id, name: r.name, at: r.at, via: r.via, lines: r.lines, total: r.total, customers: r.customers, from: r.from, to: r.to, task: r.task, status: t ? t.status : (r.task ? 'gone' : 'none'), result: t ? str(t.result, 1200) : '', error: r.error || '' }; });
}

async function handle(p, req, res, ctx, deps) {
  if (p !== '/api/team/sales') return false;
  const json = ctx.json;
  if (req.method === 'GET') { json(res, 200, { ok: true, reports: await view(ctx, deps) }); return true; }
  if (req.method !== 'POST') { json(res, 405, { error: 'GET or POST.' }); return true; }
  let b = {}; try { b = JSON.parse(await ctx.readBody(req)) || {}; } catch (e) { json(res, 400, { error: 'Unreadable request.' }); return true; }
  const r = await ingest(ctx, deps, ctx.user && ctx.user.id, { name: b.name, data: b.data, text: b.text, note: b.note, via: 'app' });
  if (r.error) { json(res, r.status || 400, r); return true; }
  json(res, 200, Object.assign(r, { reports: await view(ctx, deps) })); return true;
}

module.exports = { handle, ingest, view, parse, analyze, brief, financeAgent, MAX_BYTES };
