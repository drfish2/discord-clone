// World data: heightfield, road network, buildings, colliders and ground queries.
// The island is compiled offline from a reference map (tools/mapgen) into assets/map/world.json:
// heights, roads with height profiles and bridges, street-facing building lots, airports and places.
// No rendering here; world.js turns this data into meshes.
import { clamp, lerp, sstep, WATER } from './core.js';
import { noise2, mulberry32 } from './noise.js';
import { STYLES, STYLE, ZONE_STYLE, wpick } from './districts.js';

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

// Road centrelines are traced from a raster map, one point every ~12 m, and jitter by
// ~6 deg per point (1.6k kinks over 30 deg): roads read as zig-zags. Relax interior points
// toward their neighbours, a few metres at most, with junction ends and bridge points pinned
// so the graph and the bridge decks don't move. Heights are smoothed with the positions.
const SMOOTH_ITERS = 12, SMOOTH_MAX = 6; // iterations; max sideways move (m)
function smoothRoadPoints(p, br) {
  const n = p.length / 3;
  if (n < 3) return p;
  const pin = (k) => k === 0 || k === n - 1 || br[k];
  const o = p.slice();
  let a = p.slice(), b = p.slice();
  for (let it = 0; it < SMOOTH_ITERS; it++) {
    for (let k = 1; k < n - 1; k++) {
      if (pin(k)) continue;
      for (let c = 0; c < 3; c++) b[k * 3 + c] = 0.25 * a[(k - 1) * 3 + c] + 0.5 * a[k * 3 + c] + 0.25 * a[(k + 1) * 3 + c];
      const dx = b[k * 3] - o[k * 3], dz = b[k * 3 + 1] - o[k * 3 + 1], d = Math.hypot(dx, dz);
      if (d > SMOOTH_MAX) { b[k * 3] = o[k * 3] + (dx / d) * SMOOTH_MAX; b[k * 3 + 1] = o[k * 3 + 1] + (dz / d) * SMOOTH_MAX; }
    }
    [a, b] = [b, a];
  }
  return a;
}

// Airfield footprints (runways, plus apron/terminal/hangars on the inland side, mirroring
// genAirports' layout). The map's road graph ignores the airports, so some roads ran
// straight across runways and aprons; those junction-to-junction roads are dropped
// (traffic turns back at the resulting dead ends).
function airportKeepout() {
  const zones = [];
  for (const ap of W.airports) {
    const big = ap.key === 'east' || ap === W.airports[0];
    const r = ap.runways[0];
    const L = Math.hypot(r.x1 - r.x0, r.z1 - r.z0), dx = (r.x1 - r.x0) / L, dz = (r.z1 - r.z0) / L;
    const tx = (r.x0 + r.x1) / 2, tz = (r.z0 + r.z1) / 2;
    let side = terrainHeight(tx - dz * 160, tz + dx * 160) < terrainHeight(tx + dz * 160, tz - dx * 160) ? -1 : 1;
    for (const r2 of ap.runways.slice(1)) {
      const mx = (r2.x0 + r2.x1) / 2 - tx, mz = (r2.z0 + r2.z1) / 2 - tz;
      if ((-dz * mx + dx * mz) * side > 0) side = -side;
    }
    const nx = -dz * side, nz = dx * side;
    // terminal side: apron, terminal, tower and hangars (up to ~390 m along from mid-runway)
    zones.push({ cx: tx, cz: tz, ax: dx, az: dz, a0: -Math.max(Math.min(L * 0.7, 600) / 2, big ? 420 : 260), a1: Math.max(Math.min(L * 0.7, 600) / 2, big ? 420 : 260), nx, nz, n0: 0, n1: big ? 205 : 185 });
    for (const rw of ap.runways) {
      const l = Math.hypot(rw.x1 - rw.x0, rw.z1 - rw.z0), ux = (rw.x1 - rw.x0) / l, uz = (rw.z1 - rw.z0) / l;
      zones.push({ cx: rw.x0, cz: rw.z0, ax: ux, az: uz, a0: -60, a1: l + 60, nx: -uz, nz: ux, n0: -(rw.w / 2 + 25), n1: rw.w / 2 + 25 });
    }
  }
  return (x, z) => zones.some((q) => {
    const px = x - q.cx, pz = z - q.cz, a = px * q.ax + pz * q.az, n = px * q.nx + pz * q.nz;
    return a > q.a0 && a < q.a1 && n > q.n0 && n < q.n1;
  });
}

