// Low-poly procedural models: vehicles and people.
import * as THREE from 'three';
import { buildVehicleModel, buildCharacterModel } from './assets.js';

export function mergeGeos(list) {
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  const hasColor = geos.every((g) => g.attributes.color);
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = hasColor ? new Float32Array(n * 3) : null;
  let o = 0;
  for (const g of geos) {
    if (!g.attributes.normal) g.computeVertexNormals();
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (col) col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}
export function colorGeo(g, hex) {
  const c = new THREE.Color(hex);
  const ng = g.index ? g.toNonIndexed() : g;
  const n = ng.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  ng.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return ng;
}
const box = (w, h, d, x, y, z, color = 0xffffff) => colorGeo(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);
const cyl = (r1, r2, h, x, y, z, color, rx = 0, rz = 0, seg = 10) => {
  const g = new THREE.CylinderGeometry(r1, r2, h, seg);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  return colorGeo(g.translate(x, y, z), color);
};

// ---------------------------------------------------------------- materials
const matCache = new Map();
export function paintMat(hex) {
  let m = matCache.get(hex);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.35, metalness: 0.35, vertexColors: true });
    matCache.set(hex, m);
  }
  return m;
}
export const detailMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 });
export const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.9 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.3, metalness: 0.8 });
export const wreckMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 1, vertexColors: true });

const GLASS = 0x1c2733, DARK = 0x222222, CHROME = 0x9a9a9a;

// ---------------------------------------------------------------- vehicle specs
// len/wid: footprint; speed m/s; accel; grip; mass; hp
export const VSPEC = {
  sedan: { kind: 'car', len: 4.5, wid: 1.9, height: 1.5, speed: 46, accel: 13, grip: 7, mass: 1.2, hp: 100, wheelR: 0.36, name: 'Sedan' },
  sports: { kind: 'car', len: 4.4, wid: 1.95, height: 1.2, speed: 68, accel: 20, grip: 8.5, mass: 1.1, hp: 90, wheelR: 0.36, name: 'Sports Car' },
  suv: { kind: 'car', len: 4.9, wid: 2.05, height: 1.95, speed: 44, accel: 12, grip: 6.5, mass: 1.6, hp: 140, wheelR: 0.42, name: 'SUV' },
  taxi: { kind: 'car', len: 4.5, wid: 1.9, height: 1.5, speed: 44, accel: 12, grip: 7, mass: 1.2, hp: 100, wheelR: 0.36, name: 'Taxi' },
  police: { kind: 'car', len: 4.7, wid: 1.95, height: 1.5, speed: 58, accel: 17, grip: 8, mass: 1.4, hp: 160, wheelR: 0.37, name: 'Police Cruiser' },
  truck: { kind: 'car', len: 7.2, wid: 2.5, height: 3.2, speed: 32, accel: 8, grip: 6, mass: 3.5, hp: 250, wheelR: 0.5, name: 'Box Truck' },
  bus: { kind: 'car', len: 11, wid: 2.6, height: 3.2, speed: 28, accel: 6, grip: 6, mass: 5, hp: 300, wheelR: 0.55, name: 'City Bus' },
  pickup: { kind: 'car', len: 5.2, wid: 2.0, height: 1.8, speed: 42, accel: 12, grip: 6, mass: 1.6, hp: 130, wheelR: 0.42, name: 'Pickup' },
  bike: { kind: 'bike', len: 2.1, wid: 0.7, height: 1.1, speed: 62, accel: 22, grip: 9, mass: 0.4, hp: 60, wheelR: 0.33, name: 'Motorbike' },
  heli: { kind: 'heli', len: 11, wid: 2.4, height: 3.2, speed: 62, accel: 18, grip: 0, mass: 2, hp: 180, name: 'Helicopter' },
  policeHeli: { kind: 'heli', len: 11, wid: 2.4, height: 3.2, speed: 62, accel: 18, grip: 0, mass: 2, hp: 220, name: 'Police Chopper' },
  plane: { kind: 'plane', len: 9, wid: 11, height: 3, speed: 85, accel: 14, grip: 0, mass: 1.5, hp: 120, name: 'Stunt Plane' },
  jet: { kind: 'plane', len: 16, wid: 14, height: 4.5, speed: 150, accel: 22, grip: 0, mass: 4, hp: 200, name: 'Jet' },
  boat: { kind: 'boat', len: 5.5, wid: 2.2, height: 1.4, speed: 40, accel: 12, grip: 2.5, mass: 1, hp: 120, name: 'Speedboat' },
  // extra types that only exist as downloaded models (fall back to the sedan/truck shapes)
  luxury: { kind: 'car', len: 4.9, wid: 2.05, height: 1.9, speed: 52, accel: 15, grip: 7.5, mass: 1.6, hp: 140, wheelR: 0.42, name: 'Luxury SUV', fallback: 'suv' },
  hatchback: { kind: 'car', len: 4.1, wid: 1.85, height: 1.5, speed: 44, accel: 13, grip: 7.5, mass: 1.0, hp: 90, wheelR: 0.34, name: 'Hatchback', fallback: 'sedan' },
  van: { kind: 'car', len: 5.0, wid: 2.1, height: 2.1, speed: 38, accel: 10, grip: 6.5, mass: 2, hp: 150, wheelR: 0.4, name: 'Van', fallback: 'pickup' },
  firetruck: { kind: 'car', len: 8.0, wid: 2.6, height: 3.2, speed: 34, accel: 8, grip: 6, mass: 4, hp: 300, wheelR: 0.55, name: 'Fire Truck', fallback: 'truck' },
  garbage: { kind: 'car', len: 7.5, wid: 2.6, height: 3.2, speed: 28, accel: 7, grip: 6, mass: 4, hp: 280, wheelR: 0.55, name: 'Garbage Truck', fallback: 'truck' },
  ambulance: { kind: 'car', len: 6.0, wid: 2.3, height: 2.6, speed: 44, accel: 12, grip: 6.5, mass: 2.2, hp: 180, wheelR: 0.45, name: 'Ambulance', fallback: 'truck' },
  racecar: { kind: 'car', len: 4.6, wid: 2.0, height: 1.0, speed: 82, accel: 26, grip: 10, mass: 0.8, hp: 70, wheelR: 0.38, name: 'Race Car', fallback: 'sports' },
  tractor: { kind: 'car', len: 4.0, wid: 2.2, height: 2.6, speed: 18, accel: 7, grip: 7, mass: 2.5, hp: 150, wheelR: 0.6, name: 'Tractor', fallback: 'pickup' },
  bicycle: { kind: 'bike', len: 1.9, wid: 0.6, height: 1.1, speed: 14, accel: 6, grip: 9, mass: 0.15, hp: 40, wheelR: 0.35, name: 'Bicycle', fallback: 'bike' },
};

