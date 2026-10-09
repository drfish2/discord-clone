// World data: heightfield, road network, city layout, colliders and ground queries.
// No rendering here; world.js turns this data into meshes.
import { clamp, lerp, sstep, WATER } from './core.js';
import { fbm, ridged, noise2, mulberry32 } from './noise.js';

export const HALF = 3000; // map spans -3000..3000 on x and z (6 km x 6 km)
export const TS = 10; // terrain grid spacing (m)
export const TN = 600; // terrain cells per side
export const CITY_H = 3;
export const SLAB_TOP = 3.15;
export const CL = [];
for (let i = 0; i <= 16; i++) CL.push(-800 + i * 100);
export const ROAD_W = 14;
export const HWY_W = 16;
export const RIVER_COL = 4;

export const AIRPORT = { x0: 1000, x1: 2400, z0: -350, z1: 350, runwayZ: -120, runwayX0: 1150, runwayX1: 2300, runwayW: 50 };
export const TOWNS = [
  { name: 'Sandy Rock', x: 2100, z: 2100, r: 170, n: 14, style: 'desert' },
  { name: 'Coral Beach', x: -650, z: 2380, r: 170, n: 16, style: 'beach' },
  { name: 'Mirror Lake Camp', x: -2450, z: 350, r: 120, n: 7, style: 'cabin' },
  { name: 'Mt. Ember Observatory', x: 300, z: -2450, r: 90, n: 0, style: 'obs' },
];
export const LAKE = { x: -1950, z: 700, r: 180 };
export const RIVER = [
  [-150, -3150], [-300, -2500], [-520, -1900], [-480, -1350], [-350, -950], [-350, -800],
  [-350, 850], [-380, 1100], [-250, 1700], [-80, 2300], [0, 3150],
];
export const GANGS = [
  { id: 'kingz', name: 'Purple Kingz', color: 0x7b3fc4, css: '#9b5de5', bi0: 0, bi1: 3, bj0: 1, bj1: 4 },
  { id: 'vipers', name: 'Red Vipers', color: 0xc62828, css: '#e53935', bi0: 12, bi1: 15, bj0: 11, bj1: 14 },
];
for (const g of GANGS) {
  g.x0 = CL[g.bi0]; g.x1 = CL[g.bi1 + 1]; g.z0 = CL[g.bj0]; g.z1 = CL[g.bj1 + 1];
  g.cx = (g.x0 + g.x1) / 2; g.cz = (g.z0 + g.z1) / 2;
}

const R = mulberry32(4242);
const rr = (a, b) => a + R() * (b - a);

// ---------------------------------------------------------------- heights
export function desertF(x, z) {
  return sstep(900, 1500, x) * sstep(700, 1300, z);
}
export function mountainF(z) {
  return sstep(-900, -1900, z);
}
export function forestF(x) {
  return sstep(-1000, -1700, x);
}
function rectDist(x, z, x0, x1, z0, z1) {
  const dx = Math.max(x0 - x, 0, x - x1);
  const dz = Math.max(z0 - z, 0, z - z1);
  return Math.hypot(dx, dz);
}

// ---------------------------------------------------------------- island shape
function segDistRaw(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}
// 1 on land, 0 at sea: a domain-warped, noisy "squircle" island with bays,
// kept solid under the highways and towns so every road reaches dry land.
export function islandMask(x, z) {
  const wx = x + fbm(x * 0.0005 + 11.3, z * 0.0005 - 4.1, 3) * 650;
  const wz = z + fbm(x * 0.0005 - 7.7, z * 0.0005 + 9.2, 3) * 650;
  const d = Math.pow(Math.pow(Math.abs(wx), 3.2) + Math.pow(Math.abs(wz), 3.2), 1 / 3.2);
  const edge = 2450 + fbm(wx * 0.0011 + 2.0, wz * 0.0011 + 5.0, 5) * 620;
  let land = 1 - sstep(edge - 260, edge + 80, d);
  if (land >= 1) return 1;
  let keep = 0;
  for (const hw of HIGHWAYS) {
    const P = hw.pts;
    for (let i = 0; i < P.length - 1; i++) {
      const dd = segDistRaw(x, z, P[i][0], P[i][1], P[i + 1][0], P[i + 1][1]);
      if (dd < 300) keep = Math.max(keep, 1 - sstep(70, 300, dd));
    }
  }
  for (const t of TOWNS) keep = Math.max(keep, 1 - sstep(t.r + 20, t.r + 200, Math.hypot(x - t.x, z - t.z)));
  land = Math.max(land, keep * 0.95);
  // scattered islets offshore
  const isl = sstep(0.36, 0.5, fbm(x * 0.0022 + 3.3, z * 0.0022 + 8.1, 4)) * sstep(edge + 120, edge + 380, d) * (1 - sstep(2750, 2950, Math.max(Math.abs(x), Math.abs(z))));
  return Math.max(land, isl * 0.9);
}

