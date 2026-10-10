// World data: heightfield, road network, buildings, colliders and ground queries.
// The island is compiled offline from a reference map (tools/mapgen) into assets/map/world.json:
// heights, roads with height profiles and bridges, street-facing building lots, airports and places.
// No rendering here; world.js turns this data into meshes.
import { clamp, lerp, sstep, WATER } from './core.js';
import { noise2, mulberry32 } from './noise.js';

export let HALF = 6187.5; // map spans -HALF..HALF on x and z
export let TS = 15; // terrain grid spacing (m)
export let TN = 825; // terrain cells per side
export let H = new Float32Array(0);
export const ROAD_W = 10.5;
export const SIDEWALK = 3.2;
export const CURB = 0.15;

let W = null; // raw compiled world
const R = mulberry32(20240611);
const rr = (a, b) => a + R() * (b - a);

// ---------------------------------------------------------------- loading
export async function loadWorldData(url = 'assets/map/world.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error('world data missing: ' + res.status);
  W = await res.json();
  HALF = W.HALF;
  TS = W.S;
  TN = W.N - 1;
  const hq = new Uint16Array(b64bytes(W.heights).buffer);
  H = new Float32Array(hq.length);
  for (let i = 0; i < hq.length; i++) H[i] = hq[i] / 20 - 50;
  BIOME = b64bytes(W.biome);
  URBAN = b64bytes(W.urban);
  BN = W.biomeN;
}
function b64bytes(s) {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

// ---------------------------------------------------------------- terrain
export function terrainHeight(x, z) {
  const fx = (x + HALF) / TS, fz = (z + HALF) / TS;
  if (fx < 0 || fz < 0 || fx >= TN || fz >= TN) return -30;
  const i = Math.floor(fx), j = Math.floor(fz);
  const tx = fx - i, tz = fz - j;
  const o = j * (TN + 1) + i;
  const a = H[o], b = H[o + 1], c = H[o + TN + 1], d = H[o + TN + 2];
  if (tx + tz < 1) return a + (b - a) * tx + (c - a) * tz;
  return d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
}

// biome grid (30 m): 0 grass, 1 forest, 2 desert, 3 alpine rock, 4 wetland, 5 beach, 6 urban
let BIOME = new Uint8Array(0), URBAN = new Uint8Array(0), BN = 1;
export const BIOMES = { GRASS: 0, FOREST: 1, DESERT: 2, ALPINE: 3, WETLAND: 4, BEACH: 5, URBAN: 6 };
function gridIdx(x, z) {
  const f = (BN - 1) / (2 * HALF);
  const i = clamp(Math.round((x + HALF) * f), 0, BN - 1), j = clamp(Math.round((z + HALF) * f), 0, BN - 1);
  return j * BN + i;
}
export function biomeAt(x, z) {
  return BIOME[gridIdx(x, z)] || 0;
}
// smooth 0..1 urban density
export function urbanAt(x, z) {
  const f = (BN - 1) / (2 * HALF);
  const fx = clamp((x + HALF) * f, 0, BN - 1.001), fz = clamp((z + HALF) * f, 0, BN - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const o = j * BN + i;
  return (lerp(lerp(URBAN[o], URBAN[o + 1], tx), lerp(URBAN[o + BN], URBAN[o + BN + 1], tx), tz)) / 255;
}
export function waterLevel() {
  return WATER;
}

// ---------------------------------------------------------------- roads
// nodes/segs form the driving graph: polylines are split into short straight segments,
// junction nodes are shared between roads.
export const nodes = [];
export const segs = [];
export const roads = []; // {nodes:[...], segs:[...], w, kind}
export const junctions = []; // nodes where 3+ roads meet
function addNode(x, z, h) {
  const n = { id: nodes.length, x, z, h, edges: [] };
  nodes.push(n);
  return n;
}
function link(a, b, w, kind, road, bridge) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.3) return null;
  const s = { id: segs.length, a, b, w, kind, road, len, dx: dx / len, dz: dz / len, bridge, sidewalk: false };
  segs.push(s);
  a.edges.push({ n: b, s });
  b.edges.push({ n: a, s });
  return s;
}
const KIND = { main: 'main', street: 'city', rural: 'rural' };

function buildRoads() {
  const J = W.nodes.map(([x, z, h]) => addNode(x, z, h));
  for (const r of W.roads) {
    const p = r.p;
    const n = p.length / 3;
    const list = [J[r.a]];
    for (let k = 1; k < n - 1; k++) list.push(addNode(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]));
    list.push(J[r.b]);
    const kind = KIND[r.c] || 'rural';
    const road = { nodes: list, segs: [], w: r.w, kind, bridge: r.br };
    for (let k = 0; k < list.length - 1; k++) {
      const s = link(list[k], list[k + 1], r.w, kind, road, !!(r.br[k] || r.br[k + 1]));
      if (s) road.segs.push(s);
    }
    roads.push(road);
  }
  for (const n of J) if (n.edges.length >= 3) junctions.push(n);
  // pavements along town streets
  for (const s of segs) {
    if (s.kind === 'rural' || s.bridge) continue;
    const mx = (s.a.x + s.b.x) / 2, mz = (s.a.z + s.b.z) / 2;
    s.sidewalk = urbanAt(mx, mz) > 0.12;
  }
}

