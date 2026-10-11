// Turns world data into meshes; sky, lighting and day/night cycle.
import * as THREE from 'three';
import { G, clamp, lerp, sstep, WATER } from './core.js';
import {
  H, TN, TS, HALF, segs, roads, junctions, buildings, trees, lamps, ramps, decor, signs, props, SIDEWALK, CURB, fences, beachProps,
  terrainHeight, biomeAt, urbanAt, BIOMES, AIRPORTS, generateWorldData, styleOf, styleAt,
} from './terrain.js';
import { STYLES } from './districts.js';
import { buildDressing, updateDressing } from './dressing.js';
import { noise2 } from './noise.js';
import { mergeGeos } from './models.js';
import { hasModel, instanceProp, updateTileVisibility, TILED } from './assets.js';
import { terrainMaterial, terrainTextured, splatWeights, patchWaterShore, initGroundDetail, updateGroundDetail } from './ground.js';
import { buildFlora, buildFences, buildBeachProps, updateFloraVisibility } from './flora.js';
import { buildAtmosphere, updateAtmosphere, roadMats } from './gfx.js';

const M4 = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const V = new THREE.Vector3();
const S = new THREE.Vector3();
const C = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const TILE = 500;

let lampMat, waterMat;

// ---------------------------------------------------------------- textures
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function asphalt(g, w, h, base = 58) {
  g.fillStyle = `rgb(${base},${base},${base + 3})`;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h * 0.08; i++) {
    const v = base + (Math.random() - 0.5) * 26;
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}
// road markings: v runs along the road (one texture repeat = 20 m)
function roadTexture(kind) {
  return canvasTex(256, 512, (g, w, h) => {
    asphalt(g, w, h);
    if (kind === 'main') {
      g.fillStyle = '#e8c547';
      g.fillRect(w * 0.5 - 7, 0, 4, h);
      g.fillRect(w * 0.5 + 3, 0, 4, h);
      g.fillStyle = '#eeeeee';
      g.fillRect(w * 0.04, 0, 4, h);
      g.fillRect(w * 0.96 - 4, 0, 4, h);
      for (let y = 0; y < h; y += 128) {
        g.fillRect(w * 0.27, y, 3, 64);
        g.fillRect(w * 0.73, y, 3, 64);
      }
    } else if (kind === 'city') {
      g.fillStyle = '#e9e9e9';
      for (let y = 0; y < h; y += 128) g.fillRect(w * 0.5 - 2, y, 4, 64);
    } else {
      g.fillStyle = '#e8c547';
      for (let y = 0; y < h; y += 160) g.fillRect(w * 0.5 - 2, y, 4, 90);
      g.fillStyle = '#d8d8d8';
      g.fillRect(w * 0.05, 0, 3, h);
      g.fillRect(w * 0.95 - 3, 0, 3, h);
    }
  });
}

