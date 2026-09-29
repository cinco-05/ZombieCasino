// audio.js — 100% procedural WebAudio. No sound files.
//
// The score is a haunted casino: a broken music box plays a warbling waltz in
// D harmonic minor over a low drone and dissonant string swells, all soaked in
// a big generated reverb. Danger brings in a heartbeat and tremolo strings;
// bosses get pounding drums and brass stabs. Distant bells, whispers and
// reversed swells drift through the room. Gunshots are layered crack + boom +
// room tail, and every reload step has its own mechanical foley.
//
// Audio.init() must be called from a user gesture. Every play() is safe to
// call before init — it no-ops.

let ctx = null;
let master, comp, muffle, sfxGain, musicGain, ambientGain, reverbIn, reverb, noiseBuf = null;
let currentDest = null;   // when set, synth nodes route here (spatial panner)
let warble = null;        // shared tape-wobble LFO for the music box
const M = { intensity: 0.15, boss: false, health: 1, step: 0, next: 0, beatNext: 0, eventT: 0, wind: 0 };
const drone = {};
const strings = {};

const now = () => ctx.currentTime;
const rand = (a, b) => a + Math.random() * (b - a);

// ------------------------------- building blocks -----------------------------
function env(param, t0, peak, attack, decay, floor = 0.0001) {
  param.cancelScheduledValues(t0);
  param.setValueAtTime(floor, t0);
  param.exponentialRampToValueAtTime(Math.max(peak, floor * 2), t0 + attack);
  param.exponentialRampToValueAtTime(floor, t0 + attack + decay);
}

function out(dest, wet = 0) {
  const d = dest || currentDest || sfxGain;
  if (wet > 0 && reverbIn) {
    const s = ctx.createGain();
    s.gain.value = wet;
    s.connect(reverbIn);
    return [d, s];
  }
  return [d];
}
function connectAll(node, dests) { for (const d of dests) node.connect(d); }

/** oscillator voice. o: {type, f, f2, peak, a, d, t, dest, wet, detune, lp, q} */
function tone(o) {
  if (!ctx) return;
  const t = o.t ?? now();
  const osc = ctx.createOscillator();
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(o.f, t);
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f2), t + (o.slide ?? (o.a + o.d)));
  if (o.detune) osc.detune.value = o.detune;
  if (o.warble && warble) {
    warble.connect(osc.detune);
    // detach after the note so the shared LFO doesn't pin dead voices in memory
    osc.onended = () => { try { warble.disconnect(osc.detune); } catch { /* already gone */ } };
  }
  const g = ctx.createGain();
  env(g.gain, t, o.peak, o.a, o.d);
  let node = osc;
  if (o.lp) {
    const f = ctx.createBiquadFilter();
    f.type = o.ft || 'lowpass'; f.frequency.value = o.lp; f.Q.value = o.q || 0.7;
    node.connect(f); node = f;
  }
  node.connect(g);
  connectAll(g, out(o.dest, o.wet || 0));
  osc.start(t);
  osc.stop(t + o.a + o.d + 0.05);
}

function noiseBuffer() {
  if (noiseBuf) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

/** filtered noise burst. o: {peak, a, d, f, f2, ft, q, t, dest, wet, rate} */
function noise(o) {
  if (!ctx) return;
  const t = o.t ?? now();
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer();
  src.playbackRate.value = o.rate || 1;
  const f = ctx.createBiquadFilter();
  f.type = o.ft || 'lowpass';
  f.frequency.setValueAtTime(o.f || 1200, t);
  if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + (o.a || 0.005) + o.d);
  f.Q.value = o.q || 0.7;
  const g = ctx.createGain();
  env(g.gain, t, o.peak, o.a || 0.004, o.d);
  src.connect(f).connect(g);
  connectAll(g, out(o.dest, o.wet || 0));
  src.start(t, Math.random() * 1.5);
  src.stop(t + (o.a || 0.004) + o.d + 0.1);
}

/** a generated room: stereo decaying noise, darker as it fades */
function makeImpulse(seconds = 3.2, decay = 2.6) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const k = i / len;
      lp += (Math.random() * 2 - 1 - lp) * (0.9 - 0.75 * k);    // gets duller over time
      d[i] = lp * Math.pow(1 - k, decay) * (i < 90 ? i / 90 : 1);
    }
  }
  return buf;
}

// ------------------------------------ SFX ------------------------------------
// guns: crack (bright noise) + body (low thump) + mechanical click + room tail
const gun = (crackF, crackPeak, bodyF, bodyPeak, tail, wet) => {
  noise({ peak: crackPeak, a: 0.001, d: 0.05, f: crackF, ft: 'highpass', wet: 0.1 });
  noise({ peak: crackPeak * 0.9, a: 0.002, d: tail, f: 2200, f2: 300, wet });
  tone({ type: 'sine', f: bodyF, f2: bodyF * 0.35, peak: bodyPeak, a: 0.002, d: tail * 0.8, wet: wet * 0.5 });
  tone({ type: 'square', f: 2600, peak: 0.05, a: 0.001, d: 0.02 });
};
const clack = (f = 1800, peak = 0.14, d = 0.04, wet = 0.08) => {
  noise({ peak, a: 0.001, d, f, ft: 'bandpass', q: 2.5, wet });
  tone({ type: 'square', f: f * 0.5, peak: peak * 0.3, a: 0.001, d: d * 0.6 });
};
const tink = (f = 3200) => {
  for (let i = 0; i < 3; i++) tone({ type: 'sine', f: f * [1, 2.7, 5.2][i] * rand(0.97, 1.03), peak: [0.07, 0.035, 0.02][i], a: 0.001, d: 0.12 + i * 0.03, t: now() + i * 0.002, wet: 0.2 });
};

/** a soft lounge-piano note: hammer, body, a little shimmer (all scheduled at t) */
const piano = (f, t, vel = 1) => {
  tone({ type: 'triangle', f, peak: 0.05 * vel, a: 0.004, d: 1.5, t, wet: 0.6 });
  tone({ type: 'sine', f: f * 2, peak: 0.016 * vel, a: 0.003, d: 0.6, t, wet: 0.5 });
  tone({ type: 'sine', f: f * 3.01, peak: 0.006 * vel, a: 0.002, d: 0.3, t, wet: 0.4 });
};
/** a burst of rattles (dice, coins, claps): n hits spread from t0 on */
const rattle = (t0, n, gap, f0, f1, peak, d = 0.025, q = 3, wet = 0.15) => {
  for (let i = 0; i < n; i++) noise({ peak: peak * (1 - i / (n * 1.4)), a: 0.001, d, f: rand(f0, f1), ft: 'bandpass', q, t: t0 + i * gap + rand(0, gap * 0.4), wet });
};

