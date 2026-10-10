// Wanted level, police pursuit AI (cars, officers, choppers) and arrests.
import * as THREE from 'three';
import { G, clamp, rand, angWrap, emit, on, damp } from './core.js';
import { groundHeight, losClear, segs } from './terrain.js';
import { Vehicle } from './vehicles.js';
import { Ped, COP_LOOK } from './characters.js';
import { RoadAI, nearestNode, aStar, spawnOnRoad } from './traffic.js';
import { sfx } from './audio.js';

export const wanted = { level: 0, heat: 0, unseenT: 0, flashing: false, bustT: 0 };
G.wanted = wanted;
const LEVELS = [0, 1, 4, 10, 20, 34];

export function addHeat(n, x, z, needWitness = false) {
  if (G.player.dead || G.state !== 'play') return;
  if (needWitness && !copNear(x, z, 70) && wanted.level === 0) {
    // civilians may still call it in
    if (Math.random() > 0.35) return;
  }
  const before = wanted.level;
  wanted.heat = Math.min(60, wanted.heat + n);
  let lvl = 0;
  for (let i = 0; i < LEVELS.length; i++) if (wanted.heat >= LEVELS[i]) lvl = i;
  if (lvl > wanted.level) {
    wanted.level = lvl;
    sfx('wanted');
  }
  if (before === 0 && wanted.level > 0) {
    G.stats.pursuitStart = G.time;
  }
  wanted.unseenT = 0;
  G.stats.maxWanted = Math.max(G.stats.maxWanted, wanted.level);
}
export function setWanted(level) {
  if (wanted.level === 0 && level > 0) G.stats.pursuitStart = G.time;
  wanted.level = level;
  wanted.heat = LEVELS[level];
  wanted.unseenT = 0;
  G.stats.maxWanted = Math.max(G.stats.maxWanted, level);
}
export function clearWanted() {
  if (G.stats) G.stats.pursuitStart = null;
  wanted.level = 0;
  wanted.heat = 0;
  wanted.unseenT = 0;
  wanted.bustT = 0;
  for (const v of G.vehicles) if (v.isPolice) v.siren = false;
}

function copNear(x, z, r) {
  for (const v of G.vehicles) if (v.isPolice && !v.dead && v.driver && Math.hypot(v.pos.x - x, v.pos.z - z) < r) return true;
  for (const p of G.peds) if (p.type === 'cop' && !p.dead && Math.hypot(p.pos.x - x, p.pos.z - z) < r) return true;
  return false;
}

// ---------------------------------------------------------------- police car AI
export class PoliceAI {
  constructor(v) {
    this.v = v;
    this.path = null;
    this.pathT = 0;
    this.stuckT = 0;
    this.reverseT = 0;
    this.exitCd = 0;
  }
  update(dt, v) {
    const I = v.input;
    const P = G.player;
    const tgtV = P.vehicle;
    const tp = tgtV ? tgtV.pos : P.pos;
    if (wanted.level === 0 || P.dead) {
      // go back to normal patrol
      v.siren = false;
      const n = nearestNode(v.pos.x, v.pos.z, 200);
      if (n && n.edges.length) {
        const e = n.edges[0];
        v.ai = new RoadAI(v, n, e.n);
      } else { I.throttle = 0; I.handbrake = true; }
      return;
    }
    v.siren = true;
    const dx = tp.x - v.pos.x, dz = tp.z - v.pos.z;
    const d = Math.hypot(dx, dz);
    let tx = tp.x, tz = tp.z;
    const direct = d < 70;
    if (direct) {
      if (tgtV) { tx += tgtV.vel.x * 0.5; tz += tgtV.vel.z * 0.5; }
    } else {
      this.pathT -= dt;
      if (this.pathT <= 0 || !this.path || !this.path.length) {
        this.pathT = 2;
        this.path = aStar(nearestNode(v.pos.x, v.pos.z), nearestNode(tp.x, tp.z));
        if (this.path) this.path.shift();
      }
      if (this.path && this.path.length) {
        const n = this.path[0];
        if (Math.hypot(n.x - v.pos.x, n.z - v.pos.z) < 12) this.path.shift();
        if (this.path.length) { tx = this.path[0].x; tz = this.path[0].z; }
      }
    }
    const want = Math.atan2(tx - v.pos.x, tz - v.pos.z);
    const diff = angWrap(want - v.heading);
    const fs = v.fwdSpeed;
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      I.throttle = -1;
      I.steer = diff > 0 ? 1 : -1;
      I.handbrake = false;
      return;
    }
    const pSpeed = tgtV ? tgtV.speedAbs : P.vel ? Math.hypot(P.vel.x, P.vel.z) : 0;
    // slow down to box in a stopped suspect, otherwise chase flat out
    let wantSp = v.spec.speed;
    if (pSpeed < 4) wantSp = Math.max(0, d - 8) * 0.9;
    else if (d < 25) wantSp = Math.max(pSpeed + 6, 12);
    if (Math.abs(diff) > 1.2 && d > 20) wantSp = Math.min(wantSp, 14);
    const throttle = clamp((wantSp - fs) * 0.35, -1, 1);
    I.throttle = throttle;
    I.steer = clamp(-diff * 2.5, -1, 1);
    I.handbrake = Math.abs(diff) > 1.3 && fs > 12;
    if (throttle > 0.5 && fs < 1.2) {
      this.stuckT += dt;
      if (this.stuckT > 1.6) { this.reverseT = 1.3; this.stuckT = 0; }
    } else this.stuckT = 0;
    // officers get out near a stopped or on-foot suspect
    this.exitCd -= dt;
    if (this.exitCd <= 0 && v.speedAbs < 3 && ((!tgtV && d < 28) || (tgtV && pSpeed < 2 && d < 16))) {
      this.exitCd = 999;
      for (const side of [-1, 1]) {
        const ox = -Math.cos(v.heading) * 1.8 * side, oz = Math.sin(v.heading) * 1.8 * side;
        const cop = new Ped(v.pos.x + ox, v.pos.z + oz, 'cop', COP_LOOK);
        cop.weapon = wanted.level >= 4 ? 'smg' : 'pistol';
        cop.fromCar = v;
      }
      v.ai = null;
      v.driver = null;
      v.siren = true;
    }
  }
}

