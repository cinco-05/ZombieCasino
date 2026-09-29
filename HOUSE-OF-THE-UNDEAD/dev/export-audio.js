// export-audio.js — dev tool (not shipped): renders the game's procedural
// audio (src/audio.js, 100% Web Audio) to WAV for the Unreal rebuild
// (C:\Users\cj5st\UnrealProjects\HouseOfTheUndead\SourceArt\Audio).
//
// Each sound runs through the game's real mixing graph (compressor, reverb)
// on an OfflineAudioContext instead of the speakers. Sounds that schedule
// their tail with setTimeout (a hammer cock, then the click) are replayed at
// the right moment using the offline context's suspend points; the music
// scheduler is driven the same way for the score loops.
//
//   const A = await import('/dev/export-audio.js');
//   const wav = await A.renderSfx('shoot_shotgun');          // ArrayBuffer (WAV, 48 kHz stereo 16-bit)
//   const loop = await A.renderMusic({ seconds: 64, boss: false, intensity: 0.4 });

import { Audio } from '../src/audio.js';

const RATE = 48000;

/** 16-bit PCM WAV */
export function encodeWav(buffer) {
  const ch = buffer.numberOfChannels, n = buffer.length;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, RATE, true); out.setUint32(28, RATE * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch).keys()].map((c) => buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { out.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 32767, true); o += 2; }
  return out.buffer;
}

/** trim trailing silence (keeps a short fade so reverb tails aren't chopped) */
function trimmed(buffer, floor = 0.0008) {
  let last = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = d.length - 1; i > last; i--) if (Math.abs(d[i]) > floor) { last = i; break; }
  }
  const len = Math.min(buffer.length, last + Math.round(RATE * 0.05));
  const out = new AudioBuffer({ length: Math.max(1, len), numberOfChannels: buffer.numberOfChannels, sampleRate: RATE });
  for (let c = 0; c < buffer.numberOfChannels; c++) out.copyToChannel(buffer.getChannelData(c).subarray(0, len), c);
  return out;
}

/**
 * run fn against a fresh offline copy of the game's audio graph. Timers the
 * game code sets become suspend points in render time.
 */
async function renderOffline(seconds, setup, { musicStep = 0, beds = true } = {}) {
  const realAC = window.AudioContext, realST = window.setTimeout, realSI = window.setInterval;
  let offline = null;
  const timers = [];            // {at (render seconds), fn}
  let scheduler = null;
  window.AudioContext = function () {
    offline = new OfflineAudioContext(2, Math.ceil(RATE * seconds), RATE);
    // Audio.play() won't play into a 'suspended' context — an offline one is, until it renders
    Object.defineProperty(offline, 'state', { get: () => 'running', configurable: true });
    return offline;
  };
  window.setTimeout = (fn, ms = 0) => { timers.push({ at: (offline ? offline.currentTime : 0) + ms / 1000, fn }); return 0; };
  window.setInterval = (fn) => { scheduler = fn; return 0; };
  // the ambient beds (drone, strings, wind) start inside init() and feed the reverb
  // directly; for a clean sound effect, sources started during init() stay silent
  const realStart = AudioScheduledSourceNode.prototype.start;
  try {
    Audio.ready = false;
    if (!beds) AudioScheduledSourceNode.prototype.start = function () {};
    Audio.init();
    AudioScheduledSourceNode.prototype.start = realStart;
    setup(offline);
  } finally {
    AudioScheduledSourceNode.prototype.start = realStart;
    window.AudioContext = realAC; window.setInterval = realSI;
  }
  // replay timers (and their own timers) at their render time
  const planned = new Set();
  const plan = () => {
    for (const t of timers) {
      if (planned.has(t) || t.at >= seconds) continue;
      planned.add(t);
      const at = Math.max(t.at, offline.currentTime + 1 / RATE * 128);
      offline.suspend(Math.ceil(at * RATE / 128) * 128 / RATE).then(() => {
        try { t.fn(); } catch { /* never crash on audio */ }
        plan();
        offline.resume();
      }).catch(() => { /* two timers on one render quantum: the later one already fired */ });
    }
  };
  if (musicStep > 0 && scheduler) {
    for (let t = musicStep; t < seconds; t += musicStep) {
      offline.suspend(Math.round(t * RATE / 128) * 128 / RATE).then(() => { try { scheduler(); } catch {} plan(); offline.resume(); });
    }
    try { scheduler(); } catch {}
  }
  plan();
  const buffer = await offline.startRendering();
  window.setTimeout = realST;
  return buffer;
}

/** one sound effect, through the game's mix, as a WAV */
export async function renderSfx(name, seconds = 3) {
  const buffer = await renderOffline(seconds, () => {
    Audio.setVolumes(1, 1, 0);             // no music bed under the effect
    Audio.play(name);
  }, { beds: false });
  return encodeWav(trimmed(buffer));
}

/** a stretch of the generative score (music + ambience) */
export async function renderMusic({ seconds = 64, boss = false, intensity = 0.3, health = 1 } = {}) {
  const buffer = await renderOffline(seconds, () => {
    Audio.setVolumes(1, 0, 1);
    Audio.setBossMode(boss);
    Audio.setIntensity(intensity);
    Audio.setHealth(health);
  }, { musicStep: 0.05 });
  return encodeWav(buffer);
}

/** every sound name the game knows (the SFX table isn't exported; _selfTest walks it) */
export function sfxNames(sourceText) {
  const block = sourceText.slice(sourceText.indexOf('const SFX = {'), sourceText.indexOf('\n};', sourceText.indexOf('const SFX = {')));
  return [...block.matchAll(/^\s{2}([a-z0-9_]+)\s*:/gm)].map((m) => m[1]);
}
