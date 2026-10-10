// Road traffic AI, parked cars, fixed vehicle spawns, and road pathfinding.
import { G, clamp, rand, pick, angWrap, emit, on, dist2 } from './core.js';
import { nodes, segs, segsAt, AIRPORT, AIRPORTS, SPECIAL, isWater, urbanAt, streetSpot, waterSpot, px2w, terrainHeight } from './terrain.js';
import { Vehicle, spawnVehicle, CAR_COLORS } from './vehicles.js';
import { sfx } from './audio.js';

const LANE = (w) => w / 4;

// ---------------------------------------------------------------- pathfinding
export function nearestNode(x, z, maxD = Infinity) {
  let best = null, bd = maxD;
  // look in the nearby road grid cells first
  for (const [ox, oz] of [[0, 0], [64, 0], [-64, 0], [0, 64], [0, -64]]) {
    const l = segsAt(x + ox, z + oz);
    if (l) for (const sg of l) for (const n of [sg.a, sg.b]) {
      const d = Math.abs(n.x - x) + Math.abs(n.z - z);
      if (d < bd) { bd = d; best = n; }
    }
  }
  if (best) return best;
  for (const n of nodes) {
    if (!n.edges.length) continue;
    const d = Math.abs(n.x - x) + Math.abs(n.z - z);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}
export function aStar(start, goal, maxIter = 3000) {
  if (!start || !goal) return null;
  if (start === goal) return [start];
  const open = new Map([[start.id, start]]);
  const g = new Map([[start.id, 0]]);
  const f = new Map([[start.id, dist2(start.x, start.z, goal.x, goal.z)]]);
  const came = new Map();
  let it = 0;
  while (open.size && it++ < maxIter) {
    let cur = null, cf = Infinity;
    for (const [id, n] of open) { const v = f.get(id); if (v < cf) { cf = v; cur = n; } }
    if (cur === goal) {
      const path = [cur];
      while (came.has(cur.id)) { cur = came.get(cur.id); path.unshift(cur); }
      return path;
    }
    open.delete(cur.id);
    for (const e of cur.edges) {
      const tg = g.get(cur.id) + e.s.len;
      if (tg < (g.get(e.n.id) ?? Infinity)) {
        came.set(e.n.id, cur);
        g.set(e.n.id, tg);
        f.set(e.n.id, tg + dist2(e.n.x, e.n.z, goal.x, goal.z));
        open.set(e.n.id, e.n);
      }
    }
  }
  return null;
}

// lane waypoints for driving from node a to node b (right-hand traffic)
function edgePoints(a, b, s, out) {
  const dx = (b.x - a.x) / s.len, dz = (b.z - a.z) / s.len;
  const rx = -dz, rz = dx;
  const off = LANE(s.w);
  const clrA = a.edges.length > 2 ? s.w / 2 + 2 : 0;
  const clrB = b.edges.length > 2 ? s.w / 2 + 2 : 0;
  out.push({ x: a.x + dx * clrA + rx * off, z: a.z + dz * clrA + rz * off, s });
  out.push({ x: b.x - dx * clrB + rx * off, z: b.z - dz * clrB + rz * off, s, end: true });
}
function edgeBetween(a, b) {
  for (const e of a.edges) if (e.n === b) return e.s;
  return null;
}

export class RoadAI {
  constructor(v, from, to, mode = 'traffic') {
    this.v = v;
    this.mode = mode;
    this.from = from;
    this.to = to;
    this.wps = [];
    edgePoints(from, to, edgeBetween(from, to), this.wps);
    this.wps.shift();
    this.blockedT = 0;
    this.stuckT = 0;
    this.reverseT = 0;
    this.panic = 0;
    this.cruise = rand(0.85, 1.1);
  }
  chooseNext() {
    const opts = this.to.edges.filter((e) => e.n !== this.from);
    const list = opts.length ? opts : this.to.edges;
    let e = pick(list);
    if (this.route && this.route.length) {
      const nx = this.route.shift();
      const f = this.to.edges.find((ed) => ed.n === nx);
      if (f) e = f;
    }
    const prevDir = { x: this.to.x - this.from.x, z: this.to.z - this.from.z };
    const pts = [];
    edgePoints(this.to, e.n, e.s, pts);
    // smooth turn through intersection
    const last = this.wps.length ? this.wps[this.wps.length - 1] : { x: this.v.pos.x, z: this.v.pos.z };
    const first = pts[0];
    const turn = Math.abs(angWrap(Math.atan2(e.n.x - this.to.x, e.n.z - this.to.z) - Math.atan2(prevDir.x, prevDir.z)));
    if (turn > 0.3 && this.to.edges.length > 2) {
      // control point = where the incoming and outgoing lane lines cross
      const li = Math.hypot(prevDir.x, prevDir.z);
      const ix = prevDir.x / li, iz = prevDir.z / li;
      const ox = (e.n.x - this.to.x) / e.s.len, oz = (e.n.z - this.to.z) / e.s.len;
      const offIn = LANE(edgeBetween(this.from, this.to).w), offOut = LANE(e.s.w);
      const ctrlX = this.to.x - iz * offIn - oz * offOut;
      const ctrlZ = this.to.z + ix * offIn + ox * offOut;
      for (const t of [0.33, 0.66]) {
        const u = 1 - t;
        this.wps.push({ x: u * u * last.x + 2 * u * t * ctrlX + t * t * first.x, z: u * u * last.z + 2 * u * t * ctrlZ + t * t * first.z, turn: true });
      }
    }
    this.wps.push(...pts);
    this.from = this.to;
    this.to = e.n;
  }
  update(dt, v) {
    const I = v.input;
    if (!v.driver) { I.throttle = 0; I.handbrake = true; I.steer = 0; return; }
    while (this.wps.length < 4) this.chooseNext();
    let wp = this.wps[0];
    const dx = wp.x - v.pos.x, dz = wp.z - v.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < (wp.turn ? 5 : 6)) { this.wps.shift(); return this.update(dt, v); }
    const want = Math.atan2(dx, dz);
    const diff = angWrap(want - v.heading);
    const speedLimit = (wp.s ? (wp.s.kind === 'main' ? 20 : wp.s.kind === 'rural' ? 17 : 13) : 13) * this.cruise * (this.panic > 0 ? 1.6 : 1);
    const nextTurn = this.wps.slice(0, 3).some((w) => w.turn);
    let target = nextTurn ? Math.min(speedLimit, 8) : speedLimit;
    if (Math.abs(diff) > 0.6) target = Math.min(target, 6);
    // look ahead for obstacles
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    const look = 6 + Math.abs(v.fwdSpeed) * 1.1;
    let block = Infinity, byPlayer = false;
    if (this.panic <= 0) {
      for (const o of G.vehicles) {
        if (o === v) continue;
        const ox = o.pos.x - v.pos.x, oz = o.pos.z - v.pos.z;
        if (Math.abs(ox) > look + 6 || Math.abs(oz) > look + 6) continue;
        const along = ox * fx + oz * fz, lat = ox * -fz + oz * fx;
        if (along > 0 && along < look + o.spec.len / 2 && Math.abs(lat) < 2.2 + o.spec.wid / 2 && Math.abs(o.pos.y - v.pos.y) < 3) {
          if (along < block) { block = along; byPlayer = o.driver === G.player; }
        }
      }
      for (const p of G.peds) {
        if (p.dead || p.vehicle) continue;
        const ox = p.pos.x - v.pos.x, oz = p.pos.z - v.pos.z;
        if (Math.abs(ox) > look + 2 || Math.abs(oz) > look + 2) continue;
        const along = ox * fx + oz * fz, lat = ox * -fz + oz * fx;
        if (along > 0 && along < look && Math.abs(lat) < 1.8) {
          if (along < block) { block = along; byPlayer = p === G.player; }
        }
      }
    }
    if (block < Infinity) target = Math.min(target, Math.max(0, (block - v.spec.len / 2 - 3) * 0.8));
    const fs = v.fwdSpeed;
    if (this.reverseT > 0) {
      this.reverseT -= dt;
      I.throttle = -1;
      I.steer = Math.sign(diff) || 1;
      I.handbrake = false;
      return;
    }
    I.throttle = clamp((target - fs) * 0.4, -1, 1);
    I.handbrake = target < 0.5 && fs < 1;
    I.steer = clamp(-diff * 2.2, -1, 1);
    // stuck detection
    if (block === Infinity && target > 3 && fs < 1) {
      this.stuckT += dt;
      if (this.stuckT > 2.5) { this.reverseT = 1.4; this.stuckT = 0; }
    } else this.stuckT = 0;
    if (block < 10 && fs < 1) {
      this.blockedT += dt;
      if (byPlayer && this.blockedT > 2 && Math.random() < dt) sfx('horn', v.pos);
      if (this.blockedT > 9) { this.panic = 3; this.blockedT = 0; }
    } else this.blockedT = 0;
    if (this.panic > 0) this.panic -= dt;
  }
}

