#!/usr/bin/env node
/* The app icon, drawn rather than resized.
 *
 * icon-512.png is the web icon, and it is 512 across with the rounded corners
 * already painted into it. Neither is any good for the App Store: the
 * marketing icon has to be 1024 and must carry no alpha channel at all, and an
 * icon with its own corners gets masked a second time by iOS, which shows as a
 * dark rim around the artwork.
 *
 * So this redraws it. The artwork is three sine waves and a gradient — pure
 * geometry, nothing photographic — so drawing it at any size is both exact and
 * cheaper than arguing with a resampler. The numbers below were measured off
 * the 512 original: all three waves turned out to be the same sine at period
 * 240/512 of the width, the top and middle in phase, the bottom mirrored about
 * the centre line, which is what makes the braid read as a crossing.
 *
 *   node ios-app/scripts/make-icons.js
 *
 * Writes ios-app/native/Assets/AppIcon/*.png. make-native.js copies them into
 * the generated Xcode project.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const OUT = path.join(__dirname, '..', 'native', 'Assets', 'AppIcon');
fs.mkdirSync(OUT, { recursive: true });

/* Everything is expressed as a fraction of the canvas, so one set of numbers
   draws every size we will ever be asked for. */
const ART = {
  waveSpanFrom: 79 / 512,       /* where the strokes start and end */
  waveSpanTo: 465 / 512,
  period: 240 / 512,
  firstMinAt: 160 / 512,        /* x of the first crest (smallest y) */
  midCentre: 256 / 512,
  midAmp: 34.5 / 512,
  dimOffset: 66.5 / 512,        /* top wave sits this far above the middle */
  dimAmp: 32.5 / 512,
  stroke: 32 / 512,
  dimAlpha: 0.30,
  /* The background runs light top-left to near-black bottom-right. */
  bgFrom: [24, 29, 37],
  bgTo: [11, 12, 15],
  /* The stroke gradient is vertical: emerald at the crests, teal in the troughs. */
  inkTop: [0, 230, 140],
  inkBottom: [0, 200, 185]
};

const python = (script) => execFileSync('python3', ['-c', script], { maxBuffer: 64 * 1024 * 1024 });

/* The drawing itself lives in Python because Pillow is what is actually
   installed here and it antialiases curves properly. It is generated rather
   than kept as a separate file so the measurements above stay the one place
   the artwork is described. */
