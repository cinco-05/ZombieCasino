// tables.js — the felt. Real-looking cards (pips laid out like a printed deck,
// court cards, the house back) that fly off the shoe and flip over in 3D,
// stacks of chips in casino colors, chips that slide across the table when
// money changes hands, and a table that leans a little toward the mouse.
// Pure DOM helpers; casino.js runs the games on top of them.

const RED = new Set(['♥', '♦']);
const L = 28, C = 50, R = 72;            // pip columns (% of the card's width)
// pip positions [x%, y%] for each number card, like a printed deck
const PIPS = {
  2: [[C, 16], [C, 84]],
  3: [[C, 16], [C, 50], [C, 84]],
  4: [[L, 16], [R, 16], [L, 84], [R, 84]],
  5: [[L, 16], [R, 16], [C, 50], [L, 84], [R, 84]],
  6: [[L, 16], [R, 16], [L, 50], [R, 50], [L, 84], [R, 84]],
  7: [[L, 16], [R, 16], [C, 33], [L, 50], [R, 50], [L, 84], [R, 84]],
  8: [[L, 16], [R, 16], [C, 33], [L, 50], [R, 50], [C, 67], [L, 84], [R, 84]],
  9: [[L, 16], [R, 16], [L, 39], [R, 39], [C, 50], [L, 61], [R, 61], [L, 84], [R, 84]],
  10: [[L, 16], [R, 16], [C, 28], [L, 39], [R, 39], [L, 61], [R, 61], [C, 72], [L, 84], [R, 84]],
};
const COURT = { J: 'JACK', Q: 'QUEEN', K: 'KING' };
const COURT_MARK = { J: '⚔', Q: '♛', K: '♚' };

/** the printed face of a card */
function faceHtml(c) {
  const idx = `<span class="ci tl">${c.rank}<br>${c.suit}</span><span class="ci br">${c.rank}<br>${c.suit}</span>`;
  let mid;
  if (PIPS[c.rank]) {
    mid = PIPS[c.rank].map(([x, y]) => `<i class="pip${y > 55 ? ' flip' : ''}" style="left:${x}%;top:${y}%">${c.suit}</i>`).join('');
  } else if (COURT[c.rank]) {
    mid = `<span class="court"><b>${COURT_MARK[c.rank]}</b><em>${c.rank}</em><small>${c.suit}</small></span>`;
  } else {
    mid = `<span class="ace">${c.suit}</span>`;
  }
  return `${idx}<span class="pips">${mid}</span>`;
}

/** a card with two faces; faceDown shows the house back */
export function cardEl(card, { faceDown = false } = {}) {
  const el = document.createElement('div');
  el.className = `card3d${faceDown ? ' down' : ''}${RED.has(card.suit) ? ' red' : ''}`;
  el.innerHTML = `<div class="face front">${faceHtml(card)}</div><div class="face back"><span>☠</span></div>`;
  el._card = card;
  return el;
}

/** where el sits on the table's own plane (offsets ignore the 3D tilt) */
function planePos(el, plane) {
  let x = 0, y = 0, n = el;
  while (n && n !== plane) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
  return { x, y };
}

/**
 * deal a card into a container: it leaves the shoe face down, flies across
 * the felt and turns over as it lands (unless it's dealt face down).
 */
export function dealCard(container, card, { faceDown = false, delay = 0, from = null, sound = null, before = null, sideways = false } = {}) {
  const el = cardEl(card, { faceDown });
  el.style.setProperty('--rz', sideways ? '90deg' : `${(Math.random() - 0.5) * 3}deg`);
  if (sideways) el.classList.add('sideways');
  container.insertBefore(el, before);
  const plane = container.closest('.ts-table');
  if (from && plane) {
    const a = planePos(from, plane), b = planePos(el, plane);
    el.style.setProperty('--fx', `${a.x - b.x}px`);
    el.style.setProperty('--fy', `${a.y - b.y}px`);
  } else {
    el.style.setProperty('--fx', '0px');
    el.style.setProperty('--fy', '-160px');
  }
  el.style.animationDelay = `${delay}ms`;
  el.classList.add('fly');
  if (sound) setTimeout(sound, delay);
  el.addEventListener('animationend', () => el.classList.remove('fly'), { once: true });
  return el;
}

