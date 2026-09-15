#!/usr/bin/env node
/* The app icon, drawn rather than resized — and drawn with nothing but Node.
 *
 * icon-512.png is the web icon: 512 across, with the rounded corners painted
 * into it and an alpha channel. Both are wrong for the App Store. The
 * marketing icon must be 1024 and App Store Connect refuses alpha outright,
 * and iOS masks the corners itself, so baked-in ones show as a dark rim.
 *
 * Resizing 512 to 1024 would soften every curve, so this draws it instead.
 * The artwork is three sine waves and two gradients — pure geometry, nothing
 * photographic — so it is exact at any size.
 *
 * It uses no image library on purpose. `make-native.js` already requires
 * Node, and a build step that also wants Python and Pillow is a build step
 * that works on one machine. PNG is a container around zlib, which Node has,
 * so the encoder below is forty lines and the whole thing runs anywhere.
 *
 *   node ios-app/scripts/make-icons.js
 *
 * Writes ios-app/native/Assets/AppIcon/. make-native.js copies them into the
 * generated Xcode project and checks the bytes before the build can pass.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'native', 'Assets', 'AppIcon');

/* Every measurement is a fraction of the canvas, so one set of numbers draws
   any size. These were taken off the 512 original: all three waves turned out
   to be the same sine at period 240/512 of the width, the top and middle in
   phase, the bottom mirrored about the centre line — which is what makes the
   braid read as a crossing rather than three parallel ropes. */
const A = {
  spanFrom: 79 / 512,
  spanTo: 465 / 512,
  period: 240 / 512,
  firstMinAt: 160 / 512,
  midCentre: 256 / 512,
  midAmp: 34.5 / 512,
  dimOffset: 66.5 / 512,
  dimAmp: 32.5 / 512,
  stroke: 32 / 512,
  dimAlpha: 0.30,
  bgFrom: [24, 29, 37],
  bgTo: [11, 12, 15],
  inkTop: [0, 230, 140],
  inkBottom: [0, 200, 185]
};

const waveY = (xf, centre, amp) =>
  centre + amp * Math.sin(2 * Math.PI * (xf - A.firstMinAt) / A.period - Math.PI / 2);

/* ---- a minimal PNG encoder ---------------------------------------------- *
   Truecolour, 8 bits, no alpha — which is not a limitation here but the
   requirement: the marketing icon is rejected if it has an alpha channel. */