const geoCache = new Map();

function carGeo(type) {
  const s = VSPEC[type];
  const L = s.len, W = s.wid;
  const body = [], det = [], lights = [];
  let wheels = [];
  const zf = L / 2, zb = -L / 2;
  if (type === 'truck') {
    body.push(box(W, 1.3, 2.0, 0, 1.25, zf - 1.0)); // cab
    det.push(box(W - 0.1, 0.7, 0.05, 0, 1.6, zf + 0.01, GLASS));
    det.push(box(W + 0.02, 0.5, 1.0, 0, 1.6, zf - 0.9, GLASS));
    det.push(box(W + 0.1, 2.5, L - 2.3, 0, 1.95, zb + (L - 2.3) / 2, 0xeeeeee)); // cargo box
    det.push(box(W * 0.9, 0.35, L - 0.2, 0, 0.6, 0, DARK)); // chassis
    lights.push(box(0.4, 0.2, 0.05, -W / 2 + 0.3, 0.9, zf + 0.02, 0xfff6d0), box(0.4, 0.2, 0.05, W / 2 - 0.3, 0.9, zf + 0.02, 0xfff6d0));
    lights.push(box(0.3, 0.2, 0.05, -W / 2 + 0.2, 0.9, zb - 0.02, 0xff2020), box(0.3, 0.2, 0.05, W / 2 - 0.2, 0.9, zb - 0.02, 0xff2020));
    wheels = [[-W / 2 + 0.2, zf - 1.2], [W / 2 - 0.2, zf - 1.2], [-W / 2 + 0.2, zb + 1.4], [W / 2 - 0.2, zb + 1.4]];
  } else if (type === 'bus') {
    body.push(box(W, 2.6, L, 0, 1.75, 0));
    det.push(box(W + 0.02, 0.9, L - 1.5, 0, 2.15, -0.4, GLASS));
    det.push(box(W - 0.2, 1.2, 0.05, 0, 2.1, zf + 0.01, GLASS));
    det.push(box(W + 0.03, 0.3, L + 0.03, 0, 0.55, 0, DARK));
    lights.push(box(0.4, 0.2, 0.05, -W / 2 + 0.35, 0.95, zf + 0.02, 0xfff6d0), box(0.4, 0.2, 0.05, W / 2 - 0.35, 0.95, zf + 0.02, 0xfff6d0));
    lights.push(box(0.3, 0.3, 0.05, -W / 2 + 0.2, 1.0, zb - 0.02, 0xff2020), box(0.3, 0.3, 0.05, W / 2 - 0.2, 1.0, zb - 0.02, 0xff2020));
    wheels = [[-W / 2 + 0.25, zf - 2.0], [W / 2 - 0.25, zf - 2.0], [-W / 2 + 0.25, zb + 2.2], [W / 2 - 0.25, zb + 2.2]];
  } else if (type === 'bike') {
    det.push(box(0.25, 0.3, 1.3, 0, 0.6, 0, DARK));
    body.push(box(0.4, 0.3, 0.6, 0, 0.85, 0.25)); // tank
    body.push(box(0.35, 0.18, 0.7, 0, 0.82, -0.4)); // seat cowl
    det.push(box(0.3, 0.1, 0.6, 0, 0.93, -0.35, 0x111111)); // seat
    det.push(box(0.7, 0.05, 0.05, 0, 1.05, 0.65, CHROME)); // bars
    det.push(cyl(0.03, 0.03, 0.7, 0, 0.7, 0.75, CHROME, 0.4, 0, 6));
    body.push(box(0.36, 0.35, 0.2, 0, 0.95, 0.85)); // fairing
    lights.push(box(0.18, 0.12, 0.04, 0, 0.98, 0.96, 0xfff6d0));
    lights.push(box(0.14, 0.08, 0.04, 0, 0.9, -0.8, 0xff2020));
    wheels = [[0, 0.8], [0, -0.75]];
  } else {
    // passenger cars
    let bodyH = 0.65, bodyY = 0.35, cabH = 0.6, cabF = 0.75, cabB = -1.1, cabW = W - 0.2;
    if (type === 'sports') { bodyH = 0.5; bodyY = 0.28; cabH = 0.45; cabF = 0.4; cabB = -1.0; }
    if (type === 'suv') { bodyH = 0.8; bodyY = 0.45; cabH = 0.7; cabF = 0.9; cabB = -2.2; }
    if (type === 'pickup') { bodyH = 0.75; bodyY = 0.45; cabH = 0.65; cabF = 0.9; cabB = -0.6; }
    const top = bodyY + bodyH;
    body.push(box(W, bodyH, L, 0, bodyY + bodyH / 2, 0));
    // cabin glass and pillars
    const cl = cabF - cabB;
    det.push(box(cabW, cabH, cl, 0, top + cabH / 2, (cabF + cabB) / 2, GLASS));
    body.push(box(cabW + 0.02, 0.08, cl - 0.25, 0, top + cabH + 0.02, (cabF + cabB) / 2 - 0.05)); // roof
    for (const sx of [-1, 1]) {
      body.push(box(0.08, cabH, 0.1, sx * (cabW / 2), top + cabH / 2, cabF - 0.05));
      body.push(box(0.08, cabH, 0.12, sx * (cabW / 2), top + cabH / 2, cabB + 0.06));
    }
    if (type === 'pickup') {
      det.push(box(W - 0.1, 0.05, -cabB + zb + 0.0 + L / 2 - 0.4, 0, top - 0.02, (cabB + zb) / 2, 0x333333));
    }
    det.push(box(W + 0.04, 0.22, 0.2, 0, bodyY + 0.08, zf + 0.0, DARK)); // bumpers
    det.push(box(W + 0.04, 0.22, 0.2, 0, bodyY + 0.08, zb, DARK));
    det.push(box(W * 0.45, 0.16, 0.05, 0, bodyY + bodyH * 0.55, zf + 0.01, 0x1a1a1a)); // grille
    det.push(box(0.5, 0.12, 0.03, 0, bodyY + bodyH * 0.45, zb - 0.01, 0xf2f2f2)); // plate
    lights.push(box(0.36, 0.14, 0.05, -W / 2 + 0.3, bodyY + bodyH * 0.65, zf + 0.02, 0xfff8dc), box(0.36, 0.14, 0.05, W / 2 - 0.3, bodyY + bodyH * 0.65, zf + 0.02, 0xfff8dc));
    lights.push(box(0.42, 0.13, 0.05, -W / 2 + 0.3, bodyY + bodyH * 0.7, zb - 0.02, 0xff1a1a), box(0.42, 0.13, 0.05, W / 2 - 0.3, bodyY + bodyH * 0.7, zb - 0.02, 0xff1a1a));
    if (type === 'sports') body.push(box(W - 0.2, 0.06, 0.35, 0, top + 0.28, zb + 0.2), box(0.06, 0.25, 0.1, -0.6, top + 0.13, zb + 0.2), box(0.06, 0.25, 0.1, 0.6, top + 0.13, zb + 0.2));
    if (type === 'taxi') det.push(box(0.7, 0.22, 0.3, 0, top + cabH + 0.17, (cabF + cabB) / 2, 0xffe680));
    if (type === 'police') {
      det.push(box(0.04, bodyH * 0.6, L * 0.5, -W / 2 - 0.01, bodyY + bodyH / 2, 0.1, 0xf5f5f5), box(0.04, bodyH * 0.6, L * 0.5, W / 2 + 0.01, bodyY + bodyH / 2, 0.1, 0xf5f5f5));
      det.push(box(1.2, 0.1, 0.3, 0, top + cabH + 0.08, (cabF + cabB) / 2, 0x333333));
    }
    const wz = L / 2 - 0.85;
    wheels = [[-W / 2 + 0.12, wz], [W / 2 - 0.12, wz], [-W / 2 + 0.12, -wz + 0.05], [W / 2 - 0.12, -wz + 0.05]];
    s.seatY = top - 0.3;
  }
  return {
    body: mergeGeos(body),
    det: det.length ? mergeGeos(det) : null,
    lights: lights.length ? mergeGeos(lights) : null,
    wheels,
  };
}

