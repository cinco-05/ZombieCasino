// casinotex.js — the casino's surfaces, painted procedurally: ornate carpet,
// damask wallpaper, wood paneling, black-and-gold marble, a coffered ceiling,
// printed blackjack felt, slot machine art, the roulette wheel.

import { makeCanvas, toTexture, noiseCanvas, rng, bumpFrom } from './texkit.js';

const cache = new Map();
const once = (k, f) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };

// ------------------------------- carpet --------------------------------------
/** the loud, ornate, sticky casino carpet (tileable) */
export function carpet() {
  return once('carpet', () => {
    const S = 1024, cv = makeCanvas(S), c = cv.getContext('2d');
    const R = rng(4);
    c.fillStyle = '#2a0c2c'; c.fillRect(0, 0, S, S);
    // soft tonal field so the base isn't flat
    c.globalAlpha = 0.5; c.globalCompositeOperation = 'overlay';
    c.drawImage(noiseCanvas(256, 4, 4, 91, 1.4), 0, 0, S, S);
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;

    const cell = S / 4;
    const wrapDraw = (x, y, fn) => {                  // tileable: draw 9 wrapped copies near edges
      for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
        if (x + dx < -cell || x + dx > S + cell || y + dy < -cell || y + dy > S + cell) continue;
        c.save(); c.translate(x + dx, y + dy); fn(); c.restore();
      }
    };
    // diagonal lattice of burgundy bands with gold piping
    c.lineCap = 'round';
    for (let i = -8; i <= 8; i++) {
      for (const [col, w] of [['#4a1236', 26], ['#c9a227', 3]]) {
        c.strokeStyle = col; c.lineWidth = w;
        c.beginPath(); c.moveTo(i * cell, 0); c.lineTo(i * cell + S, S); c.stroke();
        c.beginPath(); c.moveTo(i * cell, S); c.lineTo(i * cell + S, 0); c.stroke();
      }
    }
    // medallions at the lattice crossings
    const petal = (r, n, col, rot = 0) => {
      c.fillStyle = col;
      for (let k = 0; k < n; k++) {
        c.save(); c.rotate(rot + (k / n) * Math.PI * 2);
        c.beginPath();
        c.moveTo(0, 0);
        c.bezierCurveTo(r * 0.35, -r * 0.25, r * 0.9, -r * 0.3, r, 0);
        c.bezierCurveTo(r * 0.9, r * 0.3, r * 0.35, r * 0.25, 0, 0);
        c.fill();
        c.restore();
      }
    };
    for (let gx = 0; gx < 4; gx++) for (let gy = 0; gy < 4; gy++) {
      const x = gx * cell + cell / 2, y = gy * cell + cell / 2;
      wrapDraw(x, y, () => {
        c.fillStyle = '#12060f'; c.beginPath(); c.arc(0, 0, 92, 0, Math.PI * 2); c.fill();
        petal(88, 8, '#1f6f74', Math.PI / 8);
        petal(76, 8, '#b0306a');
        petal(46, 8, '#c9a227', Math.PI / 8);
        c.fillStyle = '#12060f'; c.beginPath(); c.arc(0, 0, 18, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#e8c860'; c.beginPath(); c.arc(0, 0, 9, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#c9a227'; c.lineWidth = 3;
        c.beginPath(); c.arc(0, 0, 96, 0, Math.PI * 2); c.stroke();
      });
      // small starbursts at the diamond centers
      wrapDraw(gx * cell, gy * cell, () => {
        petal(30, 4, '#27a0a8', Math.PI / 4);
        petal(22, 4, '#e8c860');
        c.fillStyle = '#b0306a'; c.beginPath(); c.arc(0, 0, 6, 0, Math.PI * 2); c.fill();
      });
    }
    // swirling vines between
    c.strokeStyle = '#6a1a4a'; c.lineWidth = 5;
    for (let i = 0; i < 40; i++) {
      const x = R() * S, y = R() * S;
      wrapDraw(x, y, () => {
        c.rotate(R() * 6.28);
        c.beginPath(); c.moveTo(0, 0);
        c.bezierCurveTo(20, -30, 50, -10, 40, 16);
        c.bezierCurveTo(34, 30, 16, 26, 20, 14);
        c.stroke();
      });
    }
    // wear + fibre noise + spilled-drink stains
    c.globalAlpha = 0.28; c.globalCompositeOperation = 'multiply';
    c.drawImage(noiseCanvas(256, 3, 5, 12, 1.6), 0, 0, S, S);
    c.globalAlpha = 0.22; c.globalCompositeOperation = 'overlay';
    const fib = noiseCanvas(256, 64, 2, 5, 2);
    c.fillStyle = c.createPattern(fib, 'repeat'); c.fillRect(0, 0, S, S);
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    return { map: toTexture(cv), bump: toTexture(bumpFrom(cv, 512, 0.6, 3), { srgb: false }) };
  });
}