// district asphalt tints folded into four tones (fewer materials, fewer draw calls)
const TONES = [0x6c6c70, 0x7a7a7e, 0x85837f, 0x9a9088];
function roadTone(hex) {
  const r = (hex >> 16) & 255, b = hex & 255;
  if (r - b > 12) return TONES[3]; // warm, dusty
  return r < 0x72 ? TONES[0] : r < 0x80 ? TONES[1] : TONES[2];
}
// district pavements, drawn at load time (one texture repeat = 3 m across the pavement)
function pavementMaterial(key) {
  const rnd = mulberryLocal(key.length * 97 + 13);
  const tex = canvasTex(128, 128, (g, w, h) => {
    const speck = (n, lo, hi, a = 0.35) => { for (let i = 0; i < n; i++) { const v = lo + rnd() * (hi - lo); g.fillStyle = `rgba(${v},${v},${v},${a})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); } };
    if (key === 'granite') {
      // big pale granite flags
      g.fillStyle = '#c4c1ba'; g.fillRect(0, 0, w, h);
      speck(1600, 120, 230, 0.3);
      g.strokeStyle = 'rgba(60,60,60,0.4)'; g.lineWidth = 1.5;
      for (let y = 0; y <= h; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      for (let x = 0; x <= w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    } else if (key === 'brick' || key === 'terra') {
      // herringbone-ish pavers: red brick or terracotta
      g.fillStyle = key === 'brick' ? '#6e3a2c' : '#8a5a42'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 16) {
        const o = (y / 8) % 2 ? 8 : 0, v = 0.82 + rnd() * 0.3;
        const [r, gg, b] = key === 'brick' ? [150, 72, 54] : [196, 120, 82];
        g.fillStyle = `rgb(${r * v | 0},${gg * v | 0},${b * v | 0})`;
        g.fillRect(x + o + 1, y + 1, 14, 6);
      }
    } else if (key === 'pink') {
      // terrazzo: warm pink with chips and wide joints
      g.fillStyle = '#e6c2bc'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) { const c = ['#f6e7e2', '#c99a92', '#ffffff', '#b8a49c'][i % 4]; g.fillStyle = c; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); }
      g.fillStyle = 'rgba(255,255,255,0.7)';
      for (let y = 0; y < h; y += 43) g.fillRect(0, y, w, 2);
    } else if (key === 'dust') {
      // cracked, sun-bleached concrete with sand drifted on it
      g.fillStyle = '#c2ab8c'; g.fillRect(0, 0, w, h);
      speck(1200, 150, 220, 0.35);
      g.strokeStyle = 'rgba(80,60,40,0.45)'; g.lineWidth = 1;
      for (let i = 0; i < 9; i++) { g.beginPath(); let x = rnd() * w, y = rnd() * h; g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (rnd() - 0.5) * 30; y += (rnd() - 0.5) * 30; g.lineTo(x, y); } g.stroke(); }
      g.strokeStyle = 'rgba(70,60,50,0.4)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    } else {
      // 'dark': worn grey concrete with stains
      g.fillStyle = '#7e7c78'; g.fillRect(0, 0, w, h);
      speck(1400, 70, 140, 0.4);
      for (let i = 0; i < 6; i++) { const gr = g.createRadialGradient(rnd() * w, rnd() * h, 0, rnd() * w, rnd() * h, 20); gr.addColorStop(0, 'rgba(30,28,26,0.35)'); gr.addColorStop(1, 'rgba(30,28,26,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
      g.strokeStyle = 'rgba(40,40,40,0.4)'; g.lineWidth = 2;
      for (let y = 0; y <= h; y += 42) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    }
  });
  return new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
}
function mulberryLocal(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------- terrain
function terrainColor(x, z, h, slope, out) {
  const n = noise2(x * 0.02, z * 0.02) * 0.05 + noise2(x * 0.2, z * 0.2) * 0.02;
  const b = biomeAt(x, z);
  let r = 0.36, g = 0.54, bl = 0.24;
  if (b === BIOMES.FOREST) { r = 0.22; g = 0.42; bl = 0.17; }
  else if (b === BIOMES.DESERT) { r = 0.82; g = 0.64; bl = 0.42; }
  else if (b === BIOMES.WETLAND) { r = 0.3; g = 0.42; bl = 0.22; }
  else if (b === BIOMES.BEACH) { r = 0.84; g = 0.77; bl = 0.58; }
  const u = urbanAt(x, z);
  if (u > 0.05) { const k = sstep(0.05, 0.5, u) * 0.8; r = lerp(r, 0.42, k); g = lerp(g, 0.45, k); bl = lerp(bl, 0.38, k); }
  // rock on steep slopes and high ground, snow on the peaks
  const rock = clamp(slope * 1.4 - 0.5 + (h - 220) / 260, 0, 1);
  r = lerp(r, 0.47, rock); g = lerp(g, 0.44, rock); bl = lerp(bl, 0.41, rock);
  const snow = sstep(430, 520, h + n * 300) * (1 - clamp(slope - 0.9, 0, 1));
  r = lerp(r, 0.95, snow); g = lerp(g, 0.96, snow); bl = lerp(bl, 0.98, snow);
  if (h < 2.0 && h > -1.5) { r = 0.82; g = 0.76; bl = 0.58; }
  if (h <= -1.5) { const k = clamp(-h / 25, 0, 1); r = lerp(0.62, 0.3, k); g = lerp(0.58, 0.32, k); bl = lerp(0.44, 0.3, k); }
  out.setRGB(clamp(r + n, 0, 1), clamp(g + n, 0, 1), clamp(bl + n * 0.5, 0, 1));
}

function buildTerrain(scene) {
  const mat = terrainMaterial(); // splat-textured (ground.js), or plain vertex colours without textures
  const tex = terrainTextured();
  const CH = 55; // cells per chunk (825 = 15 x 55)
  const NCH = Math.ceil(TN / CH);
  const hAt = (i, j) => H[clamp(j, 0, TN) * (TN + 1) + clamp(i, 0, TN)];
  for (let cj = 0; cj < NCH; cj++)
    for (let ci = 0; ci < NCH; ci++) {
      const n = CH + 1;
      // skip chunks that are entirely deep sea (the sea floor is hidden by the water)
      let maxH = -Infinity;
      for (let j = 0; j < n; j += 5) for (let i = 0; i < n; i += 5) maxH = Math.max(maxH, hAt(ci * CH + i, cj * CH + j));
      if (maxH < -14) continue;
      const pos = new Float32Array(n * n * 3);
      const nor = new Float32Array(n * n * 3);
      const col = new Float32Array(n * n * 3);
      const tint = new Float32Array(n * n * 3);
      const sa = tex ? new Float32Array(n * n * 4) : null, sb = tex ? new Float32Array(n * n * 4) : null;
      let k = 0;
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const gi = ci * CH + i, gj = cj * CH + j;
          const x = -HALF + gi * TS, z = -HALF + gj * TS;
          const h = hAt(gi, gj);
          pos[k] = x; pos[k + 1] = h; pos[k + 2] = z;
          const dx = hAt(gi + 1, gj) - hAt(gi - 1, gj), dz = hAt(gi, gj + 1) - hAt(gi, gj - 1);
          V.set(-dx, 2 * TS, -dz).normalize();
          nor[k] = V.x; nor[k + 1] = V.y; nor[k + 2] = V.z;
          terrainColor(x, z, h, Math.hypot(dx, dz) / (2 * TS), C);
          if (tex) splatWeights(x, z, h, Math.hypot(dx, dz) / (2 * TS), sa, sb, (k / 3) * 4);
          // district ground tint (lawns greener, docks greyer, desert town dustier), averaged over 5 taps
          let tr = 0, tg = 0, tb = 0;
          for (const [ox, oz] of [[0, 0], [22, 9], [-22, -9], [9, -22], [-9, 22]]) { const t = STYLES[styleAt(x + ox, z + oz)].tint; tr += t[0]; tg += t[1]; tb += t[2]; }
          tint[k] = tr / 5; tint[k + 1] = tg / 5; tint[k + 2] = tb / 5;
          if (!tex) { C.r *= tint[k]; C.g *= tint[k + 1]; C.b *= tint[k + 2]; }
          col[k] = C.r; col[k + 1] = C.g; col[k + 2] = C.b;
          k += 3;
        }
      const idx = [];
      for (let j = 0; j < CH; j++)
        for (let i = 0; i < CH; i++) {
          const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      if (tex) { geo.setAttribute('splatA', new THREE.BufferAttribute(sa, 4)); geo.setAttribute('splatB', new THREE.BufferAttribute(sb, 4)); geo.setAttribute('tint', new THREE.BufferAttribute(tint, 3)); }
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      scene.add(m);
    }
}

// ---------------------------------------------------------------- roads
function pushQuad(arr, p, uv, ax, ay, az, bx, by, bz, w, v0, v1) {
  const dx = bx - ax, dz = bz - az;
  const L = Math.hypot(dx, dz);
  const ux = dx / L, uz = dz / L;
  const px = -uz * w / 2, pz = ux * w / 2;
  const o = p.length / 3;
  p.push(ax + px, ay, az + pz, ax - px, ay, az - pz, bx + px, by, bz + pz, bx - px, by, bz - pz);
  uv.push(0, v0, 1, v0, 0, v1, 1, v1);
  arr.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
}
function meshFrom(p, uv, idx, mat, extra) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  if (uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (extra) for (const k of Object.keys(extra)) geo.setAttribute(k, new THREE.Float32BufferAttribute(extra[k], 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}
// per-tile geometry buckets so far-away roads can be culled
function bucket(map, x, z) {
  const k = Math.floor(x / TILE) + ':' + Math.floor(z / TILE);
  let b = map.get(k);
  if (!b) map.set(k, (b = { p: [], uv: [], i: [], c: [], x: (Math.floor(x / TILE) + 0.5) * TILE, z: (Math.floor(z / TILE) + 0.5) * TILE }));
  return b;
}
function addTiled(scene, map, mat, withColor = false) {
  for (const b of map.values()) {
    if (!b.i.length) continue;
    const m = meshFrom(b.p, withColor ? null : b.uv, b.i, mat, withColor ? { color: b.c } : null);
    m.userData.tile = { x: b.x, z: b.z, r: TILE * 0.75 };
    TILED.push(m);
    scene.add(m);
  }
}

// offset polyline: points of a road with distance along it
function roadPath(road) {
  const P = [];
  let d = 0;
  for (let k = 0; k < road.nodes.length; k++) {
    const n = road.nodes[k];
    if (k > 0) d += Math.hypot(n.x - road.nodes[k - 1].x, n.z - road.nodes[k - 1].z);
    const a = road.nodes[Math.max(0, k - 1)], b = road.nodes[Math.min(road.nodes.length - 1, k + 1)];
    let dx = b.x - a.x, dz = b.z - a.z;
    const L = Math.hypot(dx, dz) || 1;
    P.push({ x: n.x, z: n.z, h: n.h, d, dx: dx / L, dz: dz / L });
  }
  return P;
}
// strip between lateral offsets o0..o1 (metres, + = left), from distance d0 to d1 along the road
function stripRange(B, P, o0, o1, lift, d0, d1, uScale = null) {
  let prev = null;
  for (let k = 0; k < P.length; k++) {
    let p = P[k];
    if (p.d < d0 && (k === P.length - 1 || P[k + 1].d <= d0)) continue;
    if (p.d > d1 && prev && prev.d >= d1) break;
    // clamp the first/last point onto d0/d1
    if (p.d < d0 && k < P.length - 1) {
      const q = P[k + 1], t = (d0 - p.d) / (q.d - p.d);
      p = { x: lerp(p.x, q.x, t), z: lerp(p.z, q.z, t), h: lerp(p.h, q.h, t), d: d0, dx: p.dx, dz: p.dz };
    } else if (p.d > d1 && prev) {
      const t = (d1 - prev.d) / (p.d - prev.d);
      p = { x: lerp(prev.x, p.x, t), z: lerp(prev.z, p.z, t), h: lerp(prev.h, p.h, t), d: d1, dx: p.dx, dz: p.dz };
    }
    const b = bucket(B, p.x, p.z);
    const nx = -p.dz, nz = p.dx;
    const o = b.p.length / 3;
    b.p.push(p.x + nx * o0, p.h + lift, p.z + nz * o0, p.x + nx * o1, p.h + lift, p.z + nz * o1);
    const v = p.d / 20;
    b.uv.push(uScale ? o0 / uScale : 0, v, uScale ? o1 / uScale : 1, v);
    if (prev && prev.b === b) b.i.push(prev.o, o, prev.o + 1, prev.o + 1, o, o + 1);
    else if (prev) {
      // crossing into a new tile: repeat the previous pair so the strip stays continuous
      const o2 = b.p.length / 3;
      b.p.push(prev.x0, prev.y, prev.z0, prev.x1, prev.y, prev.z1);
      b.uv.push(prev.u0, prev.v, prev.u1, prev.v);
      b.i.push(o2, o, o2 + 1, o2 + 1, o, o + 1);
    }
    prev = { b, o, x0: p.x + nx * o0, z0: p.z + nz * o0, x1: p.x + nx * o1, z1: p.z + nz * o1, y: p.h + lift, v, u0: uScale ? o0 / uScale : 0, u1: uScale ? o1 / uScale : 1, d: p.d };
    if (p.d >= d1) break;
  }
}

// asphalt is a standard material so it can take a wet-looking sheen at night (gfx.js drives roughness)
function roadMat(o) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0, ...o });
  m.userData.gfx = 'road';
  roadMats.push(m);
  return m;
}
function buildRoads(scene) {
  const mats = {
    main: roadMat({ map: roadTexture('main'), side: THREE.DoubleSide }),
    city: roadMat({ map: roadTexture('city'), side: THREE.DoubleSide }),
    rural: roadMat({ map: roadTexture('rural'), side: THREE.DoubleSide }),
  };
  const walkMat = new THREE.MeshLambertMaterial({ map: canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#a7a59e'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(70,70,70,0.35)'; g.lineWidth = 2;
    for (let y = 0; y <= h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
    for (let i = 0; i < 900; i++) { const v = 150 + Math.random() * 40; g.fillStyle = `rgba(${v},${v},${v},0.4)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  }), side: THREE.DoubleSide });
  const curbMat = new THREE.MeshLambertMaterial({ color: 0x9a978f, side: THREE.DoubleSide });
  const jMat = roadMat({ map: canvasTex(128, 128, (g, w, h) => asphalt(g, w, h)), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
  const crossMat = new THREE.MeshLambertMaterial({ map: canvasTex(256, 64, (g, w, h) => {
    asphalt(g, w, h);
    g.fillStyle = '#efefef';
    for (let x = 10; x < w; x += 26) g.fillRect(x, 4, 14, h - 8);
  }), polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide });

  // asphalt tinted per district (bleached in the desert, dark and fresh downtown), pavements per district
  const tinted = {};
  const tintedRoadMat = (kind, tint) => {
    const k = kind + tint;
    // Color(hex) is already linear: scale so the neutral grey 0x7a7a7a leaves the asphalt 15 % lighter than before
    if (!tinted[k]) {
      tinted[k] = mats[kind].clone();
      tinted[k].color = new THREE.Color(tint).multiplyScalar(1.15 / new THREE.Color(0x7a7a7a).r);
      roadMats.push(tinted[k]); // gfx.js drives the night wet sheen on every road material
    }
    return tinted[k];
  };
  const paveMats = {};
  const paveMat = (key) => (paveMats[key] = paveMats[key] || pavementMaterial(key));
  const B = { main: new Map(), city: new Map(), rural: new Map() };
  const BT = new Map(); // `${kind}|${tint}` -> buckets
  const walkBy = new Map(); // pave key -> buckets
  const walk = new Map(), curb = new Map(), jn = new Map(), cross = new Map();
  // how far a road's pavement stops short of a junction
  const clearAt = (n) => (n.edges.length >= 3 ? Math.max(...n.edges.map((e) => e.s.w)) / 2 + SIDEWALK : 0);
  for (const road of roads) {
    const P = roadPath(road);
    const L = P[P.length - 1].d;
    const mid = road.nodes[Math.floor(road.nodes.length / 2)];
    const rst = styleOf(mid.x, mid.z);
    const rk = road.kind + '|' + roadTone(rst.road);
    if (!BT.has(rk)) BT.set(rk, new Map());
    stripRange(BT.get(rk), P, road.w / 2, -road.w / 2, 0.06, 0, L);
    if (!walkBy.has(rst.pave)) walkBy.set(rst.pave, new Map());
    const walkB = walkBy.get(rst.pave);
    const pave = road.segs.some((s) => s.sidewalk);
    if (!pave) continue;
    const a = road.nodes[0], z = road.nodes[road.nodes.length - 1];
    const d0 = clearAt(a), d1 = L - clearAt(z);
    if (d1 - d0 < 2) continue;
    // pavements on both sides (+ curb faces), only along stretches flagged as town streets
    let runStart = null;
    for (let k = 0; k <= road.segs.length; k++) {
      const on = k < road.segs.length && road.segs[k].sidewalk;
      const dk = P[k].d;
      if (on && runStart === null) runStart = dk;
      if (!on && runStart !== null) {
        const s0 = Math.max(runStart, d0), s1 = Math.min(dk, d1);
        if (s1 - s0 > 1) {
          for (const side of [1, -1]) {
            const i0 = side * road.w / 2, i1 = side * (road.w / 2 + SIDEWALK);
            stripRange(walkB, P, i0, i1, 0.06 + CURB, s0, s1, 3);
          }
        }
        runStart = null;
      }
    }
    // crosswalks where town streets meet
    for (const [n, at] of [[a, 0], [z, L]]) {
      if (n.edges.length < 3 || road.kind === 'rural') continue;
      const dd = clearAt(n) - 1.5;
      if (L < dd * 2 + 6) continue;
      const k = at === 0 ? 0 : P.length - 1;
      const dir = at === 0 ? 1 : -1;
      const p = P[k];
      const cx = p.x + p.dx * dir * dd, cz = p.z + p.dz * dir * dd;
      const b = bucket(cross, cx, cz);
      pushQuad(b.i, b.p, b.uv, cx - p.dx * 2, p.h + 0.09, cz - p.dz * 2, cx + p.dx * 2, p.h + 0.09, cz + p.dz * 2, road.w, 0, 1);
    }
  }
  // curb faces: vertical strips at the pavement edge
  for (const road of roads) {
    if (!road.segs.some((s) => s.sidewalk)) continue;
    const P = roadPath(road);
    const L = P[P.length - 1].d;
    const a = road.nodes[0], z = road.nodes[road.nodes.length - 1];
    const d0 = clearAt(a), d1 = L - clearAt(z);
    for (const side of [1, -1]) {
      const off = side * road.w / 2;
      let prev = null;
      for (let k = 0; k < P.length; k++) {
        const p = P[k];
        const on = (road.segs[Math.min(k, road.segs.length - 1)] || {}).sidewalk && p.d >= d0 && p.d <= d1;
        if (!on) { prev = null; continue; }
        const b = bucket(curb, p.x, p.z);
        const nx = -p.dz, nz = p.dx;
        const o = b.p.length / 3;
        b.p.push(p.x + nx * off, p.h + 0.06, p.z + nz * off, p.x + nx * off, p.h + 0.06 + CURB, p.z + nz * off);
        b.uv.push(0, 0, 0, 1);
        if (prev && prev.b === b) b.i.push(prev.o, o, prev.o + 1, prev.o + 1, o, o + 1);
        prev = { b, o };
      }
    }
  }
  // junction patches: discs of asphalt cover overlapping road ends
  for (const n of junctions) {
    const r = Math.max(...n.edges.map((e) => e.s.w)) / 2 + 1.5;
    const b = bucket(jn, n.x, n.z);
    const o = b.p.length / 3;
    b.p.push(n.x, n.h + 0.08, n.z);
    b.uv.push(0.5, 0.5);
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      b.p.push(n.x + Math.cos(a) * r, n.h + 0.08, n.z + Math.sin(a) * r);
      b.uv.push(0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5);
    }
    for (let k = 0; k < 12; k++) b.i.push(o, o + 1 + ((k + 1) % 12), o + 1 + k);
  }
  for (const [k, map] of BT) { const [kind, tint] = k.split('|'); addTiled(scene, map, tintedRoadMat(kind, +tint)); }
  for (const [k, map] of walkBy) addTiled(scene, map, k === 'conc' ? walkMat : paveMat(k));
  void B; void walk;
  addTiled(scene, curb, curbMat);
  addTiled(scene, jn, jMat);
  addTiled(scene, cross, crossMat);

  // bridges: deck, rails and pillars under every segment that crosses water
  for (const s of segs) {
    if (!s.bridge) continue;
    const mx = (s.a.x + s.b.x) / 2, mz = (s.a.z + s.b.z) / 2, mh = (s.a.h + s.b.h) / 2;
    const dir = V.set(s.b.x - s.a.x, s.b.h - s.a.h, s.b.z - s.a.z).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const L = Math.hypot(s.b.x - s.a.x, s.b.h - s.a.h, s.b.z - s.a.z) + 0.6;
    addBox(mx, mh - 0.65, mz, s.w + 1.6, 1.3, L, 0, 0x8d8a84, q);
    for (const side of [-1, 1]) {
      const ox = -s.dz * (s.w / 2 + 0.5) * side, oz = s.dx * (s.w / 2 + 0.5) * side;
      addBox(mx + ox, mh + 0.55, mz + oz, 0.35, 1.1, L, 0, 0xb5b0a8, q);
    }
    s.road.pillarAcc = (s.road.pillarAcc || 0) + s.len;
    const tg = terrainHeight(mx, mz);
    if (s.road.pillarAcc > 36 && mh - tg > 3) {
      s.road.pillarAcc = 0;
      const bot = Math.min(tg, -3) - 2;
      addBox(mx, (mh - 1.3 + bot) / 2, mz, s.w * 0.7, mh - 1.3 - bot, 2.4, Math.atan2(s.dx, s.dz), 0x7d7a74);
    }
  }
}

const boxList = []; // generic instanced boxes {m:Matrix4,color}
function addBox(x, y, z, sx, sy, sz, rotY, color, q = null) {
  if (q) Q.copy(q);
  else Q.setFromAxisAngle(UP, rotY);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), Q.clone(), new THREE.Vector3(sx, sy, sz));
  boxList.push({ m, color });
}

