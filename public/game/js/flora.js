// Trees, bushes, hedges, fences, walls and beach furniture.
// Trees and bushes are built here from textured cards: CC0 leaf / needle scans (ambientCG) composed
// into assets/textures/ground/foliage_atlas.webp by tools/ground/compose.py, on bark from Poly Haven.
// Each species is one InstancedMesh per 500 m map tile (culled by assets.js updateTileVisibility).
import * as THREE from 'three';
import { G } from './core.js';
import { BIOMES, biomeAt, FENCE } from './terrain.js';
import { hasModel, instanceProp } from './assets.js';
import { mergeGeos } from './models.js';
import { GTEX, PLANTS, foliagePatch, quality } from './ground.js';
import { mulberry32 } from './noise.js';

const TILE = 500;
const UP = new THREE.Vector3(0, 1, 0);
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), C = new THREE.Color();
const SH = new THREE.Matrix4();

// ---------------------------------------------------------------- geometry builders
class Geo {
  constructor() { this.p = []; this.n = []; this.uv = []; this.i = []; }
  vert(x, y, z, nx, ny, nz, u, v) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v); return this.p.length / 3 - 1; }
  // card centred at c, spanned by half-axes a (u) and b (v); normals bent away from `ctr`
  card(c, a, b, uv, ctr, bend = 0.75, up = 0.35) {
    const o = this.p.length / 3;
    const corners = [[-1, -1, uv[0], uv[1]], [1, -1, uv[2], uv[1]], [-1, 1, uv[0], uv[3]], [1, 1, uv[2], uv[3]]];
    for (const [su, sv, u, v] of corners) {
      const x = c.x + a.x * su + b.x * sv, y = c.y + a.y * su + b.y * sv, z = c.z + a.z * su + b.z * sv;
      let nx = x - ctr.x, ny = y - ctr.y, nz = z - ctr.z;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx = (nx / l) * bend; ny = (ny / l) * bend + up; nz = (nz / l) * bend;
      const l2 = Math.hypot(nx, ny, nz) || 1;
      this.vert(x, y, z, nx / l2, ny / l2, nz / l2, u, v);
    }
    this.i.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
  }
  // tapered cylinder from p0 (radius r0) to p1 (radius r1); bark UVs repeat every vRep metres
  tube(p0, p1, r0, r1, seg = 6, vRep = 1.6) {
    const d = new THREE.Vector3().subVectors(p1, p0);
    const L = d.length();
    d.normalize();
    const t1 = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0).cross(d).normalize() : new THREE.Vector3(1, 0, 0).cross(d).normalize();
    const t2 = new THREE.Vector3().crossVectors(d, t1);
    const o = this.p.length / 3;
    for (let r = 0; r <= 1; r++) {
      const c = r ? p1 : p0, rad = r ? r1 : r0;
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        const nx = t1.x * Math.cos(a) + t2.x * Math.sin(a), ny = t1.y * Math.cos(a) + t2.y * Math.sin(a), nz = t1.z * Math.cos(a) + t2.z * Math.sin(a);
        this.vert(c.x + nx * rad, c.y + ny * rad, c.z + nz * rad, nx, ny, nz, k / seg, (r * L) / vRep);
      }
    }
    for (let k = 0; k < seg; k++) { const a = o + k, b = o + k + 1, c = o + seg + 1 + k, e = c + 1; this.i.push(a, c, b, b, c, e); }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.i);
    g.computeBoundingSphere();
    return g;
  }
}
const UV_LEAF = [0, 0.5, 0.5, 1], UV_PINE = [0.5, 0.5, 1, 1];
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

