// People: pedestrians, gang members and police officers on foot.
import * as THREE from 'three';
import { G, GRAV, WATER, clamp, damp, rand, pick, angWrap, emit, on } from './core.js';
import {
  groundHeight, collideCircle, isWater, blockType, cornerPos, walkableBlock, CL, GANGS, TOWNS, terrainHeight, losClear,
} from './terrain.js';
import { buildHuman, SKINS, SHIRTS, PANTS, HAIRS } from './models.js';
import { spawn } from './fx.js';

export function randomLook() {
  return { skin: pick(SKINS), shirt: pick(SHIRTS), pants: pick(PANTS), hair: pick(HAIRS) };
}
export const COP_LOOK = { skin: 0xe0ac69, shirt: 0x1f3a68, pants: 0x14213d, hair: 0x0d1b33, cap: true };
export function gangLook(g) {
  return { skin: pick(SKINS), shirt: g.color, pants: pick([0x212121, 0x37474f, 0x1565c0]), hair: g.color, cap: Math.random() < 0.5 };
}

const _c = { x: 0, z: 0 };

export class Ped {
  constructor(x, z, type = 'civ', look = randomLook()) {
    this.type = type;
    this.look = look;
    this.m = buildHuman(look);
    this.root = this.m.root;
    this.pos = new THREE.Vector3(x, groundHeight(x, z) + 0.02, z);
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.heading = rand(-Math.PI, Math.PI);
    this.health = type === 'cop' ? 120 : 100;
    this.dead = false;
    this.deadT = 0;
    this.state = 'walk';
    this.stateT = 0;
    this.speed = 0;
    this.phase = Math.random() * 10;
    this.weapon = null;
    this.fireCd = rand(0.5, 1.5);
    this.ragdoll = 0;
    this.spinX = 0;
    this.onGround = true;
    this.vehicle = null;
    this.corner = null;
    this.target = null;
    this.aim = false;
    this.swim = false;
    this.persist = false;
    this.gang = null;
    G.scene.add(this.root);
    G.peds.push(this);
  }

  remove() {
    G.scene.remove(this.root);
    const i = G.peds.indexOf(this);
    if (i >= 0) G.peds.splice(i, 1);
    this.removed = true;
  }

  hurt(amount, attacker = null, force = null) {
    if (this.dead) return;
    this.health -= amount;
    spawn('blood', this.pos.x, this.pos.y + 1.2, this.pos.z, 6, 0.6, 0, 2, 0);
    if (force) {
      this.vel.set(force.x, 0, force.z);
      this.vy = force.y;
      this.ragdoll = 1.6;
      this.onGround = false;
      this.spinX = rand(4, 9) * (Math.random() < 0.5 ? -1 : 1);
    }
    emit('pedHurt', this, attacker, amount);
    if (this.health <= 0) this.die(attacker);
  }

  die(attacker) {
    if (this.dead) return;
    this.dead = true;
    this.health = 0;
    this.deadT = 0;
    this.m.gun.visible = false;
    emit('pedKilled', this, attacker);
  }

  setWeaponVisible(v) {
    this.m.gun.visible = v;
  }

  // movement toward a direction with speed; handles collisions & ground
  move(dt, dirX, dirZ, speed) {
    const len = Math.hypot(dirX, dirZ);
    if (len > 0.001) {
      dirX /= len; dirZ /= len;
      this.heading = angWrap(this.heading + angWrap(Math.atan2(dirX, dirZ) - this.heading) * clamp(dt * 10, 0, 1));
      this.vel.x = damp(this.vel.x, dirX * speed, 10, dt);
      this.vel.z = damp(this.vel.z, dirZ * speed, 10, dt);
    } else {
      this.vel.x = damp(this.vel.x, 0, 10, dt);
      this.vel.z = damp(this.vel.z, 0, 10, dt);
    }
    this.physics(dt);
  }

