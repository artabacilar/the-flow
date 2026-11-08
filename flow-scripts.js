/* =========================================================================
 * flow-scripts.js — automations: routine work done by a script, not a model
 *
 * A script is a pipeline of vetted operations saved in the account's store
 * (team:scripts). It is not code the model writes and the server runs: each
 * step is one of the operations below, with configurable values, so a run
 * applies the same rules every time and nothing can reach outside the
 * operations' bounds. The model is used only where the brief says judgment
 * is needed — an explicit "jarvis.review" step hands exceptions to an agent
 * as a task — and never to launch a job or word a notification that a
 * fixed template covers.
 *
 *   sources     flow.rocks · flow.expenses · flow.habits · team.tasks ·
 *               team.usage · web.read
 *   transforms  filter · sort · limit · select · compute (count/sum/avg/
 *               min/max per field, grouped) · format (a line per item from
 *               a template) · compare (against the previous run's snapshot)
 *   actions     report (the run's output text) · notify (a fixed template
 *               to the linked channels and push) · record.update (rocks,
 *               by rule, with done-tracking) · email.batch (templated
 *               messages to a list — shown for review and sent only after
 *               the person's yes, once per recipient)
 *   judgment    jarvis.review (items matching a condition become a task
 *               for an agent; the only step that costs a model call)
 *
 * Values are configurable inputs ({{inputs.x}}), typed and validated before
 * a run starts; a missing or wrong input stops the run with the reason.
 * Runs (team:scriptruns) are saved after every step: a restart resumes at
 * the next step; a step marked done never runs twice; each sent message is
 * keyed, so a resumed batch skips what already went, and a send whose
 * outcome is unknown is reported as uncertain rather than re-attempted.
 * Every run records trigger, timezone, version, inputs, per-step counts and
 * timings, model calls, failures, and a cost line that separates estimated
 * AI usage from hosting (included) and external services (counted).
 *
 * Triggers: manual (Run now), a schedule in the person's own timezone
 * (daily/weekdays/weekly at HH:MM — the same minute tick as the briefing),
 * or an event (a task done, an approval executed, the briefing sent).
 * Pause, disable, archive. A version is marked tested when a dry run
 * passed; a schedule on an untested version is allowed but flagged.
 * Creating or scheduling a script authorises nothing outside: email.batch
 * waits for a yes; record.update only touches the person's own rocks.
 * ====================================================================== */
'use strict';

const crypto = require('crypto');
const str = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const block = (v, n) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, n);
const newId = () => crypto.randomBytes(5).toString('hex');
const MAX_SCRIPTS = 100, MAX_RUNS = 300, MAX_ITEMS = 2000;
const STATUSES = ['active', 'paused', 'disabled', 'archived'];
const INPUT_TYPES = ['text', 'number', 'date', 'url', 'email', 'list', 'choice'];

let mcpInternals = null;
function cal() { if (mcpInternals === null) { try { mcpInternals = require('./flow-mcp')._internals; } catch (e) { mcpInternals = false; } } return mcpInternals || null; }
const localISO = (d) => { const c = cal(); return c ? c.localISO(d) : d.toISOString().slice(0, 10); };
const weekId = (d) => { const c = cal(); if (c) return c.weekId(d); const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return t.getUTCFullYear() + '-W' + String(Math.ceil(((t - y0) / 86400000 + 1) / 7)).padStart(2, '0'); };
const shiftWeek = (wid, n) => { const m = /^(\d{4})-W(\d{2})$/.exec(wid); if (!m) return wid; const y = +m[1], w = +m[2]; const jan4 = new Date(Date.UTC(y, 0, 4)); const mon = new Date(jan4); mon.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7) + (w - 1 + n) * 7); return weekId(new Date(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate())); };

/* ---------- templates and values ------------------------------------------ */
function get(obj, path) { return String(path || '').split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function fmtVal(v) { if (v == null) return ''; if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100); if (Array.isArray(v)) return v.map(fmtVal).join(', '); if (typeof v === 'object') return JSON.stringify(v); return String(v); }
function render(tpl, scope) { return String(tpl == null ? '' : tpl).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, p) => fmtVal(get(scope, p))); }
function num(v) {
  if (typeof v === 'number') return v;
  let m = String(v == null ? '' : v).replace(/[^\d.,-]/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(m)) m = m.replace(/\./g, '').replace(',', '.');        /* 1.250,50 */
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(m)) m = m.replace(/,/g, '');                     /* 1,250.50 */
  else m = m.replace(',', '.');                                                                   /* 12,5 */
  const n = parseFloat(m); return Number.isFinite(n) ? n : NaN;
}
function cmp(a, op, b) {
  const na = num(a), nb = num(b); const bothNum = !isNaN(na) && !isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '';
  const sa = String(a == null ? '' : a).toLowerCase(), sb = String(b == null ? '' : b).toLowerCase();
  switch (op) {
    case '=': case '==': case 'is': return bothNum ? na === nb : sa === sb;
    case '!=': case 'not': return bothNum ? na !== nb : sa !== sb;
    case '>': return bothNum && na > nb; case '>=': return bothNum && na >= nb;
    case '<': return bothNum && na < nb; case '<=': return bothNum && na <= nb;
    case 'contains': return sa.indexOf(sb) >= 0; case 'missing': case 'empty': return a == null || String(a).trim() === '';
    case 'present': return !(a == null || String(a).trim() === ''); case 'matches': try { return new RegExp(String(b), 'i').test(String(a == null ? '' : a)); } catch (e) { return false; }
    default: return false;
  }
}
const COND_OPS = ['=', '!=', '>', '>=', '<', '<=', 'contains', 'missing', 'present', 'matches'];
function cond(c, scope) { if (!c || !c.field) return true; return cmp(get(scope, 'item.' + c.field) !== undefined ? get(scope, 'item.' + c.field) : get(scope.item || {}, c.field), c.op || '=', render(c.value, scope)); }

/* ---------- inputs ------------------------------------------------------- */
function validateInputs(defs, given) {
  const out = {}, errors = [];
  for (const d of defs || []) {
    let v = given && given[d.name] !== undefined && given[d.name] !== '' ? given[d.name] : d.default;
    if (v === undefined || v === null || v === '') { if (d.required !== false) errors.push('"' + d.name + '" is missing' + (d.label ? ' (' + d.label + ')' : '')); continue; }
    switch (d.type) {
      case 'number': { const n = num(v); if (isNaN(n)) errors.push('"' + d.name + '" must be a number, not "' + str(v, 40) + '"'); else v = n; break; }
      case 'date': { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !/^(today|yesterday|this week|last week)$/i.test(String(v))) errors.push('"' + d.name + '" must be a date (YYYY-MM-DD) or today / yesterday / this week / last week'); break; }
      case 'url': { if (!/^https?:\/\/\S+$/i.test(String(v))) errors.push('"' + d.name + '" must be a web address starting with http(s)://'); break; }
      case 'email': { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) errors.push('"' + d.name + '" must be an email address'); break; }
      case 'list': { v = Array.isArray(v) ? v : String(v).split(/\n|,|;/).map((x) => x.trim()).filter(Boolean); if (!v.length) errors.push('"' + d.name + '" needs at least one entry'); break; }
      case 'choice': { const ch = Array.isArray(d.choices) ? d.choices : []; if (ch.length && ch.indexOf(String(v)) < 0) errors.push('"' + d.name + '" must be one of ' + ch.join(', ')); break; }
      default: v = block(v, 2000);
    }
    out[d.name] = v;
  }
  return { inputs: out, errors };
}
function cleanInputDef(d) { return d && typeof d === 'object' && str(d.name, 40) ? { name: str(d.name, 40).replace(/[^\w]/g, '_'), label: str(d.label, 80), type: INPUT_TYPES.indexOf(d.type) >= 0 ? d.type : 'text', default: d.default === undefined ? '' : (Array.isArray(d.default) ? d.default.map((x) => str(x, 200)) : block(d.default, 2000)), required: d.required !== false, choices: Array.isArray(d.choices) ? d.choices.map((x) => str(x, 60)).filter(Boolean).slice(0, 20) : undefined, help: str(d.help, 200) } : null; }