const SFX = {
  shoot_pistol:  () => gun(3500, 0.55, 150, 0.55, 0.28, 0.35),
  shoot_shotgun: () => { gun(2500, 0.8, 90, 0.8, 0.5, 0.5); noise({ peak: 0.4, a: 0.01, d: 0.6, f: 500, f2: 120, wet: 0.5 }); },
  shoot_smg:     () => gun(4200, 0.35, 190, 0.3, 0.14, 0.2),
  shoot_rifle:   () => { gun(3000, 0.7, 110, 0.7, 0.45, 0.6); tone({ type: 'sine', f: 60, f2: 30, peak: 0.4, a: 0.004, d: 0.5 }); },
  dryfire:       () => clack(3200, 0.12, 0.025),
  reload:        () => clack(1400, 0.1, 0.05),
  hammer:        () => { clack(2600, 0.09, 0.02, 0.05); setTimeout(() => clack(1900, 0.07, 0.02, 0.05), 45); },
  cyl_open:      () => { clack(1500, 0.12, 0.05); noise({ peak: 0.05, a: 0.01, d: 0.15, f: 4000, ft: 'bandpass', q: 3 }); },
  cyl_close:     () => clack(1200, 0.2, 0.06),
  cyl_spin:      () => { for (let i = 0; i < 6; i++) tone({ type: 'square', f: 2400, peak: 0.03, a: 0.001, d: 0.012, t: now() + i * 0.035 }); },
  eject:         () => { clack(2000, 0.08, 0.03); for (let i = 0; i < 5; i++) setTimeout(() => tink(rand(2800, 3800)), 120 + i * 60 + Math.random() * 40); },
  shell_in:      () => { clack(900, 0.14, 0.05); noise({ peak: 0.04, a: 0.005, d: 0.06, f: 3000, ft: 'bandpass', q: 2 }); },
  pump_back:     () => { noise({ peak: 0.16, a: 0.005, d: 0.08, f: 1100, ft: 'bandpass', q: 1.5, wet: 0.1 }); clack(700, 0.16, 0.05); },
  pump_fwd:      () => { noise({ peak: 0.14, a: 0.005, d: 0.07, f: 1300, ft: 'bandpass', q: 1.5, wet: 0.1 }); clack(1000, 0.2, 0.05); },
  mag_out:       () => { clack(1100, 0.14, 0.05); noise({ peak: 0.05, a: 0.01, d: 0.1, f: 2500, ft: 'bandpass' }); },
  mag_in:        () => { clack(800, 0.22, 0.06); setTimeout(() => clack(1500, 0.12, 0.03), 60); },
  bolt:          () => { clack(1600, 0.15, 0.04); setTimeout(() => clack(1100, 0.2, 0.05), 110); },
  lever:         () => { noise({ peak: 0.12, a: 0.005, d: 0.07, f: 1500, ft: 'bandpass', q: 2 }); setTimeout(() => clack(900, 0.2, 0.05), 90); },
  casing:        () => tink(rand(3000, 4200)),
  whoosh:        () => noise({ peak: 0.22, a: 0.04, d: 0.14, f: 600, f2: 2500, ft: 'bandpass', q: 1.2 }),
  step:          () => { noise({ peak: 0.07, a: 0.005, d: 0.08, f: 380 }); tone({ type: 'sine', f: 70, f2: 45, peak: 0.07, a: 0.003, d: 0.07 }); },
  land:          () => { noise({ peak: 0.16, a: 0.005, d: 0.12, f: 400 }); tone({ type: 'sine', f: 60, f2: 35, peak: 0.25, a: 0.004, d: 0.12 }); },
  hit:           () => { noise({ peak: 0.22, a: 0.002, d: 0.06, f: 900, ft: 'bandpass', q: 1 }); tone({ type: 'sine', f: 180, f2: 90, peak: 0.12, a: 0.002, d: 0.06 }); },
  crit:          () => { SFX.hit(); tone({ type: 'sine', f: 1400, peak: 0.1, a: 0.002, d: 0.12, wet: 0.2 }); tone({ type: 'sine', f: 2100, peak: 0.06, a: 0.002, d: 0.1 }); },
  hurt:          () => { tone({ type: 'sawtooth', f: 180, f2: 80, peak: 0.28, a: 0.005, d: 0.22, lp: 900 }); noise({ peak: 0.2, a: 0.003, d: 0.12, f: 700 }); },
  steal:         () => tone({ type: 'sawtooth', f: 600, f2: 200, peak: 0.2, a: 0.005, d: 0.18, lp: 2000 }),
  zombie_die:    () => { noise({ peak: 0.3, a: 0.01, d: 0.35, f: 500, wet: 0.3 }); tone({ type: 'sawtooth', f: rand(160, 230), f2: 55, peak: 0.2, a: 0.02, d: 0.5, lp: 700, wet: 0.3 }); },
  groan:         () => {
    const f = rand(70, 120);
    tone({ type: 'sawtooth', f, f2: f * 0.7, peak: 0.14, a: 0.25, d: 0.9, lp: 520, q: 4, wet: 0.35 });
    tone({ type: 'sawtooth', f: f * 1.51, f2: f * 1.1, peak: 0.05, a: 0.3, d: 0.8, lp: 900, q: 6, wet: 0.35 });
    noise({ peak: 0.05, a: 0.2, d: 0.8, f: 400, wet: 0.3 });
  },
  step_heavy:    () => { tone({ type: 'sine', f: 55, f2: 30, peak: 0.3, a: 0.004, d: 0.18 }); noise({ peak: 0.1, a: 0.004, d: 0.1, f: 300 }); },
  step_click:    () => { noise({ peak: 0.14, a: 0.002, d: 0.05, f: 3000, ft: 'highpass', wet: 0.2 }); tone({ type: 'square', f: 800, peak: 0.04, a: 0.002, d: 0.03 }); },
  ambient_chime: () => { const f = rand(500, 900); tone({ type: 'sine', f, f2: f * 0.94, slide: 1.2, peak: 0.05, a: 0.02, d: 1.2, wet: 0.7, warble: true }); setTimeout(() => ctx && tone({ type: 'sine', f: f * 1.19, f2: f * 1.1, slide: 1.4, peak: 0.04, a: 0.02, d: 1.4, wet: 0.7, warble: true }), 220); },
  neon_buzz:     () => noise({ peak: 0.035, a: 0.05, d: 0.9, f: 120, ft: 'bandpass', q: 8 }),
  crowd_gasp:    () => SFX.whisper(),
  explosion:     () => {
    noise({ peak: 1, a: 0.003, d: 0.9, f: 900, f2: 80, wet: 0.6 });
    tone({ type: 'sine', f: 70, f2: 22, peak: 0.8, a: 0.004, d: 0.8 });
    noise({ peak: 0.3, a: 0.2, d: 1.4, f: 300, f2: 90, wet: 0.7 });
  },
  gas_hiss:      () => { noise({ peak: 0.28, a: 0.02, d: 0.5, f: 3500, ft: 'highpass' }); tone({ type: 'sawtooth', f: 140, f2: 90, peak: 0.1, a: 0.05, d: 0.4, lp: 600 }); },
  chip:          () => { tone({ type: 'sine', f: 1300, f2: 1700, peak: 0.12, a: 0.003, d: 0.07 }); tone({ type: 'sine', f: 2600, peak: 0.04, a: 0.002, d: 0.05, t: now() + 0.03 }); },
  heal:          () => { tone({ type: 'sine', f: 520, peak: 0.12, a: 0.02, d: 0.4, wet: 0.4 }); tone({ type: 'sine', f: 780, peak: 0.1, a: 0.05, d: 0.5, wet: 0.4 }); },
  ammo:          () => { clack(1200, 0.14, 0.04); setTimeout(() => clack(1600, 0.12, 0.04), 80); },
  dash:          () => noise({ peak: 0.28, a: 0.03, d: 0.18, f: 700, f2: 3000, ft: 'bandpass', q: 0.8 }),
  melee:         () => { SFX.whoosh(); setTimeout(() => ctx && (noise({ peak: 0.4, a: 0.002, d: 0.08, f: 700 }), tone({ type: 'sine', f: 120, f2: 60, peak: 0.3, a: 0.002, d: 0.1 })), 110); },
  card:          () => noise({ peak: 0.16, a: 0.002, d: 0.05, f: 5000, ft: 'highpass' }),
  shuffle:       () => { for (let i = 0; i < 8; i++) noise({ peak: 0.1, a: 0.002, d: 0.03, f: 5000, ft: 'highpass', t: now() + i * 0.035 }); },
  wheel_tick:    () => tone({ type: 'square', f: 1100, peak: 0.06, a: 0.002, d: 0.025 }),
  slot_spin:     () => tone({ type: 'square', f: 500, peak: 0.07, a: 0.003, d: 0.035 }),
  wager_win:     () => [0, 3, 7, 12].forEach((s, i) => tone({ type: 'sine', f: 440 * 2 ** (s / 12), peak: 0.13, a: 0.01, d: 0.5, t: now() + i * 0.1, wet: 0.5 })),
  wager_lose:    () => [0, -1, -6].forEach((s, i) => tone({ type: 'sawtooth', f: 220 * 2 ** (s / 12), peak: 0.14, a: 0.01, d: 0.5, t: now() + i * 0.18, lp: 900, wet: 0.5 })),
  jackpot:       () => [0, 3, 7, 10, 12, 15].forEach((s, i) => tone({ type: 'triangle', f: 523 * 2 ** (s / 12), peak: 0.12, a: 0.005, d: 0.4, t: now() + i * 0.08, wet: 0.5 })),
  boss_phase:    () => {
    tone({ type: 'sawtooth', f: 73, f2: 36, peak: 0.4, a: 0.05, d: 1.6, lp: 400, wet: 0.7 });
    tone({ type: 'sawtooth', f: 104, f2: 52, peak: 0.25, a: 0.05, d: 1.6, lp: 500, wet: 0.7 });
    noise({ peak: 0.35, a: 0.4, d: 1.2, f: 200, f2: 1600, ft: 'bandpass', wet: 0.8 });
    SFX.bell();
  },
  warn:          () => tone({ type: 'square', f: 880, f2: 620, peak: 0.14, a: 0.005, d: 0.14, lp: 3000 }),
  door:          () => { tone({ type: 'sawtooth', f: 90, f2: 70, peak: 0.1, a: 0.2, d: 0.9, lp: 400, q: 8, wet: 0.5 }); clack(500, 0.2, 0.1, 0.4); },
  countdown:     () => tone({ type: 'sine', f: 440, peak: 0.16, a: 0.005, d: 0.25, wet: 0.4 }),
  go:            () => { tone({ type: 'sine', f: 880, peak: 0.18, a: 0.005, d: 0.4, wet: 0.5 }); tone({ type: 'sine', f: 1318, peak: 0.08, a: 0.005, d: 0.4, wet: 0.5 }); },
  heartbeat:     () => {
    const t = now();
    tone({ type: 'sine', f: 62, f2: 38, peak: 0.45, a: 0.008, d: 0.13, t, dest: musicGain });
    tone({ type: 'sine', f: 55, f2: 34, peak: 0.28, a: 0.008, d: 0.15, t: t + 0.2, dest: musicGain });
  },
  // atmosphere voices
  bell: () => {
    const f = rand(95, 140), t = now();
    [1, 2.76, 5.4, 8.93, 13.34].forEach((r, i) => tone({ type: 'sine', f: f * r, peak: [0.12, 0.07, 0.045, 0.025, 0.012][i], a: 0.004, d: 4.5 - i * 0.6, t, dest: ambientGain, wet: 0.9 }));
  },
  whisper: () => {
    const t = now();
    for (let i = 0; i < 5; i++) {
      noise({ peak: rand(0.02, 0.05), a: 0.05, d: rand(0.12, 0.3), f: rand(1500, 3200), ft: 'bandpass', q: 6, t: t + i * rand(0.09, 0.16), dest: currentDest || ambientGain, wet: 0.6 });
    }
  },
  swell: () => {
    // a reversed-sounding swell that cuts off dead
    const t = now(), src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(1800, t + 2.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 2.2); g.gain.setValueAtTime(0.0001, t + 2.21);
    src.connect(f).connect(g).connect(ambientGain); g.connect(reverbIn);
    src.start(t); src.stop(t + 2.3);
  },
  creak: () => {
    const f = rand(60, 110);
    tone({ type: 'sawtooth', f, f2: f * rand(1.2, 1.6), slide: 0.8, peak: 0.07, a: 0.1, d: 0.8, lp: 700, q: 12, dest: currentDest || ambientGain, wet: 0.6 });
  },
  scream: () => {
    tone({ type: 'sawtooth', f: rand(600, 800), f2: rand(300, 400), slide: 1.4, peak: 0.035, a: 0.15, d: 1.3, lp: 1500, q: 5, dest: currentDest || ambientGain, wet: 1 });
  },

  // ------------------------------ the new guns ------------------------------
  shoot_derringer: () => { gun(3800, 0.65, 130, 0.65, 0.32, 0.4); tone({ type: 'sine', f: 90, f2: 40, peak: 0.25, a: 0.003, d: 0.25 }); },
  shoot_tommy:     () => gun(3600, 0.42, 150, 0.4, 0.18, 0.25),
  shoot_card:      () => { noise({ peak: 0.3, a: 0.002, d: 0.08, f: 4200, f2: 1800, ft: 'bandpass', q: 1.2, wet: 0.15 }); clack(2400, 0.12, 0.02, 0.05); tone({ type: 'triangle', f: 1600, f2: 700, peak: 0.05, a: 0.002, d: 0.09 }); },
  shoot_cork:      () => { tone({ type: 'sine', f: 520, f2: 140, peak: 0.45, a: 0.002, d: 0.12 }); noise({ peak: 0.35, a: 0.002, d: 0.18, f: 1400, f2: 400, wet: 0.35 }); noise({ peak: 0.08, a: 0.05, d: 0.6, f: 6000, ft: 'highpass', wet: 0.2 }); },
  shoot_whale:     () => { gun(2200, 0.95, 70, 1.0, 0.8, 0.7); tone({ type: 'sine', f: 48, f2: 24, peak: 0.6, a: 0.004, d: 0.9, wet: 0.5 }); noise({ peak: 0.3, a: 0.02, d: 1.1, f: 400, f2: 90, wet: 0.8 }); },
  flame:           () => { noise({ peak: 0.2, a: 0.03, d: 0.26, f: 900, f2: 500, q: 0.5, wet: 0.15 }); noise({ peak: 0.07, a: 0.02, d: 0.2, f: 3500, ft: 'highpass' }); },
  ignite:          () => { clack(2000, 0.1, 0.02); noise({ peak: 0.25, a: 0.02, d: 0.35, f: 600, f2: 1800, ft: 'bandpass', wet: 0.2 }); },
  break_open:      () => { clack(1300, 0.18, 0.05); setTimeout(() => ctx && clack(800, 0.12, 0.05), 70); },
  break_close:     () => { clack(1000, 0.26, 0.06, 0.15); tone({ type: 'sine', f: 180, f2: 90, peak: 0.12, a: 0.002, d: 0.08 }); },

  // -------------------------------- the automats ------------------------------
  pour:        () => { for (let i = 0; i < 6; i++) tone({ type: 'sine', f: rand(500, 900) + i * 60, f2: rand(900, 1400), peak: 0.03, a: 0.01, d: 0.07, t: now() + i * 0.05 }); noise({ peak: 0.05, a: 0.05, d: 0.35, f: 2400, ft: 'bandpass', q: 1.5 }); },
  glass_clink: () => tink(rand(3600, 4200)),
  gulp:        () => { tone({ type: 'sine', f: 180, f2: 90, peak: 0.25, a: 0.01, d: 0.1 }); noise({ peak: 0.06, a: 0.01, d: 0.08, f: 500 }); },
  glass_smash: () => { noise({ peak: 0.4, a: 0.001, d: 0.12, f: 5000, ft: 'highpass', wet: 0.25 }); for (let i = 0; i < 8; i++) setTimeout(() => ctx && tink(rand(3000, 6500)), 20 + i * rand(15, 40)); },
  perk_get:    () => { [0, 4, 7, 12, 16].forEach((s, i) => tone({ type: 'triangle', f: 392 * 2 ** (s / 12), peak: 0.1, a: 0.005, d: 0.35, t: now() + i * 0.06, wet: 0.5, warble: true })); },
  revive:      () => { tone({ type: 'sawtooth', f: 60, f2: 240, slide: 0.8, peak: 0.25, a: 0.05, d: 1.0, lp: 1200, wet: 0.7 }); SFX.jackpot(); },

  // ---------------------------- lethals + tacticals ---------------------------
  splash:        () => { noise({ peak: 0.3, a: 0.004, d: 0.3, f: 1200, f2: 300, wet: 0.2 }); for (let i = 0; i < 4; i++) tone({ type: 'sine', f: rand(700, 1300), f2: rand(300, 500), peak: 0.04, a: 0.002, d: 0.08, t: now() + i * 0.04 }); },
  slip:          () => { tone({ type: 'square', f: rand(1100, 1500), f2: rand(400, 600), slide: 0.12, peak: 0.05, a: 0.004, d: 0.12, lp: 3000 }); setTimeout(() => ctx && (noise({ peak: 0.35, a: 0.003, d: 0.15, f: 500 }), tone({ type: 'sine', f: 70, f2: 40, peak: 0.35, a: 0.003, d: 0.15 })), 180); },
  fire_whoosh:   () => noise({ peak: 0.4, a: 0.05, d: 0.7, f: 300, f2: 2400, ft: 'bandpass', q: 0.8, wet: 0.3 }),
  rope_plant:    () => { clack(900, 0.22, 0.05); tink(2600); },
  beep:          () => tone({ type: 'square', f: 1760, peak: 0.08, a: 0.002, d: 0.08, lp: 5000 }),
  clock_stop:    () => { tone({ type: 'sine', f: 1200, f2: 90, slide: 0.9, peak: 0.25, a: 0.01, d: 1.0, wet: 0.8, warble: true }); SFX.bell(); },
  tick:          () => clack(3200, 0.08, 0.015, 0.2),
  camera_flash:  () => { noise({ peak: 0.5, a: 0.001, d: 0.08, f: 6000, ft: 'highpass' }); tone({ type: 'sine', f: 5200, f2: 9000, peak: 0.05, a: 0.3, d: 0.2 }); clack(1500, 0.2, 0.04); },
  turret_deploy: () => { for (let i = 0; i < 4; i++) setTimeout(() => ctx && clack(900 + i * 300, 0.14, 0.04), i * 110); tone({ type: 'sawtooth', f: 200, f2: 800, slide: 0.5, peak: 0.06, a: 0.05, d: 0.5, lp: 1500 }); },
  turret:        () => gun(4800, 0.25, 220, 0.16, 0.08, 0.12),
  powerdown:     () => tone({ type: 'sawtooth', f: 700, f2: 60, slide: 0.9, peak: 0.1, a: 0.02, d: 0.9, lp: 1200 }),

  // ---------------------------------- the wheel -------------------------------
  wheel_spin:    () => { noise({ peak: 0.12, a: 0.3, d: 1.6, f: 300, f2: 120, wet: 0.4 }); clack(700, 0.18, 0.06); },

  // -------------------------- LADY LUCK + ALL IN ------------------------------
  part_get:      () => {
    const t0 = now();
    [0, 4, 7, 12, 16].forEach((s, i) => tone({ type: 'triangle', f: 659 * 2 ** (s / 12), peak: 0.1, a: 0.005, d: 0.5, t: t0 + i * 0.06, wet: 0.6 }));
    tone({ type: 'sine', f: 2637, f2: 3520, slide: 0.9, peak: 0.035, a: 0.2, d: 0.8, t: t0, wet: 0.8, warble: true });
  },
  luck_zap:      () => {
    const t0 = now();
    noise({ peak: 0.45, a: 0.001, d: 0.12, f: 5000, ft: 'highpass', wet: 0.2 });
    tone({ type: 'sawtooth', f: 1400, f2: 180, slide: 0.18, peak: 0.16, a: 0.002, d: 0.2, lp: 4000, wet: 0.3 });
    tone({ type: 'square', f: 90, f2: 45, peak: 0.28, a: 0.002, d: 0.25 });
    tone({ type: 'triangle', f: 1568, peak: 0.07, a: 0.002, d: 0.35, t: t0 + 0.04, wet: 0.5 });   // the ding
  },
  luck_jump:     () => {
    noise({ peak: 0.22, a: 0.001, d: 0.07, f: 3500, ft: 'bandpass', q: 1.5, wet: 0.2 });
    tone({ type: 'sawtooth', f: rand(900, 1400), f2: 300, slide: 0.08, peak: 0.07, a: 0.001, d: 0.09, lp: 3500 });
  },
  luck_raise:    () => {
    const t0 = now();
    rattle(t0, 7, 0.035, 2200, 2800, 0.07, 0.015, 4, 0.1);                   // the reels whirr
    [1568, 2093].forEach((f, i) => tone({ type: 'triangle', f, peak: 0.07, a: 0.003, d: 0.4, t: t0 + 0.28 + i * 0.1, wet: 0.5 }));
  },
  allin_start:   () => {
    const t0 = now();
    noise({ peak: 0.3, a: 0.002, d: 0.08, f: 900, ft: 'bandpass', q: 2, t: t0 });   // the lever's clunk
    tone({ type: 'sine', f: 70, f2: 45, peak: 0.3, a: 0.003, d: 0.2, t: t0 });
    rattle(t0 + 0.3, 24, 0.07, 2400, 2800, 0.05, 0.015, 4, 0.1);
    tone({ type: 'sawtooth', f: 110, f2: 330, slide: 2.2, peak: 0.05, a: 0.4, d: 2.0, lp: 900, t: t0 + 0.2, wet: 0.4 });
  },
  allin_stamp:   () => {
    const t0 = now();
    noise({ peak: 0.7, a: 0.001, d: 0.25, f: 700, f2: 120, t: t0, wet: 0.5 });
    tone({ type: 'sine', f: 60, f2: 30, peak: 0.6, a: 0.002, d: 0.5, t: t0 });
    [0, 4, 7, 12, 16, 19].forEach((s, i) => tone({ type: 'triangle', f: 523 * 2 ** (s / 12), peak: 0.1, a: 0.005, d: 0.6, t: t0 + 0.2 + i * 0.07, wet: 0.6 }));
    tone({ type: 'sine', f: 1046, peak: 0.05, a: 0.005, d: 2.5, t: t0 + 0.2, wet: 0.9, warble: true });
  },

  // ------------------------------- the Strip ---------------------------------
  dice_roll:     () => {
    const t0 = now();
    rattle(t0, 9, 0.06, 1800, 3000, 0.12);
    noise({ peak: 0.25, a: 0.001, d: 0.04, f: 1400, ft: 'bandpass', q: 2, t: t0 + 0.55, wet: 0.2 });   // off the back wall
    rattle(t0 + 0.62, 5, 0.1, 2000, 3200, 0.08, 0.02, 3, 0.1);
  },
  /** "ding-dong" and a muffled page over the casino PA */
  pa_chime:      () => {
    const t0 = now();
    [[659, 0], [523, 0.55]].forEach(([f, dt]) => {
      tone({ type: 'sine', f, peak: 0.06, a: 0.005, d: 1.6, t: t0 + dt, wet: 0.8 });
      tone({ type: 'sine', f: f * 2.01, peak: 0.018, a: 0.005, d: 0.8, t: t0 + dt, wet: 0.8 });
    });
    for (let i = 0; i < 16; i++) noise({ peak: 0.03, a: 0.03, d: rand(0.08, 0.2), f: rand(500, 1100), ft: 'bandpass', q: 6, t: t0 + 1.4 + i * 0.13 + rand(0, 0.05), wet: 0.9 });
  },
  coins:         () => {
    const t0 = now();
    for (let i = 0; i < 14; i++) tone({ type: 'sine', f: rand(2800, 4200), peak: 0.03, a: 0.001, d: 0.09, t: t0 + i * 0.035 + rand(0, 0.02), wet: 0.3 });
    noise({ peak: 0.05, a: 0.01, d: 0.5, f: 4000, ft: 'highpass', t: t0, wet: 0.3 });
  },
  cheer:         () => {
    const t0 = now();
    noise({ peak: 0.13, a: 0.25, d: 1.6, f: 900, ft: 'bandpass', q: 0.6, t: t0, wet: 0.7 });
    noise({ peak: 0.07, a: 0.2, d: 1.3, f: 2200, ft: 'bandpass', q: 0.8, t: t0 + 0.05, wet: 0.7 });
    rattle(t0 + 0.1, 10, 0.09, 2000, 3000, 0.05, 0.03, 3, 0.3);             // claps
    tone({ type: 'sine', f: 1800, f2: 2600, slide: 0.25, peak: 0.025, a: 0.02, d: 0.3, t: t0 + 0.3, wet: 0.5 });   // a whistle
  },
  /** the ghost at the lounge piano noodles a D minor phrase */
  lounge_piano:  () => {
    const t0 = now();
    const phrases = [[0, 3, 7, 10, 14], [5, 8, 12, 15, 17], [-2, 2, 5, 9, 12], [7, 10, 14, 17, 19], [3, 7, 10, 14, 15]];
    const ph = phrases[Math.floor(Math.random() * phrases.length)];
    piano(146.83 * 2 ** (ph[0] / 12), t0, 1.1);
    ph.forEach((s, i) => piano(293.66 * 2 ** (s / 12), t0 + 0.05 + i * 0.34 + rand(0, 0.04), 0.8 - i * 0.06));
  },
  // ------------------------------- rewards -----------------------------------
  // a sting per rarity: you hear how good it is before you read it
  comp_common:   () => { const t0 = now(); [0, 7].forEach((s, i) => tone({ type: 'triangle', f: 880 * 2 ** (s / 12), peak: 0.06, a: 0.003, d: 0.18, t: t0 + i * 0.06, wet: 0.3 })); },
  comp_uncommon: () => { const t0 = now(); [0, 4, 7].forEach((s, i) => tone({ type: 'triangle', f: 784 * 2 ** (s / 12), peak: 0.08, a: 0.003, d: 0.25, t: t0 + i * 0.06, wet: 0.4 })); },
  comp_rare:     () => {
    const t0 = now();
    [0, 4, 7, 12].forEach((s, i) => tone({ type: 'triangle', f: 659 * 2 ** (s / 12), peak: 0.1, a: 0.004, d: 0.35, t: t0 + i * 0.07, wet: 0.5 }));
    tone({ type: 'sine', f: 2637, peak: 0.03, a: 0.1, d: 0.6, t: t0 + 0.2, wet: 0.8, warble: true });
  },
  comp_epic:     () => {
    const t0 = now();
    [0, 3, 7, 10, 12, 15].forEach((s, i) => tone({ type: 'triangle', f: 523 * 2 ** (s / 12), peak: 0.11, a: 0.004, d: 0.45, t: t0 + i * 0.065, wet: 0.6 }));
    tone({ type: 'sawtooth', f: 131, f2: 262, slide: 0.5, peak: 0.06, a: 0.05, d: 0.6, lp: 1200, t: t0, wet: 0.5 });
  },
  comp_legendary: () => {
    const t0 = now();
    // a brass-band fanfare: da-da-da-DAAA
    [[0, 0], [0, 0.12], [0, 0.24], [7, 0.4]].forEach(([s, dt], i) => {
      tone({ type: 'sawtooth', f: 392 * 2 ** (s / 12), peak: i === 3 ? 0.13 : 0.09, a: 0.01, d: i === 3 ? 1.1 : 0.12, t: t0 + dt, lp: 2600, wet: 0.5 });
      tone({ type: 'square', f: 196 * 2 ** (s / 12), peak: 0.04, a: 0.01, d: i === 3 ? 1 : 0.1, t: t0 + dt, lp: 1200, wet: 0.4 });
    });
    [12, 16, 19, 24].forEach((s, i) => tone({ type: 'triangle', f: 392 * 2 ** (s / 12), peak: 0.06, a: 0.005, d: 0.8, t: t0 + 0.45 + i * 0.07, wet: 0.7 }));
    rattle(t0 + 0.4, 12, 0.04, 2800, 4200, 0.04, 0.05, 3, 0.4);       // coins
  },
  level_up:      () => { SFX.comp_legendary(); const t0 = now(); tone({ type: 'sine', f: 1568, f2: 3136, slide: 1.2, peak: 0.04, a: 0.3, d: 1.2, t: t0 + 0.4, wet: 0.9, warble: true }); },
  achievement:   () => {
    const t0 = now();
    [0, 4, 7, 11, 14].forEach((s, i) => tone({ type: 'triangle', f: 587 * 2 ** (s / 12), peak: 0.09, a: 0.004, d: 0.6, t: t0 + i * 0.08, wet: 0.7 }));
    tone({ type: 'sine', f: 70, f2: 50, peak: 0.25, a: 0.004, d: 0.4, t: t0 });
  },
  discovery:     () => {
    const t0 = now();
    for (let i = 0; i < 6; i++) tone({ type: 'sine', f: 1318 * 2 ** ([0, 4, 7, 12, 16, 19][i] / 12), peak: 0.05, a: 0.005, d: 0.5, t: t0 + i * 0.05, wet: 0.8, warble: true });
    SFX.comp_rare();
  },
  glint:         () => { const t0 = now(); [0, 0.09].forEach((dt, i) => tone({ type: 'sine', f: 2637 * (i ? 1.5 : 1), peak: 0.035, a: 0.002, d: 0.4, t: t0 + dt, wet: 0.9 })); },
  streak_tier:   () => { const t0 = now(); [0, 5, 9, 12].forEach((s, i) => tone({ type: 'square', f: 440 * 2 ** (s / 12), peak: 0.05, a: 0.003, d: 0.12, t: t0 + i * 0.045, lp: 3000, wet: 0.3 })); },
  streak_end:    () => tone({ type: 'triangle', f: 660, f2: 330, slide: 0.3, peak: 0.07, a: 0.005, d: 0.35, wet: 0.4 }),
  happy_hour:    () => {
    const t0 = now();
    [0, 4, 7, 9, 12, 9, 7, 4].forEach((s, i) => tone({ type: 'triangle', f: 440 * 2 ** (s / 12), peak: 0.07, a: 0.005, d: 0.16, t: t0 + i * 0.09, wet: 0.5 }));
    rattle(t0, 8, 0.05, 2400, 3400, 0.05, 0.04, 3, 0.3);
  },
  /** THE KING: a low "uh-huh" */
  croon:         () => {
    const t0 = now();
    [[110, 98, 0, 0.35], [123, 110, 0.42, 0.7]].forEach(([f, f2, dt, d]) => {
      tone({ type: 'sawtooth', f, f2, slide: d, peak: 0.16, a: 0.05, d, t: t0 + dt, lp: 700, q: 4, wet: 0.6, warble: true });
      tone({ type: 'sine', f: f * 2, f2: f2 * 2, slide: d, peak: 0.05, a: 0.05, d, t: t0 + dt, wet: 0.5 });
    });
  },
};