// broadleaf: trunk + a few limbs + a crown of leaf-cluster cards in an ellipsoid
function broadleaf({ seed, trunkH, trunkR, crownR, crownY, cards, cardS, lean = 0 }) {
  const R = mulberry32(seed);
  const bark = new Geo(), leaf = new Geo();
  const top = v3(lean, trunkH, lean * 0.5);
  bark.tube(v3(0, -0.3, 0), top, trunkR, trunkR * 0.6, 7);
  const ctr = v3(lean, trunkH + crownY, lean * 0.5);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + R();
    bark.tube(top, v3(top.x + Math.cos(a) * crownR.x * 0.6, top.y + crownY * (0.6 + R() * 0.6), top.z + Math.sin(a) * crownR.x * 0.6), trunkR * 0.45, trunkR * 0.15, 5);
  }
  for (let k = 0; k < cards; k++) {
    // more cards near the shell than inside: the silhouette reads as a full crown
    const u = R() * 2 - 1, th = R() * Math.PI * 2, rr = Math.pow(R(), 0.35);
    const sx = Math.sqrt(1 - u * u) * Math.cos(th), sz = Math.sqrt(1 - u * u) * Math.sin(th);
    const c = v3(ctr.x + sx * crownR.x * rr, ctr.y + u * crownR.y * rr, ctr.z + sz * crownR.x * rr);
    const s = cardS * (0.75 + R() * 0.5);
    const yaw = R() * Math.PI * 2, pitch = (R() - 0.5) * 1.4;
    const a = v3(Math.cos(yaw) * s, 0, Math.sin(yaw) * s);
    const b = v3(-Math.sin(yaw) * Math.sin(pitch) * s, Math.cos(pitch) * s, Math.cos(yaw) * Math.sin(pitch) * s);
    leaf.card(c, a, b, UV_LEAF, ctr);
  }
  return { bark: bark.build(), leaf: leaf.build() };
}
// conifer: tall trunk with whorls of drooping needle-branch cards
function conifer({ seed, h, trunkR, baseR, whorls, perWhorl, cardW, droop = 0.35 }) {
  const R = mulberry32(seed);
  const bark = new Geo(), leaf = new Geo();
  bark.tube(v3(0, -0.3, 0), v3(0, h, 0), trunkR, trunkR * 0.15, 6, 2.2);
  const y0 = h * 0.22;
  for (let w = 0; w < whorls; w++) {
    const t = w / (whorls - 1);
    const y = y0 + (h * 0.97 - y0) * t;
    const L = baseR * (1 - t * 0.85) + 0.35;
    const n = Math.max(3, Math.round(perWhorl * (1 - t * 0.4)));
    const off = R() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const a = off + (k / n) * Math.PI * 2 + (R() - 0.5) * 0.4;
      const dx = Math.cos(a), dz = Math.sin(a);
      const c = v3(dx * L * 0.5, y - L * droop * 0.5, dz * L * 0.5);
      const ax = v3(dx * L * 0.5, -L * droop * 0.5, dz * L * 0.5); // along the branch (atlas u)
      const wd = cardW * (1 - t * 0.5) * 0.5;
      const bx = v3(-dz * wd, 0.12 * wd, dx * wd); // across the branch
      leaf.card(c, ax, bx, UV_PINE, v3(0, y + L * 0.3, 0), 0.7, 0.45);
    }
  }
  // leader: two crossed vertical cards at the tip
  for (const a of [0, Math.PI / 2]) leaf.card(v3(0, h * 0.97, 0), v3(0, h * 0.06, 0), v3(Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35), UV_PINE, v3(0, h * 0.9, 0), 0.6, 0.5);
  return { bark: bark.build(), leaf: leaf.build() };
}
// bush: dome of leaf cards, no trunk
function bushGeo(seed, cards = 13) {
  const R = mulberry32(seed);
  const leaf = new Geo();
  const ctr = v3(0, 0.25, 0);
  for (let k = 0; k < cards; k++) {
    const th = R() * Math.PI * 2, u = R() * 0.9;
    const c = v3(Math.cos(th) * 0.55 * Math.sqrt(1 - u * u), 0.25 + u * 0.55, Math.sin(th) * 0.55 * Math.sqrt(1 - u * u));
    const s = 0.55 + R() * 0.25, yaw = R() * Math.PI * 2, pitch = (R() - 0.5) * 1.2;
    leaf.card(c, v3(Math.cos(yaw) * s, 0, Math.sin(yaw) * s), v3(-Math.sin(yaw) * Math.sin(pitch) * s, Math.cos(pitch) * s, Math.cos(yaw) * Math.sin(pitch) * s), UV_LEAF, ctr, 0.8, 0.3);
  }
  return leaf.build();
}