function buildRoads() {
  const J = W.nodes.map(([x, z, h]) => addNode(x, z, h));
  const inAirport = airportKeepout();
  for (const r of W.roads) {
    let cross = false;
    for (let k = 0; k < r.p.length && !cross; k += 3) if (!r.br[k / 3] && inAirport(r.p[k], r.p[k + 1])) cross = true;
    if (cross) continue;
    const p = smoothRoadPoints(r.p, r.br);
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
export const RP = { d: 0, h: 0, t: 0, s: null, side: 0, cap: false };
function proj(s, x, z) {
  const px = x - s.a.x, pz = z - s.a.z;
  let t = px * s.dx + pz * s.dz;
  RP.cap = t < 0 || t > s.len; // past an end: the round cap around the end node
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
  // Strip hits (alongside a segment) beat cap hits (the round ends around its nodes). On a
  // slope the next segment's cap holds the higher node's height and reaches ~w/2 m back over
  // this segment; taking the max made a 0.4-0.6 m step every node on every climb (bridges
  // were unusable). Caps now only fill gaps, e.g. the outside corner of a bend or junction.
  let h = null, hc = null, hp = null, hpc = null;
  for (const s of l) {
    proj(s, x, z);
    if (RP.d < s.w / 2 + 0.3) {
      if (RP.h > maxY) continue;
      if (!RP.cap) { if (h === null || RP.h > h) h = RP.h; }
      else if (hc === null || RP.h > hc) hc = RP.h;
    } else if (s.sidewalk && RP.d < s.w / 2 + SIDEWALK) {
      const y = RP.h + CURB;
      if (y > maxY) continue;
      if (!RP.cap) { if (hp === null || y > hp) hp = y; }
      else if (hpc === null || y > hpc) hpc = y;
    }
  }
  if (h === null) h = hc;
  if (hp === null) hp = hpc;
  // a pavement well above the carriageway is a different level (bridge over a road)
  if (h === null || (hp !== null && hp > h + 1)) return hp;
  return h;
}
// Verge behind a raised pavement. Pavements on embankments ended in a 0.4-0.6 m ledge
// (the 15 m terrain grid can't model the slope), so cars dropped off the back or slammed
// into it from the lots behind. Within VERGE m of a pavement's outer edge the ground slopes
// down 1:2 from the pavement to the terrain. Returns that height, or null.
const VERGE = 1.4;
function vergeAt(x, z, maxY) {
  const l = segsAt(x, z);
  if (!l) return null;
  let h = null;
  for (const s of l) {
    if (!s.sidewalk) continue;
    proj(s, x, z);
    const out = RP.d - (s.w / 2 + SIDEWALK);
    if (out < 0 || out > VERGE) continue;
    const y = RP.h + CURB - out * 0.5;
    if (y <= maxY && (h === null || y > h)) h = y;
  }
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
  if (b.kids) for (const k of b.kids) removeBuilding(k);
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

const hash01 = (x, z) => { const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return v - Math.floor(v); };
const PALETTE = {
  down: [0x8fa3b8, 0x6f8499, 0xb8c4cc, 0x5d7085, 0xc9c2b0, 0x9aa7a0, 0x7b8fa6, 0xa9b5bf],
  mid: [0xe8c872, 0xdcd3c0, 0xc96f4a, 0xb0c4d8, 0xece6d6, 0xd9a066, 0xa4593c, 0xd8cfa8, 0x9fb3a0],
  res: [0xf2e6c9, 0xe9c7a5, 0xcfe0e8, 0xe7d9b0, 0xf0d0c0, 0xd7e3c8, 0xffffff, 0xd9b38c],
  desert: [0xd9a873, 0xe0b98a, 0xc99467, 0xe8cfa6],
};
const ROOFS = [0x8b3a2b, 0x5a5a5a, 0x3e4d5c, 0x7a4b2a, 0x2f4f3a];
const KK_KEYS = Object.keys(KK);

// ---------------------------------------------------------------- buildings from the compiled lots
// Facade types read by world.js buildingMaterial(): every window, door and storey is sized in
// metres there, so a building only has to say what it is made of and what its ground floor is.
export const FAC = {
  BRICK: 0, PLASTER: 1, OFFICE: 2, GLASS: 3, HOUSE: 4, HOSPITAL: 5, SHED: 6, CIVIC: 7, PLAIN: 8,
  DECO: 9, ADOBE: 10, INDUSTRIAL: 11, CLAPBOARD: 12, CHALET: 13, VILLA: 14, TENEMENT: 15, MISSION: 16, TENEMENT_STUCCO: 17,
};
export const GF = { HOME: 0, SHOP: 1, LOBBY: 2, GARAGE: 3 };
const BRICKS = [0xa4553c, 0x8e4a35, 0xb06a4c, 0x7d4434, 0xc49a6c, 0x9b5b45, 0xb5876a];
// a separate stream so the shared world RNG (streets, nature, missions) sees the same draws as before
const RB = mulberry32(19870311);
// RX: the stream facade seeds and style picks draw from. genBuildings points it at its own style
// stream (RS) and replays the original RB draws itself, so lot layouts (and every tree, prop and
// fence placed around them) come out exactly as before the district styles existed.
let RX = RB;
const RS = mulberry32(31337);
const pick = (a) => a[Math.floor(RX() * a.length)];
// street level in front of a lot (facade grids start here, not at the buried foundation)
function frontGround(cx, cz, hz, rot) {
  const fx = Math.sin(rot), fz = Math.cos(rot);
  return terrainHeight(cx + fx * (hz + 1.5), cz + fz * (hz + 1.5));
}
function facade(b, type, gf, blank = 0) {
  b.fac = type;
  b.gf = gf;
  b.blank = blank; // bit 1: left side is a party wall, bit 2: right side
  b.seed = RX();
  b.gy = clamp(frontGround(b.cx, b.cz, b.hz, b.rot), b.y0 + 0.4, b.y1 - 2.5);
  return b;
}
// a stair/lift housing on a flat roof: a real box, so it collides like it looks
function roofHouse(b) {
  const w = Math.min(b.hx, 3.2) * 0.8, d = Math.min(b.hz, 3) * 0.8;
  if (b.hx < 4 || b.hz < 4) return;
  const u = (RX() - 0.5) * (b.hx - w - 1.2) * 2, v = (RX() - 0.5) * (b.hz - d - 1.2) * 2;
  const x = b.cx + u * b.c + v * b.s, z = b.cz - u * b.s + v * b.c;
  const r = addBox(x, z, w, d, b.rot + (RX() < 0.5 ? 0 : Math.PI), 2.7, 0xb9b4aa, 'roof', null, b.y1);
  (b.kids = b.kids || []).push(r);
  facade(r, FAC.PLAIN, GF.HOME);
  r.gy = b.y1;
}
// how far a lot's front must step back so no part of it stands on a carriageway or pavement
function frontClearance(cx, cz, hx, hz, rot) {
  const c = Math.cos(rot), s = Math.sin(rot);
  // the back and sides cannot step back: a road there means the lot is unusable
  for (const [u, v] of [[-1, 0], [1, 0], [0, -1], [-1, -1], [1, -1]]) {
    const lx = u * (hx - 0.2), lz = v * (hz - 0.2);
    const nr = nearestRoad(cx + lx * c + lz * s, cz - lx * s + lz * c);
    if (nr && nr.d < 0) return -1;
  }
  for (let back = 0; back <= Math.min(4, hz - 3); back += 0.5) {
    let ok = true;
    for (const u of [-1, -0.5, 0, 0.5, 1]) {
      for (const v of [1, 0.6]) {
        const lx = u * (hx - 0.1), lz = v * hz - back;
        const x = cx + lx * c + lz * s, z = cz - lx * s + lz * c;
        const nr = nearestRoad(x, z);
        if (nr && (nr.d < 0.2 || onPavement(x, z))) { ok = false; break; }
      }
      if (!ok) break;
    }
    if (ok) return back;
  }
  return -1; // a road runs through the lot: leave it empty
}
// storeys in metres: ground floor (shops are taller), upper floors, a parapet band on top
function storeyHeight(target, gf, sh) {
  const n = clamp(Math.round((target - gf - 0.6) / sh), 1, 40);
  return gf + n * sh + 0.6;
}
// ---------------------------------------------------------------- district styles
// Every 30 m cell gets a district identity (districts.js STYLES) from the same rules as
// zoneName(): gang turf, then regions, then the nearest district in town, then the biome.
// The lookup point is pushed around by noise so neighbourhoods blend over ~100 m.
let SGRID = new Uint8Array(0);
function zoneStyleKey(x, z) {
  for (const g of GANGS) if (Math.hypot(x - g.x, z - g.z) < g.r) return g.id === 'kingz' ? 'kingz' : 'vipers';
  for (const r of REGIONS) if (Math.hypot(x - r.x, z - r.z) < r.r) return ZONE_STYLE[r.name] || 'farm';
  let best = null, bd = Infinity;
  for (const d of DISTRICTS) {
    const dd = Math.hypot(x - d.x, z - d.z);
    if (dd < bd) { bd = dd; best = d; }
  }
  const b = biomeAt(x, z);
  if (best && (urbanAt(x, z) > 0.15 || bd < 700 || b === BIOMES.BEACH)) return ZONE_STYLE[best.name] || 'farm';
  if (b === BIOMES.DESERT) return 'desert';
  if (b === BIOMES.WETLAND) return 'marsh';
  if (b === BIOMES.ALPINE) return 'alpine';
  return 'farm';
}
function buildStyleGrid() {
  SGRID = new Uint8Array(BN * BN);
  const f = (2 * HALF) / (BN - 1);
  for (let j = 0; j < BN; j++)
    for (let i = 0; i < BN; i++) {
      const x = -HALF + i * f, z = -HALF + j * f;
      const jx = x + noise2(x * 0.004, z * 0.004) * 110, jz = z + noise2(x * 0.004 + 31.7, z * 0.004 + 11.3) * 110;
      SGRID[j * BN + i] = STYLE[zoneStyleKey(jx, jz)] ?? STYLE.farm;
    }
}
// style index / style object at a point
export function styleAt(x, z) {
  return SGRID[gridIdx(x, z)] || 0;
}
export function styleOf(x, z) {
  return STYLES[styleAt(x, z)];
}
// 0..1: how close to the financial core (the first compiled downtown) a point is
function coreAt(x, z) {
  const d = W.downtowns && W.downtowns[0];
  if (!d) return 0;
  return clamp(1 - Math.hypot(x - d[0], z - d[1]) / 750, 0, 1);
}
const palOf = (spec, type) => (Array.isArray(spec.pal) ? spec.pal : spec.pal[type] || Object.values(spec.pal)[0]);
// storey heights (m) per facade type
const STOREY = { 2: 3.6, 3: 3.9, 4: 2.9, 12: 2.9, 13: 2.9, 14: 3.3, 11: 4.2 };
// pitched roof from a style's roof spec (b.roof colour, b.roofType, b.pitch)
function styleRoof(b, spec, type) {
  const r = (spec.roofFac && spec.roofFac[type]) || spec.roof;
  if (!r || RX() >= r.p) return false;
  b.roof = pick(r.pal);
  b.roofType = r.alt && RX() < 0.35 ? r.alt : r.type;
  b.pitch = r.pitch;
  return true;
}

// Street dressing generated with the buildings and in genDressing(): simple primitives that
// world.js / dressing.js instance by kind. {k:'box'|'cyl'|'cone'|'sphere'|'container'|'bill'|'blade',
// x,y,z (centre), sx,sy,sz (full size; cyl/cone: sx = diameter), ry (and optional rx, rz),
// c (colour), glow (night emissive), far (never distance culled), ad (billboard image)}
export const kit = [];
function kitAdd(k, x, y, z, sx, sy, sz, ry, c, extra) {
  const o = { k, x, y, z, sx, sy, sz, ry, c };
  if (extra) Object.assign(o, extra);
  kit.push(o);
  return o;
}
// local (u along the front, v towards the street) to world, for a building b
const bLocal = (b, u, v) => [b.cx + u * b.c + v * b.s, b.cz - u * b.s + v * b.c];
const NEON = [0xff3fa4, 0x29e0ff, 0xffe14a, 0x7dff6a, 0xff6a2a, 0xb06aff];

// rooftop bits: wooden water tanks (Kingsbay), AC units (Eastgate)
function roofClutter(b, kind) {
  if (b.hx < 3.5 || b.hz < 3.5) return;
  const top = b.y1;
  if (kind === 'tanks' && RX() < 0.42) {
    const [x, z] = bLocal(b, (RX() - 0.5) * (b.hx - 2.5), -(RX() * 0.5) * (b.hz - 2.5));
    const r = 1.5 + RX() * 0.6, legs = 2.6, hh = 3.4;
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) kitAdd('box', x + lx * r * 0.6, top + legs / 2, z + lz * r * 0.6, 0.18, legs, 0.18, 0, 0x3a3634);
    kitAdd('cyl', x, top + legs + hh / 2, z, r * 2, hh, r * 2, 0, 0x7a5a3e, { tank: 1 });
    kitAdd('cone', x, top + legs + hh + 0.6, z, r * 2.15, 1.2, r * 2.15, 0, 0x4a4440);
    regCollider({ t: 1, x, z, r: r + 0.1, y0: top, y1: top + legs + hh + 1.2 }, x - r - 1, x + r + 1, z - r - 1, z + r + 1);
  } else if (kind === 'ac') {
    const n = 1 + Math.floor(RX() * 3);
    for (let k = 0; k < n; k++) {
      const [x, z] = bLocal(b, (RX() - 0.5) * (b.hx - 2), (RX() - 0.5) * (b.hz - 2));
      kitAdd('box', x, top + 0.6, z, 1.4, 1.2, 1.0, b.rot, 0x9a9c9e);
    }
  }
}
// a vertical neon blade sign on a shopfront corner (overhead, no collider)
function bladeSign(b) {
  const sg = RX() < 0.5 ? -1 : 1;
  const hgt = Math.min(6.5, b.y1 - b.gy - 5.2);
  if (hgt < 2 || b.hx < 2.5) return;
  const [x, z] = bLocal(b, sg * (b.hx - 0.7), b.hz + 0.55);
  kitAdd('blade', x, b.gy + 4.4 + hgt / 2, z, 0.18, hgt, 1.0, b.rot, pick(NEON), { glow: 1 });
}

function genBuildings() {
  // Layout (lot splitting, setbacks, which lots are skipped) replays the original RB draws one
  // for one; what each building looks like comes from the district style and the RS stream.
  RX = RS;
  for (const [cx, cz, hx, hz, rot, h, style] of W.buildings) {
    if (style === 0) {
      R();
      RB(); RB(); RB(); // original: glass?, colour, facade seed
      const st = styleOf(cx, cz), T = st.tower;
      const type = wpick(T.fac, RX());
      const core = st.key === 'downtown' ? coreAt(cx, cz) : 0;
      const hm = T.hMul * (1 + core * 0.9);
      const sh = STOREY[type] || 3.3;
      const b = addBox(cx, cz, hx, hz, rot, storeyHeight(Math.max(9, h * hm), 5, sh), pick(palOf(T, type)), 'tower');
      facade(b, type, type === FAC.OFFICE || type === FAC.GLASS ? GF.LOBBY : GF.SHOP);
      b.awn = pick(st.awn);
      if (st.blk.clutter === 'plant' || b.y1 - b.y0 > 30) roofHouse(b);
    } else if (style === 1) {
      for (let k = 0; k < KK_KEYS.length; k++) R();
      // a row of narrower units across the lot instead of one blown-up building
      const w = hx * 2;
      const n = w > 30 ? 3 : w > 17 ? 2 : 1;
      const cuts = [0];
      for (let i = 1; i < n; i++) cuts.push((i + (RB() - 0.5) * 0.3) / n);
      cuts.push(1);
      const c = Math.cos(rot), s = Math.sin(rot);
      // warehouses, strip malls and adobe stores read as one building across the whole lot:
      // their units share type, colour and height (party walls stay blank)
      const lot = { t: RX(), c: RX(), h: RX(), g: RX() };
      for (let i = 0; i < n; i++) {
        const u0 = -hx + cuts[i] * w, u1 = -hx + cuts[i + 1] * w;
        const uw = (u1 - u0) / 2, um = (u0 + u1) / 2;
        // some units sit a little back from the frontage, which breaks up the street wall
        const clear = frontClearance(cx + um * c, cz - um * s, uw, hz, rot);
        const back = Math.max(RB() < 0.25 ? Math.min(1.5, hz * 0.15) : 0, clear);
        // original draws: shop?, brick?, (plaster or office?), height, colour
        RB(); if (RB() >= 0.48) RB(); RB(); RB();
        if (clear < 0) continue;
        RB(); // original facade seed
        const origRoofHouse = RB() < 0.45;
        if (origRoofHouse && uw >= 4 && hz - back / 2 >= 4) { RB(); RB(); RB(); RB(); } // original roof housing
        const ucx = cx + um * c - (back / 2) * s, ucz = cz - um * s - (back / 2) * c;
        const st = styleOf(ucx, ucz), B = st.blk;
        const one = B.units === 1;
        const type = wpick(B.fac, one ? lot.t : RX());
        const rs = one ? lot.g : RX();
        const gfk = rs < B.shop ? GF.SHOP : rs < B.shop + (B.garage || 0) ? GF.GARAGE : rs < B.shop + (B.lobby || 0) ? GF.LOBBY : GF.HOME;
        const gf = gfk === GF.SHOP ? 4.4 : gfk === GF.HOME ? 3.5 : 5;
        const core = st.key === 'downtown' ? coreAt(ucx, ucz) : 0;
        const target = lerp(B.h[0], B.h[1], one ? lot.h : RX()) + core * core * lerp(20, 75, RX());
        const ht = type === FAC.SHED ? target : storeyHeight(clamp(target, 4.6, 130), gf, STOREY[type] || 3.2);
        const pal = palOf(B, type);
        const col = one ? pal[Math.floor(lot.c * pal.length)] : pick(pal);
        const b = addBox(ucx, ucz, uw, hz - back / 2, rot, ht, col, 'block');
        facade(b, type, gfk, (i > 0 ? 1 : 0) | (i < n - 1 ? 2 : 0));
        b.awn = pick(st.awn);
        if (!styleRoof(b, B, type)) {
          if (B.clutter === 'tanks' || B.clutter === 'ac') roofClutter(b, B.clutter);
          if (!one && RX() < (B.clutter === 'plant' ? 0.8 : 0.45)) roofHouse(b);
        }
        if (st.neon && gfk === GF.SHOP && RX() < st.neon) bladeSign(b);
        if (st.roofBill && !b.roof && RX() < st.roofBill) b.roofBill = 1 + Math.floor(RX() * 8);
      }
    } else {
      const des = biomeAt(cx, cz) === BIOMES.DESERT;
      R();
      if (!des) R();
      let fl = h < 5.8 ? 1 : h > 8.4 ? 3 : 2;
      const back = frontClearance(cx, cz, hx, hz, rot);
      if (back < 0) continue;
      RB(); if (!des) RB(); RB(); // original: wall colour, roof colour, facade seed
      // detached houses: two storeys (sometimes one or three), or what the district builds
      const st = styleOf(cx, cz), Hs = st.house;
      const type = wpick(Hs.fac, RX());
      if (Hs.floors) fl = clamp(fl, Hs.floors[0], Hs.floors[1]);
      const sh = STOREY[type] || 3.2;
      const b = addBox(cx - Math.sin(rot) * back / 2, cz - Math.cos(rot) * back / 2, hx, hz - back / 2, rot, 0.4 + fl * sh, pick(palOf(Hs, type)), 'house');
      facade(b, type, GF.HOME);
      if (!des) styleRoof(b, Hs, type);
    }
  }
  RX = RB;
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
        const st = styleAt(x, z), S = STYLES[st];
        // run-down districts lose some lamps (deterministic, no shared RNG draw)
        if (!(S.lampSkip && hash01(x, z) < S.lampSkip)) lamps.push({ x, y, z, dir: Math.atan2(s.dz * side, -s.dx * side), st });
      }
      if (R() < 0.05) {
        const side = R() < 0.5 ? 1 : -1, off = s.w / 2 + SIDEWALK - 0.8;
        const x = s.a.x + s.dx * s.len * 0.3 - s.dz * off * side, z = s.a.z + s.dz * s.len * 0.3 + s.dx * off * side;
        const file = R() < 0.4 ? 'kk_firehydrant' : R() < 0.6 ? 'kk_bench' : 'kk_trash_A';
        props.push({ file, x, y: (s.a.h + s.b.h) / 2 + CURB, z, rot: Math.atan2(-s.dz * side, s.dx * side) + Math.PI / 2, h: 0.9, col: file === 'kk_firehydrant' ? 0.3 : 0 });
      }
    });
  }
  // traffic lights on two corners of busy town junctions. The corner spot is worked out
  // from one road only, so at angled or wide junctions it can land on a neighbouring
  // road: check every candidate against all carriageways (plus a margin) and fall back
  // to the other side / further back, or skip the light.
  const onCarriageway = (x, z) => {
    const l = segsAt(x, z);
    if (l) for (const s of l) { proj(s, x, z); if (RP.d < s.w / 2 + 1.2) return true; }
    return false;
  };
  for (const n of junctions) {
    const city = n.edges.filter((e) => e.s.kind !== 'rural');
    if (city.length < 3) continue;
    for (let k = 0; k < 2; k++) {
      const e = city[k];
      const w = e.s.w / 2 + SIDEWALK - 0.7;
      const dx = (e.n.x - n.x) / e.s.len, dz = (e.n.z - n.z) / e.s.len;
      let spot = null;
      for (const back of [1, 4, 8]) {
        for (const side of [1, -1]) {
          const x = n.x + dx * (w + back) - dz * w * side, z = n.z + dz * (w + back) + dx * w * side;
          if (!onCarriageway(x, z)) { spot = { x, z }; break; }
        }
        if (spot) break;
      }
      if (!spot) continue;
      props.push({ file: 'kk_trafficlight_A', x: spot.x, y: groundHeight(spot.x, spot.z, n.h + 2), z: spot.z, rot: Math.atan2(-dx, -dz), h: 5.2, col: 0.25 });
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
// on (or within pad m of) a runway, apron or taxiway slab
export function onAirportSlab(x, z, pad = 2) {
  if (airportHeight(x, z) !== null) return true;
  return pad > 0 && (airportHeight(x + pad, z) !== null || airportHeight(x - pad, z) !== null || airportHeight(x, z + pad) !== null || airportHeight(x, z - pad) !== null);
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
      if (b === BIOMES.FOREST || h > 160) { const q = R(); addTree(jx, jz, q < 0.16 ? 'bush' : R() < (h > 120 ? 0.85 : 0.5) ? 'pine' : 'round', q < 0.16 ? rr(0.9, 1.6) : rr(0.9, 1.7)); continue; }
      if (b === BIOMES.WETLAND) { addTree(jx, jz, R() < 0.6 ? 'bush' : 'round', rr(0.8, 1.3)); continue; }
      addTree(jx, jz, R() < 0.62 ? 'round' : R() < 0.35 ? 'pine' : 'bush', rr(0.8, 1.4));
    }
  // street trees in town: along the kerb edge of the pavement (clear of the walking line), between
  // lamps. (The old check compared the kerb distance with the road half width, so it never passed
  // and no street tree was ever planted; this is the last shared-RNG user, so fixing it moves nothing.)
  for (const s of segs) {
    if (!s.sidewalk || s.kind === 'main' || R() > 0.22) continue;
    const side = R() < 0.5 ? 1 : -1, off = s.w / 2 + 0.75;
    const t = rr(0.2, 0.8);
    const x = s.a.x + s.dx * s.len * t - s.dz * off * side, z = s.a.z + s.dz * s.len * t + s.dx * off * side;
    const nr = nearestRoad(x, z);
    if (nr && nr.d > 0.6 && clearOf(x, z, 1.4) && !onCrossing(x, z)) {
      // the species follows the district (the size draw stays, so the shared RNG doesn't drift)
      const sc = rr(0.8, 1.0), tt = styleOf(x, z).tree;
      if (tt === 'palm') addTree(x, z, 'palm', sc * 1.1);
      else if (tt === 'pine') addTree(x, z, 'pine', sc * 0.8);
      else if (tt === 'round') addTree(x, z, 'round', sc);
    }
  }
}

// ---------------------------------------------------------------- shores
// Soften the coastline: the 15 m grid gives the shore a zig-zag, steppy edge. Two relaxation
// passes over nodes where land meets sea give a smoother contour and a gentler beach slope.
// Nodes near roads and airfields are left alone (roads were fitted to the terrain).
function shapeShores() {
  const N = TN + 1;
  const keep = new Uint8Array(N * N);
  const mark = (x0, x1, z0, z1) => {
    const i0 = clamp(Math.floor((x0 + HALF) / TS), 0, TN), i1 = clamp(Math.ceil((x1 + HALF) / TS), 0, TN);
    const j0 = clamp(Math.floor((z0 + HALF) / TS), 0, TN), j1 = clamp(Math.ceil((z1 + HALF) / TS), 0, TN);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) keep[j * N + i] = 1;
  };
  for (const s of segs) {
    const m = s.w / 2 + 24;
    mark(Math.min(s.a.x, s.b.x) - m, Math.max(s.a.x, s.b.x) + m, Math.min(s.a.z, s.b.z) - m, Math.max(s.a.z, s.b.z) + m);
  }
  for (const ap of W.airports) for (const r of ap.runways) mark(Math.min(r.x0, r.x1) - 330, Math.max(r.x0, r.x1) + 330, Math.min(r.z0, r.z1) - 330, Math.max(r.z0, r.z1) + 330);
  for (let it = 0; it < 2; it++) {
    const H2 = H.slice();
    for (let j = 1; j < TN; j++)
      for (let i = 1; i < TN; i++) {
        const o = j * N + i;
        const h = H[o];
        if (h < -7 || h > 6 || keep[o]) continue;
        let lo = Infinity, hi = -Infinity, sum = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const v = H[o + dj * N + di]; sum += v; if (v < lo) lo = v; if (v > hi) hi = v; }
        if (lo > WATER || hi < WATER) continue; // only where land meets sea
        H2[o] = h + (sum / 9 - h) * 0.65;
      }
    H.set(H2);
  }
}

