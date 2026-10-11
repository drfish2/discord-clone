// District dressing and landmarks: draws terrain.js `kit` (instanced primitives: boxes,
// cylinders, containers, billboards, neon blades) and `LANDMARKS` (cranes, water towers,
// lighthouse, pier and ferris wheel, chairlift), plus night light pools under the street lamps.
// Everything is procedural (no downloads). Colliders were registered in terrain.js.
import * as THREE from 'three';
import { G } from './core.js';
import { kit, LANDMARKS, lamps, roadAt, terrainHeight } from './terrain.js';
import { STYLES } from './districts.js';
import { TILED } from './assets.js';
import { mergeGeos } from './models.js';

const TILE = 500;
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), C = new THREE.Color(), E = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);
let wheel = null, beam = null, beacons = [];

// Lambert that glows in its own colour at night (k = strength)
const glowMats = {};
function glowLambert(k, extra = {}, base = 0) {
  const key = k + ':' + base + JSON.stringify(extra);
  if (glowMats[key]) return glowMats[key];
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, ...extra });
  if (k > 0) {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = G.uniforms.uNight;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNight;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance += diffuseColor.rgb * (${base.toFixed(2)} + uNight * ${k.toFixed(2)});`);
    };
    m.customProgramCacheKey = () => 'cc-glow-' + key;
  }
  return (glowMats[key] = m);
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
// small dressing is culled closer than buildings (own list, like flora.js)
const NEAR = [];
let nearT = 0;
// instanced meshes per 500 m tile (culled with the buildings, or at `cull` m), or one mesh for far landmarks
function instanced(scene, geo, mat, list, setup, { far = false, shadow = true, cull = 0 } = {}) {
  if (!list.length) return;
  const groups = new Map();
  for (const o of list) {
    const k = far ? 'far' : Math.floor(o.x / TILE) + ':' + Math.floor(o.z / TILE);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  }
  for (const [k, l] of groups) {
    const m = new THREE.InstancedMesh(geo, mat, l.length);
    l.forEach((o, i) => setup(m, o, i));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.castShadow = shadow && !G.lowQ;
    m.receiveShadow = true;
    m.computeBoundingSphere();
    if (k !== 'far') {
      const [ti, tj] = k.split(':').map(Number);
      m.userData.tile = { x: (ti + 0.5) * TILE, z: (tj + 0.5) * TILE, r: TILE * 0.75, far: cull };
      if (cull) NEAR.push(m); else TILED.push(m);
    }
    scene.add(m);
  }
}
const kitMatrix = (o) => {
  E.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ');
  Q.setFromEuler(E);
  return M4.compose(V.set(o.x, o.y, o.z), Q, S.set(o.sx, o.sy, o.sz));
};

// ---------------------------------------------------------------- textures
function containerTex() {
  return canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 6) { g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x, 0, 2, h); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x + 3, 0, 1, h); }
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, w, 3); g.fillRect(0, h - 3, w, 3); g.fillRect(0, 0, 3, h); g.fillRect(w - 3, 0, 3, h);
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = 'bold 13px Arial'; g.fillText('CRIMSON LINE', 14, 22);
  });
}
// invented brands only
const ADS = [
  ['#d62828', '#fff3c4', 'CLUCK SHACK', 'fried chicken, open late'],
  ['#1d3557', '#f1faee', 'REDLINE', 'energy drink. no brakes.'],
  ['#f4a261', '#1b1b1b', 'CORAL BAY', 'resort & casino'],
  ['#2a9d8f', '#ffffff', 'SUNNY LEGAL', 'hurt? call 555-0199'],
  ['#ffb703', '#2b2d42', 'BURGER ORBIT', 'out of this world'],
  ['#3a5a40', '#f5f0e1', 'PINEWOOD', 'realty. live higher.'],
  ['#111111', '#ff3fa4', 'CRIMSON FM', '101.7  all hits'],
  ['#8338ec', '#ffffff', 'MAX MOTORS', 'zero down, zero sense'],
];
// all eight ads in one 4 x 2 atlas; each billboard instance picks its cell (aAd)
function adAtlas() {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 512;
  const g = c.getContext('2d');
  for (let i = 0; i < ADS.length; i++) g.drawImage(adTex(i).image, (i % 4) * 512, Math.floor(i / 4) * 256, 512, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function adTex(i) {
  const [bg, fg, a, b] = ADS[i % ADS.length];
  return canvasTex(512, 210, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, bg); gr.addColorStop(1, '#000000');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.25; g.fillStyle = gr; g.fillRect(0, 0, w, h); g.globalAlpha = 1;
    g.fillStyle = fg; g.globalAlpha = 0.18;
    g.beginPath(); g.arc(w * 0.85, h * 0.3, 90, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
    g.font = '900 78px "Arial Black", Impact, sans-serif'; g.textBaseline = 'middle';
    g.fillText(a, 24, h * 0.42, w - 48);
    g.font = 'bold 30px Arial, sans-serif';
    g.fillText(b, 26, h * 0.8, w - 52);
  });
}
function radialTex() {
  return canvasTex(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}

function billMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, map: adAtlas() });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = G.uniforms.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAd;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = vec2((uv.x + mod(aAd, 4.0)) / 4.0, (uv.y + 1.0 - floor(aAd / 4.0)) / 2.0);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uNight * 0.55;');
  };
  m.customProgramCacheKey = () => 'cc-bill';
  return m;
}

// cull distances (m) for small dressing; landmarks (far) are never culled
const KIT_CULL = { box: 650, cyl: 800, cone: 800, sphere: 800, blade: 900, container: 1100, bill: 1300 };

// ---------------------------------------------------------------- kit
function buildKit(scene) {
  const geos = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
    cone: new THREE.ConeGeometry(0.5, 1, 14),
    sphere: new THREE.SphereGeometry(0.5, 12, 8),
    blade: new THREE.BoxGeometry(1, 1, 1),
    container: new THREE.BoxGeometry(1, 1, 1),
    bill: new THREE.PlaneGeometry(1, 1),
  };
  const groups = new Map();
  for (const o of kit) {
    const key = o.k + '|' + (o.glow || 0) + '|' + (o.far ? 1 : 0);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }
  const contMat = new THREE.MeshLambertMaterial({ map: containerTex() });
  let billMat = null;
  for (const [key, list] of groups) {
    const [k, glow, far] = key.split('|');
    let mat;
    if (k === 'container') mat = contMat;
    else if (k === 'bill') mat = billMat = billMat || billMaterial();
    else if (k === 'blade') mat = glowLambert(2.2);
    else if (+glow > 0 && +glow < 1) mat = glowLambert(0.9, {}, +glow); // painted signs: a little self-lit, floodlit at night
    else mat = glowLambert(+glow * (k === 'sphere' ? 3 : 1.6));
    instanced(scene, k === 'bill' ? geos.bill.clone() : geos[k], mat, list, (m, o, i) => {
      m.setMatrixAt(i, kitMatrix(o));
      m.setColorAt(i, C.setHex(o.c));
      if (k === 'bill') {
        if (!m.geometry.attributes.aAd) m.geometry.setAttribute('aAd', new THREE.InstancedBufferAttribute(new Float32Array(m.count), 1));
        m.geometry.attributes.aAd.setX(i, o.ad);
      }
    }, { far: far === '1', shadow: k !== 'blade' && k !== 'bill' && k !== 'box', cull: KIT_CULL[k] || 0 });
    if (k === 'sphere' && list.some((o) => o.beacon)) beacons.push(mat);
  }
}

// ---------------------------------------------------------------- night light pools under lamps
function buildPools(scene) {
  const heads = G.lampHeads || [];
  if (!heads.length) return;
  const mat = new THREE.MeshBasicMaterial({ map: radialTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = G.uniforms.uNight;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= smoothstep(0.35, 0.8, uNight) * 0.75;');
  };
  mat.customProgramCacheKey = () => 'cc-pool';
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const list = heads.map((h) => {
    const r = roadAt(h.x, h.z, h.y - 2);
    return { x: h.x, z: h.z, y: (r ?? terrainHeight(h.x, h.z)) + 0.1, c: h.c, s: h.sy > 0.5 ? 9 : 15 };
  });
  instanced(scene, geo, mat, list, (m, o, i) => {
    m.setMatrixAt(i, M4.compose(V.set(o.x, o.y, o.z), Q.identity(), S.set(o.s, 1, o.s)));
    m.setColorAt(i, C.setHex(o.c));
  }, { shadow: false, cull: 750 });
}

// ---------------------------------------------------------------- landmarks
const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
function addMesh(parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz, 'YXZ');
  m.castShadow = !G.lowQ;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
const boxG = (x, y, z) => new THREE.BoxGeometry(x, y, z);
// merge a group's untextured static meshes by material: one draw call per colour, not per part
function mergeStatic(group) {
  const shared = new Set(Object.values(glowMats));
  const by = new Map();
  for (const ch of [...group.children]) {
    if (!ch.isMesh || ch.isInstancedMesh || ch.material.map || ch.material.transparent) continue;
    const m = ch.material;
    const key = shared.has(m) ? m.uuid : 'c' + m.color.getHex();
    ch.updateMatrix();
    if (!by.has(key)) by.set(key, { mat: m, geos: [] });
    by.get(key).geos.push(ch.geometry.clone().applyMatrix4(ch.matrix));
    group.remove(ch);
  }
  for (const { mat, geos } of by.values()) {
    const mesh = new THREE.Mesh(mergeGeos(geos), mat);
    mesh.castShadow = !G.lowQ;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

function buildCrane(scene, L) {
  const g = new THREE.Group();
  g.position.set(L.x, L.y, L.z);
  g.rotation.y = L.rot;
  const s = L.scale, H = L.H;
  const steel = lam(L.color), dark = lam(0x3a3d40), white = lam(0xe8e8e2);
  const lx = 9 * s, lz = 8 * s;
  for (const [u, v] of [[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]]) addMesh(g, boxG(1.3 * s, H, 1.3 * s), steel, u, H / 2, v);
  for (const v of [-lz, lz]) { addMesh(g, boxG(lx * 2 + 1.4 * s, 1.8 * s, 1.4 * s), steel, 0, H, v); addMesh(g, boxG(lx * 2, 1 * s, 0.8 * s), steel, 0, 10 * s, v); }
  for (const u of [-lx, lx]) addMesh(g, boxG(1.4 * s, 1.8 * s, lz * 2 + 1.4 * s), steel, u, H, 0);
  // boom out over the water and the backreach over the yard
  addMesh(g, boxG(3 * s, 2.6 * s, 88 * s), steel, 0, H + 4 * s, 13 * s);
  addMesh(g, boxG(7 * s, 4.5 * s, 9 * s), white, 0, H + 7.5 * s, -22 * s); // machinery house
  addMesh(g, boxG(2.4 * s, 2.4 * s, 3 * s), white, 0, H + 1.4 * s, 22 * s); // trolley cab
  // A-frame and stays
  for (const u of [-1.5 * s, 1.5 * s]) addMesh(g, boxG(0.9 * s, 18 * s, 0.9 * s), steel, u, H + 13 * s, 0);
  const stay = (z1, y1) => {
    const dz = z1, dy = y1 - 22 * s, len = Math.hypot(dz, dy);
    addMesh(g, boxG(0.3 * s, 0.3 * s, len), dark, 0, H + 22 * s + dy / 2, dz / 2, Math.atan2(-dy, dz), 0, 0);
  };
  stay(55 * s, 4 * s);
  stay(-28 * s, 4 * s);
  // night: a red beacon on top
  addMesh(g, new THREE.SphereGeometry(0.6 * s, 8, 6), glowLambert(3, { color: 0xff2222 }), 0, H + 22.6 * s, 0);
  mergeStatic(g);
  scene.add(g);
}

function buildWaterTower(scene, L) {
  const g = new THREE.Group();
  g.position.set(L.x, L.y, L.z);
  const steel = lam(0x7a7f84);
  for (const [u, v] of [[-3.6, -3.6], [3.6, -3.6], [-3.6, 3.6], [3.6, 3.6]]) addMesh(g, boxG(0.5, L.legH, 0.5), steel, u, L.legH / 2, v);
  for (const y of [6, 13]) for (const r of [0, Math.PI / 2]) {
    addMesh(g, boxG(7.2, 0.25, 0.25), steel, 0, y, 3.6, 0, r, 0).position.set(Math.sin(r) * 3.6, y, Math.cos(r) * 3.6);
    addMesh(g, boxG(7.2, 0.25, 0.25), steel, 0, y, -3.6, 0, r, 0).position.set(-Math.sin(r) * 3.6, y, -Math.cos(r) * 3.6);
  }
  // tank with the town name painted twice around it
  const tex = canvasTex(1024, 192, (gc, w, h) => {
    gc.fillStyle = '#' + L.color.toString(16).padStart(6, '0'); gc.fillRect(0, 0, w, h);
    gc.fillStyle = L.band; gc.fillRect(0, 12, w, 14); gc.fillRect(0, h - 26, w, 14);
    gc.font = '900 96px "Arial Black", Impact, sans-serif'; gc.textAlign = 'center'; gc.textBaseline = 'middle';
    for (const cx of [w * 0.25, w * 0.75]) gc.fillText(L.text, cx, h / 2 + 4, w * 0.42);
  });
  addMesh(g, new THREE.CylinderGeometry(L.r, L.r, L.tankH, 28, 1, true), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }), 0, L.legH + L.tankH / 2, 0);
  addMesh(g, new THREE.ConeGeometry(L.r + 0.25, 2.4, 28), lam(0x5a5f64), 0, L.legH + L.tankH + 1.2, 0);
  addMesh(g, new THREE.CylinderGeometry(L.r, L.r * 0.4, 1.6, 28), lam(0x6a6f74), 0, L.legH - 0.8, 0);
  addMesh(g, new THREE.TorusGeometry(L.r + 0.6, 0.08, 4, 32).rotateX(Math.PI / 2), steel, 0, L.legH + 0.9, 0);
  mergeStatic(g);
  scene.add(g);
}

function buildLighthouse(scene, L) {
  const g = new THREE.Group();
  g.position.set(L.x, L.y, L.z);
  addMesh(g, new THREE.CylinderGeometry(4.6, 5.0, 3, 16), lam(0x8a8378), 0, 1.5, 0);
  const bands = 6, H = L.H;
  for (let k = 0; k < bands; k++) {
    const y0 = 3 + (k * H) / bands, y1 = 3 + ((k + 1) * H) / bands;
    const r0 = 3.4 - (k / bands) * 1.2, r1 = 3.4 - ((k + 1) / bands) * 1.2;
    addMesh(g, new THREE.CylinderGeometry(r1, r0, y1 - y0, 20), lam(k % 2 ? 0xc62828 : 0xf4f4f0), 0, (y0 + y1) / 2, 0);
  }
  const top = 3 + H;
  addMesh(g, new THREE.CylinderGeometry(3.1, 3.1, 0.4, 20), lam(0x2a2a2a), 0, top + 0.2, 0);
  addMesh(g, new THREE.TorusGeometry(3.0, 0.06, 4, 24).rotateX(Math.PI / 2), lam(0x2a2a2a), 0, top + 1.3, 0);
  const lm = glowLambert(2.5, { color: 0xfff1b0, transparent: true, opacity: 0.85 });
  addMesh(g, new THREE.CylinderGeometry(1.7, 1.7, 2.6, 12), lm, 0, top + 1.7, 0);
  addMesh(g, new THREE.ConeGeometry(2.2, 2, 12), lam(0x2a2a2a), 0, top + 4, 0);
  // the sweeping beam: two long additive cones, only at night
  const bmat = new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  beam = new THREE.Group();
  beam.position.set(0, top + 1.7, 0);
  for (const sg of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(9, 160, 16, 1, true), bmat);
    c.rotation.z = (sg * Math.PI) / 2;
    c.position.x = -sg * 80;
    beam.add(c);
  }
  beam.userData.mat = bmat;
  g.add(beam);
  mergeStatic(g);
  scene.add(g);
}

function plankTex() {
  const t = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#8a6a4a'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) {
      const v = 0.8 + Math.random() * 0.3;
      g.fillStyle = `rgb(${150 * v | 0},${112 * v | 0},${76 * v | 0})`; g.fillRect(x + 1, 0, 14, h);
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x, 0, 1, h);
      for (let y = (Math.random() * 64) | 0; y < h; y += 64 + ((Math.random() * 64) | 0)) g.fillRect(x, y, 16, 1);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function buildPier(scene, L) {
  const g = new THREE.Group();
  const deckTex = plankTex();
  const deckMat = new THREE.MeshLambertMaterial({ map: deckTex });
  const rot = L.rot, dx = L.dx, dz = L.dz;
  const ax = Math.cos(rot), az = -Math.sin(rot); // across the pier
  // deck: a box from the sand out to sea, then the platform
  const mk = (cx, cz, w, len) => {
    const geo = new THREE.BoxGeometry(w, 0.6, len);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 4, uv.getY(i) * len / 4);
    addMesh(g, geo, deckMat, cx, L.deckY - 0.3, cz, 0, rot, 0);
  };
  mk(L.x + dx * L.L / 2, L.z + dz * L.L / 2, L.W, L.L);
  mk(L.pc.x, L.pc.z, 34, 40);
  // piles and railings
  const piles = [];
  for (let t = 8; t < L.L + 36; t += 8) {
    const half = t > L.L ? 16.5 : L.W / 2 - 0.4;
    for (const sg of [-1, 1]) piles.push([L.x + dx * t + ax * half * sg, L.z + dz * t + az * half * sg]);
  }
  const pileMat = lam(0x4a3a2c);
  const pg = new THREE.CylinderGeometry(0.28, 0.32, 1, 8);
  const pm = new THREE.InstancedMesh(pg, pileMat, piles.length);
  piles.forEach(([x, z], i) => { const y0 = Math.min(-6, terrainHeight(x, z)); pm.setMatrixAt(i, M4.compose(V.set(x, (y0 + L.deckY) / 2, z), Q.identity(), S.set(1, L.deckY - y0, 1))); });
  g.add(pm);
  const rail = lam(0xf2f2ee);
  for (const sg of [-1, 1]) {
    addMesh(g, boxG(0.12, 0.12, L.L - 2), rail, L.x + dx * L.L / 2 + ax * (L.W / 2 - 0.1) * sg, L.deckY + 1.05, L.z + dz * L.L / 2 + az * (L.W / 2 - 0.1) * sg, 0, rot, 0);
    addMesh(g, boxG(0.12, 0.12, 40), rail, L.pc.x + ax * 16.9 * sg, L.deckY + 1.05, L.pc.z + az * 16.9 * sg, 0, rot, 0);
  }
  addMesh(g, boxG(34, 0.12, 0.12), rail, L.pc.x + dx * 19.9, L.deckY + 1.05, L.pc.z + dz * 19.9, 0, rot, 0);
  // lamp posts along the deck, glowing at night
  const bulb = glowLambert(2.2);
  for (let t = 20; t < L.L; t += 25) for (const sg of [-1, 1]) {
    const x = L.x + dx * t + ax * (L.W / 2 - 0.3) * sg, z = L.z + dz * t + az * (L.W / 2 - 0.3) * sg;
    addMesh(g, new THREE.CylinderGeometry(0.06, 0.08, 3.2, 6), lam(0x2a2a2a), x, L.deckY + 1.6, z);
    addMesh(g, new THREE.SphereGeometry(0.22, 8, 6), bulb, x, L.deckY + 3.3, z);
  }
  // ferris wheel
  const wg = new THREE.Group();
  wg.position.set(L.wc.x, L.axleY, L.wc.z);
  wg.rotation.y = rot; // axle along local z (= along the pier)
  const frame = lam(0xf4f4f0);
  // A-frames at both axle ends
  for (const az2 of [-3.2, 3.2]) for (const sg of [-1, 1]) {
    const dyL = L.axleY - L.deckY, dxL = 9;
    const len = Math.hypot(dyL, dxL);
    addMesh(wg, boxG(0.6, len, 0.6), frame, sg * dxL / 2, -dyL / 2, az2, 0, 0, sg * Math.atan2(dxL, dyL));
  }
  addMesh(wg, new THREE.CylinderGeometry(0.5, 0.5, 7.2, 10).rotateX(Math.PI / 2), lam(0x9a9a9a), 0, 0, 0);
  const rotor = new THREE.Group();
  wg.add(rotor);
  const R = L.R;
  const rim = glowLambert(0.9, { color: 0xfff4f8 }); // the wheel outlines itself in light at night
  for (const zz of [-1.4, 1.4]) addMesh(rotor, new THREE.TorusGeometry(R, 0.22, 6, 48), rim, 0, 0, zz);
  const N = 20;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    for (const zz of [-1.4, 1.4]) addMesh(rotor, boxG(0.12, R, 0.12), rim, Math.cos(a) * R / 2, Math.sin(a) * R / 2, zz, 0, 0, a - Math.PI / 2);
  }
  // rim lights (glow at night), coloured
  const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 6, 4), glowLambert(3), N * 4);
  for (let k = 0; k < N * 2; k++) {
    const a = (k / (N * 2)) * Math.PI * 2;
    for (const [j, zz] of [[0, -1.65], [1, 1.65]]) {
      const i = k * 2 + j;
      lights.setMatrixAt(i, M4.compose(V.set(Math.cos(a) * R, Math.sin(a) * R, zz), Q.identity(), S.set(1, 1, 1)));
      lights.setColorAt(i, C.setHex([0xff3fa4, 0x29e0ff, 0xffe14a, 0xffffff][k % 4]));
    }
  }
  rotor.add(lights);
  // cabins hang from the rim and stay level
  const cabG = new THREE.BoxGeometry(2.2, 2.2, 2.4);
  const cabins = new THREE.InstancedMesh(cabG, lam(0xffffff), N);
  for (let k = 0; k < N; k++) cabins.setColorAt(k, C.setHex([0xe86fa8, 0x2ab0b0, 0xf2b630, 0x6fa8dc][k % 4]));
  cabins.castShadow = !G.lowQ;
  wg.add(cabins);
  addMesh(g, boxG(5, 3, 4), lam(0xe86fa8), L.wc.x - ax * 6, L.deckY + 1.5, L.wc.z - az * 6, 0, rot, 0); // ticket booth
  g.add(wg);
  wheel = { rotor, cabins, N, R, a: 0 };
  mergeStatic(rotor);
  mergeStatic(wg);
  mergeStatic(g);
  scene.add(g);
}

function buildChairlift(scene, L) {
  const g = new THREE.Group();
  const P = L.pylons;
  const steel = lam(0x6a7076), dark = lam(0x2a2c2e);
  const ax = Math.cos(L.rot), az = -Math.sin(L.rot);
  for (const p of P) {
    addMesh(g, new THREE.CylinderGeometry(0.55, 0.8, p.h, 10), steel, p.x, p.y + p.h / 2, p.z);
    addMesh(g, boxG(7, 0.8, 1.0), lam(0xd0a020), p.x, p.y + p.h, p.z, 0, L.rot, 0);
  }
  const chairs = [];
  for (let i = 0; i + 1 < P.length; i++) {
    const a = P[i], b = P[i + 1];
    for (const sg of [-1, 1]) {
      const x0 = a.x + ax * 2.9 * sg, z0 = a.z + az * 2.9 * sg, y0 = a.y + a.h - 0.2;
      const x1 = b.x + ax * 2.9 * sg, z1 = b.z + az * 2.9 * sg, y1 = b.y + b.h - 0.2;
      const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0), hl = Math.hypot(x1 - x0, z1 - z0);
      addMesh(g, boxG(0.16, 0.16, len), dark, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, -Math.atan2(y1 - y0, hl), Math.atan2(x1 - x0, z1 - z0), 0);
      for (let t = 14; t < len - 8; t += 28) {
        const f = t / len;
        chairs.push([x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, z0 + (z1 - z0) * f, sg]);
      }
    }
  }
  if (chairs.length) {
    const cg = new THREE.BoxGeometry(1.6, 0.9, 0.8).translate(0, -2.2, 0);
    const hg = new THREE.BoxGeometry(0.06, 2, 0.06).translate(0, -1, 0);
    const cm = new THREE.InstancedMesh(cg, lam(0xc62828), chairs.length), hm = new THREE.InstancedMesh(hg, dark, chairs.length);
    chairs.forEach(([x, y, z], i) => { M4.compose(V.set(x, y, z), Q.setFromAxisAngle(UP, L.rot), S.set(1, 1, 1)); cm.setMatrixAt(i, M4); hm.setMatrixAt(i, M4); });
    g.add(cm, hm);
  }
  mergeStatic(g);
  scene.add(g);
}

function buildHillSign(scene, L) {
  // ground floodlights in front of each letter, lit at night
  const m = glowLambert(2.5);
  const fx = Math.sin(L.rot), fz = Math.cos(L.rot);
  const list = L.letters.map((p) => ({ x: p.x + fx * 4, z: p.z + fz * 4, y: terrainHeight(p.x + fx * 4, p.z + fz * 4) + 0.4 }));
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.8, 0.6, 0.6), m, list.length);
  list.forEach((p, i) => { im.setMatrixAt(i, M4.compose(V.set(p.x, p.y, p.z), Q.setFromAxisAngle(UP, L.rot), S.set(1, 1, 1))); im.setColorAt(i, C.setHex(0xfff4d0)); });
  scene.add(im);
}

export function buildDressing(scene) {
  buildKit(scene);
  buildPools(scene);
  for (const L of LANDMARKS) {
    if (L.type === 'crane') buildCrane(scene, L);
    else if (L.type === 'watertower') buildWaterTower(scene, L);
    else if (L.type === 'lighthouse') buildLighthouse(scene, L);
    else if (L.type === 'pier') buildPier(scene, L);
    else if (L.type === 'chairlift') buildChairlift(scene, L);
    else if (L.type === 'hillsign') buildHillSign(scene, L);
  }
  void STYLES; void lamps;
}

export function updateDressing(dt) {
  nearT -= dt;
  if (nearT <= 0 && G.camera) {
    nearT = 0.4;
    const c = G.camera.position;
    for (const m of NEAR) { const t = m.userData.tile; m.visible = Math.hypot(c.x - t.x, c.z - t.z) - t.r < t.far; }
  }
  if (wheel) {
    wheel.a += dt * 0.06;
    wheel.rotor.rotation.z = wheel.a;
    for (let k = 0; k < wheel.N; k++) {
      const a = wheel.a + (k / wheel.N) * Math.PI * 2;
      wheel.cabins.setMatrixAt(k, M4.compose(V.set(Math.cos(a) * wheel.R, Math.sin(a) * wheel.R - 1.6, 0), Q.identity(), S.set(1, 1, 1)));
    }
    wheel.cabins.instanceMatrix.needsUpdate = true;
  }
  if (beam) {
    beam.rotation.y += dt * 0.9;
    beam.userData.mat.opacity = Math.max(0, G.night - 0.35) * 0.32;
    beam.visible = G.night > 0.4;
  }
}
