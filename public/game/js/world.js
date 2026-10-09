// Turns world data into meshes; sky, lighting and day/night cycle.
import * as THREE from 'three';
import { G, clamp, lerp, sstep, WATER } from './core.js';
import {
  H, TN, TS, HALF, CL, segs, nodes, HIGHWAYS, blockType, blockRect, buildings, trees, lamps, ramps, decor, signs,
  terrainHeight, desertF, mountainF, forestF, AIRPORT, SPECIAL, SLAB_TOP, ROAD_W, generateWorldData, riverDist,
} from './terrain.js';
import { noise2 } from './noise.js';
import { mergeGeos, colorGeo } from './models.js';

const M4 = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const V = new THREE.Vector3();
const S = new THREE.Vector3();
const C = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

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
function roadTexture(highway) {
  return canvasTex(256, 512, (g, w, h) => {
    asphalt(g, w, h);
    if (highway) {
      g.fillStyle = '#e8c547';
      g.fillRect(w * 0.5 - 7, 0, 4, h);
      g.fillRect(w * 0.5 + 3, 0, 4, h);
      g.fillStyle = '#eeeeee';
      g.fillRect(w * 0.05, 0, 4, h);
      g.fillRect(w * 0.95 - 4, 0, 4, h);
      for (let y = 0; y < h; y += 128) {
        g.fillRect(w * 0.27, y, 3, 64);
        g.fillRect(w * 0.73, y, 3, 64);
      }
    } else {
      g.fillStyle = '#e9e9e9';
      for (let y = 0; y < h; y += 128) g.fillRect(w * 0.5 - 2, y, 4, 64);
      g.fillRect(w * 0.04, 0, 3, h);
      g.fillRect(w * 0.96 - 3, 0, 3, h);
    }
  });
}

// ---------------------------------------------------------------- terrain
function terrainColor(x, z, h, slope, out) {
  let r = 0.36, g = 0.54, b = 0.24;
  const n = noise2(x * 0.02, z * 0.02) * 0.05 + noise2(x * 0.2, z * 0.2) * 0.02;
  const fW = forestF(x), mN = mountainF(z), dS = desertF(x, z);
  if (fW > 0) { r = lerp(r, 0.22, fW); g = lerp(g, 0.42, fW); b = lerp(b, 0.17, fW); }
  if (dS > 0) { r = lerp(r, 0.86, dS); g = lerp(g, 0.68, dS); b = lerp(b, 0.45, dS); }
  if (mN > 0) {
    const rock = clamp(slope * 1.6 + (h - 120) / 250, 0, 1) * mN;
    r = lerp(r, 0.47, rock); g = lerp(g, 0.44, rock); b = lerp(b, 0.41, rock);
    const snow = sstep(300, 360, h + n * 200) * (1 - clamp(slope - 0.9, 0, 1));
    r = lerp(r, 0.95, snow); g = lerp(g, 0.96, snow); b = lerp(b, 0.98, snow);
  } else if (slope > 0.7) {
    const k = clamp((slope - 0.7) * 2, 0, 0.8);
    r = lerp(r, 0.5, k); g = lerp(g, 0.45, k); b = lerp(b, 0.38, k);
  }
  if (h < 2.2 && h > -1.5) { r = 0.82; g = 0.76; b = 0.58; }
  if (h <= -1.5) { r = 0.42; g = 0.4; b = 0.33; }
  const ce = Math.max(Math.abs(x), Math.abs(z));
  if (ce < 830 && h > 0) { r = 0.42; g = 0.44; b = 0.4; }
  out.setRGB(clamp(r + n, 0, 1), clamp(g + n, 0, 1), clamp(b + n * 0.5, 0, 1));
}

