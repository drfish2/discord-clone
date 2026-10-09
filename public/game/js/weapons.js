// Weapons, hitscan, rockets, explosions and NPC gunfire.
import * as THREE from 'three';
import { G, clamp, rand, emit, on } from './core.js';
import { raycastWorld, groundHeight } from './terrain.js';
import { spawn, tracer, explosionFx } from './fx.js';
import { sfx } from './audio.js';

export const WEAPONS = {
  fist: { name: 'Fist', dmg: 15, rate: 2.5, range: 1.9, melee: true, slot: 0 },
  pistol: { name: 'Pistol', dmg: 30, rate: 4.5, mag: 12, range: 160, spread: 0.008, slot: 1, sound: 'pistol' },
  smg: { name: 'SMG', dmg: 16, rate: 12, mag: 30, range: 120, spread: 0.028, auto: true, slot: 2, sound: 'smg' },
  shotgun: { name: 'Shotgun', dmg: 16, pellets: 8, rate: 1.1, mag: 6, range: 45, spread: 0.075, slot: 3, sound: 'shotgun' },
  rifle: { name: 'Assault Rifle', dmg: 26, rate: 9, mag: 30, range: 240, spread: 0.012, auto: true, slot: 4, sound: 'rifle' },
  rpg: { name: 'Rocket Launcher', dmg: 250, rate: 0.8, mag: 1, range: 500, projectile: true, slot: 5, sound: 'rpg' },
};
export const WEAPON_ORDER = ['fist', 'pistol', 'smg', 'shotgun', 'rifle', 'rpg'];

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3();

// Ray vs people/vehicles/world. Returns {t, ped, veh, head}
const HIT = { t: 0, ped: null, veh: null, head: false };
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return Infinity;
  return tca - Math.sqrt(r * r - d2);
}
function rayVehicle(ox, oy, oz, dx, dy, dz, v) {
  const s = v.spec;
  const c = Math.cos(-v.heading), sn = Math.sin(-v.heading);
  // into local (rotate by -heading around Y)
  const px = ox - v.pos.x, py = oy - v.pos.y, pz = oz - v.pos.z;
  const lox = px * c + pz * sn, loz = -px * sn + pz * c;
  const ldx = dx * c + dz * sn, ldz = -dx * sn + dz * c;
  const hx = v.kind === 'plane' ? s.wid * 0.25 : s.wid / 2, hz = s.len / 2;
  let t0 = -Infinity, t1 = Infinity;
  const slab = (o, d, mn, mx) => {
    if (Math.abs(d) < 1e-8) return o >= mn && o <= mx;
    let a = (mn - o) / d, b = (mx - o) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    return t0 <= t1;
  };
  if (!slab(lox, ldx, -hx, hx) || !slab(py, dy, 0, s.height) || !slab(loz, ldz, -hz, hz)) return Infinity;
  if (t1 < 0) return Infinity;
  return Math.max(t0, 0);
}

export function hitscan(ox, oy, oz, dx, dy, dz, range, shooter, shooterVeh, minT = 0) {
  let best = range, ped = null, veh = null, head = false;
  for (const p of G.peds) {
    if (p === shooter || p.vehicle) continue;
    if (Math.abs(p.pos.x - ox) > range + 2 || Math.abs(p.pos.z - oz) > range + 2) continue;
    const by = p.dead || p.ragdoll > 0 ? p.pos.y + 0.25 : p.pos.y + 1.05;
    const tb = raySphere(ox, oy, oz, dx, dy, dz, p.pos.x, by, p.pos.z, p.dead ? 0.6 : 0.42);
    const th = p.dead ? Infinity : raySphere(ox, oy, oz, dx, dy, dz, p.pos.x, p.pos.y + 1.68, p.pos.z, 0.2);
    const tl = p.dead ? Infinity : raySphere(ox, oy, oz, dx, dy, dz, p.pos.x, p.pos.y + 0.5, p.pos.z, 0.3);
    const t = Math.min(tb, th, tl);
    if (t > minT && t < best) { best = t; ped = p; veh = null; head = th <= tb && th <= tl; }
  }
  for (const v of G.vehicles) {
    if (v === shooterVeh) continue;
    if (Math.abs(v.pos.x - ox) > range + 15 || Math.abs(v.pos.z - oz) > range + 15) continue;
    const t = rayVehicle(ox, oy, oz, dx, dy, dz, v);
    if (t > minT && t < best) { best = t; veh = v; ped = null; }
  }
  const tw = raycastWorld(ox + dx * minT, oy + dy * minT, oz + dz * minT, dx, dy, dz, best - minT, 0.8);
  if (tw !== Infinity) { best = tw + minT; ped = null; veh = null; }
  HIT.t = best; HIT.ped = ped; HIT.veh = veh; HIT.head = head;
  HIT.world = tw !== Infinity;
  return HIT;
}