function heliGeo() {
  const body = [], det = [], lights = [];
  body.push(box(2.2, 2.0, 4.2, 0, 1.6, 0.6));
  body.push(box(1.6, 1.4, 1.2, 0, 1.4, 3.1));
  det.push(box(1.9, 1.0, 1.2, 0, 2.0, 2.6, GLASS));
  det.push(box(2.24, 0.8, 1.6, 0, 2.0, 1.2, GLASS));
  body.push(box(0.5, 0.6, 5.2, 0, 2.1, -3.8)); // boom
  body.push(box(0.12, 1.6, 1.0, 0, 2.7, -6.2)); // fin
  body.push(box(2.0, 0.08, 0.6, 0, 2.3, -5.8));
  det.push(box(0.8, 0.5, 1.6, 0, 2.85, 0.2, 0x333333)); // engine
  for (const sx of [-1, 1]) {
    det.push(box(0.1, 0.1, 4.2, sx * 1.15, 0.1, 0.6, DARK));
    det.push(box(0.08, 0.6, 0.08, sx * 1.1, 0.4, 1.8, DARK), box(0.08, 0.6, 0.08, sx * 1.1, 0.4, -0.6, DARK));
  }
  lights.push(box(0.15, 0.15, 0.15, -1.1, 1.5, 0.6, 0xff2020), box(0.15, 0.15, 0.15, 1.1, 1.5, 0.6, 0x20ff40), box(0.15, 0.15, 0.15, 0, 2.6, -6.7, 0xffffff));
  const rotor = mergeGeos([box(11, 0.06, 0.35, 0, 0, 0, 0x2a2a2a), box(0.35, 0.06, 11, 0, 0, 0, 0x2a2a2a), cyl(0.2, 0.2, 0.5, 0, -0.2, 0, 0x444444)]);
  const tail = mergeGeos([box(0.05, 1.8, 0.2, 0, 0, 0, 0x2a2a2a), box(0.05, 0.2, 1.8, 0, 0, 0, 0x2a2a2a)]);
  return { body: mergeGeos(body), det: mergeGeos(det), lights: mergeGeos(lights), rotor, tail, wheels: [] };
}