const SG = 64;
const segGrid = new Map();
const gk = (i, j) => (i + 500) * 2000 + (j + 500);
function regSegs() {
  for (const s of segs) {
    const m = s.w / 2 + SIDEWALK + 2;
    const x0 = Math.floor((Math.min(s.a.x, s.b.x) - m) / SG), x1 = Math.floor((Math.max(s.a.x, s.b.x) + m) / SG);
    const z0 = Math.floor((Math.min(s.a.z, s.b.z) - m) / SG), z1 = Math.floor((Math.max(s.a.z, s.b.z) + m) / SG);
    for (let i = x0; i <= x1; i++)
      for (let j = z0; j <= z1; j++) {
        const k = gk(i, j);
        let l = segGrid.get(k);
        if (!l) segGrid.set(k, (l = []));
        l.push(s);
      }
  }
}
export function segsAt(x, z) {
  return segGrid.get(gk(Math.floor(x / SG), Math.floor(z / SG)));
}
// projection result scratch
export const RP = { d: 0, h: 0, t: 0, s: null, side: 0 };
function proj(s, x, z) {
  const px = x - s.a.x, pz = z - s.a.z;
  let t = px * s.dx + pz * s.dz;
  t = clamp(t, 0, s.len);
  const cx = s.a.x + s.dx * t, cz = s.a.z + s.dz * t;
  RP.d = Math.hypot(x - cx, z - cz);
  RP.h = lerp(s.a.h, s.b.h, t / s.len);
  RP.t = t;
  RP.side = px * -s.dz + pz * s.dx;
  return RP;
}
// nearest road (within the grid cell): {d (from road edge), h, s} or null
const NR = { d: 0, h: 0, s: null, side: 0 };
export function nearestRoad(x, z) {
  const l = segsAt(x, z);
  if (!l) return null;
  let bd = Infinity, bh = 0, bs = null, side = 0;
  for (const s of l) {
    proj(s, x, z);
    const d = RP.d - s.w / 2;
    if (d < bd) { bd = d; bh = RP.h; bs = s; side = RP.side; }
  }
  if (!bs) return null;
  NR.d = bd; NR.h = bh; NR.s = bs; NR.side = side;
  return NR;
}
// road (or pavement) surface height at (x,z), ignoring surfaces above maxY; null if none.
// A carriageway beats a pavement on the same level: at junctions and on dense streets a neighbouring
// segment's pavement band (road + CURB) overlaps this segment's carriageway, and taking
// the plain max painted kerbs across the road — a 0.15–0.4 m sawtooth every few metres.
export function roadAt(x, z, maxY = Infinity) {
  const l = segsAt(x, z);
  if (!l) return null;
  let h = null, hp = null;
  for (const s of l) {
    proj(s, x, z);
    if (RP.d < s.w / 2 + 0.3) {
      if (RP.h <= maxY && (h === null || RP.h > h)) h = RP.h;
    } else if (s.sidewalk && RP.d < s.w / 2 + SIDEWALK) {
      const y = RP.h + CURB;
      if (y <= maxY && (hp === null || y > hp)) hp = y;
    }
  }
  // a pavement well above the carriageway is a different level (bridge over a road)
  if (h === null || (hp !== null && hp > h + 1)) return hp;
  return h;
}
export function onPavement(x, z) {
  const l = segsAt(x, z);
  if (!l) return false;
  for (const s of l) {
    if (!s.sidewalk) continue;
    proj(s, x, z);
    if (RP.d > s.w / 2 && RP.d < s.w / 2 + SIDEWALK) return true;
  }
  return false;
}