function applyHit(h, dmg, shooter, dx, dz, ox, oy, oz) {
  const x = ox + _d.x * h.t, y = oy + _d.y * h.t, z = oz + _d.z * h.t;
  if (h.ped) {
    const m = h.head ? 3 : 1;
    h.ped.lastAttacker = shooter;
    h.ped.hurt(dmg * m, shooter, h.ped.health - dmg * m <= 0 && dmg > 20 ? { x: dx * 4, y: 2, z: dz * 4 } : null);
  } else if (h.veh) {
    h.veh.damage(dmg * 0.5, shooter);
    spawn('spark', x, y, z, 4, 1.5);
    // shooting a driver
    if (h.veh.driver === G.player && shooter !== G.player) G.player.hurt(dmg * 0.25, shooter);
  } else if (h.world) {
    spawn('dust', x, y, z, 2, 0.3);
    spawn('spark', x, y, z, 2, 1);
  }
}

// ---------------------------------------------------------------- player weapons
export function playerShoot(player, aimOrigin, aimDir) {
  const W = WEAPONS[player.weapon];
  const ammo = player.ammo[player.weapon];
  if (W.melee) {
    player.punchT = 0.25;
    sfx('punch');
    for (const p of G.peds) {
      if (p === player || p.dead || p.vehicle) continue;
      const dx = p.pos.x - player.pos.x, dz = p.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > W.range) continue;
      const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
      if ((dx * fx + dz * fz) / d < 0.5) continue;
      p.lastAttacker = player;
      p.hurt(W.dmg, player, p.health - W.dmg <= 0 ? { x: fx * 5, y: 3, z: fz * 5 } : null);
      if (p.type === 'civ' && !p.dead) p.scare(player.pos.x, player.pos.z);
      if (p.type === 'gang') p.gang.hostile = 40;
      if (p.type === 'cop') p.provoked = true;
      emit('assault', p);
      sfx('hit');
      break;
    }
    return true;
  }
  if (player.clip[player.weapon] <= 0) {
    if (ammo > 0) player.reload();
    else sfx('empty');
    return false;
  }
  player.clip[player.weapon]--;
  player.ammo[player.weapon]--;
  const mz = player.muzzle();
  spawn('muzzle', mz.x, mz.y, mz.z, 2, 0.1);
  sfx(W.sound);
  emit('gunfire', player.pos.x, player.pos.z, player);
  G.shake = Math.max(G.shake, W.projectile ? 0.25 : 0.06);
  if (W.projectile) {
    fireRocket(mz, aimDir, player, player.vehicle);
    return true;
  }
  const pellets = W.pellets || 1;
  const spread = W.spread * (player.aiming ? 0.6 : 1) * (player.vehicle ? 1.6 : 1);
  for (let k = 0; k < pellets; k++) {
    _d.set(aimDir.x + rand(-spread, spread), aimDir.y + rand(-spread, spread), aimDir.z + rand(-spread, spread)).normalize();
    // the camera ray starts behind the player; ignore hits closer than the player
    const minT = aimOrigin.distanceTo(mz) * 0.9;
    const h = hitscan(aimOrigin.x, aimOrigin.y, aimOrigin.z, _d.x, _d.y, _d.z, W.range + minT, player, player.vehicle, minT);
    const ex = aimOrigin.x + _d.x * h.t, ey = aimOrigin.y + _d.y * h.t, ez = aimOrigin.z + _d.z * h.t;
    if (k < 3) tracer(mz.x, mz.y, mz.z, ex, ey, ez);
    applyHit(h, W.dmg, player, _d.x, _d.z, aimOrigin.x, aimOrigin.y, aimOrigin.z);
  }
  return true;
}