  physics(dt) {
    const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    const gNew = groundHeight(nx, nz, this.pos.y + 0.6);
    if (this.onGround && gNew > this.pos.y + 0.65) {
      // too high to step, slide
      this.vel.x *= 0.2; this.vel.z *= 0.2;
    } else {
      this.pos.x = nx;
      this.pos.z = nz;
    }
    const c = collideCircle(this.pos.x, this.pos.z, 0.35, this.pos.y + 0.1, 1.7);
    if (c.hit) {
      if (this.ragdoll > 0) {
        const vn = this.vel.x * c.nx + this.vel.z * c.nz;
        if (vn < -8 && !this.dead) this.hurt(-vn * 4, this.lastAttacker);
        if (vn < 0) { this.vel.x -= vn * c.nx * 1.4; this.vel.z -= vn * c.nz * 1.4; }
      }
      this.pos.x = c.x; this.pos.z = c.z;
    }
    const gh = groundHeight(this.pos.x, this.pos.z, this.pos.y + 0.6);
    this.vy -= GRAV * dt;
    this.pos.y += this.vy * dt;
    this.swim = false;
    if (this.pos.y <= gh) {
      if (!this.onGround && this.vy < -16 && !this.dead) this.hurt((-this.vy - 16) * 5, null);
      this.pos.y = gh;
      this.vy = 0;
      this.onGround = true;
    } else if (this.pos.y > gh + 0.25) this.onGround = false;
    else if (this.vy <= 0) { this.pos.y = gh; this.vy = 0; this.onGround = true; }
    if (this.pos.y < WATER - 1.2 && isWater(this.pos.x, this.pos.z)) {
      this.swim = true;
      if (this.vy < -6 && !this.splashed) { spawn('splash', this.pos.x, WATER, this.pos.z, 20, 1.5, 0, 5, 0); }
      this.splashed = true;
      this.pos.y = Math.max(this.pos.y, WATER - 1.3);
      this.vy = Math.max(this.vy, 0);
      this.onGround = true;
    } else this.splashed = false;
  }

  animate(dt) {
    const m = this.m;
    const r = this.root;
    r.position.copy(this.pos);
    if (this.dead || this.ragdoll > 0) {
      if (this.onGround) {
        r.rotation.set(-Math.PI / 2, this.heading, 0, 'YXZ');
        r.position.y = this.pos.y + 0.15;
        this.spinX = 0;
      } else {
        r.rotation.order = 'YXZ';
        r.rotation.x += this.spinX * dt;
        r.rotation.y = this.heading;
      }
      m.armL.rotation.set(0, 0, 1.2);
      m.armR.rotation.set(0, 0, -1.2);
      m.legL.rotation.set(0, 0, 0.2);
      m.legR.rotation.set(0, 0, -0.2);
      return;
    }
    r.rotation.set(0, this.heading, 0, 'YXZ');
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (this.swim) {
      this.phase += dt * 5;
      r.position.y = WATER - 1.25;
      m.armL.rotation.set(-2.5 + Math.sin(this.phase) * 0.8, 0, 0);
      m.armR.rotation.set(-2.5 - Math.sin(this.phase) * 0.8, 0, 0);
      m.legL.rotation.x = Math.sin(this.phase * 2) * 0.4;
      m.legR.rotation.x = -Math.sin(this.phase * 2) * 0.4;
      m.hips.rotation.x = 0;
      return;
    }
    this.phase += dt * (sp * 1.9 + 0.01);
    const run = sp > 4.5;
    const amp = clamp(sp / 4, 0, 1) * (run ? 1.0 : 0.6);
    const s = Math.sin(this.phase);
    m.legL.rotation.x = s * amp;
    m.legR.rotation.x = -s * amp;
    m.legL.rotation.z = m.legR.rotation.z = 0;
    m.hips.position.y = 0.9 + Math.abs(Math.cos(this.phase)) * 0.05 * amp;
    m.hips.rotation.x = run ? 0.15 : 0;
    if (!this.onGround) {
      m.legL.rotation.x = -0.6; m.legR.rotation.x = 0.3;
    }
    if (this.aim) {
      m.armR.rotation.set(-Math.PI / 2 + (this.aimPitch || 0), 0, 0);
      m.armL.rotation.set(-Math.PI / 2 + (this.aimPitch || 0) + 0.1, 0, -0.4);
    } else if (this.state === 'flee' || this.state === 'panic') {
      m.armL.rotation.set(-2.6 + s * 0.3, 0, -0.2);
      m.armR.rotation.set(-2.6 - s * 0.3, 0, 0.2);
    } else {
      m.armL.rotation.set(-s * amp * 0.9, 0, 0.05);
      m.armR.rotation.set(s * amp * 0.9, 0, -0.05);
    }
    if (this.punchT > 0) {
      this.punchT -= dt;
      m.armR.rotation.set(-Math.PI / 2, 0, 0);
    }
    if (this.sitting) {
      m.legL.rotation.x = m.legR.rotation.x = -1.4;
      m.armL.rotation.set(-1.0, 0, 0);
      m.armR.rotation.set(-1.0, 0, 0);
      m.hips.position.y = 0.9;
    }
  }