// ------------------------------ wallpaper ------------------------------------
/** deep red damask */
export function damask() {
  return once('damask', () => {
    const W = 512, H = 512, cv = makeCanvas(W, H), c = cv.getContext('2d');
    c.fillStyle = '#4a0c1a'; c.fillRect(0, 0, W, H);
    c.globalAlpha = 0.25; c.globalCompositeOperation = 'overlay';
    c.drawImage(noiseCanvas(256, 6, 4, 13, 1.3), 0, 0, W, H);
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    const motif = (x, y, s, col) => {
      c.save(); c.translate(x, y); c.scale(s, s);
      c.fillStyle = col;
      for (const m of [1, -1]) {
        c.save(); c.scale(m, 1);
        c.beginPath();
        c.moveTo(0, -110);
        c.bezierCurveTo(30, -80, 60, -70, 50, -30);
        c.bezierCurveTo(90, -40, 100, 10, 60, 20);
        c.bezierCurveTo(80, 50, 50, 90, 20, 70);
        c.bezierCurveTo(20, 95, 10, 110, 0, 118);
        c.lineTo(0, -110);
        c.fill();
        c.beginPath(); c.arc(70, -60, 10, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc(84, 44, 8, 0, Math.PI * 2); c.fill();
        c.restore();
      }
      c.fillStyle = '#4a0c1a';
      c.beginPath(); c.ellipse(0, 0, 16, 36, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = col; c.beginPath(); c.ellipse(0, 0, 8, 22, 0, 0, Math.PI * 2); c.fill();
      c.restore();
    };
    const col = '#6a1426';
    for (const [x, y] of [[128, 128], [384, 384], [384 - 512, 384], [128 + 512, 128], [128, 128 + 512], [384, 384 - 512]]) motif(x, y, 0.95, col);
    c.strokeStyle = 'rgba(201,162,39,0.22)'; c.lineWidth = 2;
    for (const [x, y] of [[128, 128], [384, 384]]) {
      c.beginPath(); c.ellipse(x, y, 104, 124, 0, 0, Math.PI * 2); c.stroke();
    }
    return { map: toTexture(cv), bump: toTexture(bumpFrom(cv, 256, 0.3, 8), { srgb: false }) };
  });
}

/** raised wood panels for the wainscot */
export function woodPanels() {
  return once('woodpanels', () => {
    const W = 512, H = 256, cv = makeCanvas(W, H), c = cv.getContext('2d');
    c.fillStyle = '#2a1408'; c.fillRect(0, 0, W, H);
    const R = rng(8);
    for (let i = 0; i < 90; i++) {
      c.strokeStyle = `rgba(${10 + R() * 30},${4 + R() * 10},0,${0.2 + R() * 0.3})`;
      c.lineWidth = 1 + R() * 3;
      const y = R() * H;
      c.beginPath(); c.moveTo(0, y);
      for (let x = 0; x <= W; x += 16) c.lineTo(x, y + Math.sin(x * 0.02 + i) * 3);
      c.stroke();
    }
    // two panels per tile with bevel highlights
    for (const x0 of [16, 272]) {
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x0, 22, 224, 212);
      c.fillStyle = 'rgba(90,50,20,0.35)'; c.fillRect(x0 + 8, 30, 208, 196);
      c.strokeStyle = 'rgba(255,200,120,0.18)'; c.lineWidth = 3;
      c.strokeRect(x0 + 4, 26, 216, 204);
      c.strokeStyle = 'rgba(0,0,0,0.5)'; c.strokeRect(x0 + 10, 32, 204, 192);
    }
    c.fillStyle = '#c9a227'; c.fillRect(0, 0, W, 6); c.fillRect(0, H - 8, W, 8);
    return { map: toTexture(cv), bump: toTexture(bumpFrom(cv, 256, 0.2, 9), { srgb: false }) };
  });
}

/** black marble with gold veins */
export function marble(base = '#14101a', vein = '#c9a227', seed = 2) {
  return once('marble' + base + vein + seed, () => {
    const S = 512, cv = makeCanvas(S), c = cv.getContext('2d');
    const R = rng(seed);
    c.fillStyle = base; c.fillRect(0, 0, S, S);
    c.globalAlpha = 0.4; c.globalCompositeOperation = 'screen';
    c.drawImage(noiseCanvas(256, 3, 5, seed + 30, 1.8), 0, 0, S, S);
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    for (let i = 0; i < 14; i++) {
      let x = R() * S, y = R() * S, a = R() * 6.28;
      c.strokeStyle = vein; c.globalAlpha = 0.25 + R() * 0.5; c.lineWidth = 0.6 + R() * 2;
      c.beginPath(); c.moveTo(x, y);
      for (let k = 0; k < 40; k++) { a += (R() - 0.5) * 0.8; x += Math.cos(a) * 9; y += Math.sin(a) * 9; c.lineTo(x, y); }
      c.stroke();
    }
    c.globalAlpha = 1;
    return toTexture(cv);
  });
}

/** coffered ceiling panel */
export function coffer() {
  return once('coffer', () => {
    const S = 256, cv = makeCanvas(S), c = cv.getContext('2d');
    c.fillStyle = '#0c0610'; c.fillRect(0, 0, S, S);
    const g = c.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, '#2a1426'); g.addColorStop(1, '#140a14');
    c.fillStyle = g; c.fillRect(20, 20, S - 40, S - 40);
    c.strokeStyle = '#8a6a1a'; c.lineWidth = 4; c.strokeRect(20, 20, S - 40, S - 40);
    c.strokeStyle = 'rgba(201,162,39,0.35)'; c.lineWidth = 2; c.strokeRect(34, 34, S - 68, S - 68);
    c.fillStyle = '#c9a227';
    for (const [x, y] of [[20, 20], [S - 20, 20], [20, S - 20], [S - 20, S - 20]]) { c.beginPath(); c.arc(x, y, 7, 0, Math.PI * 2); c.fill(); }
    return toTexture(cv);
  });
}

