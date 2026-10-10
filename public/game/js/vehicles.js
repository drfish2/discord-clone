// Vehicle simulation: cars, bikes, helicopters, planes, boats.
import * as THREE from 'three';
import { G, GRAV, WATER, clamp, lerp, damp, emit, angWrap } from './core.js';
import { groundHeight, collideCircle, isWater, terrainHeight, waterLevel, buildingsNear } from './terrain.js';
import { RaycastVehicle, paramsForVehicleType, collideBodies } from './car_physics.js';

// Cars and bikes near the player use a full raycast-vehicle model (suspension, tyres,
// drivetrain); distant traffic keeps the cheap arcade model below.
const PHYS_R = 170;
const PHYS_GRAVITY = 9.81 * 1.25; // a touch heavier than real life so jumps don't float
const groundFn = (x, z, yRef) => groundHeight(x, z, yRef);
const _rp = {}, _eu = {}, _pin = { throttle: 0, steer: 0, handbrake: false };
import { buildVehicleMesh, VSPEC, wreckMat } from './models.js';

const wreckModelMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 1 });
import { spawn, explosionFx } from './fx.js';

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _u = new THREE.Vector3();
const _l = new THREE.Vector3();
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

export const CAR_COLORS = [0xf5f5f5, 0x1b1b1b, 0xb71c1c, 0x0d47a1, 0x9e9e9e, 0x2e7d32, 0xf9a825, 0x6d4c41, 0x546e7a, 0xc0c0c0, 0x880e4f, 0x00838f, 0xe65100];

let nextId = 1;
export class Vehicle {
  constructor(type, x, z, heading = 0, color = 0xffffff, y = null) {
    this.id = nextId++;
    this.type = type;
    this.spec = VSPEC[type];
    this.kind = this.spec.kind;
    if (type === 'police') color = 0x151a24;
    if (type === 'taxi') color = 0xf6c200;
    if (type === 'policeHeli') color = 0x1a2a4a;
    this.color = color;
    const m = buildVehicleMesh(type, color);
    this.m = m;
    this.root = m.root;
    this.root.rotation.order = 'YXZ';
    this.pos = new THREE.Vector3(x, y ?? groundHeight(x, z) + 0.05, z);
    if (this.kind === 'boat') this.pos.y = waterLevel(x, z);
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.heading = heading;
    this.pitch = 0;
    this.roll = 0;
    this.q = new THREE.Quaternion().setFromAxisAngle(AY, heading);
    this.speed = 0; // planes
    this.throttleLevel = 0;
    this.sink = 0;
    this.rotor = 0;
    this.health = this.spec.hp;
    this.dead = false;
    this.fireTimer = -1;
    this.driver = null;
    this.ai = null;
    this.onGround = true;
    this.air = 0;
    this.steer = 0;
    this.spin = 0;
    this.input = { throttle: 0, steer: 0, handbrake: false, lift: 0, strafe: 0, pitch: 0, roll: 0, yaw: 0 };
    this.isPolice = type === 'police' || type === 'policeHeli';
    this.siren = false;
    this.drowned = 0;
    this.persist = false;
    this.lastHitBy = null;
    this.removeT = 0;
    G.scene.add(this.root);
    G.vehicles.push(this);
    this.sync(0);
  }

  get fwdSpeed() {
    return this.vel.x * Math.sin(this.heading) + this.vel.z * Math.cos(this.heading);
  }
  get speedAbs() {
    return Math.hypot(this.vel.x, this.vel.y || 0, this.vel.z);
  }
  get radius() {
    return Math.max(this.spec.len, this.spec.wid) * 0.45;
  }

  damage(amount, by = null) {
    if (this.dead || amount <= 0) return;
    this.health -= amount;
    if (by) this.lastHitBy = by;
    emit('vehicleDamaged', this, amount, by);
    if (this.health <= 0 && this.fireTimer < 0) {
      if (amount > 80) this.explode();
      else this.fireTimer = this.kind === 'car' || this.kind === 'bike' ? 3.5 : 0.01;
    }
  }

  explode() {
    if (this.dead) return;
    this.dead = true;
    this.health = 0;
    this.fireTimer = -1;
    if (this.m.model) for (const o of this.m.meshes) o.material = wreckModelMat;
    else {
      this.m.bodyMesh.material = wreckMat;
      if (this.m.detMesh) this.m.detMesh.material = wreckMat;
    }
    for (const s of this.m.siren) s.visible = false;
    explosionFx(this.pos.x, this.pos.y, this.pos.z, this.kind === 'plane' || this.kind === 'heli' ? 1.5 : 1);
    this.vy = this.kind === 'car' ? 7 : this.vy;
    this.onGround = false;
    this.burnT = 12;
    this.removeT = 60;
    emit('explosion', this.pos.clone(), 9, this.lastHitBy, this);
    emit('vehicleDestroyed', this);
  }