  // ---------------------------------------------------------------- AI
  update(dt) {
    if (this.vehicle) return;
    this.stateT += dt;
    if (this.dead) {
      this.deadT += dt;
      this.vel.multiplyScalar(this.onGround ? Math.max(0, 1 - 6 * dt) : 1);
      this.physics(dt);
      this.animate(dt);
      if (this.deadT > 40 && !this.persist) this.remove();
      return;
    }
    if (this.ragdoll > 0) {
      this.ragdoll -= dt;
      if (this.onGround) this.vel.multiplyScalar(Math.max(0, 1 - 5 * dt));
      this.physics(dt);
      this.animate(dt);
      return;
    }
    this.aim = false;
    if (this.type === 'civ') this.civAI(dt);
    else if (this.type === 'gang') this.gangAI(dt);
    else if (this.type === 'cop') this.copAI(dt);
    this.animate(dt);
  }

  civAI(dt) {
    if (this.state === 'flee') {
      if (this.stateT > 9) { this.state = 'walk'; this.corner = null; }
      const tx = this.pos.x - this.threat.x, tz = this.pos.z - this.threat.z;
      this.move(dt, tx + Math.sin(this.stateT * 0.7 + this.phase) * 3, tz, 6.2);
      return;
    }
    if (this.state === 'idle') {
      this.move(dt, 0, 0, 0);
      if (this.stateT > this.idleFor) { this.state = 'walk'; this.stateT = 0; }
      return;
    }
    // walking
    if (this.town) {
      if (!this.target || Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z) < 1.5) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * this.town.r;
        this.target = { x: this.town.x + Math.cos(a) * d, z: this.town.z + Math.sin(a) * d };
        if (Math.random() < 0.3) { this.state = 'idle'; this.stateT = 0; this.idleFor = rand(2, 6); }
      }
      this.move(dt, this.target.x - this.pos.x, this.target.z - this.pos.z, 1.4);
      if (this.stateT > 30) { this.target = null; this.stateT = 0; }
      return;
    }
    if (!this.corner) this.pickNearestCorner();
    if (!this.corner) { this.move(dt, 0, 0, 0); return; }
    cornerPos(this.corner.bi, this.corner.bj, this.corner.cx, this.corner.cz, _c);
    const dx = _c.x - this.pos.x, dz = _c.z - this.pos.z;
    if (dx * dx + dz * dz < 1.2) {
      this.nextCorner();
      return;
    }
    this.move(dt, dx, dz, this.walkSpeed || 1.4);
  }

  pickNearestCorner() {
    const bi = clamp(Math.floor((this.pos.x + 800) / 100), 0, 15), bj = clamp(Math.floor((this.pos.z + 800) / 100), 0, 15);
    if (!walkableBlock(bi, bj)) return;
    const r = { bi, bj, cx: this.pos.x > CL[bi] + 50 ? 1 : 0, cz: this.pos.z > CL[bj] + 50 ? 1 : 0 };
    this.corner = r;
  }
  nextCorner() {
    const c = this.corner;
    const opts = [
      { bi: c.bi, bj: c.bj, cx: 1 - c.cx, cz: c.cz },
      { bi: c.bi, bj: c.bj, cx: c.cx, cz: 1 - c.cz },
    ];
    if (Math.random() < 0.35) {
      const ni = c.bi + (c.cx ? 1 : -1), nj = c.bj + (c.cz ? 1 : -1);
      if (walkableBlock(ni, c.bj)) opts.push({ bi: ni, bj: c.bj, cx: 1 - c.cx, cz: c.cz });
      if (walkableBlock(c.bi, nj)) opts.push({ bi: c.bi, bj: nj, cx: c.cx, cz: 1 - c.cz });
    }
    // avoid going back
    let o = pick(opts);
    if (this.prevCorner && o.bi === this.prevCorner.bi && o.bj === this.prevCorner.bj && o.cx === this.prevCorner.cx && o.cz === this.prevCorner.cz) o = pick(opts);
    this.prevCorner = c;
    this.corner = o;
    if (Math.random() < 0.08) { this.state = 'idle'; this.stateT = 0; this.idleFor = rand(1.5, 5); }
  }

  scare(x, z) {
    if (this.dead) return;
    if (this.type === 'civ') {
      this.state = 'flee';
      this.stateT = 0;
      this.threat = { x, z };
    }
  }

  canShoot(px, py, pz) {
    return losClear(this.pos.x, this.pos.y + 1.5, this.pos.z, px, py, pz);
  }

  gangAI(dt) {
    const g = this.gang;
    const P = G.player;
    const pp = P.vehicle ? P.vehicle.pos : P.pos;
    const dx = pp.x - this.pos.x, dz = pp.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (g.hostile > 0 && d < 90 && !P.dead) {
      this.state = 'attack';
      this.aim = d < 45;
      this.setWeaponVisible(true);
      const want = P.vehicle ? 8 : 14;
      if (d > want) this.move(dt, dx, dz, 5);
      else this.move(dt, Math.sin(G.time + this.phase) * dz * 0.3, -Math.sin(G.time + this.phase) * dx * 0.3, 1.5);
      this.heading = Math.atan2(dx, dz);
      this.aimPitch = 0;
      this.fireCd -= dt;
      if (this.fireCd <= 0 && d < 45) {
        this.fireCd = rand(0.5, 1.3);
        if (this.canShoot(pp.x, pp.y + 1.2, pp.z)) emit('npcShoot', this, 0.26, 8);
      }
      return;
    }
    this.setWeaponVisible(false);
    this.state = 'idle';
    // hang around home point
    const hx = this.home.x - this.pos.x, hz = this.home.z - this.pos.z;
    if (hx * hx + hz * hz > 4) this.move(dt, hx, hz, 1.4);
    else {
      this.move(dt, 0, 0, 0);
      this.heading = damp(this.heading, this.homeHeading, 2, dt);
    }
    // loitering player on foot near the gang gets warned
    if (!P.vehicle && d < 7 && !P.dead) {
      g.annoy = (g.annoy || 0) + dt;
      if (g.annoy > 1 && !g.warned) { g.warned = true; emit('notify', `${g.name}: "You lost, homie? Get off our turf."`); }
      if (g.annoy > 6) { g.hostile = 40; emit('notify', `The ${g.name} are attacking you!`); }
    }
  }

  copAI(dt) {
    const P = G.player;
    const W = G.wanted;
    const pp = P.vehicle ? P.vehicle.pos : P.pos;
    const dx = pp.x - this.pos.x, dz = pp.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (W.level === 0 || P.dead) {
      this.setWeaponVisible(false);
      if (!this.wander) this.wander = { x: this.pos.x + rand(-60, 60), z: this.pos.z + rand(-60, 60) };
      this.move(dt, this.wander.x - this.pos.x, this.wander.z - this.pos.z, 1.5);
      return;
    }
    this.setWeaponVisible(true);
    this.heading = Math.atan2(dx, dz);
    // suspect sitting in a stopped vehicle: walk up and drag them out
    if (P.vehicle && P.vehicle.speedAbs < 2 && !this.provoked && W.level < 4) {
      if (d > 2.6) this.move(dt, dx, dz, d > 8 ? 5.5 : 3);
      else this.move(dt, 0, 0, 0);
      this.aim = d < 20;
      this.heading = Math.atan2(dx, dz);
      return;
    }
    const shoot = W.level >= 2 || this.provoked;
    if (shoot) {
      const want = 9;
      if (d > want) this.move(dt, dx, dz, d > 30 ? 5.8 : 3.5);
      else this.move(dt, 0, 0, 0);
      this.aim = d < 50;
      this.fireCd -= dt;
      if (this.fireCd <= 0 && d < 50) {
        this.fireCd = rand(0.45, 1.0);
        if (this.canShoot(pp.x, pp.y + 1.2, pp.z)) emit('npcShoot', this, 0.38 + W.level * 0.03, 11);
      }
    } else {
      // run to arrest
      if (d > 1.2) this.move(dt, dx, dz, d > 5 ? 6 : 3);
      else this.move(dt, 0, 0, 0);
    }
    this.heading = Math.atan2(dx, dz);
  }
}