// ------------------------------- tables --------------------------------------
/** round blackjack felt with the printed rules arc and betting circles */
export function blackjackFelt() {
  return once('bjfelt', () => {
    const S = 1024, cv = makeCanvas(S), c = cv.getContext('2d');
    const g = c.createRadialGradient(S / 2, S / 2, 50, S / 2, S / 2, S / 2);
    g.addColorStop(0, '#1c7a48'); g.addColorStop(1, '#0c4a28');
    c.fillStyle = g; c.fillRect(0, 0, S, S);
    c.globalAlpha = 0.3; c.globalCompositeOperation = 'overlay';
    c.fillStyle = c.createPattern(noiseCanvas(256, 48, 2, 3, 2), 'repeat'); c.fillRect(0, 0, S, S);
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    const arcText = (txt, r, size, col, a0) => {
      c.save(); c.translate(S / 2, S / 2);
      c.font = `bold ${size}px Georgia, serif`; c.fillStyle = col; c.textAlign = 'center'; c.textBaseline = 'middle';
      const step = size * 0.62 / r;
      let a = a0 - (txt.length - 1) * step / 2;
      for (const ch of txt) {
        c.save(); c.rotate(a); c.translate(0, r); c.rotate(Math.PI); c.fillText(ch, 0, 0); c.restore();
        a += step;
      }
      c.restore();
    };
    c.strokeStyle = '#d8b23a'; c.lineWidth = 4;
    c.beginPath(); c.arc(S / 2, S / 2, 330, 0, Math.PI * 2); c.stroke();
    arcText('BLACKJACK PAYS 3 TO 2', 290, 40, '#e8c860', 0);
    arcText('DEALER MUST STAND ON 17', 240, 26, '#f4efe2', 0);
    arcText('THE HOUSE ALWAYS WINS', 290, 34, '#e8c860', Math.PI);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.5;
      const x = S / 2 + Math.cos(a) * 400, y = S / 2 + Math.sin(a) * 400;
      c.strokeStyle = '#f4efe2'; c.lineWidth = 4;
      c.beginPath(); c.arc(x, y, 42, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.rect(x - 22, y - 22, 44, 44); c.stroke();
    }
    c.fillStyle = 'rgba(80,6,10,0.5)';
    c.beginPath(); c.ellipse(620, 380, 50, 26, 0.4, 0, Math.PI * 2); c.fill();
    return toTexture(cv);
  });
}