function planeGeo(type) {
  const body = [], det = [], lights = [];
  if (type === 'jet') {
    body.push(cyl(1.0, 0.7, 14, 0, 2.2, 0, 0xffffff, Math.PI / 2, 0, 12));
    body.push(cyl(0.01, 1.0, 2.5, 0, 2.2, 8.2, 0xffffff, Math.PI / 2, 0, 12));
    det.push(box(1.0, 0.6, 2.2, 0, 3.0, 4.8, GLASS));
    body.push(box(14, 0.25, 3.2, 0, 1.9, 0.0));
    body.push(box(5.5, 0.18, 1.6, 0, 2.4, -6.2));
    body.push(box(0.2, 3.0, 2.0, 0, 3.8, -6.0));
    det.push(cyl(0.55, 0.55, 3, -2.6, 1.3, 0.4, 0x666666, Math.PI / 2), cyl(0.55, 0.55, 3, 2.6, 1.3, 0.4, 0x666666, Math.PI / 2));
    det.push(box(0.15, 1.5, 0.15, 0, 0.75, 4.5, DARK), box(0.15, 1.5, 0.15, -1.6, 0.75, -0.6, DARK), box(0.15, 1.5, 0.15, 1.6, 0.75, -0.6, DARK));
    lights.push(box(0.2, 0.2, 0.2, -7, 1.9, 0, 0xff2020), box(0.2, 0.2, 0.2, 7, 1.9, 0, 0x20ff40));
    return { body: mergeGeos(body), det: mergeGeos(det), lights: mergeGeos(lights), prop: null, wheels: [] };
  }
  body.push(box(1.1, 1.2, 7.0, 0, 1.6, 0.2));
  body.push(box(0.9, 1.0, 1.2, 0, 1.55, 4.2));
  det.push(box(0.95, 0.55, 1.3, 0, 2.4, 1.6, GLASS));
  body.push(box(11, 0.15, 1.7, 0, 2.15, 1.3)); // top wing
  body.push(box(9, 0.12, 1.5, 0, 1.15, 1.4)); // lower wing (biplane)
  for (const sx of [-1, 1]) det.push(box(0.06, 1.0, 0.06, sx * 3.5, 1.65, 1.3, 0xdddddd));
  body.push(box(3.6, 0.1, 1.0, 0, 1.75, -3.0));
  body.push(box(0.1, 1.3, 1.0, 0, 2.4, -3.1));
  det.push(box(0.08, 0.9, 0.08, -0.7, 0.6, 2.2, DARK), box(0.08, 0.9, 0.08, 0.7, 0.6, 2.2, DARK));
  det.push(cyl(0.3, 0.3, 0.15, -0.8, 0.3, 2.2, 0x111111, 0, Math.PI / 2), cyl(0.3, 0.3, 0.15, 0.8, 0.3, 2.2, 0x111111, 0, Math.PI / 2));
  det.push(box(0.1, 0.5, 0.1, 0, 0.9, -3.2, DARK));
  lights.push(box(0.15, 0.1, 0.15, -5.5, 2.15, 1.3, 0xff2020), box(0.15, 0.1, 0.15, 5.5, 2.15, 1.3, 0x20ff40));
  const prop = mergeGeos([box(0.1, 2.4, 0.08, 0, 0, 0, 0x222222), cyl(0.18, 0.05, 0.4, 0, 0, 0.1, 0x888888, Math.PI / 2)]);
  return { body: mergeGeos(body), det: mergeGeos(det), lights: mergeGeos(lights), prop, wheels: [] };
}

