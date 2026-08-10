/* ══════════════════════════════════════════════════════════════════════════
 * 32 · Mood & Energy chart
 *
 * Rebuilt to the same anatomy as the sleep chart. What was wrong with the old
 * one, in order of how much it hurt:
 *
 *   · the legend was drawn as a floating box inside the plot, so it sat on top
 *     of the lines and its own text was clipped by the canvas edge;
 *   · the canvas had a fixed 800×140 backing store stretched to whatever width
 *     the card happened to be, so everything was blurry and squashed;
 *   · dates read "07-15" rather than "15 Jul";
 *   · no value was ever stated — you had to read positions off a gridline;
 *   · it bailed out silently on fewer than two entries.
 *
 * Both series are the same 1–5 scale, so they share one axis. (Two scales on
 * one chart would be the single worst thing you can do here.) Identity is
 * carried three ways — legend, colour, and a direct label at the end of each
 * line — so it never rests on colour alone.
 *
 * Colours: #ff5ca8 / #dd9000. Checked with the palette validator against this
 * card's surface rather than guessed — CVD ΔE 15.0 (deuteranopia), 22.9 normal
 * vision, both over 3:1 on the surface, and matched in lightness to within
 * 0.004 OKLCH so neither line visually outranks the other.
 * ══════════════════════════════════════════════════════════════════════════ */
