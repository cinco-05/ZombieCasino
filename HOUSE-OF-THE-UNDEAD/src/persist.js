// persist.js — belt and braces for saves in the desktop exe. Browser storage
// alone is fragile (it can be wiped, or lose its last writes if the game is
// killed), so the exe also keeps every "hotu_" entry in a real file next to
// its profile (%LOCALAPPDATA%\HouseOfTheUndead\save.json, with a .bak). On
// launch, anything missing from browser storage is restored from the file
// BEFORE the rest of the game reads its settings (style.js imports this).
// In a plain browser (the .html version) this does nothing.

const host = window.chrome && window.chrome.webview;
const PREFIX = 'hotu_';

function snapshot() {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) out[k] = localStorage.getItem(k);
  }
  return out;
}

async function restore() {
  const data = await new Promise((resolve) => {
    const timer = setTimeout(() => { host.removeEventListener('message', on); resolve(null); }, 1500);
    function on(e) {
      const m = typeof e.data === 'string' ? e.data : '';
      if (!m.startsWith('store:data:')) return;
      clearTimeout(timer);
      host.removeEventListener('message', on);
      try { resolve(JSON.parse(m.slice(11) || 'null')); } catch { resolve(null); }
    }
    host.addEventListener('message', on);
    host.postMessage('store:get');
  });
  if (!data || typeof data !== 'object') return 0;
  let n = 0;
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith(PREFIX) && typeof v === 'string' && localStorage.getItem(k) === null) {
      try { localStorage.setItem(k, v); n++; } catch { /* full */ }
    }
  }
  return n;
}

let pending = null;
function mirrorSoon() {
  clearTimeout(pending);
  pending = setTimeout(mirrorNow, 700);
}
function mirrorNow() {
  clearTimeout(pending);
  pending = null;
  try { host.postMessage('store:put:' + JSON.stringify(snapshot())); } catch { /* host gone */ }
}

if (host) {
  let restored = 0;
  try { restored = await restore(); } catch { /* start without */ }
  if (restored) console.info(`[persist] restored ${restored} save entries from save.json`);
  // every save the game makes (and every deliberate delete) lands in the file too
  const set = Storage.prototype.setItem, rem = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (k, v) {
    set.call(this, k, v);
    if (this === localStorage && String(k).startsWith(PREFIX)) mirrorSoon();
  };
  Storage.prototype.removeItem = function (k) {
    rem.call(this, k);
    if (this === localStorage && String(k).startsWith(PREFIX)) mirrorSoon();
  };
  addEventListener('beforeunload', () => { if (pending) mirrorNow(); });
  addEventListener('pagehide', () => { if (pending) mirrorNow(); });
  mirrorSoon();                    // the file always matches what's here after launch
}

export {};