// -------------------------------- the score ----------------------------------
// D harmonic minor waltz, 3/4, eighth-note steps (6 per bar), 16-bar loop.
const D4 = 293.66, D5 = 587.33;
const CHORDS = [
  [0, 3, 7], [0, 3, 7], [5, 8, 12], [5, 8, 12], [8, 12, 15], [7, 11, 14], [0, 3, 7], [7, 11, 13],
  [0, 3, 7], [3, 7, 12], [5, 8, 12], [2, 5, 8], [8, 12, 15], [7, 11, 14], [0, 3, 7], [0, 3, 8],
];
// melody per bar: 3 beats (semitones from D5), null = rest
const MELODY = [
  [-5, 0, 3], [2, 0, null], [0, -4, -7], [-5, null, null],
  [3, 2, 0], [-1, 2, 7], [3, 2, 0], [-1, null, null],
  [7, 3, 0], [-5, -2, 3], [5, 3, 0], [2, 5, 8],
  [7, 3, 0], [-1, 2, 5], [3, 2, -1], [0, null, null],
];

function musicBox(f, t, vel = 1, sour = 0) {
  const detune = rand(-8, 8) + sour;
  tone({ type: 'sine', f, peak: 0.07 * vel, a: 0.004, d: 1.7, t, dest: musicGain, wet: 0.55, detune, warble: true });
  tone({ type: 'sine', f: f * 4.0, peak: 0.018 * vel, a: 0.002, d: 0.35, t, dest: musicGain, wet: 0.5, detune, warble: true });
  tone({ type: 'sine', f: f * 2.76, peak: 0.01 * vel, a: 0.002, d: 0.5, t, dest: musicGain, wet: 0.5, detune });
}

