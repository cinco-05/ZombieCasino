// skins.js — every character's outfit, painted into its atlas. Building blocks
// (skin, face, shirt, jacket, vest, tie, trousers, shoes...) are composed per
// enemy kind, with seeded variation so no two gamblers dress alike.

import { FACE, REGIONS } from './rig.js';
import { Painter, MAT, shade, mix, Tiles } from './paint.js';
import { TexQuality, rng } from '../gfx/texkit.js';
import { STYLE } from '../gfx/style.js';

// ---------------------------- flesh & faces ----------------------------------
export const SKIN = {
  grey:      '#8d917c',
  pale:      '#aaa596',
  green:     '#7e9460',
  blue:      '#7f8b98',
  yellow:    '#a7a26d',
  bruised:   '#8b7a86',
  porcelain: '#e9e4da',
  ash:       '#9a958c',
};

function flesh(P, skin, o = {}) {
  P.fill(skin, MAT.skin);
  P.mottle(shade(skin, -0.22), 0.45, 3, 1);
  P.mottle('#5a3a48', 0.28, 5, 2);
  P.mottle('#56703a', o.green ?? 0.2, 4, 3);
  P.noise(0.18, 'overlay', 18, 3, 4);
  P.veins(o.veins ?? 10, o.veinColor || '#3a2a48', 0.3);
  // pores / speckles
  for (let i = 0; i < 60; i++) P.circle(P.r(0, P.W), P.r(0, P.H), P.r(0.0006, 0.0016), shade(skin, -0.3), null, { alpha: 0.5 });
}

/** 1930s: a rubber-hose face — pale muzzle mask, black button nose, heavy brows, big grin */
function toonFace(P, o) {
  const { cx, eyeY, noseY, mouthY } = FACE;
  const ink = '#1d130c';
  const mask = mix(o.skin, '#f4ead0', o.living ? 0.25 : 0.55);
  // the pie-face mask round the eyes and the muzzle
  P.ellipse(cx, 0.098, 0.07, 0.066, mask);
  P.ellipse(cx - 0.028, eyeY + 0.002, 0.032, 0.04, mask);
  P.ellipse(cx + 0.028, eyeY + 0.002, 0.032, 0.04, mask);
  // the button nose, with a shine
  P.ellipse(cx, noseY + 0.004, 0.014, 0.011, ink);
  P.ellipse(cx - 0.004, noseY + 0.008, 0.004, 0.003, '#f4ead0');
  // brows: heavy and cross for the dead, friendly for the living
  for (const s of [-1, 1]) {
    const x0 = cx + s * 0.012, x1 = cx + s * 0.05;
    const y0 = eyeY + (o.living ? 0.036 : 0.03), y1 = eyeY + (o.living ? 0.036 : 0.044);
    P.line([[x0, y0], [(x0 + x1) / 2, (y0 + y1) / 2 + 0.004], [x1, y1]], 0.007, ink);
  }
  // the mouth: a big grin
  const my = mouthY + 0.006, w = o.living ? 0.036 : 0.05;
  P.path((c) => {
    c.moveTo(cx - w, my + 0.01);
    c.quadraticCurveTo(cx, my - (o.living ? 0.03 : 0.052), cx + w, my + 0.01);
    c.quadraticCurveTo(cx, my - 0.008, cx - w, my + 0.01);
  }, ink);
  if (!o.living) {
    // a stitched-up scar across the brow
    const sx0 = cx + 0.018, sy0 = eyeY + 0.07;
    P.line([[sx0 - 0.03, sy0 + 0.01], [sx0 + 0.035, sy0 - 0.012]], 0.004, ink);
    for (let i = 0; i < 5; i++) {
      const t = i / 4, x = sx0 - 0.026 + t * 0.056, y = sy0 + 0.008 - t * 0.019;
      P.line([[x - 0.004, y - 0.008], [x + 0.004, y + 0.008]], 0.0028, ink);
    }
    P.path((c) => { c.ellipse(cx + 0.006, my - 0.026, 0.02, 0.01, 0, 0, Math.PI * 2); }, '#c83a3a');   // the tongue
    for (let i = -3; i <= 3; i++) {                                                                     // a row of teeth
      const tx = cx + i * (w / 4.2);
      const ty = my + 0.004 - Math.abs(i) * 0.0022;
      P.rect(tx - 0.0045, ty - 0.008, 0.009, 0.009, '#f4ead0');
    }
  } else {
    P.path((c) => { c.moveTo(cx - w * 0.7, my - 0.004); c.quadraticCurveTo(cx, my - 0.016, cx + w * 0.7, my - 0.004); c.lineTo(cx + w * 0.6, my + 0.002); c.quadraticCurveTo(cx, my - 0.006, cx - w * 0.6, my + 0.002); }, '#f4ead0');
  }
  if (o.hair && !o.bald) hairCap(P, o);
}

/**
 * 1930s ink-and-paint: the painted detail melts into flat colour, strong
 * colour changes get an inked line, gloves go white and shoes go black.
 */
function inkAndPaint(cv, k) {
  const S = cv.width;
  const c = cv.getContext('2d', { willReadFrequently: true });
  // (full resolution: the fabric weave, stitching and grime all stay — detail)
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
  const img = c.getImageData(0, 0, S, S), d = img.data;
  // where the colour changes hard, ink (found before flattening so shading bands don't count)
  const ink = new Uint8Array(S * S);
  const at = (i) => i * 4;
  // (the face is drawn with its own clean lines — inking it again doubled them into jaggies)
  const Hd = REGIONS.head, hx0 = Hd.x * k, hx1 = (Hd.x + Hd.w) * k, hy1 = (Hd.y + Hd.h) * k;
  for (let y = 1; y < S - 1; y++) {
    for (let x = 1; x < S - 1; x++) {
      if (x >= hx0 && x < hx1 && y < hy1) continue;
      const i = y * S + x, a = at(i);
      const b = at(i + 1), u = at(i + S);
      const dx = Math.abs(d[a] - d[b]) + Math.abs(d[a + 1] - d[b + 1]) + Math.abs(d[a + 2] - d[b + 2]);
      const dy = Math.abs(d[a] - d[u]) + Math.abs(d[a + 1] - d[u + 1]) + Math.abs(d[a + 2] - d[u + 2]);
      if (dx > 140 || dy > 140) { ink[i] = 1; ink[i + 1] = 1; }
    }
  }
  // soften the ink mask (3x3) so painted lines are anti-aliased, not pixel stair-steps
  const inkA = new Float32Array(S * S);
  for (let y = 1; y < S - 1; y++) {
    for (let x = 1; x < S - 1; x++) {
      const i = y * S + x;
      const n = ink[i - S - 1] + ink[i - S] + ink[i - S + 1] + ink[i - 1] + ink[i] * 4 + ink[i + 1] + ink[i + S - 1] + ink[i + S] + ink[i + S + 1];
      inkA[i] = Math.min(1, n / 7);
    }
  }
  // lean toward painted steps of luminance (hue kept) without flattening the detail away
  for (let i = 0; i < S * S; i++) {
    const a = at(i);
    const r = d[a], g = d[a + 1], b = d[a + 2];
    const L = 0.3 * r + 0.59 * g + 0.11 * b + 1;
    const q = Math.max(18, Math.round((L / 255) * 7) / 7 * 255 + 10);
    const s = 0.65 + 0.35 * (q / L);
    // and a little of the aged, warm cel paint
    d[a] = Math.min(255, r * s * 1.02 + 4);
    d[a + 1] = Math.min(255, g * s * 0.99 + 3);
    d[a + 2] = Math.min(255, b * s * 0.9);
    const w = inkA[i];
    if (w > 0) { d[a] += (29 - d[a]) * w; d[a + 1] += (19 - d[a + 1]) * w; d[a + 2] += (12 - d[a + 2]) * w; }
  }
  c.putImageData(img, 0, 0);
  // white cartoon gloves (with a rolled cuff line) and glossy black shoes
  const H = REGIONS.hands, Sh = REGIONS.shoes;
  c.fillStyle = '#f6efdf';
  c.fillRect(H.x * k, H.y * k, H.w * k, H.h * k);
  c.fillStyle = '#d8ccb0';
  c.fillRect(H.x * k, (H.y + H.h * 0.08) * k, H.w * 0.3 * k, H.h * 0.05 * k);
  c.fillStyle = '#1d130c';
  c.fillRect(Sh.x * k, Sh.y * k, Sh.w * k, Sh.h * k);
  c.fillStyle = 'rgba(255,244,220,0.35)';
  c.fillRect(Sh.x * k, (Sh.y + Sh.h * 0.3) * k, Sh.w * 0.08 * k, Sh.h * 0.4 * k);
  c.restore();
}