// instanced boxes split into tiles for distance culling
function tiledInstances(scene, geo, mat, list, setup, shadow = true) {
  const tiles = new Map();
  for (const b of list) {
    const k = Math.floor(b.cx / TILE) + ':' + Math.floor(b.cz / TILE);
    if (!tiles.has(k)) tiles.set(k, []);
    tiles.get(k).push(b);
  }
  for (const [k, l] of tiles) {
    const m = new THREE.InstancedMesh(geo, mat, l.length);
    l.forEach((b, i) => setup(m, b, i));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.castShadow = shadow;
    m.receiveShadow = true;
    const [ti, tj] = k.split(':').map(Number);
    m.userData.tile = { x: (ti + 0.5) * TILE, z: (tj + 0.5) * TILE, r: TILE * 0.75 };
    m.computeBoundingSphere();
    TILED.push(m);
    scene.add(m);
  }
}

// ---------------------------------------------------------------- buildings
// Every building is one instanced "shell" (walls, a parapet rim and a roof) whose facade is drawn
// in the fragment shader on a grid measured in METRES: fixed storey heights, window and door
// sizes, so a 30 m block and a 9 m one have the same 2.2 m doors. Facade type, ground floor kind,
// a seed and the street level come from terrain.js (b.fac, b.gf, b.seed, b.gy).