// ---------------------------------------------------------------- traffic manager
const TYPES = [['sedan', 22], ['hatchback', 12], ['suv', 12], ['luxury', 5], ['taxi', 9], ['sports', 6], ['van', 7], ['truck', 6], ['pickup', 9], ['police', 3], ['ambulance', 2], ['garbage', 2], ['firetruck', 1], ['bus', 2]];
function pickType(city) {
  let tot = 0;
  for (const [t, w] of TYPES) if (city || t !== 'bus') tot += w;
  let r = Math.random() * tot;
  for (const [t, w] of TYPES) {
    if (!city && t === 'bus') continue;
    if ((r -= w) <= 0) return t;
  }
  return 'sedan';
}

function anyVehicleNear(x, z, r) {
  for (const v of G.vehicles) if (Math.abs(v.pos.x - x) < r && Math.abs(v.pos.z - z) < r) return true;
  return false;
}
function playerPos() {
  const P = G.player;
  return P.vehicle ? P.vehicle.pos : P.pos;
}
function inView(x, z) {
  const c = G.camera.position;
  const dx = x - c.x, dz = z - c.z;
  const fx = -Math.sin(G.camYaw + Math.PI), fz = -Math.cos(G.camYaw + Math.PI);
  const d = Math.hypot(dx, dz);
  return (dx * fx + dz * fz) / d > 0.55 && d < 160;
}