function rawHeight(x, z) {
  // gentle hills with domain-warped ridges for a more natural relief
  const qx = x + fbm(x * 0.0009 + 1.7, z * 0.0009 + 8.3, 3) * 280, qz = z + fbm(x * 0.0009 - 5.1, z * 0.0009 + 2.9, 3) * 280;
  let h = 15 + fbm(qx * 0.0011 + 3.1, qz * 0.0011 - 1.7, 5) * 30;
  h += Math.pow(ridged(qx * 0.0016 + 9.1, qz * 0.0016 - 3.3, 4), 2) * 38 - 8;
  h += noise2(x * 0.01, z * 0.01) * 1.5;
  const mN = mountainF(z);
  if (mN > 0) h += mN * (40 + ridged(x * 0.0009 + 5.3, z * 0.0009, 5) * 430);
  const fW = forestF(x);
  if (fW > 0) h += fW * (fbm(x * 0.003, z * 0.003, 3) * 20 + 8);
  const dS = desertF(x, z);
  if (dS > 0) {
    const dunes = Math.pow(1 - Math.abs(noise2(x * 0.0035, z * 0.006)), 2) * 12 + fbm(x * 0.002, z * 0.002, 3) * 10;
    h = lerp(h, 9 + dunes, dS);
  }
  return h;
}
for (const t of TOWNS) t.h = Math.max(rawHeight(t.x, t.z), 5);

export function baseHeight(x, z) {
  let h = rawHeight(x, z);
  for (const t of TOWNS) {
    const d = Math.hypot(x - t.x, z - t.z);
    if (d < t.r + 120) h = lerp(t.h, h, sstep(t.r, t.r + 120, d));
  }
  const ce = Math.max(Math.abs(x), Math.abs(z));
  h = lerp(2.9, h, sstep(830, 1050, ce));
  const ad = rectDist(x, z, AIRPORT.x0, AIRPORT.x1, AIRPORT.z0, AIRPORT.z1);
  h = lerp(2.9, h, sstep(0, 160, ad));
  // sea floor beyond the island's coastline; land ramps down into beaches
  const land = islandMask(x, z);
  const seabed = -26 + fbm(x * 0.002, z * 0.002, 3) * 6;
  h = land >= 0.999 ? h : lerp(seabed, Math.max(h, 1.5) * sstep(0.35, 1, land) + 1.2 * (land > 0.35 ? 1 : land / 0.35), sstep(0.15, 0.6, land));
  return h;
}

function segDist(x, z, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = ((x - ax) * dx + (z - az) * dz) / l2;
  t = clamp(t, 0, 1);
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}
export function riverDist(x, z) {
  let d = Infinity;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const a = RIVER[i], b = RIVER[i + 1];
    const dd = segDist(x, z, a[0], a[1], b[0], b[1]);
    if (dd < d) d = dd;
  }
  return d;
}
function carve(x, z, h) {
  const d = riverDist(x, z);
  const hw = 28;
  if (d < hw) h = Math.min(h, -7);
  else {
    const e = d - hw;
    h = Math.min(h, -7 + e * 0.9 + e * e * 0.004);
  }
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
  const e2 = Math.max(0, dl - LAKE.r);
  h = Math.min(h, -6 + e2 * 0.35 + e2 * e2 * 0.004);
  return h;
}

// ---------------------------------------------------------------- roads
export const nodes = [];
export const segs = [];
const nodeMap = new Map();
const nkey = (x, z) => Math.round(x) + ',' + Math.round(z);
function addNode(x, z, h) {
  const k = nkey(x, z);
  let n = nodeMap.get(k);
  if (!n) {
    n = { id: nodes.length, x, z, h, edges: [] };
    nodes.push(n);
    nodeMap.set(k, n);
  }
  return n;
}
function link(a, b, w, kind, name) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 0.5) return;
  const s = { id: segs.length, a, b, w, kind, name, len, dx: dx / len, dz: dz / len, bridge: false };
  segs.push(s);
  a.edges.push({ n: b, s });
  b.edges.push({ n: a, s });
}

