// GPS: shortest road route from the player to a waypoint (A* over the road graph).
import { nodes, segsAt } from './terrain.js';

// nearest road node to a point, searching the local road grid outwards
export function nodeNear(x, z) {
  let best = null, bd = Infinity;
  for (let r = 0; r <= 640 && !best; r += 64)
    for (let ox = -r; ox <= r; ox += 64)
      for (let oz = -r; oz <= r; oz += 64) {
        if (r && Math.abs(ox) !== r && Math.abs(oz) !== r) continue;
        const l = segsAt(x + ox, z + oz);
        if (l) for (const s of l) for (const n of [s.a, s.b]) {
          const d = Math.hypot(n.x - x, n.z - z);
          if (d < bd) { bd = d; best = n; }
        }
      }
  return best;
}

// A* with a binary heap; returns an array of nodes or null
let G_ = null, F_ = null, CAME = null, SEEN = null, stamp = 0;
export function route(from, to) {
  if (!from || !to) return null;
  const N = nodes.length;
  if (!G_ || G_.length !== N) {
    G_ = new Float64Array(N); F_ = new Float64Array(N); CAME = new Int32Array(N); SEEN = new Uint32Array(N);
  }
  stamp++;
  const heap = [];
  const push = (id) => {
    heap.push(id);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (F_[heap[p]] <= F_[heap[i]]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && F_[heap[l]] < F_[heap[m]]) m = l;
        if (r < heap.length && F_[heap[r]] < F_[heap[m]]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const h = (n) => Math.hypot(n.x - to.x, n.z - to.z);
  SEEN[from.id] = stamp; G_[from.id] = 0; F_[from.id] = h(from); CAME[from.id] = -1;
  push(from.id);
  let it = 0;
  while (heap.length && it++ < 200000) {
    const id = pop();
    const cur = nodes[id];
    if (cur === to) {
      const path = [];
      for (let k = id; k !== -1; k = CAME[k]) path.push(nodes[k]);
      return path.reverse();
    }
    for (const e of cur.edges) {
      // main roads are a bit "cheaper" so the route prefers them, like a real GPS
      const cost = e.s.len * (e.s.kind === 'main' ? 0.8 : e.s.kind === 'rural' ? 1.0 : 1.1);
      const g = G_[id] + cost;
      const nid = e.n.id;
      if (SEEN[nid] !== stamp || g < G_[nid]) {
        SEEN[nid] = stamp;
        G_[nid] = g;
        F_[nid] = g + h(e.n) * 0.8;
        CAME[nid] = id;
        push(nid);
      }
    }
  }
  return null;
}

// distance from a point to a polyline of nodes (and the index of the closest segment)
export function distToPath(path, x, z) {
  let bd = Infinity, bi = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
    const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
    if (d < bd) { bd = d; bi = i; }
  }
  return { d: bd, i: bi };
}
