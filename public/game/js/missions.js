// Missions, pickups, Pay 'n' Spray and stunt bonuses.
import * as THREE from 'three';
import { G, emit, on, rand } from './core.js';
import { groundHeight, SPECIAL, TOWNS, GANGS, CL, AIRPORT, LAKE } from './terrain.js';
import { Vehicle } from './vehicles.js';
import { Ped } from './characters.js';
import { notify, bigMessage, help, setObjective, blips } from './hud.js';
import { sfx } from './audio.js';
import { clearWanted, setWanted, wanted } from './police.js';
import { WEAPONS } from './weapons.js';

const markerMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
const markerGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0);
const ringGeo = new THREE.TorusGeometry(14, 1.1, 8, 32);
const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd23f });
function pp() {
  const P = G.player;
  return P.vehicle ? P.vehicle.pos : P.pos;
}

function makeMarker(x, z, r = 2, h = 3, color = 0xffd23f, y = null) {
  const m = new THREE.Mesh(markerGeo, markerMat.clone());
  m.material.color.setHex(color);
  m.scale.set(r, h, r);
  m.position.set(x, y ?? groundHeight(x, z), z);
  G.scene.add(m);
  return m;
}

// ---------------------------------------------------------------- pickups
const pickups = [];
const pkGeo = {
  weapon: new THREE.BoxGeometry(0.9, 0.35, 0.25),
  health: new THREE.BoxGeometry(0.6, 0.6, 0.6),
  armor: new THREE.CylinderGeometry(0.45, 0.45, 0.25, 12).rotateX(Math.PI / 2),
  cash: new THREE.BoxGeometry(0.5, 0.2, 0.3),
};
const pkMat = {
  weapon: new THREE.MeshBasicMaterial({ color: 0x9ccc65 }),
  health: new THREE.MeshBasicMaterial({ color: 0xef5350 }),
  armor: new THREE.MeshBasicMaterial({ color: 0x42a5f5 }),
  cash: new THREE.MeshBasicMaterial({ color: 0x66bb6a }),
};
function addPickup(kind, x, z, data = {}, respawn = 60) {
  const m = new THREE.Mesh(pkGeo[kind], pkMat[kind]);
  const y = groundHeight(x, z) + 1;
  m.position.set(x, y, z);
  G.scene.add(m);
  const p = { kind, x, z, y, m, data, respawn, t: 0, active: true };
  pickups.push(p);
  return p;
}
export function dropCash(x, z, amount) {
  const p = addPickup('cash', x + rand(-0.5, 0.5), z + rand(-0.5, 0.5), { amount }, 0);
  p.m.position.y -= 0.7;
  p.life = 30;
}

function setupPickups() {
  const S = SPECIAL;
  addPickup('weapon', 40, 30, { w: 'pistol', ammo: 36 });
  addPickup('weapon', CL[2] + 10, CL[3] + 9.5, { w: 'smg', ammo: 120 }); // Kingz turf alley
  addPickup('weapon', CL[13] + 50, CL[12] + 9.5, { w: 'shotgun', ammo: 24 }); // Vipers
  addPickup('weapon', S.police.spawnX, S.police.spawnZ + 10, { w: 'shotgun', ammo: 18 });
  addPickup('weapon', TOWNS[3].x - 20, TOWNS[3].z, { w: 'rifle', ammo: 150 });
  addPickup('weapon', 2140, 290, { w: 'rpg', ammo: 8 }); // airport hangars
  addPickup('weapon', TOWNS[0].x + 5, TOWNS[0].z + 5, { w: 'smg', ammo: 90 });
  addPickup('weapon', TOWNS[2].x, TOWNS[2].z - 15, { w: 'rifle', ammo: 90 });
  addPickup('health', S.hospital.spawnX + 6, S.hospital.spawnZ, {});
  addPickup('health', TOWNS[0].x - 10, TOWNS[0].z, {});
  addPickup('health', TOWNS[1].x, TOWNS[1].z, {});
  addPickup('health', LAKE.x + 210, LAKE.z, {});
  addPickup('armor', S.police.spawnX + 6, S.police.spawnZ + 10, {});
  addPickup('armor', TOWNS[2].x + 10, TOWNS[2].z, {});
  addPickup('armor', CL[8] + 50, CL[7] + 30, {});
  for (const p of pickups) if (p.kind !== 'cash') blips.push({ x: p.x, z: p.z, color: p.kind === 'weapon' ? '#9ccc65' : p.kind === 'health' ? '#ef5350' : '#42a5f5', size: 3, edge: false, pk: p });
}

