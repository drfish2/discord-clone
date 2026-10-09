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

export const AIRPORT = { x0: 1000, x1: 2400, z0: -350, z1: 350, runwayZ: -120, runwayX0: 1150, runwayX1: 2300, runwayW: 50 };
export const TOWNS = [
  { name: 'Sandy Rock', x: 2100, z: 2100, r: 170, n: 14, style: 'desert' },
  { name: 'Coral Beach', x: -650, z: 2380, r: 170, n: 16, style: 'beach' },
  { name: 'Mirror Lake Camp', x: -2450, z: 350, r: 120, n: 7, style: 'cabin' },
  { name: 'Mt. Ember Observatory', x: 300, z: -2450, r: 90, n: 0, style: 'obs' },
];
export const LAKE = { x: -1950, z: 700, r: 180 };
// The Crimson River: rises at a tarn on Ember Ridge, meanders through the west of
// the city and reaches the sea on the south-west coast.
const RIVER_CTRL = [
  [-180, -1800], [-330, -1500], [-520, -1150], [-470, -830], [-300, -450], [-430, -50], [-230, 380],
  [-360, 760], [-560, 1250], [-850, 1800], [-1100, 2300], [-1300, 2850],
];
export const GANGS = [
  { id: 'kingz', name: 'Purple Kingz', color: 0x7b3fc4, css: '#9b5de5', bi0: 0, bi1: 3, bj0: 1, bj1: 4 },
  { id: 'vipers', name: 'Red Vipers', color: 0xc62828, css: '#e53935', bi0: 12, bi1: 15, bj0: 11, bj1: 14 },
];