// ---------------------------------------------------------------- objects & colliders
export const buildings = []; // oriented boxes {t:0,cx,cz,hx,hz,rot,c,s,x0..z1,y0,y1,color,roof,kind}
export const trees = []; // {x,y,z,s,type}
export const lamps = []; // {x,y,z,dir}
export const ramps = []; // {x,z,rot,w,len,h,base}
export const decor = []; // misc static boxes {x,y,z,sx,sy,sz,rot,color}
export const signs = []; // {text,x,y,z,rot,w,h,bg,fg}
export const props = []; // instanced street furniture {file,x,y,z,rot,h}
export const SPECIAL = {};
export let AIRPORTS = [];
export let AIRPORT = null; // the main airport
export let GANGS = [];
export let DISTRICTS = [];
export let REGIONS = [];
// KayKit City Builder buildings (no base): footprint width (x), depth (z), height, in model units
export const KK = {
  A: [1.2, 1.45, 1.55], B: [1.6, 1.3, 1.55], C: [1.2, 1.3, 2.25], D: [1.6, 1.3, 2.25],
  E: [2.0, 1.45, 2.25], F: [2.0, 1.3, 2.25], G: [2.0, 1.45, 2.25], H: [2.0, 1.3, 2.95],
};
const BG = 40;
const bGrid = new Map();
function regCollider(o, x0, x1, z0, z1) {
  const m = 6;
  const i0 = Math.floor((x0 - m) / BG), i1 = Math.floor((x1 + m) / BG);
  const j0 = Math.floor((z0 - m) / BG), j1 = Math.floor((z1 + m) / BG);
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      const k = gk(i, j);
      let l = bGrid.get(k);
      if (!l) bGrid.set(k, (l = []));
      l.push(o);
    }
}
function unregCollider(o) {
  const m = 6;
  const i0 = Math.floor((o.x0 - m) / BG), i1 = Math.floor((o.x1 + m) / BG);
  const j0 = Math.floor((o.z0 - m) / BG), j1 = Math.floor((o.z1 + m) / BG);
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      const l = bGrid.get(gk(i, j));
      const k = l ? l.indexOf(o) : -1;
      if (k >= 0) l.splice(k, 1);
    }
}
// Oriented box building. (cx,cz) centre, half sizes hx/hz along its own axes, rot = Y rotation.
export function addBox(cx, cz, hx, hz, rot, h, color, kind = 'tower', roof = null, y0) {
  const c = Math.cos(rot), sn = Math.sin(rot);
  const ex = Math.abs(c) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(c) * hz;
  if (y0 === undefined) {
    const g = [terrainHeight(cx - ex, cz - ez), terrainHeight(cx + ex, cz - ez), terrainHeight(cx - ex, cz + ez), terrainHeight(cx + ex, cz + ez), terrainHeight(cx, cz)];
    y0 = Math.min(...g) - 0.4;
    h += Math.max(...g) - Math.min(...g) + 0.4;
  }
  const b = { t: 0, cx, cz, hx, hz, rot, c, s: sn, x0: cx - ex, x1: cx + ex, z0: cz - ez, z1: cz + ez, y0, y1: y0 + h, color, roof, kind };
  buildings.push(b);
  regCollider(b, b.x0, b.x1, b.z0, b.z1);
  return b;
}
export function addBuilding(x0, x1, z0, z1, h, color, kind = 'tower', roof = null, y0) {
  return addBox((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, 0, h, color, kind, roof, y0);
}
function removeBuilding(b) {
  const i = buildings.indexOf(b);
  if (i >= 0) buildings.splice(i, 1);
  unregCollider(b);
}
// point inside an oriented box (xz only)
function inBox(o, x, z) {
  const dx = x - o.cx, dz = z - o.cz;
  return Math.abs(dx * o.c - dz * o.s) < o.hx && Math.abs(dx * o.s + dz * o.c) < o.hz;
}
function boxesOverlap(a, cx, cz, hx, hz, rot) {
  // conservative: test the other box's corners and centre against a, and a's corners against it
  const c = Math.cos(rot), s = Math.sin(rot);
  const o = { cx, cz, hx, hz, c, s };
  const pts = (b) => [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]].map(([u, v]) => [b.cx + u * b.hx * b.c + v * b.hz * b.s, b.cz - u * b.hx * b.s + v * b.hz * b.c]);
  return pts(o).some(([x, z]) => inBox(a, x, z)) || pts(a).some(([x, z]) => inBox(o, x, z));
}
export function buildingsNear(x, z) {
  return bGrid.get(gk(Math.floor(x / BG), Math.floor(z / BG)));
}
function clearArea(cx, cz, hx, hz, rot) {
  const r = Math.hypot(hx, hz) + 2;
  const seen = new Set();
  for (let x = cx - r; x <= cx + r + BG; x += BG)
    for (let z = cz - r; z <= cz + r + BG; z += BG) {
      const l = bGrid.get(gk(Math.floor(x / BG), Math.floor(z / BG)));
      if (l) for (const o of l) seen.add(o);
    }
  for (const o of seen) {
    if (o.t === 0 && boxesOverlap(o, cx, cz, hx + 1.5, hz + 1.5, rot)) removeBuilding(o);
  }
}

function addTree(x, z, type, s) {
  const y = groundHeight(x, z);
  trees.push({ x, y, z, s, type });
  if (type !== 'bush') {
    const c = { t: 1, x, z, r: type === 'rock' ? 1.2 * s : 0.45 * s, y0: y - 1, y1: y + (type === 'rock' ? 1.5 * s : 6 * s) };
    regCollider(c, x - 2, x + 2, z - 2, z + 2);
  }
}

const PALETTE = {
  down: [0x8fa3b8, 0x6f8499, 0xb8c4cc, 0x5d7085, 0xc9c2b0, 0x9aa7a0, 0x7b8fa6, 0xa9b5bf],
  mid: [0xe8c872, 0xdcd3c0, 0xc96f4a, 0xb0c4d8, 0xece6d6, 0xd9a066, 0xa4593c, 0xd8cfa8, 0x9fb3a0],
  res: [0xf2e6c9, 0xe9c7a5, 0xcfe0e8, 0xe7d9b0, 0xf0d0c0, 0xd7e3c8, 0xffffff, 0xd9b38c],
  desert: [0xd9a873, 0xe0b98a, 0xc99467, 0xe8cfa6],
};
const ROOFS = [0x8b3a2b, 0x5a5a5a, 0x3e4d5c, 0x7a4b2a, 0x2f4f3a];
const KK_KEYS = Object.keys(KK);

// ---------------------------------------------------------------- buildings from the compiled lots
function genBuildings() {
  for (const [cx, cz, hx, hz, rot, h, style] of W.buildings) {
    if (style === 0) {
      addBox(cx, cz, hx, hz, rot, h, PALETTE.down[Math.floor(R() * PALETTE.down.length)], 'tower');
    } else if (style === 1) {
      // a KayKit building whose proportions fit the lot, pushed to the street front
      let best = null;
      for (const k of KK_KEYS) {
        const [kw, kd, kh] = KK[k];
        const sc = Math.min((hx * 2) / kw, (hz * 2) / kd);
        const fill = (kw * sc * kd * sc) / (4 * hx * hz);
        const score = fill + (h > 16 ? kh / 3 : (3 - kh) / 3) * 0.25 + R() * 0.15;
        if (!best || score > best.score) best = { k, sc, score };
      }
      const [kw, kd, kh] = KK[best.k];
      const sc = best.sc;
      const push = hz - (kd * sc) / 2;
      const fx = Math.sin(rot), fz = Math.cos(rot);
      const b = addBox(cx + fx * push, cz + fz * push, (kw * sc) / 2, (kd * sc) / 2, rot, kh * sc, 0x9a8f80, 'kk');
      b.kk = best.k;
      b.scale = sc;
    } else {
      const des = biomeAt(cx, cz) === BIOMES.DESERT;
      const pal = des ? PALETTE.desert : PALETTE.res;
      addBox(cx, cz, hx, hz, rot, h, pal[Math.floor(R() * pal.length)], 'house', des ? null : ROOFS[Math.floor(R() * ROOFS.length)]);
    }
  }
}