// tileable detail texture covering 2.4 x 2.4 m: R brick (0 = mortar), G stucco, B concrete panels,
// A large soft noise (grime). Generated here so it costs no download.
function detailTexture() {
  const N = 256, data = new Uint8Array(N * N * 4);
  const rnd = (i, j, s) => { const v = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };
  const vnoise = (x, y, P, s) => {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const a = rnd(i % P, j % P, s), b = rnd((i + 1) % P, j % P, s), c = rnd(i % P, (j + 1) % P, s), d = rnd((i + 1) % P, (j + 1) % P, s);
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  const rows = 32, perRow = 11; // 75 mm courses, 218 mm bricks
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const k = (y * N + x) * 4;
      const fy = (y / N) * rows, row = Math.floor(fy);
      const fx = (x / N) * perRow + (row % 2) * 0.5, col = Math.floor(fx);
      const my = fy - row, mx = fx - col;
      const mortar = my < 0.16 || mx < 0.045;
      data[k] = mortar ? 0 : 150 + rnd(col % perRow, row, 1) * 105;
      data[k + 1] = 205 + (vnoise(x / 8, y / 8, 32, 2) * 0.6 + vnoise(x / 2, y / 2, 128, 3) * 0.4) * 50;
      const px = x % 128, py = y % 128;
      const joint = px < 2 || py < 2;
      data[k + 2] = joint ? 120 : 200 + vnoise(x / 6, y / 6, 43, 4) * 40 + (rnd(x, y, 5) - 0.5) * 16;
      data[k + 3] = vnoise(x / 32, y / 32, 8, 6) * 160 + vnoise(x / 8, y / 8, 32, 7) * 95;
    }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// unit shell: x,z in [-0.5,0.5], y in [0,1]. aRim.x = inset (parapet inner edge), aRim.y = rise (parapet
// top). The vertex shader turns those into metres; unmodified (shadow pass) it is a plain box.
function shellGeometry() {
  const P = [], Nn = [], A = [];
  const tri = (v, n) => {
    // keep the winding facing n, judged on a nominal 10 m box (inset 0.3 m, rise 0.9 m)
    const q = v.map(([x, y, z, i, r]) => new THREE.Vector3(x - Math.sign(x) * i * 0.03, y + r * 0.09, z - Math.sign(z) * i * 0.03));
    const c = new THREE.Vector3().subVectors(q[1], q[0]).cross(new THREE.Vector3().subVectors(q[2], q[0]));
    if (c.dot(new THREE.Vector3(...n)) < 0) v = [v[0], v[2], v[1]];
    for (const [x, y, z, i, r] of v) { P.push(x, y, z); Nn.push(...n); A.push(i, r); }
  };
  const quad = (a, b, c, d, n) => { tri([a, b, c], n); tri([a, c, d], n); };
  for (const [nx, nz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
    const tx = -nz, tz = nx;
    const c0 = [0.5 * nx - 0.5 * tx, 0.5 * nz - 0.5 * tz], c1 = [0.5 * nx + 0.5 * tx, 0.5 * nz + 0.5 * tz];
    quad([c0[0], 0, c0[1], 0, 0], [c1[0], 0, c1[1], 0, 0], [c1[0], 1, c1[1], 0, 1], [c0[0], 1, c0[1], 0, 1], [nx, 0, nz]); // outer wall
    quad([c0[0], 1, c0[1], 0, 1], [c1[0], 1, c1[1], 0, 1], [c1[0], 1, c1[1], 1, 1], [c0[0], 1, c0[1], 1, 1], [0, 1, 0]); // coping
    quad([c0[0], 1, c0[1], 1, 1], [c1[0], 1, c1[1], 1, 1], [c1[0], 1, c1[1], 1, 0], [c0[0], 1, c0[1], 1, 0], [-nx, 0, -nz]); // parapet inside
  }
  quad([-0.5, 1, -0.5, 1, 0], [0.5, 1, -0.5, 1, 0], [0.5, 1, 0.5, 1, 0], [-0.5, 1, 0.5, 1, 0], [0, 1, 0]); // roof
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
  g.setAttribute('aRim', new THREE.Float32BufferAttribute(A, 2));
  return g;
}

const FACADE_GLSL = /* glsl */ `
varying vec3 vWP; varying vec3 vWN; varying vec3 vNW; varying vec3 vLP; flat varying vec4 vFac; flat varying vec3 vDim; varying float vInner;
uniform float uNight; uniform sampler2D uDetail;
vec3 bEm; float bGlass; vec3 bTint;
// window modifiers set per fragment before windowAt: arched tops, shutters, muntin grid, boarded-up
// windows (chance), iron bars
float gArch, gShut, gGrid, gBoard, gBars; vec3 gShutCol;
// sine-free hash (stable on mobile GPUs and SwiftShader)
float h21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
// anti-aliased 0..1 coverage of lo < x < hi
float bx(float x, float lo, float hi) { float w = fwidth(x) * 0.7 + 1e-4; return smoothstep(lo - w, lo + w, x) * (1.0 - smoothstep(hi - w, hi + w, x)); }
// glass: sky reflection by day, an interior (curtains, lit rooms) behind it. kind 0 home, 1 shop, 2 office
vec3 glassCol(float key, float kind, float cov, float yIn) {
  vec3 vd = normalize(vWP - cameraPosition);
  vec3 nw = normalize(vNW);
  vec3 r = reflect(vd, nw);
  float fres = pow(1.0 - abs(dot(vd, nw)), 2.0);
  float day = 1.0 - uNight;
  vec3 sky = mix(vec3(0.16, 0.17, 0.18), vec3(0.52, 0.64, 0.78), clamp(r.y * 2.5 + 0.35, 0.0, 1.0)) * (0.15 + 0.85 * day) * bTint;
  float k2 = h21(vec2(key, 3.7));
  vec3 room = vec3(0.07, 0.075, 0.08);
  if (kind < 0.5) {
    if (k2 < 0.3) room = mix(room, vec3(0.55, 0.47, 0.36), step(0.45, yIn));
    else if (k2 < 0.45) room = vec3(0.42, 0.42, 0.4) * (0.75 + 0.25 * step(0.5, fract(yIn * 14.0)));
  } else if (kind < 1.5) {
    // a lit shop: shelves and goods in bands, a darker ceiling
    vec3 goods = vec3(0.5 + 0.5 * cos(6.283 * (h21(vec2(key, floor(yIn * 7.0))) + vec3(0.0, 0.33, 0.67))));
    room = mix(vec3(0.4, 0.37, 0.33), goods * 0.45, 0.3 * step(0.15, yIn) * step(yIn, 0.7)) * mix(1.0, 0.5, step(0.85, yIn)) * mix(0.8, 1.0, step(0.5, fract(yIn * 7.0)));
    bEm += cov * day * room * 0.3;
  }
  float lit = kind > 0.5 && kind < 1.5 ? step(0.12, k2) : step(kind > 1.5 ? 0.5 : 0.56, h21(vec2(key, 9.1)));
  vec3 lc = kind > 1.5 ? mix(vec3(0.85, 0.9, 1.0), vec3(1.0, 0.85, 0.6), step(0.6, k2)) * (0.6 + 0.5 * k2) : vec3(1.0, 0.8, 0.52) * (0.8 + 0.4 * k2);
  bEm += cov * (lit * uNight * (kind > 0.5 && kind < 1.5 ? mix(lc, room * 1.6, 0.6) * 0.75 : lc * (kind > 1.5 ? 0.42 : 0.6)) * (0.55 + 0.45 * smoothstep(0.0, 0.6, room.r + 0.3)) + sky * fres * 0.35 * day);
  bGlass += cov;
  return mix(room, sky, (kind > 1.5 ? 0.5 : 0.25) + 0.5 * fres);
}
// a punched window in a bay grid; fy = height within the storey
void windowAt(float u, float fy, float faceW, float bayT, float winW, float winH, float sill, float key, float kind, float frameW, vec3 frameCol, vec3 sillCol, float lintel, inout vec3 col) {
  float nb = max(1.0, floor(faceW / bayT + 0.5));
  float bw = faceW / nb;
  float bi = floor(u / bw);
  float fx = u - (bi + 0.5) * bw;
  float k = key + bi * 7.31;
  float hw = min(winW, bw - 0.5) * 0.5;
  float outer = bx(fx, -hw, hw) * bx(fy, sill, sill + winH);
  float inner = bx(fx, -hw + frameW, hw - frameW) * bx(fy, sill + frameW, sill + winH - frameW);
  if (gArch > 0.5) {
    // round-headed window: the top hw of the opening is a half circle
    float ay = sill + winH - hw;
    float rr = length(vec2(fx, fy - ay));
    float w2 = fwidth(rr) + 1e-3;
    float up = step(ay, fy);
    outer *= mix(1.0, 1.0 - smoothstep(hw - w2, hw + w2, rr), up);
    inner *= mix(1.0, 1.0 - smoothstep(hw - frameW - w2, hw - frameW + w2, rr), up);
  }
  if (gShut > 0.5) {
    float sw = min(hw * 0.95, 0.6);
    float sh = (bx(fx, hw + 0.05, hw + 0.05 + sw) + bx(fx, -hw - 0.05 - sw, -hw - 0.05)) * bx(fy, sill, sill + winH);
    col = mix(col, gShutCol * (0.8 + 0.2 * step(0.35, fract(fy / 0.11))), sh);
  }
  if (gBoard > 0.0 && h21(vec2(k, 5.3)) < gBoard) {
    // boarded up: plywood over the opening, no glass and no light
    col = mix(col, vec3(0.6, 0.49, 0.33) * (0.85 + 0.15 * step(0.5, fract((fx + hw) / 0.61))), outer);
    return;
  }
  if (gGrid > 0.0) inner *= 1.0 - 0.92 * max(bx(abs(fract((fx + hw) / gGrid) - 0.5), 0.45, 1.0), bx(abs(fract((fy - sill) / gGrid) - 0.5), 0.45, 1.0));
  float bar = hw > 0.62 ? bx(fx, -0.03, 0.03) : 0.0;
  bar = max(bar, bx(fy, sill + winH * 0.72 - 0.03, sill + winH * 0.72 + 0.03));
  inner *= 1.0 - bar * 0.95;
  float s = bx(fx, -hw - 0.07, hw + 0.07) * bx(fy, sill - 0.09, sill);
  col = mix(col, sillCol, s);
  if (lintel > 0.0) col = mix(col, sillCol * 0.95, bx(fx, -hw - 0.1, hw + 0.1) * bx(fy, sill + winH, sill + winH + lintel));
  col = mix(col, frameCol, outer);
  vec3 g = glassCol(k, kind, inner, (fy - sill) / winH);
  g *= mix(1.0, 0.55, bx(fy, sill + winH - frameW - 0.14, sill + winH)); // the reveal's shadow
  col = mix(col, g, inner);
  if (gBars > 0.5) col = mix(col, vec3(0.1, 0.1, 0.11), outer * max(bx(abs(fract(fx / 0.16) - 0.5), 0.4, 1.0), bx(abs(fy - sill - winH * 0.5), -1.0, 0.03)));
}
`;

const FACADE_MAIN = /* glsl */ `
{
  bEm = vec3(0.0); bGlass = 0.0; bTint = vec3(1.0);
  gArch = 0.0; gShut = 0.0; gGrid = 0.0; gBoard = 0.0; gBars = 0.0; gShutCol = vec3(0.2);
  float T = vFac.x;
  // district facades (9+) borrow a base type for the shared parts and add their own details (X)
  float X = 0.0;
  if (T > 8.5) { X = T; T = X < 10.5 ? 1.0 : X < 11.5 ? 0.0 : X < 14.5 ? 4.0 : X < 15.5 ? 0.0 : 1.0; }
  bool isTen = (X > 14.5 && X < 15.5) || X > 16.5;
  float GFk = mod(vFac.y, 4.0);
  float blank = floor(mod(vFac.y, 16.0) / 4.0 + 0.01);
  float seed = vFac.z;
  vec3 n = normalize(vWN);
  vec3 base = diffuseColor.rgb;
  vec3 col = base;
  float vH = vWP.y - vFac.w;
  float topH = vDim.z;
  if (n.y > 0.5) {
    vec4 d = texture2D(uDetail, vLP.xz / 2.4);
    col = vInner > 0.99 ? vec3(0.34, 0.33, 0.31) * (0.75 + 0.35 * d.g) * (0.85 + 0.25 * d.a) : vec3(0.66, 0.64, 0.6);
    if (X > 9.5 && X < 10.5) col = base * (0.7 + 0.25 * d.g); // adobe: mud roof
    else if (X > 8.5 && X < 9.5 && vInner < 0.99) col = base; // deco: painted coping
  } else if (n.y < -0.5) {
    col = base * 0.4;
  } else {
    bool fz = abs(n.z) > 0.5;
    float faceW = fz ? vDim.x : vDim.y;
    float u = (fz ? vLP.x * sign(n.z) : -vLP.z * sign(n.x)) + faceW * 0.5;
    float faceId = fz ? (n.z > 0.0 ? 0.0 : 2.0) : (n.x > 0.0 ? 1.0 : 3.0);
    bool front = faceId < 0.5;
    vec4 d = texture2D(uDetail, vec2(u, vWP.y) / 2.4);
    float grime = texture2D(uDetail, vec2(u + seed * 50.0, vWP.y) / 21.0).a;
    vec3 trim = vec3(0.86, 0.84, 0.79);
    if (T < 0.5) col = mix(vec3(0.66, 0.64, 0.6), base * 1.18, d.r);
    else if (T < 1.5 || (T > 3.5 && T < 5.5) || T > 7.5) col = base * (0.86 + 0.16 * d.g);
    else if (T < 2.5 || T > 6.5) col = base * (0.78 + 0.25 * d.b);
    else if (T < 3.5) { col = vec3(0.56, 0.58, 0.6); bTint = mix(vec3(1.0), base / max(max(base.r, base.g), base.b), 0.6); }
    else col = base * (0.8 + 0.25 * step(0.5, fract(u / 0.3)));
    if (X > 8.5) {
      if (X < 9.5 || (X > 13.5 && X < 14.5)) col = base * (0.95 + 0.06 * d.g); // smooth render
      else if (X < 10.5) col = base * (0.78 + 0.32 * d.g) * (0.92 + 0.16 * d.a); // hand-laid mud
      else if (X > 11.5 && X < 12.5) col = base * (0.93 + 0.07 * d.g) * (0.84 + 0.16 * smoothstep(0.0, 0.035, fract(vWP.y / 0.21))); // weatherboard
      else if (X > 12.5 && X < 13.5) {
        // chalet: dressed stone ground floor, vertical timber boards above
        if (vH < 2.9) col = vec3(0.6, 0.58, 0.54) * (0.6 + 0.45 * d.b) * (0.85 + 0.3 * h21(floor(vec2(u / 0.7 + step(0.5, fract(vH / 0.8)) * 0.5, vH / 0.4))));
        else col = base * (0.8 + 0.25 * step(0.06, fract(u / 0.2))) * (0.9 + 0.12 * d.a);
      }
      else if (X > 15.5 && X < 16.5) col = base * (0.88 + 0.14 * d.g);
      if (X > 13.5 && X < 14.5 && fract(seed * 13.0) < 0.6 && u < faceW * 0.32) col = vec3(0.52, 0.36, 0.22) * (0.82 + 0.18 * step(0.08, fract(vH / 0.14))); // villa timber panel
    }
    col *= isTen ? 0.74 + 0.36 * grime : 0.86 + 0.18 * grime;
    col *= mix(0.8, 1.0, smoothstep(0.0, 0.5, vH));
    bool blankFace = (faceId > 2.5 && mod(blank, 2.0) > 0.5) || (faceId > 0.5 && faceId < 1.5 && blank > 1.5);
    float key = floor(seed * 997.0) + faceId * 31.0;
    if (vInner > 0.5) {
      col = base * 0.8;
    } else if (vH < 0.0) {
      col = vec3(0.45, 0.43, 0.4) * (0.8 + 0.2 * d.b);
    } else if (T > 7.5) {
      if (front) { float fx = u - faceW * 0.5; col = mix(col, vec3(0.3, 0.32, 0.33), bx(fx, -0.45, 0.45) * bx(vH, 0.0, 2.1)); }
    } else if (T > 5.5 && T < 6.5) {
      if (front) {
        float dw = min(faceW * 0.55, 14.0), dh = min(topH * 0.7, 9.0);
        float fx = u - faceW * 0.5;
        float door = bx(fx, -dw * 0.5, dw * 0.5) * bx(vH, 0.0, dh);
        col = mix(col, vec3(0.9, 0.7, 0.1), bx(fx, -dw * 0.5 - 0.25, dw * 0.5 + 0.25) * bx(vH, 0.0, dh + 0.25));
        col = mix(col, vec3(0.55, 0.57, 0.58) * (0.85 + 0.15 * step(0.5, fract(vH / 0.25))), door);
      }
    } else {
      float sH, gfH, bayT, winW, winH, sill, kind = 0.0, lintel = 0.0;
      vec3 frameCol = vec3(0.92, 0.92, 0.9), sillCol = trim;
      if (T > 3.5 && T < 4.5) { sH = 2.9; gfH = 2.9; bayT = 3.2 + seed * 0.6; winW = 1.15 + 0.25 * fract(seed * 7.0); winH = 1.35; sill = 0.9; }
      else if (T > 1.5 && T < 2.5) { sH = 3.6; gfH = GFk > 1.5 ? 5.0 : GFk > 0.5 ? 4.4 : 3.6; bayT = 1.6; winW = 1.42; winH = 1.9; sill = 0.85; kind = 2.0; frameCol = vec3(0.25, 0.27, 0.29); sillCol = col * 0.85; }
      else if (T > 2.5 && T < 3.5) { sH = 3.9; gfH = 5.0; bayT = 1.5; winW = 1.5; winH = 2.75; sill = 0.95; kind = 2.0; frameCol = vec3(0.18, 0.2, 0.22); sillCol = col; }
      else if (T > 4.5 && T < 5.5) { sH = 4.0; gfH = 5.0; bayT = 2.1; winW = 1.75; winH = 1.6; sill = 1.0; kind = 2.0; frameCol = vec3(0.6, 0.65, 0.7); }
      else if (T > 6.5) { sH = 3.8; gfH = 5.0; bayT = 2.6; winW = 1.6; winH = 1.8; sill = 1.0; kind = 2.0; frameCol = vec3(0.3, 0.32, 0.34); }
      else {
        sH = 3.2; gfH = GFk > 0.5 ? 4.4 : 3.5; bayT = 3.0 + seed * 0.8; winW = 1.25 + 0.3 * fract(seed * 7.0); winH = 1.55 + 0.25 * fract(seed * 13.0); sill = 0.85;
        if (T < 0.5) { lintel = 0.22; sillCol = vec3(0.82, 0.8, 0.74); } else frameCol = fract(seed * 5.0) < 0.5 ? vec3(0.95) : vec3(0.22, 0.24, 0.25);
      }
      if (X > 8.5) {
        if (X < 9.5) { sH = 3.2; gfH = GFk > 0.5 ? 4.4 : 3.5; bayT = 2.2 + seed * 0.6; winW = 1.6; winH = 1.35; sill = 0.95; frameCol = vec3(0.96); sillCol = min(col * 1.08, vec3(1.0)); lintel = 0.0; }
        else if (X < 10.5) { sH = 3.0; gfH = GFk > 0.5 ? 4.4 : 3.2; bayT = 3.6; winW = 0.9; winH = 1.1; sill = 1.0; frameCol = vec3(0.32, 0.22, 0.13); sillCol = vec3(0.4, 0.28, 0.17); lintel = 0.18; }
        else if (X < 11.5) { sH = 4.2; gfH = 5.0; bayT = 3.6; winW = 2.5; winH = 2.6; sill = 0.9; kind = 2.0; frameCol = vec3(0.16, 0.17, 0.18); sillCol = vec3(0.7, 0.66, 0.6); lintel = 0.3; gGrid = 0.42; }
        else if (X < 12.5) { sH = 2.9; gfH = 2.9; bayT = 3.0 + seed * 0.6; winW = 1.0; winH = 1.4; sill = 0.9; frameCol = vec3(0.96); sillCol = vec3(0.96); lintel = 0.0;
          gShut = step(0.35, fract(seed * 19.0)); float sc = fract(seed * 23.0); gShutCol = sc < 0.25 ? vec3(0.12, 0.25, 0.16) : sc < 0.5 ? vec3(0.1, 0.14, 0.25) : sc < 0.75 ? vec3(0.08) : vec3(0.45, 0.1, 0.08); }
        else if (X < 13.5) { sH = 2.9; gfH = 2.9; bayT = 2.8; winW = 1.0; winH = 1.25; sill = 0.95; frameCol = vec3(0.95); lintel = 0.0; gShut = 1.0; gShutCol = fract(seed * 7.0) < 0.5 ? vec3(0.5, 0.1, 0.08) : vec3(0.14, 0.32, 0.18); }
        else if (X < 14.5) { sH = 3.3; gfH = 3.3; bayT = 3.8; winW = 3.2; winH = 2.6; sill = 0.25; kind = 0.0; frameCol = vec3(0.15, 0.15, 0.16); sillCol = col; lintel = 0.0; }
        else if (isTen) { sH = 3.0; gfH = GFk > 0.5 ? 4.0 : 3.2; bayT = 2.5; winW = 1.05; winH = 1.5; sill = 0.9; frameCol = vec3(0.3); sillCol = vec3(0.55, 0.53, 0.5); lintel = X < 15.5 ? 0.2 : 0.0; gBoard = 0.16; }
        else { sH = 3.3; gfH = GFk > 0.5 ? 4.4 : 3.5; bayT = 3.0; winW = 1.1; winH = 1.8; sill = 0.9; frameCol = vec3(0.3, 0.2, 0.12); sillCol = col * 0.92; lintel = 0.0; gArch = 1.0; }
      }
      float nF = max(0.0, floor((topH - gfH - 0.45) / sH));
      float upTop = gfH + nF * sH;
      float frameW = 0.07;
      if (blankFace) {
        // party wall against the next unit: plain
      } else if (vH < gfH) {
        if (front && GFk > 0.5 && GFk < 1.5) {
          // shopfront: stallriser, glazing with mullions, a glazed double door, a painted fascia with lettering
          float inset = 0.35;
          float w2 = faceW - inset * 2.0;
          float nb = max(1.0, floor(w2 / 2.4 + 0.5));
          float bw = w2 / nb;
          float lu = u - inset;
          float bi = floor(lu / bw);
          float bxp = lu - (bi + 0.5) * bw;
          float doorBi = floor(fract(seed * 17.0) * nb);
          float inShop = bx(u, inset, faceW - inset);
          vec3 sc = vec3(0.5 + 0.5 * cos(6.283 * (fract(seed * 3.3) + vec3(0.0, 0.33, 0.67))));
          sc = mix(sc, vec3(0.1, 0.12, 0.14), step(0.7, fract(seed * 11.0)));
          vec3 frameS = mix(vec3(0.12, 0.13, 0.14), sc * 0.6, step(0.5, fract(seed * 23.0)));
          float isDoor = 1.0 - step(0.5, abs(bi - doorBi));
          float glassTop = 3.0;
          float pane = bx(vH, 0.45, glassTop) * (1.0 - isDoor) * bx(abs(bxp), -1.0, bw * 0.5 - 0.06);
          float dpane = isDoor * bx(bxp, -0.6, 0.6) * bx(vH, 0.0, 2.3) * (1.0 - bx(abs(bxp), 0.0, 0.035));
          float trans = isDoor * bx(vH, 2.38, glassTop) * bx(abs(bxp), -1.0, bw * 0.5 - 0.06);
          float frame = inShop * bx(vH, 0.0, glassTop + 0.12);
          col = mix(col, frameS, frame);
          col = mix(col, vec3(0.2, 0.2, 0.21) * (0.9 + 0.2 * d.b), inShop * bx(vH, 0.0, 0.45) * (1.0 - isDoor));
          float gl = inShop * max(pane, max(dpane, trans));
          col = mix(col, glassCol(key + bi * 5.0, 1.0, gl, (vH - 0.45) / 2.55), gl);
          if (isTen && fract(seed * 31.0) < 0.6) {
            // roll-down security shutters
            float shut = inShop * bx(vH, 0.0, glassTop) * (1.0 - isDoor * step(0.5, fract(seed * 7.0)));
            col = mix(col, vec3(0.5, 0.51, 0.52) * (0.8 + 0.2 * step(0.3, fract(vH / 0.09))), shut);
            bEm *= 1.0 - shut;
          }
          col = mix(col, vec3(0.75, 0.75, 0.72), isDoor * bx(vH, 1.0, 1.06) * bx(abs(bxp), 0.08, 0.45));
          float fas = inShop * bx(vH, 3.15, 3.95);
          col = mix(col, sc * 0.85, fas);
          float lu2 = (u - faceW * 0.5) / 0.3;
          float txt = bx(abs(u - faceW * 0.5), -1.0, min(faceW * 0.32, 4.5)) * bx(vH, 3.36, 3.74) * bx(fract(lu2), 0.12, 0.84) * step(0.18, h21(vec2(floor(lu2), seed)));
          vec3 tc = dot(sc, vec3(0.33)) > 0.5 ? vec3(0.08) : vec3(0.97, 0.95, 0.88);
          col = mix(col, tc, txt);
          bEm += txt * uNight * tc * 0.9 + fas * uNight * sc * 0.08;
        } else if (front && GFk > 1.5 && GFk < 2.5) {
          // lobby: tall glazing, mullions every 1.5 m
          float fx = u - faceW * 0.5;
          float g = bx(vH, 0.0, gfH - 0.7) * bx(u, 0.6, faceW - 0.6) * (1.0 - bx(abs(fract(u / 1.5) - 0.5), 0.47, 1.0));
          g *= 1.0 - bx(vH, 2.5, 2.6);
          col = mix(col, vec3(0.16, 0.17, 0.18), bx(vH, 0.0, gfH - 0.6) * bx(u, 0.5, faceW - 0.5));
          col = mix(col, glassCol(key + floor(u / 1.5) * 1.7, 2.0, g, vH / gfH), g);
          bEm += g * bx(fx, -1.6, 1.6) * uNight * vec3(1.0, 0.85, 0.6) * 0.25;
        } else if (front && GFk > 2.5) {
          float fx = u - faceW * 0.5;
          float door = bx(fx, -1.5, 1.5) * bx(vH, 0.0, 3.2);
          col = mix(col, vec3(0.62, 0.62, 0.6) * (0.85 + 0.15 * step(0.5, fract(vH / 0.2))), door);
        } else {
          // homes: windows, and the front door in one bay
          float gSill = T > 3.5 && T < 4.5 ? 0.9 : 1.0;
          float nb = max(1.0, floor(faceW / bayT + 0.5));
          float bw = faceW / nb;
          float bi = floor(u / bw);
          float fx = u - (bi + 0.5) * bw;
          float doorBi = floor(fract(seed * 29.0) * nb);
          if (front && abs(bi - doorBi) < 0.5) {
            float dh = T > 3.5 && T < 4.5 ? 2.15 : 2.3;
            vec3 dc = vec3(0.5 + 0.5 * cos(6.283 * (fract(seed * 41.0) + vec3(0.0, 0.33, 0.67)))) * 0.55;
            float outer = bx(fx, -0.6, 0.6) * bx(vH, 0.0, dh + 0.1);
            float leaf = bx(fx, -0.5, 0.5) * bx(vH, 0.05, dh);
            col = mix(col, trim, outer);
            col = mix(col, dc, leaf);
            float panel = bx(abs(fx), 0.08, 0.38) * (bx(vH, 0.25, 0.95) + bx(vH, 1.15, dh - 0.25));
            col = mix(col, dc * 0.78, leaf * panel);
            col = mix(col, vec3(0.8, 0.7, 0.35), leaf * bx(fx, 0.33, 0.41) * bx(vH, 0.98, 1.06));
            col = mix(col, vec3(0.5, 0.49, 0.46), bx(fx, -0.75, 0.75) * bx(vH, -1.0, 0.06));
            bEm += bx(fx, 0.64, 0.74) * bx(vH, 1.9, 2.1) * uNight * vec3(1.0, 0.8, 0.5);
          } else { gBars = isTen ? 1.0 : 0.0; windowAt(u, vH, faceW, bayT, winW, winH, gSill, key, kind, frameW, frameCol, sillCol, lintel, col); gBars = 0.0; }
        }
        if (T < 1.5 && (X < 0.5 || X > 10.5)) col = mix(col, trim * (T < 0.5 ? 0.95 : 1.02), bx(vH, gfH - 0.25, gfH));
      } else if (vH < upTop) {
        float fl = floor((vH - gfH) / sH);
        float fy = vH - gfH - fl * sH;
        if (T > 2.5 && T < 3.5) {
          // curtain wall: a spandrel panel at each floor, mullions every 1.5 m
          col = mix(col, base * 0.45, bx(fy, -0.05, sill - 0.05));
          float g = bx(fy, sill, sH - 0.05) * (1.0 - bx(abs(fract(u / 1.5) - 0.5), 0.475, 1.0));
          col = mix(col, glassCol(key + fl * 3.1 + floor(u / 1.5) * 0.37, 2.0, g, (fy - sill) / (sH - sill)), g);
        } else {
          gBars = isTen && fl < 0.5 ? 1.0 : 0.0;
          windowAt(u, fy, faceW, bayT, winW, winH, sill, key + fl * 13.7, kind, frameW, frameCol, sillCol, lintel, col);
          gBars = 0.0;
          if (T > 0.5 && T < 1.5 && X < 0.5) col = mix(col, trim, bx(fy, -0.01, 0.16));
          if (T > 1.5 && T < 2.5) col = mix(col, col * 0.88, bx(fy, -0.01, 0.5));
        }
      }
      if ((X < 0.5 && (T < 1.5 || T > 4.5)) || (X > 10.5 && X < 11.5) || isTen || (X > 15.5 && X < 16.5)) col = mix(col, trim, bx(vH, topH - 0.32, topH - 0.12));
      // district details on top of the windows
      if (X > 8.5 && !blankFace) {
        float edge = min(u, faceW - u);
        float fl2 = floor((vH - gfH) / sH), fy2 = vH - gfH - fl2 * sH;
        bool upper = vH > gfH && vH < upTop;
        if (X < 9.5) {
          // art deco: rounded corners (shading), eyebrow ledges over the window rows, a vertical
          // fin and a coloured band at the top, both trimmed with neon at night
          vec3 acc = mix(vec3(0.5 + 0.5 * cos(6.283 * (fract(seed * 5.7) + vec3(0.0, 0.33, 0.67)))), vec3(1.0), 0.2);
          col *= 0.8 + 0.2 * smoothstep(0.0, 1.3, edge);
          if (upper) { float ey = sill + winH; col = mix(col, col * 0.6, bx(fy2, ey - 0.02, ey + 0.07)); col = mix(col, min(col * 1.18, vec3(1.0)), bx(fy2, ey + 0.07, ey + 0.22)); }
          col = mix(col, acc, bx(vH, topH - 1.0, topH - 0.4));
          bEm += uNight * acc * 1.3 * bx(vH, topH - 1.06, topH - 0.96);
          bEm += uNight * acc * 0.8 * bx(vH, gfH - 0.12, gfH - 0.02);
          if (front && faceW > 8.0 && fract(seed * 7.0) < 0.65) {
            float fd = abs(u - faceW * 0.5);
            col = mix(col, acc, bx(fd, -1.0, 0.45) * step(gfH, vH));
            bEm += uNight * acc * 1.4 * bx(fd, 0.38, 0.5) * step(gfH, vH);
          }
        } else if (X < 10.5) {
          // adobe: soft rounded corners, a row of timber vigas under the parapet
          col *= 0.74 + 0.26 * smoothstep(0.0, 1.4, edge);
          col = mix(col, vec3(0.3, 0.2, 0.12), bx(vH, topH - 1.15, topH - 0.9) * bx(fract(u / 0.95), 0.4, 0.66) * bx(u, 0.5, faceW - 0.5));
        } else if (X < 11.5) {
          // industrial: a faded painted sign high on a side wall
          if (!front && fract(seed * 3.1) < 0.55) {
            float lu3 = u / 0.9;
            float txt = bx(vH, topH - 4.2, topH - 1.9) * bx(fract(lu3), 0.12, 0.82) * step(0.25, h21(vec2(floor(lu3), seed + faceId))) * bx(u, 1.2, faceW - 1.2);
            col = mix(col, col * 0.75, bx(vH, topH - 4.5, topH - 1.6) * bx(u, 0.8, faceW - 0.8) * 0.5);
            col = mix(col, vec3(0.86, 0.83, 0.74), 0.55 * txt);
          }
        } else if (X < 12.5) {
          col = mix(col, vec3(0.95), bx(edge, -1.0, 0.14)); // corner boards
        } else if (X < 13.5) {
          // chalet: a timber balcony across each upper floor
          if (upper && front) {
            float bal = bx(fy2, 0.0, 1.05) * bx(u, faceW * 0.12, faceW * 0.88);
            col = mix(col, vec3(0.32, 0.21, 0.12) * (0.65 + 0.35 * step(0.45, fract(u / 0.16))), bal);
            col = mix(col, vec3(0.25, 0.16, 0.09), bx(fy2, 0.95, 1.08) * bx(u, faceW * 0.12, faceW * 0.88));
          }
        } else if (X < 14.5) {
          // villa: crisp floor slabs with a shadow line under them
          float fyv = mod(vH, sH);
          col = mix(col, vec3(0.97, 0.96, 0.94), bx(fyv, sH - 0.32, sH + 0.01));
          col = mix(col, col * 0.7, bx(fyv, 0.0, 0.07) * step(sH, vH));
        } else if (isTen) {
          // graffiti over the ground floor, a fire escape on the front
          float gz = bx(vH, 0.2, 2.7);
          float cell = floor((u + seed * 20.0) / 3.3);
          float on = step(0.6, h21(vec2(cell, seed * 13.0 + faceId)));
          float blob = texture2D(uDetail, vec2(u + seed * 37.0 + faceId * 5.0, vH * 1.6) / 6.0).a;
          blob = blob * 0.75 + 0.25 * texture2D(uDetail, vec2(u * 1.7, vH * 2.3) / 2.4).g;
          vec3 gc = vec3(0.5 + 0.5 * cos(6.283 * (h21(vec2(cell, 2.0)) + vec3(0.0, 0.33, 0.67))));
          float fillG = smoothstep(0.67, 0.7, blob) * on * gz;
          float line = (smoothstep(0.63, 0.65, blob) - smoothstep(0.67, 0.69, blob)) * on * gz;
          col = mix(col, gc, fillG * 0.95);
          col = mix(col, vec3(0.04), line * 0.9);
          if (front && faceW > 7.0 && fract(seed * 11.0) < 0.7) {
            float fe = abs(u - faceW * (0.3 + 0.4 * fract(seed * 3.0)));
            float span = bx(fe, -1.0, 1.7) * step(gfH + sH * 0.9, vH) * step(vH, upTop);
            float platf = bx(fy2, -0.03, 0.12), rail = bx(fy2, 0.92, 0.99), bal2 = bx(abs(fract(fe / 0.3) - 0.5), 0.42, 1.0) * bx(fy2, 0.0, 0.95);
            float ladder = bx(abs(fe - 1.1), -1.0, 0.04) + bx(abs(fe - 0.6), -1.0, 0.04);
            col = mix(col, vec3(0.1, 0.1, 0.11), span * clamp(platf + rail + bal2 * 0.8 + ladder, 0.0, 1.0));
          }
        } else {
          // mission: a darker plinth
          col = mix(col, col * 0.82, bx(vH, 0.0, 0.55));
        }
      }
    }
  }
  diffuseColor.rgb = col;
}
`;

function buildingMaterial(detail) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0.0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = G.uniforms.uNight;
    sh.uniforms.uDetail = { value: detail };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aRim; attribute vec4 aFac;
        varying vec3 vWP; varying vec3 vWN; varying vec3 vNW; varying vec3 vLP; flat varying vec4 vFac; flat varying vec3 vDim; varying float vInner;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        // parapet: 0.3 m thick, 0.9 m (towers 1.2 m) above the roof; houses, sheds and roof boxes have none
        // pitched-roof buildings (aFac.y >= 16) and timber types have no parapet either
        float tx = aFac.x;
        float par = (aFac.y > 15.5 || (tx > 3.5 && tx < 4.5) || (tx > 5.5 && tx < 6.5) || (tx > 7.5 && tx < 8.5) || (tx > 11.5 && tx < 13.5)) ? 0.0 : (tx > 1.5 && tx < 3.5 ? 1.2 : tx > 9.5 && tx < 10.5 ? 0.6 : 0.9);
        float th = par > 0.0 ? 0.3 : 0.0;
        transformed.xz -= sign(transformed.xz) * aRim.x * th / sc.xz;
        transformed.y += aRim.y * par / sc.y;
        vLP = transformed * sc;
        vWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        vWN = normal;
        vNW = mat3(modelMatrix) * mat3(instanceMatrix) * normal;
        vFac = aFac;
        vInner = aRim.x;
        vDim = vec3(sc.x, sc.z, instanceMatrix[3].y + sc.y - aFac.w);`
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FACADE_GLSL)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FACADE_MAIN)
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.12, clamp(bGlass, 0.0, 1.0));`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += bEm;`
      );
  };
  mat.customProgramCacheKey = () => 'cc-facade-2';
  return mat;
}

// unit gable prism: ridge along x at y=1, eaves at z=+-0.5, y=0
function gableGeometry() {
  const P = [
    -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, 0, -0.5, 0, 0.5, 0.5, 1, 0, -0.5, 1, 0, // front slope
    0.5, 0, -0.5, -0.5, 0, -0.5, -0.5, 1, 0, 0.5, 0, -0.5, -0.5, 1, 0, 0.5, 1, 0, // back slope
    -0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 1, 0, 0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 1, 0, // gable ends
    -0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5, // soffit
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.computeVertexNormals();
  return g;
}
// roof covering in world metres: tile courses on slopes (stronger on warm terracotta colours)
function roofMaterial() {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRW; varying vec3 vRN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vRW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        vRN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRW; varying vec3 vRN;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 n = normalize(vRN);
          float slope = 1.0 - abs(n.y);
          if (abs(n.y) > 0.05) {
            vec2 hd = normalize(n.xz + 1e-4);
            float along = dot(vRW.xz, vec2(-hd.y, hd.x));
            float down = vRW.y / max(0.15, sqrt(1.0 - n.y * n.y));
            float row = fract(down / 0.32);
            float warm = smoothstep(0.05, 0.25, diffuseColor.r - diffuseColor.b);
            float tile = mix(0.82 + 0.18 * smoothstep(0.0, 0.25, row), 0.7 + 0.3 * smoothstep(0.0, 0.5, abs(fract(along / 0.24 + floor(down / 0.32) * 0.5) - 0.5) * 2.0), warm * 0.6);
            diffuseColor.rgb *= tile;
          } else diffuseColor.rgb *= 0.75;
        }`);
  };
  mat.customProgramCacheKey = () => 'cc-roof-1';
  return mat;
}