function updatePickups(dt) {
  const P = G.player;
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    if (!p.active) {
      p.t -= dt;
      if (p.t <= 0) { p.active = true; p.m.visible = true; }
      continue;
    }
    p.m.rotation.y += dt * 2;
    if (p.kind !== 'cash') p.m.position.y = p.y + Math.sin(G.time * 3 + p.x) * 0.15;
    if (p.life !== undefined) {
      p.life -= dt;
      if (p.life <= 0) { G.scene.remove(p.m); pickups.splice(i, 1); continue; }
    }
    const pos = P.vehicle ? P.vehicle.pos : P.pos;
    if (P.dead || Math.abs(pos.x - p.x) > 2.2 || Math.abs(pos.z - p.z) > 2.2 || Math.abs(pos.y + 1 - p.m.position.y) > 2.5) continue;
    if (P.vehicle && p.kind !== 'cash') continue;
    let took = true;
    if (p.kind === 'weapon') {
      P.giveWeapon(p.data.w, p.data.ammo);
      notify(`Picked up ${WEAPONS[p.data.w].name} (+${p.data.ammo})`);
      sfx('pickup');
    } else if (p.kind === 'health') {
      if (P.health >= 100) took = false;
      else { P.health = 100; notify('Health restored'); sfx('pickup'); }
    } else if (p.kind === 'armor') {
      if (P.armor >= 100) took = false;
      else { P.armor = 100; notify('Body armor equipped'); sfx('pickup'); }
    } else if (p.kind === 'cash') {
      P.money += p.data.amount;
      sfx('cash');
    }
    if (!took) continue;
    if (p.respawn > 0) { p.active = false; p.m.visible = false; p.t = p.respawn; }
    else { G.scene.remove(p.m); pickups.splice(i, 1); }
  }
}

on('pedKilled', (p, by) => {
  if (p === G.player) return;
  const amt = p.type === 'gang' ? Math.floor(rand(40, 120)) : p.type === 'cop' ? Math.floor(rand(20, 60)) : Math.floor(rand(5, 60));
  dropCash(p.pos.x, p.pos.z, amt);
  if (p.type === 'gang' && Math.random() < 0.4) {
    const pk = addPickup('weapon', p.pos.x + 0.8, p.pos.z, { w: p.weapon || 'pistol', ammo: p.weapon === 'smg' ? 40 : 12 }, 0);
    pk.life = 30;
  }
  if (p.type === 'cop' && Math.random() < 0.5) {
    const pk = addPickup('weapon', p.pos.x + 0.8, p.pos.z, { w: p.weapon || 'pistol', ammo: 15 }, 0);
    pk.life = 30;
  }
});

// ---------------------------------------------------------------- stunts & spray
on('landed', (v, air) => {
  if (v.driver !== G.player || air < 1.4 || v.dead) return;
  const cash = Math.round(air * air * 40) * 5;
  G.player.money += cash;
  bigMessage(air > 3 ? 'INSANE STUNT BONUS' : 'STUNT BONUS', `${air.toFixed(1)}s air time · $${cash}`, '#7fd3ff', 2.5);
  sfx('cash');
});

let sprayCd = 0;
function updateSpray(dt) {
  sprayCd -= dt;
  const P = G.player, v = P.vehicle;
  const s = SPECIAL.spray;
  if (!v || v.kind !== 'car' && v.kind !== 'bike' || sprayCd > 0) return;
  if (v.pos.x > s.x0 && v.pos.x < s.x1 && v.pos.z > s.z0 && v.pos.z < s.z1 && v.speedAbs < 6) {
    sprayCd = 6;
    const needs = wanted.level > 0 || v.health < v.spec.hp;
    if (!needs) { help("Pay 'n' Spray: come back when you're hot or your ride is damaged.", 3); return; }
    if (P.money < 100) { notify("Pay 'n' Spray costs $100. You're broke."); return; }
    P.money -= 100;
    clearWanted();
    v.health = v.spec.hp;
    v.fireTimer = -1;
    const cols = [0x1565c0, 0x2e7d32, 0x6a1b9a, 0xf9a825, 0xc62828, 0x00838f, 0xfafafa];
    v.m.bodyMesh.material = v.m.bodyMesh.material.clone();
    v.m.bodyMesh.material.color.setHex(cols[Math.floor(Math.random() * cols.length)]);
    bigMessage('RESPRAYED', 'Wanted level cleared · $100', '#ffb300', 2.5);
    sfx('cash');
  }
}