function buildTerrain(scene) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const CH = 60; // cells per chunk
  const NCH = TN / CH;
  const hAt = (i, j) => H[clamp(j, 0, TN) * (TN + 1) + clamp(i, 0, TN)];
  for (let cj = 0; cj < NCH; cj++)
    for (let ci = 0; ci < NCH; ci++) {
      const n = CH + 1;
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
function pushQuad(arr, p, uv, ax, ay, az, bx, by, bz, w, v0, v1, extend = 0) {
  const dx = bx - ax, dz = bz - az;
  const L = Math.hypot(dx, dz);
  const ux = dx / L, uz = dz / L;
  ax -= ux * extend; az -= uz * extend; bx += ux * extend; bz += uz * extend;
  const px = -uz * w / 2, pz = ux * w / 2;
  const P = [ax + px, ay, az + pz, ax - px, ay, az - pz, bx + px, by, bz + pz, bx - px, by, bz - pz];
  const U = [0, v0, 1, v0, 0, v1, 1, v1];
  const o = p.length / 3;
  p.push(...P);
  uv.push(...U);
  arr.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
}
function meshFrom(p, uv, idx, mat, y = 0) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y;
  m.receiveShadow = true;
  return m;
}

const boxList = []; // generic instanced boxes {m:Matrix4,color}
function addBox(x, y, z, sx, sy, sz, rotY, color, q = null) {
  if (q) Q.copy(q);
  else Q.setFromAxisAngle(UP, rotY);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), Q.clone(), new THREE.Vector3(sx, sy, sz));
  boxList.push({ m, color });
}

function buildRoads(scene) {
  const cityMat = new THREE.MeshLambertMaterial({ map: roadTexture(false) });
  const hwyMat = new THREE.MeshLambertMaterial({ map: roadTexture(true) });
  const plainMat = new THREE.MeshLambertMaterial({ map: canvasTex(128, 128, (g, w, h) => asphalt(g, w, h)) });
  const crossTex = canvasTex(256, 64, (g, w, h) => {
    asphalt(g, w, h);
    g.fillStyle = '#efefef';
    for (let x = 10; x < w; x += 26) g.fillRect(x, 4, 14, h - 8);
  });
  const crossMat = new THREE.MeshLambertMaterial({ map: crossTex, polygonOffset: true, polygonOffsetFactor: -2 });
  plainMat.polygonOffset = true;
  plainMat.polygonOffsetFactor = -1;

  const c = { p: [], uv: [], i: [] }, x = { p: [], uv: [], i: [] }, pl = { p: [], uv: [], i: [] };
  for (const s of segs) {
    if (s.kind !== 'city') continue;
    const t = s.w / 2;
    const ax = s.a.x + s.dx * t, az = s.a.z + s.dz * t, bx = s.b.x - s.dx * t, bz = s.b.z - s.dz * t;
    pushQuad(c.i, c.p, c.uv, ax, s.a.h + 0.04, az, bx, s.b.h + 0.04, bz, s.w, 0, (s.len - s.w) / 20);
    // crosswalks at both ends
    pushQuad(x.i, x.p, x.uv, ax, s.a.h + 0.05, az, ax + s.dx * 4, s.a.h + 0.05, az + s.dz * 4, s.w, 0, 1);
    pushQuad(x.i, x.p, x.uv, bx - s.dx * 4, s.b.h + 0.05, bz - s.dz * 4, bx, s.b.h + 0.05, bz, s.w, 0, 1);
  }
  // intersections
  for (const n of nodes) {
    if (Math.abs(n.x) > 801 || Math.abs(n.z) > 801) continue;
    if (n.edges.length < 2) continue;
    if (!n.edges.some((e) => e.s.kind === 'city')) continue;
    const h = ROAD_W / 2;
    pushQuad(pl.i, pl.p, pl.uv, n.x - h, n.h + 0.06, n.z, n.x + h, n.h + 0.06, n.z, ROAD_W + (n.edges.some((e) => e.s.kind === 'hwy') ? 2 : 0), 0, 1);
  }
  // highways as continuous strips
  const hp = [], huv = [], hi = [];
  for (const hw of HIGHWAYS) {
    const N = hw.nodes;
    let v = 0;
    const base = hp.length / 3;
    for (let k = 0; k < N.length; k++) {
      const a = N[Math.max(0, k - 1)], b = N[Math.min(N.length - 1, k + 1)];
      let dx = b.x - a.x, dz = b.z - a.z;
      const L = Math.hypot(dx, dz);
      dx /= L; dz /= L;
      const w = 8;
      const n = N[k];
      if (k > 0) v += Math.hypot(n.x - N[k - 1].x, n.z - N[k - 1].z) / 20;
      hp.push(n.x - dz * w, n.h + 0.05, n.z + dx * w, n.x + dz * w, n.h + 0.05, n.z - dx * w);
      huv.push(0, v, 1, v);
      if (k > 0) {
        const o = base + (k - 1) * 2;
        hi.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
      }
    }
  }
  scene.add(meshFrom(c.p, c.uv, c.i, cityMat));
  scene.add(meshFrom(x.p, x.uv, x.i, crossMat));
  scene.add(meshFrom(pl.p, pl.uv, pl.i, plainMat));
  const hm = meshFrom(hp, huv, hi, hwyMat);
  hm.material.side = THREE.DoubleSide;
  scene.add(hm);

  // bridges: deck, rails, pillars
  for (const s of segs) {
    if (!s.bridge) continue;
    const mx = (s.a.x + s.b.x) / 2, mz = (s.a.z + s.b.z) / 2, mh = (s.a.h + s.b.h) / 2;
    const dir = V.set(s.b.x - s.a.x, s.b.h - s.a.h, s.b.z - s.a.z).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    const L = Math.hypot(s.b.x - s.a.x, s.b.h - s.a.h, s.b.z - s.a.z) + 0.6;
    addBox(mx, mh - 0.6, mz, s.w + 1, 1.2, L, 0, 0x8d8a84, q);
    for (const side of [-1, 1]) {
      const ox = -s.dz * (s.w / 2 + 0.3) * side, oz = s.dx * (s.w / 2 + 0.3) * side;
      addBox(mx + ox, mh + 0.5, mz + oz, 0.35, 1.0, L, 0, 0xb5b0a8, q);
    }
    const tg = terrainHeight(mx, mz);
    if (mh - tg > 3) addBox(mx, (mh - 1.2 + Math.min(tg, -7)) / 2, mz, 2.5, mh - 1.2 - Math.min(tg, -7), 2.5, Math.atan2(s.dx, s.dz), 0x7d7a74);
  }
}