  remove() {
    G.scene.remove(this.root);
    const i = G.vehicles.indexOf(this);
    if (i >= 0) G.vehicles.splice(i, 1);
    this.removed = true;
  }

  update(dt) {
    if (this.ai && !this.dead) this.ai.update(dt, this);
    if (this.dead || !this.driver) {
      const I = this.input;
      if (!this.ai || this.dead) { I.throttle = 0; I.steer = 0; I.lift = this.kind === 'heli' && !this.onGround ? -0.6 : 0; I.handbrake = !this.dead && this.kind !== 'plane'; I.pitch = I.roll = I.yaw = I.strafe = 0; }
    }
    switch (this.kind) {
      case 'car':
      case 'bike':
        this.updateCar(dt);
        break;
      case 'heli':
        this.updateHeli(dt);
        break;
      case 'plane':
        this.updatePlane(dt);
        break;
      case 'boat':
        this.updateBoat(dt);
        break;
    }
    // fire & smoke
    if (!this.dead && this.health < this.spec.hp * 0.3 && Math.random() < dt * 12) spawn('smoke', this.pos.x, this.pos.y + 1.2, this.pos.z, 1, 0.5, 0, 1, 0);
    if (this.fireTimer >= 0) {
      this.fireTimer -= dt;
      if (Math.random() < dt * 30) spawn('fire', this.pos.x + Math.sin(this.heading) * this.spec.len * 0.3, this.pos.y + 1, this.pos.z + Math.cos(this.heading) * this.spec.len * 0.3, 2, 0.6, 0, 2, 0);
      if (this.fireTimer < 0) this.explode();
    }
    if (this.dead) {
      this.burnT -= dt;
      if (this.burnT > 0 && Math.random() < dt * 20) spawn('blacksmoke', this.pos.x, this.pos.y + 1.5, this.pos.z, 1, 0.8, 0, 2, 0);
      if (this.burnT > 6 && Math.random() < dt * 20) spawn('fire', this.pos.x, this.pos.y + 1, this.pos.z, 1, 0.8, 0, 1.5, 0);
    }
    // sirens
    if (this.m.siren.length) {
      const on = this.siren && !this.dead;
      const ph = Math.floor(G.time * 6) % 2;
      this.m.siren[0].visible = !on || ph === 0;
      this.m.siren[1].visible = !on || ph === 1;
    }
    this.sync(dt);
  }

  collideWorld(height) {
    const s = this.spec;
    const r = this.kind === 'bike' ? 0.5 : s.wid * 0.55;
    const off = Math.max(0, s.len / 2 - r);
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    let impact = 0;
    const offs = off > 0.3 ? [off, 0, -off] : [0];
    for (const k of offs) {
      const cx = this.pos.x + fx * k, cz = this.pos.z + fz * k;
      const c = collideCircle(cx, cz, r, this.pos.y + 0.3, height);
      if (c.hit) {
        this.pos.x += c.x - cx;
        this.pos.z += c.z - cz;
        const vn = this.vel.x * c.nx + this.vel.z * c.nz;
        if (vn < 0) {
          this.vel.x -= vn * c.nx * 1.35;
          this.vel.z -= vn * c.nz * 1.35;
          impact = Math.max(impact, -vn);
        }
      }
    }
    if (impact > 3) {
      this.vel.multiplyScalar(0.85);
      emit('vehicleImpact', this, impact);
      if (impact > 7) {
        this.damage((impact - 7) * 2.2 / Math.sqrt(s.mass));
        spawn('spark', this.pos.x + fx * s.len * 0.5, this.pos.y + 0.6, this.pos.z + fz * s.len * 0.5, 6, 2);
      }
    }
    return impact;
  }

