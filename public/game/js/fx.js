// Particles, bullet tracers, explosions flash.
import * as THREE from 'three';
import { G, rand } from './core.js';

const MAX = 3000;
function makeSystem(additive) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(MAX * 3), col = new Float32Array(MAX * 4), size = new Float32Array(MAX);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { scale: { value: 600 } },
    vertexShader: `attribute float size; attribute vec4 color; varying vec4 vC; uniform float scale;
      void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / max(-mv.z, 0.1); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec4 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if (r > 0.25) discard; float a = smoothstep(0.25, 0.05, r); gl_FragColor = vec4(vC.rgb, vC.a * a); }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  return { pts, geo, pos, col, size, list: [] };
}
let addSys, alphaSys, tracerGeo, tracerLines, flash;
const tracers = [];
const TR = 80;

export function initFx(scene) {
  addSys = makeSystem(true);
  alphaSys = makeSystem(false);
  scene.add(addSys.pts, alphaSys.pts);
  tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TR * 6), 3).setUsage(THREE.DynamicDrawUsage));
  tracerLines = new THREE.LineSegments(tracerGeo, new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.85 }));
  tracerLines.frustumCulled = false;
  scene.add(tracerLines);
  for (let i = 0; i < TR; i++) tracers.push({ life: 0 });
  flash = new THREE.PointLight(0xffa040, 0, 60, 1.6);
  scene.add(flash);
}

const TYPES = {
  smoke: { add: false, life: [1.6, 3], size: [1.2, 5], col: [0.35, 0.35, 0.35, 0.55], grav: -2.2, drag: 1.2 },
  blacksmoke: { add: false, life: [2, 4], size: [2, 8], col: [0.08, 0.08, 0.08, 0.6], grav: -3, drag: 1 },
  fire: { add: true, life: [0.3, 0.8], size: [1.5, 0.3], col: [1, 0.55, 0.15, 0.9], grav: -5, drag: 2 },
  spark: { add: true, life: [0.15, 0.4], size: [0.25, 0.05], col: [1, 0.85, 0.4, 1], grav: 14, drag: 0.5 },
  muzzle: { add: true, life: [0.04, 0.06], size: [0.7, 0.2], col: [1, 0.8, 0.35, 1], grav: 0, drag: 0 },
  blood: { add: false, life: [0.4, 0.8], size: [0.25, 0.15], col: [0.55, 0.02, 0.02, 0.9], grav: 12, drag: 0.5 },
  dust: { add: false, life: [0.6, 1.4], size: [0.6, 2.4], col: [0.6, 0.55, 0.45, 0.35], grav: -0.5, drag: 2 },
  splash: { add: false, life: [0.5, 1], size: [0.5, 1.2], col: [0.85, 0.92, 1, 0.7], grav: 14, drag: 0.3 },
  debris: { add: false, life: [0.8, 1.5], size: [0.35, 0.35], col: [0.12, 0.12, 0.12, 1], grav: 18, drag: 0.2 },
  exhaust: { add: false, life: [0.4, 0.8], size: [0.25, 0.9], col: [0.6, 0.6, 0.6, 0.18], grav: -1, drag: 1 },
  skid: { add: false, life: [0.5, 1.2], size: [0.6, 2], col: [0.85, 0.85, 0.85, 0.3], grav: -0.6, drag: 2 },
  rocket: { add: true, life: [0.1, 0.2], size: [0.8, 0.3], col: [1, 0.7, 0.2, 1], grav: 0, drag: 0 },
  money: { add: true, life: [0.5, 0.9], size: [0.4, 0.1], col: [0.4, 1, 0.4, 1], grav: -3, drag: 1 },
};

export function spawn(type, x, y, z, n = 1, spread = 1, vx = 0, vy = 0, vz = 0) {
  const T = TYPES[type];
  const sys = T.add ? addSys : alphaSys;
  for (let i = 0; i < n; i++) {
    if (sys.list.length >= MAX) sys.list.shift();
    const life = rand(T.life[0], T.life[1]);
    sys.list.push({
      x: x + rand(-0.2, 0.2) * spread, y: y + rand(-0.2, 0.2) * spread, z: z + rand(-0.2, 0.2) * spread,
      vx: vx + rand(-1, 1) * spread, vy: vy + rand(-1, 1) * spread, vz: vz + rand(-1, 1) * spread,
      life, max: life, T, s: rand(0.7, 1.3),
    });
  }
}

function updSys(sys, dt) {
  const L = sys.list;
  let w = 0;
  for (let i = 0; i < L.length; i++) {
    const p = L[i];
    p.life -= dt;
    if (p.life <= 0) continue;
    const T = p.T;
    p.vy -= T.grav * dt;
    const d = Math.max(0, 1 - T.drag * dt);
    p.vx *= d; p.vy *= d; p.vz *= d;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    const k = 1 - p.life / p.max;
    const o = w * 3, c = w * 4;
    sys.pos[o] = p.x; sys.pos[o + 1] = p.y; sys.pos[o + 2] = p.z;
    let r = T.col[0], g = T.col[1], b = T.col[2];
    if (T === TYPES.fire) { g = 0.55 - k * 0.45; b = 0.15 - k * 0.15; }
    sys.col[c] = r; sys.col[c + 1] = g; sys.col[c + 2] = b;
    sys.col[c + 3] = T.col[3] * (1 - k * k);
    sys.size[w] = (T.size[0] + (T.size[1] - T.size[0]) * k) * p.s;
    L[w++] = p;
  }
  L.length = w;
  sys.geo.setDrawRange(0, w);
  sys.geo.attributes.position.needsUpdate = true;
  sys.geo.attributes.color.needsUpdate = true;
  sys.geo.attributes.size.needsUpdate = true;
}

export function setFxScale(px) {
  addSys.pts.material.uniforms.scale.value = px;
  alphaSys.pts.material.uniforms.scale.value = px;
}

export function tracer(ax, ay, az, bx, by, bz) {
  const t = tracers.find((t) => t.life <= 0) || tracers[0];
  t.life = 0.06;
  t.a = [ax, ay, az];
  t.b = [bx, by, bz];
}

export function explosionFx(x, y, z, big = 1) {
  spawn('fire', x, y + 1, z, 50 * big, 3 * big, 0, 4, 0);
  spawn('spark', x, y + 1, z, 40 * big, 8, 0, 6, 0);
  spawn('blacksmoke', x, y + 2, z, 30 * big, 3 * big, 0, 3, 0);
  spawn('debris', x, y + 1, z, 20, 7, 0, 8, 0);
  flash.position.set(x, y + 3, z);
  flash.intensity = 400 * big;
  const d = G.camera.position.distanceTo(flash.position);
  G.shake = Math.max(G.shake, Math.max(0, 1.2 - d / 80) * big);
}

export function updateFx(dt) {
  updSys(addSys, dt);
  updSys(alphaSys, dt);
  const arr = tracerGeo.attributes.position.array;
  for (let i = 0; i < TR; i++) {
    const t = tracers[i];
    t.life -= dt;
    const o = i * 6;
    if (t.life > 0) {
      arr[o] = t.a[0]; arr[o + 1] = t.a[1]; arr[o + 2] = t.a[2];
      arr[o + 3] = t.b[0]; arr[o + 4] = t.b[1]; arr[o + 5] = t.b[2];
    } else for (let k = 0; k < 6; k++) arr[o + k] = 0;
  }
  tracerGeo.attributes.position.needsUpdate = true;
  flash.intensity = Math.max(0, flash.intensity - dt * 1500);
}
