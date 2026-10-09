// Multiplayer: everyone who has the game open shares the island.
// Each client simulates its own traffic, police and pedestrians; what travels
// between clients is each player's position, vehicle, health and gunfire.
// Transport: the claude.ai artifact "room" when the page is published there,
// otherwise a BroadcastChannel so several tabs of the same browser can play.
import * as THREE from 'three';
import { G, on, angWrap } from './core.js';
import { Ped } from './characters.js';
import { buildVehicleMesh, VSPEC } from './models.js';
import { spawn, tracer, explosionFx } from './fx.js';
import { sfx } from './audio.js';
import { blips, notify } from './hud.js';
import { WEAPONS } from './weapons.js';

const COLORS = [0xe53935, 0x1e88e5, 0x43a047, 0xfdd835, 0x8e24aa, 0xfb8c00, 0x00acc1, 0xd81b60, 0x6d4c41, 0x3949ab];
const css = (c) => '#' + c.toString(16).padStart(6, '0');
const SEND_HZ = 12;
const myColor = COLORS[Math.floor(Math.random() * COLORS.length)];
const myTag = 'Player ' + Math.floor(1000 + Math.random() * 9000);

export const remotes = new Map(); // peer -> RemotePlayer
G.ghosts = []; // remote players' vehicles, for hitscan
let tx = null; // transport
let myPeer = null;
let userApi = null;

// ---------------------------------------------------------------- transports
async function roomTransport() {
  if (!window.claude || !window.claude.use) return null;
  const room = await window.claude.use('room');
  if (!room) return null;
  userApi = await window.claude.use('user');
  const t = {
    kind: 'room',
    presence: (s) => room.presence({ s }).catch(() => {}),
    emit: (topic, data) => room.emit(topic, data).catch(() => {}),
    on: (topic, fn) => room.on(topic, (m) => { if (!m.sameTab) fn(m.data, m.peer, m); }),
    connected: () => room.connected(),
  };
  room.onPeers((ch) => {
    for (const p of ch.peers) if (p.sameTab) myPeer = p.peer;
    for (const p of ch.left) dropRemote(p.peer);
    for (const p of [...ch.joined, ...ch.updated]) {
      if (p.sameTab || p.kind !== 'viewer') continue;
      if (p.presence && p.presence.s) upsertRemote(p.peer, p.presence.s, p.by);
    }
  });
  return t;
}

function channelTransport() {
  if (typeof BroadcastChannel === 'undefined') return null;
  const bc = new BroadcastChannel('crimson-coast-mp');
  myPeer = Math.random().toString(36).slice(2, 10);
  const handlers = {};
  const seen = new Map();
  bc.onmessage = (e) => {
    const m = e.data;
    if (!m || m.from === myPeer) return;
    if (m.t === 'p') { seen.set(m.from, performance.now()); upsertRemote(m.from, m.s, null); }
    else if (m.t === 'bye') dropRemote(m.from);
    else if (m.t === 'e') (handlers[m.topic] || []).forEach((fn) => fn(m.data, m.from, {}));
  };
  let checkT = performance.now();
  setInterval(() => {
    const now = performance.now();
    // if this tab itself was frozen, queued messages haven't been read yet; don't drop anyone
    const frozen = now - checkT > 3000;
    checkT = now;
    if (!frozen) for (const [p, t] of seen) if (now - t > 6000) { seen.delete(p); dropRemote(p); }
    // background tabs stop animating; keep announcing ourselves
    if (last && now - lastT > 1000) post(last);
  }, 1000);
  addEventListener('pagehide', () => bc.postMessage({ t: 'bye', from: myPeer }));
  let last = null, lastT = 0;
  function post(s) { last = s; lastT = performance.now(); bc.postMessage({ t: 'p', from: myPeer, s }); }
  return {
    kind: 'local',
    presence: post,
    emit: (topic, data) => bc.postMessage({ t: 'e', from: myPeer, topic, data }),
    on: (topic, fn) => (handlers[topic] = handlers[topic] || []).push(fn),
    connected: () => true,
  };
}

// ---------------------------------------------------------------- remote players
// name labels are HTML positioned over the canvas (canvas textures have crashed some GPUs)
const _proj = new THREE.Vector3();
function nameLabel(color) {
  const el = document.createElement('div');
  el.className = 'nametag outline';
  el.style.color = css(color);
  (document.getElementById('nametags') || document.body).appendChild(el);
  return el;
}