function boatGeo() {
  const body = [], det = [], lights = [];
  body.push(box(2.2, 0.9, 4.0, 0, 0.45, -0.5));
  // bow wedge
  const bow = new THREE.CylinderGeometry(0.0, 1.1, 1.8, 4, 1);
  bow.rotateX(Math.PI / 2);
  bow.rotateZ(Math.PI / 4);
  bow.scale(1.4, 0.6, 1);
  bow.translate(0, 0.5, 2.3);
  body.push(colorGeo(bow, 0xffffff));
  det.push(box(2.0, 0.08, 3.6, 0, 0.92, -0.6, 0x8b6a45));
  det.push(box(1.8, 0.5, 0.08, 0, 1.2, 0.9, GLASS));
  det.push(box(0.6, 0.6, 0.6, 0, 1.2, -1.2, 0x333333));
  lights.push(box(0.15, 0.15, 0.15, 0, 1.0, 3.0, 0xffffff));
  return { body: mergeGeos(body), det: mergeGeos(det), lights: mergeGeos(lights), wheels: [] };
}

export function vehicleGeo(type) {
  if (VSPEC[type].fallback) type = VSPEC[type].fallback;
  let g = geoCache.get(type);
  if (g) return g;
  const s = VSPEC[type];
  if (s.kind === 'heli') g = heliGeo();
  else if (s.kind === 'plane') g = planeGeo(type);
  else if (s.kind === 'boat') g = boatGeo();
  else g = carGeo(type);
  geoCache.set(type, g);
  return g;
}