// ---------------------------------------------------------------- street furniture
function genStreets() {
  for (const road of roads) {
    if (road.kind === 'rural') continue;
    let acc = rr(0, 30);
    road.segs.forEach((s, k) => {
      if (!s.sidewalk) return;
      // lamps alternate sides every ~36 m, arms reaching over the road
      acc += s.len;
      if (acc > 36) {
        acc = 0;
        const side = k % 2 ? 1 : -1;
        const off = s.w / 2 + SIDEWALK - 0.6;
        const x = s.a.x + s.dx * s.len * 0.5 - s.dz * off * side, z = s.a.z + s.dz * s.len * 0.5 + s.dx * off * side;
        const y = (s.a.h + s.b.h) / 2 + CURB;
        lamps.push({ x, y, z, dir: Math.atan2(s.dz * side, -s.dx * side) });
      }
      if (R() < 0.05) {
        const side = R() < 0.5 ? 1 : -1, off = s.w / 2 + SIDEWALK - 0.8;
        const x = s.a.x + s.dx * s.len * 0.3 - s.dz * off * side, z = s.a.z + s.dz * s.len * 0.3 + s.dx * off * side;
        const file = R() < 0.4 ? 'kk_firehydrant' : R() < 0.6 ? 'kk_bench' : 'kk_trash_A';
        props.push({ file, x, y: (s.a.h + s.b.h) / 2 + CURB, z, rot: Math.atan2(-s.dz * side, s.dx * side) + Math.PI / 2, h: 0.9, col: file === 'kk_firehydrant' ? 0.3 : 0 });
      }
    });
  }
  // traffic lights on two corners of busy town junctions
  for (const n of junctions) {
    const city = n.edges.filter((e) => e.s.kind !== 'rural');
    if (city.length < 3) continue;
    for (let k = 0; k < 2; k++) {
      const e = city[k];
      const w = e.s.w / 2 + SIDEWALK - 0.7;
      const dx = (e.n.x - n.x) / e.s.len, dz = (e.n.z - n.z) / e.s.len;
      const x = n.x + dx * (w + 1) - dz * w, z = n.z + dz * (w + 1) + dx * w;
      props.push({ file: 'kk_trafficlight_A', x, y: n.h + CURB, z, rot: Math.atan2(-dx, -dz), h: 5.2, col: 0.25 });
    }
  }
  for (const l of lamps) regCollider({ t: 1, x: l.x, z: l.z, r: 0.25, y0: l.y - 1, y1: l.y + 7 }, l.x - 1, l.x + 1, l.z - 1, l.z + 1);
  for (const p of props) if (p.col) regCollider({ t: 1, x: p.x, z: p.z, r: p.col, y0: p.y - 1, y1: p.y + p.h }, p.x - 1, p.x + 1, p.z - 1, p.z + 1);
}

// ---------------------------------------------------------------- landmarks
function streetLot(sp) {
  // a lot beside the street point sp: returns the frame (forward = towards the street)
  const nx = -sp.tz, nz = sp.tx; // left of the street direction
  return { x: sp.x, z: sp.z, nx, nz, tx: sp.tx, tz: sp.tz, w: sp.w, h: sp.h };
}
function landmark(sp, w, d, h, color, kind, side = 1) {
  const L = streetLot(sp);
  const off = L.w / 2 + SIDEWALK + 1.5 + d / 2;
  const cx = L.x + L.nx * off * side, cz = L.z + L.nz * off * side;
  const rot = Math.atan2(-L.nx * side, -L.nz * side); // front faces the street
  clearArea(cx, cz, w / 2, d / 2, rot);
  const b = addBox(cx, cz, w / 2, d / 2, rot, h, color, kind);
  return { b, L, cx, cz, rot, fx: -L.nx * side, fz: -L.nz * side };
}
function genLandmarks() {
  const S = W.specials;
  // police station
  {
    const m = landmark(S.police, 50, 34, 14, 0x3b5578, 'police');
    const fx = m.fx, fz = m.fz;
    const front = { x: m.cx + fx * 22, z: m.cz + fz * 22 };
    SPECIAL.police = { x: front.x, z: front.z, spawnX: m.L.x, spawnZ: m.L.z, h: Math.atan2(m.L.tx, m.L.tz), bx: m.cx, bz: m.cz };
    signs.push({ text: 'POLICE', x: m.cx + fx * 17.1, y: m.b.y0 + 10, z: m.cz + fz * 17.1, rot: m.rot, w: 20, h: 4, bg: '#12305e', fg: '#ffffff' });
  }
  // hospital with a rooftop helipad
  {
    const m = landmark(S.hospital, 64, 44, 30, 0xf2f2f2, 'hospital');
    const sp = { x: m.cx + m.fx * 27, z: m.cz + m.fz * 27 };
    SPECIAL.hospital = { x: sp.x, z: sp.z, spawnX: sp.x, spawnZ: sp.z, roofX: m.cx, roofZ: m.cz, roofY: m.b.y1 };
    signs.push({ text: '+ HOSPITAL', x: m.cx + m.fx * 22.1, y: m.b.y0 + 22, z: m.cz + m.fz * 22.1, rot: m.rot, w: 26, h: 5, bg: '#ffffff', fg: '#d32f2f' });
  }
  // Pay 'n' Spray: an open bay beside a garage
  {
    const L = streetLot(S.spray);
    const off = L.w / 2 + SIDEWALK + 18;
    const cx = L.x + L.nx * off, cz = L.z + L.nz * off;
    const rot = Math.atan2(-L.nx, -L.nz);
    clearArea(cx, cz, 30, 18, rot);
    const gx = cx + L.tx * 20, gz = cz + L.tz * 20;
    addBox(gx, gz, 10, 16, rot, 9, 0x44515e, 'mid');
    SPECIAL.spray = { x: cx - L.tx * 6, z: cz - L.tz * 6, rot, hx: 9, hz: 12, y: terrainHeight(cx, cz) };
    signs.push({ text: "PAY 'N' SPRAY", x: gx - L.nx * 16.2, y: SPECIAL.spray.y + 6.5, z: gz - L.nz * 16.2, rot, w: 18, h: 3, bg: '#ffb300', fg: '#1a1a1a' });
  }
  SPECIAL.start = W.specials.start;
  SPECIAL.airport = { x: AIRPORT.x, z: AIRPORT.z };
}