// ---------------------------------------------------------------- fences, hedges, gardens
// Fence panels for flora.js: {x, y, z, rot, len, slope, type}. Every straight run also gets one
// thin oriented-box collider (t:0, thin: true): cars and people bump into it, but it is never
// treated as walkable ground or as a sight-line blocker.
export const fences = [];
export const FENCE = {
  picket: { h: 1.0, t: 0.08 }, privacy: { h: 1.5, t: 0.08 }, hedge: { h: 1.35, t: 0.85 }, brick: { h: 0.9, t: 0.3 },
  stone: { h: 0.85, t: 0.55 }, rail: { h: 1.15, t: 0.12 }, adobe: { h: 1.05, t: 0.35 }, chain: { h: 1.9, t: 0.06 },
};
const fGrid = new Map(); // 4 m cells -> panels, to drop near-duplicate parallel panels of neighbouring lots
function fenceDup(x, z, ux, uz) {
  const ci = Math.floor(x / 4), cj = Math.floor(z / 4);
  for (let i = ci - 1; i <= ci + 1; i++)
    for (let j = cj - 1; j <= cj + 1; j++) {
      const l = fGrid.get(gk(i, j));
      if (l) for (const p of l) if (Math.hypot(p.x - x, p.z - z) < 1.7 && Math.abs(p.ux * ux + p.uz * uz) > 0.85) return true;
    }
  return false;
}
function fenceOk(x, z, clear) {
  const h = terrainHeight(x, z);
  if (h < 2.6) return false; // never on beaches or in water
  if (biomeAt(x, z) === BIOMES.BEACH) return false;
  const nr = nearestRoad(x, z);
  if (nr && nr.d < (nr.s.sidewalk ? SIDEWALK + clear : clear)) return false;
  if (inAirfield(x, z, 20)) return false;
  const l = bGrid.get(gk(Math.floor(x / BG), Math.floor(z / BG)));
  if (l) for (const o of l) {
    if (o.t === 0) {
      if (o.thin || x < o.x0 - 0.7 || x > o.x1 + 0.7 || z < o.z0 - 0.7 || z > o.z1 + 0.7) continue;
      const dx = x - o.cx, dz = z - o.cz;
      if (Math.abs(dx * o.c - dz * o.s) < o.hx + 0.6 && Math.abs(dx * o.s + dz * o.c) < o.hz + 0.6) return false;
    } else if (Math.hypot(x - o.x, z - o.z) < o.r + 0.5) return false;
  }
  return true;
}
function fenceCollider(run, type) {
  const a = run[0], b = run[run.length - 1];
  const ax = a.x - a.ux * a.len / 2, az = a.z - a.uz * a.len / 2, bx = b.x + b.ux * b.len / 2, bz = b.z + b.uz * b.len / 2;
  const L = Math.hypot(bx - ax, bz - az);
  if (L < 0.5) return;
  const ux = (bx - ax) / L, uz = (bz - az) / L;
  const F = FENCE[type];
  const cx = (ax + bx) / 2, cz = (az + bz) / 2, hx = L / 2, hz = F.t / 2 + 0.05;
  const rot = Math.atan2(-uz, ux);
  const c = Math.cos(rot), sn = Math.sin(rot);
  const ex = Math.abs(c) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(c) * hz;
  let y0 = Infinity, y1 = -Infinity;
  for (const p of run) { y0 = Math.min(y0, p.y - Math.abs(p.slope) * p.len / 2); y1 = Math.max(y1, p.y + Math.abs(p.slope) * p.len / 2); }
  const o = { t: 0, thin: true, kind: 'fence', cx, cz, hx, hz, rot, c, s: sn, x0: cx - ex, x1: cx + ex, z0: cz - ez, z1: cz + ez, y0: y0 - 0.5, y1: y1 + F.h };
  regCollider(o, o.x0, o.x1, o.z0, o.z1);
}
// a straight fence from A to B, split into ~2 m panels; invalid panels break it into runs
function addFenceRun(ax, az, bx, bz, type, clear = 1.2, panel = 2) {
  const L = Math.hypot(bx - ax, bz - az);
  if (L < 1.2) return 0;
  const ux = (bx - ax) / L, uz = (bz - az) / L;
  const n = Math.max(1, Math.round(L / panel)), len = L / n;
  let run = [], added = 0;
  const flush = () => { if (run.length) fenceCollider(run, type); run = []; };
  for (let k = 0; k < n; k++) {
    const x0 = ax + ux * len * k, z0 = az + uz * len * k, x1 = x0 + ux * len, z1 = z0 + uz * len;
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const h0 = terrainHeight(x0, z0), h1 = terrainHeight(x1, z1);
    if (Math.abs(h1 - h0) > len * 0.45 || !fenceOk(x0, z0, clear) || !fenceOk(x1, z1, clear) || !fenceOk(mx, mz, clear) || fenceDup(mx, mz, ux, uz)) { flush(); continue; }
    const p = { x: mx, z: mz, y: (h0 + h1) / 2, ux, uz, rot: Math.atan2(-uz, ux), len, slope: (h1 - h0) / len, type };
    fences.push(p);
    const key = gk(Math.floor(mx / 4), Math.floor(mz / 4));
    let l = fGrid.get(key);
    if (!l) fGrid.set(key, (l = []));
    l.push(p);
    run.push(p);
    added++;
  }
  flush();
  return added;
}
function genFences() {
  const RF = mulberry32(777);
  // residential lots: a front fence/hedge/wall behind the pavement with a gate gap, plus sides and back
  for (const [cx, cz, hx, hz, rot, , style] of W.buildings) {
    if (style === 0) continue;
    const u = urbanAt(cx, cz);
    const fst = styleOf(cx, cz);
    const chainTurf = fst.key === 'kingz' || fst.key === 'vipers' || fst.key === 'port' || fst.key === 'harbour';
    if (style === 1 && u > 0.3 && !chainTurf) continue; // town centres: no garden fences (turf and docks get chain-link)
    const r0 = RF(), r1 = RF(), r2 = RF(), r3 = RF();
    if (r0 < (style === 1 ? 0.55 : 0.12)) continue; // open lots (most shops / KayKit lots stay open)
    const b = biomeAt(cx, cz);
    if (b === BIOMES.BEACH) continue;
    const type = b === BIOMES.DESERT && fst.key !== 'desert' ? 'adobe' : fst.fence[Math.floor(r1 * fst.fence.length)];
    const fx = Math.sin(rot), fz = Math.cos(rot); // towards the street
    const rx = Math.cos(rot), rz = -Math.sin(rot);
    const pfx = cx + fx * hz, pfz = cz + fz * hz;
    const nr = nearestRoad(pfx, pfz);
    const W2 = hx + 1.3;
    let front = hz + 0.5;
    if (nr && nr.d < 14) {
      const shift = nr.d - (nr.s.sidewalk ? SIDEWALK + 0.45 : 2.4);
      if (shift > 0.5) {
        const lx = pfx + fx * shift, lz = pfz + fz * shift, gap = r2 < 0.3 ? 1.6 : 0.8; // driveway or path
        addFenceRun(lx - rx * W2, lz - rz * W2, lx - rx * gap, lz - rz * gap, type);
        addFenceRun(lx + rx * gap, lz + rz * gap, lx + rx * W2, lz + rz * W2, type);
        front = hz + shift;
      }
    }
    const side = type === 'picket' || type === 'brick' ? (r3 < 0.5 ? 'privacy' : 'hedge') : type === 'rail' && fst.key === 'farm' ? 'rail' : type;
    if (style === 1) continue; // KayKit lots: front only
    const back = hz + 4;
    for (const sg of [-1, 1]) addFenceRun(cx + rx * W2 * sg + fx * front, cz + rz * W2 * sg + fz * front, cx + rx * W2 * sg - fx * back, cz + rz * W2 * sg - fz * back, side);
    addFenceRun(cx - rx * W2 - fx * back, cz - rz * W2 - fz * back, cx + rx * W2 - fx * back, cz + rz * W2 - fz * back, side);
    // garden planting: shrubs beside the house, sometimes a small tree behind it
    if (style === 2) {
      const nb = Math.floor(RF() * 3);
      for (let k = 0; k < nb; k++) {
        const sg = RF() < 0.5 ? -1 : 1, t = RF() * 2 - 1;
        const x = cx + rx * (hx + 0.9) * sg - fx * hz * t, z = cz + rz * (hx + 0.9) * sg - fz * hz * t;
        if (okForProp(x, z, SIDEWALK + 1)) addTree(x, z, 'bush', rr(0.6, 1.0));
      }
      if (RF() < 0.35) {
        const k = (RF() - 0.5) * hx;
        const x = cx - fx * (hz + 2.2) + rx * k, z = cz - fz * (hz + 2.2) + rz * k;
        if (okForProp(x, z, 6)) addTree(x, z, 'round', rr(0.6, 0.85));
      }
    }
  }
  // countryside: post-and-rail fences, dry stone walls and hedgerows along stretches of rural
  // roads through open grassland, with field boundaries running away from the road
  for (const road of roads) {
    if (road.kind !== 'rural') continue;
    const a = road.nodes[0], z = road.nodes[road.nodes.length - 1];
    const L = road.segs.reduce((t, s) => t + s.len, 0);
    for (const side of [1, -1]) {
      let d = 0, acc = RF() * 120;
      for (const s of road.segs) {
        const d0 = d;
        d += s.len;
        if (s.bridge) continue;
        if ((a.edges.length >= 3 && d0 < 25) || (z.edges.length >= 3 && d > L - 25)) continue;
        const mx = (s.a.x + s.b.x) / 2, mz = (s.a.z + s.b.z) / 2;
        if (biomeAt(mx, mz) !== BIOMES.GRASS || urbanAt(mx, mz) > 0.03) continue;
        const n = noise2(mx * 0.0022 + side * 37.1, mz * 0.0022);
        if (n < 0.08) continue;
        const kind = n > 0.5 ? 'hedge' : noise2(mx * 0.0009 + 5, mz * 0.0009) > 0.15 ? 'stone' : 'rail';
        const off = s.w / 2 + 3.2;
        const nx = -s.dz * side, nz = s.dx * side;
        addFenceRun(s.a.x + nx * off, s.a.z + nz * off, s.b.x + nx * off, s.b.z + nz * off, kind, 2.0, 2.5);
        acc += s.len;
        if (acc > 150 && n > 0.15) {
          acc = 0;
          const fl = 50 + RF() * 90;
          addFenceRun(s.b.x + nx * (off + 0.6), s.b.z + nz * (off + 0.6), s.b.x + nx * (off + fl), s.b.z + nz * (off + fl), kind, 2.0, 2.5);
        }
      }
    }
  }
}