class RemotePlayer extends Ped {
  constructor(peer, s) {
    super(s.p[0], s.p[2], 'remote', { skin: s.sk ?? 0x8d5524, shirt: s.c ?? 0xffffff, pants: 0x2b4a7a, hair: 0x111111 });
    this.peer = peer;
    this.persist = true;
    this.state = 'remote';
    this.health = 100;
    this.color = s.c ?? 0xffffff;
    this.name = s.n || 'Player';
    this.tag = nameLabel(this.color);
    this.setName(this.name);
    this.ghost = null;
    this.ghostType = null;
    this.target = new THREE.Vector3(s.p[0], s.p[1], s.p[2]);
    this.tvel = new THREE.Vector3();
    this.recvT = performance.now();
    this.pos.copy(this.target);
    this.blip = { x: this.pos.x, z: this.pos.z, color: css(this.color), size: 4, edge: true };
    blips.push(this.blip);
    this.s = s;
  }

  setName(n) {
    this.name = n;
    this.tag.textContent = n;
  }

  placeTag() {
    const cam = G.camera;
    const y = this.ghost && this.ghost.kind !== 'bike' ? (this.ghost.spec.height || 1.6) + 0.9 : 2.3;
    _proj.set(this.pos.x, this.pos.y + y, this.pos.z);
    const d = _proj.distanceTo(cam.position);
    _proj.project(cam);
    const show = G.state === 'play' && d < 300 && _proj.z < 1 && Math.abs(_proj.x) < 1.1 && Math.abs(_proj.y) < 1.1;
    this.tag.style.display = show ? '' : 'none';
    if (!show) return;
    this.tag.style.transform = `translate(${((_proj.x + 1) / 2) * innerWidth}px, ${((1 - _proj.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
    this.tag.style.opacity = d < 120 ? 1 : 1 - (d - 120) / 180;
  }

  apply(s) {
    this.s = s;
    if (s.n && s.n !== this.name && !this.resolvedName) this.setName(s.n);
    this.target.set(s.p[0], s.p[1], s.p[2]);
    this.tvel.set(s.u[0], s.u[1], s.u[2]);
    this.recvT = performance.now();
    this.health = s.h;
    if (s.d && !this.dead) { this.dead = true; this.deadT = 0; this.m.setGun(false); }
    if (!s.d && this.dead) { this.dead = false; this.pos.copy(this.target); }
    const vt = s.v && VSPEC[s.v[0]] ? s.v[0] : null;
    if (vt !== this.ghostType || (this.ghost && s.v[1] !== this.ghost.color)) this.setVehicle(vt, s.v && s.v[1]);
  }

  setVehicle(type, color) {
    if (this.ghost) {
      G.scene.remove(this.ghost.root);
      G.ghosts.splice(G.ghosts.indexOf(this.ghost), 1);
      this.ghost = null;
    }
    this.ghostType = type;
    this.vehicle = null;
    this.root.visible = true;
    if (!type) return;
    const m = buildVehicleMesh(type, color);
    m.root.rotation.order = 'YXZ';
    const spec = VSPEC[type];
    const owner = this;
    this.ghost = {
      root: m.root, m, spec, kind: spec.kind, type, color, pos: this.pos.clone(), heading: 0, owner,
      // bullets that hit a remote player's vehicle hurt the player through it
      damage(amount, by) { owner.hurt(amount * 0.5, by); },
    };
    G.scene.add(m.root);
    G.ghosts.push(this.ghost);
    // a truthy vehicle keeps NPC code from treating this player as a pedestrian
    this.vehicle = this.ghost;
    this.root.visible = spec.kind === 'bike';
  }

  hurt(amount, attacker = null) {
    if (this.dead) return;
    spawn('blood', this.pos.x, this.pos.y + 1.2, this.pos.z, 6, 0.6, 0, 2, 0);
    // only damage dealt by this client's player is reported; the victim's client owns their health
    if (attacker === G.player) pendingHits.set(this.peer, (pendingHits.get(this.peer) || 0) + amount);
  }

  update(dt) {
    this.updateBody(dt);
    this.placeTag();
  }

  updateBody(dt) {
    const s = this.s;
    const lag = Math.min(0.5, (performance.now() - this.recvT) / 1000);
    const tx = this.target.x + this.tvel.x * lag, ty = this.target.y + this.tvel.y * lag, tz = this.target.z + this.tvel.z * lag;
    const far = Math.hypot(tx - this.pos.x, tz - this.pos.z) > 25;
    const k = far ? 1 : 1 - Math.exp(-12 * dt);
    this.pos.x += (tx - this.pos.x) * k;
    this.pos.y += (ty - this.pos.y) * k;
    this.pos.z += (tz - this.pos.z) * k;
    this.vel.set(this.tvel.x, 0, this.tvel.z);
    this.heading += angWrap(s.p[3] - this.heading) * k;
    this.blip.x = this.pos.x;
    this.blip.z = this.pos.z;
    if (this.ghost) {
      const gh = this.ghost;
      gh.pos.copy(this.pos);
      gh.heading = this.heading;
      gh.root.position.copy(this.pos);
      gh.root.rotation.set(-(s.p[4] || 0), this.heading, s.p[5] || 0, 'YXZ');
      if (gh.m.rotor) gh.m.rotor.rotation.y += 30 * dt;
      if (gh.m.tail) gh.m.tail.rotation.x += 40 * dt;
      if (gh.m.prop) gh.m.prop.rotation.z += 40 * dt;
      if (gh.m.propBone) gh.m.propBone.rotateY(40 * dt);
      gh.m.siren.forEach((b, i) => (b.visible = !!s.si && Math.floor(G.time * 4 + i) % 2 === 0));
      if (gh.kind === 'bike') {
        this.sitting = true;
        this.animate(0);
        this.root.position.y = this.pos.y + (gh.spec.seatY || 0.6) - 0.55;
      }
      return;
    }
    this.sitting = false;
    this.onGround = !s.air;
    this.swim = !!s.sw;
    this.waterY = this.pos.y + 1.25;
    this.aim = !!s.a;
    this.aimPitch = s.ap || 0;
    if (s.w !== this.shownWeapon) { this.shownWeapon = s.w; this.m.setGun(!!s.w && s.w !== 'fist'); }
    this.animate(dt);
  }

  remove() {
    this.setVehicle(null);
    this.tag.remove();
    const i = blips.indexOf(this.blip);
    if (i >= 0) blips.splice(i, 1);
    super.remove();
  }
}

function upsertRemote(peer, s, by) {
  if (!s || !Array.isArray(s.p) || s.p.length < 4 || !s.p.every(Number.isFinite)) return;
  if (!G.scene || !G.player) return;
  let r = remotes.get(peer);
  if (!r) {
    r = new RemotePlayer(peer, s);
    remotes.set(peer, r);
    resolveName(r, by);
    if (G.state === 'play') notify(`${r.name} joined the game`);
    updateCount();
  }
  r.apply(s);
}

async function resolveName(r, by) {
  if (!by || !userApi || !userApi.profiles) return;
  try {
    const ps = await userApi.profiles([by]);
    const n = ps && ps[by] && ps[by].name;
    if (n && !r.removed) { r.resolvedName = true; r.setName(n.split(' ')[0]); }
  } catch (e) { /* keep the callsign */ }
}

function dropRemote(peer) {
  const r = remotes.get(peer);
  if (!r) return;
  remotes.delete(peer);
  r.remove();
  if (G.state === 'play') notify(`${r.name} left the game`);
  updateCount();
}

function updateCount() {
  const el = document.getElementById('netcount');
  if (!el) return;
  const n = remotes.size;
  el.hidden = !tx;
  el.textContent = n ? `${n + 1} players online` : tx && tx.kind === 'room' ? 'Online · waiting for players' : 'Online · open another tab to play together';
}

// ---------------------------------------------------------------- outgoing
const pendingHits = new Map();
let sendT = 0, shotT = 0, hitT = 0;
let lastShot = null;
let lastRemoteHit = null;
const r2 = (v) => Math.round(v * 100) / 100;

function snapshot() {
  const P = G.player;
  const v = P.vehicle;
  const src = v || P;
  const vel = v ? v.vel : P.vel;
  const s = {
    n: myTag,
    c: myColor,
    p: [r2(src.pos.x), r2(src.pos.y), r2(src.pos.z), r2(v ? v.heading : P.heading), r2(v ? v.pitch || 0 : 0), r2(v ? v.roll || 0 : 0)],
    u: [r2(vel.x), r2(v ? v.vy || vel.y || 0 : P.vy || 0), r2(vel.z)],
    h: Math.max(0, Math.round(P.health)),
    w: P.weapon,
  };
  if (v) {
    s.v = [v.type, v.color];
    if (v.kind === 'plane') {
      // planes rotate by quaternion; send the equivalent euler angles
      const e = new THREE.Euler().setFromQuaternion(v.q, 'YXZ');
      s.p[3] = r2(e.y); s.p[4] = r2(-e.x); s.p[5] = r2(e.z);
    }
    if (v.siren) s.si = 1;
  }
  if (P.dead) s.d = 1;
  if (!v) {
    if (P.aiming) { s.a = 1; s.ap = r2(P.aimPitch || 0); }
    if (!P.onGround) s.air = 1;
    if (P.swim) s.sw = 1;
  }
  return s;
}

function tick(dt) {
  if (!tx || !G.player) return;
  const now = performance.now();
  if (now - sendT >= 1000 / SEND_HZ && G.state !== 'menu' && G.state !== 'loading') {
    sendT = now;
    tx.presence(snapshot());
  }
  shotT -= dt;
  if (lastShot && shotT <= 0) {
    shotT = 0.1;
    tx.emit('shot', lastShot);
    lastShot = null;
  }
  // hits are batched so automatic fire stays inside the room's message budget
  if (pendingHits.size && now - hitT >= 100) {
    hitT = now;
    for (const [peer, d] of pendingHits) tx.emit('hit', { to: peer, d: Math.round(d) });
    pendingHits.clear();
  }
}

// ---------------------------------------------------------------- incoming
function wire() {
  tx.on('hit', (d, from) => {
    if (!d || d.to !== myPeer || !Number.isFinite(d.d)) return;
    const r = remotes.get(from);
    const P = G.player;
    if (!P || P.dead || G.state !== 'play') return;
    if (r) lastRemoteHit = { peer: from, t: G.time };
    P.hurt(Math.min(400, Math.max(0, d.d)), r || null);
  });
  tx.on('shot', (d, from) => {
    const r = remotes.get(from);
    if (!r || !d || !Array.isArray(d.e) || !Array.isArray(d.o)) return;
    const [ox, oy, oz] = d.o, [ex, ey, ez] = d.e;
    if (![ox, oy, oz, ex, ey, ez].every(Number.isFinite)) return;
    tracer(ox, oy, oz, ex, ey, ez);
    spawn('muzzle', ox, oy, oz, 2, 0.1);
    const W = WEAPONS[d.w];
    sfx(W ? W.sound : 'pistol', { x: ox, y: oy, z: oz });
    r.punchT = d.w === 'fist' ? 0.25 : 0;
  });
  tx.on('boom', (d) => {
    if (!d || ![d.x, d.y, d.z].every(Number.isFinite)) return;
    explosionFx(d.x, d.y, d.z, 1);
    sfx('explosion', new THREE.Vector3(d.x, d.y, d.z));
  });
  tx.on('died', (d, from) => {
    const r = remotes.get(from);
    if (!r) return;
    if (d && d.by === myPeer) {
      G.stats.kills++;
      notify(`You wasted ${r.name}`);
    } else {
      const k = d && d.by && remotes.get(d.by);
      notify(k ? `${k.name} wasted ${r.name}` : `${r.name} got wasted`);
    }
  });
}

// local events worth telling the others about
on('playerShot', (o, e, w) => { lastShot = { o: [r2(o.x), r2(o.y), r2(o.z)], e: [r2(e.x), r2(e.y), r2(e.z)], w }; });
on('explosion', (pos, radius, by) => {
  if (!tx || by !== G.player) return;
  tx.emit('boom', { x: r2(pos.x), y: r2(pos.y), z: r2(pos.z) });
  // players inside vehicles are not in the pedestrian blast loop
  for (const gh of G.ghosts) {
    const d = gh.pos.distanceTo(pos);
    if (d < radius + 2) gh.owner.hurt(160 * (1 - d / (radius + 2)) * 0.8, by);
  }
});
on('wasted', () => {
  if (!tx) return;
  const by = lastRemoteHit && G.time - lastRemoteHit.t < 6 ? lastRemoteHit.peer : null;
  lastRemoteHit = null;
  tx.emit('died', { by });
});

export async function initNet() {
  try {
    tx = await roomTransport();
  } catch (e) { tx = null; }
  if (!tx) tx = channelTransport();
  if (!tx) return;
  wire();
  updateCount();
}

// remote players live in G.peds, so updatePeds() animates them
export function updateNet(dt) {
  tick(dt);
}