// ---------------------------------------------------------------- airports
function genAirports() {
  AIRPORTS = W.airports.map((a) => ({ ...a }));
  AIRPORT = AIRPORTS.find((a) => a.key === 'east') || AIRPORTS[0];
  for (const ap of AIRPORTS) {
    const r = ap.runways[0];
    const L = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
    const dx = (r.x1 - r.x0) / L, dz = (r.z1 - r.z0) / L;
    // apron and terminal on the side of the runway away from the sea
    let side = 1;
    const tx = (r.x0 + r.x1) / 2, tz = (r.z0 + r.z1) / 2;
    if (terrainHeight(tx - dz * 160, tz + dx * 160) < terrainHeight(tx + dz * 160, tz - dx * 160)) side = -1;
    // keep clear of other runways
    for (const r2 of ap.runways.slice(1)) {
      const mx = (r2.x0 + r2.x1) / 2 - tx, mz = (r2.z0 + r2.z1) / 2 - tz;
      if ((-dz * mx + dx * mz) * side > 0) side = -side;
    }
    const nx = -dz * side, nz = dx * side;
    ap.dir = { x: dx, z: dz };
    ap.apron = { x: tx + nx * 95, z: tz + nz * 95, nx, nz, len: Math.min(L * 0.7, 600) };
    const rot = Math.atan2(nx, nz);
    const big = ap === AIRPORT;
    const tb = { x: tx + nx * 160, z: tz + nz * 160 };
    clearArea(tb.x, tb.z, big ? 170 : 60, 30, rot);
    addBox(tb.x, tb.z, big ? 140 : 35, big ? 22 : 12, rot, big ? 18 : 8, 0xd7dde3, 'mid', null, ap.h - 0.2);
    if (big) addBox(tb.x + dx * 170, tb.z + dz * 170, 8, 8, rot, 42, 0xc0c8d0, 'tower', null, ap.h - 0.2);
    for (let k = 0; k < (big ? 3 : 1); k++) {
      const hx = tb.x - dx * (220 + k * 85), hz = tb.z - dz * (220 + k * 85);
      clearArea(hx, hz, 40, 40, rot);
      addBox(hx, hz, 38, 30, rot, 17, 0x8e9aa6, 'hangar', null, ap.h - 0.2);
    }
    signs.push({ text: ap.name.toUpperCase(), x: tb.x - nx * ((big ? 22 : 12) + 0.15), y: ap.h + (big ? 15 : 6.5), z: tb.z - nz * ((big ? 22 : 12) + 0.15), rot: rot + Math.PI, w: big ? 50 : 26, h: big ? 4 : 2.5, bg: '#1d2b3a', fg: '#ffffff' });
    ap.helipads = [0, 1].map((k) => ({ x: ap.apron.x + dx * (ap.apron.len / 2 - 25 - k * 35), z: ap.apron.z + dz * (ap.apron.len / 2 - 25 - k * 35) }));
    ap.threshold = { x: r.x0 + dx * 40, z: r.z0 + dz * 40, heading: Math.atan2(dx, dz) };
  }
}
function airportHeight(x, z) {
  for (const ap of AIRPORTS) {
    if (Math.abs(x - ap.x) > 1200 || Math.abs(z - ap.z) > 1200) continue;
    for (const r of ap.runways) {
      const L = Math.hypot(r.x1 - r.x0, r.z1 - r.z0), dx = (r.x1 - r.x0) / L, dz = (r.z1 - r.z0) / L;
      const px = x - r.x0, pz = z - r.z0;
      const a = px * dx + pz * dz, s = -px * dz + pz * dx;
      if (a > -5 && a < L + 5 && Math.abs(s) < r.w / 2) return ap.h;
    }
    if (ap.apron) {
      const px = x - ap.apron.x, pz = z - ap.apron.z;
      const a = px * ap.dir.x + pz * ap.dir.z, s = px * ap.apron.nx + pz * ap.apron.nz;
      if (Math.abs(a) < ap.apron.len / 2 && Math.abs(s) < 45) return ap.h;
      // taxiway to the runway
      if (Math.abs(a) < 15 && s < 0 && s > -95) return ap.h;
    }
  }
  return null;
}
export function inAirfield(x, z, pad = 0) {
  for (const ap of AIRPORTS) {
    for (const r of ap.runways) {
      const L = Math.hypot(r.x1 - r.x0, r.z1 - r.z0), dx = (r.x1 - r.x0) / L, dz = (r.z1 - r.z0) / L;
      const px = x - r.x0, pz = z - r.z0;
      const a = px * dx + pz * dz, s = -px * dz + pz * dx;
      if (a > -60 - pad && a < L + 60 + pad && Math.abs(s) < 200 + pad) return ap;
    }
  }
  return null;
}