export const HIGHWAYS = [
  { name: 'Airport Hwy', pts: [[800, 0], [1050, 170], [1500, 200], [2300, 200]] },
  { name: 'Desert Rd', pts: [[800, 800], [1150, 1150], [1600, 1650], [2100, 2100], [2500, 2450]] },
  { name: 'Pine Rd', pts: [[-800, -200], [-1200, -260], [-1700, -150], [-2200, -50], [-2450, 350], [-2300, 800]] },
  { name: 'Mountain Pass', pts: [[0, -800], [80, -1200], [-100, -1600], [200, -1900], [0, -2200], [300, -2450]] },
  { name: 'Coast Rd', pts: [[0, 800], [-100, 1300], [-450, 1900], [-650, 2350]] },
  { name: 'Ridge Rd', pts: [[-2200, -50], [-1800, -900], [-1000, -1500], [-100, -1600]] },
  { name: 'Canyon Rd', pts: [[2100, 2100], [2350, 1300], [2100, 600], [1500, 200]] },
];

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function buildRoads() {
  // city grid
  for (let i = 0; i <= 16; i++) for (let j = 0; j <= 16; j++) addNode(CL[i], CL[j], CITY_H);
  for (let i = 0; i <= 16; i++)
    for (let j = 0; j <= 16; j++) {
      const n = nodeMap.get(nkey(CL[i], CL[j]));
      if (i < 16) link(n, nodeMap.get(nkey(CL[i + 1], CL[j])), ROAD_W, 'city', 'street');
      if (j < 16) link(n, nodeMap.get(nkey(CL[i], CL[j + 1])), ROAD_W, 'city', 'street');
    }
  // highways
  for (const hw of HIGHWAYS) {
    const P = hw.pts;
    const pts = [];
    for (let k = 0; k < P.length - 1; k++) {
      const p0 = P[Math.max(0, k - 1)], p1 = P[k], p2 = P[k + 1], p3 = P[Math.min(P.length - 1, k + 2)];
      const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 35));
      for (let s = k === 0 ? 0 : 1; s <= n; s++) {
        const t = s / n;
        pts.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)]);
      }
    }
    // height profile: terrain-following but smoothed
    let hs = pts.map(([x, z]) => Math.max(baseHeight(x, z), CITY_H));
    for (let pass = 0; pass < 6; pass++) {
      const o = hs.slice();
      for (let i = 0; i < hs.length; i++) {
        let s = 0, c = 0;
        for (let k = -5; k <= 5; k++) {
          const j = clamp(i + k, 0, hs.length - 1);
          s += o[j];
          c++;
        }
        hs[i] = s / c;
      }
    }
    // pin ends to existing nodes
    const n0 = nodeMap.get(nkey(pts[0][0], pts[0][1]));
    const n1 = nodeMap.get(nkey(pts[pts.length - 1][0], pts[pts.length - 1][1]));
    const d0 = n0 ? n0.h - hs[0] : 0;
    const d1 = n1 ? n1.h - hs[hs.length - 1] : 0;
    hs = hs.map((h, i) => h + lerp(d0, d1, i / (hs.length - 1)));
    // keep within the city flat
    hs = hs.map((h, i) => {
      const ce = Math.max(Math.abs(pts[i][0]), Math.abs(pts[i][1]));
      return lerp(CITY_H, h, sstep(820, 1000, ce));
    });
    let prev = null;
    hw.nodes = [];
    for (let i = 0; i < pts.length; i++) {
      const n = addNode(pts[i][0], pts[i][1], hs[i]);
      hw.nodes.push(n);
      if (prev) link(prev, n, HWY_W, 'hwy', hw.name);
      prev = n;
    }
  }
}