/** the players: alive, shaved, a little smug */
function livingFace(P, o) {
  const { cx, eyeDX, eyeY, noseY, mouthY } = FACE;
  for (const s of [-1, 1]) {
    P.spot(cx + s * 0.05, 0.1, 0.03, '#d86a5a', 0.18);                        // a little colour in the cheeks
    P.ellipse(cx + s * eyeDX, eyeY, 0.014, 0.008, '#f4efe4');
    P.ellipse(cx + s * eyeDX, eyeY, 0.0065, 0.0065, '#3a2a1a');
    P.ellipse(cx + s * eyeDX, eyeY, 0.003, 0.003, '#0a0605');
    for (let i = 0; i < 12; i++) {
      const t = i / 11, x = cx + s * (0.018 + t * 0.03), y = eyeY + 0.02 + Math.sin(t * Math.PI) * 0.004;
      P.line([[x, y], [x + s * 0.005, y + 0.002]], 0.0018, o.hair || '#2a211a', null, { alpha: 0.9 });
    }
  }
  P.spot(cx, noseY + 0.02, 0.012, '#ffffff', 0.1);
  for (const s of [-1, 1]) P.ellipse(cx + s * 0.0085, noseY - 0.004, 0.0035, 0.0024, '#5a2a22', null, { alpha: 0.6 });
  P.line([[cx - 0.02, mouthY + 0.001], [cx, mouthY - 0.002], [cx + 0.022, mouthY + 0.004]], 0.003, '#7a3a34');   // the smirk
  if (o.hair && !o.bald) hairCap(P, o);
}

function face(P, o) {
  const skin = o.skin;
  const { cx, eyeDX, eyeY, noseY, mouthY, chinY, browY, hairY, earDX, earY } = FACE;
  P.use('head');
  flesh(P, skin, { veins: o.living || o.toon ? 0 : 7, veinColor: o.veinColor });
  if (o.toon) { toonFace(P, o); return; }
  if (o.living) { livingFace(P, o); return; }
  // hollow cheeks + temples
  for (const s of [-1, 1]) {
    P.spot(cx + s * 0.052, 0.094, 0.032, '#3a2230', 0.35);
    P.spot(cx + s * 0.075, 0.14, 0.03, '#3a2230', 0.25);
    P.spot(cx + s * earDX, earY, 0.02, '#5a3040', 0.35);
  }
  // sunken eye sockets
  for (const s of [-1, 1]) {
    P.spot(cx + s * eyeDX, eyeY - 0.004, 0.034, '#2a1420', 0.7, null, 0.8);
    P.spot(cx + s * eyeDX, eyeY, 0.02, '#0c0306', 0.95, null, 0.75);
    P.spot(cx + s * eyeDX, eyeY - 0.022, 0.018, '#4a2040', 0.35);         // bags
    if (o.eyeGlow) P.glowSpot(cx + s * eyeDX, eyeY, 0.024, o.eyeGlow, 0.55);
  }
  // brows
  if (o.brows !== false) {
    for (const s of [-1, 1]) {
      for (let i = 0; i < 14; i++) {
        const t = i / 13;
        const x = cx + s * (0.018 + t * 0.03), y = browY - 0.004 + Math.sin(t * Math.PI) * 0.004;
        P.line([[x, y], [x + s * 0.005, y + 0.002]], 0.0016, o.hair || '#2a211a', null, { alpha: 0.8 });
      }
    }
  }
  // nose shading + nostrils
  P.spot(cx, noseY + 0.02, 0.012, '#ffffff', 0.08);
  for (const s of [-1, 1]) {
    P.spot(cx + s * 0.012, noseY + 0.006, 0.012, '#3a2230', 0.35);
    P.ellipse(cx + s * 0.0085, noseY - 0.004, 0.004, 0.0028, '#1a0608', null, { alpha: 0.9 });
  }
  // mouth: slack, open, teeth
  const mw = o.mouthW ?? 0.027;
  P.spot(cx, mouthY, 0.04, '#3a1a22', 0.4);
  P.ellipse(cx, mouthY, mw, 0.0105, '#140304', MAT.wet);
  P.ellipse(cx, mouthY - 0.003, mw * 0.7, 0.006, '#3a0a0e', MAT.wet, { alpha: 0.8 });
  const toothC = o.teeth || '#cfc398';
  for (let i = -3; i <= 3; i++) {
    if (P.rand() < 0.2) continue;
    const tx = cx + i * (mw / 3.6);
    P.rect(tx - 0.0028, mouthY + 0.003, 0.0052, 0.0055, shade(toothC, P.r(-0.12, 0.04)), MAT.teeth);
    if (P.rand() < 0.75 && Math.abs(i) < 3) P.rect(tx - 0.0026, mouthY - 0.0085, 0.005, 0.005, shade(toothC, P.r(-0.18, 0)), MAT.teeth);
  }
  P.path((c) => c.ellipse(cx, mouthY, mw + 0.002, 0.012, 0, 0, Math.PI * 2), '#3a1a28', null, { stroke: 0.003, alpha: 0.8 });
  // gore around the mouth, dripping off the chin
  const mouthGore = o.mouthGore || '#4a0507';
  P.splat(cx + P.r(-0.01, 0.01), mouthY - 0.012, 0.009, mouthGore, 0.75, false);
  for (let i = 0; i < 3; i++) P.drip(cx + P.r(-0.022, 0.022), mouthY - 0.006, P.r(0.02, 0.06), 0.004, mouthGore, 0.8);
  // stitches / scar
  if (o.scar) {
    const sx = cx + (P.rand() < 0.5 ? -1 : 1) * 0.05;
    P.line([[sx - 0.01, 0.17], [sx + 0.006, 0.09]], 0.004, '#5a2a30', null, { alpha: 0.9 });
    for (let i = 0; i < 6; i++) {
      const t = i / 5, y = 0.165 - t * 0.07, x = sx - 0.009 + t * 0.015;
      P.line([[x - 0.006, y - 0.001], [x + 0.006, y + 0.001]], 0.0012, '#141010');
    }
  }
  if (o.faceWound) P.wound(cx + P.pick([-1, 1]) * P.r(0.03, 0.07), P.r(0.06, 0.16), 0.012, skin);
  // hair
  if (o.hair && !o.bald) hairCap(P, o);
  if (o.bald) {
    P.spot(cx, 0.22, 0.12, '#ffffff', 0.07);
    for (let i = 0; i < 2; i++) P.wound(P.r(0.05, P.W - 0.05), P.r(0.16, 0.22), 0.01, skin);
  }
}

function hairCap(P, o) {
  const { cx, hairY } = FACE;
  const col = o.hair;
  const W = P.W;
  const line = [[0, 0.08], [0.06, 0.082], [0.12, 0.115], [0.145, 0.16], [0.18, 0.168]];
  const recede = o.recede ?? 0.008;
  const front = [[cx - 0.06, hairY + recede], [cx - 0.025, hairY - 0.004 + recede * 2], [cx, hairY + recede * 2.5], [cx + 0.025, hairY - 0.004 + recede * 2], [cx + 0.06, hairY + recede]];
  const pts = [...line, ...front, ...line.map(([x, y]) => [W - x, y]).reverse(), [W, 0.25], [0, 0.25]];
  P.poly(pts, col, MAT.hair);
  // strands
  for (let i = 0; i < 380; i++) {
    const x = P.r(0, W), y = P.r(0.09, 0.24);
    const len = P.r(0.01, 0.03);
    const toBack = x < cx ? -1 : 1;
    P.line([[x, y], [x + toBack * len * 0.35, y - len]], P.r(0.0008, 0.0016), shade(col, P.r(-0.12, 0.14)), null, { alpha: 0.55 });
  }
  // patchy scalp showing through, scabbed over
  for (let i = 0; i < (o.patchy ?? 3); i++) {
    const x = P.r(0.05, W - 0.05), y = P.r(0.17, 0.23), r = P.r(0.012, 0.022);
    P.spot(x, y, r * 1.6, shade(o.skin, -0.25), 0.7);
    P.spot(x, y, r, '#4a2a30', 0.35);
    if (P.rand() < 0.5) P.poly(P.blob(x, y, r * 0.4, 0.8), '#3a0a0c', MAT.wet, { alpha: 0.8 });
  }
  P.spot(cx, 0.21, 0.1, '#ffffff', 0.05);
}

function neckSkin(P, o) {
  P.use('neck');
  flesh(P, o.skin, { veins: 8, veinColor: o.veinColor });
  P.vgrad(0.1, 0.24, '#1a0a10', 0.0, 0.35);     // shadow under the jaw
  for (let i = 0; i < 3; i++) P.drip(P.W / 2 + P.r(-0.03, 0.03), 0.23, P.r(0.05, 0.12), 0.004, o.mouthGore || '#4a0507', 0.7);
  if (o.biteNeck) P.wound(P.W / 2 + P.r(0.05, 0.09), P.r(0.1, 0.16), 0.018, o.skin);
}

/** shirt collar wrapped around the base of the neck */
function neckCollar(P, color, open = false) {
  P.use('neck');
  const W = P.W, cx = W / 2;
  const top = 0.125;
  if (open) {
    P.poly([[0, 0], [W, 0], [W, top], [cx + 0.05, top - 0.01], [cx + 0.02, 0.04], [cx - 0.02, 0.04], [cx - 0.05, top - 0.01], [0, top]], color, MAT.cloth);
  } else {
    P.poly([[0, 0], [W, 0], [W, top], [cx + 0.012, top - 0.005], [cx, 0.07], [cx - 0.012, top - 0.005], [0, top]], color, MAT.cloth);
  }
  P.line([[0, top], [W, top]], 0.004, shade(color, -0.25), null, { alpha: 0.6 });
  P.vgrad(0, 0.05, '#000', 0.25, 0);
  P.noise(0.12, 'multiply', 10, 3, 5);
}