const SHOP_AWNINGS = [0x8c2f2f, 0x2f5d3a, 0x1f3f66, 0x6b4a2a, 0x3c3c3c, 0xb08a2e];
function buildBuildings(scene) {
  const list = buildings.filter((b) => !b.hidden);
  const shell = shellGeometry();
  const mat = buildingMaterial(detailTexture());
  const tiles = new Map();
  for (const b of list) {
    const k = Math.floor(b.cx / TILE) + ':' + Math.floor(b.cz / TILE);
    if (!tiles.has(k)) tiles.set(k, []);
    tiles.get(k).push(b);
  }
  for (const [k, l] of tiles) {
    const geo = shell.clone();
    const fac = new Float32Array(l.length * 4);
    const m = new THREE.InstancedMesh(geo, mat, l.length);
    l.forEach((b, i) => {
      M4.compose(V.set(b.cx, b.y0, b.cz), Q.setFromAxisAngle(UP, b.rot), S.set(b.hx * 2, b.y1 - b.y0, b.hz * 2));
      m.setMatrixAt(i, M4);
      m.setColorAt(i, C.setHex(b.color));
      fac.set([b.fac ?? 1, (b.gf ?? 0) + 4 * (b.blank ?? 0) + (b.roof ? 16 : 0), b.seed ?? 0.5, b.gy ?? b.y0 + 0.4], i * 4);
    });
    geo.setAttribute('aFac', new THREE.InstancedBufferAttribute(fac, 4));
    m.instanceColor.needsUpdate = true;
    m.castShadow = true;
    m.receiveShadow = true;
    const [ti, tj] = k.split(':').map(Number);
    m.userData.tile = { x: (ti + 0.5) * TILE, z: (tj + 0.5) * TILE, r: TILE * 0.75 };
    m.computeBoundingSphere();
    TILED.push(m);
    scene.add(m);
  }
  // pitched roofs with eaves: hipped (pyramid) and gabled (ridge along the street for town
  // blocks, along the long side for houses and barns). Pitch per building (b.pitch, rise/half-span).
  const roofMat = roofMaterial();
  const roofGeo = new THREE.ConeGeometry(0.7072, 1, 4, 1);
  roofGeo.rotateY(Math.PI / 4);
  roofGeo.translate(0, 0.5, 0);
  roofGeo.deleteAttribute('uv');
  const roofs = list.filter((b) => b.roof);
  tiledInstances(scene, roofGeo, roofMat, roofs.filter((b) => b.roofType !== 'gable'), (m, b, i) => {
    const k = b.pitch ?? 0.62;
    M4.compose(V.set(b.cx, b.y1, b.cz), Q.setFromAxisAngle(UP, b.rot), S.set(b.hx * 2 + 0.9, Math.min(b.hx, b.hz) * k, b.hz * 2 + 0.9));
    m.setMatrixAt(i, M4);
    m.setColorAt(i, C.setHex(b.roof));
  });
  tiledInstances(scene, gableGeometry(), roofMat, roofs.filter((b) => b.roofType === 'gable'), (m, b, i) => {
    // ridge along local x; houses/barns turn it to their long side
    const along = b.kind === 'block' || b.hx >= b.hz;
    const span = along ? b.hz : b.hx, len = along ? b.hx : b.hz;
    const k = b.pitch ?? 0.6;
    M4.compose(V.set(b.cx, b.y1, b.cz), Q.setFromAxisAngle(UP, b.rot + (along ? 0 : Math.PI / 2)), S.set(len * 2 + 0.7, span * k, span * 2 + 0.9));
    m.setMatrixAt(i, M4);
    m.setColorAt(i, C.setHex(b.roof));
  });
  for (const b of list) {
    const fx = Math.sin(b.rot), fz = Math.cos(b.rot);
    // shop awnings over the pavement, under the fascia (overhead, so no collider)
    if (b.gf === 1 && b.hx > 2 && b.seed < 0.55) {
      const d = 1.2;
      addBox(b.cx + fx * (b.hz + d / 2), b.gy + 3.06, b.cz + fz * (b.hz + d / 2), b.hx * 2 - 1, 0.12, d, b.rot, b.awn ?? SHOP_AWNINGS[Math.floor(b.seed * 97) % SHOP_AWNINGS.length]);
    }
    // chimneys on some houses
    if (b.kind === 'house' && b.roof && b.seed > 0.4 && b.roofType !== 'gable') addBox(b.cx + b.hx * 0.45 * b.c, b.y1 + 1.6, b.cz - b.hx * 0.45 * b.s, 0.7, 3.2, 0.7, b.rot, 0x7a4b3a);
    if (b.kind === 'tower' && b.y1 - b.y0 > 30) addBox(b.cx, b.y1 + 1.5, b.cz, b.hx * 0.8, 3, b.hz * 0.7, b.rot, 0x6b6f75);
    if (b.kind === 'hospital' || b.kind === 'police') addBox(b.cx, b.y1 + 0.06, b.cz, 14, 0.1, 14, b.rot, b.kind === 'hospital' ? 0xd32f2f : 0xf2c200);
  }
}

