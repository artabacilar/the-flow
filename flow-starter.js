/* =========================================================================
 * The first week of a brand-new account.
 *
 * Until now a new account opened onto nothing: an empty week, no habits, no
 * training, no roles. The server has always known which accounts are new — it
 * answers `seed: 'template'` on /api/auth/me and has done since the namespaces
 * were introduced — but nothing anywhere ever read that answer. So every new
 * person, and every App Review reviewer signing in with the demo account, met
 * a blank page and had to guess what the thing was for.
 *
 * What this seeds, and what it deliberately does not
 * --------------------------------------------------
 * It seeds STRUCTURE — roles, Big Rocks, habits, weekly commitments, a shape
 * for the training week. Things that say "here is what this surface is for",
 * which a person then replaces with their own.
 *
 * It seeds no RECORD. No ticked habit days, no mood, no sleep, no weights.
 * Those are claims about what actually happened, and an app that invents a
 * three-day streak nobody earned has broken the only promise it makes. The
 * scoreboard stays at zero until the person does something. That is the
 * point of the scoreboard.
 *
 * Everything here is written once, at signup, before the browser has ever
 * asked for the account. There is no client-side seeding race to lose and
 * nothing to overwrite, because at that moment the namespace is empty by
 * construction.
 * ====================================================================== */

'use strict';

const DAY = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };

/* The app's own role list, from DEFAULT_ROLES in life-dashboard.html.
   Duplicated here because the server cannot cheaply read a constant out of
   the page it serves — so tests/test-starter.js reads it out of the HTML and
   fails if these two ever drift. A rock whose role is not in this list shows
   up in the app with a role the dropdown cannot offer. */
const ROLES = ['Work', 'Health & Body', 'Money', 'Relationships', 'Learning', 'Something creative'];

/* Same ISO week id the rest of the app uses (flow-mcp.js weekId). Rocks live
   in a bucket named by week, so seeding into the wrong bucket would put the
   whole first week somewhere the person never looks. */
function weekId(d) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const w = Math.ceil(((dt - y0) / 86400000 + 1) / 7);
  return dt.getUTCFullYear() + '-W' + String(w).padStart(2, '0');
}

/* Ids only have to be unique inside this account, and this account is empty. */
function ids(n) {
  const base = Date.now();
  const out = [];
  for (let i = 0; i < n; i++) out.push(String(base + i));
  return out;
}

/* The note under each starter rock. Written so that somebody who reads it
   knows both what the rock is teaching and that it is theirs to delete. */
const TOUR = 'An example to get you started — change it or remove it.';

function rocks(wid) {
  const id = ids(5);
  const rock = (i, day, title, role, time, prio, note) => ({
    id: id[i], title, role, day: DAY[day], time: time || '', end: '',
    prio: prio || 'med', note, done: false
  });
  return {
    [wid]: [
      rock(0, 'mon', 'Decide the three things that would make this week count', 'Work', '09:00', 'high',
        'Big Rocks go in first; everything else fits around them. ' + TOUR),
      rock(1, 'tue', 'Write down what you are actually training for', 'Health & Body', '', 'med',
        'The Training tab holds the plan; this is the reason behind it. ' + TOUR),
      rock(2, 'wed', 'One honest paragraph in the Journal', 'Learning', '21:00', 'med',
        'The Journal is the only place nothing is scored. ' + TOUR),
      rock(3, 'thu', 'Clear the one thing you keep moving to tomorrow', 'Work', '', 'high',
        'If it has moved three times, it is either not a rock or not yours. ' + TOUR),
      rock(4, 'sun', 'Look back: what worked, what did not, what changes', 'Relationships', '18:00', 'med',
        'Fifteen minutes here is worth more than any other fifteen in the week. ' + TOUR)
    ]
  };
}