// ------------------------------- torso ---------------------------------------
// torso region: x 0.25 = character's right side, 0.5 = front, 0.75 = left side.
// y: 0 crotch, ~0.19 belt, ~0.47 chest, ~0.66 collar.
function cloth(P, color, o = {}) {
  P.fill(color, o.mat || MAT.cloth);
  P.noise(o.mottle ?? 0.2, 'overlay', 5, 4, 11);
  if (o.weave !== false) P.pattern(Tiles.weave('rgba(0,0,0,0.14)'), 1);
  if (o.pinstripe) {
    const { color: pc, gap = 0.014, alpha = 0.35 } = o.pinstripe;
    for (let x = 0; x < P.W; x += gap) P.line([[x, -0.01], [x, P.H + 0.01]], 0.0011, pc, null, { alpha });
  }
  if (o.sequins) {
    for (let i = 0; i < 2600; i++) {
      P.circle(P.r(0, P.W), P.r(0, P.H), 0.0022, shade(color, P.r(-0.25, 0.3)), MAT.sequin, { alpha: 0.9 });
    }
  }
  if (o.stars) {
    for (let i = 0; i < 26; i++) star(P, P.r(0.02, P.W - 0.02), P.r(0.02, P.H - 0.02), P.r(0.008, 0.014), o.stars);
  }
  if (o.dirt !== false) P.mottle('#3a2c1c', o.dirtAmt ?? 0.18, 3, 17);
}

function star(P, x, y, r, color) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
    const rr = i % 2 ? r * 0.42 : r;
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
  }
  P.poly(pts, color, MAT.gold);
}

function shirtFront(P, o) {
  const s = o.shirt;
  cloth(P, s, { mottle: 0.12, dirtAmt: 0.22 });
  // armpit + collar grime
  for (const x of [0.25, 0.75]) P.spot(x, 0.48, 0.08, '#8a7a3a', 0.25, null, 1.4);
  P.vgrad(0.55, 0.68, '#6a5a3a', 0, 0.2);
  if (!o.openCollar) {
    P.rect(0.5 - 0.013, 0.17, 0.026, 0.5, shade(s, -0.05));
    P.line([[0.487, 0.17], [0.487, 0.67]], 0.0016, shade(s, -0.25));
    P.line([[0.513, 0.17], [0.513, 0.67]], 0.0016, shade(s, -0.18), null, { alpha: 0.6 });
    for (let y = 0.23; y < 0.62; y += 0.072) P.button(0.5, y, 0.0045, shade(s, 0.02));
  } else {
    // unbuttoned down the chest: skin shows in a V
    P.poly([[0.46, 0.68], [0.54, 0.68], [0.505, 0.5], [0.495, 0.5]], o.skin, MAT.skin);
    P.rect(0.5 - 0.012, 0.17, 0.024, 0.33, shade(s, -0.05));
    for (let y = 0.23; y < 0.48; y += 0.072) P.button(0.5, y, 0.0045, shade(s, 0.02));
  }
  // collar points
  for (const sx of [-1, 1]) {
    P.poly([[0.5 + sx * 0.012, 0.675], [0.5 + sx * 0.1, 0.685], [0.5 + sx * 0.05, 0.6]], shade(s, 0.03), MAT.cloth);
    P.line([[0.5 + sx * 0.1, 0.685], [0.5 + sx * 0.05, 0.6]], 0.002, shade(s, -0.3), null, { alpha: 0.6 });
  }
  // tucked-in folds at the belt
  for (let i = 0; i < 9; i++) {
    const x = P.r(0.3, 0.7);
    P.curve([[x, 0.2], [x + P.r(-0.02, 0.02), 0.25], [x + P.r(-0.03, 0.03), 0.3]], 0.004, shade(s, -0.18), null, { alpha: 0.35 });
  }
}

function tie(P, color, o = {}) {
  const k = o.skew || 0, top = o.loose ? 0.6 : 0.655;
  const cx = 0.5 + k * 0.3;
  const stripe = o.stripe || shade(color, 0.18);
  P.poly([[cx - 0.017, top], [cx + 0.017, top], [cx + 0.011, top - 0.028], [cx - 0.011, top - 0.028]], shade(color, -0.05), MAT.silk);
  const blade = [[cx - 0.011, top - 0.028], [cx + 0.011, top - 0.028], [cx + 0.031 + k, 0.31], [cx + k, 0.285], [cx - 0.031 + k, 0.31]];
  P.poly(blade, color, MAT.silk);
  P.clipTo(blade, () => {
    for (let y = 0.27; y < top; y += 0.03) {
      P.line([[cx - 0.05 + k, y], [cx + 0.05 + k, y + 0.035]], 0.004, stripe, null, { alpha: 0.7 });
    }
  });
  P.line([[cx, top - 0.028], [cx + k * 0.9, 0.29]], 0.002, shade(color, -0.3), null, { alpha: 0.4 });
  if (o.loose) P.line([[cx - 0.017, top], [cx - 0.07, 0.68]], 0.009, color, MAT.silk);
}

function bowtieFront(P, color) {
  P.poly([[0.5, 0.64], [0.465, 0.665], [0.465, 0.615]], color, MAT.silk);
  P.poly([[0.5, 0.64], [0.535, 0.665], [0.535, 0.615]], color, MAT.silk);
  P.rect(0.492, 0.628, 0.016, 0.024, shade(color, -0.1), MAT.silk);
}

/** trousers from the crotch up to the belt (torso bottom) */
function trouserTop(P, o) {
  const col = o.pants;
  P.rect(-0.01, -0.01, P.W + 0.02, 0.2, col, MAT.cloth);
  P.line([[0.5, 0.0], [0.5, 0.17]], 0.0022, shade(col, -0.2));
  P.line([[0.515, 0.03], [0.515, 0.17]], 0.0015, shade(col, -0.15), null, { alpha: 0.6 });
  P.vgrad(0, 0.05, '#000', 0.4, 0);
  // belt
  const belt = o.belt || '#1a120c';
  P.rect(-0.01, 0.168, P.W + 0.02, 0.034, belt, MAT.leather);
  P.line([[0, 0.172], [P.W, 0.172]], 0.0012, shade(belt, 0.2), null, { alpha: 0.4 });
  P.line([[0, 0.198], [P.W, 0.198]], 0.0012, shade(belt, 0.2), null, { alpha: 0.4 });
  for (const x of [0.33, 0.67, 0.12, 0.88]) P.rect(x - 0.006, 0.164, 0.012, 0.042, shade(col, -0.05), MAT.cloth);
  const buckle = o.buckle || '#c9a227';
  P.rect(0.482, 0.166, 0.036, 0.038, buckle, MAT.gold);
  P.rect(0.489, 0.173, 0.022, 0.024, belt, MAT.leather);
  P.rect(0.495, 0.183, 0.03, 0.004, shade(buckle, -0.1), MAT.gold);
}