// ---------------------------------------------------------------- missions
const MISSIONS = [];
let active = null;
let mT = 0;
const missionMarkers = [];

function defineMissions() {
  MISSIONS.push({
    id: 'race',
    title: 'Downtown Dash',
    giver: { x: 50, z: -82 },
    reward: 1500,
    desc: 'Street race. Hit every checkpoint before the clock runs out.',
    start(m) {
      m.cps = [[100, -150], [300, -200], [400, 0], [300, 300], [-100, 400], [-300, 200], [-500, 0], [-300, -300], [0, -400], [100, -100]].map(([x, z]) => ({ x, z }));
      m.i = 0;
      m.time = 105;
      if (!G.player.vehicle) {
        const v = new Vehicle('sports', m.giver.x - 3, m.giver.z + 2, 0, 0x00b0ff);
        v.lastPlayerUse = true;
        help('Get in the car (<b>F</b>) and drive through the checkpoints!', 5);
      }
      this.showCp(m);
    },
    showCp(m) {
      if (m.marker) G.scene.remove(m.marker);
      const c = m.cps[m.i];
      m.marker = makeMarker(c.x, c.z, 7, 12, 0xffd23f);
      m.blip = { x: c.x, z: c.z, color: '#ffd23f', size: 6 };
      blips.push(m.blip);
    },
    update(m, dt) {
      if (G.player.vehicle) m.time -= dt;
      const c = m.cps[m.i];
      setObjective(`<b>Downtown Dash</b> · checkpoint ${m.i + 1}/${m.cps.length} · <span class="timer">${m.time.toFixed(1)}s</span>`);
      if (m.time <= 0) return fail('Out of time!');
      const p = pp();
      if (G.player.vehicle && Math.hypot(p.x - c.x, p.z - c.z) < 9) {
        sfx('checkpoint');
        blips.splice(blips.indexOf(m.blip), 1);
        m.i++;
        if (m.i >= m.cps.length) return pass();
        this.showCp(m);
      }
    },
    cleanup(m) {
      if (m.marker) G.scene.remove(m.marker);
      if (m.blip && blips.includes(m.blip)) blips.splice(blips.indexOf(m.blip), 1);
    },
  });
  MISSIONS.push({
    id: 'steal',
    title: 'Hot Property',
    giver: { x: CL[13] + 9.5, z: CL[7] + 40 },
    reward: 2500,
    desc: "A collector wants the gold coupe parked at Coral Beach. Bring it to the Pay 'n' Spray in one piece.",
    start(m) {
      const t = TOWNS[1];
      m.car = new Vehicle('sports', t.x + 40, t.z - 80, 1.2, 0xd4af37);
      m.car.persist = true;
      m.stage = 0;
      m.blip = { x: m.car.pos.x, z: m.car.pos.z, color: '#4fc3f7', size: 6 };
      blips.push(m.blip);
    },
    update(m) {
      const v = m.car;
      if (v.dead) return fail('The coupe was destroyed!');
      m.blip.x = v.pos.x;
      m.blip.z = v.pos.z;
      if (m.stage === 0) {
        setObjective('<b>Hot Property</b> · Steal the <span class="hl">gold coupe</span> at Coral Beach');
        if (G.player.vehicle === v) {
          m.stage = 1;
          setWanted(Math.max(wanted.level, 2));
          notify('The owner called the cops!');
          const s = SPECIAL.spray;
          m.dest = makeMarker(s.x, s.z, 6, 6, 0x4fc3f7);
          m.blip.hidden = true;
          m.dblip = { x: s.x, z: s.z, color: '#4fc3f7', size: 6 };
          blips.push(m.dblip);
        }
      } else {
        const hp = Math.round((v.health / v.spec.hp) * 100);
        setObjective(`<b>Hot Property</b> · Deliver the coupe to the <span class="hl">garage</span> · condition ${hp}%`);
        if (hp < 35) return fail('The coupe is wrecked. The collector walks.');
        if (G.player.vehicle !== v) { m.blip.hidden = false; return; }
        m.blip.hidden = true;
        const s = SPECIAL.spray;
        if (Math.hypot(v.pos.x - s.x, v.pos.z - s.z) < 8 && v.speedAbs < 5) {
          clearWanted();
          return pass(Math.round(m.def.reward * (0.5 + hp / 200)));
        }
      }
    },
    cleanup(m) {
      if (m.dest) G.scene.remove(m.dest);
      for (const b of [m.blip, m.dblip]) if (b && blips.includes(b)) blips.splice(blips.indexOf(b), 1);
      if (m.car) { m.car.persist = false; m.car.lastPlayerUse = true; }
    },
  });
  MISSIONS.push({
    id: 'turf',
    title: 'Turf War',
    giver: { x: CL[5] + 9.5, z: CL[3] + 50 },
    reward: 3000,
    desc: 'The Purple Kingz have been squeezing the Riverside shops. Take out 10 of them.',
    start(m) {
      m.kills = 0;
      m.need = 10;
      const g = GANGS[0];
      g.hostile = 999;
      G.player.giveWeapon('smg', 90);
      notify('Got you an SMG. Go.');
      m.off = on('pedKilled', (p, by) => {
        if (active === m && by === G.player && p.gang === g) m.kills++;
      });
    },
    update(m) {
      GANGS[0].hostile = Math.max(GANGS[0].hostile, 30);
      setObjective(`<b>Turf War</b> · Purple Kingz eliminated: ${m.kills}/${m.need}`);
      if (m.kills >= m.need) pass();
    },
    cleanup() {
      GANGS[0].hostile = 20;
    },
  });
  MISSIONS.push({
    id: 'rings',
    title: 'Sky High',
    giver: { x: 1215, z: -80 },
    reward: 4000,
    desc: 'Take a stunt plane up and fly through every ring over Ember Ridge.',
    start(m) {
      m.rings = [[1700, -120, 60], [1200, -700, 140], [600, -1300, 260], [100, -1900, 420], [-500, -2200, 460], [-900, -1500, 300], [-400, -800, 150], [400, -300, 90]].map(([x, z, y]) => ({ x, z, y }));
      m.i = 0;
      m.time = 240;
      help('Board a <b>stunt plane</b> at the west end of the runway (F). <b>W/S</b> throttle, <b>A/D</b> roll, <b>↑/↓</b> or <b>Shift/Space</b> pitch, <b>Q/E</b> rudder.', 8);
      this.showRing(m);
    },
    showRing(m) {
      if (m.ring) G.scene.remove(m.ring);
      const r = m.rings[m.i];
      const nxt = m.rings[Math.min(m.i + 1, m.rings.length - 1)];
      m.ring = new THREE.Mesh(ringGeo, ringMat);
      m.ring.position.set(r.x, r.y, r.z);
      m.ring.lookAt(nxt.x, nxt.y, nxt.z);
      G.scene.add(m.ring);
      if (m.blip) blips.splice(blips.indexOf(m.blip), 1);
      m.blip = { x: r.x, z: r.z, color: '#ffd23f', size: 6 };
      blips.push(m.blip);
    },
    update(m, dt) {
      const v = G.player.vehicle;
      if (v && v.kind === 'plane') m.time -= dt;
      setObjective(`<b>Sky High</b> · ring ${m.i + 1}/${m.rings.length} · <span class="timer">${Math.ceil(m.time)}s</span>`);
      if (m.time <= 0) return fail('Out of time!');
      if (!v || v.kind !== 'plane') return;
      const r = m.rings[m.i];
      if (v.pos.distanceTo(m.ring.position) < 16) {
        sfx('checkpoint');
        m.i++;
        if (m.i >= m.rings.length) return pass();
        this.showRing(m);
      }
      m.ring.rotation.z += 0;
      void r;
    },
    cleanup(m) {
      if (m.ring) G.scene.remove(m.ring);
      if (m.blip && blips.includes(m.blip)) blips.splice(blips.indexOf(m.blip), 1);
    },
  });
  MISSIONS.push({
    id: 'deliver',
    title: 'Desert Run',
    giver: { x: CL[16] - 9, z: CL[8] + 50 },
    reward: 2000,
    desc: 'Drive a box truck of "auto parts" to Sandy Rock before the rival crew intercepts it.',
    start(m) {
      m.truck = new Vehicle('truck', CL[16] + 12, CL[8] + 55, 0, 0xeceff1);
      m.truck.persist = true;
      m.time = 200;
      const t = TOWNS[0];
      m.dest = makeMarker(t.x + 40, t.z - 40, 6, 6, 0x4fc3f7);
      m.dpos = { x: t.x + 40, z: t.z - 40 };
      m.blip = { x: m.dpos.x, z: m.dpos.z, color: '#4fc3f7', size: 6 };
      blips.push(m.blip);
      m.chasers = 0;
    },
    update(m, dt) {
      const v = m.truck;
      if (v.dead) return fail('The cargo went up in flames!');
      if (G.player.vehicle === v) m.time -= dt;
      setObjective(`<b>Desert Run</b> · Get the truck to <span class="hl">Sandy Rock</span> · <span class="timer">${Math.ceil(m.time)}s</span>`);
      if (m.time <= 0) return fail('Too slow. The buyer left.');
      if (G.player.vehicle === v && m.chasers === 0 && Math.hypot(v.pos.x, v.pos.z) > 1100) {
        m.chasers = 1;
        notify('Rival crew on your tail!');
        setWanted(Math.max(wanted.level, 2));
      }
      if (G.player.vehicle === v && Math.hypot(v.pos.x - m.dpos.x, v.pos.z - m.dpos.z) < 9 && v.speedAbs < 5) pass();
    },
    cleanup(m) {
      if (m.dest) G.scene.remove(m.dest);
      if (m.blip && blips.includes(m.blip)) blips.splice(blips.indexOf(m.blip), 1);
      if (m.truck) { m.truck.persist = false; m.truck.lastPlayerUse = true; }
    },
  });
  for (const def of MISSIONS) {
    def.done = false;
    def.marker = makeMarker(def.giver.x, def.giver.z, 1.6, 2.6, 0xffd23f);
    def.blip = { x: def.giver.x, z: def.giver.z, color: '#ffd23f', size: 5, shape: 'sq' };
    blips.push(def.blip);
    missionMarkers.push(def);
  }
}