// --------------------------- slot machine art ---------------------------------
const SLOT_THEMES = [
  { title: 'LUCKY 7', col: '#ff2d78', sub: '#ffd24a', sym: ['7', '7', '7'] },
  { title: 'DIAMOND', col: '#27e6ff', sub: '#f4efe2', sym: ['♦', '♦', '♦'] },
  { title: 'CHERRY', col: '#ff3a3a', sub: '#2dff7a', sym: ['🍒', '🍒', '7'] },
  { title: 'DEAD MAN', col: '#8a2dff', sub: '#c7ff4a', sym: ['💀', '💀', '💀'] },
  { title: 'JACKPOT', col: '#ffd24a', sub: '#ff2d78', sym: ['🔔', '7', '🔔'] },
  { title: 'WILD', col: '#2dff7a', sub: '#27e6ff', sym: ['★', '★', '7'] },
];
export const SLOT_THEME_COUNT = SLOT_THEMES.length;

/** front face of a cabinet: topper sign, reel window, paytable, buttons */
export function slotFace(i) {
  return once('slotface' + i, () => {
    const t = SLOT_THEMES[i % SLOT_THEMES.length];
    const W = 256, H = 512, cv = makeCanvas(W, H), c = cv.getContext('2d');
    const g = c.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, '#16101e'); g.addColorStop(0.5, '#2a1e34'); g.addColorStop(1, '#16101e');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // topper
    c.fillStyle = '#0a0610'; c.beginPath(); c.roundRect(14, 12, W - 28, 96, 14); c.fill();
    c.shadowColor = t.col; c.shadowBlur = 18;
    c.fillStyle = t.col; c.font = 'bold 46px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(t.title, W / 2, 62);
    c.shadowBlur = 0;
    c.strokeStyle = t.sub; c.lineWidth = 3; c.beginPath(); c.roundRect(14, 12, W - 28, 96, 14); c.stroke();
    for (let k = 0; k < 11; k++) { c.fillStyle = k % 2 ? t.sub : '#fff6d0'; c.beginPath(); c.arc(24 + k * 20.8, 118, 4, 0, Math.PI * 2); c.fill(); }
    // reel window
    c.fillStyle = '#0a0612'; c.beginPath(); c.roundRect(18, 138, W - 36, 150, 12); c.fill();
    for (let r = 0; r < 3; r++) {
      const x = 28 + r * 68;
      const rg = c.createLinearGradient(0, 148, 0, 280);
      rg.addColorStop(0, '#8a8478'); rg.addColorStop(0.5, '#f4efe2'); rg.addColorStop(1, '#8a8478');
      c.fillStyle = rg; c.fillRect(x, 148, 60, 130);
      c.fillStyle = t.sym[r] === '7' ? '#b3122e' : '#141414';
      c.font = t.sym[r].length > 1 ? '44px serif' : 'bold 54px Georgia, serif';
      c.fillText(t.sym[r], x + 30, 215);
    }
    c.strokeStyle = '#ff2d2d'; c.lineWidth = 2; c.beginPath(); c.moveTo(22, 213); c.lineTo(W - 22, 213); c.stroke();
    // paytable + buttons
    c.fillStyle = '#0a0610'; c.fillRect(22, 302, W - 44, 110);
    c.fillStyle = t.sub; c.font = 'bold 18px Georgia, serif';
    ['777 ........ 1000', '♦♦♦ ........ 500', '🍒🍒 ........ 50', 'ANY 7 ....... 10'].forEach((line, k) => c.fillText(line, W / 2, 326 + k * 25));
    c.fillStyle = '#0c0a10'; c.fillRect(0, 430, W, 82);
    ['#ff2d55', '#ffd24a', '#2dff7a', '#27e6ff'].forEach((col, k) => {
      c.fillStyle = col; c.beginPath(); c.roundRect(20 + k * 56, 452, 44, 26, 6); c.fill();
    });
    c.globalAlpha = 0.15; c.drawImage(noiseCanvas(256, 8, 3, 40 + i, 1.2), 0, 0, W, H); c.globalAlpha = 1;
    const tex = toTexture(cv);
    // emissive: only the lit parts (topper, bulbs, reels, buttons) glow
    const ecv = makeCanvas(W / 2, H / 2), e = ecv.getContext('2d');
    e.fillStyle = '#000'; e.fillRect(0, 0, W / 2, H / 2);
    e.drawImage(cv, 0, 0, W, 132, 0, 0, W / 2, 66);
    e.globalAlpha = 0.55; e.drawImage(cv, 0, 138, W, 150, 0, 69, W / 2, 75);
    e.globalAlpha = 1; e.drawImage(cv, 0, 440, W, 50, 0, 220, W / 2, 25);
    return { map: tex, glow: toTexture(ecv), color: t.col };
  });
}