function stringPad(semis, t, dur, peak = 0.03) {
  for (const s of semis) {
    for (const det of [-9, 7]) {
      tone({ type: 'sawtooth', f: (D4 / 2) * 2 ** (s / 12), peak, a: dur * 0.45, d: dur * 0.55, t, dest: musicGain, wet: 0.8, detune: det, lp: 700 });
    }
  }
}

function tom(t, f = 95, peak = 0.35) {
  tone({ type: 'sine', f, f2: f * 0.45, peak, a: 0.004, d: 0.32, t, dest: musicGain, wet: 0.3 });
  noise({ peak: peak * 0.3, a: 0.003, d: 0.08, f: 500, t, dest: musicGain });
}

function brassStab(t) {
  for (const s of [-24, -18, -13]) {
    tone({ type: 'sawtooth', f: D5 * 2 ** (s / 12), peak: 0.045, a: 0.02, d: 0.6, t, dest: musicGain, wet: 0.6, lp: 1100, q: 2 });
  }
}

function scheduleStep(step, t) {
  const bar = Math.floor(step / 6) % 16, pos = step % 6;
  const chord = CHORDS[bar];
  const danger = M.intensity;
  if (M.boss) {
    if (pos % 2 === 0) tom(t, pos === 0 ? 80 : 110, pos === 0 ? 0.42 : 0.28);
    if (pos === 0 && bar % 2 === 0) brassStab(t);
    if (pos === 3) noise({ peak: 0.05, a: 0.002, d: 0.05, f: 6000, ft: 'highpass', t, dest: musicGain });
    const mel = MELODY[bar][pos / 2];
    if (pos % 2 === 0 && mel !== null && mel !== undefined) musicBox(D5 * 2 ** (mel / 12), t, 0.8, -35);
    return;
  }
  // oom-pah-pah: low box note on 1, chord tones on 2 and 3
  if (pos === 0) musicBox(D4 * 2 ** ((chord[0] - 12) / 12), t, 0.9);
  if (pos === 2 || pos === 4) {
    for (const s of chord.slice(1)) musicBox(D4 * 2 ** (s / 12), t, 0.35 * (1 - danger * 0.5));
  }
  // melody on the beats; the box goes sour now and then
  if (pos % 2 === 0) {
    const mel = MELODY[bar][pos / 2];
    if (mel !== null && mel !== undefined && Math.random() > danger * 0.35) {
      const sour = Math.random() < 0.08 ? -rand(40, 80) : 0;
      musicBox(D5 * 2 ** (mel / 12), t, 1 - danger * 0.3, sour);
    }
  }
  // dissonant string swell every 4 bars (with a minor second rubbing)
  if (pos === 0 && bar % 4 === 0) stringPad([chord[0] - 12, chord[1] - 12, chord[1] - 11], t, 7.5, 0.018 + danger * 0.012);
  // danger: ticking hats
  if (danger > 0.45 && pos % 2 === 1) noise({ peak: 0.02 + danger * 0.03, a: 0.002, d: 0.04, f: 7000, ft: 'highpass', t, dest: musicGain });
}