// ---------------------------------------------------------------- population management
let popT = 0;
export function updatePeds(dt) {
  for (let i = G.peds.length - 1; i >= 0; i--) {
    const p = G.peds[i];
    if (p === G.player) continue;
    p.update(dt);
  }
  popT -= dt;
  if (popT > 0) return;
  popT = 0.5;
  const P = G.player;
  const px = P.vehicle ? P.vehicle.pos.x : P.pos.x, pz = P.vehicle ? P.vehicle.pos.z : P.pos.z;
  // despawn
  for (let i = G.peds.length - 1; i >= 0; i--) {
    const p = G.peds[i];
    if (p === P || p.persist) continue;
    const d = Math.hypot(p.pos.x - px, p.pos.z - pz);
    if (d > (p.type === 'gang' ? 360 : p.type === 'cop' ? 300 : 210)) p.remove();
  }
  // civilians in city
  const inCity = Math.abs(px) < 900 && Math.abs(pz) < 900;
  const civ = G.peds.filter((p) => p.type === 'civ' && !p.dead).length;
  const wantCiv = inCity ? (G.night > 0.6 ? 26 : 46) : 0;
  for (let k = 0; k < 4 && civ + k < wantCiv; k++) spawnCityPed(px, pz);
  // town folk
  for (const t of TOWNS) {
    if (t.n === 0) continue;
    const d = Math.hypot(t.x - px, t.z - pz);
    if (d < 260) {
      const cnt = G.peds.filter((p) => p.town === t && !p.dead).length;
      if (cnt < 9) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * t.r;
        const p = new Ped(t.x + Math.cos(a) * r, t.z + Math.sin(a) * r, 'civ');
        p.town = t;
      }
    }
  }
  // gangs
  for (const g of GANGS) {
    const d = Math.hypot(g.cx - px, g.cz - pz);
    if (g.hostile > 0) g.hostile -= 0.5;
    if (d > 200 + 100) { g.warned = false; g.annoy = 0; }
    if (d < 320) {
      const members = G.peds.filter((p) => p.gang === g && !p.dead).length;
      if (members < 12 && (!g.spawnCd || g.spawnCd <= G.time)) {
        g.spawnCd = G.time + (members < 6 ? 0 : 8);
        spawnGangGroup(g, px, pz);
      }
    }
  }
}