// ---------------------------------------------------------------- nature
function buildModelTrees(scene, by) {
  const rot = (t) => new THREE.Quaternion().setFromAxisAngle(UP, (t.x * 13.1 + t.z * 7.7) % 6.28);
  const place = (list, file, h, yOff = 0) => {
    if (!list.length || !hasModel(file)) return false;
    const mats = list.map((t) => new THREE.Matrix4().compose(new THREE.Vector3(t.x, t.y + yOff, t.z), rot(t), new THREE.Vector3(t.s * h, t.s * h, t.s * h)));
    for (const m of instanceProp(file, { height: 1 }, mats)) scene.add(m);
    return true;
  };
  if (by.round.length && hasModel('low-poly-tree') && hasModel('tree-big')) {
    const a = by.round.filter((t, i) => i % 3 !== 0), b = by.round.filter((t, i) => i % 3 === 0);
    place(a, 'low-poly-tree', 7.5, -0.2);
    place(b, 'tree-big', 9);
    by.round = [];
  }
  if (place(by.palm, 'palm-long', 9)) by.palm = [];
  if (place(by.rock, 'formation-rock', 3.2, -0.3)) by.rock = [];
}

function buildTrees(scene) {
  // textured card trees, bushes and rocks (flora.js); the primitives below are the fallback
  if (buildFlora(scene, trees)) return;
  const by = { pine: [], round: [], cactus: [], rock: [], bush: [], palm: [] };
  for (const t of trees) by[t.type].push({ ...t, cx: t.x, cz: t.z });
  buildModelTrees(scene, by);
  by.round.push(...by.palm);
  const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
  const rotQ = (t) => Q.setFromAxisAngle(UP, (t.x * 13.1 + t.z * 7.7) % 6.28);
  const make = (geo, mat, list, cb, shadow = true) => {
    if (!list.length) return;
    tiledInstances(scene, geo, mat, list, (m, t, i) => { cb(t, i, m); m.setMatrixAt(i, M4); }, shadow);
  };
  const pt = new THREE.CylinderGeometry(0.18, 0.28, 2.2, 5);
  pt.translate(0, 1.1, 0);
  const pl = mergeGeos([
    new THREE.ConeGeometry(2.2, 4.2, 7).translate(0, 3.6, 0),
    new THREE.ConeGeometry(1.7, 3.4, 7).translate(0, 5.6, 0),
    new THREE.ConeGeometry(1.1, 2.4, 7).translate(0, 7.3, 0),
  ]);
  make(pt, lam(0x5b3f2a), by.pine, (t) => M4.compose(V.set(t.x, t.y, t.z), rotQ(t), S.set(t.s, t.s, t.s)));
  make(pl, lam(0xffffff), by.pine, (t, i, m) => {
    M4.compose(V.set(t.x, t.y, t.z), rotQ(t), S.set(t.s, t.s * 1.1, t.s));
    const v = 0.85 + ((t.x * 7.3 + t.z) % 1 + 1) % 1 * 0.3;
    m.setColorAt(i, C.setRGB(0.16 * v, 0.36 * v, 0.2 * v));
  });
  const rt = new THREE.CylinderGeometry(0.2, 0.3, 3, 5);
  rt.translate(0, 1.5, 0);
  const rl = new THREE.IcosahedronGeometry(2.3, 1);
  rl.translate(0, 4.4, 0);
  make(rt, lam(0x6a4a33), by.round, (t) => M4.compose(V.set(t.x, t.y, t.z), rotQ(t), S.set(t.s, t.s, t.s)));
  make(rl, lam(0xffffff), by.round, (t, i, m) => {
    M4.compose(V.set(t.x, t.y, t.z), rotQ(t), S.set(t.s, t.s * 0.95, t.s));
    const v = ((t.x * 3.1 + t.z * 1.7) % 1 + 1) % 1;
    m.setColorAt(i, C.setRGB(0.25 + v * 0.12, 0.48 + v * 0.1, 0.18));
  });
  const cg = mergeGeos([
    new THREE.CylinderGeometry(0.35, 0.4, 4.5, 6).translate(0, 2.25, 0),
    new THREE.CylinderGeometry(0.22, 0.22, 1.6, 6).translate(0.7, 2.6, 0),
    new THREE.CylinderGeometry(0.22, 0.22, 1.0, 6).rotateZ(Math.PI / 2).translate(0.4, 1.9, 0),
    new THREE.CylinderGeometry(0.2, 0.2, 1.3, 6).translate(-0.6, 3.1, 0),
    new THREE.CylinderGeometry(0.2, 0.2, 0.8, 6).rotateZ(Math.PI / 2).translate(-0.35, 2.5, 0),
  ]);
  make(cg, lam(0x4f7d3a), by.cactus, (t) => M4.compose(V.set(t.x, t.y, t.z), rotQ(t), S.set(t.s, t.s, t.s)));
  make(new THREE.DodecahedronGeometry(1.4, 0), lam(0x8a8178), by.rock, (t) => M4.compose(V.set(t.x, t.y + 0.2 * t.s, t.z), rotQ(t), S.set(t.s * 1.3, t.s * 0.8, t.s)));
  make(new THREE.IcosahedronGeometry(0.9, 0), lam(0x7c7a3a), by.bush, (t) => M4.compose(V.set(t.x, t.y + 0.4, t.z), rotQ(t), S.set(t.s * 1.3, t.s * 0.7, t.s)), false);
}