// ---------------------------------------------------------------- city warp
// The street grid is laid out in "logical" coordinates and bent into the world by a
// smooth displacement field, so streets curve and blocks vary in size and angle.
const WG = 10, WR = 1200, WN = (2 * WR) / WG + 1;
const WDX = new Float32Array(WN * WN), WDZ = new Float32Array(WN * WN);
// curl of a smooth potential: a divergence-free flow, so streets bend and swirl
// without whole districts being squashed or stretched
export let WARP_K = 9500;
{
  const PSI = new Float32Array(WN * WN);
  for (let j = 0; j < WN; j++)
    for (let i = 0; i < WN; i++) {
      const lx = -WR + i * WG, lz = -WR + j * WG;
      PSI[j * WN + i] = noise2(lx * 0.0009 + 31.7, lz * 0.0009 - 12.2) + 0.3 * noise2(lx * 0.0019 + 4.1, lz * 0.0019 - 9.3);
    }
  for (let j = 0; j < WN; j++)
    for (let i = 0; i < WN; i++) {
      const lx = -WR + i * WG, lz = -WR + j * WG;
      const fade = 1 - sstep(780, 1100, Math.max(Math.abs(lx), Math.abs(lz)));
      const ip = Math.min(WN - 1, i + 1), im = Math.max(0, i - 1), jp = Math.min(WN - 1, j + 1), jm = Math.max(0, j - 1);
      const dPdx = (PSI[j * WN + ip] - PSI[j * WN + im]) / ((ip - im) * WG);
      const dPdz = (PSI[jp * WN + i] - PSI[jm * WN + i]) / ((jp - jm) * WG);
      WDX[j * WN + i] = fade * WARP_K * dPdz;
      WDZ[j * WN + i] = -fade * WARP_K * dPdx;
    }
}
const WD = { x: 0, z: 0 };
function warpD(lx, lz) {
  const fx = (lx + WR) / WG, fz = (lz + WR) / WG;
  if (fx < 0 || fz < 0 || fx >= WN - 1 || fz >= WN - 1) { WD.x = WD.z = 0; return WD; }
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const o = j * WN + i;
  WD.x = lerp(lerp(WDX[o], WDX[o + 1], tx), lerp(WDX[o + WN], WDX[o + WN + 1], tx), tz);
  WD.z = lerp(lerp(WDZ[o], WDZ[o + 1], tx), lerp(WDZ[o + WN], WDZ[o + WN + 1], tx), tz);
  return WD;
}
// logical -> world
export function cityPt(lx, lz, out = {}) {
  warpD(lx, lz);
  out.x = lx + WD.x;
  out.z = lz + WD.z;
  return out;
}
// world -> logical (fixed-point inverse of the smooth warp)
const LP = { x: 0, z: 0 };
export function toLogical(x, z, out = LP) {
  let lx = x, lz = z;
  for (let k = 0; k < 4; k++) {
    warpD(lx, lz);
    lx = x - WD.x;
    lz = z - WD.z;
  }
  out.x = lx;
  out.z = lz;
  return out;
}
// how much the logical x axis is turned at a point (radians, three.js Y rotation)
const _a = {}, _b = {};
export function cityAngle(lx, lz) {
  cityPt(lx - 4, lz, _a);
  cityPt(lx + 4, lz, _b);
  return Math.atan2(_b.x - _a.x, _b.z - _a.z) - Math.PI / 2;
}
// Irregular city outline in logical space: 1 inside, 0 outside (soft edge).
export function cityShapeL(lx, lz) {
  const r = Math.pow(Math.pow(Math.abs(lx), 3) + Math.pow(Math.abs(lz), 3), 1 / 3);
  const a = Math.atan2(lz, lx);
  const R = 700 + 150 * fbm(Math.cos(a) * 1.4 + 3.3, Math.sin(a) * 1.4 - 7.1, 3);
  return 1 - sstep(R - 30, R + 160, r);
}
export function cityShape(x, z) {
  if (Math.abs(x) > 1150 || Math.abs(z) > 1150) return 0;
  const l = toLogical(x, z);
  return cityShapeL(l.x, l.z);
}
for (const g of GANGS) {
  g.x0 = CL[g.bi0]; g.x1 = CL[g.bi1 + 1]; g.z0 = CL[g.bj0]; g.z1 = CL[g.bj1 + 1];
  const c = cityPt((g.x0 + g.x1) / 2, (g.z0 + g.z1) / 2);
  g.cx = c.x; g.cz = c.z;
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
  h = lerp(h, 2.9, cityShape(x, z));
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

// ---------------------------------------------------------------- river
// RIVER_PATH: samples {x,z,surf,bed,hw} from source to mouth. surf is the water surface
// height (0 = sea level), so the upper river flows downhill above sea level.
export const RIVER_PATH = [];
export const TARN = { x: 0, z: 0, r: 42, surf: 0 };
const RVG = 80;
const rGrid = new Map();
function genRiver() {
  const P = RIVER_CTRL;
  const raw = [];
  for (let k = 0; k < P.length - 1; k++) {
    const p0 = P[Math.max(0, k - 1)], p1 = P[k], p2 = P[k + 1], p3 = P[Math.min(P.length - 1, k + 2)];
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 6));
    for (let s = k === 0 ? 0 : 1; s <= n; s++) {
      const t = s / n;
      raw.push([catmull(p0[0], p1[0], p2[0], p3[0], t), catmull(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }
  // meander: sideways offsets that grow downstream, gentler inside the city
  let arc = 0;
  const mean = raw.map((p, i) => {
    if (i > 0) arc += Math.hypot(p[0] - raw[i - 1][0], p[1] - raw[i - 1][1]);
    const q = raw[Math.min(raw.length - 1, i + 1)], o = raw[Math.max(0, i - 1)];
    let tx = q[0] - o[0], tz = q[1] - o[1];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    const city = 1 - 0.65 * (1 - sstep(700, 950, Math.max(Math.abs(p[0]), Math.abs(p[1]))));
    const amp = 62 * city * sstep(0, 400, arc);
    const m = amp * (0.7 * Math.sin(arc / 165 + 0.5) + 0.3 * Math.sin(arc / 68 + 2.0));
    return [p[0] - tz * m, p[1] + tx * m];
  });
  // resample evenly every 12 m and stop a little way out to sea
  const pts = [mean[0]];
  let acc = 0;
  for (let i = 1; i < mean.length; i++) {
    const a = mean[i - 1], b = mean[i];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    acc += l;
    if (acc >= 12) { pts.push(b); acc = 0; }
  }
  let seaCount = 0;
  const N0 = pts.length;
  for (let i = 0; i < N0; i++) {
    const [x, z] = pts[i];
    const g = baseHeight(x, z);
    if (g < -3) seaCount++;
    RIVER_PATH.push({ x, z, g, surf: 0, bed: 0, hw: 0 });
    if (seaCount > 12) break;
  }
  const N = RIVER_PATH.length;
  // water surface: never rises downstream, follows the valley floor, reaches 0 in the lowlands
  let run = Infinity;
  for (const r of RIVER_PATH) {
    run = Math.min(run, r.g - 3);
    r.surf = Math.max(0, run - 1);
  }
  for (let pass = 0; pass < 4; pass++) {
    const o = RIVER_PATH.map((r) => r.surf);
    for (let i = 0; i < N; i++) {
      let sum = 0, c = 0;
      for (let k = -3; k <= 3; k++) { const j = clamp(i + k, 0, N - 1); sum += o[j]; c++; }
      RIVER_PATH[i].surf = sum / c;
    }
    let m = Infinity;
    for (const r of RIVER_PATH) { m = Math.min(m, r.surf); r.surf = m; }
  }
  RIVER_PATH.forEach((r, i) => {
    const t = i / (N - 1);
    const inCity = 1 - sstep(780, 950, Math.max(Math.abs(r.x), Math.abs(r.z)));
    r.hw = lerp(lerp(7, 30, Math.pow(t, 0.85)), 19, inCity);
    r.bed = r.surf - lerp(1.6, 5, t);
  });
  TARN.x = RIVER_PATH[0].x;
  TARN.z = RIVER_PATH[0].z;
  TARN.surf = RIVER_PATH[0].surf;
  // spatial hash of river segments (with room for the valley banks)
  for (let i = 0; i < N - 1; i++) {
    const a = RIVER_PATH[i], b = RIVER_PATH[i + 1];
    const m = 220;
    const x0 = Math.floor((Math.min(a.x, b.x) - m) / RVG), x1 = Math.floor((Math.max(a.x, b.x) + m) / RVG);
    const z0 = Math.floor((Math.min(a.z, b.z) - m) / RVG), z1 = Math.floor((Math.max(a.z, b.z) + m) / RVG);
    for (let gi = x0; gi <= x1; gi++)
      for (let gj = z0; gj <= z1; gj++) {
        const k = gk(gi, gj);
        let l = rGrid.get(k);
        if (!l) rGrid.set(k, (l = []));
        l.push(i);
      }
  }
}
// nearest point on the river: {d, surf, bed, hw, i}; d = Infinity when far away
export const RQ = { d: Infinity, surf: 0, bed: 0, hw: 0, i: 0 };
export function riverQuery(x, z) {
  RQ.d = Infinity;
  const l = rGrid.get(gk(Math.floor(x / RVG), Math.floor(z / RVG)));
  if (!l) return RQ;
  for (const i of l) {
    const a = RIVER_PATH[i], b = RIVER_PATH[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
    const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
    if (d < RQ.d) {
      RQ.d = d;
      RQ.surf = lerp(a.surf, b.surf, t);
      RQ.bed = lerp(a.bed, b.bed, t);
      RQ.hw = lerp(a.hw, b.hw, t);
      RQ.i = i + t;
    }
  }
  return RQ;
}
export function riverDist(x, z) {
  return riverQuery(x, z).d;
}
function carve(x, z, h) {
  const r = riverQuery(x, z);
  if (r.d < Infinity) {
    if (r.d < r.hw) h = Math.min(h, r.bed);
    else {
      const e = r.d - r.hw;
      h = Math.min(h, r.surf + 0.6 + e * 0.55 + e * e * 0.01);
    }
  }
  const dt = Math.hypot(x - TARN.x, z - TARN.z);
  if (dt < 160) {
    const e = Math.max(0, dt - TARN.r);
    h = Math.min(h, dt < TARN.r ? TARN.surf - 3 : TARN.surf + 0.6 + e * 0.5 + e * e * 0.01);
  }
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
  const e2 = Math.max(0, dl - LAKE.r);
  h = Math.min(h, -6 + e2 * 0.35 + e2 * e2 * 0.004);
  return h;
}
// Height of the water surface at (x,z): the river/tarn where present, else sea level.
export function waterLevel(x, z) {
  const r = riverQuery(x, z);
  let w = WATER;
  if (r.d < r.hw + 3 && r.surf > w) w = r.surf;
  if (Math.hypot(x - TARN.x, z - TARN.z) < TARN.r + 3) w = Math.max(w, TARN.surf);
  return w;
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

// streets removed from the grid to make T-junctions and bigger, irregular blocks
export const removedV = []; // removedV[i][j]: line x=CL[i] between rows j and j+1
export const removedH = []; // removedH[j][i]: line z=CL[j] between columns i and i+1
export const cityStreets = []; // node lists of each street between junctions (for rendering)
export const junctions = []; // city intersection nodes {n, deg}
const gridNode = []; // gridNode[i][j]
function pickRemovedStreets() {
  for (let i = 0; i <= 16; i++) { removedV[i] = Array(16).fill(false); removedH[i] = Array(16).fill(false); }
  const deg = [];
  for (let i = 0; i <= 16; i++) { deg[i] = []; for (let j = 0; j <= 16; j++) deg[i][j] = (i > 0) + (i < 16) + (j > 0) + (j < 16); }
  const solid = (bi, bj) => bi >= 0 && bj >= 0 && bi < 16 && bj < 16 && ['res', 'mid', 'down', 'park'].includes(blockType[bi][bj]);
  let removed = 0;
  for (let tries = 0; tries < 4000 && removed < 60; tries++) {
    const vert = R() < 0.5;
    const i = 1 + Math.floor(R() * 15), j = Math.floor(R() * 16);
    if (vert) {
      if (removedV[i][j] || deg[i][j] < 3 || deg[i][j + 1] < 3 || !solid(i - 1, j) || !solid(i, j)) continue;
      if (blockType[i - 1][j] !== blockType[i][j] && R() < 0.7) continue;
      removedV[i][j] = true; deg[i][j]--; deg[i][j + 1]--;
    } else {
      if (removedH[i][j] || deg[j][i] < 3 || deg[j + 1][i] < 3 || !solid(j, i - 1) || !solid(j, i)) continue;
      if (blockType[j][i - 1] !== blockType[j][i] && R() < 0.7) continue;
      removedH[i][j] = true; deg[j][i]--; deg[j + 1][i]--;
    }
    removed++;
  }
}

function buildRoads() {
  // warped city grid: junction nodes plus intermediate nodes so streets can curve
  const SUB = 5;
  for (let i = 0; i <= 16; i++) {
    gridNode[i] = [];
    for (let j = 0; j <= 16; j++) {
      const p = cityPt(CL[i], CL[j]);
      gridNode[i][j] = addNode(p.x, p.z, CITY_H);
    }
  }
  // a street exists if at least one neighbouring block is part of the city
  const live = (bi, bj) => bi >= 0 && bj >= 0 && bi < 16 && bj < 16 && blockType[bi][bj] !== 'void';
  const street = (a, b, la, lb) => {
    const list = [a];
    let prev = a;
    for (let k = 1; k < SUB; k++) {
      const t = k / SUB;
      const p = cityPt(lerp(la[0], lb[0], t), lerp(la[1], lb[1], t));
      const n = addNode(p.x, p.z, CITY_H);
      link(prev, n, ROAD_W, 'city', 'street');
      list.push(n);
      prev = n;
    }
    link(prev, b, ROAD_W, 'city', 'street');
    list.push(b);
    cityStreets.push(list);
  };
  for (let i = 0; i <= 16; i++)
    for (let j = 0; j <= 16; j++) {
      if (i < 16 && !(j > 0 && j < 16 && removedH[j][i]) && (live(i, j - 1) || live(i, j))) street(gridNode[i][j], gridNode[i + 1][j], [CL[i], CL[j]], [CL[i + 1], CL[j]]);
      if (j < 16 && !(i > 0 && i < 16 && removedV[i][j]) && (live(i - 1, j) || live(i, j))) street(gridNode[i][j], gridNode[i][j + 1], [CL[i], CL[j]], [CL[i], CL[j + 1]]);
    }
  for (let i = 0; i <= 16; i++) for (let j = 0; j <= 16; j++) junctions.push({ n: gridNode[i][j], deg: gridNode[i][j].edges.length, i, j });
  // highways start at warped city edge junctions
  for (const hw of HIGHWAYS) hw.pts = hw.pts.map(([x, z]) => (Math.abs(x) <= 800 && Math.abs(z) <= 800 ? (({ x: wx, z: wz }) => [wx, wz])(cityPt(x, z)) : [x, z]));
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
      if (ce < 1150 && cityShape(x, z) > 0.6) h = Math.min(h, 2.8);
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
// Blocks live in logical (unwarped) coordinates; world positions go through cityPt().
export const blockType = []; // [bi][bj]
export function blockRect(bi, bj) {
  return { x0: CL[bi] + 7, x1: CL[bi + 1] - 7, z0: CL[bj] + 7, z1: CL[bj + 1] - 7 };
}
const BA = { bi: 0, bj: 0, set(i, j) { this.bi = i; this.bj = j; return this; } };
// Block (sidewalk slab) at a logical point, including the strips left by removed streets.
export function blockAtL(lx, lz) {
  if (lx <= -800 || lx >= 800 || lz <= -800 || lz >= 800) return null;
  const bi = Math.min(15, Math.floor((lx + 800) / 100)), bj = Math.min(15, Math.floor((lz + 800) / 100));
  const ux = lx - CL[bi], uz = lz - CL[bj];
  const inX = ux >= 7 && ux <= 93, inZ = uz >= 7 && uz <= 93;
  let ok = inX && inZ;
  if (!ok && inZ && removedV.length) ok = (ux < 7 && removedV[bi][bj]) || (ux > 93 && removedV[bi + 1][bj]);
  if (!ok && inX && removedH.length) ok = (uz < 7 && removedH[bj][bi]) || (uz > 93 && removedH[bj + 1][bi]);
  if (!ok) return null;
  return blockType[bi] && blockType[bi][bj] !== 'river' && blockType[bi][bj] !== 'void' ? BA.set(bi, bj) : null;
}
export function blockAt(x, z) {
  if (x <= -900 || x >= 900 || z <= -900 || z >= 900 || !blockType.length) return null;
  const l = toLogical(x, z);
  return blockAtL(l.x, l.z);
}
export function slabTop(x, z) {
  return blockAt(x, z) ? SLAB_TOP : null;
}
export function gangAt(x, z) {
  if (Math.abs(x) > 900 || Math.abs(z) > 900) return null;
  const l = toLogical(x, z);
  for (const g of GANGS) if (l.x > g.x0 && l.x < g.x1 && l.z > g.z0 && l.z < g.z1) return g;
  return null;
}
export function inSpray(x, z) {
  const s = SPECIAL.spray;
  if (!s) return false;
  const l = toLogical(x, z);
  return l.x > s.lx0 && l.x < s.lx1 && l.z > s.lz0 && l.z < s.lz1;
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
// Oriented box building. (cx,cz) centre, half sizes hx/hz along its own axes, rot = Y rotation.
export function addBox(cx, cz, hx, hz, rot, h, color, kind = 'tower', roof = null, y0) {
  const c = Math.cos(rot), sn = Math.sin(rot);
  const ex = Math.abs(c) * hx + Math.abs(sn) * hz, ez = Math.abs(sn) * hx + Math.abs(c) * hz;
  if (y0 === undefined) {
    const g = [terrainHeight(cx - ex, cz - ez), terrainHeight(cx + ex, cz - ez), terrainHeight(cx - ex, cz + ez), terrainHeight(cx + ex, cz + ez)];
    const blk = blockAt(cx, cz);
    y0 = blk ? SLAB_TOP - 0.05 : Math.min(...g) - 0.5;
    h += blk ? 0 : Math.max(...g) - Math.min(...g) + 0.5;
  }
  const b = { t: 0, cx, cz, hx, hz, rot, c, s: sn, x0: cx - ex, x1: cx + ex, z0: cz - ez, z1: cz + ez, y0, y1: y0 + h, color, roof, kind };
  buildings.push(b);
  regCollider(b, b.x0, b.x1, b.z0, b.z1);
  return b;
}
// axis-aligned convenience (countryside, airport)
export function addBuilding(x0, x1, z0, z1, h, color, kind = 'tower', roof = null, y0) {
  return addBox((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, 0, h, color, kind, roof, y0);
}
// building placed in logical city space (bent and turned with the street grid)
// local stretch of the warp along the logical axes (1 = unchanged)
export function cityScale(lx, lz) {
  cityPt(lx - 3, lz, _a); cityPt(lx + 3, lz, _b);
  const sx = Math.hypot(_b.x - _a.x, _b.z - _a.z) / 6;
  cityPt(lx, lz - 3, _a); cityPt(lx, lz + 3, _b);
  const sz = Math.hypot(_b.x - _a.x, _b.z - _a.z) / 6;
  return Math.min(1, sx, sz);
}
function addBuildingL(lcx, lcz, w, d, lrot, h, color, kind, roof = null) {
  const p = cityPt(lcx, lcz);
  // where the grid is squeezed, shrink the footprint so it stays inside its lot
  const k = cityScale(lcx, lcz);
  // KayKit models scale uniformly, so their height follows the same factor
  const b = addBox(p.x, p.z, (w * k) / 2, (d * k) / 2, lrot + cityAngle(lcx, lcz), h * (kind === 'kk' ? k : 0.6 + 0.4 * k), color, kind, roof);
  b.fit = k;
  return b;
}
// point inside an oriented box (xz only)
function inBox(o, x, z) {
  const dx = x - o.cx, dz = z - o.cz;
  return Math.abs(dx * o.c - dz * o.s) < o.hx && Math.abs(dx * o.s + dz * o.c) < o.hz;
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

// block types: zoning by distance from the centre, gang turf, river and specials
function assignBlockTypes() {
  for (let bi = 0; bi < 16; bi++) {
    blockType[bi] = [];
    for (let bj = 0; bj < 16; bj++) {
      const c = blockCenter(bi, bj);
      const d = Math.max(Math.abs(c.x), Math.abs(c.z));
      let t = d < 300 ? 'down' : d < 560 ? 'mid' : 'res';
      if (R() < 0.06 && t !== 'down') t = 'park';
      for (const g of GANGS) if (bi >= g.bi0 && bi <= g.bi1 && bj >= g.bj0 && bj <= g.bj1) t = 'gang_' + g.id;
      // the river claims blocks it runs through; blocks along its banks become parks
      let near = Infinity;
      for (const [u, v] of [[0.5, 0.5], [0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9], [0.5, 0.1], [0.5, 0.9], [0.1, 0.5], [0.9, 0.5]]) {
        const p = cityPt(CL[bi] + 7 + u * 86, CL[bj] + 7 + v * 86);
        const r = riverQuery(p.x, p.z);
        near = Math.min(near, r.d - r.hw);
      }
      if (near < 6) t = 'river';
      else if (near < 22 && !t.startsWith('gang')) t = 'park';
      // outside the irregular city outline: countryside (gang turf stays as suburbs)
      if (cityShapeL(c.x, c.z) < 0.5 && !t.startsWith('gang')) t = 'void';
      blockType[bi][bj] = t;
    }
  }
  // keep a corridor of blocks along each street where a highway enters the city
  for (const [x, z] of [[800, 0], [800, 800], [-800, -200], [0, -800], [0, 800]]) {
    const i0 = (x + 800) / 100, j0 = (z + 800) / 100;
    const di = i0 === 16 ? -1 : i0 === 0 ? 1 : 0, dj = j0 === 16 ? -1 : j0 === 0 ? 1 : 0;
    for (let k = 0; k < 8; k++) {
      const i = i0 + di * k, j = j0 + dj * k;
      for (const [bi, bj] of di ? [[i - (di < 0 ? 1 : 0), j - 1], [i - (di < 0 ? 1 : 0), j]] : [[i - 1, j - (dj < 0 ? 1 : 0)], [i, j - (dj < 0 ? 1 : 0)]]) {
        if (bi < 0 || bj < 0 || bi > 15 || bj > 15) continue;
        if (blockType[bi][bj] === 'void') blockType[bi][bj] = 'res';
      }
    }
  }
  const set = (bi, bj, t) => { if (blockType[bi][bj] !== 'river') blockType[bi][bj] = t; };
  set(10, 2, 'park'); set(11, 2, 'park'); set(10, 3, 'park'); set(11, 3, 'park');
  set(8, 7, 'plaza');
  set(9, 5, 'police');
  set(6, 10, 'hospital');
  set(13, 8, 'spray');
}

function genCity() {
  const W = (lx, lz) => cityPt(lx, lz);
  const ang = (lx, lz) => cityAngle(lx, lz);
  for (let bi = 0; bi < 16; bi++)
    for (let bj = 0; bj < 16; bj++) {
      const t = blockType[bi][bj];
      if (t === 'river' || t === 'void') continue;
      const r = blockRect(bi, bj);
      const ix0 = r.x0 + 3, ix1 = r.x1 - 3, iz0 = r.z0 + 3, iz1 = r.z1 - 3; // building area (80x80)
      const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      if (t === 'down') {
        for (let a = 0; a < 2; a++)
          for (let b = 0; b < 2; b++) {
            const lx0 = ix0 + a * 41, lz0 = iz0 + b * 41;
            const w = rr(24, 34), dd = rr(24, 34);
            const x0 = lx0 + rr(1, 39 - w), z0 = lz0 + rr(1, 39 - dd);
            const p = W(cx, cz);
            const dc = Math.max(Math.abs(p.x), Math.abs(p.z));
            const h = 35 + R() * R() * 170 * Math.max(0, 1 - dc / 380) + R() * 20;
            addBuildingL(x0 + w / 2, z0 + dd / 2, w, dd, 0, h, PALETTE.down[Math.floor(R() * PALETTE.down.length)], 'tower');
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
            const dW = lcx - r.x0, dE = r.x1 - lcx, dN = lcz - r.z0, dS = r.z1 - lcz;
            const m = Math.min(dW, dE, dN, dS);
            const rot = m === dS ? 0 : m === dN ? Math.PI : m === dE ? Math.PI / 2 : -Math.PI / 2;
            const side = rot === Math.PI / 2 || rot === -Math.PI / 2;
            const maxS = (cell - 3) / Math.max(kw, kd);
            const sc = Math.min(maxS, mid ? rr(10, 12.5) : rr(7.5, 10.5));
            const wx = (side ? kd : kw) * sc, wz = (side ? kw : kd) * sc;
            const push = (side ? cell - wx : cell - wz) / 2 - 1.5;
            const fx = Math.round(Math.sin(rot)), fz = Math.round(Math.cos(rot));
            const bld = addBuildingL(lcx + fx * push, lcz + fz * push, kw * sc, kd * sc, rot, kh * sc, 0x9a8f80, 'kk');
            bld.kk = kind;
            bld.scale = sc * bld.fit;
          }
        if (!mid) for (let k = 0; k < 3; k++) { const p = W(lerp(ix0, ix1, 0.42 + R() * 0.16), lerp(iz0, iz1, 0.42 + R() * 0.16)); addTree(p.x, p.z, 'round', rr(0.8, 1.2)); }
        const dp = W(lerp(ix0, ix1, 0.5), lerp(iz0, iz1, 0.5) + 6);
        props.push({ file: 'kk_dumpster', x: dp.x, z: dp.z, rot: R() * 6.28, h: 1.6 });
      } else if (t === 'park') {
        for (let k = 0; k < 22; k++) { const p = W(rr(ix0, ix1), rr(iz0, iz1)); addTree(p.x, p.z, 'round', rr(0.9, 1.5)); }
      } else if (t === 'plaza') {
        const p = W(cx, cz), th = ang(cx, cz);
        decor.push({ x: p.x, y: SLAB_TOP + 0.4, z: p.z, sx: 14, sy: 0.8, sz: 14, rot: th, color: 0xb9b2a5 });
        decor.push({ x: p.x, y: SLAB_TOP + 0.85, z: p.z, sx: 12.5, sy: 0.15, sz: 12.5, rot: th, color: 0x3d8fb5, emissive: true });
        decor.push({ x: p.x, y: SLAB_TOP + 3, z: p.z, sx: 1.4, sy: 5, sz: 1.4, rot: th, color: 0xd8d0c0 });
        addBox(p.x, p.z, 7, 7, th, 0.8, 0xb9b2a5, 'fountain', null, SLAB_TOP - 0.05).hidden = true;
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          const q = W(cx + Math.cos(a) * 30, cz + Math.sin(a) * 30);
          addTree(q.x, q.z, 'round', 1.1);
        }
      } else if (t === 'police') {
        addBuildingL(ix0 + 35, iz0 + 21, 60, 38, 0, 14, 0x3b5578, 'police');
        const front = W(cx, r.z1 + 2), spawn = W(ix0 + 35, iz0 + 60), sg = W(ix0 + 35, iz0 + 40.3);
        SPECIAL.police = { x: front.x, z: front.z, spawnX: spawn.x, spawnZ: spawn.z, h: ang(cx, cz), lx: cx, lz: r.z1 + 2 };
        signs.push({ text: 'POLICE', x: sg.x, y: SLAB_TOP + 10, z: sg.z, rot: ang(cx, cz), w: 20, h: 4, bg: '#12305e', fg: '#ffffff' });
      } else if (t === 'hospital') {
        addBuildingL(ix0 + 40, iz0 + 54, 70, 48, 0, 30, 0xf2f2f2, 'hospital');
        const sp = W(cx, iz0 + 15), sg = W(cx, iz0 + 29.7), roof = W(ix0 + 40, iz0 + 54);
        SPECIAL.hospital = { x: sp.x, z: sp.z, spawnX: sp.x, spawnZ: sp.z, roofX: roof.x, roofZ: roof.z };
        signs.push({ text: '+ HOSPITAL', x: sg.x, y: SLAB_TOP + 22, z: sg.z, rot: Math.PI + ang(cx, cz), w: 26, h: 5, bg: '#ffffff', fg: '#d32f2f' });
      } else if (t === 'spray') {
        addBuildingL(ix0 + 60, iz0 + 40, 40, 80, 0, 9, 0x44515e, 'mid');
        const c = W(ix0 + 20, iz0 + 40), sg = W(ix0 + 39.7, iz0 + 40);
        SPECIAL.spray = { lx0: ix0 + 4, lx1: ix0 + 36, lz0: iz0 + 25, lz1: iz0 + 55, x: c.x, z: c.z };
        signs.push({ text: "PAY 'N' SPRAY", x: sg.x, y: SLAB_TOP + 6.5, z: sg.z, rot: -Math.PI / 2 + ang(cx, cz), w: 22, h: 3.5, bg: '#ffb300', fg: '#1a1a1a' });
      }
      // street lamps along every block edge, arms reaching over the road
      const lamp = (lx, lz, dir) => { const p = W(lx, lz); lamps.push({ x: p.x, z: p.z, dir: dir + ang(lx, lz) }); };
      for (const f of [0.2, 0.5, 0.8]) {
        lamp(lerp(r.x0, r.x1, f), r.z0 + 0.7, Math.PI);
        lamp(lerp(r.x0, r.x1, f), r.z1 - 0.7, 0);
        lamp(r.x0 + 0.7, lerp(r.z0, r.z1, f), -Math.PI / 2);
        lamp(r.x1 - 0.7, lerp(r.z0, r.z1, f), Math.PI / 2);
      }
      // a hydrant and a couple of benches per block
      const prop = (file, lx, lz, rot, h, col) => { const p = W(lx, lz); props.push({ file, x: p.x, z: p.z, rot: rot + ang(lx, lz), h, col }); };
      prop('kk_firehydrant', lerp(r.x0, r.x1, 0.35), r.z0 + 1.0, 0, 0.9, 0.3);
      if (t === 'park' || t === 'plaza' || R() < 0.3) prop('kk_bench', lerp(r.x0, r.x1, 0.65), r.z1 - 1.2, Math.PI, 0.9);
      if (R() < 0.5) prop('kk_trash_A', r.x1 - 1.1, lerp(r.z0, r.z1, 0.3), 0, 0.9);
    }
  // former streets become tree-lined walkways
  for (let i = 1; i < 16; i++)
    for (let j = 0; j < 16; j++) {
      if (removedV[i][j]) for (let k = 1; k < 5; k++) { const p = cityPt(CL[i], CL[j] + k * 20); if (blockAt(p.x, p.z)) addTree(p.x, p.z, 'round', 1.0); }
      if (removedH[i][j]) for (let k = 1; k < 5; k++) { const p = cityPt(CL[j] + k * 20, CL[i]); if (blockAt(p.x, p.z)) addTree(p.x, p.z, 'round', 1.0); }
    }
  // traffic lights on two corners of real intersections
  for (const jn of junctions) {
    if (jn.deg < 3 || jn.i === 0 || jn.j === 0 || jn.i === 16 || jn.j === 16) continue;
    const lx = CL[jn.i], lz = CL[jn.j];
    for (const [sx, sz] of [[1, 1], [-1, -1]]) {
      const p = cityPt(lx + sx * 8.2, lz + sz * 8.2);
      if (!blockAt(p.x, p.z)) continue;
      props.push({ file: 'kk_trafficlight_A', x: p.x, z: p.z, rot: Math.atan2(-sx, -sz) + cityAngle(lx, lz), h: 5.2, col: 0.25 });
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
    for (let z = -790; z < 790; z += 18)
      for (const ox of [-9.5, 9.5]) {
        const p = cityPt(x + ox, z);
        if (blockAt(p.x, p.z)) addTree(p.x, p.z, 'round', 0.9);
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
  { const p = cityPt(CL[10] + 50, CL[2] + 25); ramps.push({ x: p.x, z: p.z, rot: cityAngle(CL[10] + 50, CL[2] + 25), w: 7, len: 16, h: 3.5 }); } // park ramp in city
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
      if (o.t === 0 && x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1 && o.y1 <= maxY + 1.0 && o.y1 > h && inBox(o, x, z)) h = o.y1;
  const rh = rampHeight(x, z);
  if (rh !== null && rh <= lim && rh > h) h = rh;
  return h;
}

export function isWater(x, z) {
  const w = waterLevel(x, z);
  return terrainHeight(x, z) < w - 0.5 && roadAt(x, z, w + 0.5) === null && !blockAt(x, z);
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
        // work in the box's own frame
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
        // back to world
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
  if (Math.abs(x) < 820 && Math.abs(z) < 820) {
    const g = gangAt(x, z);
    if (g) return g.id === 'kingz' ? 'Kingz Turf' : 'Viper Blocks';
    if (riverDist(x, z) < 70) return 'Riverside';
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
  return cityPt(cx ? r.x1 - 1.6 : r.x0 + 1.6, cz ? r.z1 - 1.6 : r.z0 + 1.6, out);
}
export function walkableBlock(bi, bj) {
  return bi >= 0 && bj >= 0 && bi < 16 && bj < 16 && blockType[bi][bj] !== 'river' && blockType[bi][bj] !== 'void';
}

let built = false;
export function generateWorldData() {
  if (built) return;
  built = true;
  genRiver();
  assignBlockTypes();
  pickRemovedStreets();
  buildRoads();
  regSegs();
  genTerrain();
  genCity();
  genOutside();
}