function habits() {
  const id = ids(4);
  return {
    habits: [
      { id: id[0], name: 'Move for 30 minutes' },
      { id: id[1], name: 'In bed by the hour you chose' },
      { id: id[2], name: 'One block of deep work, no phone' },
      { id: id[3], name: 'Read something that is not a screen' }
    ],
    /* Empty, and staying empty. A streak has to be earned to mean anything. */
    completions: {}
  };
}

function training(wid) {
  const ex = (name, sets) => [name, sets];
  /* The COMPLETE shape, not just the part this file cares about. The
     dashboard heals what it finds missing, but it should not have to: a
     section written from outside should arrive whole. */
  return {
    weeks: {}, workouts: {}, times: {}, timesW: {}, weights: [],
    plans: {
      [wid]: {
        mon: { title: 'Push', focus: 'Chest, shoulders, triceps', tag: 'Strength', type: 'strength', note: '',
          exercises: [ex('Bench press', '4 × 6'), ex('Overhead press', '3 × 8'), ex('Dips', '3 × max')] },
        tue: { title: 'Easy cardio', focus: 'Zone 2', tag: 'Conditioning', type: 'cond', note: 'Nose-breathing pace — if you cannot hold a conversation, slow down.', exercises: [] },
        wed: { title: 'Pull', focus: 'Back, biceps', tag: 'Strength', type: 'strength', note: '',
          exercises: [ex('Pull-ups', '4 × max'), ex('Barbell row', '4 × 8'), ex('Face pulls', '3 × 15')] },
        thu: { title: 'Rest', focus: '', tag: 'Rest', type: 'rest', note: 'Rest is part of the plan, not a gap in it.', exercises: [] },
        fri: { title: 'Legs', focus: 'Squat pattern', tag: 'Strength', type: 'strength', note: '',
          exercises: [ex('Back squat', '5 × 5'), ex('Romanian deadlift', '3 × 8'), ex('Calf raises', '3 × 15')] },
        sat: { title: 'Something outside', focus: 'Whatever you enjoy', tag: 'Conditioning', type: 'cond', note: '', exercises: [] },
        sun: { title: 'Rest', focus: '', tag: 'Rest', type: 'rest', note: '', exercises: [] }
      }
    }
  };
}

/* There is deliberately no ld_sawItems here.
   The Sharpen-the-Blade list already ships with eight lines covering
   physical, mental, social and spiritual, hydrated by the app whenever the
   key is absent. Writing four lines of my own over them is not a starting
   point, it is a downgrade — and it is exactly what the MCP suite caught by
   asking how many commitments a new account has. The same reasoning applies
   to the mission and the roles below: where the app already has a considered
   default, the template's job is to leave it alone.
   Found by: tests/test-mcp.js, "the weekly commitments come with it". */

/* ------------------------------------------------------------------------ *
 * build()
 *
 * Returns plain objects keyed by the store name they belong under. The caller
 * decides how to write them; nothing here touches a store, which is what makes
 * it testable without a server.
 * ------------------------------------------------------------------------ */
function build(name, now) {
  const when = now instanceof Date ? now : new Date();
  const wid = weekId(when);
  const who = String(name || '').trim();

  return {
    ld_compass: {
      /* Left empty on purpose. A mission somebody else wrote is not a mission,
         and a filled-in box is much harder to face than an empty one. */
      mission: '',
      roles: ROLES.slice(),
      rocks: rocks(wid),
      saw: {},
      reviews: {}
    },
    ld_habits: habits(),
    ld_training: training(wid),
    /* { t, cat, txt } — the exact shape journal() in flow-mcp.js appends, and
       the one the Journal tab reads. A different-looking entry here would be
       silently dropped on the floor by the renderer. */
    ld_journal: [{
      t: when.toISOString(),
      cat: 'planning',
      txt: 'Account created' + (who ? ' — welcome, ' + who : '') +
           '. The week ahead was set up with examples; replace them with your own.'
    }]
  };
}

module.exports = { build, weekId, TOUR, ROLES };