const wheelGeoCache = new Map();
function wheelGeo(r, w) {
  const k = r + ':' + w;
  let g = wheelGeoCache.get(k);
  if (!g) {
    g = new THREE.CylinderGeometry(r, r, w, 12);
    g.rotateZ(Math.PI / 2);
    wheelGeoCache.set(k, g);
  }
  return g;
}
const rimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.27, 8).rotateZ(Math.PI / 2);

// Build a vehicle Object3D. Returns {root, wheels[], rotor, tail, prop, bodyMesh, siren[]}
// Realistic-model variant from the colour, so every client (net.js ghosts) picks the same body.
function variantFor(color) {
  let h = (color >>> 0) || 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}
export function buildVehicleMesh(type, color) {
  const s = VSPEC[type];
  // Kenney liveries are painted into the texture; the realistic police/taxi body is repainted instead
  const keepLivery = type === 'police' || type === 'taxi' || type === 'firetruck' || type === 'ambulance' || type === 'garbage';
  const model = buildVehicleModel(type, s, color, { variant: variantFor(color), keepLivery });
  if (model) {
    model.siren = [];
    if (type === 'police' || type === 'policeHeli') {
      const red = new THREE.MeshBasicMaterial({ color: 0xff1010 });
      const blue = new THREE.MeshBasicMaterial({ color: 0x1040ff });
      const y = type === 'police' ? model.size.y + 0.02 : 0.3;
      const z = type === 'police' ? model.size.z * 0.05 : 0.6;
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.14, 0.25), red);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.14, 0.25), blue);
      a.position.set(-0.28, y, z);
      b.position.set(0.28, y, z);
      model.root.add(a, b);
      model.siren = [a, b];
    }
    // the realistic taxi is a repainted car: give it the roof sign the Kenney taxi has
    if (type === 'taxi' && model.real) {
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.26), new THREE.MeshBasicMaterial({ color: 0xfff1a8 }));
      sign.position.set(0, model.size.y + 0.08, model.size.z * 0.02);
      sign.castShadow = true;
      model.root.add(sign);
      model.meshes.push(sign);
    }
    return model;
  }
  const g = vehicleGeo(type);
  const root = new THREE.Group();
  const bodyMesh = new THREE.Mesh(g.body, paintMat(color));
  bodyMesh.castShadow = true;
  root.add(bodyMesh);
  let detMesh = null;
  if (g.det) {
    detMesh = new THREE.Mesh(g.det, detailMat);
    detMesh.castShadow = true;
    root.add(detMesh);
  }
  if (g.lights) root.add(new THREE.Mesh(g.lights, lightMat));
  const out = { root, wheels: [], bodyMesh, detMesh, siren: [] };
  for (const [x, z] of g.wheels) {
    const r = s.wheelR;
    const w = new THREE.Group();
    w.position.set(x, r, z);
    const tire = new THREE.Mesh(wheelGeo(r, s.kind === 'bike' ? 0.16 : 0.28), wheelMat);
    tire.castShadow = true;
    w.add(tire);
    if (s.kind !== 'bike') {
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.scale.setScalar(r / 0.36);
      w.add(rim);
    }
    root.add(w);
    out.wheels.push(w);
  }
  if (g.rotor) {
    out.rotor = new THREE.Mesh(g.rotor, detailMat);
    out.rotor.position.set(0, 3.25, 0.4);
    root.add(out.rotor);
    out.tail = new THREE.Mesh(g.tail, detailMat);
    out.tail.position.set(0.3, 2.6, -6.3);
    root.add(out.tail);
  }
  if (g.prop) {
    out.prop = new THREE.Mesh(g.prop, detailMat);
    out.prop.position.set(0, 1.55, 4.85);
    root.add(out.prop);
  }
  if (type === 'police' || type === 'policeHeli') {
    const red = new THREE.MeshBasicMaterial({ color: 0xff1010 });
    const blue = new THREE.MeshBasicMaterial({ color: 0x1040ff });
    const y = type === 'police' ? 1.68 + 0.08 + 0.12 : 0.15;
    const z = type === 'police' ? -0.2 : 1.2;
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.26), red);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.26), blue);
    a.position.set(-0.3, y, z);
    b.position.set(0.3, y, z);
    root.add(a, b);
    out.siren = [a, b];
  }
  return out;
}