const MoodChart = {
  _hi: -1,
  _pts: [],
  MOOD: '#ff5ca8',
  ENERGY: '#dd9000',
  SURF: '#14161b',

  rows() {
    try {
      if (typeof mdData === 'undefined' || !Array.isArray(mdData)) return [];
      return mdData.filter(e => e && (isFinite(Number(e.mood)) || isFinite(Number(e.energy))));
    } catch (e) { return []; }
  },

  install() {
    const cv = document.getElementById('mdChart');
    if (!cv || cv.__flowMood) return;
    cv.__flowMood = 1;
    /* Let CSS own the size and give the backing store to the device pixel
       ratio, instead of stretching a fixed 800×140 bitmap. */
    cv.style.width = '100%';
    cv.style.height = '210px';
    cv.style.display = 'block';
    cv.removeAttribute('width'); cv.removeAttribute('height');

    window.renderMoodChart = MoodChart.draw;

    let t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(MoodChart.draw, 140); });
    cv.addEventListener('mousemove', MoodChart.hover);
    cv.addEventListener('mouseleave', () => { MoodChart._hi = -1; MoodChart.tip(null); MoodChart.draw(); });
    MoodChart.draw();
  },

  tip(html, x, y) {
    let el = document.getElementById('flow-mood-tip');
    if (!html) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'flow-mood-tip'; el.className = 'flow-tip';
      document.body.appendChild(el);
    }
    el.innerHTML = html;
    el.style.left = Math.round(x + 12) + 'px';
    el.style.top = Math.round(y - 34) + 'px';
  },

  hover(e) {
    const pts = MoodChart._pts;
    if (!pts.length) return;
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left;
    let best = 0, bd = 1e9;
    pts.forEach((p, i) => { const d = Math.abs(p.x - mx); if (d < bd) { bd = d; best = i; } });
    if (bd > 40) { MoodChart._hi = -1; MoodChart.tip(null); MoodChart.draw(); return; }
    MoodChart._hi = best;
    const p = pts[best];
    const bit = (c, n, v) => v == null ? '' :
      `<span style="color:${c}">●</span> ${n} <b>${v}</b>/5`;
    MoodChart.tip(
      `${esc(p.label)}<br>${bit(MoodChart.MOOD, 'Mood', p.mood)}` +
      (p.mood != null && p.energy != null ? ' &nbsp; ' : '') +
      `${bit(MoodChart.ENERGY, 'Energy', p.energy)}`,
      r.left + p.x, r.top + p.y);
    MoodChart.draw();
  },

  draw() {
    const cv = document.getElementById('mdChart');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const cssW = Math.max(280, Math.round(cv.clientWidth || (cv.parentElement && cv.parentElement.clientWidth) || 800));
    const cssH = 210;
    const pw = Math.round(cssW * dpr), ph = Math.round(cssH * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const F = 'system-ui,-apple-system,"Segoe UI",sans-serif';
    const INK = '#7e8493', INK2 = '#d5dae3';
    const MOOD = MoodChart.MOOD, ENERGY = MoodChart.ENERGY;
    const rec = MoodChart.rows().slice(-14);
    const head = document.querySelector('.mood-chart-wrap h3');

    if (!rec.length) {
      ctx.fillStyle = INK; ctx.font = '13px ' + F;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Nothing logged yet — rate a day above and this fills in.', cssW / 2, cssH / 2);
      if (head) head.textContent = 'Mood & Energy';
      MoodChart._pts = [];
      return;
    }
    /* Say what is actually on screen, not a hard-coded "last 14 days". */
    if (head) head.textContent = rec.length === 1
      ? 'Mood & Energy — today'
      : 'Mood & Energy — last ' + rec.length + ' days';

    /* Right padding carries the two end labels; top padding carries the
       legend. Both used to be drawn over the plot. */
    const pad = { l: 30, r: 74, t: 34, b: 26 };
    const w = cssW - pad.l - pad.r, h = cssH - pad.t - pad.b;
    const lo = 1, hi = 5;
    const Y = v => pad.t + h - ((v - lo) / (hi - lo)) * h;
    const X = i => rec.length === 1 ? pad.l + w / 2 : pad.l + (i / (rec.length - 1)) * w;

    /* 4–5 band, behind everything. Neutral rather than either series colour,
       so it cannot be mistaken for one of the lines. */
    ctx.fillStyle = 'rgba(255,255,255,.035)';
    const yb = Y(5), yt = Y(4);
    ctx.fillRect(pad.l, yb, w, yt - yb);

    /* hairline grid + y labels */
    ctx.lineWidth = 1; ctx.font = '10px ' + F;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = 1; v <= 5; v++) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = 'rgba(255,255,255,.055)';
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + w, y); ctx.stroke();
      ctx.fillStyle = INK; ctx.fillText(String(v), pad.l - 9, y);
    }
    ctx.textAlign = 'left'; ctx.font = '9.5px ' + F;
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    ctx.fillText('4–5 good', pad.l + 7, yb + 9);

    /* Legend above the plot, where no data can reach it. Text in ink; the
       swatch alone carries the colour. */
    let lx = pad.l;
    ctx.textBaseline = 'middle'; ctx.font = '11px ' + F;
    [['Mood', MOOD], ['Energy', ENERGY]].forEach(([name, col]) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      if (ctx.roundRect) { ctx.roundRect(lx, pad.t - 22, 10, 10, 2); ctx.fill(); }
      else ctx.fillRect(lx, pad.t - 22, 10, 10);
      ctx.fillStyle = INK2; ctx.textAlign = 'left';
      ctx.fillText(name, lx + 15, pad.t - 17);
      lx += 15 + ctx.measureText(name).width + 16;
    });

    const num = (v) => { const n = Number(v); return isFinite(n) ? n : null; };
    const pts = rec.map((e, i) => ({
      x: X(i),
      mood: num(e.mood), energy: num(e.energy),
      label: (function () {
        try { const d = parseISO(e.date); return d.getDate() + ' ' + MON[d.getMonth()]; }
        catch (x) { return String(e.date || ''); }
      })()
    }));
    MoodChart._pts = pts;

    /* One pass per series: line, then dots with a surface ring so they read
       where the two cross. No area fill — two translucent fills over each
       other turn to mud. */
    const series = [
      { key: 'mood', col: MOOD, name: 'Mood' },
      { key: 'energy', col: ENERGY, name: 'Energy' }
    ];

    series.forEach(s => {
      const seq = pts.filter(p => p[s.key] != null);
      if (seq.length > 1) {
        ctx.strokeStyle = s.col; ctx.lineWidth = 2;
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.beginPath();
        seq.forEach((p, i) => i ? ctx.lineTo(p.x, Y(p[s.key])) : ctx.moveTo(p.x, Y(p[s.key])));
        ctx.stroke();
      }
      const showDots = seq.length <= 14;
      seq.forEach((p, i) => {
        const on = pts.indexOf(p) === MoodChart._hi;
        if (!showDots && !on && i !== seq.length - 1) return;
        ctx.beginPath(); ctx.arc(p.x, Y(p[s.key]), on ? 5.5 : 4, 0, Math.PI * 2);
        ctx.fillStyle = s.col; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = MoodChart.SURF; ctx.stroke();
      });
    });

    /* Direct labels at the right end — the secondary encoding that means
       identity never depends on colour. Nudged apart when the two lines
       finish close together. */
    const ends = series.map(s => {
      const seq = pts.filter(p => p[s.key] != null);
      if (!seq.length) return null;
      const p = seq[seq.length - 1];
      return { x: p.x, y: Y(p[s.key]), v: p[s.key], col: s.col, name: s.name };
    }).filter(Boolean);

    if (ends.length === 2 && Math.abs(ends[0].y - ends[1].y) < 15) {
      const up = ends[0].y <= ends[1].y ? ends[0] : ends[1];
      const dn = up === ends[0] ? ends[1] : ends[0];
      up.y -= (15 - Math.abs(ends[0].y - ends[1].y)) / 2;
      dn.y += (15 - Math.abs(ends[0].y - ends[1].y)) / 2;
    }
    ends.forEach(e => {
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = e.col;
      ctx.beginPath(); ctx.arc(e.x + 12, e.y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.font = '700 12px ' + F; ctx.fillStyle = INK2;
      ctx.fillText(String(e.v), e.x + 19, e.y);
      ctx.font = '10px ' + F; ctx.fillStyle = INK;
      ctx.fillText(e.name, e.x + 19 + ctx.measureText(String(e.v)).width + 12, e.y + 0.5);
    });

    /* x labels: both ends always, the rest thinned so they cannot collide */
    ctx.font = '10px ' + F; ctx.fillStyle = INK; ctx.textBaseline = 'top';
    const step = Math.max(1, Math.ceil(pts.length / 5));
    pts.forEach((p, i) => {
      const isEnd = i === 0 || i === pts.length - 1;
      if (!isEnd && (i % step !== 0 || i > pts.length - 1 - step * 0.6)) return;
      ctx.textAlign = i === 0 ? 'left' : (i === pts.length - 1 ? 'right' : 'center');
      ctx.fillText(p.label, p.x + (i === 0 ? -4 : (i === pts.length - 1 ? 4 : 0)), pad.t + h + 8);
    });

    if (MoodChart._hi >= 0 && pts[MoodChart._hi]) {
      const p = pts[MoodChart._hi];
      ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(p.x) + 0.5, pad.t);
      ctx.lineTo(Math.round(p.x) + 0.5, pad.t + h);
      ctx.stroke();
    }
  }
};