  // ---------------------------------------------------------------- realistic physics
  attachPhys() {
    const p = paramsForVehicleType(this.type, this.spec, { gravity: PHYS_GRAVITY });
    const ph = new RaycastVehicle(p, { x: this.pos.x, z: this.pos.z, y: this.pos.y, heading: this.heading });
    ph.vel.x = this.vel.x; ph.vel.y = this.vy || 0; ph.vel.z = this.vel.z;
    this.phys = ph;
    this.snapSync();
  }
  detachPhys() {
    this.phys = null;
    this._sync = null;
  }
  snapSync() {
    const S = this._sync || (this._sync = {});
    S.x = this.pos.x; S.y = this.pos.y; S.z = this.pos.z; S.h = this.heading;
    S.vx = this.vel.x; S.vy = this.vy; S.vz = this.vel.z;
  }
  // other code (AI spawns, explosions, police) writes position/velocity/heading directly:
  // carry those edits over into the physics body
  pullExternal() {
    const S = this._sync, ph = this.phys;
    if (!S) return;
    if (Math.abs(this.heading - S.h) > 1e-4) {
      const e = ph.getEuler(_eu);
      const dh = this.heading - e.heading;
      const q = ph.q, hs = Math.sin(dh / 2), hc = Math.cos(dh / 2);
      // pre-multiply by a yaw rotation
      const x = hc * q.x + hs * q.z, y = hc * q.y + hs * q.w, z = hc * q.z - hs * q.x, w = hc * q.w - hs * q.y;
      q.x = x; q.y = y; q.z = z; q.w = w;
      ph._updateR();
    }
    const dx = this.pos.x - S.x, dy = this.pos.y - S.y, dz = this.pos.z - S.z;
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 1e-4) { ph.pos.x += dx; ph.pos.y += dy; ph.pos.z += dz; }
    if (Math.abs(this.vel.x - S.vx) + Math.abs(this.vel.z - S.vz) > 1e-4) { ph.vel.x = this.vel.x; ph.vel.z = this.vel.z; }
    if (Math.abs(this.vy - S.vy) > 1e-4) ph.vel.y = this.vy;
  }
  pushPhys() {
    const ph = this.phys;
    const r = ph.getRootPosition(_rp);
    this.pos.set(r.x, r.y, r.z);
    const e = ph.getEuler(_eu);
    this.heading = e.heading;
    this.pitch = e.pitch;
    this.roll = e.roll;
    this.vel.set(ph.vel.x, ph.vel.y, ph.vel.z);
    this.vy = ph.vel.y;
    this.snapSync();
  }
  updateCarPhys(dt) {
    const ph = this.phys, I = this.input, s = this.spec;
    this.pullExternal();
    const live = !this.dead && this.drowned === 0;
    _pin.throttle = live ? I.throttle : 0;
    _pin.steer = live ? I.steer : 0;
    _pin.handbrake = live ? I.handbrake : true;
    ph.step(dt, _pin, groundFn, buildingsNear(this.pos.x, this.pos.z));
    this.pushPhys();
    const was = this.onGround;
    this.onGround = ph.wheelsOnGround > 0;
    if (!this.onGround) this.air += dt;
    else {
      if (!was && this.air > 0.3) emit('landed', this, this.air);
      this.air = 0;
    }
    // wheels: steering angle and spin from the simulated wheels
    this.steer = ph.p.maxSteer ? ph.steerAngle / ph.p.maxSteer : 0;
    const rw = ph.wheels[ph.wheels.length - 1];
    this.spin += rw.omega * dt;
    // skids and impacts
    this.slip = ph.telemetry.skid * 10;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    if (ph.telemetry.skid > 0.25 && Math.random() < dt * 25) spawn('skid', this.pos.x - fx * s.len * 0.4, this.pos.y + 0.2, this.pos.z - fz * s.len * 0.4, 1, 0.3);
    const impact = ph.lastImpact;
    if (impact > 3) {
      emit('vehicleImpact', this, impact);
      if (impact > 7) {
        this.damage(((impact - 7) * 2.2) / Math.sqrt(s.mass));
        spawn('spark', this.pos.x + fx * s.len * 0.5, this.pos.y + 0.6, this.pos.z + fz * s.len * 0.5, 6, 2);
      }
    }
    // stuck on its roof: the player's car is put back on its wheels after a moment
    if (ph.isFlipped() && ph.speed < 1.5) {
      this.flipT = (this.flipT || 0) + dt;
      if (this.flipT > 2.5) {
        ph.reset(this.pos.x, groundHeight(this.pos.x, this.pos.z, this.pos.y + 2) + 0.3, this.pos.z, this.heading);
        this.pushPhys();
        this.flipT = 0;
      }
    } else this.flipT = 0;
    // water: hand over to the arcade model, which sinks the car
    const wl = waterLevel(this.pos.x, this.pos.z);
    if (this.pos.y < wl - 0.6 && isWater(this.pos.x, this.pos.z)) {
      this.detachPhys();
      this.drowned = 0.01;
      spawn('splash', this.pos.x, wl + 0.3, this.pos.z, 40, 3, 0, 6, 0);
      emit('vehicleDrowned', this);
    }
  }

  updateCar(dt) {
    if (!this.drowned && !G.arcadeCars) {
      const P = G.player;
      const pp = P && (P.vehicle ? P.vehicle.pos : P.pos);
      const near = this.driver === G.player || (pp && Math.abs(pp.x - this.pos.x) + Math.abs(pp.z - this.pos.z) < PHYS_R);
      if (near && !this.phys) this.attachPhys();
      else if (!near && this.phys) this.detachPhys();
      if (this.phys) return this.updateCarPhys(dt);
    } else if (this.phys) this.detachPhys();
    const s = this.spec, I = this.input;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = -fz, rz = fx;
    let vf = this.vel.x * fx + this.vel.z * fz;
    let vr = this.vel.x * rx + this.vel.z * rz;
    const canDrive = this.onGround && !this.dead && this.drowned === 0;
    if (canDrive) {
      const t = I.throttle;
      if (t > 0) {
        if (vf < -0.5) vf += 30 * dt * t;
        else vf += s.accel * t * Math.max(0, 1 - Math.pow(Math.max(vf, 0) / s.speed, 1.6)) * dt;
      } else if (t < 0) {
        if (vf > 0.5) vf += 32 * dt * t;
        else if (vf > -s.speed * 0.3) vf += s.accel * 0.6 * t * dt;
      } else vf -= Math.sign(vf) * Math.min(Math.abs(vf), (1.5 + Math.abs(vf) * 0.04) * dt);
      if (I.handbrake) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 9 * dt);
      this.steer = damp(this.steer, I.steer, 7, dt);
      const maxA = 0.62 / (1 + Math.abs(vf) / 24);
      const yaw = (vf * Math.tan(this.steer * maxA)) / (s.len * 0.62);
      const grip = I.handbrake ? 1.0 : s.grip * (this.kind === 'bike' ? 1 : 1);
      this.slip = Math.abs(vr);
      vr *= Math.max(0, 1 - grip * dt);
      this.vel.x = fx * vf + rx * vr;
      this.vel.z = fz * vf + rz * vr;
      this.heading -= yaw * dt * (I.handbrake ? 1.35 : 1);
      if (this.slip > 4 && Math.random() < dt * 20) spawn('skid', this.pos.x - fx * s.len * 0.4, this.pos.y + 0.2, this.pos.z - fz * s.len * 0.4, 1, 0.3);
    } else if (this.drowned) {
      this.vel.multiplyScalar(Math.max(0, 1 - 2 * dt));
    } else if (!this.onGround && !this.dead) {
      // a bit of air control
      this.heading -= I.steer * 0.8 * dt;
    }
    if (this.dead && this.onGround) this.vel.multiplyScalar(Math.max(0, 1 - 2.5 * dt));
    // integrate horizontal
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.collideWorld(s.height);
    // vertical
    const gh = groundHeight(this.pos.x, this.pos.z, this.pos.y + 0.6);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.vy -= GRAV * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= gh) {
      if (!this.onGround) {
        if (this.vy < -14) this.damage((-this.vy - 14) * 4);
        if (this.air > 0.3) emit('landed', this, this.air);
        this.air = 0;
      }
      this.pos.y = gh;
      if (sp > 0.5) {
        const back = groundHeight(this.pos.x - (this.vel.x / sp) * 1.5, this.pos.z - (this.vel.z / sp) * 1.5, this.pos.y + 0.6);
        this.vy = clamp(((gh - back) / 1.5) * sp, -40, 30);
      } else this.vy = 0;
      this.onGround = true;
    } else if (this.pos.y - gh > 0.3) {
      this.onGround = false;
      this.air += dt;
    }
    // water
    const wl = waterLevel(this.pos.x, this.pos.z);
    if (this.pos.y < wl - 0.6 && isWater(this.pos.x, this.pos.z)) {
      if (!this.drowned) {
        this.drowned = 0.01;
        spawn('splash', this.pos.x, wl + 0.3, this.pos.z, 40, 3, 0, 6, 0);
        emit('vehicleDrowned', this);
      }
      this.vy = Math.max(this.vy, -1.5);
      this.drowned += dt;
      if (this.drowned > 12 && !this.persist) this.removeT = 0.01;
    }
    // orientation
    const L = s.len, W = s.wid;
    if (this.onGround) {
      const fx2 = Math.sin(this.heading), fz2 = Math.cos(this.heading);
      const my = this.pos.y + 1;
      const hf = groundHeight(this.pos.x + fx2 * L * 0.45, this.pos.z + fz2 * L * 0.45, my);
      const hb = groundHeight(this.pos.x - fx2 * L * 0.45, this.pos.z - fz2 * L * 0.45, my);
      const pitchT = Math.atan2(hf - hb, L * 0.9);
      let rollT = 0;
      if (this.kind !== 'bike') {
        const hl = groundHeight(this.pos.x + fz2 * W * 0.45, this.pos.z - fx2 * W * 0.45, my);
        const hr = groundHeight(this.pos.x - fz2 * W * 0.45, this.pos.z + fx2 * W * 0.45, my);
        rollT = Math.atan2(hl - hr, W * 0.9);
      } else {
        rollT = -this.steer * clamp(Math.abs(this.fwdSpeed) / 25, 0, 1) * 0.5;
      }
      this.pitch = damp(this.pitch, clamp(pitchT, -0.6, 0.6), 14, dt);
      this.roll = damp(this.roll, clamp(rollT, -0.6, 0.6), 10, dt);
    } else {
      const sp2 = Math.max(sp, 1);
      this.pitch = damp(this.pitch, clamp(Math.atan2(this.vy, sp2) * 0.6, -0.7, 0.5), 2, dt);
      this.roll = damp(this.roll, 0, 2, dt);
    }
    this.spin += this.fwdSpeed * dt / (s.wheelR || 0.4);
  }

  updateHeli(dt) {
    const s = this.spec, I = this.input;
    const powered = !!this.driver && !this.dead && this.drowned === 0;
    this.rotor = damp(this.rotor, powered ? 1 : 0, powered ? 0.9 : 0.3, dt);
    const p = this.rotor;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = -fz, rz = fx;
    if (!this.onGround || I.lift > 0) this.heading -= I.steer * 1.5 * dt * p;
    this.pitch = damp(this.pitch, I.throttle * 0.28, 3, dt);
    this.roll = damp(this.roll, -(I.strafe * 0.25 + I.steer * 0.1), 3, dt);
    if (this.aiVel && this.ai && !this.dead) {
      // AI pilot steers by target velocity
      this.rotor = 1;
      this.vel.x = damp(this.vel.x, this.aiVel.x, 1.5, dt);
      this.vel.z = damp(this.vel.z, this.aiVel.z, 1.5, dt);
      this.vy = damp(this.vy, this.aiVel.y, 1.5, dt);
      const lf = this.vel.x * fx + this.vel.z * fz, lr = this.vel.x * rx + this.vel.z * rz;
      this.pitch = damp(this.pitch, clamp(lf / 60, -0.3, 0.3), 2, dt);
      this.roll = damp(this.roll, clamp(-lr / 60, -0.3, 0.3), 2, dt);
    } else {
      const ax = (fx * I.throttle * 20 + rx * I.strafe * 13) * p;
      const az = (fz * I.throttle * 20 + rz * I.strafe * 13) * p;
      if (!this.onGround || p > 0.7) {
        this.vel.x += ax * dt;
        this.vel.z += az * dt;
      }
      const drag = Math.max(0, 1 - 0.55 * dt);
      this.vel.x *= drag;
      this.vel.z *= drag;
      const hs = Math.hypot(this.vel.x, this.vel.z);
      if (hs > s.speed) { this.vel.x *= s.speed / hs; this.vel.z *= s.speed / hs; }
      let vyT = I.lift * 14;
      if (p < 0.75) vyT = Math.min(vyT, -(1 - p) * 30);
      if (this.dead) vyT = -40;
      this.vy = damp(this.vy, vyT, this.dead ? 1 : 2.2, dt);
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vy * dt;
    const c = collideCircle(this.pos.x, this.pos.z, 4, this.pos.y + 0.5, 3);
    if (c.hit) {
      const vn = this.vel.x * c.nx + this.vel.z * c.nz;
      this.pos.x = c.x; this.pos.z = c.z;
      if (vn < 0) { this.vel.x -= vn * c.nx * 1.6; this.vel.z -= vn * c.nz * 1.6; }
      if (-vn > 6) this.damage(-vn * 3);
    }
    const gh = groundHeight(this.pos.x, this.pos.z, this.pos.y + 0.5);
    if (this.pos.y <= gh) {
      if (this.vy < -9 && !this.onGround) this.damage((-this.vy - 9) * 8);
      this.pos.y = gh;
      this.vy = Math.max(0, this.vy);
      this.vel.x *= Math.max(0, 1 - 4 * dt);
      this.vel.z *= Math.max(0, 1 - 4 * dt);
      this.onGround = true;
      if (this.dead && !this.crashed) { this.crashed = true; explosionFx(this.pos.x, this.pos.y, this.pos.z, 1.2); emit('explosion', this.pos.clone(), 8, null, this); }
    } else if (this.pos.y > gh + 0.2) this.onGround = false;
    const hwl = waterLevel(this.pos.x, this.pos.z);
    if (this.pos.y < hwl - 0.5 && isWater(this.pos.x, this.pos.z)) {
      if (!this.drowned) { this.drowned = 0.01; spawn('splash', this.pos.x, hwl, this.pos.z, 50, 4, 0, 8, 0); emit('vehicleDrowned', this); }
      this.drowned += dt;
      this.vy = Math.max(this.vy, -1);
      if (this.drowned > 12 && !this.persist) this.removeT = 0.01;
    }
    if (this.pos.y > 900) { this.pos.y = 900; this.vy = Math.min(this.vy, 0); }
    if (this.m.rotor) this.m.rotor.rotation.y += p * 30 * dt;
    if (this.m.tail) this.m.tail.rotation.x += p * 40 * dt;
    if (p > 0.3 && this.pos.y - gh < 14 && Math.random() < dt * 25 * p) spawn('dust', this.pos.x + (Math.random() - 0.5) * 12, gh + 0.3, this.pos.z + (Math.random() - 0.5) * 12, 1, 1, (Math.random() - 0.5) * 10, 0.5, (Math.random() - 0.5) * 10);
  }

  updatePlane(dt) {
    const s = this.spec, I = this.input;
    const powered = !!this.driver && !this.dead;
    this.throttleLevel = clamp(this.throttleLevel + I.throttle * 0.5 * dt, 0, 1);
    if (!powered) this.throttleLevel = 0;
    const sp = this.speed;
    const eff = clamp(sp / 30, 0.15, 1);
    const stall = s.speed * 0.38;
    _f.copy(AZ).applyQuaternion(this.q);
    if (!this.onGround) {
      _q.setFromAxisAngle(AX, -I.pitch * 1.05 * eff * dt);
      this.q.multiply(_q);
      _q.setFromAxisAngle(AZ, I.roll * 2.3 * eff * dt);
      this.q.multiply(_q);
      _q.setFromAxisAngle(AY, -I.yaw * 0.6 * eff * dt);
      this.q.multiply(_q);
      _l.copy(AX).applyQuaternion(this.q);
      _q.setFromAxisAngle(AY, -_l.y * 1.0 * eff * dt);
      this.q.premultiply(_q);
      if (sp < stall) {
        // stalled: nose drops
        _q.setFromAxisAngle(AX, (1 - sp / stall) * 0.8 * dt);
        this.q.multiply(_q);
      }
    } else {
      const h = Math.atan2(_f.x, _f.z);
      const nh = h - (I.roll + I.yaw) * 0.7 * dt * clamp(sp / 8, 0, 1);
      let pitch = Math.asin(clamp(_f.y, -1, 1));
      if (I.pitch > 0 && sp > stall) pitch += I.pitch * 0.6 * dt;
      else pitch = damp(pitch, 0, 4, dt);
      _e.set(-pitch, nh, 0, 'YXZ');
      this.q.setFromEuler(_e);
    }
    this.q.normalize();
    _f.copy(AZ).applyQuaternion(this.q);
    _u.copy(AY).applyQuaternion(this.q);
    const thrust = this.throttleLevel * s.accel * (this.drowned ? 0 : 1);
    const drag = (sp * sp * s.accel) / (s.speed * s.speed) + (this.onGround && I.throttle < 0 ? 12 : 0) + (this.onGround && this.throttleLevel < 0.05 ? 1.5 : 0);
    this.speed = Math.max(0, sp + (thrust - drag - 18 * _f.y) * dt);
    this.vel.copy(_f).multiplyScalar(this.speed);
    if (!this.onGround) {
      const lift = clamp((this.speed - stall * 0.7) / (stall * 0.3), 0, 1);
      this.sink = damp(this.sink, (1 - lift) * 30, 1.2, dt);
    } else this.sink = 0;
    this.vel.y -= this.sink;
    if (this.dead) this.vel.y -= 15;
    this.pos.addScaledVector(this.vel, dt);
    this.heading = Math.atan2(_f.x, _f.z);
    const c = collideCircle(this.pos.x, this.pos.z, this.type === 'jet' ? 5 : 3.5, this.pos.y + 0.5, 3);
    if (c.hit) {
      this.pos.x = c.x; this.pos.z = c.z;
      if (this.speed > 12) this.damage(999);
      else this.speed *= 0.5;
    }
    const gh = groundHeight(this.pos.x, this.pos.z, this.pos.y + 0.5);
    if (this.pos.y <= gh) {
      const vyImp = this.vel.y;
      if (!this.onGround && (vyImp < -10 || _u.y < 0.75 || _f.y < -0.25)) {
        this.damage(999);
      }
      this.pos.y = gh;
      this.onGround = true;
    } else if (this.pos.y > gh + 0.4) this.onGround = false;
    const pwl = waterLevel(this.pos.x, this.pos.z);
    if (this.pos.y < pwl - 0.3 && isWater(this.pos.x, this.pos.z)) {
      if (!this.drowned) { this.drowned = 0.01; spawn('splash', this.pos.x, pwl, this.pos.z, 60, 4, 0, 8, 0); if (this.speed > 25) this.damage(999); emit('vehicleDrowned', this); }
      this.drowned += dt;
      this.speed *= Math.max(0, 1 - 2 * dt);
      this.pos.y = Math.max(this.pos.y, pwl - 1.2);
      if (this.drowned > 14 && !this.persist) this.removeT = 0.01;
    }
    if (this.pos.y > 1500) this.pos.y = 1500;
    const propSpin = (this.throttleLevel * 40 + (powered ? 8 : 0)) * dt;
    if (this.m.prop) this.m.prop.rotation.z += propSpin;
    if (this.m.propBone) this.m.propBone.rotateY(propSpin);
    if (this.dead && this.onGround && !this.crashed) { this.crashed = true; }
  }

  updateBoat(dt) {
    const s = this.spec, I = this.input;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const rx = -fz, rz = fx;
    let vf = this.vel.x * fx + this.vel.z * fz;
    let vr = this.vel.x * rx + this.vel.z * rz;
    const afloat = isWater(this.pos.x, this.pos.z);
    const bwl = waterLevel(this.pos.x, this.pos.z);
    if (!this.dead && afloat) {
      if (I.throttle > 0) vf += s.accel * I.throttle * Math.max(0, 1 - vf / s.speed) * dt;
      else if (I.throttle < 0) vf += (vf > 0 ? 18 : 6) * I.throttle * dt;
      vf *= Math.max(0, 1 - 0.25 * dt);
      this.steer = damp(this.steer, I.steer, 4, dt);
      this.heading -= this.steer * clamp(vf / 8, -1, 1) * 1.3 * dt;
      vr *= Math.max(0, 1 - s.grip * dt);
      this.vel.x = fx * vf + rx * vr;
      this.vel.z = fz * vf + rz * vr;
      if (Math.abs(vf) > 5 && Math.random() < dt * 30) spawn('splash', this.pos.x - fx * 2.5 + rx * (Math.random() - 0.5) * 2, bwl + 0.2, this.pos.z - fz * 2.5 + rz * (Math.random() - 0.5) * 2, 1, 0.5, -fx * 2, 2, -fz * 2);
    } else this.vel.multiplyScalar(Math.max(0, 1 - 3 * dt));
    const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    const ahead = isWater(nx + fx * 2.5, nz + fz * 2.5) || terrainHeight(nx + fx * 2.5, nz + fz * 2.5) < bwl - 0.2;
    if (ahead || !afloat) {
      this.pos.x = nx;
      this.pos.z = nz;
    } else {
      const imp = Math.abs(vf);
      this.vel.multiplyScalar(-0.3);
      if (imp > 8) this.damage(imp * 2);
    }
    const gh = terrainHeight(this.pos.x, this.pos.z);
    const target = afloat ? bwl - 0.35 + Math.sin(G.time * 2 + this.id) * 0.08 : Math.max(gh, bwl - 0.35);
    this.pos.y = damp(this.pos.y, target, 6, dt);
    this.pitch = damp(this.pitch, afloat ? clamp(vf / s.speed, 0, 1) * 0.12 : 0, 3, dt);
    this.roll = damp(this.roll, -this.steer * 0.12 * clamp(vf / 15, 0, 1), 3, dt);
    this.onGround = true;
  }

  sync(dt) {
    const r = this.root;
    r.position.copy(this.pos);
    if (this.kind === 'plane') r.quaternion.copy(this.q);
    else {
      r.rotation.set(-this.pitch, this.heading, this.roll, 'YXZ');
    }
    if (this.m.wheels.length) {
      const st = this.steer * 0.5;
      if (this.m.model) {
        for (const w of this.m.wheels) {
          w.spin.rotation.x = this.spin;
          if (w.front) w.pivot.rotation.y = -st * (this.kind === 'bike' ? 0.5 : 1);
        }
      } else {
        this.m.wheels.forEach((w, i) => {
          w.rotation.order = 'YXZ';
          w.rotation.x = this.spin;
          if (i < 2 && this.kind === 'car') w.rotation.y = -st;
          if (this.kind === 'bike' && i === 0) w.rotation.y = -st * 0.5;
        });
      }
    }
  }
}