// ---------------------------------------------------------------- nature
function okForProp(x, z, clear = 8) {
  const r = nearestRoad(x, z);
  if (r && r.d < clear) return false;
  const l = bGrid.get(gk(Math.floor(x / BG), Math.floor(z / BG)));
  if (l) for (const o of l) if (o.t === 0 && x > o.x0 - 3 && x < o.x1 + 3 && z > o.z0 - 3 && z < o.z1 + 3) return false;
  return true;
}
function genNature() {
  const step = 24;
  for (let x = -HALF + 20; x < HALF - 20; x += step)
    for (let z = -HALF + 20; z < HALF - 20; z += step) {
      const jx = x + rr(-10, 10), jz = z + rr(-10, 10);
      const h = terrainHeight(jx, jz);
      if (h < 1.6) continue;
      const b = biomeAt(jx, jz);
      const u = urbanAt(jx, jz);
      let p;
      if (b === BIOMES.URBAN) p = 0.05;
      else if (b === BIOMES.FOREST) p = 0.85;
      else if (b === BIOMES.ALPINE) p = h > 430 ? 0.04 : 0.3;
      else if (b === BIOMES.DESERT) p = 0.25;
      else if (b === BIOMES.WETLAND) p = 0.35;
      else if (b === BIOMES.BEACH) p = 0.3;
      else p = 0.3 + 0.25 * noise2(jx * 0.004, jz * 0.004);
      p *= 1 - u * 0.8;
      if (R() > p) continue;
      if (inAirfield(jx, jz)) continue;
      if (!okForProp(jx, jz, 5)) continue;
      const sl = Math.abs(terrainHeight(jx + 4, jz) - h) + Math.abs(terrainHeight(jx, jz + 4) - h);
      if (b === BIOMES.DESERT) { addTree(jx, jz, R() < 0.55 ? 'cactus' : R() < 0.5 ? 'rock' : 'bush', rr(0.7, 1.4)); continue; }
      if (b === BIOMES.ALPINE || sl > 7) { addTree(jx, jz, R() < 0.5 && h < 400 ? 'pine' : 'rock', rr(0.9, 2.2)); continue; }
      if (b === BIOMES.BEACH) { addTree(jx, jz, 'palm', rr(0.8, 1.3)); continue; }
      if (b === BIOMES.FOREST || h > 160) { addTree(jx, jz, R() < (h > 120 ? 0.85 : 0.5) ? 'pine' : 'round', rr(0.9, 1.7)); continue; }
      if (b === BIOMES.WETLAND) { addTree(jx, jz, R() < 0.6 ? 'bush' : 'round', rr(0.8, 1.3)); continue; }
      addTree(jx, jz, R() < 0.75 ? 'round' : R() < 0.5 ? 'pine' : 'bush', rr(0.8, 1.4));
    }
  // street trees in town: along pavements, between lamps
  for (const s of segs) {
    if (!s.sidewalk || s.kind === 'main' || R() > 0.22) continue;
    const side = R() < 0.5 ? 1 : -1, off = s.w / 2 + SIDEWALK - 1.1;
    const t = rr(0.2, 0.8);
    const x = s.a.x + s.dx * s.len * t - s.dz * off * side, z = s.a.z + s.dz * s.len * t + s.dx * off * side;
    if (okForProp(x, z, s.w / 2 + SIDEWALK - 1.6)) addTree(x, z, 'round', rr(0.8, 1.0));
  }
}

// ---------------------------------------------------------------- places
export function gangAt(x, z) {
  for (const g of GANGS) if (Math.hypot(x - g.x, z - g.z) < g.r) return g;
  return null;
}
export function inSpray(x, z) {
  const s = SPECIAL.spray;
  if (!s) return false;
  const dx = x - s.x, dz = z - s.z, c = Math.cos(s.rot), sn = Math.sin(s.rot);
  return Math.abs(dx * c - dz * sn) < s.hx && Math.abs(dx * sn + dz * c) < s.hz;
}
// nearest pavement/street spot to a reference-map pixel or world point: {x,z,h,s}
export function streetSpot(x, z, wantPavement = true) {
  let best = null, bd = Infinity;
  for (const s of segs) {
    if (wantPavement && !s.sidewalk) continue;
    if (Math.abs(s.a.x - x) > 600 || Math.abs(s.a.z - z) > 600) continue;
    proj(s, x, z);
    if (RP.d < bd) { bd = RP.d; best = { s, t: RP.t }; }
  }
  if (!best) return { x, z, h: terrainHeight(x, z), s: null };
  const { s, t } = best;
  const off = wantPavement ? s.w / 2 + SIDEWALK / 2 : 0;
  const px = s.a.x + s.dx * t, pz = s.a.z + s.dz * t;
  return { x: px - s.dz * off, z: pz + s.dx * off, h: lerp(s.a.h, s.b.h, t / s.len) + (wantPavement ? CURB : 0), s, heading: Math.atan2(s.dx, s.dz) };
}
export function px2w(px, py) {
  return { x: px * TS - HALF, z: py * TS - HALF };
}
export function isWater(x, z) {
  return terrainHeight(x, z) < WATER - 0.5 && roadAt(x, z, WATER + 0.5) === null && airportHeight(x, z) === null;
}
// nearest open water at least `depth` deep, searching outwards from (x,z)
export function waterSpot(x, z, depth = 2.5) {
  for (let r = 0; r < 2000; r += 15)
    for (let a = 0; a < Math.PI * 2; a += Math.max(0.05, 12 / (r + 1))) {
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (terrainHeight(px, pz) < -depth && !roadAt(px, pz)) return { x: px, z: pz };
    }
  return null;
}