/* ---------- the operations ------------------------------------------------- *
 * Each: { kind, label, params (for the editor), run(ctx, deps, step, pipe) }
 * where pipe = { items, data, inputs, run, dry }. run() returns
 * { items?, text?, note, count?, external?, modelCalls?, stop?, await? }. */
function periodRange(p, now) {
  const d = new Date(now); const iso = localISO(d);
  if (p === 'today') return { from: iso, to: iso, week: weekId(d) };
  if (p === 'yesterday') { const y = new Date(d); y.setDate(d.getDate() - 1); const yi = localISO(y); return { from: yi, to: yi, week: weekId(y) }; }
  if (p === 'last week') { const w = shiftWeek(weekId(d), -1); return { week: w }; }
  if (p === 'last 7 days') { const y = new Date(d); y.setDate(d.getDate() - 6); return { from: localISO(y), to: iso }; }
  if (p === 'last 30 days') { const y = new Date(d); y.setDate(d.getDate() - 29); return { from: localISO(y), to: iso }; }
  if (p === 'this month') return { from: iso.slice(0, 8) + '01', to: iso };
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(p))) return { from: p, to: p };
  return { week: weekId(d) };  /* this week */
}
const PERIODS = ['this week', 'last week', 'today', 'yesterday', 'last 7 days', 'last 30 days', 'this month'];
const OPS = {
  'flow.rocks': { kind: 'source', label: 'Read the week\'s rocks', params: [{ name: 'period', type: 'choice', choices: ['this week', 'last week'], default: 'this week' }, { name: 'only', type: 'choice', choices: ['all', 'open', 'done'], default: 'all' }],
    async run(ctx, deps, st, pipe) {
      const c = (await ctx.get('ld_compass')) || {}; const r = periodRange(render(st.period, pipe.scope) || 'this week', pipe.now);
      const wid = r.week || weekId(new Date(pipe.now)); const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      let items = ((c.rocks || {})[wid] || []).map((x) => ({ id: x.id, title: x.title, day: DAY[x.day] || '', dayIndex: x.day, time: x.time || '', prio: x.prio || 'med', role: x.role || '', note: x.note || '', done: !!x.done, week: wid }));
      const only = render(st.only, pipe.scope); if (only === 'open') items = items.filter((x) => !x.done); if (only === 'done') items = items.filter((x) => x.done);
      return { items, note: items.length + ' rock' + (items.length === 1 ? '' : 's') + ' in ' + wid };
    } },
  'flow.expenses': { kind: 'source', label: 'Read expenses', params: [{ name: 'period', type: 'choice', choices: PERIODS, default: 'this month' }],
    async run(ctx, deps, st, pipe) {
      const list = (await ctx.get('flow:expenses')) || []; const r = periodRange(render(st.period, pipe.scope) || 'this month', pipe.now);
      let items = (Array.isArray(list) ? list : []).map((x) => ({ date: x.date, amount: num(x.amount), currency: x.currency || '', merchant: x.merchant || '', category: x.category || '', note: x.note || '' }));
      if (r.from) items = items.filter((x) => x.date >= r.from && x.date <= r.to); else if (r.week) items = items.filter((x) => x.date && weekId(new Date(x.date + 'T12:00:00')) === r.week);
      return { items, note: items.length + ' expense' + (items.length === 1 ? '' : 's') };
    } },
  'flow.habits': { kind: 'source', label: 'Read habits and streaks', params: [],
    async run(ctx, deps, st, pipe) {
      const hb = (await ctx.get('ld_habits')) || { habits: [], completions: {} }; const d = new Date(pipe.now); const today = localISO(d);
      const items = (hb.habits || []).map((h) => { let n = 0; const x = new Date(d); if (!(hb.completions[h.id] && hb.completions[h.id][today])) x.setDate(d.getDate() - 1); for (;;) { if (hb.completions[h.id] && hb.completions[h.id][localISO(x)]) { n++; x.setDate(x.getDate() - 1); } else break; } return { id: h.id, name: h.name, streak: n, doneToday: !!(hb.completions[h.id] && hb.completions[h.id][today]) }; });
      return { items, note: items.length + ' habit' + (items.length === 1 ? '' : 's') };
    } },
  'team.tasks': { kind: 'source', label: 'Read the team\'s tasks', params: [{ name: 'status', type: 'choice', choices: ['all', 'done', 'open', 'failed', 'awaiting'], default: 'all' }, { name: 'period', type: 'choice', choices: ['last 7 days', 'last 30 days', 'today', 'this week'], default: 'last 7 days' }],
    async run(ctx, deps, st, pipe) {
      const tl = deps.tasks ? await deps.tasks(ctx) : []; const r = periodRange(render(st.period, pipe.scope) || 'last 7 days', pipe.now); const from = r.from ? new Date(r.from + 'T00:00:00').getTime() : 0;
      const want = render(st.status, pipe.scope) || 'all';
      let items = tl.filter((t) => (t.updatedAt || t.createdAt || 0) >= from).map((t) => ({ id: t.id, title: t.title, agent: t.agent, status: t.status, steps: (t.steps || []).length, createdAt: t.createdAt, doneAt: t.doneAt || 0, skill: (t.steps || []).map((s) => s.skill && s.skill.name).filter(Boolean).join(', ') }));
      if (want === 'done') items = items.filter((t) => t.status === 'done'); if (want === 'open') items = items.filter((t) => /^(queued|running)$/.test(t.status)); if (want === 'failed') items = items.filter((t) => t.status === 'failed'); if (want === 'awaiting') items = items.filter((t) => /^awaiting/.test(t.status));
      return { items, note: items.length + ' task' + (items.length === 1 ? '' : 's') };
    } },
  'team.usage': { kind: 'source', label: 'Read this month\'s AI usage per agent', params: [],
    async run(ctx, deps, st, pipe) {
      const u = deps.monthUsage ? await deps.monthUsage(ctx) : {}; const agents = deps.agents ? await deps.agents(ctx) : [];
      const items = Object.keys(u).filter((k) => k !== 'total').map((k) => ({ agent: k, name: (agents.find((a) => a.id === k) || {}).name || k, calls: u[k].calls || 0, tokens: (u[k].in || 0) + (u[k].out || 0), usd: Math.round((u[k].usd || 0) * 100) / 100 }));
      return { items, note: items.length + ' agent' + (items.length === 1 ? '' : 's') + ' used the model' };
    } },
  'web.read': { kind: 'source', label: 'Read a public web page', params: [{ name: 'url', type: 'url' }, { name: 'pattern', type: 'text', help: 'optional regular expression; each match becomes an item with "match" and "groups"' }],
    async run(ctx, deps, st, pipe) {
      const url = render(st.url, pipe.scope); if (!/^https?:\/\//i.test(url)) throw new Error('web.read: no valid address (' + str(url, 60) + ')');
      if (!deps.read) throw new Error('web.read: the reader is not available here');
      let last = null, page = null;
      for (let i = 0; i < 3 && !page; i++) { try { page = await deps.read(url); if (page && page.error) { last = page.error; page = null; } } catch (e) { last = e.message; } if (!page && i < 2) await new Promise((r) => setTimeout(r, pipe.dry ? 10 : 1500 * (i + 1))); }
      if (!page) throw new Error('web.read: ' + url + ' could not be read after 3 attempts (' + str(last, 120) + ')');
      const text = String(page.text || page || ''); const pat = render(st.pattern, pipe.scope);
      let items = [{ url, title: page.title || '', text: text.slice(0, 20000), length: text.length }];
      if (pat) { let re; try { re = new RegExp(pat, 'gi'); } catch (e) { throw new Error('web.read: the pattern is not a valid regular expression'); } items = []; let m; while ((m = re.exec(text)) && items.length < 500) { items.push({ url, match: m[0], groups: m.slice(1), g1: m[1] || '', g2: m[2] || '' }); if (!m[0]) re.lastIndex++; } }
      return { items, note: pat ? items.length + ' match' + (items.length === 1 ? '' : 'es') + ' on ' + url.replace(/^https?:\/\//, '').split('/')[0] : 'read ' + url.replace(/^https?:\/\//, '').split('/')[0] + ' (' + text.length + ' chars)', external: { reads: 1 } };
    } },
  'filter': { kind: 'transform', label: 'Keep items where…', params: [{ name: 'field', type: 'text' }, { name: 'cmp', type: 'choice', choices: COND_OPS, default: '=' }, { name: 'value', type: 'text' }],
    async run(ctx, deps, st, pipe) { const items = pipe.items.filter((it) => cond({ field: st.field, op: st.cmp, value: st.value }, Object.assign({}, pipe.scope, { item: it }))); return { items, note: items.length + ' of ' + pipe.items.length + ' kept (' + st.field + ' ' + (st.cmp || '=') + ' ' + render(st.value, pipe.scope) + ')' }; } },
  'sort': { kind: 'transform', label: 'Sort by a field', params: [{ name: 'field', type: 'text' }, { name: 'order', type: 'choice', choices: ['asc', 'desc'], default: 'desc' }],
    async run(ctx, deps, st, pipe) { const f = render(st.field, pipe.scope), desc = render(st.order, pipe.scope) !== 'asc'; const items = pipe.items.slice().sort((a, b) => { const x = get(a, f), y = get(b, f); const nx = num(x), ny = num(y); const r = !isNaN(nx) && !isNaN(ny) ? nx - ny : String(x == null ? '' : x).localeCompare(String(y == null ? '' : y)); return desc ? -r : r; }); return { items, note: 'sorted by ' + f + (desc ? ' ↓' : ' ↑') }; } },
  'limit': { kind: 'transform', label: 'Keep the first N', params: [{ name: 'n', type: 'number', default: 10 }],
    async run(ctx, deps, st, pipe) { const n = Math.max(0, Math.min(MAX_ITEMS, Math.round(num(render(st.n, pipe.scope)) || 10))); return { items: pipe.items.slice(0, n), note: 'first ' + n }; } },
  'select': { kind: 'transform', label: 'Keep only these fields', params: [{ name: 'fields', type: 'list' }],
    async run(ctx, deps, st, pipe) { const fs = (Array.isArray(st.fields) ? st.fields : String(st.fields || '').split(/,|\n/)).map((x) => str(x, 40)).filter(Boolean); return { items: pipe.items.map((it) => { const o = {}; fs.forEach((f) => { o[f] = get(it, f); }); return o; }), note: fs.join(', ') }; } },
  'compute': { kind: 'transform', label: 'Count / sum / average', params: [{ name: 'field', type: 'text', help: 'numeric field for sum/avg/min/max' }, { name: 'by', type: 'text', help: 'optional field to group by' }],
    async run(ctx, deps, st, pipe) {
      const f = render(st.field, pipe.scope), by = render(st.by, pipe.scope);
      const agg = (list) => { const ns = f ? list.map((it) => num(get(it, f))).filter((n) => !isNaN(n)) : []; const sum = ns.reduce((a, b) => a + b, 0); return { count: list.length, sum: Math.round(sum * 100) / 100, avg: ns.length ? Math.round(sum / ns.length * 100) / 100 : 0, min: ns.length ? Math.min.apply(null, ns) : 0, max: ns.length ? Math.max.apply(null, ns) : 0 }; };
      if (by) { const groups = {}; pipe.items.forEach((it) => { const k = fmtVal(get(it, by)) || '(none)'; (groups[k] = groups[k] || []).push(it); }); const items = Object.keys(groups).map((k) => Object.assign({ group: k }, agg(groups[k]))).sort((a, b) => b.sum - a.sum || b.count - a.count); return { items, note: items.length + ' group' + (items.length === 1 ? '' : 's') + ' by ' + by, totals: agg(pipe.items) }; }
      const t = agg(pipe.items); return { items: [t], note: 'count ' + t.count + (f ? ', sum ' + t.sum + ', avg ' + t.avg : ''), totals: t };
    } },
  'format': { kind: 'transform', label: 'A line per item', params: [{ name: 'template', type: 'text', help: 'e.g. "· {{item.title}} — {{item.amount}} {{item.currency}}"' }, { name: 'empty', type: 'text', default: '(nothing)' }],
    async run(ctx, deps, st, pipe) { const lines = pipe.items.map((it) => render(st.template, Object.assign({}, pipe.scope, { item: it }))); return { items: pipe.items, text: lines.length ? lines.join('\n') : render(st.empty, pipe.scope), note: lines.length + ' line' + (lines.length === 1 ? '' : 's') }; } },
  'compare': { kind: 'transform', label: 'Compare with the previous run', params: [{ name: 'key', type: 'text', help: 'field that identifies an item (e.g. id, merchant, title)' }],
    async run(ctx, deps, st, pipe) {
      const k = render(st.key, pipe.scope) || 'id'; const prev = (pipe.previous && pipe.previous.snapshot) || []; const pk = new Set(prev.map((x) => fmtVal(get(x, k)))), ck = new Set(pipe.items.map((x) => fmtVal(get(x, k))));
      const added = pipe.items.filter((x) => !pk.has(fmtVal(get(x, k)))), removed = prev.filter((x) => !ck.has(fmtVal(get(x, k))));
      return { items: pipe.items, added, removed, snapshot: pipe.items.slice(0, 500), text: (added.length ? 'New: ' + added.map((x) => fmtVal(get(x, 'title') || get(x, 'name') || get(x, 'merchant') || get(x, k))).join(', ') : 'Nothing new') + (removed.length ? '\nGone: ' + removed.map((x) => fmtVal(get(x, 'title') || get(x, 'name') || get(x, 'merchant') || get(x, k))).join(', ') : ''), note: added.length + ' new · ' + removed.length + ' gone' + (pipe.previous ? '' : ' (first run: everything counts as new)') };
    } },
  'report': { kind: 'action', label: 'Write the report', params: [{ name: 'template', type: 'text', help: 'the output; {{text}} is the last formatted block, {{count}} the item count, {{totals.sum}} etc.' }],
    async run(ctx, deps, st, pipe) { const text = render(st.template || '{{text}}', pipe.scope); return { items: pipe.items, text, report: text, note: text.length + ' chars' }; } },
  'notify': { kind: 'action', label: 'Send a fixed message to my channels', params: [{ name: 'template', type: 'text', help: 'no model is used: this text, with values filled in, goes to every linked channel and as a push' }, { name: 'when', type: 'choice', choices: ['always', 'only if items', 'only if none'], default: 'always' }],
    async run(ctx, deps, st, pipe) {
      const when = render(st.when, pipe.scope) || 'always'; if ((when === 'only if items' && !pipe.items.length) || (when === 'only if none' && pipe.items.length)) return { items: pipe.items, note: 'nothing to say (' + when + ')' };
      const text = render(st.template || '{{report}}', pipe.scope).slice(0, 3000); if (!text.trim()) return { items: pipe.items, note: 'empty message, not sent' };
      if (pipe.dry) return { items: pipe.items, note: 'would notify: ' + str(text, 80), preview: text };
      let sent = 0; if (deps.notify) { try { sent = (await deps.notify(pipe.uid, ctx, text)) || 0; } catch (e) { throw new Error('notify: ' + e.message); } }
      return { items: pipe.items, note: 'sent to ' + sent + ' place' + (sent === 1 ? '' : 's') + ' (fixed template, no model)', external: { notifications: sent } };
    } },
  'record.update': { kind: 'action', label: 'Update rocks by rule', params: [{ name: 'set', type: 'choice', choices: ['done', 'not done', 'prio high', 'prio med', 'prio low'], default: 'done' }],
    async run(ctx, deps, st, pipe) {
      const set = render(st.set, pipe.scope) || 'done'; const ids = pipe.items.filter((x) => x.id && x.week).map((x) => ({ id: x.id, week: x.week }));
      if (!ids.length) return { items: pipe.items, note: 'no rocks to update (this step needs items from flow.rocks)' };
      if (pipe.dry) return { items: pipe.items, note: 'would set ' + set + ' on ' + ids.length + ' rock' + (ids.length === 1 ? '' : 's'), preview: ids.map((x) => x.id).join(', ') };
      const c = (await ctx.get('ld_compass')) || { rocks: {} }; let n = 0, skipped = 0;
      for (const x of ids) { const key = 'rock:' + x.id + ':' + set; if (pipe.run.doneKeys[key]) { skipped++; continue; } const r = ((c.rocks || {})[x.week] || []).find((y) => y.id === x.id); if (!r) continue; if (set === 'done') r.done = true; else if (set === 'not done') r.done = false; else r.prio = set.replace('prio ', ''); pipe.run.doneKeys[key] = Date.now(); n++; }
      await ctx.set('ld_compass', c);
      return { items: pipe.items, note: n + ' rock' + (n === 1 ? '' : 's') + ' set ' + set + (skipped ? ' · ' + skipped + ' already done earlier in this run' : ''), affected: n };
    } },
  'email.batch': { kind: 'action', label: 'Send templated emails (after my yes)', params: [{ name: 'to', type: 'text', help: 'field holding the address, e.g. item.email — or one address' }, { name: 'subject', type: 'text' }, { name: 'body', type: 'text' }],
    async run(ctx, deps, st, pipe) {
      const recips = pipe.items.map((it) => { const sc = Object.assign({}, pipe.scope, { item: it }); const to = render(st.to, sc); return { to, subject: render(st.subject, sc), body: render(st.body, sc), key: 'mail:' + crypto.createHash('sha1').update(to + '|' + render(st.subject, sc)).digest('hex').slice(0, 12) }; }).filter((m) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.to));
      if (!recips.length) return { items: pipe.items, note: 'no valid recipients — nothing to send' };
      if (pipe.dry) return { items: pipe.items, note: 'would send ' + recips.length + ' email' + (recips.length === 1 ? '' : 's') + ' after your yes', preview: recips.slice(0, 5).map((m) => m.to + ' — ' + m.subject).join('\n') + (recips.length > 5 ? '\n… +' + (recips.length - 5) : ''), batch: recips.length };
      if (!pipe.run.approved) {
        /* stop here: one approval for the whole batch, with recipients, content and count */
        return { items: pipe.items, await: { kind: 'batch', count: recips.length, recipients: recips.map((m) => m.to), sample: recips[0], subject: recips[0].subject, template: { subject: st.subject, body: st.body } }, note: 'waiting for your yes: ' + recips.length + ' email' + (recips.length === 1 ? '' : 's') };
      }
      if (!deps.sendEmail) throw new Error('email.batch: email is not connected here (RESEND_API_KEY)');
      let sent = 0, skipped = 0, failed = 0, uncertain = 0, retried = 0; const fails = [];
      for (const m of recips) {
        const d = pipe.run.doneKeys[m.key];
        if (d === 'pending') { uncertain++; pipe.run.doneKeys[m.key] = 'uncertain'; continue; }   /* a send whose outcome we never saw: not re-attempted */
        if (d && d !== 'failed') { skipped++; continue; }
        if (d === 'failed') retried++;
        pipe.run.doneKeys[m.key] = 'pending'; if (deps.saveRun) await deps.saveRun(ctx, pipe.run);
        let r = null;
        for (let i = 0; i < 2 && !(r && r.ok); i++) { try { r = await deps.sendEmail(ctx, { to: m.to, subject: m.subject, text: m.body, key: pipe.run.id + ':' + m.key }); } catch (e) { r = { ok: false, error: e.message }; } if (!(r && r.ok) && i === 0 && /rate|429|timeout|too long|reached/i.test(String(r && r.error || ''))) await new Promise((res) => setTimeout(res, 1500)); else break; }
        if (r && r.ok) { pipe.run.doneKeys[m.key] = Date.now(); sent++; } else { pipe.run.doneKeys[m.key] = 'failed'; failed++; fails.push(m.to + ': ' + str(r && r.error, 80)); }
        if (deps.saveRun) await deps.saveRun(ctx, pipe.run);
      }
      const note = sent + ' sent' + (skipped ? ' · ' + skipped + ' already sent earlier (not repeated)' : '') + (retried ? ' · ' + retried + ' retried after a failure' : '') + (uncertain ? ' · ' + uncertain + ' uncertain (not re-sent — check the provider)' : '') + (failed ? ' · ' + failed + ' failed' : '');
      if (failed && !sent && !skipped) throw Object.assign(new Error('email.batch: ' + note + ' — ' + fails.join('; ')), { partial: { sent, failed, uncertain } });
      return { items: pipe.items, note, external: { emails: sent }, failures: fails, partial: failed || uncertain ? { sent, failed, uncertain } : null };
    } },
  'jarvis.review': { kind: 'judgment', label: 'Hand exceptions to an agent', params: [{ name: 'agent', type: 'text', default: 'jarvis' }, { name: 'brief', type: 'text', help: 'what to judge; the items are attached' }, { name: 'when', type: 'choice', choices: ['only if items', 'always'], default: 'only if items' }],
    async run(ctx, deps, st, pipe) {
      const when = render(st.when, pipe.scope) || 'only if items'; if (when === 'only if items' && !pipe.items.length) return { items: pipe.items, note: 'no exceptions — no model call' };
      const brief = render(st.brief, pipe.scope) || 'Review these items.'; const attach = pipe.items.slice(0, 60).map((it) => '· ' + Object.keys(it).map((k) => k + ': ' + fmtVal(it[k])).join(', ')).join('\n');
      if (pipe.dry) return { items: pipe.items, note: 'would hand ' + pipe.items.length + ' item' + (pipe.items.length === 1 ? '' : 's') + ' to ' + (render(st.agent, pipe.scope) || 'jarvis') + ' (1 task, model calls happen there)', preview: brief };
      if (!deps.newTask) throw new Error('jarvis.review: the task runner is not available');
      const t = await deps.newTask(ctx, pipe.uid, { agent: render(st.agent, pipe.scope) || 'jarvis', title: 'Review from automation: ' + str(pipe.script.name, 60), brief: brief + '\n\nITEMS (' + pipe.items.length + '):\n' + attach, from: { script: pipe.script.id, run: pipe.run.id } });
      return { items: pipe.items, note: 'handed ' + pipe.items.length + ' item' + (pipe.items.length === 1 ? '' : 's') + ' to ' + (t.agent || 'the team') + ' as task ' + t.id, task: t.id, modelCalls: 1 };
    } }
};
const OP_IDS = Object.keys(OPS);

/* ---------- shape ------------------------------------------------------------ */
function cleanStep(s) {
  if (!s || typeof s !== 'object' || !OPS[s.op]) return null;
  const o = { op: s.op }; const def = OPS[s.op];
  for (const p of def.params) { if (p.name === 'op' || p.name === 'as' || p.name === 'from') continue; const v = s[p.name]; if (v === undefined || v === null) continue; o[p.name] = p.type === 'list' ? (Array.isArray(v) ? v.map((x) => str(x, 200)) : String(v).split(/,|\n/).map((x) => x.trim()).filter(Boolean)) : (typeof v === 'number' ? v : block(v, 4000)); }
  if (s.as) o.as = str(s.as, 40).replace(/[^\w]/g, '_'); if (s.from) o.from = str(s.from, 40);
  if (s.label) o.label = str(s.label, 120);
  return o;
}
function cleanSchedule(s) {
  if (!s || typeof s !== 'object' || !s.kind || s.kind === 'none') return null;
  const kind = ['daily', 'weekdays', 'weekly', 'hourly'].indexOf(s.kind) >= 0 ? s.kind : 'daily';
  const at = /^\d{2}:\d{2}$/.test(String(s.at || '')) ? s.at : '08:00';
  return { kind, at, day: kind === 'weekly' ? Math.max(0, Math.min(6, +s.day || 0)) : undefined };
}
const EVENTS = ['task.done', 'approval.executed', 'brief.sent'];
function cleanTriggers(t) { return (Array.isArray(t) ? t : []).map((x) => x && typeof x === 'object' && EVENTS.indexOf(x.event) >= 0 ? { event: x.event, match: str(x.match, 120) } : null).filter(Boolean).slice(0, 6); }
function cleanDoc(d) {
  d = d && typeof d === 'object' ? d : {};
  return { name: str(d.name, 80), purpose: block(d.purpose, 600), inputs: (Array.isArray(d.inputs) ? d.inputs : []).map(cleanInputDef).filter(Boolean).slice(0, 20), steps: (Array.isArray(d.steps) ? d.steps : []).map(cleanStep).filter(Boolean).slice(0, 30), schedule: cleanSchedule(d.schedule), triggers: cleanTriggers(d.triggers), stop: block(d.stop, 600), judgment: block(d.judgment, 600) };
}
const DOC_FIELDS = ['name', 'purpose', 'inputs', 'steps', 'schedule', 'triggers', 'stop', 'judgment'];
function docOf(s) { const o = {}; DOC_FIELDS.forEach((f) => { o[f] = s[f]; }); return cleanDoc(o); }
function norm(s) { if (!s || typeof s !== 'object') return null; Object.assign(s, docOf(s)); s.status = STATUSES.indexOf(s.status) >= 0 ? s.status : 'active'; s.version = Math.max(1, +s.version || 1); if (!Array.isArray(s.versions)) s.versions = []; if (!s.stats) s.stats = { runs: 0, ok: 0, failed: 0, partial: 0, items: 0, ms: 0, modelCalls: 0, emails: 0, notifications: 0, usd: 0 }; return s; }
async function all(ctx) { const v = await ctx.get('team:scripts'); return (Array.isArray(v) ? v : []).map(norm).filter(Boolean); }
async function save(ctx, list) { await ctx.set('team:scripts', list.slice(-MAX_SCRIPTS)); }
async function runs(ctx) { const v = await ctx.get('team:scriptruns'); return Array.isArray(v) ? v : []; }
async function saveRuns(ctx, list) { await ctx.set('team:scriptruns', list.slice(-MAX_RUNS)); }
async function saveRun(ctx, run) { const list = await runs(ctx); const i = list.findIndex((r) => r.id === run.id); if (i >= 0) list[i] = run; else list.push(run); await saveRuns(ctx, list); }

/* ---------- what it does, in words --------------------------------------------- */
function explain(s, tools) {
  const T = Object.assign({ web: true, email: false }, tools || {});
  const srcs = s.steps.filter((x) => OPS[x.op].kind === 'source').map((x) => OPS[x.op].label + (x.period ? ' (' + x.period + ')' : x.url ? ' (' + str(x.url, 60) + ')' : ''));
  const acts = s.steps.filter((x) => OPS[x.op].kind === 'action').map((x) => x.op === 'notify' ? 'sends a fixed message to your linked channels and as a push (no model)' : x.op === 'email.batch' ? 'sends templated emails — shown to you first with recipients, content and count; nothing goes before your yes; each recipient once' : x.op === 'record.update' ? 'updates your rocks (' + (x.set || 'done') + ') by the rule above; each rock once per run' : 'writes the report');
  const judge = s.steps.filter((x) => x.op === 'jarvis.review').map((x) => (x.agent || 'J.A.R.V.I.S.') + ' judges: ' + str(x.brief, 120) + (x.when === 'always' ? '' : ' (only when there are exceptions)'));
  const services = []; if (s.steps.some((x) => x.op === 'web.read')) services.push('Web reader (public pages)' + (T.web ? '' : ' — not available')); if (s.steps.some((x) => x.op === 'email.batch')) services.push('Email via Resend' + (T.email ? '' : ' — not connected (RESEND_API_KEY)')); if (s.steps.some((x) => x.op === 'notify')) services.push('your linked channels / push');
  const stops = ['an input is missing or of the wrong type (checked before anything runs)', 'a page cannot be read after 3 attempts', 'an email batch is waiting for your yes', 'the team is paused'].concat(s.stop ? [s.stop] : []);
  return {
    does: s.purpose || (srcs.length ? 'Reads ' + srcs.join(', ').toLowerCase() + ', applies the rules, ' + (acts.length ? acts[0] : 'and reports') : 'Runs the steps below'),
    inputs: s.inputs.map((i) => i.name + ' (' + i.type + (i.required ? '' : ', optional') + (i.default !== '' && i.default !== undefined ? ', default ' + fmtVal(i.default) : '') + ')'),
    services: services.length ? services : ['none outside The Flow'],
    affects: s.steps.some((x) => x.op === 'record.update') ? ['your rocks (this week\'s plan)'] : s.steps.some((x) => x.op === 'email.batch') ? ['nothing in The Flow; emails leave after your yes'] : ['nothing — read-only; the result is the report'],
    outputs: ['a report (text) kept with the run'].concat(s.steps.some((x) => x.op === 'notify') ? ['a message to your channels'] : []).concat(s.steps.some((x) => x.op === 'jarvis.review') ? ['a task for an agent when there are exceptions'] : []),
    stops, judgment: judge.length ? judge : [s.judgment || 'none — this script decides nothing; it applies the rules exactly'],
    modelCalls: s.steps.some((x) => x.op === 'jarvis.review') ? 'only when exceptions are handed over' : 'none'
  };
}

/* ---------- running ----------------------------------------------------------------- */
function scopeOf(pipe) { return Object.assign({}, pipe.scope, { count: pipe.items.length, text: pipe.text, report: pipe.report, totals: pipe.totals || {}, added: pipe.added || [], removed: pipe.removed || [], data: pipe.data }); }
async function execute(ctx, deps, s, run, opts) {
  const o = opts || {}; const tz = deps.userTz ? await deps.userTz(ctx) : 'UTC';
  run.tz = tz; run.status = 'running'; run.startedAt = run.startedAt || Date.now(); run.doneKeys = run.doneKeys || {}; run.steps = run.steps || s.steps.map((st) => ({ op: st.op, label: st.label || OPS[st.op].label, status: 'queued' })); run.metrics = run.metrics || { ms: 0, items: 0, failures: 0, modelCalls: 0, external: {}, retries: 0 };
  await saveRun(ctx, run);
  const prevRuns = (await runs(ctx)).filter((r) => r.script === s.id && r.id !== run.id && r.status === 'ok').slice(-1);
  const pipe = { items: [], data: {}, text: '', report: '', totals: null, scope: { inputs: run.inputs, today: localISO(new Date()), script: { name: s.name }, run: { id: run.id } }, run, script: s, uid: run.uid, dry: !!run.dry, now: Date.now(), previous: prevRuns[0] ? { snapshot: prevRuns[0].snapshot || [] } : null };
  /* resume: rebuild the pipe from the saved outputs of steps already done */
  for (let i = 0; i < s.steps.length; i++) {
    const st = s.steps[i], rec = run.steps[i];
    if (rec.status === 'done') { if (rec.items) pipe.items = rec.items; if (rec.text !== undefined) pipe.text = rec.text; if (rec.report !== undefined) { pipe.report = rec.report; run.output = rec.report; } if (rec.totals) pipe.totals = rec.totals; if (st.as && rec.items) pipe.data[st.as] = { items: rec.items, count: rec.items.length, totals: rec.totals || {} }; continue; }
    if (deps.paused && await deps.paused(ctx)) { run.status = 'stopped'; run.error = 'The team is paused.'; await saveRun(ctx, run); return run; }
    if (st.from && pipe.data[st.from]) pipe.items = pipe.data[st.from].items;
    pipe.scope = scopeOf(pipe); const t0 = Date.now(); rec.status = 'running'; rec.startedAt = t0; await saveRun(ctx, run);
    let out;
    try { out = await OPS[st.op].run(ctx, deps, st, pipe); }
    catch (e) {
      rec.status = 'failed'; rec.error = str(e.message, 300); rec.note = rec.error; rec.ms = Date.now() - t0; run.metrics.ms += rec.ms; run.metrics.failures++;
      if (e.partial) run.partial = e.partial;
      run.status = run.partial || Object.values(run.doneKeys).some((v) => typeof v === 'number') ? 'partial' : 'failed'; run.error = 'Step ' + (i + 1) + ' (' + (st.label || OPS[st.op].label) + '): ' + rec.error; run.finishedAt = Date.now();
      await saveRun(ctx, run); return run;
    }
    rec.ms = Date.now() - t0; run.metrics.ms += rec.ms;
    if (out.items) { pipe.items = out.items.slice(0, MAX_ITEMS); rec.items = pipe.items.length > 200 ? pipe.items.slice(0, 200) : pipe.items; rec.count = pipe.items.length; run.metrics.items = Math.max(run.metrics.items, pipe.items.length); }
    if (out.text !== undefined) { pipe.text = out.text; rec.text = out.text.slice(0, 6000); }
    if (out.report !== undefined) { pipe.report = out.report; run.output = out.report.slice(0, 12000); rec.report = run.output; }
    if (out.totals) { pipe.totals = out.totals; rec.totals = out.totals; }
    if (out.added) pipe.added = out.added; if (out.removed) pipe.removed = out.removed; if (out.snapshot) run.snapshot = out.snapshot;
    if (out.external) Object.keys(out.external).forEach((k) => { run.metrics.external[k] = (run.metrics.external[k] || 0) + out.external[k]; });
    if (out.modelCalls) run.metrics.modelCalls += out.modelCalls; if (out.task) rec.task = out.task;
    if (out.preview) rec.preview = out.preview; if (out.failures && out.failures.length) rec.failures = out.failures; if (out.partial) { run.partial = out.partial; run.error = 'Partly done — ' + str(out.note, 200) + (out.failures && out.failures.length ? ': ' + out.failures.slice(0, 3).join('; ') : ''); }
    rec.note = str(out.note, 300);
    if (st.as) pipe.data[st.as] = { items: pipe.items, count: pipe.items.length, totals: pipe.totals || {} };
    if (out.await) {
      /* the batch waits for a yes: the run is parked, the approval carries the exact content */
      rec.status = 'awaiting'; run.status = 'awaiting_approval'; run.await = Object.assign({ step: i }, out.await); await saveRun(ctx, run);
      if (deps.askApproval && !run.approvalId) { const ap = await deps.askApproval(ctx, run.uid, s, run, out.await); run.approvalId = ap && ap.id; await saveRun(ctx, run); }
      return run;
    }
    rec.status = 'done'; await saveRun(ctx, run);
  }
  run.status = run.partial ? 'partial' : 'ok'; run.finishedAt = Date.now(); if (!run.output && pipe.text) run.output = pipe.text.slice(0, 12000);
  run.cost = costOf(run, deps); await saveRun(ctx, run);
  return run;
}
function costOf(run, deps) {
  const ex = run.metrics.external || {};
  return { ai: run.metrics.modelCalls ? 'estimated in the agent\'s usage (the review task), not here' : '$0.00 — no model call', hosting: 'included in the server plan (not metered per run)', services: [ex.emails ? ex.emails + ' email' + (ex.emails === 1 ? '' : 's') + ' via Resend (plan allowance; see the provider\'s invoice)' : '', ex.reads ? ex.reads + ' page read' + (ex.reads === 1 ? '' : 's') + ' (free)' : '', ex.notifications ? ex.notifications + ' notification' + (ex.notifications === 1 ? '' : 's') + ' (channel costs per provider, if any)' : ''].filter(Boolean), note: 'Estimates where marked; the providers\' invoices are the truth.' };
}
async function startRun(ctx, deps, s, o) {
  const v = validateInputs(s.inputs, o.inputs || {});
  const run = { id: 'r' + newId(), uid: o.uid, script: s.id, scriptName: s.name, version: s.version, trigger: o.trigger || 'manual', dry: !!o.dry, inputs: v.inputs, createdAt: Date.now(), status: 'queued', doneKeys: {} };
  if (v.errors.length) { run.status = 'invalid'; run.error = 'Not started: ' + v.errors.join('; ') + '.'; run.finishedAt = Date.now(); run.metrics = { ms: 0, items: 0, failures: 1, modelCalls: 0, external: {}, retries: 0 }; await saveRun(ctx, run); await bumpStats(ctx, s.id, run); return run; }
  await saveRun(ctx, run);
  const done = await execute(ctx, deps, s, run, {});
  if (/^(ok|failed|partial|invalid|stopped)$/.test(done.status)) await bumpStats(ctx, s.id, done);
  return done;
}
async function bumpStats(ctx, id, run) {
  const list = await all(ctx); const s = list.find((x) => x.id === id); if (!s) return;
  const st = s.stats; st.runs++; if (run.status === 'ok') st.ok++; else if (run.status === 'partial') st.partial++; else st.failed++;
  st.items += (run.metrics && run.metrics.items) || 0; st.ms += (run.metrics && run.metrics.ms) || 0; st.modelCalls += (run.metrics && run.metrics.modelCalls) || 0; st.emails += (run.metrics && run.metrics.external && run.metrics.external.emails) || 0; st.notifications += (run.metrics && run.metrics.external && run.metrics.external.notifications) || 0;
  s.lastRun = { id: run.id, at: run.finishedAt || run.createdAt, status: run.status, trigger: run.trigger, dry: !!run.dry, version: run.version };
  if (run.dry && run.status === 'ok') s.tested = run.version;
  await save(ctx, list);
}
async function resumeRun(ctx, deps, runId) {
  const list = await runs(ctx); const run = list.find((r) => r.id === runId); if (!run) return null;
  const s = (await all(ctx)).find((x) => x.id === run.script); if (!s) { run.status = 'failed'; run.error = 'The automation is gone.'; await saveRun(ctx, run); return run; }
  if (!/^(running|queued|awaiting_approval)$/.test(run.status)) return run;
  const done = await execute(ctx, deps, s, run, {});
  if (/^(ok|failed|partial|stopped)$/.test(done.status)) await bumpStats(ctx, s.id, done);
  return done;
}
/* the person said yes (or no) to a batch */
async function onApproval(ctx, deps, item, decision) {
  const list = await runs(ctx); const run = list.find((r) => r.status === 'awaiting_approval' && r.await && (r.approvalId === item.id || (item.detail && item.detail.run === r.id))); if (!run) return null;
  if (decision !== 'approve') { run.status = 'cancelled'; run.error = 'You declined the batch; nothing was sent.'; run.finishedAt = Date.now(); run.steps[run.await.step].status = 'cancelled'; await saveRun(ctx, run); await bumpStats(ctx, run.script, run); return run; }
  run.approved = true; run.steps[run.await.step].status = 'queued'; delete run.await; run.status = 'running'; await saveRun(ctx, run);
  return resumeRun(ctx, deps, run.id);
}
/* boot: anything that was mid-run carries on */
async function resumeAll(ctx, deps) { const list = await runs(ctx); for (const r of list.filter((x) => x.status === 'running' || x.status === 'queued')) { try { await resumeRun(ctx, deps, r.id); } catch (e) {} } }

/* ---------- schedules and events -------------------------------------------------------- */
function due(s, L, lastKey) {
  const sc = s.schedule; if (!sc || s.status !== 'active') return null;
  if (sc.kind === 'hourly') { const key = L.date + ' ' + L.hhmm.slice(0, 2); if (L.hhmm.slice(3) !== sc.at.slice(3) || key === lastKey) return null; return key; }
  const [hh, mm] = sc.at.split(':').map(Number); const minutes = hh * 60 + mm;
  if (L.minutes < minutes || L.minutes > minutes + 6) return null;   /* a six-minute window, like the briefing */
  if (sc.kind === 'weekdays' && L.day > 4) return null; if (sc.kind === 'weekly' && L.day !== (sc.day || 0)) return null;
  return L.date === lastKey ? null : L.date;
}
async function tick(ctx, deps, uid, now) {
  const list = await all(ctx); if (!list.some((s) => s.schedule && s.status === 'active')) return 0;
  const tz = deps.userTz ? await deps.userTz(ctx) : 'UTC'; const L = deps.localParts(tz, now || new Date()); let n = 0;
  for (const s of list) { const key = due(s, L, s.lastScheduled); if (!key) continue; s.lastScheduled = key; await save(ctx, list); try { await startRun(ctx, deps, s, { uid, trigger: 'schedule ' + s.schedule.kind + ' ' + s.schedule.at + ' ' + tz }); } catch (e) {} n++; }
  return n;
}
async function onEvent(ctx, deps, uid, event, detail) {
  const list = await all(ctx); let n = 0;
  for (const s of list) { if (s.status !== 'active') continue; for (const t of s.triggers) { if (t.event !== event) continue; if (t.match && !(new RegExp(t.match, 'i')).test(String(detail && (detail.title || detail.summary) || ''))) continue; try { await startRun(ctx, deps, s, { uid, trigger: 'event ' + event + (t.match ? ' ~ ' + t.match : ''), inputs: detail && detail.inputs }); } catch (e) {} n++; break; } }
  return n;
}
function nextRunText(s, L) {
  const sc = s.schedule; if (!sc) return s.triggers.length ? 'on ' + s.triggers.map((t) => t.event + (t.match ? ' ~ ' + t.match : '')).join(', ') : 'manual only';
  const D = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return (sc.kind === 'daily' ? 'every day' : sc.kind === 'weekdays' ? 'weekdays' : sc.kind === 'hourly' ? 'every hour' : 'every ' + D[sc.day || 0]) + ' at ' + (sc.kind === 'hourly' ? ':' + sc.at.slice(3) : sc.at) + (s.status === 'active' ? '' : ' (' + s.status + ')');
}

/* ---------- drafting from a workflow ------------------------------------------------------- */
function draftFromTask(task, agents) {
  const text = ((task.brief || '') + ' ' + (task.steps || []).map((s) => (s.brief || '') + ' ' + (s.title || '')).join(' ')).toLowerCase();
  const steps = []; const inputs = []; let purpose = 'The repeatable part of "' + str(task.title, 60) + '"';
  const urls = (text.match(/https?:\/\/\S+/g) || []).filter((u, i, a) => a.indexOf(u) === i).slice(0, 3);
  if (/\b(spend|expense|cost|budget|money|invoice)/.test(text)) { steps.push({ op: 'flow.expenses', period: 'last 7 days', as: 'spend' }, { op: 'compute', field: 'amount', by: 'category' }, { op: 'format', template: '· {{item.group}}: {{item.sum}} ({{item.count}})' }); purpose = 'Collect the week\'s expenses, total them by category, and report'; }
  else if (/\b(rock|week|plan|today|open|overdue|late)/.test(text)) { steps.push({ op: 'flow.rocks', period: 'this week', only: 'open' }, { op: 'format', template: '· {{item.day}} {{item.time}} {{item.title}} ({{item.prio}})' }); purpose = 'List the week\'s open rocks and report'; }
  else if (/\b(habit|streak)/.test(text)) { steps.push({ op: 'flow.habits' }, { op: 'format', template: '· {{item.name}}: streak {{item.streak}}{{item.doneToday}}' }); purpose = 'Report habit streaks'; }
  if (urls.length) { inputs.push({ name: 'page', label: 'The page to read', type: 'url', default: urls[0] }); steps.push({ op: 'web.read', url: '{{inputs.page}}', as: 'page' }); if (!steps.some((s) => s.op === 'format')) steps.push({ op: 'format', template: '{{item.title}} — {{item.length}} chars' }); if (!purpose.includes('report')) purpose += ', read the page'; }
  if (!steps.length) { steps.push({ op: 'team.tasks', status: 'done', period: 'last 7 days' }, { op: 'format', template: '· {{item.title}} ({{item.agent}}, {{item.status}})' }); purpose = 'Report what the team finished this week'; }
  steps.push({ op: 'report', template: str(task.title, 60) + ' — {{today}}\n\n{{text}}\n\n({{count}} items)' });
  if (/\b(tell me|notify|message me|send me|ping)/.test(text)) steps.push({ op: 'notify', template: '{{report}}', when: 'only if items' });
  const hadApprovals = (task.steps || []).some((s) => (s.approvals || []).length);
  const judgment = hadApprovals || /\b(draft|write|reply|decide|judge|summar|explain|recommend|unusual|exception|flag|anything odd|if anything)/.test(text) ? 'The writing, replies and recommendations stay with the agent: this script collects, counts and reports; anything that needs a judgment is handed over with jarvis.review.' : '';
  if (judgment && /\b(unusual|exception|flag|over|above|more than)/.test(text)) steps.splice(steps.length - 1, 0, { op: 'jarvis.review', agent: (task.steps && task.steps[0] && task.steps[0].agent) || 'jarvis', brief: 'Look at these exceptions from "' + str(task.title, 60) + '" and say what should happen.', when: 'only if items' });
  return cleanDoc({ name: str(task.title, 80).replace(/^Team:\s*/i, ''), purpose, inputs, steps, schedule: /\b(every|daily|weekly|each week|monday|morning)\b/.test(text) ? { kind: /\b(week|monday)\b/.test(text) ? 'weekly' : 'daily', at: '08:00', day: 0 } : null, triggers: [], stop: '', judgment });
}

/* ---------- operations on scripts ---------------------------------------------------------- */
function snapshot(s, why) { return { v: s.version, at: s.updatedAt || s.createdAt || Date.now(), why: str(why, 200), doc: docOf(s) }; }
async function create(ctx, deps, b) {
  const list = await all(ctx); if (list.filter((s) => s.status !== 'archived').length >= MAX_SCRIPTS) return { error: 'A hundred automations is the ceiling; archive some first.', status: 400 };
  let doc, from = { kind: String(b.from || 'doc') };
  if (from.kind === 'task') { const tl = deps.tasks ? await deps.tasks(ctx) : []; const t = tl.find((x) => x.id === String(b.task || '')); if (!t) return { error: 'No such task to learn from.', status: 404 }; doc = draftFromTask(t, deps.agents ? await deps.agents(ctx) : []); from.task = t.id; from.title = t.title; if (deps.draft) { const d2 = await deps.draft(ctx, { kind: 'task', task: t, draft: doc, ops: OPS }); if (d2) doc = cleanDoc(Object.assign({}, doc, d2)); } }
  else doc = cleanDoc(b.doc || b);
  if (b.name) doc.name = str(b.name, 80);
  if (!doc.name) return { error: 'The automation needs a name.', status: 400 };
  if (!doc.steps.length) return { error: 'Add at least one step.', status: 400 };
  if (list.some((s) => s.status !== 'archived' && s.name.toLowerCase() === doc.name.toLowerCase()) && !b.force) return { error: 'An automation called "' + doc.name + '" already exists.', status: 409 };
  const now = Date.now();
  const s = norm(Object.assign({ id: 'sc' + newId(), status: 'active', version: 1, versions: [], from, createdAt: now, updatedAt: now }, doc));
  list.push(s); await save(ctx, list);
  if (deps.log) await deps.log(ctx, 'team', 'Automation created: "' + s.name + '" v1' + (from.task ? ' (from the task "' + str(from.title, 60) + '")' : '') + '.');
  return { ok: true, script: s, explanation: explain(s, deps.tools ? deps.tools() : null) };
}
async function update(ctx, deps, b) {
  const list = await all(ctx); const s = list.find((x) => x.id === String(b.id || '')); if (!s) return { error: 'No such automation.', status: 404 };
  const before = JSON.stringify(docOf(s)); const after = cleanDoc(Object.assign({}, docOf(s), b.doc || {}));
  if (!after.name) return { error: 'The automation needs a name.', status: 400 }; if (!after.steps.length) return { error: 'Add at least one step.', status: 400 };
  if (JSON.stringify(after) === before) return { ok: true, script: s, unchanged: true };
  s.versions = s.versions.concat([snapshot(s, b.why || 'edited')]).slice(-30); Object.assign(s, after); s.version += 1; s.updatedAt = Date.now();
  await save(ctx, list);
  if (deps.log) await deps.log(ctx, 'team', 'Automation "' + s.name + '" → v' + s.version + ' (untested until a dry run passes).');
  return { ok: true, script: s, explanation: explain(s, deps.tools ? deps.tools() : null) };
}
async function rollback(ctx, deps, b) {
  const list = await all(ctx); const s = list.find((x) => x.id === String(b.id || '')); if (!s) return { error: 'No such automation.', status: 404 };
  const v = s.versions.find((x) => x.v === +b.to); if (!v) return { error: 'No version ' + b.to + '.', status: 404 };
  s.versions = s.versions.concat([snapshot(s, 'before rolling back to v' + v.v)]).slice(-30); Object.assign(s, cleanDoc(v.doc)); s.version += 1; s.updatedAt = Date.now(); await save(ctx, list);
  return { ok: true, script: s, restored: v.v };
}
async function setStatus(ctx, deps, b) {
  const list = await all(ctx); const s = list.find((x) => x.id === String(b.id || '')); if (!s) return { error: 'No such automation.', status: 404 };
  s.status = STATUSES.indexOf(b.status) >= 0 ? b.status : 'active'; s.updatedAt = Date.now(); await save(ctx, list);
  if (deps.log) await deps.log(ctx, 'team', 'Automation "' + s.name + '" ' + (s.status === 'active' ? 'is active' : s.status) + '.');
  return { ok: true, script: s };
}
async function cancelRun(ctx, deps, b) {
  const list = await runs(ctx); const r = list.find((x) => x.id === String(b.id || '')); if (!r) return { error: 'No such run.', status: 404 };
  if (/^(ok|failed|partial|cancelled|invalid)$/.test(r.status)) return { ok: true, run: r, already: true };
  r.status = 'cancelled'; r.error = 'Cancelled by you.'; r.finishedAt = Date.now(); (r.steps || []).forEach((st) => { if (st.status !== 'done') st.status = 'cancelled'; });
  await saveRuns(ctx, list); if (deps.cancelApproval && r.approvalId) await deps.cancelApproval(ctx, r.approvalId);
  return { ok: true, run: r };
}
async function list(ctx, deps, o) {
  const L = await all(ctx), R = await runs(ctx); const tz = deps.userTz ? await deps.userTz(ctx) : 'UTC'; const Lp = deps.localParts ? deps.localParts(tz, new Date()) : null; const tools = deps.tools ? deps.tools() : null;
  const q = str(o && o.q, 100).toLowerCase();
  const items = L.filter((s) => !q || (s.name + ' ' + s.purpose).toLowerCase().indexOf(q) >= 0).map((s) => Object.assign({}, s, { next: nextRunText(s, Lp), explanation: explain(s, tools), untested: s.tested !== s.version, runs: R.filter((r) => r.script === s.id).length })).sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || (b.updatedAt - a.updatedAt));
  const rs = (o && o.script ? R.filter((r) => r.script === o.script) : R).slice(-40).reverse().map((r) => Object.assign({}, r, { snapshot: undefined, steps: (r.steps || []).map((st) => Object.assign({}, st, { items: undefined })) }));
  return { ok: true, items, runs: rs, counts: { active: L.filter((s) => s.status === 'active').length, paused: L.filter((s) => s.status === 'paused').length, disabled: L.filter((s) => s.status === 'disabled').length, archived: L.filter((s) => s.status === 'archived').length, running: R.filter((r) => r.status === 'running' || r.status === 'awaiting_approval').length }, ops: OP_IDS.map((id) => ({ id, kind: OPS[id].kind, label: OPS[id].label, params: OPS[id].params })), events: EVENTS, tz, tools: tools || {} };
}
async function oneRun(ctx, id) { const r = (await runs(ctx)).find((x) => x.id === id); return r ? { ok: true, run: r } : { error: 'No such run.', status: 404 }; }

/* ---------- routes ------------------------------------------------------------------------ */
async function handle(p, req, res, ctx, deps) {
  if (p.indexOf('/api/team/scripts') !== 0) return false;
  const json = ctx.json; const uid = ctx.user && ctx.user.id;
  const body = async () => { try { return JSON.parse(await ctx.readBody(req)) || {}; } catch (e) { return {}; } };
  const out = (r) => { if (r && r.error) json(res, r.status || 400, r); else json(res, 200, r); return true; };
  if (p === '/api/team/scripts' && req.method === 'GET') return out(await list(ctx, deps, { q: ctx.query.get('q'), script: ctx.query.get('script') }));
  if (p === '/api/team/scripts/run' && req.method === 'GET') return out(await oneRun(ctx, str(ctx.query.get('id'), 40)));
  if (p === '/api/team/scripts' && req.method === 'POST') {
    const b = await body(); const op = String(b.op || 'create');
    if (op === 'create') return out(await create(ctx, deps, b));
    if (op === 'update') return out(await update(ctx, deps, b));
    if (op === 'rollback') return out(await rollback(ctx, deps, b));
    if (op === 'status') return out(await setStatus(ctx, deps, b));
    if (op === 'cancel') return out(await cancelRun(ctx, deps, b));
    if (op === 'preview') { const tl = deps.tasks ? await deps.tasks(ctx) : []; const t = tl.find((x) => x.id === String(b.task || '')); if (!t) return out({ error: 'No such task.', status: 404 }); const d = draftFromTask(t, []); return out({ ok: true, doc: d, explanation: explain(norm(Object.assign({ id: 'x', version: 1 }, d)), deps.tools ? deps.tools() : null) }); }
    if (op === 'run' || op === 'test') {
      const s = (await all(ctx)).find((x) => x.id === String(b.id || '')); if (!s) return out({ error: 'No such automation.', status: 404 });
      if (s.status === 'disabled' || s.status === 'archived') return out({ error: 'This automation is ' + s.status + '. Enable it first.', status: 400 });
      if (deps.paused && await deps.paused(ctx)) return out({ error: 'The team is paused.', status: 423 });
      const run = await startRun(ctx, deps, s, { uid, inputs: b.inputs, trigger: op === 'test' ? 'test' : 'manual', dry: op === 'test' });
      return out({ ok: true, run: Object.assign({}, run, { snapshot: undefined }), script: (await all(ctx)).find((x) => x.id === s.id) });
    }
    return out({ error: 'create, update, rollback, status, cancel, preview, run or test.', status: 400 });
  }
  return false;
}

module.exports = { handle, all, runs, list, create, update, rollback, setStatus, startRun, resumeRun, resumeAll, onApproval, tick, onEvent, explain, draftFromTask, validateInputs, render, cmp, cleanDoc, docOf, OPS, OP_IDS, EVENTS, STATUSES, PERIODS, periodRange, weekId, shiftWeek, due, nextRunText, _internals: { execute, costOf } };