// ---------------------------------------------------------------- beaches
// Town beaches get umbrellas with loungers and the odd lifeguard hut, facing the sea.
// {type: 'umbrella'|'lounger'|'hut', x, y, z, rot, c}
export const beachProps = [];
function genBeach() {
  const RB = mulberry32(9090);
  const huts = [];
  for (let x = -HALF + 40; x < HALF - 40; x += 20)
    for (let z = -HALF + 40; z < HALF - 40; z += 20) {
      const jx = x + (RB() - 0.5) * 14, jz = z + (RB() - 0.5) * 14;
      const roll = RB();
      const h = terrainHeight(jx, jz);
      if (h < 1.0 || h > 2.6) continue;
      const u = urbanAt(jx, jz);
      if (u < 0.03 || u > 0.75) continue;
      let sx = 0, sz = 0, n = 0;
      for (let k = 0; k < 12; k++) {
        const c = Math.cos((k / 12) * Math.PI * 2), sn = Math.sin((k / 12) * Math.PI * 2);
        if (terrainHeight(jx + c * 28, jz + sn * 28) < -0.3) { sx += c; sz += sn; n++; }
      }
      if (n < 1 || n > 6) continue;
      if (Math.abs(terrainHeight(jx + 3, jz) - terrainHeight(jx - 3, jz)) + Math.abs(terrainHeight(jx, jz + 3) - terrainHeight(jx, jz - 3)) > 1.6) continue;
      if (inAirfield(jx, jz, 40) || !okForProp(jx, jz, 7)) continue;
      const sl = Math.hypot(sx, sz) || 1;
      sx /= sl; sz /= sl;
      const rot = Math.atan2(sx, sz); // +z of the prop faces the sea
      if (roll < 0.05 && !huts.some((p) => Math.hypot(p.x - jx, p.z - jz) < 350)) {
        const hx = jx - sx * 4, hz = jz - sz * 4;
        if (!okForProp(hx, hz, 7)) continue;
        const y = terrainHeight(hx, hz);
        beachProps.push({ type: 'hut', x: hx, y, z: hz, rot });
        huts.push({ x: hx, z: hz });
        const c = Math.cos(rot), s = Math.sin(rot);
        // the cabin stands on stilts: a box above head height plus four thin legs
        regCollider({ t: 0, kind: 'hut', thin: true, cx: hx, cz: hz, hx: 1.6, hz: 1.6, rot, c, s, x0: hx - 2.3, x1: hx + 2.3, z0: hz - 2.3, z1: hz + 2.3, y0: y + 2.2, y1: y + 5.2 }, hx - 2.3, hx + 2.3, hz - 2.3, hz + 2.3);
        for (const [lx, lz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) {
          const px = hx + lx * c + lz * s, pz = hz - lx * s + lz * c;
          regCollider({ t: 1, x: px, z: pz, r: 0.12, y0: y - 1, y1: y + 2.4 }, px - 1, px + 1, pz - 1, pz + 1);
        }
        continue;
      }
      if (roll > 0.42) continue;
      const y = terrainHeight(jx, jz);
      const col = Math.floor(RB() * 5);
      beachProps.push({ type: 'umbrella', x: jx, y, z: jz, rot, c: col });
      regCollider({ t: 1, x: jx, z: jz, r: 0.1, y0: y - 1, y1: y + 2.4 }, jx - 1, jx + 1, jz - 1, jz + 1);
      const px = -sz, pz = sx; // along the beach
      for (const sg of [-1, 1]) {
        if (RB() < 0.2) continue;
        const lx = jx + px * 1.15 * sg + sx * 0.6, lz = jz + pz * 1.15 * sg + sz * 0.6;
        beachProps.push({ type: 'lounger', x: lx, y: terrainHeight(lx, lz), z: lz, rot: rot + (RB() - 0.5) * 0.3, c: col });
      }
    }
}

// ---------------------------------------------------------------- district dressing and landmarks
// Runs last, with its own RNG, so nothing that uses the shared world RNG moves. Everything here
// that you can bump into registers a collider shaped like what world.js / dressing.js draw.
// LANDMARKS: big one-off structures dressing.js builds by type (shape numbers live here).
export const LANDMARKS = [];
// any carriageway edge within r of (x,z)
function roadWithin(x, z, r) {
  const i0 = Math.floor((x - r) / SG), i1 = Math.floor((x + r) / SG), j0 = Math.floor((z - r) / SG), j1 = Math.floor((z + r) / SG);
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      const l = segGrid.get(gk(i, j));
      if (l) for (const s of l) { proj(s, x, z); if (RP.d - s.w / 2 - (s.sidewalk ? SIDEWALK : 0) < r) return true; }
    }
  return false;
}
// near a junction (where crossings and turning cars are): keep kerbside trees away
let jGrid = null;
function onCrossing(x, z) {
  if (!jGrid) {
    jGrid = new Map();
    for (const n of junctions) { const k = gk(Math.floor(n.x / 40), Math.floor(n.z / 40)); if (!jGrid.has(k)) jGrid.set(k, []); jGrid.get(k).push(n); }
  }
  const i0 = Math.floor((x - 20) / 40), i1 = Math.floor((x + 20) / 40), j0 = Math.floor((z - 20) / 40), j1 = Math.floor((z + 20) / 40);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const l = jGrid.get(gk(i, j));
    if (l) for (const n of l) if (Math.hypot(n.x - x, n.z - z) < 20) return true;
  }
  return false;
}
// no collider (oriented boxes exactly, posts/trunks as circles) within r of (x,z)
function clearOf(x, z, r) {
  const i0 = Math.floor((x - r) / BG), i1 = Math.floor((x + r) / BG), j0 = Math.floor((z - r) / BG), j1 = Math.floor((z + r) / BG);
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++) {
      const l = bGrid.get(gk(i, j));
      if (l) for (const o of l) {
        if (o.t === 0) {
          const dx = x - o.cx, dz = z - o.cz;
          if (Math.abs(dx * o.c - dz * o.s) < o.hx + r && Math.abs(dx * o.s + dz * o.c) < o.hz + r) return false;
        } else if (Math.hypot(x - o.x, z - o.z) < o.r + r) return false;
      }
    }
  return true;
}
const flatAt = (x, z, r) => {
  const h = [terrainHeight(x - r, z - r), terrainHeight(x + r, z - r), terrainHeight(x - r, z + r), terrainHeight(x + r, z + r), terrainHeight(x, z)];
  return Math.max(...h) - Math.min(...h);
};
// thin box collider (not walkable, not a sight-line blocker) at centre/half sizes/rot
function solidBox(cx, cz, hx, hz, rot, y0, y1, thin = false) {
  const c = Math.cos(rot), sn = Math.sin(rot);
  const ex = Math.abs(c) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(c) * hz;
  const o = { t: 0, thin, kind: 'prop', cx, cz, hx, hz, rot, c, s: sn, x0: cx - ex, x1: cx + ex, z0: cz - ez, z1: cz + ez, y0, y1 };
  regCollider(o, o.x0, o.x1, o.z0, o.z1);
  return o;
}
const post = (x, z, r, y0, y1) => regCollider({ t: 1, x, z, r, y0, y1 }, x - r - 1, x + r + 1, z - r - 1, z + r + 1);
// direction (unit) from (x,z) towards open sea within `far` m, or null
function seaDir(x, z, near, far) {
  let best = null;
  for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
    let ok = true;
    for (let d = near; d <= far; d += 10) if (terrainHeight(x + dx * d, z + dz * d) > -1.2) { ok = false; break; }
    if (ok) { best = best || { x: 0, z: 0, n: 0 }; best.x += dx; best.z += dz; best.n++; }
  }
  if (!best) return null;
  const L = Math.hypot(best.x, best.z) || 1;
  return { x: best.x / L, z: best.z / L, n: best.n };
}
const styleKeyAt = (x, z) => STYLES[styleAt(x, z)].key;
// grid scan over cells of one style: cb(x, z) for points of that style
function scanStyle(key, step, cb, R) {
  const id = STYLE[key];
  for (let x = -HALF + step; x < HALF - step; x += step)
    for (let z = -HALF + step; z < HALF - step; z += step) {
      const jx = x + (R() - 0.5) * step * 0.6, jz = z + (R() - 0.5) * step * 0.6;
      if (styleAt(jx, jz) !== id) continue;
      if (cb(jx, jz) === false) return;
    }
}

