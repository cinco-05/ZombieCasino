// nav.js — the floor plan the dead walk. A 1m grid over the whole building:
// walls, closed doors and furniture are solid, every cell knows which room it
// belongs to, and a room's cells only count once its doors are paid for.
// A few times a second a flow field is flooded out from the player; each
// zombie just walks downhill on it — around the bar, through the chapel door.

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

export class NavGrid {
  constructor(min = -64, size = 128) {
    this.min = min;
    this.N = size;
    const n = size * size;
    this.solid = new Uint8Array(n);          // walls + furniture (inflated)
    this.door = new Uint8Array(n);           // closed-door cells
    this.zone = new Int8Array(n).fill(-1);   // which room a cell belongs to
    this.zoneOpen = new Uint8Array(16);
    this.dist = new Float32Array(n).fill(Infinity);
    this.stamp = new Uint32Array(n);
    this.gen = 0;
    // binary heap (lazy deletion) for Dijkstra
    this._hk = new Float32Array(n * 4);
    this._hv = new Int32Array(n * 4);
    this._hn = 0;
    this.target = -1;
  }

  // ------------------------------- geometry ---------------------------------
  idx(x, z) {
    const i = Math.floor(x - this.min), j = Math.floor(z - this.min);
    if (i < 0 || j < 0 || i >= this.N || j >= this.N) return -1;
    return j * this.N + i;
  }
  cx(k) { return this.min + (k % this.N) + 0.5; }
  cz(k) { return this.min + Math.floor(k / this.N) + 0.5; }

  _rect(x0, z0, x1, z1, fn) {
    const i0 = Math.max(0, Math.floor(x0 - this.min)), i1 = Math.min(this.N - 1, Math.ceil(x1 - this.min) - 1);
    const j0 = Math.max(0, Math.floor(z0 - this.min)), j1 = Math.min(this.N - 1, Math.ceil(z1 - this.min) - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * this.N + i);
  }

  markZone(id, x0, z0, x1, z1) { this._rect(x0, z0, x1, z1, (k) => { this.zone[k] = id; }); }

  /** solid box, inflated so bodies keep off it */
  markBox(x0, z0, x1, z1, inflate = 0.45) {
    this._rect(x0 - inflate, z0 - inflate, x1 + inflate, z1 + inflate, (k) => { this.solid[k] = 1; });
  }

  markCircle(x, z, r, inflate = 0.45) {
    const R = r + inflate;
    this._rect(x - R, z - R, x + R, z + R, (k) => {
      if (Math.hypot(this.cx(k) - x, this.cz(k) - z) < R) this.solid[k] = 1;
    });
  }

  setDoor(x0, z0, x1, z1, closed) {
    this._rect(x0, z0, x1, z1, (k) => { this.door[k] = closed ? 1 : 0; });
  }

  walkable(k) {
    return k >= 0 && !this.solid[k] && !this.door[k] && this.zone[k] >= 0 && this.zoneOpen[this.zone[k]] === 1;
  }
  walkableAt(x, z) { return this.walkable(this.idx(x, z)); }
  zoneAt(x, z) { const k = this.idx(x, z); return k >= 0 ? this.zone[k] : -1; }

