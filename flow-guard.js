/* flow-guard.js — server-side protection for the Week Compass record. */
'use strict';
/* ── The planner never loses its history to a copy that never saw it ─────
 * 31 October 2026: a device holding a blank, default Week Compass added one
 * Priority and saved the whole planner — default roles, no mission, one rock
 * — over weeks of real ones. Every client guard looks at its own copy; this
 * one looks at what is stored. A save that would make three or more
 * Priorities vanish (not moved, not dropped or delegated — those keep their
 * id) across two or more weeks, or wipe custom roles or the mission while
 * dropping any, is merged:
 * the save's own changes stand, and what it never knew about is kept. Single
 * deletions — the way the app deletes — pass untouched. */
const DEF_ROLES = 'Work|Health & Body|Money|Relationships|Learning|Something creative';
let lastMerged = false;
function guardCompass(prevStr, nextStr) {
  lastMerged = false;
  try {
    if (prevStr == null || nextStr == null) return nextStr;
    let P = JSON.parse(prevStr), N = JSON.parse(nextStr), dbl = false;
    if (typeof P === 'string') P = JSON.parse(P);
    if (typeof N === 'string') { N = JSON.parse(N); dbl = true; }
    if (!P || !N || typeof P !== 'object' || typeof N !== 'object') return nextStr;
    const where = (c) => { const m = new Map(); const r = (c.rocks && typeof c.rocks === 'object') ? c.rocks : {}; Object.keys(r).forEach((w) => (Array.isArray(r[w]) ? r[w] : []).forEach((x) => { if (x && x.id != null) m.set(String(x.id), { w, x }); })); return m; };
    const pm = where(P), nm = where(N);
    const nAside = new Set((Array.isArray(N.aside) ? N.aside : []).map((a) => a && String(a.id)));
    const lost = [...pm.keys()].filter((id) => !nm.has(id) && !nAside.has(id));
    const rolesReset = Array.isArray(N.roles) && N.roles.join('|') === DEF_ROLES && Array.isArray(P.roles) && P.roles.length && P.roles.join('|') !== DEF_ROLES;
    const missionGone = !String(N.mission || '').trim() && !!String(P.mission || '').trim();
    /* Clearing one week on purpose is allowed; a copy that never saw the
       history drops Priorities across several weeks at once. */
    const weeks = new Set(lost.map((id) => pm.get(id).w));
    const wiped = lost.length >= 3 && weeks.size >= 2;
    if (!wiped && !(lost.length && (rolesReset || missionGone))) return nextStr;
    /* Caught: N came from a copy that never saw the record. The record (P)
       stays the base — its roles, mission, weekly lines, meeting imports,
       reviews and plans — and only what is genuinely new in N is taken:
       Priorities P has never had, and edits (done, moved, retitled) to the
       ones both know. */
    const out = JSON.parse(JSON.stringify(P));
    if (!out.rocks || typeof out.rocks !== 'object') out.rocks = {};
    let added = 0, edited = 0;
    nm.forEach((h, id) => {
      const old = pm.get(id);
      if (!old) { (out.rocks[h.w] = Array.isArray(out.rocks[h.w]) ? out.rocks[h.w] : []).push(h.x); added++; return; }
      if (JSON.stringify(old.x) === JSON.stringify(h.x) && old.w === h.w) return;
      const arr = out.rocks[old.w] || []; const at = arr.findIndex((r) => r && String(r.id) === id);
      if (at >= 0) arr.splice(at, 1);
      (out.rocks[h.w] = Array.isArray(out.rocks[h.w]) ? out.rocks[h.w] : []).push(h.x); edited++;
    });
    const oAside = new Set((Array.isArray(out.aside) ? out.aside : []).map((a) => a && String(a.id)));
    (Array.isArray(N.aside) ? N.aside : []).forEach((a) => { if (a && a.id != null && !oAside.has(String(a.id))) { (out.aside = Array.isArray(out.aside) ? out.aside : []).push(a); const h = pm.get(String(a.id)); if (h) { const arr = out.rocks[h.w] || []; const at = arr.findIndex((r) => r && String(r.id) === String(a.id)); if (at >= 0) arr.splice(at, 1); } } });
    console.warn('[flow/guard] ld_compass: a copy that never saw the record would have dropped ' + lost.length + ' Priorities' + (rolesReset ? ' and the roles' : '') + (missionGone ? ' and the mission' : '') + '; kept the record, took ' + added + ' new and ' + edited + ' edited');
    const enc = JSON.stringify(out);
    lastMerged = true;
    return dbl ? JSON.stringify(enc) : enc;
  } catch (e) { return nextStr; }
}

/* Whether the last guardCompass call merged — the server tells the device, so
   a page still holding a stale copy reloads instead of saving it again. */
function merged() { return lastMerged; }
module.exports = { guardCompass, merged };