export function spawnOnRoad(type, minD, maxD, mode = 'traffic', preferHidden = true) {
  const pp = playerPos();
  for (let tries = 0; tries < 25; tries++) {
    // a random road segment in the ring around the player
    const ang = Math.random() * Math.PI * 2, rr2 = minD + Math.random() * (maxD - minD);
    const l = segsAt(pp.x + Math.cos(ang) * rr2, pp.z + Math.sin(ang) * rr2);
    if (!l || !l.length) continue;
    const s = l[Math.floor(Math.random() * l.length)];
    const t = Math.random();
    const x = s.a.x + (s.b.x - s.a.x) * t, z = s.a.z + (s.b.z - s.a.z) * t;
    const d = Math.hypot(x - pp.x, z - pp.z);
    if (d < minD || d > maxD) continue;
    if (preferHidden && inView(x, z) && tries < 20) continue;
    const dirFwd = Math.random() < 0.5;
    const a = dirFwd ? s.a : s.b, b = dirFwd ? s.b : s.a;
    const dx = (b.x - a.x) / s.len, dz = (b.z - a.z) / s.len;
    const px = x + -dz * LANE(s.w), pz = z + dx * LANE(s.w);
    if (anyVehicleNear(px, pz, 14)) continue;
    const v = spawnVehicle(type, px, pz, Math.atan2(dx, dz));
    v.vel.set(dx * 8, 0, dz * 8);
    v.ai = new RoadAI(v, a, b, mode);
    v.driver = { npc: true };
    if (type === 'police') v.driver.cop = true;
    return v;
  }
  return null;
}

// segments sampled within range (used for faster spawning)
function segsNear(x, z, r) {
  return segs.filter((s) => Math.min(Math.hypot(s.a.x - x, s.a.z - z), Math.hypot(s.b.x - x, s.b.z - z)) < r + s.len);
}