function jacketTorso(P, o) {
  const col = o.jacket, open = o.jacketOpen ? 1 : 0;
  const lap = o.lapel || shade(col, -0.04);
  // front opening (shows what's painted underneath)
  const hole = open
    ? [[0.5 - 0.085, 0.69], [0.5 + 0.085, 0.69], [0.5 + 0.07, 0.3], [0.5 + 0.08, -0.02], [0.5 - 0.08, -0.02], [0.5 - 0.07, 0.3]]
    : [[0.5 - 0.075, 0.69], [0.5 + 0.075, 0.69], [0.502, 0.31], [0.5 + 0.004, 0.2], [0.5 + 0.06, -0.02], [0.5 - 0.06, -0.02], [0.5 - 0.004, 0.2], [0.498, 0.31]];
  P.path((c) => {
    c.rect(-0.01, -0.01, P.W + 0.02, P.H + 0.02);
    c.moveTo(hole[0][0], hole[0][1]);
    for (const p of hole.slice(1)) c.lineTo(p[0], p[1]);
    c.closePath();
  }, col, o.jacketMat || MAT.cloth, { rule: 'evenodd' });
  if (o.jacketCloth) o.jacketCloth(P, hole);
  // lapels
  for (const sx of [-1, 1]) {
    const e0 = [0.5 + sx * (open ? 0.085 : 0.075), 0.69];
    const e1 = [0.5 + sx * (open ? 0.07 : 0.002), open ? 0.3 : 0.31];
    const pts = [e0, e1, [e1[0] + sx * 0.012, e1[1] + 0.03], [0.5 + sx * 0.14, 0.55], [0.5 + sx * 0.12, 0.6], [0.5 + sx * 0.15, 0.62], [0.5 + sx * 0.13, 0.69]];
    P.poly(pts, lap, o.lapelMat || MAT.cloth);
    P.line([[e1[0] + sx * 0.012, e1[1] + 0.03], [0.5 + sx * 0.14, 0.55], [0.5 + sx * 0.12, 0.6]], 0.003, shade(col, -0.3), null, { alpha: 0.7 });
    P.line([e0, e1], 0.0035, shade(col, -0.35), null, { alpha: 0.8 });
  }
  // buttons
  const bc = o.jacketButton || shade(col, -0.15);
  if (open) {
    P.button(0.5 + 0.1, 0.29, 0.0075, bc);
    P.button(0.5 + 0.1, 0.21, 0.0075, bc);
  } else {
    P.button(0.5, 0.285, 0.0075, bc);
    P.button(0.502, 0.21, 0.0075, bc);
  }
  // pockets
  P.rect(0.585, 0.46, 0.075, 0.009, shade(col, -0.25));
  if (o.pocketSquare) {
    P.poly([[0.595, 0.468], [0.61, 0.49], [0.622, 0.47], [0.636, 0.492], [0.648, 0.468]], o.pocketSquare, MAT.silk);
  }
  for (const x of [0.36, 0.64]) {
    P.rect(x - 0.05, 0.125, 0.1, 0.028, shade(col, 0.03), o.jacketMat || MAT.cloth);
    P.line([[x - 0.05, 0.125], [x + 0.05, 0.125]], 0.003, shade(col, -0.35), null, { alpha: 0.8 });
  }
  // seams: sides, back, vent, darts
  for (const x of [0.25, 0.75]) P.seam([[x, -0.01], [x, 0.5]], col);
  P.seam([[0.003, 0], [0.003, 0.66]], col);
  P.seam([[0.997, 0], [0.997, 0.66]], col);
  P.line([[0.004, 0], [0.004, 0.12]], 0.004, shade(col, -0.4), null, { alpha: 0.7 });
  // folds at the waist + under the arms, AO under the collar and at the hem
  for (let i = 0; i < 10; i++) {
    const x = P.pick([P.r(0.18, 0.32), P.r(0.68, 0.82)]);
    const y = P.r(0.2, 0.5);
    P.fold([[x - 0.035, y], [x, y + P.r(-0.012, 0.012)], [x + 0.035, y + P.r(-0.01, 0.01)]], col, 0.28);
  }
  for (const x of [0.25, 0.75]) P.spot(x, 0.5, 0.09, '#000000', 0.3, null, 1.3);
  P.vgrad(0.62, 0.69, shade(col, -0.3), 0, 0.5);
  P.vgrad(0, 0.06, '#000000', 0.3, 0);
}

function vestTorso(P, o) {
  const col = o.vest;
  const trim = o.vestTrim;
  const back = o.vestBack || shade(col, 0.06);
  // back panel in satin
  P.rect(-0.01, 0.12, 0.21, 0.6, back, MAT.satin);
  P.rect(0.8, 0.12, 0.21, 0.6, back, MAT.satin);
  // front panels: V neck, armholes, pointed bottom
  const front = [
    [0.2, 0.2], [0.2, 0.52], [0.3, 0.6], [0.43, 0.66], [0.5, 0.42], [0.57, 0.66], [0.7, 0.6], [0.8, 0.52], [0.8, 0.2],
    [0.6, 0.16], [0.508, 0.11], [0.5, 0.14], [0.492, 0.11], [0.4, 0.16],
  ];
  P.poly(front, col, o.vestMat || MAT.cloth);
  if (o.vestPattern) o.vestPattern(P, front);
  // armholes (shirt shows) — back edge
  for (const x of [0.23, 0.77]) P.ellipse(x, 0.585, 0.055, 0.09, o.shirt, MAT.cloth);
  if (trim) {
    P.line([[0.43, 0.66], [0.5, 0.42], [0.57, 0.66]], 0.006, trim, MAT.gold);
    P.line([[0.2, 0.2], [0.4, 0.16], [0.492, 0.11], [0.5, 0.14], [0.508, 0.11], [0.6, 0.16], [0.8, 0.2]], 0.006, trim, MAT.gold);
  } else {
    P.line([[0.43, 0.66], [0.5, 0.42], [0.57, 0.66]], 0.003, shade(col, -0.35), null, { alpha: 0.7 });
  }
  P.line([[0.5, 0.42], [0.5, 0.14]], 0.0025, shade(col, -0.35));
  for (let y = 0.38; y > 0.15; y -= 0.047) P.button(0.506, y, 0.006, o.vestButton || (trim ? '#d8b23a' : shade(col, -0.2)), trim ? MAT.gold : MAT.plastic);
  for (const x of [0.4, 0.6]) P.rect(x - 0.03, 0.27, 0.06, 0.006, shade(col, -0.3));
  if (o.watchChain) P.curve([[0.506, 0.29], [0.56, 0.24], [0.6, 0.275]], 0.003, '#d8b23a', MAT.gold);
  for (let i = 0; i < 8; i++) {
    const x = P.r(0.3, 0.7), y = P.r(0.2, 0.4);
    P.curve([[x - 0.02, y], [x, y + 0.01], [x + 0.02, y]], 0.003, shade(col, -0.25), null, { alpha: 0.3 });
  }
}

function barechest(P, o) {
  // open jacket/shirt over a bloated rotten belly
  P.poly([[0.38, 0.69], [0.62, 0.69], [0.6, 0.2], [0.4, 0.2]], o.skin, MAT.skin);
  P.spot(0.5, 0.33, 0.14, '#5a6a2a', 0.35);
  for (let i = 0; i < 12; i++) P.circle(P.r(0.41, 0.59), P.r(0.24, 0.6), P.r(0.004, 0.009), '#b8b050', MAT.wet, { alpha: 0.8 });
  P.ellipse(0.5, 0.25, 0.006, 0.009, '#2a1a10');
  for (let i = 0; i < 16; i++) {
    let x = P.r(0.4, 0.6), y = P.r(0.22, 0.62);
    const pts = [[x, y]];
    for (let s = 0; s < 7; s++) { x += P.r(-0.012, 0.012); y += P.r(-0.014, 0.014); pts.push([x, y]); }
    P.curve(pts, 0.002, '#2a4a1a', null, { alpha: 0.55 });
  }
  P.wound(P.r(0.44, 0.56), P.r(0.35, 0.5), 0.014, o.skin);
}

// ------------------------------- limbs ---------------------------------------
function sleeve(P, side, o) {
  P.use('arm' + side);
  const R = P.reg, W = P.W;
  const inner = (1 - R.outer) * W, outer = R.outer * W;
  const kind = o.sleeves;   // 'jacket' | 'shirt' | 'rolled' | 'bare'
  if (kind === 'bare') {
    flesh(P, o.skin, { veins: 14, veinColor: o.veinColor });
    P.wound(P.r(0.05, W - 0.05), P.r(0.12, 0.5), 0.016, o.skin);
    return;
  }
  const col = kind === 'jacket' ? o.jacket : o.shirt;
  cloth(P, col, { mat: kind === 'jacket' ? (o.jacketMat || MAT.cloth) : MAT.cloth, pinstripe: kind === 'jacket' ? o.pinstripe : null, sequins: kind === 'jacket' && o.sequins, stars: kind === 'jacket' && o.stars });
  P.seam([[inner, 0.05], [inner, 0.64]], col);
  // elbow crease at the front (inner elbow faces forward)
  for (let i = 0; i < 4; i++) {
    const y = 0.26 + i * 0.016 + P.r(-0.004, 0.004);
    P.fold([[W / 2 - 0.05, y], [W / 2, y - 0.008], [W / 2 + 0.05, y]], col, 0.3);
  }
  P.hgrad(inner - 0.06, inner, '#000000', 0, 0.18);
  P.hgrad(inner + 0.06, inner, '#000000', 0, 0.18);
  if (kind === 'jacket') {
    // shirt cuff + cufflink below the sleeve
    P.rect(-0.01, 0.0, W + 0.02, 0.078, o.shirt, MAT.cloth);
    P.line([[0, 0.078], [W, 0.078]], 0.004, shade(col, -0.4));
    P.line([[0, 0.052], [W, 0.052]], 0.0015, shade(o.shirt, -0.2), null, { alpha: 0.6 });
    P.circle(outer, 0.062, 0.0045, o.cufflink || '#c9a227', MAT.gold);
    for (let i = 0; i < 3; i++) P.button(outer + (i - 1) * 0.012, 0.1, 0.0035, shade(col, -0.2));
  } else if (kind === 'shirt') {
    P.rect(-0.01, 0.0, W + 0.02, 0.07, shade(col, 0.02), MAT.cloth);
    P.line([[0, 0.07], [W, 0.07]], 0.0025, shade(col, -0.25), null, { alpha: 0.7 });
    P.button(outer, 0.04, 0.004, shade(col, 0.02));
  } else if (kind === 'rolled') {
    // shirt rolled above the elbow; rotten forearm below
    const skin = o.skin;
    P.clipTo([[-0.01, -0.01], [W + 0.01, -0.01], [W + 0.01, 0.33], [-0.01, 0.33]], () => {
      flesh(P, skin, { veins: 12, veinColor: o.veinColor });
    });
    P.rect(-0.01, 0.30, W + 0.02, 0.045, shade(col, 0.03), MAT.cloth);
    P.line([[0, 0.31], [W, 0.31]], 0.004, shade(col, -0.3), null, { alpha: 0.7 });
    P.line([[0, 0.345], [W, 0.345]], 0.003, shade(col, -0.2), null, { alpha: 0.6 });
    P.wound(P.r(0.06, W - 0.06), P.r(0.08, 0.24), 0.016, skin);
  }
  if (o.garter) {
    P.rect(-0.01, 0.46, W + 0.02, 0.022, o.garter, MAT.silk);
    P.line([[0, 0.462], [W, 0.462]], 0.0015, shade(o.garter, -0.3));
  }
  if (o.armband) P.rect(-0.01, 0.44, W + 0.02, 0.05, o.armband, MAT.cloth);
  // gore on the forearms
  for (let i = 0; i < (o.gore ?? 2); i++) P.splat(P.r(0.02, W - 0.02), P.r(0.03, 0.3), P.r(0.008, 0.02), '#4a0507', 0.8);
  if (P.rand() < (o.tearChance ?? 0.4) && kind !== 'rolled') P.tear(P.r(0.06, W - 0.06), P.r(0.12, 0.5), P.r(0.018, 0.03), o.skin);
  P.mottle('#2a1c10', 0.16, 3, 21);
}