const CONTAINER_COLS = [0xb33a2a, 0x2f5f9e, 0x2f7d4a, 0xd9a02a, 0x7a7f86, 0xc75a1e, 0x1f6f7a, 0xe0e0dc, 0x5b3a7a];
function genDressing() {
  const RD = mulberry32(5150);
  const rp = (a) => a[Math.floor(RD() * a.length)];

  // ---- boulevard planting: palm rows on the main roads of palm districts, leafy rows on the
  // streets of the suburbs and old-money quarters, pines in the alpine village
  const ROWS = { palm: { main: 24 }, round: { city: 44 }, pine: { city: 50 } };
  const leafy = new Set(['suburb', 'lakeside', 'alpine']);
  for (const road of roads) {
    if (road.kind === 'rural') continue;
    let acc = RD() * 10;
    for (const s of road.segs) {
      if (!s.sidewalk || s.bridge) continue;
      for (let t = acc; t < s.len; t += 4) {
        const x0 = s.a.x + s.dx * t, z0 = s.a.z + s.dz * t;
        const st = styleOf(x0, z0);
        const sp = ROWS[st.tree] && ROWS[st.tree][road.kind];
        if (!sp || (st.tree !== 'palm' && !leafy.has(st.key))) continue;
        t += sp - 4;
        for (const side of [1, -1]) {
          const off = s.w / 2 + 0.75;
          const x = x0 - s.dz * off * side, z = z0 + s.dx * off * side;
          const nr = nearestRoad(x, z);
          if (!nr || nr.d < 0.6 || !clearOf(x, z, 1.6) || onCrossing(x, z)) continue;
          addTree(x, z, st.tree, st.tree === 'palm' ? 1.0 + RD() * 0.35 : st.tree === 'pine' ? 0.7 + RD() * 0.2 : 0.8 + RD() * 0.25);
        }
      }
      acc = 0;
    }
  }

  // ---- billboards beside main roads (Westwood strip, Downtown, Eastgate)
  for (const road of roads) {
    if (road.kind === 'rural') continue;
    let acc = RD() * 200;
    for (const s of road.segs) {
      acc += s.len;
      if (acc < 220 || s.bridge) continue;
      const mx = (s.a.x + s.b.x) / 2, mz = (s.a.z + s.b.z) / 2;
      const st = styleOf(mx, mz);
      if (!st.billboards || (road.kind !== 'main' && st.key !== 'strip') || RD() > 0.45 * st.billboards) continue;
      const side = RD() < 0.5 ? 1 : -1;
      const off = s.w / 2 + (s.sidewalk ? SIDEWALK : 0) + 3.2;
      const nx = -s.dz * side, nz = s.dx * side;
      const x = mx + nx * off, z = mz + nz * off;
      if (terrainHeight(x, z) < 1.5 || inAirfield(x, z, 20) || !clearOf(x, z, 6.5)) continue;
      // both posts must stay off every road
      let bad = false;
      for (const sg of [-1, 1]) if (roadWithin(x + s.dx * 4 * sg, z + s.dz * 4 * sg, 1.2)) bad = true;
      if (bad) continue;
      acc = 0;
      const y = terrainHeight(x, z) - 0.3;
      const ry = Math.atan2(-nx, -nz); // panel (+z) faces the road
      for (const sg of [-1, 1]) {
        const px = x + s.dx * 4 * sg, pz = z + s.dz * 4 * sg;
        kitAdd('cyl', px, y + 4.9, pz, 0.45, 9.8, 0.45, 0, 0x4a4d50);
        post(px, pz, 0.3, y - 1, y + 9.8);
      }
      kitAdd('box', x, y + 10.2, z, 12.6, 5.4, 0.4, ry, 0x2c2e30);
      kitAdd('bill', x - nx * 0.22, y + 10.2, z - nz * 0.22, 12, 4.9, 1, ry, 0xffffff, { ad: Math.floor(RD() * 8) });
    }
  }

  // ---- shipping containers on the quays (Port Vale, Old Harbour)
  let nCont = 0;
  for (const key of ['port', 'harbour']) {
    scanStyle(key, 14, (x, z) => {
      if (nCont > 1100) return false;
      const h = terrainHeight(x, z);
      if (h < 1.6 || h > 9 || flatAt(x, z, 7) > 1.2 || RD() < 0.2) return;
      const sea = seaDir(x, z, 50, 90);
      if (!sea || roadWithin(x, z, 6) || inAirfield(x, z, 30) || !clearOf(x, z, 3)) return;
      // long side along the shore, snapped to 15 degrees so neighbouring stacks line up
      const ry = Math.round(Math.atan2(sea.x, sea.z) / (Math.PI / 12)) * (Math.PI / 12);
      const c = Math.cos(ry), sn = Math.sin(ry);
      // the whole 12.2 x 5.2 stack footprint has to be clear
      for (const [u, v] of [[-6, -2.6], [6, -2.6], [-6, 2.6], [6, 2.6]]) if (!clearOf(x + u * c + v * sn, z - u * sn + v * c, 0.6)) return;
      const n = 1 + Math.floor(RD() * (key === 'port' ? 3 : 2));
      for (const v of [-1.3, 1.3]) {
        const m = v < 0 ? n : Math.max(1, n - Math.floor(RD() * 2));
        for (let k = 0; k < m; k++) {
          kitAdd('container', x + v * sn, h - 0.1 + 1.3 + k * 2.6, z + v * c, 12.2, 2.6, 2.5, ry, rp(CONTAINER_COLS));
          nCont++;
        }
      }
      solidBox(x, z, 6.1, 2.6, ry, h - 0.6, h - 0.1 + n * 2.6);
    }, RD);
  }

  // ---- ship-to-shore gantry cranes (Port Vale) and older dock cranes (Old Harbour)
  for (const [key, max, scale, col] of [['port', 5, 1, 0xc8452a], ['harbour', 2, 0.72, 0x3e5a4a]]) {
    const cands = [];
    scanStyle(key, 18, (x, z) => {
      const h = terrainHeight(x, z);
      if (h < 1.5 || h > 7) return;
      const sea = seaDir(x, z, 22 * scale, 70 * scale);
      if (!sea || sea.n < 2) return;
      cands.push({ x, z, h, sea, score: sea.n + RD() * 2 });
    }, RD);
    cands.sort((a, b) => b.score - a.score);
    const placed = [];
    for (const c of cands) {
      if (placed.length >= max) break;
      if (placed.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < 95 * scale)) continue;
      const rot = Math.atan2(c.sea.x, c.sea.z); // local +z towards the sea
      const lx = 9 * scale, lz = 8 * scale;
      const legs = [[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]].map(([u, v]) => [c.x + u * Math.cos(rot) + v * Math.sin(rot), c.z - u * Math.sin(rot) + v * Math.cos(rot)]);
      if (!legs.every(([x, z]) => clearOf(x, z, 1.5) && !roadWithin(x, z, 1) && terrainHeight(x, z) > 0.8)) continue;
      placed.push(c);
      const H = 38 * scale;
      for (const [x, z] of legs) post(x, z, 0.9 * scale, c.h - 1, c.h + H);
      LANDMARKS.push({ type: 'crane', x: c.x, y: Math.min(...legs.map(([x, z]) => terrainHeight(x, z))), z: c.z, rot, scale, color: col, legs, H });
    }
  }

  // ---- dumpsters down the sides of blocks in the gritty districts
  for (const b of buildings) {
    if (b.kind !== 'block' || b.blank === 3) continue;
    const st = styleOf(b.cx, b.cz);
    if (!st.dumpsters || RD() > st.dumpsters * 0.35) continue;
    const sg = (b.blank & 1) ? 1 : (b.blank & 2) ? -1 : RD() < 0.5 ? -1 : 1;
    const [x, z] = bLocal(b, sg * (b.hx + 1.1), b.hz * 0.1);
    if (!clearOf(x, z, 1.0) || roadWithin(x, z, 0.4)) continue;
    const y = terrainHeight(x, z);
    props.push({ file: 'kk_dumpster', x, y, z, rot: b.rot + Math.PI / 2 * sg, h: 1.35, col: 0.9 });
    post(x, z, 0.9, y - 1, y + 1.4);
  }

  // ---- mailboxes at the kerb in front of suburban houses
  for (const b of buildings) {
    if (b.kind !== 'house') continue;
    const k = styleKeyAt(b.cx, b.cz);
    if (k !== 'suburb' && k !== 'farm' && k !== 'beachtown') continue;
    if (k !== 'suburb' && RD() > 0.4) continue;
    const u = b.hx * 0.55 * (RD() < 0.5 ? -1 : 1);
    let spot = null;
    for (let v = b.hz + 0.8; v < b.hz + 14; v += 0.5) {
      const [x, z] = bLocal(b, u, v);
      if (roadWithin(x, z, 0.5)) { spot = v - 0.4; break; }
    }
    if (spot === null || spot < b.hz + 1.2) continue;
    const [x, z] = bLocal(b, u, spot);
    if (!clearOf(x, z, 0.4)) continue;
    const y = groundHeight(x, z, terrainHeight(x, z) + 1);
    kitAdd('box', x, y + 0.55, z, 0.09, 1.1, 0.09, b.rot, 0x5a4a3a);
    kitAdd('box', x, y + 1.18, z, 0.26, 0.26, 0.5, b.rot, rp([0x2a2d30, 0x2a4a7a, 0xb03030, 0xe8e8e0]));
    post(x, z, 0.18, y - 0.5, y + 1.35);
  }

  // ---- desert trailers, set back from the roads
  let nTr = 0;
  scanStyle('desert', 26, (x, z) => {
    if (nTr > 140) return false;
    if (RD() > 0.4 || terrainHeight(x, z) < 2 || flatAt(x, z, 6) > 1.5) return;
    if (roadWithin(x, z, 5) || !roadWithin(x, z, 45) || !clearOf(x, z, 7) || inAirfield(x, z, 30)) return;
    const ry = RD() * Math.PI;
    const y = terrainHeight(x, z);
    const col = rp([0xf2efe6, 0xe8dcc0, 0xd8e4e8, 0xc9d6c0, 0xe6e2d6]);
    kitAdd('box', x, y + 1.75, z, 10, 2.7, 2.6, ry, col, { trailer: 1 });
    kitAdd('box', x + Math.sin(ry) * 1.31, y + 1.6, z + Math.cos(ry) * 1.31, 9.6, 0.35, 0.03, ry, rp([0x2a7a7a, 0xb04a2a, 0x3a5a9a, 0x8a6a2a]));
    kitAdd('box', x - Math.sin(ry) * 1.31, y + 1.6, z - Math.cos(ry) * 1.31, 9.6, 0.35, 0.03, ry, 0x6a6a6a);
    solidBox(x, z, 5, 1.3, ry, y - 0.5, y + 3.1);
    nTr++;
  }, RD);

  // ---- farm belt: red barns and silos behind farmhouses
  for (const b of buildings.slice()) {
    if (b.kind !== 'house' || styleKeyAt(b.cx, b.cz) !== 'farm' || RD() > 0.35) continue;
    const [x, z] = bLocal(b, (RD() - 0.5) * 6, -(b.hz + 14));
    const rot = b.rot + Math.PI / 2;
    if (flatAt(x, z, 9) > 2.5 || roadWithin(x, z, 10) || !clearOf(x, z, 10) || terrainHeight(x, z) < 2) continue;
    const barn = addBox(x, z, 6, 8.5, rot, 6.5, rp([0x9a2f24, 0x8a2a22, 0xa8442e]), 'barn');
    facade(barn, FAC.SHED, GF.GARAGE);
    barn.roof = rp([0x5a5650, 0x4a4e54, 0x8a8e90]);
    barn.roofType = 'gable';
    barn.pitch = 0.75;
    const [sx, sz] = bLocal(barn, barn.hx + 3.4, 0);
    if (clearOf(sx, sz, 2.8)) {
      const y = terrainHeight(sx, sz) - 0.3;
      kitAdd('cyl', sx, y + 7.5, sz, 5, 15, 5, 0, 0xc8ccd0, { far: 1 });
      kitAdd('sphere', sx, y + 15, sz, 5, 3.2, 5, 0, 0x9aa0a6, { far: 1 });
      post(sx, sz, 2.55, y - 1, y + 16.5);
    }
  }

  // ---- water towers with the town name (Northside, Red Dust Flats)
  const nearFree = (x0, z0, r, maxR = 900) => {
    for (let rad = 0; rad < maxR; rad += 12)
      for (let a = 0; a < Math.PI * 2; a += Math.max(0.15, 12 / (rad + 1))) {
        const x = x0 + Math.cos(a) * rad, z = z0 + Math.sin(a) * rad;
        if (terrainHeight(x, z) > 2 && flatAt(x, z, r) < 3 && !roadWithin(x, z, 3) && clearOf(x, z, r) && !inAirfield(x, z, 40)) return { x, z };
      }
    return null;
  };
  const district = (name) => DISTRICTS.find((d) => d.name === name) || REGIONS.find((d) => d.name === name);
  for (const [name, text, col, band] of [['Northside', 'NORTHSIDE', 0xdfe6ea, '#1f4f8a'], ['Red Dust Flats', 'RED DUST', 0xc9b8a0, '#8a3a1a']]) {
    const d = district(name);
    const p = d && nearFree(d.x, d.z, 8);
    if (!p) continue;
    const y = terrainHeight(p.x, p.z) - 0.3;
    LANDMARKS.push({ type: 'watertower', x: p.x, y, z: p.z, text, color: col, band, legH: 22, r: 5.5, tankH: 7 });
    for (const [u, v] of [[-3.6, -3.6], [3.6, -3.6], [-3.6, 3.6], [3.6, 3.6]]) post(p.x + u, p.z + v, 0.4, y - 1, y + 22);
    regCollider({ t: 1, x: p.x, z: p.z, r: 5.6, y0: y + 21.5, y1: y + 31 }, p.x - 7, p.x + 7, p.z - 7, p.z + 7);
  }

  // ---- lighthouse at the far tip of North Isle
  {
    const d = district('North Isle');
    let best = null;
    if (d) scanStyle('fishing', 15, (x, z) => {
      const h = terrainHeight(x, z);
      if (h < 2.5 || h > 30 || flatAt(x, z, 4) > 3) return;
      const sea = seaDir(x, z, 25, 60);
      if (!sea || roadWithin(x, z, 4) || !clearOf(x, z, 5)) return;
      const sc = Math.hypot(x - d.x, z - d.z) + sea.n * 15;
      if (!best || sc > best.sc) best = { x, z, h, sc };
    }, RD);
    if (best) {
      LANDMARKS.push({ type: 'lighthouse', x: best.x, y: best.h - 0.3, z: best.z, H: 30 });
      post(best.x, best.z, 3.6, best.h - 1, best.h + 36);
    }
  }

  // ---- Coral Bay pier with a ferris wheel
  {
    const d = district('Coral Bay');
    let best = null;
    if (d) scanStyle('deco', 12, (x, z) => {
      const h = terrainHeight(x, z);
      if (h < 0.8 || h > 2.8) return;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
        let ok = terrainHeight(x - dx * 25, z - dz * 25) > 1.2;
        for (let t = 30; t <= 200 && ok; t += 10) {
          if (terrainHeight(x + dx * t, z + dz * t) > -1.5) ok = false;
          // keep the end platform clear of other land
          if (t > 150) for (const sg of [-1, 1]) if (terrainHeight(x + dx * t - dz * 18 * sg, z + dz * t + dx * 18 * sg) > -1.5) ok = false;
        }
        if (!ok || roadWithin(x, z, 2) || roadWithin(x + dx * 100, z + dz * 100, 30)) continue;
        const sc = -Math.hypot(x - d.x, z - d.z) + RD() * 50;
        if (!best || sc > best.sc) best = { x, z, dx, dz, sc };
      }
    }, RD);
    if (best) {
      const { dx, dz } = best;
      const rot = Math.atan2(dx, dz); // local +z out to sea
      const deckY = 2.9, L = 170, W = 12;
      const x0 = best.x - dx * 6, z0 = best.z - dz * 6; // starts on the sand
      clearArea(x0 + dx * L / 2, z0 + dz * L / 2, W / 2 + 1, L / 2, rot);
      const deck = addBox(x0 + dx * L / 2, z0 + dz * L / 2, W / 2, L / 2, rot, deckY + 8, 0x8a6a4a, 'pier', null, -8);
      deck.hidden = true;
      deck.fac = FAC.PLAIN;
      // the end platform the wheel stands on
      const pc = { x: x0 + dx * (L + 18), z: z0 + dz * (L + 18) };
      const plat = addBox(pc.x, pc.z, 17, 20, rot, deckY + 8, 0x8a6a4a, 'pier', null, -8);
      plat.hidden = true;
      plat.fac = FAC.PLAIN;
      // railings both sides (thin: you bump into them, they are not floors)
      for (const sg of [-1, 1]) {
        const ox = Math.cos(rot) * (W / 2 - 0.1) * sg, oz = -Math.sin(rot) * (W / 2 - 0.1) * sg;
        solidBox(x0 + dx * L / 2 + ox, z0 + dz * L / 2 + oz, 0.08, L / 2 - 1, rot, deckY - 0.2, deckY + 1.1, true);
        const px = Math.cos(rot) * 16.9 * sg, pz = -Math.sin(rot) * 16.9 * sg;
        solidBox(pc.x + px, pc.z + pz, 0.08, 20, rot, deckY - 0.2, deckY + 1.1, true);
      }
      solidBox(pc.x + dx * 19.9, pc.z + dz * 19.9, 17, 0.08, rot, deckY - 0.2, deckY + 1.1, true);
      // ferris wheel: axle across the platform, A-frame legs at both ends
      const wc = { x: pc.x + dx * 4, z: pc.z + dz * 4 };
      const R = 19, axleY = deckY + R + 3.5;
      const feet = [];
      for (const a of [-1, 1]) for (const b of [-1, 1]) feet.push([wc.x + dx * 3.2 * a + Math.cos(rot) * 9 * b, wc.z + dz * 3.2 * a - Math.sin(rot) * 9 * b]);
      for (const [x, z] of feet) post(x, z, 0.6, deckY - 0.5, deckY + 8);
      LANDMARKS.push({ type: 'pier', x: x0, z: z0, dx, dz, rot, L, W, deckY, pc, wc, R, axleY });
    }
  }

  // ---- PINEWOOD sign on the hillside, facing Downtown
  {
    const reg = district('Pinewood Hills'), dt = district('Downtown');
    // the highest clear spot on the hills with an open, falling view towards Downtown
    let p = null, tx = 0, tz = 0;
    if (reg && dt) for (let x = reg.x - reg.r; x < reg.x + reg.r; x += 20)
      for (let z = reg.z - reg.r; z < reg.z + reg.r; z += 20) {
        if (Math.hypot(x - reg.x, z - reg.z) > reg.r) continue;
        const h = terrainHeight(x, z);
        if (p && h <= p.h) continue;
        let fx = dt.x - x, fz = dt.z - z;
        const fl = Math.hypot(fx, fz);
        fx /= fl; fz /= fl;
        let open = true;
        for (let d = 25; d <= 700 && open; d += 25) if (terrainHeight(x + fx * d, z + fz * d) > h - 2 - d * 0.04) open = false;
        if (!open || flatAt(x, z, 20) > 18 || roadWithin(x, z, 25) || !clearOf(x, z, 55)) continue;
        p = { x, z, h };
        tx = fx; tz = fz;
      }
    if (p) {
      const rot = Math.atan2(tx, tz); // letters face Downtown (+z local)
      const text = 'PINEWOOD', cell = 3.0, depth = 0.9;
      const ax = Math.cos(rot), az = -Math.sin(rot); // along the sign
      const span = text.length * 6 * cell;
      const letters = [];
      for (let i = 0; i < text.length; i++) {
        const gl = FONT5x7[text[i]];
        const lu = -span / 2 + i * 6 * cell + 2.5 * cell;
        const lx = p.x + ax * lu, lz = p.z + az * lu;
        const base = Math.min(terrainHeight(lx - ax * 3, lz - az * 3), terrainHeight(lx + ax * 3, lz + az * 3), terrainHeight(lx, lz)) - 0.8;
        for (let row = 0; row < 7; row++) {
          const bits = gl[row];
          for (let c0 = 0; c0 < 5; c0++) {
            if (bits[c0] !== '1' || (c0 > 0 && bits[c0 - 1] === '1')) continue;
            let c1 = c0;
            while (c1 + 1 < 5 && bits[c1 + 1] === '1') c1++;
            const u = lu + ((c0 + c1) / 2 - 2) * cell, y = base + (6 - row) * cell + cell / 2 + 0.8;
            const x = p.x + ax * u, z = p.z + az * u;
            const wv = (c1 - c0 + 1) * cell;
            kitAdd('box', x, y, z, wv, cell, depth, rot, 0xf4f4f0, { far: 1, glow: 0.35 }); // a little self-lit so it reads white in any light, floodlit at night
            solidBox(x, z, wv / 2, depth / 2, rot, y - cell / 2, y + cell / 2, true);
          }
        }
        letters.push({ x: lx, z: lz, base });
      }
      // a few spot lights on the ground in front light it at night
      LANDMARKS.push({ type: 'hillsign', x: p.x, z: p.z, rot, letters });
    }
  }

  // ---- chairlift from the foothill village to the top of Mt. Ember
  {
    const reg = district('Mt. Ember');
    let top = null;
    if (reg) for (let x = reg.x - reg.r; x < reg.x + reg.r; x += 30)
      for (let z = reg.z - reg.r; z < reg.z + reg.r; z += 30) {
        const h = terrainHeight(x, z);
        if (!top || h > top.h) top = { x, z, h };
      }
    let base = null;
    // the village end: the nearest built-up, low-lying alpine ground at least 700 m from the top
    if (top) scanStyle('alpine', 30, (x, z) => {
      const h = terrainHeight(x, z);
      if (urbanAt(x, z) < 0.3 || h < 3 || h > 80) return;
      const d = Math.hypot(x - top.x, z - top.z);
      if (d > 700 && (!base || d < base.d)) base = { x, z, d };
    }, RD);
    if (top && base) {
      // walk back towards the village from the summit until clear ground for the stations
      const tx = (top.x - base.x) / base.d, tz = (top.z - base.z) / base.d;
      let b0 = null;
      for (let k = 0; k < 40 && !b0; k++) {
        const x = base.x + tx * k * 15, z = base.z + tz * k * 15;
        if (flatAt(x, z, 7) < 4 && !roadWithin(x, z, 4) && clearOf(x, z, 8)) b0 = { x, z };
      }
      let t0 = null;
      for (let k = 2; k < 30 && !t0; k++) {
        const x = top.x - tx * k * 10, z = top.z - tz * k * 10;
        if (flatAt(x, z, 6) < 8 && clearOf(x, z, 7)) t0 = { x, z };
      }
      if (b0 && t0) {
        const rot = Math.atan2(tx, tz);
        for (const s of [b0, t0]) {
          const st = addBox(s.x, s.z, 5, 6.5, rot, 6, 0x5a3d28, 'station');
          facade(st, FAC.CHALET, GF.GARAGE);
          st.roof = 0x3a3f45; st.roofType = 'gable'; st.pitch = 0.7;
        }
        const L = Math.hypot(t0.x - b0.x, t0.z - b0.z);
        const n = Math.max(2, Math.round(L / 110));
        const pylons = [];
        for (let k = 0; k <= n; k++) {
          const x = b0.x + (t0.x - b0.x) * k / n, z = b0.z + (t0.z - b0.z) * k / n;
          const g = terrainHeight(x, z);
          const end = k === 0 || k === n;
          const hgt = end ? 10 : 17;
          const yb = end ? (k === 0 ? g + 0 : g) : g - 0.5;
          if (!end && !clearOf(x, z, 1.2)) continue;
          pylons.push({ x, z, y: yb, h: hgt, end });
          if (!end) post(x, z, 0.8, yb - 1, yb + hgt);
        }
        LANDMARKS.push({ type: 'chairlift', rot, pylons });
      }
    }
  }

  // ---- Crimson Tower: the downtown tower nearest the core becomes the island's tallest
  {
    const core = W.downtowns && W.downtowns[0];
    let best = null;
    if (core) for (const b of buildings) {
      if (b.kind !== 'tower' || b.hx < 8 || b.hz < 8) continue;
      const d = Math.hypot(b.cx - core[0], b.cz - core[1]);
      if (d < 500 && (!best || d < best.d)) best = { b, d };
    }
    if (best) {
      const b = best.b;
      if (b.kids) for (const k of b.kids) removeBuilding(k);
      b.kids = [];
      b.fac = FAC.GLASS;
      b.color = 0x3c5a6e;
      b.y1 = b.y0 + 5 + 40 * 3.9 + 0.6 + (b.y1 - b.y0 > 170 ? 0 : 0);
      // two set-back crowns, then a spire with a red beacon
      let top = b.y1;
      for (const [k, hh] of [[0.72, 7 * 3.9 + 0.6], [0.48, 4 * 3.9 + 0.6]]) {
        const t = addBox(b.cx, b.cz, b.hx * k, b.hz * k, b.rot, hh, 0x3c5a6e, 'tower', null, top);
        facade(t, FAC.GLASS, GF.HOME);
        t.gy = top;
        b.kids.push(t);
        top += hh;
      }
      kitAdd('cyl', b.cx, top + 22, b.cz, 1.6, 44, 1.6, 0, 0xb8c0c8, { far: 1 });
      kitAdd('sphere', b.cx, top + 44.5, b.cz, 1.6, 1.6, 1.6, 0, 0xff2020, { far: 1, glow: 1, beacon: 1 });
      signs.push({ text: 'CRIMSON', x: b.cx + Math.sin(b.rot) * (b.hz * 0.48 + 0.12), y: top - 6, z: b.cz + Math.cos(b.rot) * (b.hz * 0.48 + 0.12), rot: b.rot, w: b.hx * 0.9, h: b.hx * 0.22, bg: null, fg: '#ff5a4a', glow: 1 });
    }
  }

  // ---- Southport mission bell tower
  {
    const c = W.downtowns && W.downtowns[2];
    const p = c && nearFree(c[0], c[1], 6, 400);
    if (p) {
      const bt = addBox(p.x, p.z, 3.4, 3.4, RD() * Math.PI, 24, 0xf5efe3, 'belltower');
      facade(bt, FAC.MISSION, GF.HOME);
      bt.roof = 0xb5562f; bt.roofType = 'hip'; bt.pitch = 1.1;
      // belfry: dark arched openings on the top storey are drawn as a band of boxes
      for (const [u, v] of [[0, 3.42], [0, -3.42], [3.42, 0], [-3.42, 0]]) {
        const [x, z] = bLocal(bt, u, v);
        kitAdd('box', x, bt.y1 - 3.2, z, u ? 0.05 : 2.2, 3.2, u ? 2.2 : 0.05, bt.rot, 0x2a2420);
      }
    }
  }

  // ---- Westwood googie pylon sign
  {
    const d = district('Westwood');
    let spot = null;
    if (d) for (const s of segs) {
      if (s.kind !== 'main' || s.bridge || styleKeyAt(s.a.x, s.a.z) !== 'strip') continue;
      const off = s.w / 2 + (s.sidewalk ? SIDEWALK : 0) + 2.2;
      const x = s.a.x - s.dz * off, z = s.a.z + s.dx * off;
      const dd = Math.hypot(x - d.x, z - d.z);
      if (spot && dd > spot.dd) continue;
      if (roadWithin(x, z, 1) || !clearOf(x, z, 3)) continue;
      spot = { x, z, dd, rot: Math.atan2(s.dx, s.dz) };
    }
    if (spot) {
      const y = terrainHeight(spot.x, spot.z) - 0.3;
      kitAdd('box', spot.x, y + 11, spot.z, 0.9, 22, 0.9, spot.rot, 0xd8d0c0, { far: 1 });
      kitAdd('box', spot.x, y + 15, spot.z, 0.35, 5.5, 11, spot.rot, 0x2aa37a, { far: 1 });
      for (let k = 0; k < 6; k++) kitAdd('box', spot.x, y + 23, spot.z, 0.2, 6.5, 0.45, spot.rot, 0xffd23a, { far: 1, glow: 1, rx: (k / 6) * Math.PI });
      kitAdd('sphere', spot.x, y + 23, spot.z, 1.6, 1.6, 1.6, 0, 0xff6a2a, { far: 1, glow: 1 });
      for (const sg of [-1, 1]) signs.push({ text: 'WESTWOOD', x: spot.x + Math.cos(spot.rot) * 0.2 * sg, y: y + 15, z: spot.z - Math.sin(spot.rot) * 0.2 * sg, rot: spot.rot + Math.PI / 2 * sg, w: 10.4, h: 2.6, bg: '#2aa37a', fg: '#fff6d8', glow: 1 });
      post(spot.x, spot.z, 0.6, y - 1, y + 22);
    }
  }

  // ---- big neon sign on an Eastgate rooftop
  {
    const c = W.downtowns && W.downtowns[1];
    let best = null;
    if (c) for (const b of buildings) {
      if (b.kind !== 'block' || b.roof || b.hx < 6 || b.y1 - b.y0 < 14 || styleKeyAt(b.cx, b.cz) !== 'eastgate') continue;
      const d = Math.hypot(b.cx - c[0], b.cz - c[1]);
      if (!best || d < best.d) best = { b, d };
    }
    if (best) {
      const b = best.b;
      const [x, z] = bLocal(b, 0, b.hz - 1.2);
      const w = Math.min(26, b.hx * 1.8);
      for (const u of [-w / 2 + 1, w / 2 - 1]) {
        const [px, pz] = bLocal(b, u, b.hz - 1.4);
        kitAdd('box', px, b.y1 + 2.5, pz, 0.3, 5, 0.3, b.rot, 0x333333);
      }
      signs.push({ text: 'EASTGATE', x, y: b.y1 + 5.2, z, rot: b.rot, w, h: w * 0.2, bg: '#14001e', fg: '#ff3fa4', glow: 1 });
      b.roofBill = 0;
    }
  }

  // ---- rooftop billboards (Eastgate)
  for (const b of buildings) {
    if (!b.roofBill || b.roof) continue;
    const [x, z] = bLocal(b, 0, b.hz * 0.3);
    const w = Math.min(12, b.hx * 1.6);
    for (const u of [-w / 2 + 0.6, w / 2 - 0.6]) {
      const [px, pz] = bLocal(b, u, b.hz * 0.3 - 0.3);
      kitAdd('box', px, b.y1 + 1.5, pz, 0.25, 3, 0.25, b.rot, 0x3a3a3a);
    }
    kitAdd('bill', x, b.y1 + 3 + w * 0.21, z, w, w * 0.42, 1, b.rot, 0xffffff, { ad: b.roofBill - 1 });
  }
}