// ---------------------------------------------------------------- buildings
function buildingMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.05 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = G.uniforms.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vWP = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
          vWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        #else
          vWP = (modelMatrix * vec4(position, 1.0)).xyz;
          vWN = normalize(mat3(modelMatrix) * normal);
        #endif`
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; uniform float uNight; float vWin; float vLit;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 n = normalize(vWN);
          float wall = 1.0 - step(0.5, abs(n.y));
          vec2 p = vec2(abs(n.x) > 0.5 ? vWP.z : vWP.x, vWP.y - 3.2);
          vec2 cell = p / vec2(3.6, 3.4);
          vec2 f = fract(cell);
          float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.28, f.y) * step(f.y, 0.86) * step(0.0, p.y);
          win *= wall;
          float rnd = fract(sin(dot(floor(cell) + vec2(n.x * 17.0 + n.z * 31.0, floor(vWP.x * 0.02) * 7.0), vec2(12.9898, 78.233))) * 43758.5453);
          vWin = win;
          vLit = step(0.55, rnd) * win;
          vec3 glass = vec3(0.16, 0.2, 0.26) + vec3(0.1, 0.12, 0.14) * rnd;
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, win * 0.85);
          diffuseColor.rgb *= mix(1.0, 0.62, 1.0 - wall);
          // ground floor darker band
          diffuseColor.rgb *= mix(0.82, 1.0, step(1.2, vWP.y - 3.2) * 0.0 + step(0.0, p.y - 0.6));
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