let tT = 0;
let nearSegs = [], nearAt = { x: 1e9, z: 1e9 };
export function updateTraffic(dt) {
  tT -= dt;
  if (tT > 0) return;
  tT = 0.4;
  const pp = playerPos();
  if (Math.hypot(pp.x - nearAt.x, pp.z - nearAt.z) > 80) {
    nearSegs = segsNear(pp.x, pp.z, 350);
    nearAt = { x: pp.x, z: pp.z };
  }
  const inCity = urbanAt(pp.x, pp.z) > 0.15;
  let traffic = 0, parked = 0;
  for (let i = G.vehicles.length - 1; i >= 0; i--) {
    const v = G.vehicles[i];
    if (v.removeT > 0) {
      v.removeT -= 0.4;
      if (v.removeT <= 0 && v.driver !== G.player) { v.remove(); continue; }
    }
    if (v.persist || v === G.player.vehicle || v.lastPlayerUse) {
      if (v.lastPlayerUse && v !== G.player.vehicle && v.pos.distanceTo(pp) > 600) v.remove();
      continue;
    }
    const d = Math.hypot(v.pos.x - pp.x, v.pos.z - pp.z);
    if (d > (v.isPolice ? 450 : 380)) { v.remove(); continue; }
    if (v.ai instanceof RoadAI) traffic++;
    if (v.parked) parked++;
  }
  const want = inCity ? (G.night > 0.6 ? 22 : 34) : 12;
  for (let k = 0; k < 3 && traffic < want; k++, traffic++) {
    if (!nearSegs.length) break;
    spawnFromList(nearSegs, pickType(inCity), inCity);
  }
  if (inCity && parked < 16) spawnParked(pp);
}

function spawnFromList(list, type, city) {
  const pp = playerPos();
  for (let tries = 0; tries < 12; tries++) {
    const s = list[Math.floor(Math.random() * list.length)];
    const t = Math.random();
    const x = s.a.x + (s.b.x - s.a.x) * t, z = s.a.z + (s.b.z - s.a.z) * t;
    const d = Math.hypot(x - pp.x, z - pp.z);
    if (d < 120 || d > 330) continue;
    if (inView(x, z)) continue;
    const fwd = Math.random() < 0.5;
    const a = fwd ? s.a : s.b, b = fwd ? s.b : s.a;
    const dx = (b.x - a.x) / s.len, dz = (b.z - a.z) / s.len;
    const px = x - dz * LANE(s.w), pz = z + dx * LANE(s.w);
    if (anyVehicleNear(px, pz, 14)) continue;
    const v = spawnVehicle(type, px, pz, Math.atan2(dx, dz));
    v.vel.set(dx * 10, 0, dz * 10);
    v.ai = new RoadAI(v, a, b);
    v.driver = { npc: true, cop: type === 'police' };
    return v;
  }
}

function spawnParked(pp) {
  for (let tries = 0; tries < 10; tries++) {
    const s = nearSegs[Math.floor(Math.random() * nearSegs.length)];
    if (!s || !s.sidewalk) continue;
    const t = rand(0.2, 0.8);
    const x = s.a.x + (s.b.x - s.a.x) * t, z = s.a.z + (s.b.z - s.a.z) * t;
    const d = Math.hypot(x - pp.x, z - pp.z);
    if (d < 70 || d > 260 || inView(x, z)) continue;
    const side = Math.random() < 0.5 ? 1 : -1;
    const px = x - s.dz * (s.w / 2 - 1.3) * side, pz = z + s.dx * (s.w / 2 - 1.3) * side;
    if (anyVehicleNear(px, pz, 8)) continue;
    const type = Math.random() < 0.15 ? pick(['bike', 'bicycle']) : pick(['sedan', 'hatchback', 'suv', 'luxury', 'sports', 'pickup', 'van']);
    const v = spawnVehicle(type, px, pz, Math.atan2(s.dx * side, s.dz * side));
    v.parked = true;
    return;
  }
}