export function spawnVehicle(type, x, z, heading, color) {
  const pool = type === 'heli' ? [0xe65100, 0xfafafa, 0x1565c0, 0xc62828] : CAR_COLORS;
  return new Vehicle(type, x, z, heading, color ?? pool[Math.floor(Math.random() * pool.length)]);
}

// vehicle vs vehicle collisions
export function collideVehicles(dt) {
  const V = G.vehicles;
  for (let i = 0; i < V.length; i++) {
    const a = V[i];
    if (a.kind === 'plane' && !a.onGround) continue;
    for (let j = i + 1; j < V.length; j++) {
      const b = V[j];
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const rs = a.radius * 0.8 + b.radius * 0.8;
      if (Math.abs(dx) > rs || Math.abs(dz) > rs) continue;
      if (Math.abs(a.pos.y - b.pos.y) > 2.5) continue;
      if (a.phys && b.phys) {
        const impact = collideBodies(a.phys, b.phys);
        if (impact > 0) {
          a.pushPhys();
          b.pushPhys();
          if (impact > 5) {
            const ma = a.spec.mass, mb = b.spec.mass;
            a.damage((impact - 5) * 1.1 * (mb / ma), b.driver);
            b.damage((impact - 5) * 1.1 * (ma / mb), a.driver);
            emit('vehicleCrash', a, b, impact);
            spawn('spark', (a.pos.x + b.pos.x) / 2, a.pos.y + 0.7, (a.pos.z + b.pos.z) / 2, 8, 2);
          }
        }
        continue;
      }
      // refine with oriented boxes (separating axis on 2 axes each)
      const pen = obbPen(a, b);
      if (!pen) continue;
      const { nx, nz, depth } = pen;
      const ma = a.spec.mass, mb = b.spec.mass;
      const ta = mb / (ma + mb), tb = ma / (ma + mb);
      a.pos.x -= nx * depth * ta; a.pos.z -= nz * depth * ta;
      b.pos.x += nx * depth * tb; b.pos.z += nz * depth * tb;
      const rv = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
      if (rv < 0) {
        const jimp = (-1.3 * rv) / (1 / ma + 1 / mb);
        a.vel.x -= (jimp / ma) * nx; a.vel.z -= (jimp / ma) * nz;
        b.vel.x += (jimp / mb) * nx; b.vel.z += (jimp / mb) * nz;
        const impact = -rv;
        if (impact > 5) {
          a.damage((impact - 5) * 1.1 * (mb / ma), b.driver);
          b.damage((impact - 5) * 1.1 * (ma / mb), a.driver);
          emit('vehicleCrash', a, b, impact);
          spawn('spark', (a.pos.x + b.pos.x) / 2, a.pos.y + 0.7, (a.pos.z + b.pos.z) / 2, 8, 2);
        }
      }
    }
  }
}
const PEN = { nx: 0, nz: 0, depth: 0 };
function obbPen(a, b) {
  const axes = [];
  for (const v of [a, b]) {
    const f = [Math.sin(v.heading), Math.cos(v.heading)];
    axes.push(f, [-f[1], f[0]]);
  }
  let best = Infinity, bn = null;
  const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
  for (const ax of axes) {
    const pa = projR(a, ax), pb = projR(b, ax);
    const d = dx * ax[0] + dz * ax[1];
    const o = pa + pb - Math.abs(d);
    if (o <= 0) return null;
    if (o < best) { best = o; bn = d < 0 ? [-ax[0], -ax[1]] : ax; }
  }
  PEN.nx = bn[0]; PEN.nz = bn[1]; PEN.depth = best;
  return PEN;
}
function projR(v, ax) {
  const s = v.spec;
  const hl = (v.kind === 'plane' ? s.len * 0.45 : s.len / 2), hw = v.kind === 'plane' ? s.wid * 0.3 : s.wid / 2;
  const f0 = Math.sin(v.heading), f1 = Math.cos(v.heading);
  return Math.abs(f0 * ax[0] + f1 * ax[1]) * hl + Math.abs(-f1 * ax[0] + f0 * ax[1]) * hw;
}