function trouserLeg(P, side, o) {
  P.use('leg' + side);
  const R = P.reg, W = P.W;
  const outer = R.outer * W, inner = (1 - R.outer) * W;
  const col = o.pants;
  cloth(P, col, { mat: o.pantsMat || MAT.cloth, pinstripe: o.pinstripe, sequins: o.sequins && o.pantsSequins, dirtAmt: 0.26 });
  // crease down the front
  P.line([[W / 2, 0.02], [W / 2, 0.95]], 0.004, shade(col, 0.12), null, { alpha: 0.5 });
  P.line([[W / 2 + 0.004, 0.02], [W / 2 + 0.004, 0.95]], 0.002, shade(col, -0.25), null, { alpha: 0.4 });
  P.seam([[outer, 0], [outer, 0.95]], col);
  P.seam([[inner, 0], [inner, 0.9]], col);
  if (o.stripe) {
    P.rect(outer - 0.011, 0, 0.022, 0.95, o.stripe, o.stripeMat || MAT.satin);
  }
  // knee bagging + wrinkles
  P.spot(W / 2, 0.44, 0.06, shade(col, 0.2), 0.2, null, 0.7);
  for (let i = 0; i < 5; i++) {
    const y = 0.4 + P.r(-0.03, 0.06);
    P.fold([[W / 2 - 0.08, y], [W / 2, y + P.r(-0.01, 0.01)], [W / 2 + 0.08, y + P.r(-0.01, 0.01)]], col, 0.25);
  }
  P.hgrad(inner - 0.08, inner, '#000000', 0, 0.22);
  P.hgrad(inner + 0.08, inner, '#000000', 0, 0.22);
  // hem + cuff break + mud
  P.rect(-0.01, -0.01, W + 0.02, 0.035, shade(col, -0.08), o.pantsMat || MAT.cloth);
  P.line([[0, 0.035], [W, 0.035]], 0.002, shade(col, -0.3), null, { alpha: 0.6 });
  P.vgrad(0, 0.24, '#3a2a16', 0.55, 0);
  P.mottle('#2a1c0c', 0.25, 4, 31);
  // tears + gore
  if (P.rand() < (o.legTear ?? 0.5)) P.tear(P.r(0.1, W - 0.1), P.r(0.3, 0.55), P.r(0.025, 0.045), o.skin);
  for (let i = 0; i < (o.legGore ?? 2); i++) P.splat(P.r(0.04, W - 0.04), P.r(0.2, 0.85), P.r(0.01, 0.025), '#3a0406', 0.75);
}

function shoes(P, o) {
  P.use('shoes');
  const W = P.W, H = P.H;
  const col = o.shoes || '#16110d';
  const mat = o.shoeMat || MAT.leather;
  P.fill(col, mat);
  P.noise(0.25, 'overlay', 8, 3, 41);
  // highlight along the top, sole around the bottom
  P.hgrad(W / 2 - 0.06, W / 2, '#ffffff', 0, 0.12);
  P.hgrad(W / 2 + 0.06, W / 2, '#ffffff', 0, 0.12);
  const sole = o.sole || '#0e0b09';
  P.rect(-0.01, -0.01, 0.045, H + 0.02, sole, MAT.plastic);
  P.rect(W - 0.035, -0.01, 0.045, H + 0.02, sole, MAT.plastic);
  P.line([[0.035, 0], [0.035, H]], 0.002, shade(col, 0.2), null, { alpha: 0.5 });
  P.line([[W - 0.035, 0], [W - 0.035, H]], 0.002, shade(col, 0.2), null, { alpha: 0.5 });
  P.rect(-0.01, -0.01, W + 0.02, 0.03, sole, MAT.plastic);   // heel
  if (o.twoTone) {
    P.rect(0.035, 0.18, W - 0.07, 0.1, o.twoTone, mat);
    P.rect(0.035, -0.01, W - 0.07, 0.06, o.twoTone, mat);
  }
  if (o.laces !== false) {
    // toe cap stitching + laces
    P.curve([[0.06, 0.2], [W / 2, 0.215], [W - 0.06, 0.2]], 0.002, shade(col, 0.25), null, { alpha: 0.5 });
    for (let y = 0.1; y < 0.17; y += 0.016) {
      for (const sx of [-1, 1]) P.circle(W / 2 + sx * 0.018, y, 0.003, '#8a8070', MAT.silver);
      P.line([[W / 2 - 0.018, y], [W / 2 + 0.018, y + 0.016]], 0.0035, o.lace || '#1a1612');
      P.line([[W / 2 + 0.018, y], [W / 2 - 0.018, y + 0.016]], 0.0035, o.lace || '#1a1612');
    }
  } else {
    // loafer strap
    P.rect(W / 2 - 0.035, 0.13, 0.07, 0.014, shade(col, -0.15), mat);
    P.ellipse(W / 2, 0.137, 0.008, 0.004, '#c9a227', MAT.gold);
  }
  // scuffs + grime
  for (let i = 0; i < 12; i++) P.line([[P.r(0.04, W - 0.04), P.r(0.03, H)], [P.r(0.04, W - 0.04), P.r(0.03, H)]], 0.0015, shade(col, 0.3), null, { alpha: 0.25 });
  P.mottle('#3a2a16', 0.35, 4, 43);
  P.splat(P.r(0.08, W - 0.08), P.r(0.08, 0.24), 0.01, '#3a0406', 0.7, false);
}

function hands(P, o) {
  P.use('hands');
  if (o.gloves) {
    cloth(P, o.gloves, { mat: o.gloveMat || MAT.cloth, mottle: 0.1, weave: o.gloveMat !== MAT.leather, dirtAmt: 0.25 });
    for (let i = 0; i < 5; i++) P.line([[i * 0.04 + 0.02, 0.1], [i * 0.04 + 0.02, 0.2]], 0.0015, shade(o.gloves, -0.2), null, { alpha: 0.5 });
    P.splat(P.r(0.02, 0.18), P.r(0.02, 0.12), 0.012, '#4a0507', 0.8, false);
    P.splat(P.r(0.02, 0.18), P.r(0.1, 0.18), 0.01, '#4a0507', 0.7, false);
    return;
  }
  flesh(P, o.skin, { veins: 12, veinColor: o.veinColor });
  // knuckle creases + filthy cracked nails on each fingertip
  for (let f = 0; f < 5; f++) {
    const x = f * 0.04 + 0.02;
    for (const y of [0.03, 0.058]) P.line([[x - 0.01, y], [x + 0.01, y]], 0.0012, shade(o.skin, -0.3), null, { alpha: 0.6 });
    P.ellipse(x, 0.008, 0.0075, 0.009, o.nails || '#5a4a2a', MAT.wet);
    P.line([[x - 0.004, 0.004], [x + 0.003, 0.014]], 0.0008, '#1a1208');
  }
  P.vgrad(0, 0.03, '#2a0a08', 0.5, 0);
  P.mottle('#3a1a10', 0.3, 4, 51);
  for (let i = 0; i < 3; i++) P.splat(P.r(0.02, 0.18), P.r(0.01, 0.16), P.r(0.008, 0.016), '#4a0507', 0.85);
}

function coatFabric(P, o) {
  P.use('coat');
  const col = o.coatColor || o.jacket;
  cloth(P, col, { mat: o.jacketMat || MAT.cloth, pinstripe: o.pinstripe, stars: o.stars });
  P.rect(-0.01, -0.01, P.W + 0.02, 0.02, shade(col, -0.2), o.jacketMat || MAT.cloth);
  P.line([[0, 0.02], [P.W, 0.02]], 0.003, shade(col, -0.35), null, { alpha: 0.7 });
  P.line([[P.W / 2, 0], [P.W / 2, 0.22]], 0.004, shade(col, -0.45));
  P.vgrad(0.4, 0.5, '#000', 0, 0.3);
  P.vgrad(0, 0.15, '#2a1c0c', 0.4, 0);
  for (let i = 0; i < 2; i++) P.tear(P.r(0.1, P.W - 0.1), P.r(0.04, 0.18), P.r(0.02, 0.035), o.pants || '#111');
  if (o.coatLining) P.rect(P.W - 0.02, -0.01, 0.03, P.H + 0.02, o.coatLining, MAT.satin);
}

