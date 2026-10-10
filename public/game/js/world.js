// Turns world data into meshes; sky, lighting and day/night cycle.
import * as THREE from 'three';
import { G, clamp, lerp, sstep, WATER } from './core.js';
import {
  H, TN, TS, HALF, segs, roads, junctions, buildings, trees, lamps, ramps, decor, signs, props, SIDEWALK, CURB,
  terrainHeight, biomeAt, urbanAt, BIOMES, AIRPORTS, generateWorldData,
} from './terrain.js';
import { noise2 } from './noise.js';
import { mergeGeos } from './models.js';
import { hasModel, instanceProp, updateTileVisibility, TILED } from './assets.js';

const M4 = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const V = new THREE.Vector3();
const S = new THREE.Vector3();
const C = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const TILE = 500;

let sun, hemi, skyMat, lampMat, clouds, waterMat, fog;

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
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
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

function buildRoads(scene) {
  const mats = {
    main: new THREE.MeshLambertMaterial({ map: roadTexture('main'), side: THREE.DoubleSide }),
    city: new THREE.MeshLambertMaterial({ map: roadTexture('city'), side: THREE.DoubleSide }),
    rural: new THREE.MeshLambertMaterial({ map: roadTexture('rural'), side: THREE.DoubleSide }),
  };
  const walkMat = new THREE.MeshLambertMaterial({ map: canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#a7a59e'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(70,70,70,0.35)'; g.lineWidth = 2;
    for (let y = 0; y <= h; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
    for (let i = 0; i < 900; i++) { const v = 150 + Math.random() * 40; g.fillStyle = `rgba(${v},${v},${v},0.4)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  }), side: THREE.DoubleSide });
  const curbMat = new THREE.MeshLambertMaterial({ color: 0x9a978f, side: THREE.DoubleSide });
  const jMat = new THREE.MeshLambertMaterial({ map: canvasTex(128, 128, (g, w, h) => asphalt(g, w, h)), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
  const crossMat = new THREE.MeshLambertMaterial({ map: canvasTex(256, 64, (g, w, h) => {
    asphalt(g, w, h);
    g.fillStyle = '#efefef';
    for (let x = 10; x < w; x += 26) g.fillRect(x, 4, 14, h - 8);
  }), polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide });

  const B = { main: new Map(), city: new Map(), rural: new Map() };
  const walk = new Map(), curb = new Map(), jn = new Map(), cross = new Map();
  // how far a road's pavement stops short of a junction
  const clearAt = (n) => (n.edges.length >= 3 ? Math.max(...n.edges.map((e) => e.s.w)) / 2 + SIDEWALK : 0);
  for (const road of roads) {
    const P = roadPath(road);
    const L = P[P.length - 1].d;
    stripRange(B[road.kind], P, road.w / 2, -road.w / 2, 0.06, 0, L);
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
            stripRange(walk, P, i0, i1, 0.06 + CURB, s0, s1, 3);
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
  for (const k of Object.keys(B)) addTiled(scene, B[k], mats[k]);
  addTiled(scene, walk, walkMat);
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

// ---------------------------------------------------------------- buildings
function buildingMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.05 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = G.uniforms.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; varying vec3 vLP;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vWP = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
          vLP = position * vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        #else
          vWP = (modelMatrix * vec4(position, 1.0)).xyz;
          vLP = position;
        #endif
          vWN = normal;`
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; varying vec3 vLP; uniform float uNight; float vWin; float vLit;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 n = normalize(vWN);
          float wall = 1.0 - step(0.5, abs(n.y));
          vec2 p = vec2(abs(n.x) > 0.5 ? vLP.z : vLP.x, vLP.y - 0.4);
          vec2 cell = p / vec2(3.6, 3.4);
          vec2 f = fract(cell);
          float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.28, f.y) * step(f.y, 0.86) * step(0.0, p.y);
          win *= wall;
          float rnd = fract(sin(dot(floor(cell) + vec2(n.x * 17.0 + n.z * 31.0, floor(vWP.x * 0.02) * 7.0 + floor(vWP.z * 0.02) * 3.0), vec2(12.9898, 78.233))) * 43758.5453);
          vWin = win;
          vLit = step(0.55, rnd) * win;
          vec3 glass = vec3(0.16, 0.2, 0.26) + vec3(0.1, 0.12, 0.14) * rnd;
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * 0.85);
          diffuseColor.rgb *= mix(1.0, 0.62, 1.0 - wall);
          diffuseColor.rgb *= mix(0.82, 1.0, step(0.0, p.y - 0.6));
        }`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.2, vWin);`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vLit * uNight * vec3(1.0, 0.78, 0.45) * 0.5;`
      );
  };
  return mat;
}

function buildKayKit(scene, list) {
  const byKind = {};
  for (const b of list) (byKind[b.kk] = byKind[b.kk] || []).push(b);
  const rest = [];
  for (const kind of Object.keys(byKind)) {
    const file = 'kk_bld_' + kind;
    if (!hasModel(file)) { rest.push(...byKind[kind]); continue; }
    const mats = byKind[kind].map((b) => new THREE.Matrix4().compose(new THREE.Vector3(b.cx, b.y0 + 0.4, b.cz), new THREE.Quaternion().setFromAxisAngle(UP, b.rot), new THREE.Vector3(b.scale, b.scale, b.scale)));
    for (const m of instanceProp(file, {}, mats)) scene.add(m);
    // KayKit models have no plinth: a base box fills the gap down to sloping ground
    for (const b of byKind[kind]) if (b.y0 < b.y1) addBox(b.cx, b.y0 + 0.2, b.cz, b.hx * 2, 0.4, b.hz * 2, b.rot, 0x8f8a80);
  }
  return rest;
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

function buildBuildings(scene) {
  const boxes = buildings.filter((b) => !b.kk && !b.hidden).concat(buildKayKit(scene, buildings.filter((b) => b.kk)));
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const bmat = buildingMaterial();
  tiledInstances(scene, geo, bmat, boxes, (m, b, i) => {
    M4.compose(V.set(b.cx, b.y0, b.cz), Q.setFromAxisAngle(UP, b.rot), S.set(b.hx * 2, b.y1 - b.y0, b.hz * 2));
    m.setMatrixAt(i, M4);
    m.setColorAt(i, C.setHex(b.color));
  });
  const roofGeo = new THREE.ConeGeometry(0.7072, 1, 4, 1);
  roofGeo.rotateY(Math.PI / 4);
  roofGeo.translate(0, 0.5, 0);
  tiledInstances(scene, roofGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), boxes.filter((b) => b.roof), (m, b, i) => {
    M4.compose(V.set(b.cx, b.y1, b.cz), Q.setFromAxisAngle(UP, b.rot), S.set(b.hx * 2.08, Math.min(b.hx, b.hz) * 0.7, b.hz * 2.08));
    m.setMatrixAt(i, M4);
    m.setColorAt(i, C.setHex(b.roof));
  });
  for (const b of boxes) {
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
  const model = hasModel('kk_streetlight');
  if (model) {
    // KayKit street light: arm points along -x, so turn it to reach over the road
    const mats = lamps.map((l) => new THREE.Matrix4().compose(new THREE.Vector3(l.x, l.y, l.z), new THREE.Quaternion().setFromAxisAngle(UP, l.dir + Math.PI / 2), new THREE.Vector3(7.5, 7.5, 7.5)));
    for (const m of instanceProp('kk_streetlight', { height: 1, center: false }, mats)) scene.add(m);
  }
  lampMat = new THREE.MeshBasicMaterial({ color: 0x888877 });
  const pole = new THREE.CylinderGeometry(0.1, 0.14, 7, 6).translate(0, 3.5, 0);
  const arm = new THREE.BoxGeometry(0.12, 0.12, 2).translate(0, 6.9, -1);
  const head = new THREE.BoxGeometry(0.5, 0.2, 0.9).translate(0, 6.8, -1.8);
  const list = lamps.map((l) => ({ ...l, cx: l.x, cz: l.z }));
  if (model) {
    tiledInstances(scene, new THREE.BoxGeometry(1, 1, 1), lampMat, list, (m, l, i) => {
      const ax = Math.sin(l.dir) * 1.8, az = Math.cos(l.dir) * 1.8;
      M4.compose(V.set(l.x + ax, l.y + 6.75, l.z + az), Q.setFromAxisAngle(UP, l.dir), S.set(0.5, 0.15, 0.7));
      m.setMatrixAt(i, M4);
    }, false);
  } else {
    tiledInstances(scene, mergeGeos([pole, arm]), new THREE.MeshLambertMaterial({ color: 0x3a3f44 }), list, (m, l, i) => {
      M4.compose(V.set(l.x, l.y, l.z), Q.setFromAxisAngle(UP, l.dir + Math.PI), S.set(1, 1, 1));
      m.setMatrixAt(i, M4);
    });
    tiledInstances(scene, head, lampMat, list, (m, l, i) => {
      M4.compose(V.set(l.x, l.y, l.z), Q.setFromAxisAngle(UP, l.dir + Math.PI), S.set(1, 1, 1));
      m.setMatrixAt(i, M4);
    }, false);
  }
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

// ---------------------------------------------------------------- sky
function buildSky(scene) {
  skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x3d7fd6) },
      horizon: { value: new THREE.Color(0xbfdcf2) },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunCol: { value: new THREE.Color(0xfff2c8) },
      night: G.uniforms.uNight,
    },
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunCol; uniform float night; varying vec3 vD;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
      void main(){
        float y = clamp(vD.y, -0.2, 1.0);
        vec3 c = mix(horizon, top, pow(max(y, 0.0), 0.6));
        float s = max(dot(normalize(vD), sunDir), 0.0);
        c += sunCol * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.25);
        vec3 q = floor(normalize(vD) * 300.0);
        float star = step(0.9975, h(q)) * night * step(0.05, y);
        c += vec3(star);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(6500, 32, 16), skyMat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  G.skyMesh = sky;
  scene.add(sky);

  const cloudTex = canvasTex(256, 128, (g, w, h) => {
    for (let i = 0; i < 26; i++) {
      const x = w * 0.15 + Math.random() * w * 0.7, y = h * 0.45 + (Math.random() - 0.5) * h * 0.3;
      const r = 18 + Math.random() * 30;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }
  }, false);
  const cm = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0.9 });
  clouds = new THREE.Group();
  for (let i = 0; i < 110; i++) {
    const s = new THREE.Sprite(cm);
    s.position.set((Math.random() - 0.5) * 12000, 1150 + Math.random() * 450, (Math.random() - 0.5) * 12000);
    const sc = 350 + Math.random() * 600;
    s.scale.set(sc, sc * 0.45, 1);
    clouds.add(s);
  }
  scene.add(clouds);
  G.cloudMat = cm;
}

function buildWater(scene) {
  waterMat = new THREE.MeshStandardMaterial({ color: 0x2a6f8f, roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0.86 });
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
  scene.add(w);
}

function buildLights(scene) {
  hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a5040, 0.9);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 10; sc.far = 900;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  fog = new THREE.Fog(0xbfdcf2, 700, 4200);
  scene.fog = fog;
  G.sun = sun;
  G.hemi = hemi;
}

const DAY = { top: new THREE.Color(0x3d7fd6), hor: new THREE.Color(0xc4def0) };
const DUSK = { top: new THREE.Color(0x2c3e70), hor: new THREE.Color(0xf09a5a) };
const NIGHT = { top: new THREE.Color(0x050a18), hor: new THREE.Color(0x1a2338) };
const tc = new THREE.Color(), hc = new THREE.Color();

export function updateWorld(dt, focus) {
  G.dayTime = (G.dayTime + dt * (24 / 720)) % 24; // full day = 12 minutes
  const t = G.dayTime;
  const ang = ((t - 6) / 24) * Math.PI * 2; // 6am sunrise, 18 sunset
  const sy = Math.sin(ang), sx = Math.cos(ang);
  const sunDir = V.set(sx * 0.8, sy, 0.45).normalize();
  G.sunDir = (G.sunDir || new THREE.Vector3()).copy(sunDir);
  const day = sstep(-0.12, 0.25, sy);
  const dusk = clamp(1 - Math.abs(sy) * 4, 0, 1) * (sy > -0.25 ? 1 : 0);
  G.night = 1 - day;
  G.uniforms.uNight.value = G.night;
  tc.copy(NIGHT.top).lerp(DAY.top, day);
  hc.copy(NIGHT.hor).lerp(DAY.hor, day);
  tc.lerp(DUSK.top, dusk * 0.5);
  hc.lerp(DUSK.hor, dusk * 0.7);
  skyMat.uniforms.top.value.copy(tc);
  skyMat.uniforms.horizon.value.copy(hc);
  skyMat.uniforms.sunDir.value.copy(sunDir);
  fog.color.copy(hc);
  G.renderer.setClearColor(hc);
  G.skyMesh.position.copy(G.camera.position);
  const lightDir = sy > -0.05 ? sunDir : V.set(-sx * 0.6, -sy, 0.4).normalize();
  sun.intensity = sy > -0.05 ? 2.4 * sstep(-0.05, 0.2, sy) + 0.05 : 0.35;
  sun.color.setHex(sy > -0.05 ? 0xfff1d6 : 0x9fb4ff).lerp(new THREE.Color(0xffa060), dusk * 0.6);
  hemi.intensity = 0.25 + day * 0.75;
  sun.position.set(focus.x + lightDir.x * 400, focus.y + lightDir.y * 400, focus.z + lightDir.z * 400);
  sun.target.position.copy(focus);
  lampMat.color.setHex(G.night > 0.5 ? 0xffe2a0 : 0x888877);
  G.cloudMat.opacity = 0.25 + day * 0.65;
  clouds.position.x = (G.time * 3) % 1000;
  G.uniforms.uTime.value = G.time;
  tileT -= dt;
  if (tileT <= 0) {
    tileT = 0.4;
    const y = G.camera.position.y - terrainHeight(G.camera.position.x, G.camera.position.z);
    updateTileVisibility(G.camera.position, y > 150 ? 3200 : 1600);
  }
}
let tileT = 0;

export function buildWorld(scene) {
  generateWorldData();
  buildLights(scene);
  buildSky(scene);
  buildTerrain(scene);
  buildWater(scene);
  buildRoads(scene);
  buildBuildings(scene);
  buildTrees(scene);
  buildLamps(scene);
  buildProps(scene);
  buildAirports(scene);
  buildRamps(scene);
  buildDecor(scene);
  flushBoxes(scene);
}