// ---------------------------------------------------------------- people
const hm = new Map();
function humanMat(hex) {
  let m = hm.get(hex);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: hex });
    hm.set(hex, m);
  }
  return m;
}
const HG = {
  leg: new THREE.BoxGeometry(0.2, 0.86, 0.22).translate(0, -0.43, 0),
  torso: new THREE.BoxGeometry(0.52, 0.66, 0.28).translate(0, 0.33, 0),
  arm: new THREE.BoxGeometry(0.15, 0.64, 0.16).translate(0, -0.3, 0),
  head: new THREE.BoxGeometry(0.3, 0.32, 0.3).translate(0, 0.16, 0),
  hair: new THREE.BoxGeometry(0.32, 0.12, 0.32).translate(0, 0.32, -0.01),
  cap: mergeGeos([new THREE.BoxGeometry(0.33, 0.12, 0.33).translate(0, 0.34, 0), new THREE.BoxGeometry(0.3, 0.04, 0.16).translate(0, 0.3, 0.2)]),
  gun: new THREE.BoxGeometry(0.07, 0.12, 0.38).translate(0, -0.6, 0.12),
};
export const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x5c3a21];
export const SHIRTS = [0xd32f2f, 0x1976d2, 0x388e3c, 0xfbc02d, 0xffffff, 0x212121, 0x8e24aa, 0xf57c00, 0x00897b, 0x90a4ae, 0xe91e63];
export const PANTS = [0x283593, 0x212121, 0x5d4037, 0x616161, 0x1565c0, 0x8d6e63, 0x37474f];
export const HAIRS = [0x1b1b1b, 0x3e2723, 0x6d4c41, 0xd7b46a, 0x9e9e9e, 0xb71c1c];

export function buildHuman(look, kind = 'civ') {
  const rig = buildCharacterModel(kind, look.variant || 0, look.tint);
  if (rig) return rig;
  return buildProceduralHuman(look);
}

function buildProceduralHuman({ skin, shirt, pants, hair, cap = false }) {
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.9;
  root.add(hips);
  const mk = (geo, hex) => {
    const m = new THREE.Mesh(geo, humanMat(hex));
    m.castShadow = true;
    return m;
  };
  const legL = mk(HG.leg, pants), legR = mk(HG.leg, pants);
  legL.position.set(-0.13, 0, 0);
  legR.position.set(0.13, 0, 0);
  const torso = mk(HG.torso, shirt);
  const armL = mk(HG.arm, shirt), armR = mk(HG.arm, shirt);
  armL.position.set(-0.34, 0.62, 0);
  armR.position.set(0.34, 0.62, 0);
  const head = mk(HG.head, skin);
  head.position.y = 0.68;
  const h2 = mk(cap ? HG.cap : HG.hair, hair);
  head.add(h2);
  const gun = new THREE.Mesh(HG.gun, humanMat(0x1a1a1a));
  gun.visible = false;
  armR.add(gun);
  hips.add(legL, legR, torso);
  torso.add(armL, armR, head);
  const parts = { root, hips, legL, legR, torso, armL, armR, head, gun };
  return {
    root,
    gun,
    skinned: false,
    setGun(v) {
      gun.visible = v;
    },
    pose(p) {
      legL.rotation.set(p.legL, 0, p.sit ? 0.25 : 0);
      legR.rotation.set(p.legR, 0, p.sit ? -0.25 : 0);
      hips.rotation.x = p.lean || 0;
      if (p.aim) {
        armR.rotation.set(-Math.PI / 2 + (p.aimPitch || 0), 0, 0);
        armL.rotation.set(-Math.PI / 2 + (p.aimPitch || 0) + 0.1, 0, -0.4);
      } else if (p.lift) {
        armL.rotation.set(-2.6 + p.armL * 0.3, 0, -0.2);
        armR.rotation.set(-2.6 + p.armR * 0.3, 0, 0.2);
      } else if (p.punch) {
        armR.rotation.set(-Math.PI / 2, 0, 0);
        armL.rotation.set(-p.armL, 0, 0.05);
      } else {
        armL.rotation.set(-p.armL, 0, 0.05);
        armR.rotation.set(-p.armR, 0, -0.05);
      }
    },
    parts,
  };
}