function startMission(def) {
  active = { def, giver: def.giver, t: 0 };
  for (const d of MISSIONS) { d.marker.visible = false; d.blip.hidden = true; }
  bigMessage(def.title.toUpperCase(), def.desc, '#ffd23f', 4.5);
  sfx('mission');
  def.start(active);
  active.def = def;
}
function endMission() {
  if (!active) return;
  active.def.cleanup(active);
  if (active.off) active.off();
  setObjective('');
  for (const d of MISSIONS) { d.marker.visible = true; d.blip.hidden = false; }
  active = null;
  mT = 3;
}
function pass(reward) {
  const def = active.def;
  const r = reward ?? def.reward;
  G.player.money += r;
  def.done = true;
  def.marker.material.color.setHex(0x9ccc65);
  def.blip.color = '#9ccc65';
  bigMessage('MISSION PASSED', `RESPECT + · $${r.toLocaleString()}`, '#f2c14e', 4);
  sfx('mission');
  endMission();
}
function fail(reason) {
  bigMessage('MISSION FAILED', reason, '#ef5350', 3.5);
  sfx('fail');
  endMission();
}
export function abortMission() {
  if (active) fail('You were taken off the job.');
}

export function updateMissions(dt) {
  updatePickups(dt);
  updateSpray(dt);
  for (const d of MISSIONS) {
    if (d.marker.visible) {
      d.marker.rotation.y += dt;
      d.marker.material.opacity = 0.3 + Math.sin(G.time * 3) * 0.1;
    }
  }
  if (active) {
    active.def.update(active, dt);
    return;
  }
  mT -= dt;
  if (mT > 0) return;
  const p = pp();
  for (const d of MISSIONS) {
    if (Math.hypot(p.x - d.giver.x, p.z - d.giver.z) < 2.5 && Math.abs(p.y - d.marker.position.y) < 3) {
      if (wanted.level > 0) { help('Lose the cops before starting a job.', 2); mT = 2; return; }
      startMission(d);
      return;
    }
  }
}

export function initMissions() {
  setupPickups();
  defineMissions();
  // labels for special places
  blips.push({ x: SPECIAL.hospital.x, z: SPECIAL.hospital.z, color: '#ef5350', size: 4, shape: 'sq', edge: false });
  blips.push({ x: SPECIAL.police.x, z: SPECIAL.police.z, color: '#42a5f5', size: 4, shape: 'sq', edge: false });
  blips.push({ x: SPECIAL.spray.x, z: SPECIAL.spray.z, color: '#ffb300', size: 4, shape: 'sq', edge: false });
  blips.push({ x: 1700, z: 110, color: '#b0bec5', size: 4, shape: 'sq', edge: false });
  void AIRPORT; void Ped; void emit;
}