function buildBuildings(scene) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geo, buildingMaterial(), buildings.length);
  const houses = buildings.filter((b) => b.roof);
  const roofGeo = new THREE.ConeGeometry(0.7072, 1, 4, 1);
  roofGeo.rotateY(Math.PI / 4);
  roofGeo.translate(0, 0.5, 0);
  const roofMesh = new THREE.InstancedMesh(roofGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), houses.length);
  let ri = 0;
  buildings.forEach((b, i) => {
    M4.compose(V.set((b.x0 + b.x1) / 2, b.y0, (b.z0 + b.z1) / 2), Q.identity(), S.set(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0));
    mesh.setMatrixAt(i, M4);
    mesh.setColorAt(i, C.setHex(b.color));
    if (b.roof) {
      M4.compose(V.set((b.x0 + b.x1) / 2, b.y1, (b.z0 + b.z1) / 2), Q.identity(), S.set((b.x1 - b.x0) * 1.04, Math.min(b.x1 - b.x0, b.z1 - b.z0) * 0.35, (b.z1 - b.z0) * 1.04));
      roofMesh.setMatrixAt(ri, M4);
      roofMesh.setColorAt(ri++, C.setHex(b.roof));
    }
    if (b.kind === 'tower' && b.y1 - b.y0 > 30) {
      // rooftop details
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      addBox(cx, b.y1 + 1.5, cz, (b.x1 - b.x0) * 0.4, 3, (b.z1 - b.z0) * 0.35, 0, 0x6b6f75);
    }
    if (b.kind === 'hospital' || b.kind === 'police') {
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      addBox(cx, b.y1 + 0.06, cz, 14, 0.1, 14, 0, b.kind === 'hospital' ? 0xd32f2f : 0xf2c200);
    }
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  roofMesh.castShadow = true;
  scene.add(mesh, roofMesh);

  // sidewalk slabs
  const slabs = [];
  for (let bi = 0; bi < 16; bi++)
    for (let bj = 0; bj < 16; bj++) {
      const t = blockType[bi][bj];
      if (t === 'river') continue;
      const r = blockRect(bi, bj);
      slabs.push({ r, color: t === 'plaza' ? 0xc9bfae : t.startsWith('gang') ? 0x8c8780 : 0xa3a39d });
      if (t === 'park' || t.startsWith('gang') || t === 'res') slabs.push({ r: { x0: r.x0 + 3, x1: r.x1 - 3, z0: r.z0 + 3, z1: r.z1 - 3 }, color: t === 'park' ? 0x5f9440 : 0x6f9a4a, top: 0.02 });
      if (t === 'spray') {
        const s = SPECIAL.spray;
        slabs.push({ r: { x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1 }, color: 0xf2b400, top: 0.03 });
      }
    }
  const slabGeo = new THREE.BoxGeometry(1, 1, 1);
  const slab = new THREE.InstancedMesh(slabGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), slabs.length);
  slabs.forEach((s, i) => {
    const top = SLAB_TOP + (s.top || 0);
    M4.compose(V.set((s.r.x0 + s.r.x1) / 2, (top + 2.6) / 2, (s.r.z0 + s.r.z1) / 2), Q.identity(), S.set(s.r.x1 - s.r.x0, top - 2.6, s.r.z1 - s.r.z0));
    slab.setMatrixAt(i, M4);
    slab.setColorAt(i, C.setHex(s.color));
  });
  slab.receiveShadow = true;
  scene.add(slab);

  // river quay walls inside the city
  for (const x of [-393, -307]) addBox(x, -2, 0, 1, 10, 1600, 0, 0x8f877b);
}