const SG = 64;
const segGrid = new Map();
const gk = (i, j) => (i + 200) * 1000 + (j + 200);
function regSegs() {
  for (const s of segs) {
    const m = s.w / 2 + (s.kind === 'hwy' ? 100 : 40);
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
// nearest road: returns {d,h,s} or null (within 40m search margin)
const NR = { d: 0, h: 0, s: null };
export function nearestRoad(x, z) {
  const l = segGrid.get(gk(Math.floor(x / SG), Math.floor(z / SG)));
  if (!l) return null;
  let bd = Infinity, bh = 0, bs = null;
  for (const s of l) {
    proj(s, x, z);
    const d = RP.d - s.w / 2;
    if (d < bd) { bd = d; bh = RP.h; bs = s; }
  }
  if (!bs) return null;
  NR.d = bd; NR.h = bh; NR.s = bs;
  return NR;
}
// road surface height if (x,z) is on a road, else null
export function roadAt(x, z, maxY = Infinity) {
  const l = segGrid.get(gk(Math.floor(x / SG), Math.floor(z / SG)));
  if (!l) return null;
  let h = null;
  for (const s of l) {
    proj(s, x, z);
    if (RP.d < s.w / 2 + 0.3 && RP.h <= maxY && (h === null || RP.h > h)) h = RP.h;
  }
  return h;
}

// ---------------------------------------------------------------- terrain grid
export const H = new Float32Array((TN + 1) * (TN + 1));
function genTerrain() {
  for (let j = 0; j <= TN; j++) {
    const z = -HALF + j * TS;
    for (let i = 0; i <= TN; i++) {
      const x = -HALF + i * TS;
      let h = baseHeight(x, z);
      const r = nearestRoad(x, z);
      if (r) {
        // flatten under the road; wider, gentler banks where the road cuts deep
        const inner = 3;
        const blend = Math.min(95, 25 + Math.abs(h - r.h) * 1.3);
        if (r.d < inner) h = r.h - 0.25;
        else if (r.d < inner + blend) h = lerp(r.h - 0.25, h, sstep(inner, inner + blend, r.d));
      }
      const ce = Math.max(Math.abs(x), Math.abs(z));
      if (ce < 815) h = Math.min(h, 2.8);
      h = carve(x, z, h);
      H[j * (TN + 1) + i] = h;
    }
  }
  // mark bridges
  for (const s of segs) {
    const n = Math.max(1, Math.ceil(s.len / 8));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const x = lerp(s.a.x, s.b.x, t), z = lerp(s.a.z, s.b.z, t);
      if (lerp(s.a.h, s.b.h, t) - terrainHeight(x, z) > 2.2) { s.bridge = true; break; }
    }
  }
}

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

// ---------------------------------------------------------------- city blocks
export const blockType = []; // [bi][bj]
export function blockRect(bi, bj) {
  return { x0: CL[bi] + 7, x1: CL[bi + 1] - 7, z0: CL[bj] + 7, z1: CL[bj + 1] - 7 };
}
export function blockAt(x, z) {
  if (x <= -793 || x >= 793 || z <= -793 || z >= 793) return null;
  const bi = Math.floor((x + 800) / 100), bj = Math.floor((z + 800) / 100);
  const lx = x - CL[bi], lz = z - CL[bj];
  if (lx < 7 || lx > 93 || lz < 7 || lz > 93) return null;
  return blockType[bi][bj] === 'river' ? null : BA.set(bi, bj);
}
const BA = { bi: 0, bj: 0, set(i, j) { this.bi = i; this.bj = j; return this; } };
export function slabTop(x, z) {
  return blockAt(x, z) ? SLAB_TOP : null;
}
export function gangAt(x, z) {
  for (const g of GANGS) if (x > g.x0 && x < g.x1 && z > g.z0 && z < g.z1) return g;
  return null;
}

export const SPECIAL = {};
function blockCenter(bi, bj) {
  return { x: CL[bi] + 50, z: CL[bj] + 50 };
}

// ---------------------------------------------------------------- objects & colliders
export const buildings = []; // {t:0,x0,x1,z0,z1,y0,y1,color,roof,kind}
export const trees = []; // {x,y,z,s,type}
export const lamps = []; // {x,z,y,rot}
export const ramps = []; // {x,z,rot,w,len,h,base}
export const decor = []; // misc static boxes {x,y,z,sx,sy,sz,rot,color}
export const signs = []; // {text,x,y,z,rot,w,h,bg,fg}
export const zonesDecal = [];
export const props = []; // instanced street furniture {file,x,z,y,rot,h}
// KayKit City Builder buildings (no base): footprint width (x), depth (z), height, in model units
export const KK = {
  A: [1.2, 1.45, 1.55], B: [1.6, 1.3, 1.55], C: [1.2, 1.3, 2.25], D: [1.6, 1.3, 2.25],
  E: [2.0, 1.45, 2.25], F: [2.0, 1.3, 2.25], G: [2.0, 1.45, 2.25], H: [2.0, 1.3, 2.95],
};
const KK_LOW = ['A', 'B', 'C', 'D', 'E', 'F'];
const KK_ALL = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
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
export function addBuilding(x0, x1, z0, z1, h, color, kind = 'tower', roof = null, y0) {
  if (y0 === undefined) {
    const g = [terrainHeight(x0, z0), terrainHeight(x1, z0), terrainHeight(x0, z1), terrainHeight(x1, z1)];
    const blk = blockAt((x0 + x1) / 2, (z0 + z1) / 2);
    y0 = blk ? SLAB_TOP - 0.05 : Math.min(...g) - 0.5;
    h += blk ? 0 : Math.max(...g) - Math.min(...g) + 0.5;
  }
  const b = { t: 0, x0, x1, z0, z1, y0, y1: y0 + h, color, roof, kind };
  buildings.push(b);
  regCollider(b, x0, x1, z0, z1);
  return b;
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
  gang: [0x8a8178, 0x9b8f80, 0x7d756d, 0xa39a8c, 0x6f6a64],
  desert: [0xd9a873, 0xe0b98a, 0xc99467, 0xe8cfa6],
  beach: [0xffffff, 0x9ed8e8, 0xffd6a5, 0xf7a1a1, 0xb8e0b0],
  cabin: [0x7a5233, 0x8b5e3c, 0x6b4a2e],
};
const ROOFS = [0x8b3a2b, 0x5a5a5a, 0x3e4d5c, 0x7a4b2a, 0x2f4f3a];

function genCity() {
  for (let bi = 0; bi < 16; bi++) {
    blockType[bi] = [];
    for (let bj = 0; bj < 16; bj++) {
      const c = blockCenter(bi, bj);
      const d = Math.max(Math.abs(c.x), Math.abs(c.z));
      let t = d < 300 ? 'down' : d < 560 ? 'mid' : 'res';
      if (R() < 0.06 && t !== 'down') t = 'park';
      for (const g of GANGS) if (bi >= g.bi0 && bi <= g.bi1 && bj >= g.bj0 && bj <= g.bj1) t = 'gang_' + g.id;
      if (bi === RIVER_COL) t = 'river';
      blockType[bi][bj] = t;
    }
  }
  const set = (bi, bj, t) => (blockType[bi][bj] = t);
  set(10, 2, 'park'); set(11, 2, 'park'); set(10, 3, 'park'); set(11, 3, 'park');
  set(8, 7, 'plaza');
  set(9, 5, 'police');
  set(6, 10, 'hospital');
  set(13, 8, 'spray');
  set(14, 7, 'mid'); // keep spray block neighbour normal

  for (let bi = 0; bi < 16; bi++)
    for (let bj = 0; bj < 16; bj++) {
      const t = blockType[bi][bj];
      if (t === 'river') continue;
      const r = blockRect(bi, bj);
      const ix0 = r.x0 + 3, ix1 = r.x1 - 3, iz0 = r.z0 + 3, iz1 = r.z1 - 3; // building area (80x80)
      const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      if (t === 'down') {
        for (let a = 0; a < 2; a++)
          for (let b = 0; b < 2; b++) {
            const lx0 = ix0 + a * 41, lz0 = iz0 + b * 41;
            const w = rr(24, 37), dd = rr(24, 37);
            const x0 = lx0 + rr(0, 39 - w), z0 = lz0 + rr(0, 39 - dd);
            const dc = Math.max(Math.abs(cx), Math.abs(cz));
            const h = 35 + R() * R() * 170 * (1 - dc / 380) + R() * 20;
            addBuilding(x0, x0 + w, z0, z0 + dd, h, PALETTE.down[Math.floor(R() * PALETTE.down.length)], 'tower');
          }
      } else if (t === 'mid' || t.startsWith('gang_') || t === 'res') {
        // KayKit buildings on a lot grid, fronts facing the nearest street
        const mid = t === 'mid';
        const n = 3;
        const cell = 80 / n;
        for (let a = 0; a < n; a++)
          for (let b = 0; b < n; b++) {
            if (a === 1 && b === 1) continue; // back yard
            if (!mid && R() < 0.12) continue;
            const lcx = ix0 + (a + 0.5) * cell, lcz = iz0 + (b + 0.5) * cell;
            const kind = mid ? KK_ALL[2 + Math.floor(R() * 6)] : KK_LOW[Math.floor(R() * 6)];
            const [kw, kd, kh] = KK[kind];
            // face the closest block edge
            const dW = lcx - r.x0, dE = r.x1 - lcx, dN = lcz - r.z0, dS = r.z1 - lcz;
            const m = Math.min(dW, dE, dN, dS);
            const rot = m === dS ? 0 : m === dN ? Math.PI : m === dE ? Math.PI / 2 : -Math.PI / 2;
            const side = rot === Math.PI / 2 || rot === -Math.PI / 2;
            const maxS = (cell - 2) / Math.max(kw, kd);
            const sc = Math.min(maxS, mid ? rr(10, 12.5) : rr(7.5, 10.5));
            const wx = (side ? kd : kw) * sc, wz = (side ? kw : kd) * sc;
            // push toward the street so facades line up
            const push = (side ? cell - wx : cell - wz) / 2 - 1;
            const fx = Math.round(Math.sin(rot)), fz = Math.round(Math.cos(rot));
            const cx2 = lcx + fx * push, cz2 = lcz + fz * push;
            const bld = addBuilding(cx2 - wx / 2, cx2 + wx / 2, cz2 - wz / 2, cz2 + wz / 2, kh * sc, 0x9a8f80, 'kk');
            bld.kk = kind;
            bld.rot = rot;
            bld.scale = sc;
          }
        if (!mid) for (let k = 0; k < 3; k++) addTree(lerp(ix0, ix1, 0.42 + R() * 0.16), lerp(iz0, iz1, 0.42 + R() * 0.16), 'round', rr(0.8, 1.2));
        props.push({ file: 'kk_dumpster', x: lerp(ix0, ix1, 0.5), z: lerp(iz0, iz1, 0.5) + 6, rot: R() * 6.28, h: 1.6 });
      } else if (t === 'park') {
        for (let k = 0; k < 22; k++) addTree(rr(ix0, ix1), rr(iz0, iz1), 'round', rr(0.9, 1.5));
      } else if (t === 'plaza') {
        decor.push({ x: cx, y: SLAB_TOP + 0.4, z: cz, sx: 14, sy: 0.8, sz: 14, rot: 0, color: 0xb9b2a5 });
        decor.push({ x: cx, y: SLAB_TOP + 0.85, z: cz, sx: 12.5, sy: 0.15, sz: 12.5, rot: 0, color: 0x3d8fb5, emissive: true });
        decor.push({ x: cx, y: SLAB_TOP + 3, z: cz, sx: 1.4, sy: 5, sz: 1.4, rot: 0, color: 0xd8d0c0 });
        regCollider({ t: 0, x0: cx - 7, x1: cx + 7, z0: cz - 7, z1: cz + 7, y0: 0, y1: SLAB_TOP + 0.8 }, cx - 7, cx + 7, cz - 7, cz + 7);
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          addTree(cx + Math.cos(a) * 30, cz + Math.sin(a) * 30, 'round', 1.1);
        }
      } else if (t === 'police') {
        addBuilding(ix0 + 5, ix0 + 65, iz0 + 2, iz0 + 40, 14, 0x3b5578, 'police');
        SPECIAL.police = { x: cx, z: r.z1 + 2, spawnX: ix0 + 35, spawnZ: iz0 + 60, h: Math.PI };
        signs.push({ text: 'POLICE', x: ix0 + 35, y: SLAB_TOP + 10, z: iz0 + 40.3, rot: 0, w: 20, h: 4, bg: '#12305e', fg: '#ffffff' });
      } else if (t === 'hospital') {
        addBuilding(ix0 + 5, ix0 + 75, iz0 + 30, iz0 + 78, 30, 0xf2f2f2, 'hospital');
        SPECIAL.hospital = { x: cx, z: iz0 + 15, spawnX: cx, spawnZ: iz0 + 15 };
        signs.push({ text: '+ HOSPITAL', x: cx, y: SLAB_TOP + 22, z: iz0 + 29.7, rot: Math.PI, w: 26, h: 5, bg: '#ffffff', fg: '#d32f2f' });
      } else if (t === 'spray') {
        addBuilding(ix0 + 40, ix0 + 80, iz0, iz0 + 80, 9, 0x44515e, 'mid');
        SPECIAL.spray = { x0: ix0 + 4, x1: ix0 + 36, z0: iz0 + 25, z1: iz0 + 55, x: ix0 + 20, z: iz0 + 40 };
        signs.push({ text: "PAY 'N' SPRAY", x: ix0 + 39.7, y: SLAB_TOP + 6.5, z: iz0 + 40, rot: -Math.PI / 2, w: 22, h: 3.5, bg: '#ffb300', fg: '#1a1a1a' });
      }
      // street lamps along every block edge, arms reaching over the road
      for (const f of [0.2, 0.5, 0.8]) {
        lamps.push({ x: lerp(r.x0, r.x1, f), z: r.z0 + 0.7, dir: Math.PI });
        lamps.push({ x: lerp(r.x0, r.x1, f), z: r.z1 - 0.7, dir: 0 });
        lamps.push({ x: r.x0 + 0.7, z: lerp(r.z0, r.z1, f), dir: -Math.PI / 2 });
        lamps.push({ x: r.x1 - 0.7, z: lerp(r.z0, r.z1, f), dir: Math.PI / 2 });
      }
      // a hydrant and a couple of benches per block
      props.push({ file: 'kk_firehydrant', x: lerp(r.x0, r.x1, 0.35), z: r.z0 + 1.0, rot: 0, h: 0.9, col: 0.3 });
      if (t === 'park' || t === 'plaza' || R() < 0.3) props.push({ file: 'kk_bench', x: lerp(r.x0, r.x1, 0.65), z: r.z1 - 1.2, rot: Math.PI, h: 0.9 });
      if (R() < 0.5) props.push({ file: 'kk_trash_A', x: r.x1 - 1.1, z: lerp(r.z0, r.z1, 0.3), rot: 0, h: 0.9 });
    }
  // traffic lights on two corners of each intersection
  for (let i = 1; i < 16; i++)
    for (let j = 1; j < 16; j++) {
      const x = CL[i], z = CL[j];
      for (const [sx, sz] of [[1, 1], [-1, -1]]) {
        const px = x + sx * 8.2, pz = z + sz * 8.2;
        if (!blockAt(px, pz)) continue;
        props.push({ file: 'kk_trafficlight_A', x: px, z: pz, rot: Math.atan2(-sx, -sz), h: 5.2, col: 0.25 });
      }
    }
  for (const l of lamps) regCollider({ t: 1, x: l.x, z: l.z, r: 0.25, y0: 0, y1: SLAB_TOP + 7 }, l.x - 1, l.x + 1, l.z - 1, l.z + 1);
  for (const p of props) {
    p.y = SLAB_TOP;
    if (p.col) regCollider({ t: 1, x: p.x, z: p.z, r: p.col, y0: 0, y1: SLAB_TOP + p.h }, p.x - 1, p.x + 1, p.z - 1, p.z + 1);
  }
  // avenue trees along a few streets
  for (const xi of [2, 6, 10, 14]) {
    const x = CL[xi];
    for (let z = -790; z < 790; z += 18) {
      if (blockAt(x - 9.5, z)) addTree(x - 9.5, z, 'round', 0.9);
      if (blockAt(x + 9.5, z)) addTree(x + 9.5, z, 'round', 0.9);
    }
  }
}