function png(width, height, rgb) {
  const crcTable = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return t;
  })();
  const crc = (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;      /* bit depth */
  ihdr[9] = 2;      /* colour type 2 = truecolour, no alpha */
  /* Each scanline is prefixed with a filter byte; 0 means none. The gradients
     here compress well enough that paying for filter selection buys little. */
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const o = y * (1 + width * 3);
    raw[o] = 0;
    rgb.copy(raw, o + 1, y * width * 3, (y + 1) * width * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---- the drawing -------------------------------------------------------- */
function draw(S, variant) {
  const SS = 3;                       /* subsamples per axis, for smooth edges */
  const px = Buffer.alloc(S * S * 3);

  const flat = variant === 'dark';    /* iOS supplies its own dark ground */
  let ink0 = A.inkTop, ink1 = A.inkBottom;
  if (variant === 'tinted') { ink0 = [235, 235, 235]; ink1 = [170, 170, 170]; }
  const dimA = variant === 'tinted' ? 0.45 : A.dimAlpha;

  /* The three centrelines, as functions of the horizontal fraction. */
  const curves = [
    { centre: A.midCentre - A.dimOffset, amp: A.dimAmp, mirror: false, alpha: dimA },
    { centre: A.midCentre - A.dimOffset, amp: A.dimAmp, mirror: true,  alpha: dimA },
    { centre: A.midCentre, amp: A.midAmp, mirror: false, alpha: 1 }
  ];
  const half = A.stroke / 2;

  /* Distance from a point to one curve, minimised over a local window. f is
     smooth and slowly varying, so a window a little wider than the stroke is
     enough — checking the whole curve for every pixel would be 400 million
     comparisons and would buy nothing. */
  const near = (c, xf, yf) => {
    const w = half * 3;
    const steps = 24;
    let best = Infinity;
    for (let i = 0; i <= steps; i++) {
      const sx = xf - w + (2 * w) * i / steps;
      if (sx < A.spanFrom - half || sx > A.spanTo + half) continue;
      const cx = Math.min(Math.max(sx, A.spanFrom), A.spanTo);
      let cy = waveY(cx, c.centre, c.amp);
      if (c.mirror) cy = 2 * A.midCentre - cy;
      const dx = xf - cx, dy = yf - cy;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const xf0 = (x + 0.5) / S, yf0 = (y + 0.5) / S;

      /* Background: a diagonal ramp, or flat for the dark appearance. */
      let r, g, b;
      if (flat) { r = 10; g = 11; b = 14; }
      else {
        const t = (xf0 + yf0) / 2;
        r = A.bgFrom[0] + (A.bgTo[0] - A.bgFrom[0]) * t;
        g = A.bgFrom[1] + (A.bgTo[1] - A.bgFrom[1]) * t;
        b = A.bgFrom[2] + (A.bgTo[2] - A.bgFrom[2]) * t;
      }

      /* Ink is a vertical gradient: emerald at the crests, teal in the
         troughs. Sampled once per pixel — it varies far too slowly for the
         subsamples to disagree. */
      const it = yf0;
      const ir = ink0[0] + (ink1[0] - ink0[0]) * it;
      const ig = ink0[1] + (ink1[1] - ink0[1]) * it;
      const ib = ink0[2] + (ink1[2] - ink0[2]) * it;

      for (const c of curves) {
        /* Cheap rejection first: this pixel cannot be in this stroke if it is
           further from the curve's own band than the stroke is wide. */
        let cy = waveY(Math.min(Math.max(xf0, A.spanFrom), A.spanTo), c.centre, c.amp);
        if (c.mirror) cy = 2 * A.midCentre - cy;
        if (Math.abs(yf0 - cy) > half * 4) continue;

        let hits = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const xf = (x + (sx + 0.5) / SS) / S;
            const yf = (y + (sy + 0.5) / SS) / S;
            if (near(c, xf, yf) <= half) hits++;
          }
        }
        if (!hits) continue;
        const a = (hits / (SS * SS)) * c.alpha;
        r += (ir - r) * a; g += (ig - g) * a; b += (ib - b) * a;
      }

      const o = (y * S + x) * 3;
      px[o] = Math.max(0, Math.min(255, Math.round(r)));
      px[o + 1] = Math.max(0, Math.min(255, Math.round(g)));
      px[o + 2] = Math.max(0, Math.min(255, Math.round(b)));
    }
  }
  return png(S, S, px);
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, variant] of [
  ['AppIcon-1024.png', 'any'],
  ['AppIcon-1024-dark.png', 'dark'],
  ['AppIcon-1024-tinted.png', 'tinted']
]) {
  const buf = draw(1024, variant);
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log('  ' + name + '  1024×1024  ' + buf.length + ' bytes');
}

/* iOS 17 is the deployment target, so one 1024 per appearance is the whole
   set — the days of twenty-odd sizes in the catalogue are over. */
fs.writeFileSync(path.join(OUT, 'Contents.json'), JSON.stringify({
  images: [
    { filename: 'AppIcon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
    { appearances: [{ appearance: 'luminosity', value: 'dark' }], filename: 'AppIcon-1024-dark.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
    { appearances: [{ appearance: 'luminosity', value: 'tinted' }], filename: 'AppIcon-1024-tinted.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }
  ],
  info: { author: 'xcode', version: 1 }
}, null, 2) + '\n');
console.log('  Contents.json');
console.log('ok: ' + OUT);