// ---------------------------------------------------------------- nature
function buildTrees(scene) {
  const by = { pine: [], round: [], cactus: [], rock: [], bush: [] };
  for (const t of trees) by[t.type].push(t);
  const lam = (c) => new THREE.MeshLambertMaterial({ color: c });
  const make = (geo, mat, list, cb, shadow = true) => {
    if (!list.length) return;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((t, i) => {
      cb(t, i, m);
      m.setMatrixAt(i, M4);
    });
    m.castShadow = shadow;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  const rotQ = (t) => Q.setFromAxisAngle(UP, (t.x * 13.1 + t.z * 7.7) % 6.28);
  // pine
  const pt = new THREE.CylinderGeometry(0.18, 0.28, 2.2, 5);
  pt.translate(0, 1.1, 0);
  const pl = mergeGeos([
    new THREE.ConeGeometry(2.2, 4.2, 7).translate(0, 3.6, 0),
    new THREE.ConeGeometry(1.7, 3.4, 7).translate(0, 5.6, 0),
    new THREE.ConeGeometry(1.1, 2.4, 7).translate(0, 7.3, 0),
  ]);
  make(pt, lam(0x5b3f2a), by.pine, (t) => M4.compose(V.set(t.x, t.y, t.z), rotQ(t), S.set(t.s, t.s, t.s)));
  const leaves = make(pl, lam(0xffffff), by.pine, (t, i, m) => {
    M4.compose(V.set(t.x, t.y, t.z), rotQ(t), S.set(t.s, t.s * 1.1, t.s));
    const v = 0.85 + ((t.x * 7.3 + t.z) % 1 + 1) % 1 * 0.3;
    m.setColorAt(i, C.setRGB(0.16 * v, 0.36 * v, 0.2 * v));
  });
  // round
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
  // cactus
  const cg = mergeGeos([
    new THREE.CylinderGeometry(0.35, 0.4, 4.5, 6).translate(0, 2.25, 0),
    new THREE.CylinderGeometry(0.22, 0.22, 1.6, 6).translate(0.7, 2.6, 0),
    new THREE.CylinderGeometry(0.22, 0.22, 1.0, 6).rotateZ(Math.PI / 2).translate(0.4, 1.9, 0),
    new THREE.CylinderGeometry(0.2, 0.2, 1.3, 6).translate(-0.6, 3.1, 0),
    new THREE.CylinderGeometry(0.2, 0.2, 0.8, 6).rotateZ(Math.PI / 2).translate(-0.35, 2.5, 0),
  ]);
  make(cg, lam(0x4f7d3a), by.cactus, (t) => M4.compose(V.set(t.x, t.y, t.z), rotQ(t), S.set(t.s, t.s, t.s)));
  const rg = new THREE.DodecahedronGeometry(1.4, 0);
  make(rg, lam(0x8a8178), by.rock, (t) => M4.compose(V.set(t.x, t.y + 0.2 * t.s, t.z), rotQ(t), S.set(t.s * 1.3, t.s * 0.8, t.s)));
  const bg = new THREE.IcosahedronGeometry(0.9, 0);
  make(bg, lam(0x7c7a3a), by.bush, (t) => M4.compose(V.set(t.x, t.y + 0.4, t.z), rotQ(t), S.set(t.s * 1.3, t.s * 0.7, t.s)), false);
  if (leaves) leaves.instanceColor.needsUpdate = true;
}

function buildLamps(scene) {
  const pole = new THREE.CylinderGeometry(0.1, 0.14, 7, 6);
  pole.translate(0, 3.5, 0);
  const arm = new THREE.BoxGeometry(0.12, 0.12, 2);
  arm.translate(0, 6.9, -1);
  const head = new THREE.BoxGeometry(0.5, 0.2, 0.9);
  head.translate(0, 6.8, -1.8);
  const poleM = new THREE.InstancedMesh(mergeGeos([pole, arm]), new THREE.MeshLambertMaterial({ color: 0x3a3f44 }), lamps.length);
  lampMat = new THREE.MeshBasicMaterial({ color: 0x888877 });
  const headM = new THREE.InstancedMesh(head, lampMat, lamps.length);
  lamps.forEach((l, i) => {
    M4.compose(V.set(l.x, SLAB_TOP, l.z), Q.setFromAxisAngle(UP, l.rot), S.set(1, 1, 1));
    poleM.setMatrixAt(i, M4);
    headM.setMatrixAt(i, M4);
  });
  scene.add(poleM, headM);
}

// ---------------------------------------------------------------- misc
function buildAirport(scene) {
  const A = AIRPORT;
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
  const p = [], uv = [], idx = [];
  pushQuad(idx, p, uv, A.runwayX0, 3.0, A.runwayZ, A.runwayX1, 3.0, A.runwayZ, A.runwayW, 0, 1);
  scene.add(meshFrom(p, uv, idx, new THREE.MeshLambertMaterial({ map: rwTex })));
  const conc = new THREE.MeshLambertMaterial({ map: canvasTex(128, 128, (g, w, h) => asphalt(g, w, h, 140)) });
  const p2 = [], uv2 = [], i2 = [];
  pushQuad(i2, p2, uv2, 1250, 3.0, 120, 2050, 3.0, 120, 120, 0, 8);
  pushQuad(i2, p2, uv2, 1300, 3.0, -95, 1300, 3.0, 62, 30, 0, 2);
  pushQuad(i2, p2, uv2, 1900, 3.0, -95, 1900, 3.0, 62, 30, 0, 2);
  const m2 = meshFrom(p2, uv2, i2, conc);
  m2.material.side = THREE.DoubleSide;
  scene.add(m2);
  // helipad markings
  for (const [x, z] of [[1750, 110], [1800, 110]]) addBox(x, 3.05, z, 14, 0.06, 14, 0, 0xf2c200);
}

function buildRamps(scene) {
  const geo = new THREE.BufferGeometry();
  // wedge: base at z=0..1, rising along +z, x in -0.5..0.5
  const v = [
    -0.5, 0, 0, 0.5, 0, 0, -0.5, 0, 1, 0.5, 0, 1, -0.5, 1, 1, 0.5, 1, 1,
  ];
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
  for (const d of decor) {
    if (d.dome) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(d.r, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.3, metalness: 0.4 }));
      m.position.set(d.x, d.y, d.z);
      scene.add(m);
      continue;
    }
    if (d.emissive) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(d.sx, d.sy, d.sz), new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.1, transparent: true, opacity: 0.85 }));
      m.position.set(d.x, d.y, d.z);
      scene.add(m);
      continue;
    }
    addBox(d.x, d.y, d.z, d.sx, d.sy, d.sz, d.rot, d.color);
  }
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
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), new THREE.MeshBasicMaterial({ map: tex, transparent: !s.bg, side: THREE.DoubleSide, fog: !s.hill }));
    let y = s.y;
    if (s.hill) {
      let mh = -Infinity;
      for (let k = -1; k <= 1; k += 0.1) mh = Math.max(mh, terrainHeight(s.x + (k * s.w) / 2, s.z + 6));
      y = mh + s.h / 2 - 4;
      m.rotation.x = -0.25;
    }
    m.position.set(s.x, y, s.z);
    m.rotation.y = s.rot;
    scene.add(m);
  }
}