function okForProp(x, z, clear = 8) {
  const r = nearestRoad(x, z);
  if (r && r.d < clear) return false;
  return true;
}

function genOutside() {
  // airport
  const A = AIRPORT;
  addBuilding(1300, 1620, 255, 330, 18, 0xd7dde3, 'mid');
  addBuilding(1680, 1700, 275, 295, 42, 0xc0c8d0, 'tower');
  for (let k = 0; k < 3; k++) addBuilding(1950 + k * 110, 2040 + k * 110, 240, 330, 17, 0x8e9aa6, 'hangar');
  signs.push({ text: 'CRIMSON INTL AIRPORT', x: 1460, y: 3 + 15, z: 254.6, rot: Math.PI, w: 46, h: 4, bg: '#1d2b3a', fg: '#ffffff' });
  SPECIAL.airport = { x: 1400, z: 110 };
  ramps.push({ x: 1150, z: 120, rot: Math.PI / 2, w: 8, len: 22, h: 6 });

  // towns
  for (const t of TOWNS) {
    const pal = PALETTE[t.style] || PALETTE.res;
    let placed = 0, tries = 0;
    while (placed < t.n && tries++ < 400) {
      const a = R() * Math.PI * 2, d = rr(20, t.r);
      const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
      const w = t.style === 'cabin' ? rr(7, 10) : rr(9, 18), dd = t.style === 'cabin' ? rr(6, 9) : rr(9, 16);
      if (!okForProp(x, z, Math.max(w, dd) / 2 + 6)) continue;
      if (terrainHeight(x, z) < 1.5) continue;
      let clash = false;
      for (const b of buildings) if (x + w / 2 + 4 > b.x0 && x - w / 2 - 4 < b.x1 && z + dd / 2 + 4 > b.z0 && z - dd / 2 - 4 < b.z1) { clash = true; break; }
      if (clash) continue;
      const h = t.style === 'desert' ? rr(4, 7) : rr(4.5, 7.5);
      addBuilding(x - w / 2, x + w / 2, z - dd / 2, z + dd / 2, h, pal[Math.floor(R() * pal.length)], 'house', t.style === 'desert' ? null : ROOFS[Math.floor(R() * ROOFS.length)]);
      placed++;
    }
    if (t.style === 'beach' || t.style === 'desert') {
      for (let k = 0; k < (t.style === 'beach' ? 40 : 14); k++) {
        const a = R() * Math.PI * 2, d = rr(10, t.r + 60);
        const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
        if (okForProp(x, z, 6) && terrainHeight(x, z) > 1.2 && !buildings.some((b) => x > b.x0 - 2 && x < b.x1 + 2 && z > b.z0 - 2 && z < b.z1 + 2)) addTree(x, z, 'palm', rr(0.8, 1.3));
      }
    }
    if (t.style === 'obs') {
      addBuilding(t.x + 20, t.x + 50, t.z - 15, t.z + 15, 10, 0xe8e8e8, 'obs');
      const b = buildings[buildings.length - 1];
      decor.push({ dome: true, x: t.x + 35, y: b.y1, z: t.z, r: 11, color: 0xf5f5f5 });
    }
  }
  // gas station in Sandy Rock
  decor.push({ x: 2160, y: TOWNS[0].h + 5, z: 2040, sx: 22, sy: 0.6, sz: 12, rot: 0, color: 0xe53935 });
  for (const ox of [-8, 8]) decor.push({ x: 2160 + ox, y: TOWNS[0].h + 2.4, z: 2040, sx: 0.6, sy: 5, sz: 0.6, rot: 0, color: 0xdddddd });

  // big hillside letters north of the city
  signs.push({ text: 'CRIMSON COAST', x: 60, y: 0, z: -1180, rot: 0, w: 220, h: 34, bg: null, fg: '#ffffff', hill: true });

  // desert ramps
  const rp = [[1750, 1450, 0.6], [2300, 1750, 2.0], [1550, 2250, -0.5], [2550, 1950, 1.2], [1950, 2600, 0.2], [-200, -1100, 3.0]];
  for (const [x, z, rot] of rp) ramps.push({ x, z, rot, w: 7, len: 18, h: 5 });
  ramps.push({ x: CL[10] + 50, z: CL[2] + 25, rot: 0, w: 7, len: 16, h: 3.5 }); // park ramp in city
  for (const r of ramps) r.base = terrainHeight(r.x, r.z) + (blockAt(r.x, r.z) ? 0.15 : 0);
  if (ramps.length) ramps[0].base = Math.max(ramps[0].base, 3);

  // nature
  const tryTree = (x, z) => {
    const h = terrainHeight(x, z);
    if (h < 1.5) return;
    const ce = Math.max(Math.abs(x), Math.abs(z));
    if (ce < 900) return;
    if (x > A.x0 - 60 && x < A.x1 + 60 && z > A.z0 - 60 && z < A.z1 + 60) return;
    for (const t of TOWNS) if (Math.hypot(x - t.x, z - t.z) < t.r + 10) return;
    if (!okForProp(x, z, 6)) return;
    // slope
    const sl = Math.abs(terrainHeight(x + 4, z) - h) + Math.abs(terrainHeight(x, z + 4) - h);
    const dS = desertF(x, z), mN = mountainF(z), fW = forestF(x);
    if (dS > 0.5) {
      if (R() < 0.35) addTree(x, z, R() < 0.6 ? 'cactus' : 'rock', rr(0.7, 1.4));
      else if (R() < 0.25) addTree(x, z, 'bush', rr(0.6, 1.1));
      return;
    }
    if (mN > 0.4) {
      if (h > 300) { if (R() < 0.1) addTree(x, z, 'rock', rr(1, 2.5)); return; }
      if (sl > 6) { if (R() < 0.15) addTree(x, z, 'rock', rr(1, 2)); return; }
      if (R() < 0.6) addTree(x, z, 'pine', rr(0.9, 1.6));
      return;
    }
    if (fW > 0.4) {
      if (R() < 0.85) addTree(x, z, R() < 0.8 ? 'pine' : 'round', rr(0.9, 1.7));
      return;
    }
    if (h < 6 && islandMask(x, z) < 0.98) { if (R() < 0.5) addTree(x, z, 'palm', rr(0.8, 1.3)); return; }
    if (R() < 0.18) addTree(x, z, R() < 0.7 ? 'round' : 'pine', rr(0.8, 1.4));
    else if (R() < 0.05) addTree(x, z, 'bush', 1);
  };
  for (let x = -2620; x < 2620; x += 26)
    for (let z = -2620; z < 2620; z += 26) {
      const jx = x + rr(-11, 11), jz = z + rr(-11, 11);
      const fW = forestF(jx), mN = mountainF(jz), dS = desertF(jx, jz);
      if (fW < 0.4 && mN < 0.4 && dS < 0.5 && R() > 0.35) continue; // sparser on plains
      if (dS > 0.5 && R() > 0.5) continue;
      tryTree(jx, jz);
    }
}

