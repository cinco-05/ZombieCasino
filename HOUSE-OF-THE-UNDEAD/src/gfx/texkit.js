// texkit.js — procedural texture toolkit. Everything in the game is painted
// at load time on canvases (no image files): tileable noise, fabric weaves,
// wood grain, metal, plus helpers to turn canvases into three.js textures.

import * as THREE from 'three';

/** deterministic PRNG so every painted texture comes out the same each launch */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w, h = w) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return cv;
}

/** global texture quality: 1 = full, 0.5 = half-res atlases (low settings) */
export const TexQuality = { scale: 1, anisotropy: 8 };

export function toTexture(cv, { srgb = true, repeat = null, mips = true } = {}) {
  const tex = new THREE.CanvasTexture(cv);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  tex.anisotropy = TexQuality.anisotropy;
  tex.generateMipmaps = mips;
  tex.needsUpdate = true;
  return tex;
}

// ------------------------------- noise ---------------------------------------
const _noiseCache = new Map();

/**
 * Tileable fractal value noise as a grayscale canvas (0..255).
 * scale = lattice cells across at octave 0; more octaves = finer detail.
 */
export function noiseCanvas(size = 256, scale = 4, octaves = 4, seed = 7, contrast = 1) {
  const key = `${size}|${scale}|${octaves}|${seed}|${contrast}`;
  if (_noiseCache.has(key)) return _noiseCache.get(key);
  const R = rng(seed);
  const out = new Float32Array(size * size);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = scale << o;
    const lat = new Float32Array(cells * cells);
    for (let i = 0; i < lat.length; i++) lat[i] = R();
    const step = cells / size;
    for (let y = 0; y < size; y++) {
      const fy = y * step, y0 = Math.floor(fy), ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % cells) * cells, r1 = ((y0 + 1) % cells) * cells;
      for (let x = 0; x < size; x++) {
        const fx = x * step, x0 = Math.floor(fx), tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % cells, c1 = (x0 + 1) % cells;
        const a = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * sx;
        const b = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * sx;
        out[y * size + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  const cv = makeCanvas(size);
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < out.length; i++) {
    let v = out[i] / total;
    v = 0.5 + (v - 0.5) * contrast;
    const c = Math.max(0, Math.min(255, v * 255)) | 0;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = c;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  _noiseCache.set(key, cv);
  return cv;
}

/** noise tinted to a color with alpha from brightness — for grime/mottling overlays */
export function tintedNoise(size, scale, octaves, seed, color, alphaMul = 1, invert = false, contrast = 1.6) {
  const src = noiseCanvas(size, scale, octaves, seed, contrast);
  const cv = makeCanvas(size);
  const ctx = cv.getContext('2d');
  const s = src.getContext('2d').getImageData(0, 0, size, size).data;
  const img = ctx.createImageData(size, size);
  const c = new THREE.Color(color);
  const r = c.r * 255, g = c.g * 255, b = c.b * 255;
  for (let i = 0; i < size * size; i++) {
    let v = s[i * 4] / 255;
    if (invert) v = 1 - v;
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = Math.max(0, Math.min(255, v * 255 * alphaMul));
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

// ------------------------------ patterns ------------------------------------
/** small repeating tile as a canvas pattern source */
export function patternTile(w, h, draw) {
  const cv = makeCanvas(w, h);
  draw(cv.getContext('2d'), w, h);
  return cv;
}

export const Tiles = {
  weave(color = 'rgba(0,0,0,0.18)') {
    return patternTile(4, 4, (c) => {
      c.fillStyle = color;
      c.fillRect(0, 0, 2, 1); c.fillRect(2, 2, 2, 1);
      c.fillRect(1, 1, 1, 2); c.fillRect(3, 3, 1, 1); c.fillRect(3, 0, 1, 1);
    });
  },
  twill(color = 'rgba(0,0,0,0.2)') {
    return patternTile(6, 6, (c) => {
      c.fillStyle = color;
      for (let i = 0; i < 6; i++) c.fillRect(i, (i * 1) % 6, 2, 1);
    });
  },
};

// --------------------------- material textures -------------------------------
const _matCache = new Map();
function cached(key, fn) {
  if (!_matCache.has(key)) _matCache.set(key, fn());
  return _matCache.get(key);
}

/** wood grain: long wavy rings + pores. Returns {map, bump} canvases */
export function woodCanvas(size = 512, base = '#5a3418', dark = '#2e170a', seed = 3) {
  return cached(`wood|${size}|${base}|${dark}|${seed}`, () => {
    const R = rng(seed);
    const cv = makeCanvas(size);
    const c = cv.getContext('2d');
    c.fillStyle = base; c.fillRect(0, 0, size, size);
    // growth rings as wavy horizontal bands
    for (let i = 0; i < 70; i++) {
      const y = R() * size;
      const amp = 2 + R() * 10, freq = 0.004 + R() * 0.01, ph = R() * 10;
      c.strokeStyle = dark;
      c.globalAlpha = 0.08 + R() * 0.22;
      c.lineWidth = 0.6 + R() * 2.5;
      c.beginPath();
      for (let x = 0; x <= size; x += 6) {
        const yy = y + Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 3.1 + ph) * amp * 0.3;
        if (x === 0) c.moveTo(x, yy); else c.lineTo(x, yy);
      }
      c.stroke();
    }
    // pores
    c.globalAlpha = 0.25;
    c.fillStyle = dark;
    for (let i = 0; i < size * 3; i++) c.fillRect(R() * size, R() * size, 1 + R() * 3, 1);
    c.globalAlpha = 0.35;
    c.globalCompositeOperation = 'multiply';
    c.drawImage(noiseCanvas(256, 3, 4, seed + 1, 1.3), 0, 0, size, size);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    return cv;
  });
}

/** brushed / blued metal */
export function metalCanvas(size = 256, base = '#3a3d48', seed = 5, brushed = true) {
  return cached(`metal|${size}|${base}|${seed}|${brushed}`, () => {
    const R = rng(seed);
    const cv = makeCanvas(size);
    const c = cv.getContext('2d');
    c.fillStyle = base; c.fillRect(0, 0, size, size);
    if (brushed) {
      for (let i = 0; i < size * 2; i++) {
        c.fillStyle = R() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
        c.fillRect(0, R() * size, size, 1);
      }
    }
    c.globalAlpha = 0.3;
    c.globalCompositeOperation = 'overlay';
    c.drawImage(noiseCanvas(256, 4, 5, seed, 1.2), 0, 0, size, size);
    c.globalCompositeOperation = 'source-over';
    // wear specks
    c.globalAlpha = 0.25;
    for (let i = 0; i < 90; i++) {
      c.fillStyle = 'rgba(210,210,220,0.6)';
      c.fillRect(R() * size, R() * size, 1 + R() * 2, 1);
    }
    c.globalAlpha = 1;
    return cv;
  });
}

/** fabric: base color + weave + soft mottling (felt, suit cloth, velvet) */
export function fabricCanvas(size = 256, base = '#222', seed = 9, weave = true) {
  return cached(`fabric|${size}|${base}|${seed}|${weave}`, () => {
    const cv = makeCanvas(size);
    const c = cv.getContext('2d');
    c.fillStyle = base; c.fillRect(0, 0, size, size);
    c.globalAlpha = 0.28;
    c.globalCompositeOperation = 'overlay';
    c.drawImage(noiseCanvas(256, 6, 4, seed, 1.4), 0, 0, size, size);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    if (weave) {
      c.fillStyle = c.createPattern(Tiles.weave('rgba(0,0,0,0.16)'), 'repeat');
      c.fillRect(0, 0, size, size);
    }
    return cv;
  });
}

/** grayscale height map derived from a color canvas (for bumpMap) */
export function bumpFrom(src, size = src.width / 2, grain = 0.35, seed = 11) {
  const cv = makeCanvas(size, size * (src.height / src.width));
  const c = cv.getContext('2d');
  c.filter = 'grayscale(1) contrast(1.25)';
  c.drawImage(src, 0, 0, cv.width, cv.height);
  c.filter = 'none';
  if (grain > 0) {
    c.globalAlpha = grain;
    c.globalCompositeOperation = 'overlay';
    const n = noiseCanvas(256, 32, 2, seed, 1.8);
    c.fillStyle = c.createPattern(n, 'repeat');
    c.fillRect(0, 0, cv.width, cv.height);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
  }
  return cv;
}

/** radial soft blob (shadows, glows, particles) */
export function softBlobCanvas(size = 128, inner = 'rgba(0,0,0,0.75)', outer = 'rgba(0,0,0,0)') {
  return cached(`blob|${size}|${inner}|${outer}`, () => {
    const cv = makeCanvas(size);
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    c.fillStyle = g;
    c.fillRect(0, 0, size, size);
    return cv;
  });
}