function flushBoxes(scene) {
  if (!boxList.length) return;
  const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), boxList.length);
  boxList.forEach((b, i) => {
    m.setMatrixAt(i, b.m);
    m.setColorAt(i, C.setHex(b.color));
  });
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
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
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4500, 32, 16), skyMat);
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
  for (let i = 0; i < 70; i++) {
    const s = new THREE.Sprite(cm);
    s.position.set((Math.random() - 0.5) * 7000, 650 + Math.random() * 350, (Math.random() - 0.5) * 7000);
    const sc = 300 + Math.random() * 500;
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
  const w = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000), waterMat);
  w.rotation.x = -Math.PI / 2;
  w.position.y = WATER;
  w.receiveShadow = true;
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
  fog = new THREE.Fog(0xbfdcf2, 500, 3200);
  scene.fog = fog;
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
  // light follows sun or moon
  const lightDir = sy > -0.05 ? sunDir : V.set(-sx * 0.6, -sy, 0.4).normalize();
  sun.intensity = sy > -0.05 ? 2.4 * sstep(-0.05, 0.2, sy) + 0.05 : 0.35;
  sun.color.setHex(sy > -0.05 ? 0xfff1d6 : 0x9fb4ff).lerp(new THREE.Color(0xffa060), dusk * 0.6);
  hemi.intensity = 0.25 + day * 0.75;
  sun.position.set(focus.x + lightDir.x * 400, focus.y + lightDir.y * 400, focus.z + lightDir.z * 400);
  sun.target.position.copy(focus);
  // snap shadow camera to texel grid to reduce shimmering
  lampMat.color.setHex(G.night > 0.5 ? 0xffe2a0 : 0x888877);
  G.cloudMat.opacity = 0.25 + day * 0.65;
  clouds.position.x = (G.time * 3) % 1000;
  G.uniforms.uTime.value = G.time;
}

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
  buildAirport(scene);
  buildRamps(scene);
  buildDecor(scene);
  flushBoxes(scene);
}