// ---------------------------------------------------------------- materials
let MAT = null;
function materials() {
  if (MAT) return MAT;
  const fol = GTEX.foliage;
  const leaf = foliagePatch(new THREE.MeshLambertMaterial({ map: fol, alphaTest: 0.45, side: THREE.DoubleSide }), { wind: 0.0025, cacheKey: 'leaf' });
  const bush = foliagePatch(new THREE.MeshLambertMaterial({ map: fol, alphaTest: 0.45, side: THREE.DoubleSide }), { wind: 0.02, cacheKey: 'bush' });
  const barkOak = new THREE.MeshLambertMaterial({ map: GTEX.bark_oak || null, color: GTEX.bark_oak ? 0xffffff : 0x6a4a33 });
  const barkPine = new THREE.MeshLambertMaterial({ map: GTEX.bark_pine || null, color: GTEX.bark_pine ? 0xffffff : 0x5b3f2a });
  MAT = { leaf, bush, barkOak, barkPine };
  return MAT;
}

// instanced meshes per 500 m tile
function tiled(scene, geo, mat, list, setup, { shadow = true, far = 1600, kind = '' } = {}) {
  const tiles = new Map();
  for (const t of list) {
    const k = Math.floor(t.x / TILE) + ':' + Math.floor(t.z / TILE);
    if (!tiles.has(k)) tiles.set(k, []);
    tiles.get(k).push(t);
  }
  for (const [k, l] of tiles) {
    const m = new THREE.InstancedMesh(geo, mat, l.length);
    l.forEach((t, i) => setup(m, t, i));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.castShadow = shadow;
    m.receiveShadow = true;
    const [ti, tj] = k.split(':').map(Number);
    m.userData.tile = { x: (ti + 0.5) * TILE, z: (tj + 0.5) * TILE, r: TILE * 0.75, far };
    m.userData.kind = kind;
    m.computeBoundingSphere();
    FLORA_TILED.push(m);
    scene.add(m);
  }
}
// own distance culling: small things (fences, bushes) disappear much closer than buildings
const FLORA_TILED = [];
export function updateFloraVisibility(cam, maxDist) {
  for (const m of FLORA_TILED) {
    const t = m.userData.tile;
    m.visible = Math.hypot(cam.x - t.x, cam.z - t.z) - t.r < Math.min(maxDist, t.far);
  }
}
const hash = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };

// ---------------------------------------------------------------- trees and bushes
// species: geometry + where it grows + leaf colour palette
function speciesTable() {
  return {
    oak: { ...broadleaf({ seed: 11, trunkH: 2.4, trunkR: 0.24, crownR: { x: 2.7, y: 2.1 }, crownY: 1.9, cards: 46, cardS: 1.25 }), barkMat: 'barkOak', tint: [[0.62, 0.78, 0.5], [0.55, 0.72, 0.42], [0.7, 0.8, 0.48]] },
    maple: { ...broadleaf({ seed: 23, trunkH: 2.8, trunkR: 0.2, crownR: { x: 2.2, y: 2.4 }, crownY: 2.2, cards: 40, cardS: 1.15, lean: 0.2 }), barkMat: 'barkOak', tint: [[0.7, 0.82, 0.48], [0.82, 0.78, 0.42], [0.6, 0.76, 0.46]] },
    birch: { ...broadleaf({ seed: 37, trunkH: 3.8, trunkR: 0.13, crownR: { x: 1.5, y: 2.6 }, crownY: 2.3, cards: 30, cardS: 0.95 }), barkMat: 'barkBirch', tint: [[0.78, 0.9, 0.5], [0.72, 0.86, 0.46]] },
    pine: { ...conifer({ seed: 51, h: 9.5, trunkR: 0.26, baseR: 2.6, whorls: 10, perWhorl: 6, cardW: 1.5 }), barkMat: 'barkPine', tint: [[0.8, 0.95, 0.75], [0.72, 0.88, 0.68], [0.85, 0.96, 0.72]] },
    fir: { ...conifer({ seed: 67, h: 8, trunkR: 0.22, baseR: 2.2, whorls: 13, perWhorl: 7, cardW: 1.4, droop: 0.5 }), barkMat: 'barkPine', tint: [[0.66, 0.82, 0.66], [0.7, 0.85, 0.64]] },
  };
}

function buildRocks(scene, list) {
  const V0 = PLANTS.rock_07 && PLANTS.rock_07[0];
  if (V0) {
    const g = V0.geometry.clone();
    g.scale(1 / V0.h, 1 / V0.h, 1 / V0.h);
    tiled(scene, g, V0.material, list, (m, t, i) => {
      const r = hash(t.x, t.z);
      Q.setFromEuler(new THREE.Euler((r - 0.5) * 0.5, r * 6.283, (hash(t.z, t.x) - 0.5) * 0.5));
      const s = 1.1 * t.s;
      M4.compose(V.set(t.x, t.y - 0.25 * s, t.z), Q, S.set(s * (1 + r * 0.6), s, s * (1.2 - r * 0.4)));
      m.setMatrixAt(i, M4);
    });
    return;
  }
  tiled(scene, new THREE.DodecahedronGeometry(1.4, 0), new THREE.MeshLambertMaterial({ color: 0x8a8178 }), list, (m, t, i) => {
    M4.compose(V.set(t.x, t.y + 0.2 * t.s, t.z), Q.setFromAxisAngle(UP, (t.x * 13.1 + t.z * 7.7) % 6.28), S.set(t.s * 1.3, t.s * 0.8, t.s));
    m.setMatrixAt(i, M4);
  });
}