/** a roulette wheel top: pockets, numbers, gold frets */
export function rouletteTop() {
  return once('roulette', () => {
    const S = 1024, cv = makeCanvas(S), c = cv.getContext('2d');
    const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
    const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
    const cx = S / 2, cy = S / 2;
    c.fillStyle = '#2a1408'; c.beginPath(); c.arc(cx, cy, 510, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#c9a227'; c.beginPath(); c.arc(cx, cy, 470, 0, Math.PI * 2); c.fill();
    for (let i = 0; i < 37; i++) {
      const a0 = (i / 37) * Math.PI * 2, a1 = ((i + 1) / 37) * Math.PI * 2;
      const n = ORDER[i];
      c.fillStyle = n === 0 ? '#0f7a3d' : RED.has(n) ? '#b3122e' : '#141418';
      c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, 460, a0, a1); c.closePath(); c.fill();
      c.save(); c.translate(cx, cy); c.rotate((a0 + a1) / 2 + Math.PI / 2);
      c.fillStyle = '#f4efe2'; c.font = 'bold 34px Georgia, serif'; c.textAlign = 'center';
      c.fillText(String(n), 0, -410);
      c.restore();
    }
    c.strokeStyle = '#d8b23a'; c.lineWidth = 3;
    for (let i = 0; i < 37; i++) {
      const a = (i / 37) * Math.PI * 2;
      c.beginPath(); c.moveTo(cx + Math.cos(a) * 300, cy + Math.sin(a) * 300); c.lineTo(cx + Math.cos(a) * 460, cy + Math.sin(a) * 460); c.stroke();
    }
    const hub = c.createRadialGradient(cx, cy, 10, cx, cy, 300);
    hub.addColorStop(0, '#e8c860'); hub.addColorStop(0.3, '#6a3a14'); hub.addColorStop(1, '#3a1c08');
    c.fillStyle = hub; c.beginPath(); c.arc(cx, cy, 300, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#c9a227'; c.lineWidth = 10;
    for (let k = 0; k < 4; k++) {
      c.save(); c.translate(cx, cy); c.rotate(k * Math.PI / 2);
      c.beginPath(); c.moveTo(0, 30); c.lineTo(0, 240); c.stroke();
      c.restore();
    }
    c.fillStyle = '#e8c860'; c.beginPath(); c.arc(cx, cy, 40, 0, Math.PI * 2); c.fill();
    return toTexture(cv);
  });
}

/** neon sign text on a transparent canvas */
export function neonSign(text, color, w = 512, h = 128, font = 'bold 72px Georgia, serif') {
  return once('neon' + text + color + w + h, () => {
    const cv = makeCanvas(w, h), c = cv.getContext('2d');
    c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = color; c.shadowBlur = 24;
    c.strokeStyle = color; c.lineWidth = 5;
    c.strokeText(text, w / 2, h / 2);
    c.shadowBlur = 10;
    c.fillStyle = '#ffffff';
    c.fillText(text, w / 2, h / 2);
    return toTexture(cv);
  });
}

// =========================== the back rooms ==================================
/** stained, water-damaged plaster for the chapel */
export function plaster() {
  return once('plaster', () => {
    const S = 512, cv = makeCanvas(S), c = cv.getContext('2d');
    c.fillStyle = '#6e6656'; c.fillRect(0, 0, S, S);
    c.globalAlpha = 0.55; c.globalCompositeOperation = 'overlay';
    c.drawImage(noiseCanvas(256, 5, 5, 41, 1.6), 0, 0, S, S);
    c.globalCompositeOperation = 'source-over';
    const R = rng(12);
    for (let i = 0; i < 9; i++) {                 // damp stains running down
      const x = R() * S, w = 20 + R() * 60;
      const g = c.createLinearGradient(0, 0, 0, S);
      g.addColorStop(0, 'rgba(40,34,20,0.5)'); g.addColorStop(1, 'rgba(40,34,20,0)');
      c.globalAlpha = 0.35 + R() * 0.3; c.fillStyle = g; c.fillRect(x, 0, w, S * (0.3 + R() * 0.7));
    }
    c.globalAlpha = 0.5; c.strokeStyle = '#2a2418'; c.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) {                 // hairline cracks
      let x = R() * S, y = R() * S;
      c.beginPath(); c.moveTo(x, y);
      for (let k = 0; k < 12; k++) { x += (R() - 0.5) * 30; y += R() * 18; c.lineTo(x, y); }
      c.stroke();
    }
    c.globalAlpha = 1;
    return { map: toTexture(cv), bump: toTexture(bumpFrom(cv, 256, 0.4, 13), { srgb: false }) };
  });
}