// ---------------------------------------------------------------- queries
export function buildingsNear(x, z) {
  return bGrid.get(gk(Math.floor(x / BG), Math.floor(z / BG)));
}

function rampHeight(x, z) {
  let h = null;
  for (const r of ramps) {
    const dx = x - r.x, dz = z - r.z;
    if (dx * dx + dz * dz > (r.len + 4) * (r.len + 4)) continue;
    const s = Math.sin(r.rot), c = Math.cos(r.rot);
    const along = dx * s + dz * c; // forward axis (sin rot, cos rot)
    const lat = dx * c - dz * s;
    if (along < 0 || along > r.len || Math.abs(lat) > r.w / 2) continue;
    const y = r.base + (along / r.len) * r.h;
    if (h === null || y > h) h = y;
  }
  return h;
}

// Ground height at (x,z). Surfaces higher than maxY+step are ignored (so things can pass under bridges).
export function groundHeight(x, z, maxY = Infinity) {
  let h = terrainHeight(x, z);
  const lim = maxY + 1.6;
  const r = roadAt(x, z, lim);
  if (r !== null && r > h) h = r;
  if (blockAt(x, z) && SLAB_TOP > h) h = SLAB_TOP;
  const l = bGrid.get(gk(Math.floor(x / BG), Math.floor(z / BG)));
  if (l)
    for (const o of l)
      if (o.t === 0 && x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1 && o.y1 <= maxY + 1.0 && o.y1 > h) h = o.y1;
  const rh = rampHeight(x, z);
  if (rh !== null && rh <= lim && rh > h) h = rh;
  return h;
}