// ---------------------------------------------------------------- NPC gunfire
on('npcShoot', (ped, accuracy, dmg) => {
  const P = G.player;
  const tgt = P.vehicle ? P.vehicle.pos : P.pos;
  const ox = ped.pos.x, oy = ped.pos.y + (ped.heliGunner ? -1 : 1.45), oz = ped.pos.z;
  const tx = tgt.x, ty = tgt.y + 1.1, tz = tgt.z;
  const d = Math.hypot(tx - ox, ty - oy, tz - oz);
  const pspeed = P.vehicle ? P.vehicle.speedAbs : Math.hypot(P.vel.x, P.vel.z);
  const chance = clamp(accuracy * (1 - d / 90) * (1 - Math.min(pspeed, 30) / 45), 0.03, 0.9);
  const hit = Math.random() < chance;
  const miss = hit ? 0 : rand(0.8, 2.5);
  const ex = tx + rand(-1, 1) * miss, ey = ty + rand(-0.5, 1) * miss, ez = tz + rand(-1, 1) * miss;
  tracer(ox, oy, oz, ex, ey, ez);
  spawn('muzzle', ox + (tx - ox) / d * 0.6, oy, oz + (tz - oz) / d * 0.6, 1, 0.1);
  sfx(ped.weapon === 'smg' ? 'smg' : 'pistol', ped.pos);
  if (hit) {
    if (P.vehicle) {
      P.vehicle.damage(dmg * 0.6, ped);
      spawn('spark', ex, ey, ez, 3, 1);
      if (Math.random() < 0.3) P.hurt(dmg * 0.4, ped);
    } else P.hurt(dmg, ped);
  } else spawn('dust', ex, groundHeight(ex, ez), ez, 1, 0.3);
});

// ---------------------------------------------------------------- rockets
const rockets = [];
const rocketGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.8, 6).rotateX(Math.PI / 2);
const rocketMat = new THREE.MeshBasicMaterial({ color: 0x556b2f });
export function fireRocket(from, dir, owner, ownerVeh) {
  const m = new THREE.Mesh(rocketGeo, rocketMat);
  m.position.copy(from);
  G.scene.add(m);
  rockets.push({ m, pos: from.clone(), vel: dir.clone().multiplyScalar(85), owner, ownerVeh, life: 6 });
}
export function updateRockets(dt) {
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];
    r.life -= dt;
    const step = r.vel.length() * dt;
    _t.copy(r.vel).normalize();
    const h = hitscan(r.pos.x, r.pos.y, r.pos.z, _t.x, _t.y, _t.z, step + 0.5, r.owner, r.ownerVeh);
    const gh = groundHeight(r.pos.x, r.pos.z, r.pos.y);
    let boom = h.t < step + 0.5 || r.pos.y < gh || r.life <= 0;
    r.pos.addScaledVector(r.vel, dt);
    r.vel.y -= 2 * dt;
    r.m.position.copy(r.pos);
    r.m.lookAt(r.pos.x + r.vel.x, r.pos.y + r.vel.y, r.pos.z + r.vel.z);
    spawn('rocket', r.pos.x, r.pos.y, r.pos.z, 1, 0.05);
    if (Math.random() < 0.8) spawn('smoke', r.pos.x, r.pos.y, r.pos.z, 1, 0.2);
    if (boom) {
      if (h.veh) h.veh.damage(500, r.owner);
      explosionFx(r.pos.x, r.pos.y, r.pos.z, 1);
      emit('explosion', r.pos.clone(), 9, r.owner, null);
      G.scene.remove(r.m);
      rockets.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------- explosions damage
on('explosion', (pos, radius, by, srcVeh) => {
  sfx('explosion', pos);
  for (const p of G.peds) {
    if (p.vehicle) continue;
    const dx = p.pos.x - pos.x, dy = p.pos.y - pos.y, dz = p.pos.z - pos.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > radius) continue;
    const k = 1 - d / radius;
    p.lastAttacker = by;
    p.hurt(160 * k + 10, by, { x: (dx / (d + 0.1)) * 14 * k, y: 6 + 8 * k, z: (dz / (d + 0.1)) * 14 * k });
  }
  for (const v of G.vehicles) {
    if (v === srcVeh) continue;
    const d = v.pos.distanceTo(pos);
    if (d > radius + 2) continue;
    const k = 1 - d / (radius + 2);
    v.damage(160 * k, by);
    const dx = v.pos.x - pos.x, dz = v.pos.z - pos.z, l = Math.hypot(dx, dz) + 0.1;
    v.vel.x += (dx / l) * 10 * k / v.spec.mass;
    v.vel.z += (dz / l) * 10 * k / v.spec.mass;
    if (v.kind === 'car') { v.vy += 6 * k / v.spec.mass; v.onGround = false; }
  }
});