function draw(size, variant, outfile) {
  const a = ART;
  const script = `
from PIL import Image, ImageDraw
import math

S = ${size}
V = ${JSON.stringify(variant)}
A = ${JSON.stringify(a)}
SS = 3                      # supersample, then average down: clean curve edges

W = S * SS

# ---- background ---------------------------------------------------------
# A bilinear resize of a 2x2 image IS the diagonal ramp, exactly, and it is
# instant. Walking 17 million pixels in Python to get the same answer was a
# minute per icon and bought nothing.
def ramp(c0, c1):
    mid = tuple((c0[i] + c1[i]) // 2 for i in range(3))
    seed = Image.new('RGB', (2, 2))
    seed.putpixel((0, 0), tuple(c0)); seed.putpixel((1, 0), mid)
    seed.putpixel((0, 1), mid);       seed.putpixel((1, 1), tuple(c1))
    return seed.resize((W, W), Image.BILINEAR)

if V == 'dark':
    # A dark-appearance icon sits on the system's own dark ground. A second
    # gradient under it reads as a smudge, so this one is flat.
    img = Image.new('RGB', (W, W), (10, 11, 14))
else:
    img = ramp(A['bgFrom'], A['bgTo'])

# ---- the three waves ----------------------------------------------------
def wave_y(xf, centre, amp):
    phase = 2 * math.pi * (xf - A['firstMinAt']) / A['period'] - math.pi / 2
    return centre + amp * math.sin(phase)

def wave_dy(xf, amp):
    phase = 2 * math.pi * (xf - A['firstMinAt']) / A['period'] - math.pi / 2
    return amp * math.cos(phase) * 2 * math.pi / A['period']

def stroke_mask(centre, amp, mirror=False):
    """One filled polygon, not a run of wide line segments.

    Pillow draws a wide polyline as one rectangle per segment, and on a curve
    those rectangles fan apart and leave pinholes all down the stroke — which
    is exactly what the first version of this did. Offsetting the curve by
    half the stroke width either side gives a single closed shape with no
    seams in it at all."""
    m = Image.new('L', (W, W), 0)
    d = ImageDraw.Draw(m)
    h = A['stroke'] / 2
    steps = 600
    upper, lower = [], []
    for i in range(steps + 1):
        xf = A['waveSpanFrom'] + (A['waveSpanTo'] - A['waveSpanFrom']) * i / steps
        yf = wave_y(xf, centre, amp)
        dy = wave_dy(xf, amp)
        if mirror:
            yf = 2 * A['midCentre'] - yf
            dy = -dy
        n = math.sqrt(1 + dy * dy)
        nx, ny = -dy / n, 1 / n
        upper.append(((xf + h * nx) * W, (yf + h * ny) * W))
        lower.append(((xf - h * nx) * W, (yf - h * ny) * W))
    d.polygon(upper + lower[::-1], fill=255)
    r = h * W
    for (cx, cy) in ((upper[0][0] + lower[0][0]) / 2, (upper[0][1] + lower[0][1]) / 2), \
                    ((upper[-1][0] + lower[-1][0]) / 2, (upper[-1][1] + lower[-1][1]) / 2):
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    return m

i0, i1 = A['inkTop'], A['inkBottom']
if V == 'tinted':
    # A tinted icon is greyscale; iOS supplies the colour. Keep the same
    # top-to-bottom fall so the braid still reads as three strands.
    i0, i1 = [235, 235, 235], [170, 170, 170]
ink = ramp(i0, i1) if False else None
seed = Image.new('RGB', (1, 2))
seed.putpixel((0, 0), tuple(i0)); seed.putpixel((0, 1), tuple(i1))
ink = seed.resize((W, W), Image.BILINEAR)

top = stroke_mask(A['midCentre'] - A['dimOffset'], A['dimAmp'])
bottom = stroke_mask(A['midCentre'] - A['dimOffset'], A['dimAmp'], mirror=True)
mid = stroke_mask(A['midCentre'], A['midAmp'])

dim_a = A['dimAlpha']
if V == 'tinted':
    dim_a = 0.45          # greyscale needs more separation to stay legible
for m in (top, bottom):
    img = Image.composite(ink, img, m.point(lambda v: int(v * dim_a)))
img = Image.composite(ink, img, mid)

img = img.resize((S, S), Image.LANCZOS)
img.save(${JSON.stringify(outfile)}, 'PNG', optimize=True)
print('%s %dx%d' % (${JSON.stringify(path.basename(outfile))}, S, S))
`;
  process.stdout.write(python(script).toString());
}

const jobs = [
  [1024, 'any', 'AppIcon-1024.png'],
  [1024, 'dark', 'AppIcon-1024-dark.png'],
  [1024, 'tinted', 'AppIcon-1024-tinted.png']
];
for (const [size, variant, name] of jobs) draw(size, variant, path.join(OUT, name));

/* iOS 17 is the deployment target, so one 1024 per appearance is the whole
   set — the days of twenty-odd sizes in the catalogue are over. */
const contents = {
  images: [
    { filename: 'AppIcon-1024.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
    { appearances: [{ appearance: 'luminosity', value: 'dark' }], filename: 'AppIcon-1024-dark.png', idiom: 'universal', platform: 'ios', size: '1024x1024' },
    { appearances: [{ appearance: 'luminosity', value: 'tinted' }], filename: 'AppIcon-1024-tinted.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }
  ],
  info: { author: 'xcode', version: 1 }
};
fs.writeFileSync(path.join(OUT, 'Contents.json'), JSON.stringify(contents, null, 2) + '\n');
console.log('Contents.json written · ' + OUT);