export function buildFlora(scene, trees) {
  if (!GTEX.foliage) return false; // no atlas: world.js falls back to the old primitive trees
  const by = { pine: [], round: [], cactus: [], rock: [], bush: [], palm: [] };
  for (const t of trees) by[t.type].push(t);
  // palms keep the Kenney models (two lengths for variety)
  if (by.palm.length && hasModel('palm-long')) {
    const rot = (t) => new THREE.Quaternion().setFromAxisAngle(UP, (t.x * 13.1 + t.z * 7.7) % 6.28);
    const tall = by.palm.filter((t, i) => i % 3 !== 0 || !hasModel('palm-short')), short = by.palm.filter((t, i) => i % 3 === 0 && hasModel('palm-short'));
    for (const [list, file, h] of [[tall, 'palm-long', 9], [short, 'palm-short', 6]]) {
      if (!list.length) continue;
      const mats = list.map((t) => new THREE.Matrix4().compose(new THREE.Vector3(t.x, t.y, t.z), rot(t), new THREE.Vector3(t.s * h, t.s * h, t.s * h)));
      for (const m of instanceProp(file, { height: 1 }, mats)) scene.add(m);
    }
    by.palm = [];
  }
  buildRocks(scene, by.rock);
  // cactus: simple primitive (desert)
  if (by.cactus.length) {
    const cg = mergeGeos([
      new THREE.CylinderGeometry(0.35, 0.4, 4.5, 8).translate(0, 2.25, 0),
      new THREE.CylinderGeometry(0.22, 0.22, 1.6, 8).translate(0.7, 2.6, 0),
      new THREE.CylinderGeometry(0.22, 0.22, 1.0, 8).rotateZ(Math.PI / 2).translate(0.4, 1.9, 0),
      new THREE.CylinderGeometry(0.2, 0.2, 1.3, 8).translate(-0.6, 3.1, 0),
      new THREE.CylinderGeometry(0.2, 0.2, 0.8, 8).rotateZ(Math.PI / 2).translate(-0.35, 2.5, 0),
    ]);
    tiled(scene, cg, new THREE.MeshLambertMaterial({ color: 0x4f7d3a }), by.cactus, (m, t, i) => {
      M4.compose(V.set(t.x, t.y, t.z), Q.setFromAxisAngle(UP, (t.x * 13.1 + t.z * 7.7) % 6.28), S.set(t.s, t.s, t.s));
      m.setMatrixAt(i, M4);
    });
  }
  const mats = materials();
  mats.barkBirch = mats.barkBirch || new THREE.MeshLambertMaterial({ map: GTEX.bark_oak || null, color: 0xe8e4dc });
  const SP = speciesTable();
  // pick a species per tree: conifers stay conifers, broadleaves vary with biome and a hash
  const lists = { oak: [], maple: [], birch: [], pine: [], fir: [] };
  for (const t of by.pine) lists[hash(t.x, t.z) < (t.y > 200 ? 0.7 : 0.35) ? 'fir' : 'pine'].push(t);
  for (const t of by.round) {
    const r = hash(t.x, t.z), b = biomeAt(t.x, t.z);
    if (b === BIOMES.FOREST || b === BIOMES.WETLAND) lists[r < 0.4 ? 'birch' : r < 0.7 ? 'oak' : 'maple'].push(t);
    else lists[r < 0.5 ? 'oak' : r < 0.82 ? 'maple' : 'birch'].push(t);
  }
  for (const [name, list] of Object.entries(lists)) {
    if (!list.length) continue;
    const sp = SP[name];
    const place = (t) => {
      const r = hash(t.z, t.x);
      Q.setFromAxisAngle(UP, (t.x * 13.1 + t.z * 7.7) % 6.28);
      // street trees (scale < 1) are kept a bit smaller; wild trees vary more
      const s = t.s * (0.85 + r * 0.3);
      return M4.compose(V.set(t.x, t.y, t.z), Q, S.set(s, s * (0.9 + hash(t.x + 1, t.z) * 0.25), s));
    };
    tiled(scene, sp.bark, mats[sp.barkMat], list, (m, t, i) => m.setMatrixAt(i, place(t)), { far: 900, kind: 'bark' });
    tiled(scene, sp.leaf, mats.leaf, list, (m, t, i) => {
      m.setMatrixAt(i, place(t));
      const tn = sp.tint[Math.floor(hash(t.x * 3, t.z) * sp.tint.length)];
      const v = 0.85 + hash(t.x, t.z * 3) * 0.3;
      m.setColorAt(i, C.setRGB(tn[0] * v, tn[1] * v, tn[2] * v));
    }, { kind: 'leaf' });
  }
  // bushes: three dome variants
  if (by.bush.length) {
    const geos = [bushGeo(5), bushGeo(9, 11), bushGeo(17, 16)];
    const parts = [[], [], []];
    for (const t of by.bush) parts[Math.floor(hash(t.x, t.z) * 3)].push(t);
    parts.forEach((list, k) => {
      if (!list.length) return;
      tiled(scene, geos[k], mats.bush, list, (m, t, i) => {
        const b = biomeAt(t.x, t.z);
        const s = t.s * 1.5;
        M4.compose(V.set(t.x, t.y - 0.15, t.z), Q.setFromAxisAngle(UP, hash(t.z, t.x) * 6.28), S.set(s * 1.2, s * 0.9, s * 1.2));
        m.setMatrixAt(i, M4);
        const r = hash(t.x * 7, t.z);
        if (b === BIOMES.DESERT) C.setRGB(0.72, 0.7, 0.42); // dry scrub
        else if (r < 0.12) C.setRGB(0.95, 0.62, 0.4); // a few reddish shrubs
        else C.setRGB(0.7 + r * 0.2, 0.86 + r * 0.1, 0.5);
        m.setColorAt(i, C);
      }, { shadow: true, far: 700, kind: 'bush' });
    });
  }
  return true;
}