  // ------------------------------- flow field --------------------------------
  _push(key, v) {
    let i = this._hn++;
    const K = this._hk, Vv = this._hv;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= key) break;
      K[i] = K[p]; Vv[i] = Vv[p]; i = p;
    }
    K[i] = key; Vv[i] = v;
  }
  _pop() {
    const K = this._hk, Vv = this._hv;
    const top = Vv[0];
    this._pk = K[0];
    const n = --this._hn;
    const key = K[n], v = Vv[n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && K[c + 1] < K[c]) c++;
      if (K[c] >= key) break;
      K[i] = K[c]; Vv[i] = Vv[c]; i = c;
    }
    K[i] = key; Vv[i] = v;
    return top;
  }

  /** another flow field over the SAME grid (walls, doors, zones shared) — co-op's second target */
  fork() {
    const f = Object.create(NavGrid.prototype);
    Object.assign(f, this);
    const n = this.dist.length;
    f.dist = new Float32Array(n).fill(Infinity);
    f.stamp = new Uint32Array(n);
    f.gen = 0;
    f._hk = new Float32Array(n * 4);
    f._hv = new Int32Array(n * 4);
    f._hn = 0;
    f.target = -1;
    return f;
  }

  /** flood distances out from (x, z) over every walkable cell */
  build(x, z, maxDist = 140) {
    let t = this.idx(x, z);
    if (!this.walkable(t)) t = this._nearestWalkable(t);
    if (t < 0) return;
    this.target = t;
    this.gen++;
    const D = this.dist, S = this.stamp, g = this.gen, N = this.N;
    this._hn = 0;
    D[t] = 0; S[t] = g;
    this._push(0, t);
    while (this._hn > 0) {
      const k = this._pop();
      const d = D[k];
      if (this._pk > d) continue;             // stale heap entry
      if (d > maxDist) break;
      const ki = k % N, kj = (k - ki) / N;
      for (const [di, dj, c] of DIRS) {
        const ni = ki + di, nj = kj + dj;
        if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
        const nk = nj * N + ni;
        if (!this.walkable(nk)) continue;
        // no cutting corners past walls
        if (di && dj && (!this.walkable(kj * N + ni) || !this.walkable(nj * N + ki))) continue;
        const nd = d + c;
        if (S[nk] !== g || nd < D[nk]) {
          D[nk] = nd; S[nk] = g;
          if (this._hn < this._hk.length) this._push(nd, nk);
        }
      }
    }
  }

  distAt(x, z) {
    const k = this.idx(x, z);
    return k >= 0 && this.stamp[k] === this.gen ? this.dist[k] : Infinity;
  }

  _nearestWalkable(k) {
    if (k < 0) return -1;
    const N = this.N, ki = k % N, kj = (k - ki) / N;
    for (let r = 1; r < 6; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const ni = ki + di, nj = kj + dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          const nk = nj * N + ni;
          if (this.walkable(nk)) return nk;
        }
      }
    }
    return -1;
  }

  /**
   * which way is downhill from (x, z)? writes a unit XZ direction into out
   * and returns true, or false if this spot isn't on the field at all
   */
  flow(x, z, out) {
    const N = this.N, D = this.dist, S = this.stamp, g = this.gen;
    let k = this.idx(x, z);
    if (k < 0) return false;
    if (!this.walkable(k) || S[k] !== g) {
      // shoved into a wall or furniture: step back onto the nearest good cell
      const nk = this._nearestWalkable(k);
      if (nk < 0) return false;
      out.x = this.cx(nk) - x; out.z = this.cz(nk) - z;
      const l = Math.hypot(out.x, out.z) || 1;
      out.x /= l; out.z /= l;
      return true;
    }
    const ki = k % N, kj = (k - ki) / N;
    let best = -1, bd = D[k];
    for (const [di, dj] of DIRS) {
      const ni = ki + di, nj = kj + dj;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const nk = nj * N + ni;
      if (S[nk] !== g || !this.walkable(nk)) continue;
      if (di && dj && (!this.walkable(kj * N + ni) || !this.walkable(nj * N + ki))) continue;
      if (D[nk] < bd) { bd = D[nk]; best = nk; }
    }
    if (best < 0) return false;
    out.x = this.cx(best) - x; out.z = this.cz(best) - z;
    const l = Math.hypot(out.x, out.z) || 1;
    out.x /= l; out.z /= l;
    return true;
  }

  /** straight walkable line between two points? (sampled every half meter) */
  lineClear(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / 0.5));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (!this.walkableAt(ax + dx * t, az + dz * t)) return false;
    }
    return true;
  }
}
