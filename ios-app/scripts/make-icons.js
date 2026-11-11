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
/* Since 11 Nov 2026 the icon is Artur's artwork — the glowing rings — not
   the drawn braid above (its numbers stay exported for anything that reads
   them). icon-art.png is that artwork as a full-bleed 1024 square (the
   rounded corners cropped away; iOS and the Mac grid add their own), and
   every size is resampled from it here, still with nothing but Node. */
const ART = path.join(__dirname, 'icon-art.png');
let artCache = null;
function decodePNG(buf) {
  let o = 8, w = 0, h = 0, type = 0; const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), t = buf.toString('ascii', o + 4, o + 8);
    if (t === 'IHDR') { w = buf.readUInt32BE(o + 8); h = buf.readUInt32BE(o + 12); type = buf[o + 17]; }
    else if (t === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len));
    else if (t === 'IEND') break;
    o += 12 + len;
  }
  const bpp = type === 6 ? 4 : type === 2 ? 3 : 0;
  if (!bpp) throw new Error('icon-art.png must be 8-bit RGB or RGBA');
  const raw = zlib.inflateSync(Buffer.concat(idat)); const stride = w * bpp;
  const out = Buffer.alloc(w * h * 3); let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      line[i] = v & 255;
    }
    for (let x = 0; x < w; x++) { out[(y * w + x) * 3] = line[x * bpp]; out[(y * w + x) * 3 + 1] = line[x * bpp + 1]; out[(y * w + x) * 3 + 2] = line[x * bpp + 2]; }
    prev = line;
  }
  return { w, h, px: out };
}
/* Raw RGB, S*S*3 bytes, area-averaged from the artwork (exact at 1024). */
function drawRaw(S, variant) {
  if (!artCache) artCache = decodePNG(fs.readFileSync(ART));
  const { w, h, px: src } = artCache;
  const px = Buffer.alloc(S * S * 3);
  const fx = w / S, fy = h / S;
  for (let y = 0; y < S; y++) {
    const y0 = y * fy, y1 = y0 + fy;
    for (let x = 0; x < S; x++) {
      const x0 = x * fx, x1 = x0 + fx;
      let r = 0, g = 0, b = 0, wt = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1) && sy < h; sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (let sx = Math.floor(x0); sx < Math.ceil(x1) && sx < w; sx++) {
          const ww = wy * (Math.min(x1, sx + 1) - Math.max(x0, sx)); const i = (sy * w + sx) * 3;
          r += src[i] * ww; g += src[i + 1] * ww; b += src[i + 2] * ww; wt += ww;
        }
      }
      r /= wt; g /= wt; b /= wt;
      if (variant === 'tinted') { const l = 0.299 * r + 0.587 * g + 0.114 * b; r = g = b = l; }
      const o = (y * S + x) * 3;
      px[o] = Math.round(r); px[o + 1] = Math.round(g); px[o + 2] = Math.round(b);
    }
  }
  return px;
}
function draw(S, variant) { return png(S, S, drawRaw(S, variant)); }

module.exports = { drawRaw, A };

/* Only write files when run, not when required. */
if (require.main === module) {

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
}