/** worn dark floorboards */
export function planks() {
  return once('planks', () => {
    const W = 512, H = 512, cv = makeCanvas(W, H), c = cv.getContext('2d');
    const R = rng(21);
    const rows = 8, rh = H / rows;
    for (let r = 0; r < rows; r++) {
      let x = -R() * 200;
      while (x < W) {
        const len = 140 + R() * 200;
        const l = 20 + R() * 16;
        c.fillStyle = `rgb(${l + 22},${l + 8},${l - 6})`;
        c.fillRect(x, r * rh, len, rh);
        c.globalAlpha = 0.25;
        for (let k = 0; k < 6; k++) {
          c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 1;
          const y = r * rh + R() * rh;
          c.beginPath(); c.moveTo(x, y); c.lineTo(x + len, y + (R() - 0.5) * 4); c.stroke();
        }
        c.globalAlpha = 1;
        c.fillStyle = 'rgba(0,0,0,0.7)'; c.fillRect(x, r * rh, 2, rh);
        x += len;
      }
      c.fillStyle = 'rgba(0,0,0,0.75)'; c.fillRect(0, r * rh, W, 2);
    }
    c.globalAlpha = 0.3; c.globalCompositeOperation = 'overlay';
    c.drawImage(noiseCanvas(256, 6, 4, 23, 1.4), 0, 0, W, H);
    return { map: toTexture(cv), bump: toTexture(bumpFrom(cv, 256, 0.3, 24), { srgb: false }) };
  });
}

/** a lancet stained-glass window, glowing from behind */
export function stainedGlass(seed = 1) {
  return once('stained' + seed, () => {
    const W = 256, H = 512, cv = makeCanvas(W, H), c = cv.getContext('2d');
    const R = rng(seed * 7 + 3);
    const pals = [['#7a1aff', '#ff2d78', '#2a6aff', '#ffb03a'], ['#1aff9a', '#2a4aff', '#c27aff', '#ff4a2a'], ['#ff2d55', '#ffd24a', '#6a2aff', '#2ad6ff']];
    const pal = pals[seed % pals.length];
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    c.save();
    c.beginPath();                                 // pointed arch
    c.moveTo(12, H - 8); c.lineTo(12, 170); c.quadraticCurveTo(12, 16, W / 2, 8); c.quadraticCurveTo(W - 12, 16, W - 12, 170); c.lineTo(W - 12, H - 8); c.closePath();
    c.clip();
    for (let i = 0; i < 70; i++) {                  // random leaded panes
      c.fillStyle = pal[Math.floor(R() * pal.length)];
      c.globalAlpha = 0.55 + R() * 0.45;
      const x = R() * W, y = R() * H, s = 30 + R() * 70;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + s, y + (R() - 0.5) * s); c.lineTo(x + (R() - 0.5) * s, y + s); c.closePath(); c.fill();
    }
    c.globalAlpha = 1;
    // a skull rosette in the middle of it all
    c.fillStyle = '#f4efe2'; c.beginPath(); c.arc(W / 2, 200, 44, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#000'; c.font = 'bold 70px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('☠', W / 2, 204);
    c.restore();
    c.strokeStyle = '#050505'; c.lineWidth = 7;
    for (let i = 0; i < 12; i++) { c.beginPath(); c.moveTo(R() * W, 0); c.lineTo(R() * W, H); c.stroke(); }
    for (let i = 0; i < 10; i++) { c.beginPath(); c.moveTo(0, R() * H); c.lineTo(W, R() * H); c.stroke(); }
    c.lineWidth = 12;
    c.beginPath(); c.moveTo(12, H - 8); c.lineTo(12, 170); c.quadraticCurveTo(12, 16, W / 2, 8); c.quadraticCurveTo(W - 12, 16, W - 12, 170); c.lineTo(W - 12, H - 8); c.stroke();
    return toTexture(cv);
  });
}

