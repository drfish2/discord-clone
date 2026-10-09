// Third-person chase camera with mouse orbit, auto-follow and collision.
import * as THREE from 'three';
import { G, clamp, damp, angWrap } from './core.js';
import { terrainHeight, raycastWorld } from './terrain.js';

const target = new THREE.Vector3();
const desired = new THREE.Vector3();
const cur = new THREE.Vector3();
const _f = new THREE.Vector3();
const _u = new THREE.Vector3();
let idleT = 0;
let zoomLevel = 1;
let inited = false;
let lastVeh = null;

export function cycleZoom() {
  zoomLevel = (zoomLevel + 1) % 3;
}

export function updateCamera(dt) {
  const P = G.player;
  const cam = G.camera;
  const M = G.mouse;
  const sens = 0.0024;
  if (M.dx || M.dy) idleT = 0;
  else idleT += dt;
  G.camYaw -= M.dx * sens;
  G.camPitch = clamp(G.camPitch + M.dy * sens, -0.5, 1.25);
  M.dx = M.dy = 0;
  const v = P.vehicle;
  if (v !== lastVeh) { lastVeh = v; idleT = 2; }
  let dist, height, fov = 62;
  const zoomK = [0.75, 1, 1.45][zoomLevel];
  if (v) {
    const s = v.spec;
    const sz = Math.max(s.len, s.wid * (v.kind === 'plane' ? 0.7 : 1));
    dist = (sz * 1.2 + 4.5) * zoomK;
    height = s.height * 0.8 + 0.6;
    target.set(v.pos.x, v.pos.y + height, v.pos.z);
    const sp = v.speedAbs;
    fov = 62 + clamp(sp / 60, 0, 1) * 14;
    // auto-follow behind the vehicle when the mouse is idle
    if (idleT > 1.2 && (sp > 3 || v.kind === 'plane')) {
      let h = v.heading;
      if (v.kind !== 'plane' && v.kind !== 'heli' && v.fwdSpeed < -2) h = v.heading; // keep behind even reversing
      G.camYaw += angWrap(h - G.camYaw) * clamp(dt * 3, 0, 1);
      const pitchT = v.kind === 'plane' ? 0.12 - Math.asin(clamp(_f.copy(new THREE.Vector3(0, 0, 1)).applyQuaternion(v.q).y, -1, 1)) * 0.8 : v.kind === 'heli' ? 0.32 : 0.2;
      G.camPitch = damp(G.camPitch, pitchT, 2, dt);
    }
  } else {
    dist = (P.aiming ? 2.6 : 4.6) * zoomK;
    target.set(P.pos.x, P.pos.y + (P.swim ? 0.4 : 1.6), P.pos.z);
    // shoulder offset
    const rx = -Math.cos(G.camYaw), rz = Math.sin(G.camYaw);
    const sh = P.aiming ? 0.75 : 0.45;
    target.x += rx * sh;
    target.z += rz * sh;
    if (P.aiming) fov = 52;
  }
  const cp = Math.cos(G.camPitch), spch = Math.sin(G.camPitch);
  desired.set(target.x - Math.sin(G.camYaw) * cp * dist, target.y + spch * dist, target.z - Math.cos(G.camYaw) * cp * dist);
  // collide with buildings
  const dx = desired.x - target.x, dy = desired.y - target.y, dz = desired.z - target.z;
  const dl = Math.hypot(dx, dy, dz);
  const hit = raycastWorld(target.x, target.y, target.z, dx / dl, dy / dl, dz / dl, dl, 0.4);
  if (hit < dl) desired.set(target.x + (dx / dl) * Math.max(0.6, hit - 0.4), target.y + (dy / dl) * Math.max(0.6, hit - 0.4), target.z + (dz / dl) * Math.max(0.6, hit - 0.4));
  const gh = terrainHeight(desired.x, desired.z) + 0.5;
  if (desired.y < gh) desired.y = gh;
  if (!inited || cur.distanceTo(desired) > 60) { cur.copy(desired); inited = true; }
  const k = v ? 14 : 22;
  cur.x = damp(cur.x, desired.x, k, dt);
  cur.y = damp(cur.y, desired.y, k, dt);
  cur.z = damp(cur.z, desired.z, k, dt);
  if (v && v.speedAbs > 30) cur.copy(desired);
  cam.position.copy(cur);
  if (G.shake > 0) {
    cam.position.x += (Math.random() - 0.5) * G.shake;
    cam.position.y += (Math.random() - 0.5) * G.shake;
    cam.position.z += (Math.random() - 0.5) * G.shake;
    G.shake = Math.max(0, G.shake - dt * 1.8);
  }
  if (v) cam.lookAt(target.x, target.y, target.z);
  else {
    // on foot: look nearly level over the shoulder so the crosshair marks where bullets go
    const lp = G.camPitch * 0.45;
    cam.lookAt(cam.position.x + Math.sin(G.camYaw) * Math.cos(lp) * 50, cam.position.y - Math.sin(lp) * 50, cam.position.z + Math.cos(G.camYaw) * Math.cos(lp) * 50);
  }
  if (v && v.kind === 'plane') {
    // gentle roll with the plane
    _u.set(0, 1, 0).applyQuaternion(v.q);
    cam.up.set(0, 1, 0);
  }
  if (Math.abs(cam.fov - fov) > 0.1) {
    cam.fov = damp(cam.fov, fov, 4, dt);
    cam.updateProjectionMatrix();
  }
}

export function snapCamera() {
  inited = false;
}