function buildProps(scene) {
  const byFile = {};
  for (const p of props) (byFile[p.file] = byFile[p.file] || []).push(p);
  for (const file of Object.keys(byFile)) {
    const mats = byFile[file].map((p) => new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(UP, p.rot), new THREE.Vector3(p.h, p.h, p.h)));
    const ms = instanceProp(file, { height: 1, center: !/light/.test(file) }, mats, { shadow: file !== 'kk_trash_A' });
    if (ms) for (const m of ms) scene.add(m);
  }
}

function buildLamps(scene) {
  // three lamp families by district (districts.js `lamp`): KayKit cobra heads on modern streets,
  // black cast-iron lantern posts in the old quarters, timber poles with a bracket out in the sticks.
  // Heads are lit in the district's night colour (`light`).
  const byKind = { kk: [], iron: [], wood: [] };
  for (const l of lamps) byKind[STYLES[l.st ?? 0].lamp].push({ ...l, cx: l.x, cz: l.z, light: STYLES[l.st ?? 0].light });
  const model = hasModel('kk_streetlight');
  if (!model) { byKind.wood.push(...byKind.kk); byKind.kk = []; }
  lampMat = new THREE.MeshBasicMaterial({ color: 0x777777 });
  const heads = [];
  if (byKind.kk.length) {
    // KayKit street light: arm points along -x, so turn it to reach over the road
    const mats = byKind.kk.map((l) => new THREE.Matrix4().compose(new THREE.Vector3(l.x, l.y, l.z), new THREE.Quaternion().setFromAxisAngle(UP, l.dir + Math.PI / 2), new THREE.Vector3(7.5, 7.5, 7.5)));
    for (const m of instanceProp('kk_streetlight', { height: 1, center: false }, mats)) scene.add(m);
    for (const l of byKind.kk) heads.push({ x: l.x + Math.sin(l.dir) * 1.8, y: l.y + 6.75, z: l.z + Math.cos(l.dir) * 1.8, rot: l.dir, sx: 0.5, sy: 0.15, sz: 0.7, c: l.light });
  }
  if (byKind.iron.length) {
    // fluted post, a collar and a four-sided lantern under a little cap
    const post = mergeGeos([
      new THREE.CylinderGeometry(0.2, 0.26, 0.6, 8).translate(0, 0.3, 0),
      new THREE.CylinderGeometry(0.07, 0.11, 3.7, 8).translate(0, 2.4, 0),
      new THREE.CylinderGeometry(0.16, 0.1, 0.25, 8).translate(0, 4.3, 0),
      new THREE.ConeGeometry(0.42, 0.4, 4).rotateY(Math.PI / 4).translate(0, 5.25, 0),
      new THREE.BoxGeometry(0.06, 0.8, 0.06).translate(0.24, 4.82, 0.24),
      new THREE.BoxGeometry(0.06, 0.8, 0.06).translate(-0.24, 4.82, 0.24),
      new THREE.BoxGeometry(0.06, 0.8, 0.06).translate(0.24, 4.82, -0.24),
      new THREE.BoxGeometry(0.06, 0.8, 0.06).translate(-0.24, 4.82, -0.24),
    ]);
    tiledInstances(scene, post, new THREE.MeshLambertMaterial({ color: 0x1c1f1e }), byKind.iron, (m, l, i) => {
      M4.compose(V.set(l.x, l.y, l.z), Q.setFromAxisAngle(UP, l.dir), S.set(1, 1, 1));
      m.setMatrixAt(i, M4);
    });
    for (const l of byKind.iron) heads.push({ x: l.x, y: l.y + 4.82, z: l.z, rot: l.dir, sx: 0.44, sy: 0.72, sz: 0.44, c: l.light });
  }
  if (byKind.wood.length) {
    const pole = mergeGeos([
      new THREE.CylinderGeometry(0.13, 0.17, 8, 6).translate(0, 4, 0),
      new THREE.BoxGeometry(0.1, 0.1, 2.2).translate(0, 7.4, -1.05),
      new THREE.BoxGeometry(0.08, 0.08, 1.2).rotateX(-0.6).translate(0, 6.95, -0.5),
      new THREE.BoxGeometry(1.4, 0.1, 0.1).translate(0, 7.8, 0),
    ]);
    tiledInstances(scene, pole, new THREE.MeshLambertMaterial({ color: 0x5a4632 }), byKind.wood, (m, l, i) => {
      M4.compose(V.set(l.x, l.y, l.z), Q.setFromAxisAngle(UP, l.dir + Math.PI), S.set(1, 1, 1));
      m.setMatrixAt(i, M4);
    });
    for (const l of byKind.wood) heads.push({ x: l.x + Math.sin(l.dir) * 2.0, y: l.y + 7.3, z: l.z + Math.cos(l.dir) * 2.0, rot: l.dir, sx: 0.4, sy: 0.16, sz: 0.65, c: l.light });
  }
  // glowing heads, tinted by district light colour (lampMat dims them by day)
  tiledInstances(scene, new THREE.BoxGeometry(1, 1, 1), lampMat, heads.map((h) => ({ ...h, cx: h.x, cz: h.z })), (m, h, i) => {
    M4.compose(V.set(h.x, h.y, h.z), Q.setFromAxisAngle(UP, h.rot), S.set(h.sx, h.sy, h.sz));
    m.setMatrixAt(i, M4);
    m.setColorAt(i, C.setHex(h.c));
  }, false);
  G.lampHeads = heads;
}