// ---------------------------------------------------------------- queries
// Fit road heights to the airfields. tools/mapgen/compile.py flattens the terrain
// around each runway AFTER it has sampled the road profiles, so roads near airports
// were left up to ~4 m under the plateau (and under the apron slab). With road-first
// groundHeight() a car there drove in a trench beneath the apron, and the moment its
// struts got within 1.6 m of the slab the ground snapped up onto it — a 20 m/s launch.
// Apply the compiler's own flatten blend to the road nodes so they follow the plateau
// exactly like the terrain does. Bridge nodes keep their deck height.
function fitRoadsToAirports() {
  const onBridge = new Set();
  for (const s of segs) if (s.bridge) { onBridge.add(s.a); onBridge.add(s.b); }
  for (const ap of W.airports) {
    for (const r of ap.runways) {
      const L = Math.hypot(r.x1 - r.x0, r.z1 - r.z0), dx = (r.x1 - r.x0) / L, dz = (r.z1 - r.z0) / L;
      for (const n of nodes) {
        if (onBridge.has(n)) continue;
        const px = n.x - r.x0, pz = n.z - r.z0;
        const along = px * dx + pz * dz, side = -px * dz + pz * dx;
        const da = Math.max(-along, along - L, 0), ds = Math.max(Math.abs(side) - 120, 0);
        let w = clamp(1 - (Math.hypot(da, ds) - 30) / 160, 0, 1);
        if (w <= 0) continue;
        w = w * w * (3 - 2 * w);
        n.h = n.h * (1 - w) + ap.h * w;
      }
    }
  }
}

// Pull the terrain down around roads. The compiled heightfield blends the 15 m
// grid with the roads' own height profile imperfectly: in ~1.7 % of road-surface
// samples the terrain pokes up through the road (up to ~5 m — the "bumpy /
// jumping car" bug), and with road-first groundHeight() those spots also became
// vertical cliffs at the verge. Terrain nodes within w/2 + SHOULDER of a road are
// held just under the road surface; beyond that the natural height blends back
// in over ~2 grid cells, so cuttings and embankments keep a graded shoulder.
// Nodes claimed by several roads (junctions, parallel streets) follow the
// NEAREST one — taking the lowest would dig trenches beside higher roads.
// Only ever lowers the terrain. Runs once, at load time.
const SHOULDER = 4; // graded shoulder beyond the road edge (m)
function carveRoadShoulders() {
  const floor = 0.3; // terrain kept this far below the road surface
  const band = TS * 2; // blend width back to natural terrain
  const reach = SHOULDER + band;
  const claim = new Map(); // node index -> { edge, roadH, surfH } of its nearest road
  // surfH: lowest road whose SURFACE covers the node (edge <= 0.4) — the node must
  // never sit above any road rendered there, even if a nearer road claims it.
  for (const s of segs) {
    const r1 = s.w / 2 + reach;
    const i0 = clamp(Math.floor((Math.min(s.a.x, s.b.x) - r1 + HALF) / TS), 0, TN);
    const i1 = clamp(Math.ceil((Math.max(s.a.x, s.b.x) + r1 + HALF) / TS), 0, TN);
    const j0 = clamp(Math.floor((Math.min(s.a.z, s.b.z) - r1 + HALF) / TS), 0, TN);
    const j1 = clamp(Math.ceil((Math.max(s.a.z, s.b.z) + r1 + HALF) / TS), 0, TN);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const px = -HALF + i * TS - s.a.x, pz = -HALF + j * TS - s.a.z;
        let t = px * s.dx + pz * s.dz;
        t = clamp(t, 0, s.len);
        const edge = Math.hypot(px - s.dx * t, pz - s.dz * t) - s.w / 2;
        if (edge > reach) continue;
        const roadH = s.a.h + (s.b.h - s.a.h) * (t / s.len);
        const o = j * (TN + 1) + i;
        const c = claim.get(o);
        if (!c) claim.set(o, { edge, roadH, surfH: edge <= 0.4 ? roadH : undefined });
        else {
          if (edge < c.edge) { c.edge = edge; c.roadH = roadH; }
          if (edge <= 0.4 && (c.surfH === undefined || roadH < c.surfH)) c.surfH = roadH;
        }
      }
  }
  for (const [o, c] of claim) {
    const k = c.edge <= SHOULDER ? 0 : sstep(0, band, c.edge - SHOULDER);
    let allowed = c.roadH - floor + (H[o] - (c.roadH - floor)) * k;
    if (c.surfH !== undefined && c.surfH - floor < allowed) allowed = c.surfH - floor;
    if (allowed < H[o]) H[o] = allowed;
  }
}

function rampHeight(x, z) {
  let h = null;
  for (const r of ramps) {
    const dx = x - r.x, dz = z - r.z;
    if (dx * dx + dz * dz > (r.len + 4) * (r.len + 4)) continue;
    const s = Math.sin(r.rot), c = Math.cos(r.rot);
    const along = dx * s + dz * c;
    const lat = dx * c - dz * s;
    if (along < 0 || along > r.len || Math.abs(lat) > r.w / 2) continue;
    const y = r.base + (along / r.len) * r.h;
    if (h === null || y > h) h = y;
  }
  return h;
}

// Ground height at (x,z). Surfaces higher than maxY+step are ignored (so things can pass under bridges).
export function groundHeight(x, z, maxY = Infinity) {
  const lim = maxY + 1.6;
  // road-first: where a road (or pavement) covers this point, the road surface IS the
  // ground — the 15 m terrain grid is imperfectly carved under the roads' own height
  // profile and used to poke up through it (the "bumpy / jumping car" bug). Terrain is
  // only the fallback when no road qualifies, e.g. under a bridge whose deck is above
  // maxY: roadAt filters it out and returns null there.
  const r = roadAt(x, z, lim);
  let h = r !== null ? r : terrainHeight(x, z);
  const ah = airportHeight(x, z);
  if (ah !== null && ah > h && ah <= lim) h = ah;
  const l = bGrid.get(gk(Math.floor(x / BG), Math.floor(z / BG)));
  if (l)
    for (const o of l)
      if (o.t === 0 && x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1 && o.y1 <= maxY + 1.0 && o.y1 > h && inBox(o, x, z)) h = o.y1;
  const rh = rampHeight(x, z);
  if (rh !== null && rh <= lim && rh > h) h = rh;
  return h;
}