function schedule() {
  if (!ctx) return;
  const t = now();
  // tempo: a slow waltz that quickens with danger; bosses charge
  const bpm = M.boss ? 132 : 66 + M.intensity * 40;
  const stepDur = 60 / bpm / 2;
  if (M.next < t) M.next = t + 0.05;
  while (M.next < t + 0.15) {
    scheduleStep(M.step, M.next);
    // now and then the box winds down: stretch a few steps
    const wind = !M.boss && M.step % 96 > 88 ? 1 + (M.step % 96 - 88) * 0.12 : 1;
    M.next += stepDur * wind;
    M.step++;
  }
  // heartbeat: faster and louder as danger rises or health drops
  const fear = Math.max(M.intensity - 0.3, (1 - M.health) * 1.1 - 0.35);
  if (fear > 0 && t >= M.beatNext) {
    SFX.heartbeat();
    M.beatNext = t + 60 / (70 + fear * 90);
  }
  // tension strings + drone follow danger
  const tens = Math.max(0, (M.intensity - 0.5) * 2);
  strings.gain?.gain.setTargetAtTime(tens * 0.03 + (M.boss ? 0.02 : 0), t, 0.5);
  drone.gain?.gain.setTargetAtTime(M.boss ? 0.09 : 0.05 + M.intensity * 0.03, t, 0.8);
  drone.tri?.gain.setTargetAtTime(M.boss ? 0.035 : 0, t, 1);
  // atmosphere events
  M.eventT -= 0.03;
  if (M.eventT <= 0) {
    M.eventT = rand(9, 22);
    const r = Math.random();
    const pan = ctx.createStereoPanner();
    pan.pan.value = rand(-0.9, 0.9);
    pan.connect(ambientGain);
    currentDest = pan;
    try {
      if (r < 0.25) SFX.bell();
      else if (r < 0.45) SFX.whisper();
      else if (r < 0.62) SFX.swell();
      else if (r < 0.8) SFX.creak();
      else if (r < 0.92) SFX.ambient_chime();
      else SFX.scream();
    } catch { /* never crash on ambience */ }
    currentDest = null;
    setTimeout(() => { try { pan.disconnect(); } catch {} }, 6000);
  }
}