// ---------------------------------------------------------------- fences, hedges and walls
// canvas textures (alpha) for open fence types, drawn from the Poly Haven wood scans
function fenceCanvas(kind) {
  const W = 512, Hh = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = Hh;
  const g = c.getContext('2d');
  const wood = GTEX.wood_white; // painted / stained by the material colour
  const img = wood && wood.image;
  const fillWood = (x, y, w, h) => {
    if (img) g.drawImage(img, (x * 3) % 400, (y * 2) % 300, Math.max(4, w * 0.8), Math.max(4, h * 0.8), x, y, w, h);
    else { g.fillStyle = kind === 'picket' ? '#eeeeea' : '#8a6a4a'; g.fillRect(x, y, w, h); }
  };
  if (kind === 'picket') {
    // 2 m panel: rails behind, pickets with pointed tops, thicker posts at the ends
    fillWood(0, 70, W, 16); fillWood(0, 190, W, 16);
    for (let x = 6; x < W; x += 28) {
      fillWood(x, 22, 16, Hh - 22);
      g.globalCompositeOperation = 'destination-out';
      g.beginPath(); g.moveTo(x - 1, 22); g.lineTo(x + 8, 8); g.lineTo(x + 8, 0); g.lineTo(x - 1, 0); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(x + 17, 22); g.lineTo(x + 8, 8); g.lineTo(x + 8, 0); g.lineTo(x + 17, 0); g.closePath(); g.fill();
      g.globalCompositeOperation = 'source-over';
    }
    fillWood(0, 6, 14, Hh); fillWood(W - 14, 6, 14, Hh);
  } else if (kind === 'rail') {
    fillWood(0, 30, W, 20); fillWood(0, 110, W, 20); fillWood(0, 185, W, 18);
    fillWood(0, 0, 22, Hh); fillWood(W - 22, 0, 22, Hh);
  } else {
    // privacy: tight vertical boards with a capping rail
    for (let x = 0; x < W; x += 32) { fillWood(x, 4, 31, Hh - 4); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 30, 4, 2, Hh - 4); }
    fillWood(0, 0, W, 10);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  return t;
}
// opaque hedge texture: leaf clusters from the foliage atlas packed on dark foliage
function hedgeCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#34502a'; g.fillRect(0, 0, 256, 256);
  const img = GTEX.foliage && GTEX.foliage.image;
  if (img) {
    const R = mulberry32(3), iw = img.width / 2, ih = img.height / 2;
    for (let k = 0; k < 90; k++) {
      const s = 70 + R() * 60, x = R() * 256 - s / 2, y = R() * 256 - s / 2;
      g.globalAlpha = 0.75 + R() * 0.25;
      for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256]) g.drawImage(img, 0, 0, iw, ih, x + dx, y + dy, s, s);
    }
    g.globalAlpha = 1;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// world-space UVs for boxes (walls, hedges): u along the face, v up; texture scale in metres