// ---------------------------------------------------------------- airports
function buildAirports(scene) {
  const rwTex = canvasTex(256, 1024, (g, w, h) => {
    asphalt(g, w, h, 50);
    g.fillStyle = '#f2f2f2';
    for (let y = 0; y < h; y += 96) g.fillRect(w / 2 - 3, y, 6, 50);
    g.fillRect(6, 0, 4, h);
    g.fillRect(w - 10, 0, 4, h);
    for (let x = 20; x < w - 20; x += 22) {
      g.fillRect(x, 10, 12, 80);
      g.fillRect(x, h - 90, 12, 80);
    }
  });
  rwTex.wrapT = THREE.ClampToEdgeWrapping;
  const rwMat = new THREE.MeshLambertMaterial({ map: rwTex, side: THREE.DoubleSide });
  const conc = new THREE.MeshLambertMaterial({ map: canvasTex(128, 128, (g, w, h) => asphalt(g, w, h, 140)), side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 });
  for (const ap of AIRPORTS) {
    const p = [], uv = [], idx = [];
    for (const r of ap.runways) pushQuad(idx, p, uv, r.x0, ap.h + 0.05, r.z0, r.x1, ap.h + 0.05, r.z1, r.w, 0, 1);
    scene.add(meshFrom(p, uv, idx, rwMat));
    const p2 = [], uv2 = [], i2 = [];
    const A = ap.apron, d = ap.dir;
    pushQuad(i2, p2, uv2, A.x - d.x * A.len / 2, ap.h + 0.04, A.z - d.z * A.len / 2, A.x + d.x * A.len / 2, ap.h + 0.04, A.z + d.z * A.len / 2, 90, 0, A.len / 25);
    pushQuad(i2, p2, uv2, A.x, ap.h + 0.045, A.z, A.x - A.nx * 95, ap.h + 0.045, A.z - A.nz * 95, 30, 0, 4);
    scene.add(meshFrom(p2, uv2, i2, conc));
    for (const hp of ap.helipads) addBox(hp.x, ap.h + 0.08, hp.z, 14, 0.06, 14, 0, 0xf2c200);
  }
}

function buildRamps(scene) {
  const geo = new THREE.BufferGeometry();
  const v = [-0.5, 0, 0, 0.5, 0, 0, -0.5, 0, 1, 0.5, 0, 1, -0.5, 1, 1, 0.5, 1, 1];
  const idx = [0, 2, 1, 1, 2, 3, 0, 4, 2, 1, 3, 5, 0, 1, 4, 1, 5, 4, 2, 4, 3, 3, 4, 5];
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.setIndex(idx);
  const g2 = geo.toNonIndexed();
  g2.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ color: 0xd9822b });
  for (const r of ramps) {
    const m = new THREE.Mesh(g2, mat);
    m.position.set(r.x, r.base, r.z);
    m.rotation.y = r.rot;
    m.scale.set(r.w, r.h, r.len);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }
}

function buildDecor(scene) {
  for (const d of decor) addBox(d.x, d.y, d.z, d.sx, d.sy, d.sz, d.rot, d.color);
  for (const s of signs) {
    const tex = canvasTex(1024, Math.round((1024 * s.h) / s.w), (g, w, h) => {
      if (s.bg) {
        g.fillStyle = s.bg;
        g.fillRect(0, 0, w, h);
      }
      g.fillStyle = s.fg;
      g.font = `900 ${Math.floor(h * 0.72)}px "Arial Black", Impact, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(s.text, w / 2, h / 2 + h * 0.04, w * 0.94);
    }, false);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), new THREE.MeshBasicMaterial({ map: tex, transparent: !s.bg, side: THREE.DoubleSide }));
    m.position.set(s.x, s.y, s.z);
    m.rotation.y = s.rot;
    scene.add(m);
  }
}

function flushBoxes(scene) {
  if (!boxList.length) return;
  const list = boxList.map((b) => ({ ...b, cx: b.m.elements[12], cz: b.m.elements[14] }));
  tiledInstances(scene, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), list, (m, b, i) => {
    m.setMatrixAt(i, b.m);
    m.setColorAt(i, C.setHex(b.color));
  });
}

// ---------------------------------------------------------------- sea
function buildWater(scene) {
  // low roughness, no metalness: the sky environment map gives it fresnel reflections
  waterMat = new THREE.MeshStandardMaterial({ color: 0x1f5f78, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.88 });
  waterMat.userData.gfx = 'water';
  waterMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = G.uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = (modelMatrix * vec4(position,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vW; uniform float uTime;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          float t = uTime;
          vec2 p = vW.xz;
          float a = sin(p.x * 0.11 + t * 1.3) * cos(p.y * 0.13 - t * 1.1) + sin((p.x + p.y) * 0.31 + t * 2.0) * 0.4;
          float b = cos(p.x * 0.09 - t * 1.2) * sin(p.y * 0.12 + t * 0.9) + cos((p.x - p.y) * 0.27 - t * 1.7) * 0.4;
          vec3 wn = normalize(vec3(a * 0.08, 1.0, b * 0.08));
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`
      );
  };
  const w = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), waterMat);
  w.rotation.x = -Math.PI / 2;
  w.position.y = WATER;
  w.receiveShadow = true;
  G.waterMesh = w;
  patchWaterShore(waterMat); // soft shoreline and foam (ground.js)
  scene.add(w);
}

export function updateWorld(dt, focus) {
  G.dayTime = (G.dayTime + dt * (24 / 720)) % 24; // full day = 12 minutes
  updateAtmosphere(dt, focus); // sky, sun/moon, fog, environment map, lamp light, post (gfx.js)
  // lamp heads: HDR warm white at night so they bloom
  if (G.lampOn > 0.5) lampMat.color.setRGB(2.6, 1.9, 1.1); else lampMat.color.setHex(0x888877);
  updateDressing(dt); // district landmarks, beams and night light pools (dressing.js)
  G.uniforms.uTime.value = G.time;
  updateGroundDetail(dt, G.camera.position); // grass and small plants around the camera
  tileT -= dt;
  if (tileT <= 0) {
    tileT = 0.4;
    const y = G.camera.position.y - terrainHeight(G.camera.position.x, G.camera.position.z);
    updateTileVisibility(G.camera.position, y > 150 ? 3200 : 1600);
    updateFloraVisibility(G.camera.position, y > 150 ? 3200 : 1600);
  }
}
let tileT = 0;

export function buildWorld(scene) {
  generateWorldData();
  buildAtmosphere(scene);
  buildTerrain(scene);
  buildWater(scene);
  buildRoads(scene);
  buildBuildings(scene);
  buildTrees(scene);
  buildFences(scene, fences);
  buildBeachProps(scene, beachProps);
  initGroundDetail(scene);
  buildLamps(scene);
  buildProps(scene);
  buildAirports(scene);
  buildRamps(scene);
  buildDecor(scene);
  buildDressing(scene);
  flushBoxes(scene);
}