/** poured concrete, oil-stained */
export function concrete() {
  return once('concrete', () => {
    const S = 512, cv = makeCanvas(S), c = cv.getContext('2d');
    c.fillStyle = '#4a4a4c'; c.fillRect(0, 0, S, S);
    c.globalAlpha = 0.6; c.globalCompositeOperation = 'overlay';
    c.drawImage(noiseCanvas(256, 8, 5, 51, 1.8), 0, 0, S, S);
    c.globalCompositeOperation = 'source-over';
    const R = rng(52);
    for (let i = 0; i < 7; i++) {
      const x = R() * S, y = R() * S, r = 20 + R() * 70;
      const g = c.createRadialGradient(x, y, 2, x, y, r);
      g.addColorStop(0, 'rgba(10,10,12,0.5)'); g.addColorStop(1, 'rgba(10,10,12,0)');
      c.globalAlpha = 0.8; c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    c.globalAlpha = 0.6; c.fillStyle = '#2a2a2c';
    c.fillRect(0, 0, S, 3); c.fillRect(0, 0, 3, S);  // expansion joints
    c.globalAlpha = 1;
    return { map: toTexture(cv), bump: toTexture(bumpFrom(cv, 256, 0.5, 53), { srgb: false }) };
  });
}

/** riveted steel wall panels */
export function steelPanels() {
  return once('steelpanels', () => {
    const S = 512, cv = makeCanvas(S), c = cv.getContext('2d');
    c.fillStyle = '#3a3e46'; c.fillRect(0, 0, S, S);
    c.globalAlpha = 0.4; c.globalCompositeOperation = 'overlay';
    c.drawImage(noiseCanvas(256, 3, 4, 61, 1.3), 0, 0, S, S);
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    for (const x0 of [0, 256]) {
      c.strokeStyle = 'rgba(0,0,0,0.7)'; c.lineWidth = 6; c.strokeRect(x0 + 3, 3, 250, S - 6);
      c.strokeStyle = 'rgba(255,255,255,0.1)'; c.lineWidth = 2; c.strokeRect(x0 + 9, 9, 238, S - 18);
      c.fillStyle = '#6a6e78';
      for (let y = 22; y < S; y += 40) for (const x of [x0 + 18, x0 + 238]) { c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill(); }
    }
    return { map: toTexture(cv), bump: toTexture(bumpFrom(cv, 256, 0.2, 62), { srgb: false }) };
  });
}

/** chain-link fence (alpha-tested) */
export function chainLink() {
  return once('chain', () => {
    const S = 128, cv = makeCanvas(S), c = cv.getContext('2d');
    c.clearRect(0, 0, S, S);
    c.strokeStyle = '#b8bcc4'; c.lineWidth = 5; c.lineCap = 'round';
    for (let i = -1; i <= 2; i++) {
      c.beginPath(); c.moveTo(i * 64 - 64, 0); c.lineTo(i * 64 + 64, S); c.stroke();
      c.beginPath(); c.moveTo(i * 64 + 64, 0); c.lineTo(i * 64 - 64, S); c.stroke();
    }
    return toTexture(cv);
  });
}

/** yellow-and-black hazard stripes */
export function hazard() {
  return once('hazard', () => {
    const W = 256, H = 64, cv = makeCanvas(W, H), c = cv.getContext('2d');
    c.fillStyle = '#e8b818'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#141414';
    for (let x = -H; x < W + H; x += 64) { c.beginPath(); c.moveTo(x, H); c.lineTo(x + 32, H); c.lineTo(x + 32 + H, 0); c.lineTo(x + H, 0); c.closePath(); c.fill(); }
    c.globalAlpha = 0.35; c.globalCompositeOperation = 'multiply';
    c.drawImage(noiseCanvas(128, 8, 3, 71, 1.5), 0, 0, W, H);
    return toTexture(cv);
  });
}

/** the face of a bank vault door: concentric steel, bolts, a brass dial */
export function vaultFace() {
  return once('vault', () => {
    const S = 1024, cv = makeCanvas(S), c = cv.getContext('2d');
    c.translate(S / 2, S / 2);
    const rings = [[500, '#5a5e66'], [450, '#7a7e88'], [400, '#4a4e56'], [330, '#8a8e98'], [150, '#3a3e46']];
    for (const [r, col] of rings) {
      const g = c.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
      g.addColorStop(0, col); g.addColorStop(1, '#22242a');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 6; c.stroke();
    }
    c.fillStyle = '#c9c9d0';
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; c.beginPath(); c.arc(Math.cos(a) * 425, Math.sin(a) * 425, 14, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#c8962e';
    c.beginPath(); c.arc(0, 0, 110, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#1a1208'; c.font = 'bold 28px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      c.save(); c.rotate(a); c.fillText(String(i * 5), 0, -86); c.restore();
    }
    c.font = 'bold 44px Georgia, serif'; c.fillStyle = '#e8e2d0';
    c.fillText('THE HOUSE', 0, 250);
    return toTexture(cv);
  });
}

/** frosted glass with an etched diamond lattice, for the doorman's doors */
export function doorPane() {
  return once('doorpane', () => {
    const W = 256, H = 512, cv = makeCanvas(W, H), c = cv.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#d8c8a8'); g.addColorStop(1, '#8a7a5a');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(255,240,200,0.8)'; c.lineWidth = 3;
    for (let k = -H; k < W + H; k += 48) {
      c.beginPath(); c.moveTo(k, 0); c.lineTo(k + H, H); c.stroke();
      c.beginPath(); c.moveTo(k, H); c.lineTo(k + H, 0); c.stroke();
    }
    c.globalAlpha = 0.3; c.globalCompositeOperation = 'overlay';
    c.drawImage(noiseCanvas(128, 6, 3, 81, 1.4), 0, 0, W, H);
    return toTexture(cv);
  });
}

/** engraved brass plaque: black enamel, gold lettering */
export function plaque(text, sub = '', w = 1024, h = 160) {
  return once('plaque' + text + sub + w, () => {
    const cv = makeCanvas(w, h), c = cv.getContext('2d');
    c.fillStyle = '#0c0a08'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#c9a227'; c.lineWidth = 8; c.strokeRect(6, 6, w - 12, h - 12);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    let s = sub ? 64 : 80;
    do { c.font = `bold ${s}px Georgia, serif`; s -= 2; } while (c.measureText(text).width > w - 80 && s > 12);
    c.fillStyle = '#e8c860'; c.shadowColor = '#000'; c.shadowBlur = 4;
    c.fillText(text, w / 2, sub ? h * 0.4 : h / 2);
    if (sub) { c.font = 'italic 34px Georgia, serif'; c.fillStyle = '#b8a070'; c.fillText(sub, w / 2, h * 0.76); }
    return toTexture(cv);
  });
}

/** red rug with a gold key border */
export function rug() {
  return once('rug', () => {
    const W = 1024, H = 768, cv = makeCanvas(W, H), c = cv.getContext('2d');
    c.fillStyle = '#5a0a16'; c.fillRect(0, 0, W, H);
    c.globalAlpha = 0.35; c.globalCompositeOperation = 'overlay';
    c.drawImage(noiseCanvas(256, 20, 3, 91, 1.6), 0, 0, W, H);
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
    c.strokeStyle = '#c9a227'; c.lineWidth = 14; c.strokeRect(30, 30, W - 60, H - 60);
    c.lineWidth = 4; c.strokeRect(60, 60, W - 120, H - 120);
    c.fillStyle = '#c9a227';
    for (let x = 80; x < W - 80; x += 40) { c.fillRect(x, 40, 20, 10); c.fillRect(x, H - 50, 20, 10); }
    for (let y = 80; y < H - 80; y += 40) { c.fillRect(40, y, 10, 20); c.fillRect(W - 50, y, 10, 20); }
    c.translate(W / 2, H / 2);
    c.strokeStyle = 'rgba(201,162,39,0.7)'; c.lineWidth = 6;
    for (let i = 0; i < 4; i++) { c.rotate(Math.PI / 4); c.strokeRect(-110, -110, 220, 220); }
    c.font = 'bold 120px Georgia, serif'; c.fillStyle = '#c9a227'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('♠', 0, 8);
    return toTexture(cv);
  });
}

/** bottle label strip for the back bar */
export function velvet(color = '#5a0f1f') {
  return once('velvet' + color, () => {
    const W = 256, H = 256, cv = makeCanvas(W, H), c = cv.getContext('2d');
    const g = c.createLinearGradient(0, 0, W, 0);
    for (let i = 0; i <= 8; i++) g.addColorStop(i / 8, i % 2 ? color : '#1a0408');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.globalAlpha = 0.3; c.globalCompositeOperation = 'overlay';
    c.drawImage(noiseCanvas(256, 12, 3, 17, 1.5), 0, 0, W, H);
    return toTexture(cv);
  });
}