/** turn a face-down card over */
export function flipUp(el, delay = 0) {
  if (!el) return;
  setTimeout(() => el.classList.remove('down'), delay);
}

/** sweep cards off the table toward the discard tray, then drop them */
export function sweepCards(els, to) {
  for (const el of els) {
    // lift it out of the row where it lies, so the next card can take its place
    el.style.left = `${el.offsetLeft}px`;
    el.style.top = `${el.offsetTop}px`;
    el.style.position = 'absolute';
    const plane = el.closest('.ts-table');
    if (to && plane) {
      const a = planePos(to, plane), b = planePos(el, plane);
      el.style.setProperty('--tx', `${a.x - b.x}px`);
      el.style.setProperty('--ty', `${a.y - b.y}px`);
    }
    el.classList.add('sweep');
    setTimeout(() => el.remove(), 420);
  }
}

// ----------------------------------- chips -----------------------------------
const DENOMS = [
  [500, 'purple'], [100, 'black'], [25, 'green'], [5, 'red'], [1, 'white'],
];

/** an amount as stacks of casino chips (biggest first, at most 4 stacks of 12) */
export function chipStacksHtml(amount, { max = 4 } = {}) {
  let left = Math.max(0, Math.round(amount));
  const stacks = [];
  for (const [v, color] of DENOMS) {
    const n = Math.floor(left / v);
    if (!n) continue;
    left -= n * v;
    stacks.push(`<span class="cstack">${`<i class="chip ${color}"></i>`.repeat(Math.min(12, n))}</span>`);
    if (stacks.length >= max) break;
  }
  return stacks.join('') || '<span class="cstack empty"></span>';
}

/** a few chips skate across the screen, from one element to another */
export function flyChips(fromEl, toEl, count = 5, color = 'red') {
  if (!fromEl || !toEl) return;
  const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
  for (let i = 0; i < count; i++) {
    const c = document.createElement('i');
    c.className = `chip flychip ${color}`;
    c.style.left = `${a.left + a.width / 2}px`;
    c.style.top = `${a.top + a.height / 2}px`;
    c.style.setProperty('--dx', `${b.left + b.width / 2 - (a.left + a.width / 2) + (Math.random() - 0.5) * 30}px`);
    c.style.setProperty('--dy', `${b.top + b.height / 2 - (a.top + a.height / 2) + (Math.random() - 0.5) * 16}px`);
    c.style.animationDelay = `${i * 60}ms`;
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 900 + i * 60);
  }
}

/** a result stamp across a hand: WIN, PUSH, BUST… */
export function stamp(el, text, cls) {
  if (!el) return;
  el.querySelector('.hand-stamp')?.remove();
  const s = document.createElement('div');
  s.className = `hand-stamp ${cls}`;
  s.textContent = text;
  el.appendChild(s);
}

// ------------------------------- the lean -----------------------------------
/** the table leans a few degrees toward the mouse, like leaning over the felt */
export function leanWithMouse(stage) {
  if (stage._lean) return;
  stage._lean = true;
  stage.addEventListener('mousemove', (e) => {
    const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5;
    stage.style.setProperty('--lean-x', `${(-y * 5).toFixed(2)}deg`);
    stage.style.setProperty('--lean-y', `${(x * 6).toFixed(2)}deg`);
  });
  stage.addEventListener('mouseleave', () => {
    stage.style.setProperty('--lean-x', '0deg');
    stage.style.setProperty('--lean-y', '0deg');
  });
}

/** stacks for the dealer's chip rack: pure dressing */
export function rackHtml() {
  const colors = ['purple', 'black', 'black', 'green', 'green', 'red', 'red', 'red', 'white', 'white'];
  return colors.map((c) => `<span class="rack-col"><i class="chip ${c} side"></i></span>`).join('');
}

const DEALERS = ['MORTIMER', 'BONES MALONE', 'GRAVEDIGGER GUS', 'LOUIE THE LID', 'SLEEPY SAL', 'DEADEYE DELORES', 'DIGBY', 'THE LATE MR. FINCH'];
/** tonight's dealer (cosmetic; never touches the run's seed) */
export const dealerName = () => DEALERS[Math.floor(Math.random() * DEALERS.length)];