function startBeds() {
  // the drone: D1 + D2 + a detuned fifth, breathing through a slow filter
  drone.gain = ctx.createGain(); drone.gain.gain.value = 0.05;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 3;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.045;
  const lfoG = ctx.createGain(); lfoG.gain.value = 140;
  lfo.connect(lfoG).connect(lp.frequency);
  for (const [f, type, det] of [[36.7, 'sine', 0], [73.4, 'sawtooth', -6], [110, 'sawtooth', 9]]) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det;
    o.connect(lp); o.start();
  }
  // tritone that creeps in for bosses
  drone.tri = ctx.createGain(); drone.tri.gain.value = 0;
  const tri = ctx.createOscillator(); tri.type = 'sawtooth'; tri.frequency.value = 103.8;
  tri.connect(drone.tri).connect(lp);
  tri.start(); lfo.start();
  lp.connect(drone.gain);
  drone.gain.connect(musicGain);
  drone.gain.connect(reverbIn);

  // tension strings: a high trembling cluster, silent until danger
  strings.gain = ctx.createGain(); strings.gain.gain.value = 0;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 1.2;
  const trem = ctx.createGain(); trem.gain.value = 0.6;
  const tremLfo = ctx.createOscillator(); tremLfo.frequency.value = 9;
  const tremAmt = ctx.createGain(); tremAmt.gain.value = 0.4;
  tremLfo.connect(tremAmt).connect(trem.gain);
  for (const f of [1174.7, 1244.5, 1318.5]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = rand(-10, 10);
    o.connect(bp); o.start();
  }
  tremLfo.start();
  bp.connect(trem).connect(strings.gain);
  strings.gain.connect(musicGain);
  strings.gain.connect(reverbIn);

  // haunted air: low wind that swells and falls
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(); src.loop = true;
  const wlp = ctx.createBiquadFilter(); wlp.type = 'lowpass'; wlp.frequency.value = 280; wlp.Q.value = 1.5;
  const wg = ctx.createGain(); wg.gain.value = 0.05;
  const wl = ctx.createOscillator(); wl.frequency.value = 0.07;
  const wlg = ctx.createGain(); wlg.gain.value = 0.035;
  wl.connect(wlg).connect(wg.gain);
  const wf = ctx.createOscillator(); wf.frequency.value = 0.031;
  const wfg = ctx.createGain(); wfg.gain.value = 120;
  wf.connect(wfg).connect(wlp.frequency);
  src.connect(wlp).connect(wg).connect(ambientGain);
  src.start(); wl.start(); wf.start();

  // tape warble for the music box
  warble = ctx.createGain(); warble.gain.value = 14;
  const wob = ctx.createOscillator(); wob.frequency.value = 0.9;
  wob.connect(warble); wob.start();
}