export function isWater(x, z) {
  return terrainHeight(x, z) < WATER - 0.5 && roadAt(x, z, WATER + 0.5) === null && !blockAt(x, z);
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
        const cx = clamp(x, o.x0, o.x1), cz = clamp(z, o.z0, o.z1);
        let dx = x - cx, dz = z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 < 1e-6) {
          const a = x - o.x0, b = o.x1 - x, c = z - o.z0, d = o.z1 - z;
          const m = Math.min(a, b, c, d);
          if (m === a) { x = o.x0 - r; dx = -1; dz = 0; }
          else if (m === b) { x = o.x1 + r; dx = 1; dz = 0; }
          else if (m === c) { z = o.z0 - r; dx = 0; dz = -1; }
          else { z = o.z1 + r; dx = 0; dz = 1; }
        } else {
          const d = Math.sqrt(d2);
          dx /= d; dz /= d;
          x = cx + dx * r; z = cz + dz * r;
        }
        hit = true; nx = dx; nz = dz;
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
    if (l) for (const o of l) if (o.t === 0 && x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1 && y < o.y1 && y > o.y0) return t;
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
  if (Math.abs(x) < 820 && Math.abs(z) < 820) {
    const g = gangAt(x, z);
    if (g) return g.id === 'kingz' ? 'Kingz Turf' : 'Viper Blocks';
    if (Math.abs(x + 350) < 60) return 'Riverside';
    if (Math.max(Math.abs(x), Math.abs(z)) < 300) return 'Downtown';
    if (Math.abs(z) > Math.abs(x)) return z < 0 ? 'Northside' : 'Southport';
    return x > 0 ? 'Eastgate' : 'Westwood';
  }
  if (x > AIRPORT.x0 - 50 && x < AIRPORT.x1 + 50 && z > AIRPORT.z0 - 50 && z < AIRPORT.z1 + 50) return 'Crimson Intl. Airport';
  for (const t of TOWNS) if (Math.hypot(x - t.x, z - t.z) < t.r + 60) return t.name;
  if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 120) return 'Mirror Lake';
  if (islandMask(x, z) < 0.97) return 'Crimson Coastline';
  if (desertF(x, z) > 0.5) return 'Red Dust Desert';
  if (mountainF(z) > 0.5) return terrainHeight(x, z) > 250 ? 'Mt. Ember' : 'Ember Ridge';
  if (forestF(x) > 0.5) return 'Pinewood Forest';
  if (riverDist(x, z) < 60) return 'Crimson River';
  return 'Countryside';
}

// Sidewalk corner nodes for pedestrians: corner (bi,bj,cx,cz) of a block.
export function cornerPos(bi, bj, cx, cz, out) {
  const r = blockRect(bi, bj);
  out.x = cx ? r.x1 - 1.6 : r.x0 + 1.6;
  out.z = cz ? r.z1 - 1.6 : r.z0 + 1.6;
  return out;
}
export function walkableBlock(bi, bj) {
  return bi >= 0 && bj >= 0 && bi < 16 && bj < 16 && blockType[bi][bj] !== 'river';
}

let built = false;
export function generateWorldData() {
  if (built) return;
  built = true;
  buildRoads();
  regSegs();
  genTerrain();
  genCity();
  genOutside();
}