function worldUV(mat, scale) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      #ifdef USE_INSTANCING
        vec4 cwp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        vec3 cwn = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
      #else
        vec4 cwp = modelMatrix * vec4(transformed, 1.0);
        vec3 cwn = normalize(mat3(modelMatrix) * objectNormal);
      #endif
      vMapUv = (abs(cwn.y) > 0.6 ? cwp.xz : vec2(dot(cwp.xz, normalize(vec2(-cwn.z, cwn.x))), cwp.y)) / ${scale.toFixed(2)};`);
  };
  mat.customProgramCacheKey = () => 'cc-worlduv' + scale;
  return mat;
}
// panel geometry: x -0.5..0.5 along the fence, y from below ground to 1 (top), centred on z
function panelGeo() {
  const g = new Geo();
  const o = g.p.length / 3;
  g.vert(-0.5, -0.35, 0, 0, 0, 1, 0, -0.35); g.vert(0.5, -0.35, 0, 0, 0, 1, 1, -0.35);
  g.vert(-0.5, 1, 0, 0, 0, 1, 0, 1); g.vert(0.5, 1, 0, 0, 0, 1, 1, 1);
  g.i.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
  return g.build();
}
function boxGeo() {
  const b = new THREE.BoxGeometry(1, 1.35, 1);
  b.translate(0, 1.35 / 2 - 0.35, 0);
  return b;
}
// T * R(y) * shear(y += slope * x) * S: panels follow the ground along their length
function panelMatrix(p, h, t) {
  Q.setFromAxisAngle(UP, p.rot);
  M4.compose(V.set(p.x, p.y, p.z), Q, S.set(1, 1, 1));
  SH.set(1, 0, 0, 0, p.slope, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  M4.multiply(SH);
  M4.scale(S.set(p.len + 0.04, h, t));
  return M4;
}

export function buildFences(scene, fences) {
  if (!fences.length) return;
  const by = {};
  for (const p of fences) (by[p.type] = by[p.type] || []).push(p);
  const pg = panelGeo(), bg = boxGeo();
  for (const [type, list] of Object.entries(by)) {
    const F = FENCE[type];
    let geo = pg, mat, thick = 1;
    if (type === 'picket' || type === 'rail' || type === 'privacy') {
      const tex = fenceCanvas(type);
      mat = foliagePatch(new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, color: type === 'picket' ? 0xf4f2ec : type === 'privacy' ? 0xb79470 : 0x957a5c }), { cacheKey: 'fence' });
    } else {
      geo = bg;
      thick = F.t;
      if (type === 'hedge') mat = worldUV(new THREE.MeshLambertMaterial({ map: hedgeCanvas(), color: 0xe4f0d0 }), 1.1);
      else if (type === 'brick') mat = worldUV(new THREE.MeshLambertMaterial({ map: GTEX.wall_brick || null, color: GTEX.wall_brick ? 0xffffff : 0x9a4a3a }), 1.2);
      else if (type === 'stone') mat = worldUV(new THREE.MeshLambertMaterial({ map: GTEX.wall_stone || null, color: GTEX.wall_stone ? 0xd8d0c4 : 0x8a8178 }), 1.6);
      else mat = worldUV(new THREE.MeshLambertMaterial({ map: GTEX.wall_stone || null, color: 0xe8c89a }), 2.5); // adobe
    }
    tiled(scene, geo, mat, list, (m, p, i) => {
      const h = type === 'hedge' ? F.h * (0.9 + hash(p.x, p.z) * 0.25) : F.h;
      m.setMatrixAt(i, panelMatrix(p, h, thick));
    }, { shadow: quality() !== 'low', far: quality() === 'high' ? 700 : 480, kind: 'fence' });
  }
}

// ---------------------------------------------------------------- beach furniture
const STRIPES = [0xd8383a, 0x2f6fd0, 0xf2b630, 0x2aa37a, 0xe86fa8];
export function buildBeachProps(scene, props) {
  if (!props.length) return;
  const by = { umbrella: [], lounger: [], hut: [] };
  for (const p of props) by[p.type].push(p);
  const lam = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
  const put = (geo, mat, list, f, shadow = true) => {
    if (!list.length) return;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((p, i) => { f(p, i, m); m.setMatrixAt(i, M4); });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.castShadow = shadow;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    scene.add(m);
  };
  const base = (p) => M4.compose(V.set(p.x, p.y, p.z), Q.setFromAxisAngle(UP, p.rot), S.set(1, 1, 1));
  // umbrella: pole + striped canopy (alternating white and colour segments via vertex colours)
  const pole = new THREE.CylinderGeometry(0.03, 0.035, 2.4, 6).translate(0, 1.2, 0);
  const canopy = (odd) => {
    const g = new Geo(), n = 12, R = 1.35;
    for (let k = 0; k < n; k++) {
      if (k % 2 !== odd) continue;
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      const o = g.p.length / 3;
      g.vert(0, 2.5, 0, 0, 1, 0, 0.5, 1);
      g.vert(Math.cos(a0) * R, 2.05, Math.sin(a0) * R, Math.cos(a0) * 0.4, 0.9, Math.sin(a0) * 0.4, 0, 0);
      g.vert(Math.cos(a1) * R, 2.05, Math.sin(a1) * R, Math.cos(a1) * 0.4, 0.9, Math.sin(a1) * 0.4, 1, 0);
      g.i.push(o, o + 2, o + 1);
    }
    return g.build();
  };
  put(pole, lam(0xdddddd), by.umbrella, (p) => base(p));
  put(canopy(0), lam(0xf4f2ea, { side: THREE.DoubleSide }), by.umbrella, (p) => base(p));
  for (let c = 0; c < STRIPES.length; c++) {
    const list = by.umbrella.filter((p) => p.c === c);
    put(canopy(1), lam(STRIPES[c], { side: THREE.DoubleSide }), list, (p) => base(p));
  }
  // lounger: low frame, mattress and a raised backrest (local +z faces the sea)
  const lg = mergeGeos([
    new THREE.BoxGeometry(0.62, 0.08, 1.3).translate(0, 0.32, 0.25),
    new THREE.BoxGeometry(0.62, 0.08, 0.75).rotateX(-0.9).translate(0, 0.55, -0.62),
    new THREE.BoxGeometry(0.05, 0.3, 0.05).translate(0.27, 0.15, 0.8), new THREE.BoxGeometry(0.05, 0.3, 0.05).translate(-0.27, 0.15, 0.8),
    new THREE.BoxGeometry(0.05, 0.3, 0.05).translate(0.27, 0.15, -0.35), new THREE.BoxGeometry(0.05, 0.3, 0.05).translate(-0.27, 0.15, -0.35),
  ]);
  for (let c = 0; c < STRIPES.length; c++) {
    const list = by.lounger.filter((p) => p.c === c);
    put(lg, lam(new THREE.Color(STRIPES[c]).lerp(new THREE.Color(0xffffff), 0.55)), list, (p) => base(p));
  }
  // lifeguard hut on stilts with a ramp at the back
  const hutBody = mergeGeos([
    new THREE.BoxGeometry(3.2, 2.2, 3.2).translate(0, 3.3, 0),
    new THREE.BoxGeometry(3.8, 0.15, 3.8).translate(0, 2.15, 0),
  ]);
  const hutRoof = new THREE.ConeGeometry(2.8, 1.1, 4).rotateY(Math.PI / 4).translate(0, 4.95, 0);
  const legs = mergeGeos([[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]].map(([x, z]) => new THREE.BoxGeometry(0.18, 2.4, 0.18).translate(x, 1.0, z)).concat([
    new THREE.BoxGeometry(1.0, 0.1, 4.2).rotateX(0.5).translate(0, 1.05, -3.4),
  ]));
  const win = new THREE.BoxGeometry(2.2, 0.8, 0.05).translate(0, 3.6, 1.62);
  put(hutBody, lam(0xf2f0e8), by.hut, (p) => base(p));
  put(hutRoof, lam(0xd8383a), by.hut, (p) => base(p));
  put(legs, lam(0x9a7a5a), by.hut, (p) => base(p));
  put(win, lam(0x334455), by.hut, (p) => base(p), false);
}
void G;
