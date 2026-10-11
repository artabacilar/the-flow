#!/usr/bin/env node
/* The Mac app icon — the iOS artwork, on the macOS grid, packed as .icns.
 *
 * Why not just reuse the iOS 1024: iOS masks icons itself, so the iOS file is
 * a full-bleed square. macOS draws icons exactly as supplied. A full-bleed
 * square in the Dock reads as a sticker beside everything else, which sits on
 * Apple's grid: an 824-point rounded square centred in a 1024 canvas, the
 * margin left transparent.
 *
 * Why .icns and not an asset catalogue: an asset catalogue is compiled by
 * actool, which ships with Xcode and not with the Command Line Tools. The
 * build script has to work with only the latter. The App Store accepts an
 * .icns named by CFBundleIconFile, provided it carries 512 and 512@2x.
 *
 * Why build the .icns here rather than with `iconutil` on the Mac: the
 * container is a few lines (below), and building it here means the test suite
 * can open it and check every size, from Linux, before anybody runs a build.
 *
 *   node mac-app/scripts/make-mac-icon.js
 *
 * Writes mac-app/Resources/AppIcon.icns and mac-app/Resources/AppIcon-1024.png
 * (the latter only so the icon can be looked at without a Mac).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { drawRaw } = require('../../ios-app/scripts/make-icons.js');

const OUT = path.join(__dirname, '..', 'Resources');

/* Apple's macOS icon grid, as fractions of the canvas. */
const BODY = 824 / 1024;
/* Corner radius of the body, as a fraction of the body. Apple's shape is a
   continuous-curvature squircle; a circular-arc corner at this radius is
   within a pixel of it at Dock sizes and is what most non-Xcode icon
   pipelines ship. */
const RADIUS = 185.4 / 824;

/* Every slot the .icns format defines from 10.7 on, each holding a PNG. The
   2x slots are the same pixels as the next size up, labelled for a Retina
   point size — so seven renders fill eleven slots. */
const SLOTS = [
  ['icp4', 16], ['icp5', 32], ['icp6', 64],
  ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
  ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]
];

/* ---- PNG, RGBA ---------------------------------------------------------- */
const CRC = (() => {
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
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
function pngRGBA(S, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; ihdr[9] = 6;   /* 8-bit, colour type 6 = RGBA */
  const raw = Buffer.alloc(S * (1 + S * 4));
  for (let y = 0; y < S; y++) {
    const o = y * (1 + S * 4);
    raw[o] = 0;
    rgba.copy(raw, o + 1, y * S * 4, (y + 1) * S * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---- the icon at one size ----------------------------------------------- */
function render(S) {
  const B = Math.max(1, Math.round(S * BODY));
  const off = (S - B) / 2;
  const art = drawRaw(B, 'any');
  const r = RADIUS * B;
  const out = Buffer.alloc(S * S * 4);   /* starts fully transparent */

  /* Coverage of the rounded square at one point, in body coordinates. */
  const inside = (x, y) => {
    const cx = Math.min(Math.max(x, r), B - r);
    const cy = Math.min(Math.max(y, r), B - r);
    const dx = x - cx, dy = y - cy;
    return x >= 0 && y >= 0 && x <= B && y <= B && dx * dx + dy * dy <= r * r;
  };

  const SS = 4;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++)
          if (inside(x + (sx + 0.5) / SS - off, y + (sy + 0.5) / SS - off)) hits++;
      if (!hits) continue;

      const ax = Math.min(B - 1, Math.max(0, Math.floor(x - off)));
      const ay = Math.min(B - 1, Math.max(0, Math.floor(y - off)));
      const i = (ay * B + ax) * 3, o = (y * S + x) * 4;
      out[o] = art[i]; out[o + 1] = art[i + 1]; out[o + 2] = art[i + 2];
      out[o + 3] = Math.round(255 * hits / (SS * SS));
    }
  }
  return pngRGBA(S, out);
}

/* ---- .icns -------------------------------------------------------------- *
   'icns', total length, then entries of (type, length including its own
   eight-byte header, data). All big-endian. That is the whole format. */
function icns(entries) {
  const parts = entries.map(([type, data]) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, 'ascii'); h.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([h, data]);
  });
  const body = Buffer.concat(parts);
  const h = Buffer.alloc(8);
  h.write('icns', 0, 'ascii'); h.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([h, body]);
}

if (require.main === module) {
  fs.mkdirSync(OUT, { recursive: true });
  const bySize = {};
  for (const [, px] of SLOTS) if (!bySize[px]) bySize[px] = render(px);
  const file = icns(SLOTS.map(([type, px]) => [type, bySize[px]]));
  fs.writeFileSync(path.join(OUT, 'AppIcon.icns'), file);
  fs.writeFileSync(path.join(OUT, 'AppIcon-1024.png'), bySize[1024]);
  console.log('  AppIcon.icns  ' + SLOTS.length + ' slots  ' + file.length + ' bytes');
  console.log('  AppIcon-1024.png  ' + bySize[1024].length + ' bytes');
  console.log('ok: ' + OUT);
}

module.exports = { render, icns, SLOTS, BODY, RADIUS };