// ------------------------------ the Strip's own ------------------------------
/** a showgirl's sequined leotard: bare shoulders, sweetheart neckline, rhinestone trim */
function showgirlTorso(P, o, suit) {
  flesh(P, o.skin, { veins: 6, veinColor: o.veinColor });
  // the bodice: everything below the bustline, cut high at the hips
  const top = (x) => 0.43 + 0.035 * Math.cos((x - 0.5) * Math.PI * 4) * (Math.abs(x - 0.5) < 0.25 ? 1 : 0.3);
  const pts = [];
  for (let x = -0.01; x <= 1.01; x += 0.02) pts.push([x, top(x)]);
  pts.push([1.01, -0.01], [-0.01, -0.01]);
  P.poly(pts, suit, MAT.sequin);
  P.clipTo(pts, () => {
    for (let i = 0; i < 2600; i++) P.circle(P.r(0, P.W), P.r(0, 0.46), 0.0022, shade(suit, P.r(-0.25, 0.35)), MAT.sequin, { alpha: 0.9 });
    // a diamond lattice of stones down the front
    for (let y = 0.08; y < 0.42; y += 0.05) for (let x = 0.38; x < 0.63; x += 0.05) P.circle(x + ((y * 20) % 2 ? 0.025 : 0), y, 0.004, '#f6f0ff', MAT.silver);
  });
  // rhinestone trim on the neckline and the high-cut legs
  for (let x = 0; x <= 1; x += 0.015) P.circle(x, top(x) - 0.004, 0.0038, '#fff6e0', MAT.silver);
  for (const cx of [0.25, 0.75]) P.curve([[cx - 0.2, 0.0], [cx, 0.07], [cx + 0.2, 0.0]], 0.004, '#fff6e0', MAT.silver);
  // a feather boa of pink fluff drooped across the shoulders at the back
  for (let i = 0; i < 140; i++) P.circle(P.r(0.85, 1.0) % 1, P.r(0.55, 0.66), P.r(0.004, 0.009), '#ffb0d8', MAT.silk, { alpha: 0.7 });
}

/** fishnet stockings over dead skin, a lace band at the thigh */
function fishnets(P, side, o) {
  P.use('leg' + side);
  const W = P.W;
  flesh(P, o.skin, { veins: 10, veinColor: o.veinColor });
  const net = 'rgba(12,8,14,0.85)';
  for (let k = -1.2; k < 1.2; k += 0.028) {
    P.line([[k, 0], [k + 1.0, 0.95]], 0.0018, net);
    P.line([[k + 1.0, 0], [k, 0.95]], 0.0018, net);
  }
  P.rect(-0.01, 0.84, W + 0.02, 0.05, '#141016', MAT.satin);
  for (let x = 0; x < W; x += 0.02) P.circle(x, 0.84, 0.007, '#1e1a22', MAT.satin);
  P.rect(-0.01, 0.89, W + 0.02, 0.07, o.suit || '#d8a020', MAT.sequin);   // the leotard's leg line
  P.line([[0, 0.89], [W, 0.89]], 0.003, '#fff6e0', MAT.silver);
  // runs in the stockings + gore
  for (let i = 0; i < 3; i++) P.tear(P.r(0.08, W - 0.08), P.r(0.2, 0.7), P.r(0.015, 0.03), o.skin);
  for (let i = 0; i < 2; i++) P.splat(P.r(0.04, W - 0.04), P.r(0.2, 0.8), P.r(0.01, 0.02), '#3a0406', 0.75);
  P.vgrad(0, 0.2, '#2a1a10', 0.35, 0);
}

/** the King's white jumpsuit: open to the chest, studs everywhere, a buckle the size of a plate */
function kingTorso(P, o) {
  const white = '#f2eee4';
  cloth(P, white, { mottle: 0.1, dirtAmt: 0.22 });
  // plunging V
  P.poly([[0.43, 0.69], [0.57, 0.69], [0.5, 0.38]], o.skin, MAT.skin);
  P.mottle('#3a2a1c', 0.2, 3, 5);
  for (let i = 0; i < 40; i++) P.line([[P.r(0.46, 0.54), P.r(0.5, 0.66)], [P.r(0.46, 0.54), P.r(0.5, 0.66)]], 0.001, '#1a1410', null, { alpha: 0.5 });
  // studs + stars in gold down the front and across the chest
  for (let y = 0.25; y < 0.65; y += 0.045) {
    for (const x of [0.4, 0.6]) P.circle(x + (y > 0.5 ? (x < 0.5 ? 0.03 : -0.03) : 0), y, 0.006, '#d8b23a', MAT.gold);
  }
  for (let i = 0; i < 16; i++) star(P, P.r(0.05, 0.95), P.r(0.22, 0.6), P.r(0.01, 0.016), '#d8b23a');
  // the collar stands up high around the neck
  P.rect(-0.01, 0.62, P.W + 0.02, 0.07, white, MAT.satin);
  for (let x = 0.02; x < 1; x += 0.04) P.circle(x, 0.655, 0.005, '#d8b23a', MAT.gold);
  // the belt: gold links and the giant buckle
  P.rect(-0.01, 0.15, P.W + 0.02, 0.05, '#c9a227', MAT.gold);
  for (let x = 0; x < 1; x += 0.03) P.rect(x, 0.155, 0.02, 0.04, '#8a6a10', MAT.gold, { alpha: 0.5 });
  P.ellipse(0.5, 0.175, 0.07, 0.05, '#e8c040', MAT.gold);
  P.ellipse(0.5, 0.175, 0.05, 0.035, '#b8322e', MAT.patent);
  P.ellipse(0.5, 0.175, 0.03, 0.02, '#e8c040', MAT.gold);
  P.rect(-0.01, -0.01, P.W + 0.02, 0.16, white, MAT.cloth);
  P.line([[0.5, 0.0], [0.5, 0.15]], 0.002, '#b8b0a0');
}

// ----------------------------- composition -----------------------------------
function paintOutfit(o, seed) {
  const P = new Painter(seed, TexQuality.scale);
  if (STYLE.cartoon) {
    o = { ...o, toon: true, gore: 0, faceWound: false, scar: false, torsoTear: 0, legTear: 0, mouthGore: null };
    if (!o.living) o.skin = mix(o.skin, '#8fb07a', 0.5);          // a sickly cartoon green-grey
  }
  o.skin = o.skin || SKIN.grey;
  face(P, o);
  neckSkin(P, o);
  if (o.shirt && o.collar !== false) neckCollar(P, o.shirt, !!o.openCollar);

  P.use('torso');
  if (o.torso) o.torso(P, o);
  else {
    if (o.shirt) shirtFront(P, o); else flesh(P, o.skin);
    trouserTop(P, o);
    if (o.bareChest) barechest(P, o);
    if (o.tie) tie(P, o.tie, { loose: o.looseTie, skew: o.tieSkew || 0, stripe: o.tieStripe });
    if (o.bowtie) bowtieFront(P, o.bowtie);
    if (o.vest) vestTorso(P, o);
    if (o.jacket) jacketTorso(P, o);
    if (o.torsoExtra) o.torsoExtra(P, o);
  }
  // gore down the front — they've been eating (not in a 1930s cartoon)
  if (!o.toon) {
    const front = o.gore ?? 3;
    for (let i = 0; i < front; i++) P.splat(0.5 + P.r(-0.12, 0.12), P.r(0.3, 0.62), P.r(0.012, 0.035), '#4a0507', 0.8);
    for (let i = 0; i < 4; i++) P.drip(0.5 + P.r(-0.05, 0.05), 0.68, P.r(0.05, 0.22), P.r(0.005, 0.01), '#3a0406', 0.8);
    if (P.rand() < (o.torsoTear ?? 0.6)) P.tear(P.pick([P.r(0.15, 0.35), P.r(0.62, 0.85)]), P.r(0.25, 0.5), P.r(0.03, 0.05), o.skin);
    P.mottle('#2a1c10', 0.14, 3, 61);
  }

  for (const s of ['L', 'R']) {
    sleeve(P, s, o);
    if (o.legPaint) o.legPaint(P, s, o); else trouserLeg(P, s, o);
  }
  shoes(P, o);
  hands(P, o);
  if (o.coat) coatFabric(P, o);
  if (o.glowFace) {
    P.use('head');
    P.path((c) => c.ellipse(FACE.cx, 0.1, 0.1, 0.1, 0, 0, Math.PI * 2), null, null, { glow: o.glowFace });
    P.glowSpot(FACE.cx, 0.1, 0.16, o.glowFace, 0.8);
  }
  if (o.finish) o.finish(P, o);
  return P.finish(o.toon ? inkAndPaint : null);
}

