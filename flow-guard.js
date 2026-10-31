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
function guardCompass(prevStr, nextStr) {
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
    if (!N.rocks || typeof N.rocks !== 'object') N.rocks = {};
    lost.forEach((id) => { const h = pm.get(id); (N.rocks[h.w] = Array.isArray(N.rocks[h.w]) ? N.rocks[h.w] : []).push(h.x); });
    if (rolesReset) N.roles = P.roles;
    if (missionGone) N.mission = P.mission;
    (Array.isArray(P.aside) ? P.aside : []).forEach((a) => { if (a && a.id != null && !nAside.has(String(a.id)) && !nm.has(String(a.id))) (N.aside = Array.isArray(N.aside) ? N.aside : []).push(a); });
    console.warn('[flow/guard] ld_compass: kept ' + lost.length + ' Priorities a save would have dropped' + (rolesReset ? ', and the roles' : '') + (missionGone ? ', and the mission' : ''));
    const out = JSON.stringify(N);
    return dbl ? JSON.stringify(out) : out;
  } catch (e) { return nextStr; }
}

module.exports = { guardCompass };