// 5x7 pixel font for the hillside letters
const FONT5x7 = {
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  N: ['10001', '11001', '10101', '10101', '10011', '10001', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
};

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

// Limit road grades. Some bridge decks end in a 50 % drop to the road (17.6 m to 10 m in
// 15 m), which no car drives smoothly. Raise the lower side into a <= MAX_GRADE ramp that
// meets the deck (raising, never lowering, so decks keep clear of what's underneath), by at
// most MAX_RAISE m. Junction nodes are shared, so repeat until neighbours agree.
const MAX_GRADE = 0.12, MAX_RAISE = 8;
function limitRoadGrades() {
  const h0 = new Map(nodes.map((n) => [n, n.h]));
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const road of roads) {
      const L = road.nodes, S = road.segs;
      if (S.length !== L.length - 1) continue;
      for (const dir of [1, -1]) {
        const i0 = dir > 0 ? 1 : L.length - 2, i1 = dir > 0 ? L.length : -1;
        for (let i = i0; i !== i1; i += dir) {
          const n = L[i], prev = L[i - dir], len = S[dir > 0 ? i - 1 : i].len;
          const need = prev.h - MAX_GRADE * len;
          if (n.h < need) {
            const cap = h0.get(n) + MAX_RAISE;
            const nh = Math.min(need, cap);
            if (nh > n.h + 1e-3) { n.h = nh; changed = true; }
          }
        }
      }
    }
    if (!changed) break;
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
        if (!c) claim.set(o, { edge, roadH, sw: s.sidewalk, surfH: edge <= 0.4 ? roadH : undefined });
        else {
          if (edge < c.edge) { c.edge = edge; c.roadH = roadH; c.sw = s.sidewalk; }
          if (edge <= 0.4 && (c.surfH === undefined || roadH < c.surfH)) c.surfH = roadH;
        }
      }
  }
  for (const [o, c] of claim) {
    const k = c.edge <= SHOULDER ? 0 : sstep(0, band, c.edge - SHOULDER);
    // behind a raised pavement the verge sits level with it, not 0.45 m below its back edge
    const base = c.sw && c.edge > 0.4 ? c.roadH + CURB - 0.05 : c.roadH - floor;
    let allowed = base + (H[o] - base) * k;
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
// boxMax: highest building/plinth top that counts as ground (default maxY + 1 m, a person's
// step); vehicles pass a much lower one so planters and low walls are walls, not ramps.
export function groundHeight(x, z, maxY = Infinity, boxMax = maxY + 1.0) {
  const lim = maxY + 1.6;
  // road-first: where a road (or pavement) covers this point, the road surface IS the
  // ground — the 15 m terrain grid is imperfectly carved under the roads' own height
  // profile and used to poke up through it (the "bumpy / jumping car" bug). Terrain is
  // only the fallback when no road qualifies, e.g. under a bridge whose deck is above
  // maxY: roadAt filters it out and returns null there.
  const r = roadAt(x, z, lim);
  let h = r !== null ? r : terrainHeight(x, z);
  if (r === null) {
    const vh = vergeAt(x, z, lim);
    if (vh !== null && vh > h) h = vh;
  }
  const ah = airportHeight(x, z);
  if (ah !== null && ah > h && ah <= lim) h = ah;
  const l = bGrid.get(gk(Math.floor(x / BG), Math.floor(z / BG)));
  if (l)
    for (const o of l)
      if (o.t === 0 && !o.thin && x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1 && o.y1 <= boxMax && o.y1 > h && inBox(o, x, z)) h = o.y1;
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
    if (l) for (const o of l) if (o.t === 0 && !o.thin && x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1 && y < o.y1 && y > o.y0 && inBox(o, x, z)) return t;
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
  limitRoadGrades();
  carveRoadShoulders();
  regSegs();
  buildStyleGrid();
  genAirports();
  shapeShores();
  genBuildings();
  genLandmarks();
  genStreets();
  genNature();
  // landmarks and airport buildings get a facade from their kind
  const KIND_FAC = { police: [FAC.CIVIC, GF.LOBBY], hospital: [FAC.HOSPITAL, GF.LOBBY], hangar: [FAC.SHED, GF.GARAGE], mid: [FAC.SHED, GF.GARAGE], tower: [FAC.OFFICE, GF.LOBBY] };
  for (const b of buildings) if (b.fac === undefined) facade(b, ...(b.kind === 'mid' && b.hx > 20 ? [FAC.GLASS, GF.LOBBY] : KIND_FAC[b.kind] || [FAC.PLASTER, GF.HOME]));
  genFences();
  genBeach();
  genDressing(); // district props and landmarks: own RNG, after everything that uses the shared one
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