function spawnCityPed(px, pz) {
  for (let tries = 0; tries < 6; tries++) {
    const a = Math.random() * Math.PI * 2, r = rand(40, 170);
    const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r;
    const bi = Math.floor((x + 800) / 100), bj = Math.floor((z + 800) / 100);
    if (!walkableBlock(bi, bj)) continue;
    if (blockType[bi][bj].startsWith('gang')) continue;
    const c = { bi, bj, cx: Math.random() < 0.5 ? 1 : 0, cz: Math.random() < 0.5 ? 1 : 0 };
    cornerPos(bi, bj, c.cx, c.cz, _c);
    // random point along an edge of the block
    const r2 = { bi, bj, cx: c.cx, cz: 1 - c.cz };
    const _d = { x: 0, z: 0 };
    cornerPos(r2.bi, r2.bj, r2.cx, r2.cz, _d);
    const t = Math.random();
    const p = new Ped(_c.x + (_d.x - _c.x) * t, _c.z + (_d.z - _c.z) * t, 'civ');
    p.corner = Math.random() < 0.5 ? c : r2;
    p.walkSpeed = rand(1.2, 1.7);
    return p;
  }
}

function spawnGangGroup(g, px, pz) {
  for (let tries = 0; tries < 8; tries++) {
    const bi = g.bi0 + Math.floor(Math.random() * (g.bi1 - g.bi0 + 1));
    const bj = g.bj0 + Math.floor(Math.random() * (g.bj1 - g.bj0 + 1));
    cornerPos(bi, bj, Math.random() < 0.5 ? 1 : 0, Math.random() < 0.5 ? 1 : 0, _c);
    const d = Math.hypot(_c.x - px, _c.z - pz);
    if (d < 50) continue;
    const n = 3;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const x = _c.x + Math.cos(a) * 1.4, z = _c.z + Math.sin(a) * 1.4;
      const p = new Ped(x, z, 'gang', gangLook(g));
      p.gang = g;
      p.home = { x, z };
      p.homeHeading = Math.atan2(_c.x - x, _c.z - z);
      p.weapon = Math.random() < 0.3 ? 'smg' : 'pistol';
      p.health = 110;
    }
    return;
  }
}