// ---------------------------------------------------------------- police chopper AI
export class HeliAI {
  constructor(v) {
    this.v = v;
    this.ang = Math.random() * 6.28;
    this.fireCd = 2;
    this.gunner = { pos: v.pos, weapon: 'smg', heliGunner: true };
  }
  update(dt, v) {
    const P = G.player;
    const tp = P.vehicle ? P.vehicle.pos : P.pos;
    v.input.throttle = v.input.strafe = v.input.steer = 0;
    v.rotor = 1;
    if (wanted.level < 3 || P.dead) {
      // leave
      v.aiVel = { x: Math.sin(this.ang) * 40, y: 8, z: Math.cos(this.ang) * 40 };
      return;
    }
    this.ang += dt * 0.25;
    const r = 45;
    const tx = tp.x + Math.sin(this.ang) * r, tz = tp.z + Math.cos(this.ang) * r;
    // stay clear of rooftops along the way
    let ty = Math.max(groundHeight(tx, tz), groundHeight(tp.x, tp.z), tp.y) + 38;
    const ax = v.pos.x + v.vel.x * 2, az = v.pos.z + v.vel.z * 2;
    for (const [sx, sz] of [[v.pos.x, v.pos.z], [ax, az], [(ax + tx) / 2, (az + tz) / 2]])
      for (const [ox, oz] of [[0, 0], [7, 0], [-7, 0], [0, 7], [0, -7]]) ty = Math.max(ty, groundHeight(sx + ox, sz + oz) + 14);
    const dx = tx - v.pos.x, dy = ty - v.pos.y, dz = tz - v.pos.z;
    const k = 0.9;
    const max = v.pos.y < ty - 6 ? 8 : 55;
    let vx = dx * k, vz = dz * k;
    const l = Math.hypot(vx, vz);
    if (l > max) { vx *= max / l; vz *= max / l; }
    v.aiVel = { x: vx, y: clamp(dy * 1.2, -15, 25), z: vz };
    v.heading = damp(v.heading, v.heading + angWrap(Math.atan2(tp.x - v.pos.x, tp.z - v.pos.z) - v.heading), 2, dt);
    // gunner
    if (wanted.level >= 4) {
      this.fireCd -= dt;
      if (this.fireCd <= 0) {
        this.fireCd = rand(0.15, 0.35);
        if (losClear(v.pos.x, v.pos.y - 1, v.pos.z, tp.x, tp.y + 1, tp.z)) emit('npcShoot', this.gunner, 0.22, 8);
      }
    }
  }
}

// spotlight cone for choppers at night
const coneGeo = new THREE.ConeGeometry(10, 1, 20, 1, true).translate(0, -0.5, 0);
const coneMat = new THREE.MeshBasicMaterial({ color: 0xfff6c0, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });

// ---------------------------------------------------------------- manager
let spawnT = 0;
export function updatePolice(dt) {
  const P = G.player;
  const pp = P.vehicle ? P.vehicle.pos : P.pos;
  // chopper spotlights
  for (const v of G.vehicles) {
    if (v.aiVel && !v.dead && v.ai) {
      if (!v.cone) {
        v.cone = new THREE.Mesh(coneGeo, coneMat);
        G.scene.add(v.cone);
      }
      v.cone.visible = G.night > 0.4 && wanted.level >= 3;
      if (v.cone.visible) {
        const h = Math.max(1, v.pos.y - groundHeight(pp.x, pp.z));
        v.cone.position.copy(v.pos);
        v.cone.scale.set(0.6, h, 0.6);
        v.cone.lookAt(pp.x, pp.y, pp.z);
        v.cone.rotateX(-Math.PI / 2);
      }
    } else if (v.cone) { G.scene.remove(v.cone); v.cone = null; }
  }
  if (wanted.level === 0) { wanted.bustT = 0; return; }
  // visibility
  const seeR = 70 + wanted.level * 25;
  let seen = false;
  for (const v of G.vehicles) {
    if (!v.isPolice || v.dead || (!v.driver && !v.ai)) continue;
    const d = v.pos.distanceTo(pp);
    if (v.kind === 'heli' ? d < 220 : d < seeR && losClear(v.pos.x, v.pos.y + 1.5, v.pos.z, pp.x, pp.y + 1.2, pp.z)) { seen = true; break; }
  }
  if (!seen) for (const p of G.peds) if (p.type === 'cop' && !p.dead && p.pos.distanceTo(pp) < 50) { seen = true; break; }
  if (seen) wanted.unseenT = 0;
  else wanted.unseenT += dt;
  wanted.flashing = wanted.unseenT > 1.5;
  if (wanted.unseenT > 12 + wanted.level * 5) {
    clearWanted();
    emit('notify', 'You lost the cops.');
    return;
  }
  // spawn pursuers
  spawnT -= dt;
  if (spawnT <= 0) {
    spawnT = 2.5;
    const cars = G.vehicles.filter((v) => v.type === 'police' && !v.dead && (v.ai instanceof PoliceAI)).length;
    const wantCars = [0, 1, 2, 4, 5, 7][wanted.level];
    if (cars < wantCars) {
      // repurpose nearby patrol cars first
      let took = false;
      for (const v of G.vehicles) {
        if (v.type === 'police' && v.ai instanceof RoadAI && v.pos.distanceTo(pp) < 250 && !v.dead) { v.ai = new PoliceAI(v); took = true; break; }
      }
      if (!took) {
        const v = spawnOnRoad('police', 140, 320, 'police');
        if (v) { v.ai = new PoliceAI(v); v.driver = { npc: true, cop: true }; }
      }
    }
    const helis = G.vehicles.filter((v) => v.type === 'policeHeli' && !v.dead).length;
    const wantH = wanted.level >= 5 ? 2 : wanted.level >= 3 ? 1 : 0;
    if (helis < wantH) {
      const a = Math.random() * Math.PI * 2;
      const x = pp.x + Math.cos(a) * 300, z = pp.z + Math.sin(a) * 300;
      const v = new Vehicle('policeHeli', x, z, a, 0x1a2a4a, Math.max(groundHeight(x, z), pp.y) + 80);
      v.onGround = false;
      v.rotor = 1;
      v.ai = new HeliAI(v);
      v.driver = { npc: true, cop: true };
      v.siren = true;
    }
  }
  // arrests
  let near = false;
  for (const p of G.peds) {
    if (p.type !== 'cop' || p.dead) continue;
    const d = p.pos.distanceTo(pp);
    if (!P.vehicle && d < 1.8 && wanted.level <= 2) near = true;
    if (P.vehicle && d < 3.5 && P.vehicle.speedAbs < 1.5) near = true;
  }
  if (P.vehicle && P.vehicle.speedAbs < 1.5) {
    for (const v of G.vehicles) if (v.type === 'police' && !v.dead && v.pos.distanceTo(pp) < 7 && v.speedAbs < 2 && wanted.level <= 3) near = true;
  }
  if (P.vehicle && P.vehicle.drowned) near = false;
  wanted.bustT = near ? wanted.bustT + dt : Math.max(0, wanted.bustT - dt * 2);
  if (wanted.bustT > 2.2) emit('busted');
}

// officers who left their cars return-to-patrol cleanup
on('pedKilled', (p, by) => {
  if (by !== G.player) return;
  if (p.type === 'cop') {
    G.stats.copsKilled++;
    addHeat(8, p.pos.x, p.pos.z);
    if (wanted.level < 3) setWanted(3);
  } else if (p.type === 'gang') addHeat(2, p.pos.x, p.pos.z, true);
  else addHeat(3, p.pos.x, p.pos.z, true);
  G.stats.kills++;
});
on('pedHurt', (p, by) => {
  if (by !== G.player || p.dead) return;
  if (p.type === 'cop') { p.provoked = true; addHeat(3, p.pos.x, p.pos.z); }
});
on('pedHitByCar', (p, v, sp) => {
  if (v.driver !== G.player || p === G.player) return;
  if (p.type === 'cop') addHeat(4, p.pos.x, p.pos.z);
  else addHeat(1.5, p.pos.x, p.pos.z, true);
});
let lastShotHeat = 0;
on('gunfire', (x, z, shooter) => {
  if (shooter !== G.player) return;
  if (G.time - lastShotHeat < 1.5) return;
  lastShotHeat = G.time;
  addHeat(copNear(x, z, 90) ? 2 : 0.6, x, z, true);
});
on('vehicleDamaged', (v, amount, by) => {
  if (by !== G.player || v.driver === G.player) return;
  if (v.isPolice) addHeat(Math.min(3, amount / 15), v.pos.x, v.pos.z);
});
on('vehicleDestroyed', (v) => {
  if (v.lastHitBy === G.player) {
    G.stats.carsDestroyed++;
    addHeat(v.isPolice ? 8 : 2, v.pos.x, v.pos.z, !v.isPolice);
  }
});
on('carjack', (v) => {
  if (v.isPolice) addHeat(6, v.pos.x, v.pos.z);
  else addHeat(1, v.pos.x, v.pos.z, true);
});
void segs;