export const Audio = {
  ready: false,

  init() {
    if (this.ready) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4;
      muffle = ctx.createBiquadFilter(); muffle.type = 'lowpass'; muffle.frequency.value = 20000;
      sfxGain = ctx.createGain();
      musicGain = ctx.createGain();
      ambientGain = ctx.createGain();
      reverbIn = ctx.createGain(); reverbIn.gain.value = 0.9;
      reverb = ctx.createConvolver();
      reverb.buffer = makeImpulse(3.4, 2.4);
      reverbIn.connect(reverb).connect(muffle);
      sfxGain.connect(muffle);
      musicGain.connect(muffle);
      ambientGain.connect(muffle);
      muffle.connect(comp).connect(master);
      master.connect(ctx.destination);
      this.ready = true;
      this.setVolumes(0.8, 0.9, 0.5);
      startBeds();
      M.next = now() + 0.2;
      M.eventT = 6;
      setInterval(schedule, 30);
    } catch (e) {
      console.warn('WebAudio unavailable:', e);
    }
  },

  setVolumes(masterV, sfxV, musicV) {
    if (!ctx) return;
    master.gain.value = masterV;
    sfxGain.gain.value = sfxV;
    musicGain.gain.value = musicV * 1.3;
    ambientGain.gain.value = musicV * 1.1;   // ambience rides the music slider
  },

  setBossMode(on) { M.boss = on; },

  /** 0..1 danger level — drives tempo, heartbeat, tension strings */
  setIntensity(v) { M.intensity = Math.max(0, Math.min(1, v)); },

  /** 0..1 health — low health muffles the world and speeds the heart */
  setHealth(frac) {
    M.health = Math.max(0, Math.min(1, frac));
    if (!ctx) return;
    const f = frac < 0.3 ? 900 + frac / 0.3 * 7000 : 20000;
    muffle.frequency.setTargetAtTime(f, now(), 0.3);
  },

  /** play a sound AT a world position; pans + attenuates with distance.
      opts.muffled runs it through a lowpass (behind cover). */
  playAt(name, pos, opts = {}) {
    if (!ctx || ctx.state === 'suspended') return;
    const fn = SFX[name];
    if (!fn) return;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 3;
    panner.maxDistance = 60;
    panner.rolloffFactor = 1.25;
    if (panner.positionX) {
      panner.positionX.value = pos.x;
      panner.positionY.value = pos.y ?? 1.5;
      panner.positionZ.value = pos.z;
    } else panner.setPosition(pos.x, pos.y ?? 1.5, pos.z);
    const bus = opts.bus === 'ambient' ? ambientGain : sfxGain;
    if (opts.muffled) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 650;
      panner.connect(lp).connect(bus);
    } else {
      panner.connect(bus);
    }
    currentDest = panner;
    try { fn(); } catch { /* never crash on audio */ }
    currentDest = null;
    setTimeout(() => { try { panner.disconnect(); } catch {} }, 5000);
  },

  /** call every frame with the camera so left/right/behind are real */
  updateListener(pos, fwd) {
    if (!ctx) return;
    const L = ctx.listener;
    if (L.positionX) {
      L.positionX.value = pos.x; L.positionY.value = pos.y; L.positionZ.value = pos.z;
      L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  },

  /** the kill tick: climbs a pentatonic scale as the streak grows — you can hear yourself heating up */
  comboTick(n) {
    if (!ctx || ctx.state === 'suspended') return;
    const scale = [0, 2, 4, 7, 9];
    const step = Math.min(n, 30) - 1;
    const semis = scale[step % 5] + 12 * Math.floor(step / 5);
    try {
      tone({ type: 'triangle', f: 523 * 2 ** (Math.min(semis, 36) / 12), peak: 0.035 + Math.min(0.03, n * 0.001), a: 0.002, d: 0.09, wet: 0.25 });
    } catch { /* never crash on audio */ }
  },

  play(name) {
    if (!ctx || ctx.state === 'suspended') return;
    const fn = SFX[name];
    if (fn) { try { fn(); } catch (e) { /* never crash on audio */ } }
  },

  /** dev check: fire every sound once, report any that throw */
  _selfTest() {
    if (!ctx) return ['no audio context'];
    const bad = [];
    for (const [k, fn] of Object.entries(SFX)) { try { fn(); } catch (e) { bad.push(`${k}: ${e.message}`); } }
    try { for (let s = 0; s < 96; s++) scheduleStep(s, now() + s * 0.01); } catch (e) { bad.push('score: ' + e.message); }
    M.boss = true;
    try { for (let s = 0; s < 12; s++) scheduleStep(s, now() + s * 0.01); } catch (e) { bad.push('boss score: ' + e.message); }
    M.boss = false;
    return bad;
  },
};