// vehicles running people over
export function vehiclePedCollisions() {
  for (const v of G.vehicles) {
    const sp = Math.hypot(v.vel.x, v.vel.z);
    if (sp < 2.5 || v.kind === 'plane' && !v.onGround) continue;
    const s = v.spec;
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    const hl = v.kind === 'heli' ? 1.5 : s.len / 2 + 0.3, hw = (v.kind === 'plane' ? s.wid * 0.5 : s.wid / 2) + 0.3;
    for (const p of G.peds) {
      if (p.vehicle || p.ragdoll > 0) continue;
      const dx = p.pos.x - v.pos.x, dz = p.pos.z - v.pos.z;
      if (Math.abs(dx) > 8 || Math.abs(dz) > 8) continue;
      if (Math.abs(p.pos.y - v.pos.y) > 2) continue;
      const lz = dx * fx + dz * fz, lx = dx * -fz + dz * fx;
      if (Math.abs(lz) > hl || Math.abs(lx) > hw) continue;
      if (p.dead) {
        // bump bodies aside
        p.vel.x = v.vel.x * 0.5; p.vel.z = v.vel.z * 0.5;
        continue;
      }
      const by = v.driver === G.player ? G.player : null;
      p.lastAttacker = by;
      if (p === G.player && v.driver === G.player) continue;
      const dmg = sp > 7 ? sp * 6 : sp * 2;
      p.hurt(dmg, by, sp > 4 ? { x: v.vel.x * 1.1 + (lx > 0 ? -1 : 1) * 2 * -fz, y: 2 + sp * 0.25, z: v.vel.z * 1.1 } : null);
      if (sp <= 4) { p.pos.x += -fz * Math.sign(lx || 1) * 0.6; p.pos.z += fx * Math.sign(lx || 1) * 0.6; }
      emit('pedHitByCar', p, v, sp);
      v.vel.multiplyScalar(0.92);
    }
  }
}

on('gunfire', (x, z, shooter) => {
  for (const p of G.peds) {
    if (p.dead || p === shooter) continue;
    const d = Math.hypot(p.pos.x - x, p.pos.z - z);
    if (d < 45 && p.type === 'civ') p.scare(x, z);
    if (p.type === 'gang' && d < 40 && shooter === G.player) p.gang.hostile = 40;
  }
});
on('pedKilled', (p) => {
  for (const o of G.peds) if (o.type === 'civ' && !o.dead && Math.hypot(o.pos.x - p.pos.x, o.pos.z - p.pos.z) < 30) o.scare(p.pos.x, p.pos.z);
});