// ------------------------------- the looks -----------------------------------
// Each look: { build, outfit(P-rand) -> outfit opts, props: [...], eyes }.
// `variant` seeds the random choices so a kind has a few distinct versions.

const HAIR = ['#1c1510', '#3a2a1a', '#5a4a3a', '#8a8070', '#2a2a2a', '#6a3a1a'];

export const LOOKS = {
  walker: {
    build: 'standard', eyes: 0xff4a4a, props: ['trilby'], propChance: { trilby: 0.55 },
    outfit: (R) => {
      const suit = R.pick(['#4a4640', '#6a5a44', '#2a2e3a', '#4a3a2e', '#3a4a5a', '#5a2a2a', '#7a6a58']);
      return {
        skin: R.pick([SKIN.grey, SKIN.pale, SKIN.ash]), hair: R.pick(HAIR), recede: R.r(0, 0.02),
        shirt: R.pick(['#d8d2bc', '#c9c2a8', '#b8c0c8']), tie: R.pick(['#8a1020', '#1a3a7a', '#2a5a2a', '#6a2a6a']),
        looseTie: true, tieSkew: R.r(-0.02, 0.02), openCollar: R.rand() < 0.5,
        jacket: suit, jacketOpen: true, pants: shade(suit, R.r(-0.04, 0.02)), pocketSquare: R.rand() < 0.5 ? '#c9a227' : null,
        sleeves: 'jacket', scar: R.rand() < 0.4, faceWound: R.rand() < 0.5, gore: 3,
        propColor: shade(suit, -0.05),
      };
    },
  },
  sprinter: {
    build: 'lean', eyes: 0xffb04a, props: ['pillbox'],
    outfit: (R) => ({
      skin: R.pick([SKIN.blue, SKIN.pale]), hair: R.pick(HAIR), shirt: '#dcd6c6',
      vest: '#8d1f2f', vestTrim: '#d8b23a', vestBack: '#5a1420', vestMat: MAT.cloth,
      pants: '#16151a', stripe: '#c9a227', stripeMat: MAT.gold, sleeves: 'rolled', bowtie: '#111',
      faceWound: true, gore: 2, legTear: 0.7,
    }),
  },
  brute: {
    build: 'brute', eyes: 0xffffff, props: ['shades', 'earpiece'],
    outfit: (R) => ({
      skin: R.pick([SKIN.bruised, SKIN.grey]), bald: true, brows: false, hair: '#1a1a1a',
      shirt: '#d4d0c4', tie: '#0c0c10', jacket: '#141418', jacketOpen: false, pants: '#141418',
      lapel: '#101014', sleeves: 'jacket', scar: true, gore: 4, shoes: '#070707', shoeMat: MAT.patent,
    }),
  },
  spitter: {
    build: 'standard', eyes: 0x7aff4a, props: ['bowtie', 'tray'],
    outfit: (R) => ({
      skin: SKIN.green, veinColor: '#2a6a1a', hair: R.pick(HAIR), recede: 0.0,
      shirt: '#e2ddd0', vest: '#121214', vestBack: '#2a2a30', pants: '#121214', sleeves: 'shirt',
      mouthGore: '#4a8a1a', mouthW: 0.03, gore: 1,
      finish: (P) => {  // acid drool stains down the front
        P.use('torso');
        for (let i = 0; i < 5; i++) P.drip(0.5 + P.r(-0.04, 0.04), 0.68, P.r(0.1, 0.3), 0.008, '#5a9a1a', 0.75);
        P.use('head');
        P.glowSpot(FACE.cx, FACE.mouthY, 0.03, '#6aff2a', 0.5);
      },
    }),
  },
  gasbag: {
    build: 'fat', eyes: 0xd6ff4a, props: ['chain', 'cards'],
    outfit: (R) => ({
      skin: SKIN.yellow, veinColor: '#3a5a1a', hair: '#1a1410', recede: 0.03, patchy: 5,
      shirt: '#e8dcc0', openCollar: true, bareChest: true, jacket: R.pick(['#4a1a5a', '#5a1a2a', '#1a3a4a']),
      jacketOpen: true, jacketMat: MAT.velvet, lapel: '#1a1018', lapelMat: MAT.satin,
      pants: '#d8d0b8', sleeves: 'jacket', shoes: '#e8e0d0', twoTone: '#5a3a1a', laces: false, gore: 2,
      pocketSquare: '#c9a227',
    }),
  },
  pitguard: {
    build: 'guard', eyes: 0xffd24a, props: ['helmet', 'pauldrons', 'badge'],
    outfit: () => ({
      skin: SKIN.ash, hair: '#1a1a1a', glowFace: '#ffcc40',
      shirt: '#2a3350', tie: '#141828', pants: '#1e2438', stripe: '#8a95b8', sleeves: 'shirt',
      armband: '#c9a227', collar: true, gore: 2, shoes: '#0a0a0a',
      torsoExtra: (P) => {       // kevlar vest over the uniform shirt
        P.poly([[0.2, 0.2], [0.8, 0.2], [0.8, 0.56], [0.66, 0.6], [0.56, 0.66], [0.44, 0.66], [0.34, 0.6], [0.2, 0.56]], '#262a30', MAT.cloth);
        P.noise(0.3, 'overlay', 14, 3, 71);
        for (let y = 0.24; y < 0.58; y += 0.06) P.line([[0.22, y], [0.78, y]], 0.004, '#16181c', null, { alpha: 0.6 });
        P.rect(0.43, 0.42, 0.14, 0.04, '#e8e0c8', MAT.plastic);
        P.text('SECURITY', 0.5, 0.44, 0.022, '#141414');
        for (const x of [0.32, 0.68]) P.rect(x - 0.03, 0.26, 0.06, 0.08, '#1a1d22', MAT.cloth);
        for (let x = 0.02; x < 0.2; x += 0.06) P.rect(x, 0.3, 0.035, 0.18, '#262a30', MAT.cloth);
      },
    }),
  },
  collector: {
    build: 'standard', eyes: 0xff2d2d, props: ['tophat', 'briefcase', 'monocle'],
    buildExtra: { coat: { len: 0.47, open: true }, shoulders: 1.02 },
    outfit: () => ({
      skin: SKIN.pale, hair: '#0e0c0c', recede: 0.0, patchy: 1,
      shirt: '#d8d4ca', tie: '#0a0a0a', vest: '#3a0a12', vestBack: '#1a0a0c', watchChain: true,
      jacket: '#111114', jacketOpen: true, coat: true, coatColor: '#111114', coatLining: '#5a0a18',
      pinstripe: { color: '#8a8a90', gap: 0.016, alpha: 0.28 }, pants: '#111114', sleeves: 'jacket',
      gloves: '#0c0c0e', gloveMat: MAT.leather, shoes: '#050505', shoeMat: MAT.patent, gore: 1, torsoTear: 0.2,
      legTear: 0.2, scar: true,
    }),
  },
  croupier: {
    build: 'lean', eyes: 0xd8ffd8, props: ['visor', 'bowtie', 'cardsHand'],
    outfit: (R) => ({
      skin: R.pick([SKIN.pale, SKIN.grey]), hair: R.pick(HAIR), recede: 0.0,
      shirt: '#e6e1d4', vest: '#101014', vestBack: '#26262c', vestMat: MAT.satin, pants: '#101014',
      sleeves: 'shirt', garter: '#9a1020', gore: 2,
    }),
  },
  magician: {
    build: 'lean', eyes: 0xc27aff, props: ['tophatMagic', 'wand', 'cape', 'bowtie'],
    buildExtra: { coat: { len: 0.44, tails: true } },
    outfit: () => ({
      skin: SKIN.bruised, hair: '#0e0a14', recede: 0.0, mouthW: 0.032,
      shirt: '#ece8dc', vest: '#e8e2d2', vestMat: MAT.satin, jacket: '#2a1040', jacketOpen: true, coat: true,
      coatColor: '#2a1040', stars: '#d8b23a', lapel: '#14081f', lapelMat: MAT.satin,
      pants: '#14081f', stripe: '#3a1a5a', sleeves: 'jacket', gloves: '#e8e4da', gore: 1, torsoTear: 0.3,
    }),
  },
  jackpot: {
    build: 'standard', eyes: 0xfff2a0, props: ['slotHead'], hideHead: true,
    outfit: () => ({
      skin: SKIN.grey, hair: '#1a1410', shirt: '#1a1410', tie: '#c9a227',
      jacket: '#c9a227', jacketOpen: false, jacketMat: MAT.sequin, sequins: true, pantsSequins: true,
      lapel: '#111', lapelMat: MAT.satin, pants: '#b8921f', pantsMat: MAT.sequin, sleeves: 'jacket',
      gloves: '#f0e8d0', gore: 1, torsoTear: 0.2, shoes: '#e8e0d0', shoeMat: MAT.patent, jacketButton: '#111',
    }),
  },

  // the players (co-op): living high rollers in white, red, green and blue dinner jackets
  gambler: {
    build: 'standard', eyes: 0x1a1410, props: ['trilby'],
    outfit: () => ({
      skin: '#d9a582', hair: '#2a1a10', shirt: '#f2efe6', bowtie: '#111111', living: true,
      jacket: '#ece4d0', jacketOpen: false, pants: '#1a1a1e', pocketSquare: '#b3122e',
      sleeves: 'jacket', gore: 0, propColor: '#1c1a1e',
    }),
  },
  gambler2: {
    build: 'standard', eyes: 0x1a1410, props: ['trilby'],
    outfit: () => ({
      skin: '#c58a64', hair: '#1a120c', shirt: '#f2efe6', bowtie: '#111111', living: true,
      jacket: '#b3122e', jacketOpen: false, pants: '#1a1a1e', pocketSquare: '#e8c860',
      sleeves: 'jacket', gore: 0, propColor: '#1c1a1e',
    }),
  },
  gambler3: {
    build: 'standard', eyes: 0x1a1410, props: ['trilby'],
    outfit: () => ({
      skin: '#e0b090', hair: '#5a3014', shirt: '#f2efe6', bowtie: '#111111', living: true,
      jacket: '#1f7a4a', jacketOpen: false, pants: '#1a1a1e', pocketSquare: '#f2efe6',
      sleeves: 'jacket', gore: 0, propColor: '#1c1a1e',
    }),
  },
  gambler4: {
    build: 'standard', eyes: 0x1a1410, props: ['trilby'],
    outfit: () => ({
      skin: '#8a5a3c', hair: '#140c08', shirt: '#f2efe6', bowtie: '#111111', living: true,
      jacket: '#2a4aa8', jacketOpen: false, pants: '#1a1a1e', pocketSquare: '#e8c860',
      sleeves: 'jacket', gore: 0, propColor: '#1c1a1e',
    }),
  },
  showgirl: {
    build: 'showgirl', eyes: 0xff7ad0, props: ['plumes', 'tailfeathers', 'pearls'],
    outfit: (R) => {
      const suit = R.pick(['#d8a020', '#e0205a', '#20b8e0', '#b040f0']);
      return {
        skin: R.pick([SKIN.porcelain, SKIN.pale, SKIN.ash]), hair: R.pick(['#1a0e0a', '#5a200a', '#d8c080']), recede: 0, patchy: 1,
        collar: false, sleeves: 'bare', gloves: '#f2e8f0', gloveMat: MAT.satin, suit,
        shoes: '#d8b23a', shoeMat: MAT.gold, laces: false, sole: '#8a6a10',
        torso: (P, o) => showgirlTorso(P, o, suit), legPaint: fishnets,
        mouthW: 0.024, gore: 2, torsoTear: 0.15, propColor: suit,
        finish: (P) => {   // stage makeup, smeared: red lips, glitter lids, a painted beauty mark
          P.use('head');
          const { cx, eyeDX, eyeY, mouthY } = FACE;
          P.ellipse(cx, mouthY, 0.03, 0.013, '#9a0a28', MAT.wet, { alpha: 0.85 });
          for (const s of [-1, 1]) {
            P.spot(cx + s * eyeDX, eyeY + 0.012, 0.03, suit, 0.55);
            for (let i = 0; i < 20; i++) P.circle(cx + s * eyeDX + P.r(-0.025, 0.025), eyeY + 0.012 + P.r(-0.01, 0.02), 0.0015, '#fff6e0', MAT.silver);
            for (let i = 0; i < 5; i++) P.line([[cx + s * (eyeDX + 0.01 + i * 0.005), eyeY + 0.018], [cx + s * (eyeDX + 0.016 + i * 0.006), eyeY + 0.03]], 0.0012, '#0a0608');
          }
          P.circle(cx + 0.04, mouthY + 0.02, 0.003, '#1a0a0a');
          P.drip(cx - 0.035, eyeY - 0.01, 0.06, 0.004, '#1a0a14', 0.7);        // mascara run
        },
      };
    },
  },
  king: {
    build: 'king', eyes: 0x8ad8ff, props: ['pompadour', 'aviators', 'kingcape', 'mic'],
    outfit: () => ({
      skin: SKIN.pale, hair: '#0a0a0c', recede: 0, patchy: 0,
      shirt: '#f2eee4', collar: false, torso: kingTorso,
      jacket: '#f2eee4', stars: '#d8b23a', sleeves: 'jacket', cufflink: '#d8b23a',
      pants: '#f2eee4', stripe: '#d8b23a', stripeMat: MAT.gold,
      shoes: '#f4f0e8', shoeMat: MAT.patent, laces: false, gore: 2, torsoTear: 0.2, legTear: 0.2,
      finish: (P) => {   // sideburns down to the jaw
        P.use('head');
        const { cx, earDX } = FACE;
        for (const s of [-1, 1]) {
          const x = cx + s * (earDX - 0.028);
          P.poly([[x - 0.014, 0.17], [x + 0.014, 0.17], [x + 0.01 * s, 0.055], [x - 0.006 * s, 0.05]], '#0a0a0c', MAT.hair);
        }
      },
    }),
  },

  // ------------------------------ bosses ------------------------------------
  pitboss: {
    build: 'pitboss', eyes: 0xff3a1a, props: ['bowler', 'cigar', 'chain'],
    outfit: () => ({
      skin: SKIN.bruised, hair: '#2a2a2a', recede: 0.035, patchy: 2,
      shirt: '#141014', tie: '#c9a227', tieStripe: '#8a6a10', vest: '#b08a20', vestMat: MAT.satin, vestButton: '#141014',
      jacket: '#4a0c14', jacketOpen: true, pinstripe: { color: '#c9a227', gap: 0.022, alpha: 0.35 },
      pants: '#4a0c14', sleeves: 'jacket', pocketSquare: '#c9a227', scar: true, faceWound: true,
      shoes: '#e8e0d0', twoTone: '#2a1a10', laces: false, gore: 4,
    }),
  },
  housedealer: {
    build: 'dealer', eyes: 0xffd24a, props: ['tophatDealer', 'bowtieRed'],
    buildExtra: { coat: { len: 0.5, tails: true } },
    outfit: () => ({
      skin: SKIN.porcelain, brows: false, bald: false, hair: '#0a0a0a', recede: 0.0, patchy: 0,
      teeth: '#f4f0e0', mouthW: 0.036, mouthGore: '#6a0a10',
      shirt: '#f2efe6', vest: '#f2efe6', vestMat: MAT.satin, jacket: '#0a0a0c', jacketOpen: true, coat: true,
      coatColor: '#0a0a0c', lapel: '#7a0a14', lapelMat: MAT.satin, coatLining: '#7a0a14',
      pants: '#0a0a0c', stripe: '#1a1a20', sleeves: 'jacket', gloves: '#f4f2ec', shoes: '#050505', shoeMat: MAT.patent,
      gore: 1, torsoTear: 0, legTear: 0,
      finish: (P) => {
        // harlequin diamonds over the eyes + stitched grin, gold glow when "open"
        P.use('head');
        const { cx, eyeDX, eyeY, mouthY } = FACE;
        for (const s of [-1, 1]) {
          const x = cx + s * eyeDX;
          P.poly([[x, eyeY + 0.035], [x + 0.016, eyeY], [x, eyeY - 0.04], [x - 0.016, eyeY]], '#0a0a0a', MAT.satin);
          P.glowSpot(x, eyeY, 0.03, '#ffcc40', 0.6);
        }
        P.curve([[cx - 0.07, mouthY + 0.02], [cx - 0.04, mouthY - 0.005], [cx, mouthY - 0.01], [cx + 0.04, mouthY - 0.005], [cx + 0.07, mouthY + 0.02]], 0.004, '#3a0a0e');
        for (let i = -6; i <= 6; i++) {
          const x = cx + i * 0.011, y = mouthY - 0.008 + Math.pow(Math.abs(i) / 6, 2) * 0.026;
          P.line([[x, y - 0.006], [x, y + 0.006]], 0.0015, '#1a0406');
        }
        P.path((c) => c.ellipse(cx, 0.11, 0.09, 0.1, 0, 0, Math.PI * 2), null, null, { glow: '#2a1c04' });
      },
    }),
  },
};

const _atlasCache = new Map();

/** painted textures for a look + variant (cached) */
export function skinFor(kind, variant = 0) {
  const key = `${kind}|${variant}|${TexQuality.scale}`;
  if (_atlasCache.has(key)) return _atlasCache.get(key);
  const look = LOOKS[kind];
  const seed = (hash(kind) + variant * 7919) >>> 0;
  const rand = rng(seed ^ 0x5bd1);                  // the outfit dice
  const R = { rand, r: (a = 0, b = 1) => a + rand() * (b - a), pick: (arr) => arr[Math.floor(rand() * arr.length)] };
  const outfit = look.outfit(R);
  const tex = paintOutfit(outfit, seed);
  const out = { ...tex, outfit };
  _atlasCache.set(key, out);
  return out;
}

export function variantsOf(kind) {
  return kind === 'walker' ? 5 : kind === 'showgirl' ? 4 : ['sprinter', 'croupier'].includes(kind) ? 3 : 1;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export { mix };
