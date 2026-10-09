// The player character: on-foot control, entering/exiting vehicles, driving input, weapons.
import * as THREE from 'three';
import { G, clamp, emit, on, damp } from './core.js';
import { groundHeight, collideCircle } from './terrain.js';
import { Ped, randomLook, COP_LOOK } from './characters.js';
import { WEAPONS, WEAPON_ORDER, playerShoot } from './weapons.js';
import { sfx } from './audio.js';

const PLAYER_LOOK = { skin: 0x8d5524, shirt: 0xf5f5f5, pants: 0x2b4a7a, hair: 0x111111 };
const _m = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class Player extends Ped {
  constructor(x, z) {
    super(x, z, 'player', PLAYER_LOOK);
    this.persist = true;
    this.state = 'player';
    this.money = 500;
    this.armor = 0;
    this.weapon = 'pistol';
    this.ammo = { fist: Infinity, pistol: 60, smg: 0, shotgun: 0, rifle: 0, rpg: 0 };
    this.clip = { fist: Infinity, pistol: 12, smg: 0, shotgun: 0, rifle: 0, rpg: 0 };
    this.reloadT = 0;
    this.fireT = 0;
    this.aiming = false;
    this.lastVehicle = null;
  }

  reset(x, z) {
    this.dead = false;
    this.health = 100;
    this.ragdoll = 0;
    this.pos.set(x, groundHeight(x, z) + 0.1, z);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.vehicle = null;
    this.root.visible = true;
    this.sitting = false;
    this.root.rotation.set(0, 0, 0);
  }

  hurt(amount, attacker = null, force = null) {
    if (this.dead || G.state !== 'play') return;
    if (this.vehicle && !force) {
      // shielded by the vehicle body somewhat
      amount *= 0.6;
    }
    if (this.armor > 0) {
      const a = Math.min(this.armor, amount * 0.75);
      this.armor -= a;
      amount -= a;
    }
    G.hurtFlash = Math.min(1, (G.hurtFlash || 0) + amount / 30);
    super.hurt(amount, attacker, this.vehicle ? null : force);
  }

  die(attacker) {
    super.die(attacker);
    if (this.vehicle) {
      this.vehicle.driver = null;
      this.vehicle = null;
      this.root.visible = true;
      this.sitting = false;
    }
    emit('wasted');
  }

  muzzle() {
    if (this.vehicle) {
      const v = this.vehicle;
      _m.set(v.pos.x - Math.cos(v.heading) * 0.6, v.pos.y + (v.spec.seatY || 1) + 0.6, v.pos.z + Math.sin(v.heading) * 0.6);
      return _m;
    }
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    _m.set(this.pos.x + fx * 0.75 - fz * 0.34, this.pos.y + 1.45, this.pos.z + fz * 0.75 + fx * 0.34);
    return _m;
  }

  reload() {
    const w = this.weapon;
    const W = WEAPONS[w];
    if (W.melee || this.reloadT > 0) return;
    if (this.clip[w] >= W.mag || this.ammo[w] <= this.clip[w]) return;
    this.reloadT = W.projectile ? 1.2 : 1.0;
    sfx('reload');
  }

  owned() {
    return WEAPON_ORDER.filter((w) => this.ammo[w] > 0);
  }
  cycleWeapon(dir) {
    const o = this.owned();
    let i = o.indexOf(this.weapon);
    i = (i + dir + o.length) % o.length;
    this.weapon = o[i];
    this.reloadT = 0;
    sfx('weapon_switch');
  }
  giveWeapon(w, ammo) {
    const W = WEAPONS[w];
    const had = this.ammo[w] > 0;
    this.ammo[w] = (this.ammo[w] || 0) + ammo;
    if (!had) {
      this.clip[w] = Math.min(W.mag, this.ammo[w]);
      this.weapon = w;
    }
  }

  update(dt) {
    this.fireT -= dt;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const w = this.weapon, W = WEAPONS[w];
        this.clip[w] = Math.min(W.mag, this.ammo[w]);
      }
    }
    if (this.dead) {
      this.deadT += dt;
      this.vel.multiplyScalar(this.onGround ? Math.max(0, 1 - 6 * dt) : 1);
      this.physics(dt);
      this.animate(dt);
      return;
    }
    const P = G.pressed;
    // weapon switching
    for (let i = 0; i < WEAPON_ORDER.length; i++) {
      if (P['Digit' + (i + 1)] && this.ammo[WEAPON_ORDER[i]] > 0) { this.weapon = WEAPON_ORDER[i]; this.reloadT = 0; }
    }
    if (G.mouse.wheel) {
      this.cycleWeapon(G.mouse.wheel > 0 ? 1 : -1);
      G.mouse.wheel = 0;
    }
    if (P.KeyR) this.reload();
    if (this.vehicle) this.vehicleControl(dt);
    else this.footControl(dt);
  }

  tryShoot(aimDir) {
    const W = WEAPONS[this.weapon];
    const want = G.mouse.left && (W.auto || G.mouse.leftPressed);
    if (!want || this.fireT > 0 || this.reloadT > 0) return false;
    this.fireT = 1 / W.rate;
    const cam = G.camera.position;
    return playerShoot(this, cam, aimDir);
  }

  footControl(dt) {
    const K = G.keys;
    if (this.ragdoll > 0) {
      this.ragdoll -= dt;
      if (this.onGround) this.vel.multiplyScalar(Math.max(0, 1 - 5 * dt));
      this.physics(dt);
      this.animate(dt);
      return;
    }
    const ix = (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0);
    const iz = (K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0);
    const fx = Math.sin(G.camYaw), fz = Math.cos(G.camYaw);
    const dx = fx * iz - fz * ix, dz = fz * iz + fx * ix;
    const W = WEAPONS[this.weapon];
    this.aiming = G.mouse.right && !W.melee;
    let speed = K.ShiftLeft || K.ShiftRight ? 7.8 : 4.4;
    if (this.swim) speed = 2.6;
    if (this.aiming) speed = 3;
    this.move(dt, dx, dz, ix || iz ? speed : 0);
    G.camera.getWorldDirection(_dir);
    const shooting = G.mouse.left && !W.melee;
    if (this.aiming || shooting) {
      this.heading = G.camYaw;
      this.aim = true;
      this.aimPitch = Math.asin(clamp(_dir.y, -1, 1));
    } else this.aim = false;
    this.setWeaponVisible(!W.melee);
    if (G.pressed.Space && this.onGround && !this.swim) {
      this.vy = 7.2;
      this.onGround = false;
      sfx('jump');
    }
    if (!this.swim) this.tryShoot(_dir);
    if (G.pressed.KeyF) this.tryEnter();
    this.animate(dt);
  }

  tryEnter() {
    let best = null, bd = Infinity;
    for (const v of G.vehicles) {
      if (v.dead || v.drowned > 2) continue;
      const d = Math.hypot(v.pos.x - this.pos.x, v.pos.z - this.pos.z) - v.radius;
      const reach = v.kind === 'plane' ? 4 : 3.2;
      if (d < reach && d < bd && Math.abs(v.pos.y - this.pos.y) < 3.5) { bd = d; best = v; }
    }
    if (best) this.enterVehicle(best);
  }

  enterVehicle(v) {
    if (v.driver && v.driver !== this) {
      const d = v.driver;
      const ox = Math.cos(v.heading) * (v.spec.wid / 2 + 1), oz = -Math.sin(v.heading) * (v.spec.wid / 2 + 1);
      if (d.npc && v.kind !== 'heli') {
        const ped = new Ped(v.pos.x + ox, v.pos.z + oz, d.cop ? 'cop' : 'civ', d.cop ? COP_LOOK : randomLook());
        if (d.cop) ped.provoked = true;
        else ped.scare(this.pos.x, this.pos.z);
        ped.hurt(5, this, { x: ox * 2, y: 2, z: oz * 2 });
      }
      emit('carjack', v);
      G.stats.carsStolen++;
    } else if (v.parked || v.isPolice) {
      if (v.isPolice) emit('carjack', v);
    }
    v.driver = this;
    v.ai = null;
    v.aiVel = null;
    v.parked = false;
    v.lastPlayerUse = true;
    v.siren = false;
    this.vehicle = v;
    this.lastVehicle = v;
    this.root.visible = v.kind === 'bike';
    this.sitting = v.kind === 'bike';
    this.aim = false;
    G.camYaw = v.heading;
    sfx('door');
    emit('enterVehicle', v);
  }

  exitVehicle(force = false) {
    const v = this.vehicle;
    if (!v) return;
    const sp = v.speedAbs;
    const side = v.kind === 'bike' ? 0.9 : v.spec.wid / 2 + 0.7;
    let x = v.pos.x + Math.cos(v.heading) * side, z = v.pos.z - Math.sin(v.heading) * side;
    const c = collideCircle(x, z, 0.4, v.pos.y + 0.2, 1.7);
    if (c.hit) { x = v.pos.x - Math.cos(v.heading) * side; z = v.pos.z + Math.sin(v.heading) * side; }
    if (v.kind === 'plane') { x = v.pos.x + Math.cos(v.heading) * 3; z = v.pos.z - Math.sin(v.heading) * 3; }
    this.pos.set(x, Math.max(v.pos.y + 0.3, groundHeight(x, z, v.pos.y + 1)), z);
    this.vel.set(v.vel.x * 0.6, 0, v.vel.z * 0.6);
    this.vy = 0;
    this.onGround = false;
    v.driver = null;
    v.input.throttle = 0;
    v.input.steer = 0;
    this.vehicle = null;
    this.root.visible = true;
    this.sitting = false;
    this.heading = v.heading;
    if (sp > 10 && (v.kind === 'car' || v.kind === 'bike')) {
      this.ragdoll = 1.5;
      this.spinX = 6;
      this.hurt(Math.min(40, (sp - 10) * 2), null);
    }
    sfx('door');
    emit('exitVehicle', v, force);
  }

  vehicleControl(dt) {
    const v = this.vehicle;
    const K = G.keys, I = v.input;
    const W = (K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0);
    const A = (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0);
    if (v.kind === 'car' || v.kind === 'bike' || v.kind === 'boat') {
      I.throttle = W;
      I.steer = A;
      I.handbrake = !!K.Space;
    } else if (v.kind === 'heli') {
      I.throttle = W;
      I.steer = A;
      I.lift = (K.Space ? 1 : 0) - (K.ShiftLeft || K.ShiftRight ? 1 : 0);
      I.strafe = (K.KeyE ? 1 : 0) - (K.KeyQ ? 1 : 0);
    } else if (v.kind === 'plane') {
      I.throttle = W;
      I.roll = A;
      I.pitch = (K.ArrowDown || K.Space ? 1 : 0) - (K.ArrowUp || K.ShiftLeft || K.ShiftRight ? 1 : 0);
      I.yaw = (K.KeyE ? 1 : 0) - (K.KeyQ ? 1 : 0);
    }
    if (G.pressed.KeyH) sfx('horn', v.pos);
    this.pos.copy(v.pos);
    this.vel.copy(v.vel);
    this.heading = v.heading;
    // drive-by
    const Wp = WEAPONS[this.weapon];
    if (!Wp.melee && (v.kind === 'car' || v.kind === 'bike' || v.kind === 'boat' || v.kind === 'heli')) {
      G.camera.getWorldDirection(_dir);
      this.tryShoot(_dir);
    }
    if (v.kind === 'bike') {
      const r = this.root;
      r.position.set(v.pos.x - Math.sin(v.heading) * 0.25, v.pos.y + 0.05, v.pos.z - Math.cos(v.heading) * 0.25);
      r.rotation.set(-v.pitch, v.heading, v.roll, 'YXZ');
      this.sitting = true;
      this.m.pose({ sit: true, legL: 1.3, legR: 1.3, kneeL: 1.5, kneeR: 1.5, armL: 1.1, armR: 1.1, lean: 0.35 });
      this.setWeaponVisible(false);
    }
    if (v.dead || v.drowned > 0.4) {
      if (v.dead && v.kind !== 'boat') this.hurt(999, v.lastHitBy);
      else this.exitVehicle(true);
      return;
    }
    if (G.pressed.KeyF) this.exitVehicle();
  }
}

on('vehicleImpact', (v, impact) => {
  const P = G.player;
  if (v.driver !== P) return;
  sfx('crash', v.pos);
  G.shake = Math.max(G.shake, Math.min(0.6, impact / 25));
  if (v.kind === 'bike' && impact > 10) {
    P.exitVehicle(true);
    P.vel.set(Math.sin(v.heading) * impact * 0.7, 0, Math.cos(v.heading) * impact * 0.7);
    P.vy = 5;
    P.ragdoll = 2;
    P.spinX = 8;
    P.hurt(impact * 1.5, null);
  }
});
on('vehicleCrash', (a, b, impact) => {
  const P = G.player;
  if (a.driver === P || b.driver === P) {
    sfx('crash', a.pos);
    G.shake = Math.max(G.shake, Math.min(0.5, impact / 25));
    const v = a.driver === P ? a : b;
    if (v.kind === 'bike' && impact > 9) {
      P.exitVehicle(true);
      P.vy = 6;
      P.ragdoll = 2;
      P.spinX = 8;
      P.hurt(impact * 1.5, null);
    }
  }
});
void damp;