// ---------------------------------------------------------------- fixed spawns (always available)
export const FIXED = [];
export function setupFixedVehicles() {
  const add = (type, x, z, h, color, y) => FIXED.push({ type, x, z, h, color, y, v: null, t: 0 });
  // parked at the kerb of a street near a map location; ahead = metres along the street
  const kerb = (type, x, z, color, ahead = 0, side = 1) => {
    const p = streetSpot(x, z, false);
    if (!p.s) return;
    const s = p.s;
    const off = s.w / 2 - 1.4;
    add(type, p.x + s.dx * ahead - s.dz * off * side, p.z + s.dz * ahead + s.dx * off * side, Math.atan2(s.dx, s.dz), color);
  };
  const st = SPECIAL.start;
  // player-friendly rides right at the start
  kerb('sports', st.x, st.z, 0xc62828, 1, 1);
  kerb('bike', st.x, st.z, 0x111111, -7, 1);
  kerb('bicycle', st.x, st.z, 0xe65100, -11, 1);
  kerb('suv', st.x, st.z, 0xfafafa, 18, -1);
  // airports: stunt planes on the runway threshold, the jet and helicopters on the apron
  for (const ap of AIRPORTS) {
    const t = ap.threshold, d = ap.dir;
    const big = ap === AIRPORT;
    add('plane', t.x - d.z * 12, t.z + d.x * 12, t.heading, big ? 0xd32f2f : 0x1565c0, ap.h + 0.1);
    if (big) {
      add('plane', t.x + d.z * 12, t.z - d.x * 12, t.heading, 0xfbc02d, ap.h + 0.1);
      add('jet', ap.apron.x, ap.apron.z, t.heading + Math.PI, 0xeceff1, ap.h + 0.1);
      add('racecar', ap.apron.x - d.x * 60, ap.apron.z - d.z * 60, t.heading, 0xc62828, ap.h + 0.1);
    }
    for (const [k, hp] of ap.helipads.entries()) if (big || k === 0) add('heli', hp.x, hp.z, t.heading, k ? 0xe65100 : 0x263238, ap.h + 0.1);
  }
  // hospital roof heli
  add('heli', SPECIAL.hospital.roofX, SPECIAL.hospital.roofZ, 0, 0xfafafa, SPECIAL.hospital.roofY);
  // boats moored off the city harbours
  for (const [px, py, col] of [[175, 255, 0xffffff], [620, 470, 0x1565c0], [430, 330, 0xd32f2f], [270, 690, 0x2e7d32], [520, 735, 0xfafafa]]) {
    const w = px2w(px, py);
    const p = waterSpot(w.x, w.z, 3);
    if (p) add('boat', p.x, p.z, Math.random() * 6.28, col);
  }
  // around the island
  for (const [px, py, type, col] of [[245, 520, 'pickup', 0x8d6e63], [250, 525, 'bike', 0xe65100], [360, 520, 'suv', 0x37474f], [600, 300, 'pickup', 0x2e7d32],
    [690, 520, 'luxury', 0x212121], [215, 625, 'sports', 0xffeb3b], [520, 100, 'tractor', 0x2e7d32], [160, 190, 'bike', 0x1565c0]]) {
    const w = px2w(px, py);
    kerb(type, w.x, w.z, col, 0, 1);
  }
  const P = SPECIAL.police;
  const fx = Math.sin(P.h), fz = Math.cos(P.h);
  add('police', P.spawnX - fz * 3.5 + fx * 8, P.spawnZ + fx * 3.5 + fz * 8, P.h);
  add('police', P.spawnX - fz * 3.5 - fx * 8, P.spawnZ + fx * 3.5 - fz * 8, P.h);
  for (const f of FIXED) spawnFixed(f);
}
function spawnFixed(f) {
  const v = new Vehicle(f.type, f.x, f.z, f.h, f.color ?? CAR_COLORS[0], f.y ?? null);
  v.persist = true;
  v.fixed = f;
  f.v = v;
}
let fT = 0;
export function updateFixed(dt) {
  fT -= dt;
  if (fT > 0) return;
  fT = 2;
  const pp = playerPos();
  for (const f of FIXED) {
    const gone = !f.v || f.v.removed || (f.v.dead && f.v.removeT <= 0) || (f.v !== G.player.vehicle && Math.hypot(f.v.pos.x - f.x, f.v.pos.z - f.z) > 400);
    if (!gone) continue;
    if (Math.hypot(pp.x - f.x, pp.z - f.z) < 150) continue;
    if (f.v && !f.v.removed) {
      if (f.v === G.player.vehicle) continue;
      f.v.persist = false;
      f.v.lastPlayerUse = true;
      if (f.v.pos.distanceTo(pp) > 150) f.v.remove();
    }
    spawnFixed(f);
  }
}

on('gunfire', (x, z) => {
  for (const v of G.vehicles) if (v.ai instanceof RoadAI && Math.hypot(v.pos.x - x, v.pos.z - z) < 50) v.ai.panic = 8;
});
void isWater; void emit; void terrainHeight;