export const CR = { x: 0, z: 0, hit: false, nx: 0, nz: 0 };
// Push a vertical cylinder (radius r, feet at y, height hh) out of buildings and tree trunks.
export function collideCircle(x, z, r, y, hh = 1.8) {
  let hit = false, nx = 0, nz = 0;
  const l = bGrid.get(gk(Math.floor(x / BG), Math.floor(z / BG)));
  if (l)
    for (const o of l) {
      if (o.t === 0) {
        if (y > o.y1 - 0.5 || y + hh < o.y0) continue;
        const wx = x - o.cx, wz = z - o.cz;
        let lx = wx * o.c - wz * o.s, lz = wx * o.s + wz * o.c;
        if (Math.abs(lx) > o.hx + r || Math.abs(lz) > o.hz + r) continue;
        const qx = clamp(lx, -o.hx, o.hx), qz = clamp(lz, -o.hz, o.hz);
        let dx = lx - qx, dz = lz - qz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 < 1e-6) {
          const a = lx + o.hx, b = o.hx - lx, c = lz + o.hz, d = o.hz - lz;
          const m = Math.min(a, b, c, d);
          if (m === a) { lx = -o.hx - r; dx = -1; dz = 0; }
          else if (m === b) { lx = o.hx + r; dx = 1; dz = 0; }
          else if (m === c) { lz = -o.hz - r; dx = 0; dz = -1; }
          else { lz = o.hz + r; dx = 0; dz = 1; }
        } else {
          const d = Math.sqrt(d2);
          dx /= d; dz /= d;
          lx = qx + dx * r; lz = qz + dz * r;
        }
        x = o.cx + lx * o.c + lz * o.s;
        z = o.cz - lx * o.s + lz * o.c;
        nx = dx * o.c + dz * o.s;
        nz = -dx * o.s + dz * o.c;
        hit = true;
      } else {
        if (y > o.y1 || y + hh < o.y0) continue;
        let dx = x - o.x, dz = z - o.z;
        const d2 = dx * dx + dz * dz;
        const rs = r + o.r;
        if (d2 >= rs * rs || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        dx /= d; dz /= d;
        x = o.x + dx * rs; z = o.z + dz * rs;
        hit = true; nx = dx; nz = dz;
      }
    }
  CR.x = x; CR.z = z; CR.hit = hit; CR.nx = nx; CR.nz = nz;
  return CR;
}

// March a ray through buildings and terrain. Returns hit distance or Infinity.
export function raycastWorld(ox, oy, oz, dx, dy, dz, maxD, step = 1.2) {
  for (let t = step; t <= maxD; t += step) {
    const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
    if (y < terrainHeight(x, z) - 0.1) return t;
    const l = bGrid.get(gk(Math.floor(x / BG), Math.floor(z / BG)));
    if (l) for (const o of l) if (o.t === 0 && x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1 && y < o.y1 && y > o.y0 && inBox(o, x, z)) return t;
  }
  return Infinity;
}
export function losClear(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1) return true;
  return raycastWorld(ax, ay, az, dx / d, dy / d, dz / d, d - 1, 3) === Infinity;
}

export function zoneName(x, z) {
  const g = gangAt(x, z);
  if (g) return g.id === 'kingz' ? 'Kingz Turf' : 'Viper Blocks';
  const ap = inAirfield(x, z);
  if (ap) return ap.name;
  if (terrainHeight(x, z) < 0 && !roadAt(x, z)) return 'Open Water';
  for (const r of REGIONS) if (Math.hypot(x - r.x, z - r.z) < r.r) return r.name;
  const u = urbanAt(x, z);
  let best = null, bd = Infinity;
  for (const d of DISTRICTS) {
    const dd = Math.hypot(x - d.x, z - d.z);
    if (dd < bd) { bd = dd; best = d; }
  }
  if (best && (u > 0.15 || bd < 700)) return best.name;
  const b = biomeAt(x, z);
  if (b === BIOMES.FOREST) return 'Pinewood Forest';
  if (b === BIOMES.ALPINE) return terrainHeight(x, z) > 380 ? 'Mt. Ember' : 'Ember Ridge';
  if (b === BIOMES.DESERT) return 'Red Dust Flats';
  if (b === BIOMES.BEACH) return 'Crimson Coastline';
  if (b === BIOMES.WETLAND) return 'Saltmarsh';
  return 'Countryside';
}

let built = false;
export function generateWorldData() {
  if (built) return;
  built = true;
  if (!W) throw new Error('call loadWorldData() first');
  GANGS = W.gangs.map((g) => ({ ...g, hostile: 0, annoy: 0 }));
  DISTRICTS = W.districts;
  REGIONS = W.regions;
  buildRoads();
  fitRoadsToAirports();
  carveRoadShoulders();
  regSegs();
  genAirports();
  genBuildings();
  genLandmarks();
  genStreets();
  genNature();
  // a few stunt ramps around the island
  for (const [px, py, rot] of [[250, 520, 0.6], [270, 540, 2.0], [230, 505, -0.5], [360, 520, 1.2], [600, 300, 0.2]]) {
    const p = streetSpot(px * TS - HALF, py * TS - HALF, false);
    if (!p.s) continue;
    const a = Math.atan2(p.s.dx, p.s.dz) + (rot > 1 ? Math.PI : 0);
    ramps.push({ x: p.x - Math.sin(a) * 30, z: p.z - Math.cos(a) * 30, rot: a, w: 7, len: 18, h: 5 });
  }
  for (const r of ramps) r.base = groundHeight(r.x, r.z);
}
void sstep;
