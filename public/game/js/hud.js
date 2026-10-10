// HUD: radar minimap, speedometer, stats, messages, full map, menus.
import { G, clamp, lerp, on } from './core.js';
import { H, TN, HALF, segs, buildings, AIRPORTS, GANGS, SPECIAL, zoneName, biomeAt, urbanAt, BIOMES, DISTRICTS, REGIONS, junctions } from './terrain.js';
import { WEAPONS } from './weapons.js';
import { nodeNear, route, distToPath } from './gps.js';

const $ = (id) => document.getElementById(id);
let mapCanvas, radar, rctx, speedo, sctx, bigMap, bctx;
const MAPPX = 3072;
const w2m = (x) => ((x + HALF) / (HALF * 2)) * MAPPX;

export const blips = []; // {x,z,color,icon,label, pulse}

export function buildMapImage() {
  mapCanvas = document.createElement('canvas');
  mapCanvas.width = mapCanvas.height = MAPPX;
  const g = mapCanvas.getContext('2d');
  const img = g.createImageData(MAPPX, MAPPX);
  const d = img.data;
  const hAt = (i, j) => H[clamp(j, 0, TN) * (TN + 1) + clamp(i, 0, TN)];
  for (let py = 0; py < MAPPX; py++) {
    const z = (py / MAPPX) * HALF * 2 - HALF;
    const fj = ((z + HALF) / (HALF * 2)) * TN;
    const j = Math.floor(fj), tz = fj - j;
    for (let px = 0; px < MAPPX; px++) {
      const x = (px / MAPPX) * HALF * 2 - HALF;
      const fi = ((x + HALF) / (HALF * 2)) * TN;
      const i = Math.floor(fi), tx = fi - i;
      const h = lerp(lerp(hAt(i, j), hAt(i + 1, j), tx), lerp(hAt(i, j + 1), hAt(i + 1, j + 1), tx), tz);
      let r, gg, b;
      if (h < -0.4) { const k = clamp(-h / 25, 0, 1); r = 52 - k * 20; gg = 108 - k * 30; b = 150 - k * 20; }
      else {
        r = 86; gg = 120; b = 70;
        const bi = biomeAt(x, z);
        if (bi === BIOMES.FOREST) { r = 58; gg = 98; b = 56; }
        else if (bi === BIOMES.DESERT) { r = 196; gg = 168; b = 120; }
        else if (bi === BIOMES.WETLAND) { r = 76; gg = 104; b = 70; }
        const k = clamp((h - 120) / 500, 0, 1);
        r = lerp(r, 205, k); gg = lerp(gg, 205, k); b = lerp(b, 210, k);
        if (h < 2.0) { r = 200; gg = 188; b = 150; }
        const u = urbanAt(x, z);
        if (u > 0.1) { const q = clamp((u - 0.1) * 2.5, 0, 0.85); r = lerp(r, 112, q); gg = lerp(gg, 114, q); b = lerp(b, 108, q); }
        // hill shading from the north-west
        const shade = clamp(1 + (hAt(i - 1, j - 1) - h) * 0.02, 0.7, 1.25);
        r *= shade; gg *= shade; b *= shade;
      }
      const o = (py * MAPPX + px) * 4;
      d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const sc = MAPPX / (HALF * 2);
  // gang turf
  for (const gg of GANGS) {
    g.fillStyle = gg.css + '38';
    g.beginPath();
    g.arc(w2m(gg.x), w2m(gg.z), gg.r * sc, 0, Math.PI * 2);
    g.fill();
  }
  // airports
  g.lineCap = 'butt';
  for (const ap of AIRPORTS) {
    g.strokeStyle = '#6f7275';
    for (const r of ap.runways) {
      g.lineWidth = r.w * sc * 1.2;
      g.beginPath(); g.moveTo(w2m(r.x0), w2m(r.z0)); g.lineTo(w2m(r.x1), w2m(r.z1)); g.stroke();
    }
    const A = ap.apron;
    g.strokeStyle = '#8c8f92';
    g.lineWidth = 90 * sc;
    g.beginPath(); g.moveTo(w2m(A.x - ap.dir.x * A.len / 2), w2m(A.z - ap.dir.z * A.len / 2)); g.lineTo(w2m(A.x + ap.dir.x * A.len / 2), w2m(A.z + ap.dir.z * A.len / 2)); g.stroke();
  }
  // roads: rural first, main roads on top
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const kind of ['rural', 'city', 'main']) {
    g.strokeStyle = kind === 'main' ? '#e3d6a6' : kind === 'city' ? '#d9d9d4' : '#c9c2ae';
    for (const s of segs) {
      if (s.kind !== kind) continue;
      g.lineWidth = Math.max(kind === 'main' ? 2.4 : 1.6, s.w * sc * 1.05);
      g.beginPath();
      g.moveTo(w2m(s.a.x), w2m(s.a.z));
      g.lineTo(w2m(s.b.x), w2m(s.b.z));
      g.stroke();
    }
  }
  // buildings
  g.fillStyle = '#5d6168';
  for (const b of buildings) {
    if (b.hidden) continue;
    g.beginPath();
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const lx = sx * b.hx, lz = sz * b.hz;
      const x = b.cx + lx * b.c + lz * b.s, z = b.cz - lx * b.s + lz * b.c;
      g.lineTo(w2m(x), w2m(z));
    }
    g.closePath();
    g.fill();
  }
  void junctions;
  return mapCanvas;
}

export function initHud() {
  radar = $('radar');
  rctx = radar.getContext('2d');
  speedo = $('speedo');
  sctx = speedo.getContext('2d');
  bigMap = $('bigmap');
  bctx = bigMap.getContext('2d');
  initMapControls();
}

// ---------------------------------------------------------------- notifications
const notes = [];
export function notify(text, dur = 4) {
  notes.push({ text, t: dur });
  if (notes.length > 4) notes.shift();
  renderNotes();
}
function renderNotes() {
  $('notify').innerHTML = notes.map((n) => `<div class="note">${n.text}</div>`).join('');
}
on('notify', (t) => notify(t));
let radioT = 0;
on('radio', (name, note) => {
  const el = $('radio');
  el.innerHTML = `<div class="st">${name}</div>${note ? `<div class="gn">${note}</div>` : ''}`;
  el.classList.add('show');
  radioT = 3;
});

let bigT = 0;
export function bigMessage(text, sub = '', color = '#f2c14e', dur = 3.5) {
  const el = $('bigmsg');
  el.innerHTML = `<div class="big" style="color:${color}">${text}</div>${sub ? `<div class="sub">${sub}</div>` : ''}`;
  el.hidden = false;
  bigT = dur;
}
let helpT = 0;
export function help(html, dur = 5) {
  const el = $('help');
  el.innerHTML = html;
  el.hidden = false;
  helpT = dur;
}
let zoneT = 0, lastZone = '';
let vehNameT = 0;
export function showVehicleName(n) {
  $('vehname').textContent = n;
  $('vehname').classList.add('show');
  vehNameT = 3;
}
export function setObjective(t) {
  const el = $('objective');
  el.innerHTML = t || '';
  el.hidden = !t;
}

// ---------------------------------------------------------------- per frame
let moneyShown = -1;
// ---------------------------------------------------------------- GPS
// wp: the player's waypoint (set on the full map). Without one, active mission objectives
// (blips flagged gps) are routed instead.
export const GPS = { wp: null, path: null, target: null, tx: 0, tz: 0, checkT: 0, dist: 0 };
const WP_COLOR = '#c77dff';
export function setWaypoint(x, z) {
  GPS.wp = x === null ? null : { x, z };
  GPS.path = null;
  GPS.checkT = 0;
}
function gpsTarget() {
  if (GPS.wp) return GPS.wp;
  for (const b of blips) if (b.gps && !b.hidden) return b;
  return null;
}
function updateGps(dt, pp) {
  const t = gpsTarget();
  if (!t) { GPS.path = null; GPS.target = null; return; }
  if (GPS.wp && Math.hypot(pp.x - GPS.wp.x, pp.z - GPS.wp.z) < 30) {
    setWaypoint(null);
    notify('You have reached your destination');
    return;
  }
  GPS.checkT -= dt;
  const moved = t !== GPS.target || Math.hypot(t.x - GPS.tx, t.z - GPS.tz) > 20;
  if (moved || (GPS.checkT <= 0 && (!GPS.path || distToPath(GPS.path, pp.x, pp.z).d > 35))) {
    GPS.target = t; GPS.tx = t.x; GPS.tz = t.z;
    GPS.checkT = 1;
    GPS.path = route(nodeNear(pp.x, pp.z), nodeNear(t.x, t.z));
  } else if (GPS.checkT <= 0) GPS.checkT = 1;
  if (GPS.path) {
    // drop the part of the route already driven
    const { i } = distToPath(GPS.path, pp.x, pp.z);
    if (i > 0) GPS.path = GPS.path.slice(i);
    let d = 0;
    for (let k = 0; k < GPS.path.length - 1; k++) d += Math.hypot(GPS.path[k + 1].x - GPS.path[k].x, GPS.path[k + 1].z - GPS.path[k].z);
    GPS.dist = d + Math.hypot(t.x - GPS.path[GPS.path.length - 1].x, t.z - GPS.path[GPS.path.length - 1].z);
  }
}

export function updateHud(dt) {
  const P = G.player;
  for (let i = notes.length - 1; i >= 0; i--) {
    notes[i].t -= dt;
    if (notes[i].t <= 0) { notes.splice(i, 1); renderNotes(); }
  }
  if (bigT > 0) { bigT -= dt; if (bigT <= 0) $('bigmsg').hidden = true; }
  if (helpT > 0) { helpT -= dt; if (helpT <= 0) $('help').hidden = true; }
  if (vehNameT > 0) { vehNameT -= dt; if (vehNameT <= 0) $('vehname').classList.remove('show'); }
  if (radioT > 0) { radioT -= dt; if (radioT <= 0) $('radio').classList.remove('show'); }
  const pp = P.vehicle ? P.vehicle.pos : P.pos;
  updateGps(dt, pp);
  // zone
  const z = zoneName(pp.x, pp.z);
  if (z !== lastZone) {
    lastZone = z;
    $('zone').textContent = z;
    $('zone').classList.add('show');
    zoneT = 4;
  }
  if (zoneT > 0) { zoneT -= dt; if (zoneT <= 0) $('zone').classList.remove('show'); }
  // stats
  if (moneyShown < 0) moneyShown = P.money;
  moneyShown += (P.money - moneyShown) * Math.min(1, dt * 8);
  if (Math.abs(P.money - moneyShown) < 1) moneyShown = P.money;
  $('money').textContent = '$' + String(Math.round(moneyShown)).padStart(8, '0');
  $('hp').style.width = clamp(P.health, 0, 100) + '%';
  $('armor').style.width = clamp(P.armor, 0, 100) + '%';
  $('armorbar').style.visibility = P.armor > 0 ? 'visible' : 'hidden';
  const W = WEAPONS[P.weapon];
  $('wname').textContent = W.name;
  $('wammo').textContent = W.melee ? '' : P.reloadT > 0 ? 'RELOADING' : `${P.clip[P.weapon]} / ${Math.max(0, P.ammo[P.weapon] - P.clip[P.weapon])}`;
  const h = Math.floor(G.dayTime), m = Math.floor((G.dayTime % 1) * 60);
  $('clock').textContent = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  // wanted stars
  const W2 = G.wanted;
  const stars = $('stars').children;
  const flashOff = W2.flashing && Math.floor(G.time * 4) % 2 === 0;
  for (let i = 0; i < 5; i++) stars[i].className = i < W2.level ? (flashOff ? 'star on dim' : 'star on') : 'star';
  // crosshair
  $('crosshair').hidden = !(P.aiming || (G.mouse.left && !W.melee) || (P.vehicle && !W.melee && G.mouse.right));
  // damage
  G.hurtFlash = Math.max(0, (G.hurtFlash || 0) - dt * 1.5);
  $('vignette').style.opacity = Math.max(G.hurtFlash, P.health < 25 ? 0.35 + Math.sin(G.time * 6) * 0.15 : 0);
  drawRadar();
  drawSpeedo();
}

function drawRadar() {
  const P = G.player;
  const pp = P.vehicle ? P.vehicle.pos : P.pos;
  const R = radar.width / 2;
  const g = rctx;
  const sp = P.vehicle ? P.vehicle.speedAbs : 0;
  const mpp = 1.5 + clamp(sp / 40, 0, 1) * 2 + (P.vehicle && (P.vehicle.kind === 'plane' || P.vehicle.kind === 'heli') ? 2 : 0); // meters per px
  g.save();
  g.clearRect(0, 0, radar.width, radar.height);
  g.beginPath();
  g.arc(R, R, R - 3, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = '#2f5d75';
  g.fillRect(0, 0, radar.width, radar.height);
  const fx = Math.sin(G.camYaw), fz = Math.cos(G.camYaw);
  const theta = -Math.PI / 2 - Math.atan2(fz, fx);
  g.translate(R, R);
  g.rotate(theta);
  const k = MAPPX / (HALF * 2); // map px per m
  const s = 1 / (mpp * k);
  g.scale(s, s);
  g.imageSmoothingEnabled = true;
  g.drawImage(mapCanvas, -w2m(pp.x), -w2m(pp.z));
  g.setTransform(1, 0, 0, 1, 0, 0);
  // blips
  const rot = (x, z) => {
    const dx = (x - pp.x) / mpp, dz = (z - pp.z) / mpp;
    const c = Math.cos(theta), sn = Math.sin(theta);
    return [dx * c - dz * sn, dx * sn + dz * c];
  };
  const drawBlip = (x, z, color, size = 4, shape = 'dot', clampEdge = false) => {
    let [bx, by] = rot(x, z);
    const d = Math.hypot(bx, by);
    if (d > R - 8) {
      if (!clampEdge) return;
      bx *= (R - 8) / d;
      by *= (R - 8) / d;
    }
    g.fillStyle = color;
    g.strokeStyle = '#000';
    g.lineWidth = 1.5;
    g.beginPath();
    if (shape === 'sq') g.rect(R + bx - size, R + by - size, size * 2, size * 2);
    else g.arc(R + bx, R + by, size, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  };
  // GPS route
  if (GPS.path && GPS.path.length) {
    g.save();
    g.beginPath();
    g.arc(R, R, R - 3, 0, Math.PI * 2);
    g.clip();
    g.strokeStyle = GPS.wp ? WP_COLOR : '#ffd23f';
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.globalAlpha = 0.9;
    g.beginPath();
    g.moveTo(R, R);
    for (const n of GPS.path) {
      const [bx, by] = rot(n.x, n.z);
      g.lineTo(R + bx, R + by);
      if (bx * bx + by * by > R * R * 4) break;
    }
    if (GPS.target) { const [bx, by] = rot(GPS.target.x, GPS.target.z); g.lineTo(R + bx, R + by); }
    g.stroke();
    g.restore();
  }
  if (GPS.wp) drawBlip(GPS.wp.x, GPS.wp.z, WP_COLOR, 5.5, 'sq', true);
  // gang zones
  for (const gg of GANGS) {
    if (gg.hostile > 0) drawBlip(gg.x, gg.z, gg.css, 6, 'sq', false);
  }
  for (const b of blips) {
    if (b.hidden) continue;
    drawBlip(b.x, b.z, b.color, b.size || 5, b.shape || 'dot', b.edge !== false);
  }
  const W2 = G.wanted;
  if (W2.level > 0) {
    const ph = Math.floor(G.time * 5) % 2;
    for (const v of G.vehicles) if (v.isPolice && !v.dead && (v.ai || v.siren)) drawBlip(v.pos.x, v.pos.z, ph ? '#ff3030' : '#3060ff', 3.5);
    for (const p of G.peds) if (p.type === 'cop' && !p.dead) drawBlip(p.pos.x, p.pos.z, '#5080ff', 2.5);
  }
  for (const p of G.peds) if (p.type === 'gang' && !p.dead && p.gang.hostile > 0) drawBlip(p.pos.x, p.pos.z, p.gang.css, 2.5);
  // player arrow
  const h = P.vehicle ? P.vehicle.heading : P.heading;
  const ang = theta + Math.atan2(Math.cos(h), Math.sin(h));
  g.save();
  g.translate(R, R);
  g.rotate(ang + Math.PI / 2);
  g.fillStyle = '#fff';
  g.strokeStyle = '#000';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(0, -8);
  g.lineTo(6, 7);
  g.lineTo(0, 3);
  g.lineTo(-6, 7);
  g.closePath();
  g.fill();
  g.stroke();
  g.restore();
  g.restore();
  if (GPS.path && GPS.target) {
    const km = GPS.dist >= 1000 ? (GPS.dist / 1000).toFixed(1) + ' km' : Math.round(GPS.dist / 10) * 10 + ' m';
    g.font = 'bold 12px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(R - 34, R * 2 - 34, 68, 18);
    g.fillStyle = GPS.wp ? WP_COLOR : '#ffd23f';
    g.fillText(km, R, R * 2 - 21);
  }
  // ring & north
  g.strokeStyle = 'rgba(0,0,0,0.7)';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(R, R, R - 3, 0, Math.PI * 2);
  g.stroke();
  const [nx, ny] = rot(pp.x, pp.z - 10000);
  const nl = Math.hypot(nx, ny);
  g.fillStyle = '#fff';
  g.font = 'bold 12px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('N', R + (nx / nl) * (R - 12), R + (ny / nl) * (R - 12));
  // altitude bar for aircraft
  if (P.vehicle && (P.vehicle.kind === 'plane' || P.vehicle.kind === 'heli')) {
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(radar.width - 10, 20, 6, radar.height - 40);
    const a = clamp(P.vehicle.pos.y / 600, 0, 1);
    g.fillStyle = '#7fd3ff';
    g.fillRect(radar.width - 10, 20 + (1 - a) * (radar.height - 40), 6, 3);
  }
}

function drawSpeedo() {
  const P = G.player;
  const v = P.vehicle;
  speedo.parentElement.hidden = !v;
  if (!v) return;
  const g = sctx;
  const W = speedo.width, R = W / 2;
  g.clearRect(0, 0, W, W);
  const kmh = Math.round(v.speedAbs * 3.6);
  const max = v.kind === 'plane' ? (v.type === 'jet' ? 600 : 320) : v.kind === 'heli' ? 240 : 260;
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  g.lineWidth = 7;
  g.strokeStyle = 'rgba(255,255,255,0.15)';
  g.beginPath();
  g.arc(R, R, R - 12, a0, a1);
  g.stroke();
  const t = clamp(kmh / max, 0, 1);
  const grd = g.createLinearGradient(0, W, W, 0);
  grd.addColorStop(0, '#4fd1a5');
  grd.addColorStop(0.7, '#f2c14e');
  grd.addColorStop(1, '#ef5350');
  g.strokeStyle = grd;
  g.beginPath();
  g.arc(R, R, R - 12, a0, a0 + (a1 - a0) * t);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.6)';
  for (let i = 0; i <= 10; i++) {
    const a = a0 + ((a1 - a0) * i) / 10;
    g.fillRect(R + Math.cos(a) * (R - 24) - 1, R + Math.sin(a) * (R - 24) - 1, 2, 2);
  }
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.font = '700 34px "Chakra Petch", system-ui, sans-serif';
  g.fillText(kmh, R, R + 8);
  g.font = '600 11px "Chakra Petch", system-ui, sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.fillText('KM/H', R, R + 26);
  const hp = clamp(v.health / v.spec.hp, 0, 1);
  g.fillStyle = 'rgba(255,255,255,0.15)';
  g.fillRect(R - 30, R + 36, 60, 5);
  g.fillStyle = hp > 0.5 ? '#4fd1a5' : hp > 0.25 ? '#f2c14e' : '#ef5350';
  g.fillRect(R - 30, R + 36, 60 * hp, 5);
  if (v.phys) {
    // gear and a small rev bar from the simulated drivetrain
    const T = v.phys.telemetry, p = v.phys.p;
    const r = clamp((T.rpm - p.idleRPM) / (p.redline - p.idleRPM), 0, 1);
    g.fillStyle = 'rgba(255,255,255,0.15)';
    g.fillRect(R - 30, R - 30, 60, 4);
    g.fillStyle = r > 0.88 ? '#ef5350' : '#7fd3ff';
    g.fillRect(R - 30, R - 30, 60 * r, 4);
    g.fillStyle = '#f2c14e';
    g.font = '700 13px "Chakra Petch", system-ui, sans-serif';
    g.fillText(T.gear < 0 ? 'R' : T.kmh < 1 && Math.abs(v.input.throttle) < 0.1 ? 'N' : String(T.gear), R, R - 36);
  }
  if (v.kind === 'plane' || v.kind === 'heli') {
    g.fillStyle = '#7fd3ff';
    g.font = '600 11px "Chakra Petch", system-ui, sans-serif';
    g.fillText('ALT ' + Math.round(v.pos.y) + ' m', R, R - 22);
    if (v.kind === 'plane') {
      g.fillText('THR ' + Math.round(v.throttleLevel * 100) + '%', R, R + 54);
    }
  }
}

// ---------------------------------------------------------------- big map
// full map view: wheel to zoom (towards the cursor), drag to pan
const MV = { zoom: 1, cx: 0, cz: 0, drag: null };
function mapScale() {
  return Math.min(bigMap.width, bigMap.height) * 0.96 * MV.zoom; // px for the whole island
}
function initMapControls() {
  bigMap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = bigMap.getBoundingClientRect();
    const px = (e.clientX - r.left) * devicePixelRatio, py = (e.clientY - r.top) * devicePixelRatio;
    const sc = mapScale();
    const wx = MV.cx + ((px - bigMap.width / 2) / sc) * HALF * 2, wz = MV.cz + ((py - bigMap.height / 2) / sc) * HALF * 2;
    MV.zoom = clamp(MV.zoom * (e.deltaY < 0 ? 1.25 : 0.8), 1, 10);
    const sc2 = mapScale();
    MV.cx = wx - ((px - bigMap.width / 2) / sc2) * HALF * 2;
    MV.cz = wz - ((py - bigMap.height / 2) / sc2) * HALF * 2;
    drawBigMap();
  }, { passive: false });
  bigMap.addEventListener('mousedown', (e) => { MV.drag = { x: e.clientX, y: e.clientY, cx: MV.cx, cz: MV.cz }; });
  addEventListener('mouseup', (e) => {
    const d = MV.drag;
    MV.drag = null;
    if (!d || bigMap.parentElement.hidden || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
    // a click (not a drag): place the waypoint there, or clear it when clicking on it
    const r = bigMap.getBoundingClientRect();
    const sc = mapScale();
    const px = (e.clientX - r.left) * devicePixelRatio, py = (e.clientY - r.top) * devicePixelRatio;
    const wx = MV.cx + ((px - bigMap.width / 2) / sc) * HALF * 2, wz = MV.cz + ((py - bigMap.height / 2) / sc) * HALF * 2;
    if (GPS.wp && (Math.hypot(wx - GPS.wp.x, wz - GPS.wp.z) * sc) / (HALF * 2) < 14 * devicePixelRatio) setWaypoint(null);
    else setWaypoint(wx, wz);
    const P = G.player, pp = P.vehicle ? P.vehicle.pos : P.pos;
    updateGps(0, pp);
    drawBigMap();
  });
  addEventListener('mousemove', (e) => {
    if (!MV.drag || bigMap.parentElement.hidden) return;
    const k = (HALF * 2 * devicePixelRatio) / mapScale();
    MV.cx = MV.drag.cx - (e.clientX - MV.drag.x) * k;
    MV.cz = MV.drag.cz - (e.clientY - MV.drag.y) * k;
    drawBigMap();
  });
}

export function drawBigMap(reset = false) {
  const P = G.player;
  const pp = P.vehicle ? P.vehicle.pos : P.pos;
  const W = (bigMap.width = bigMap.clientWidth * devicePixelRatio);
  const Hh = (bigMap.height = bigMap.clientHeight * devicePixelRatio);
  if (reset) { MV.zoom = 2.5; MV.cx = pp.x; MV.cz = pp.z; }
  const g = bctx;
  g.fillStyle = '#244a5e';
  g.fillRect(0, 0, W, Hh);
  const sz = mapScale();
  const ox = W / 2 - ((MV.cx + HALF) / (HALF * 2)) * sz, oy = Hh / 2 - ((MV.cz + HALF) / (HALF * 2)) * sz;
  g.imageSmoothingEnabled = MV.zoom < 3;
  g.drawImage(mapCanvas, ox, oy, sz, sz);
  g.imageSmoothingEnabled = true;
  const tp = (x, z) => [ox + ((x + HALF) / (HALF * 2)) * sz, oy + ((z + HALF) / (HALF * 2)) * sz];
  g.font = `${Math.round(12 * devicePixelRatio)}px "Chakra Petch", system-ui, sans-serif`;
  g.textAlign = 'center';
  const label = (t, x, z, c = '#fff') => {
    const [a, b] = tp(x, z);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    const w = g.measureText(t).width + 10 * devicePixelRatio;
    g.fillRect(a - w / 2, b - 10 * devicePixelRatio, w, 18 * devicePixelRatio);
    g.fillStyle = c;
    g.fillText(t, a, b + 4 * devicePixelRatio);
  };
  for (const dd of DISTRICTS) label(dd.name.toUpperCase(), dd.x, dd.z);
  for (const r of REGIONS) label(r.name.toUpperCase(), r.x, r.z, '#e3f2fd');
  for (const ap of AIRPORTS) label(ap.name.toUpperCase(), ap.x, ap.z - 260, '#cfd8dc');
  for (const gg of GANGS) label(gg.name.toUpperCase(), gg.x, gg.z + gg.r * 0.6, gg.css);
  const dot = (x, z, c, r = 6) => {
    const [a, b] = tp(x, z);
    g.fillStyle = c;
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(a, b, r * devicePixelRatio, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  };
  if (GPS.path && GPS.path.length) {
    g.strokeStyle = GPS.wp ? WP_COLOR : '#ffd23f';
    g.lineWidth = 4 * devicePixelRatio;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    const [a0, b0] = tp(pp.x, pp.z);
    g.moveTo(a0, b0);
    for (const n of GPS.path) { const [a, b] = tp(n.x, n.z); g.lineTo(a, b); }
    if (GPS.target) { const [a, b] = tp(GPS.target.x, GPS.target.z); g.lineTo(a, b); }
    g.stroke();
  }
  for (const b of blips) if (!b.hidden) dot(b.x, b.z, b.color, (b.size || 5) + 1);
  if (GPS.wp) {
    const [a, b] = tp(GPS.wp.x, GPS.wp.z);
    g.fillStyle = WP_COLOR;
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(a, b);
    g.lineTo(a - 8 * devicePixelRatio, b - 16 * devicePixelRatio);
    g.lineTo(a + 8 * devicePixelRatio, b - 16 * devicePixelRatio);
    g.closePath();
    g.fill();
    g.stroke();
  }
  dot(SPECIAL.hospital.x, SPECIAL.hospital.z, '#ef5350');
  dot(SPECIAL.police.x, SPECIAL.police.z, '#42a5f5');
  dot(SPECIAL.spray.x, SPECIAL.spray.z, '#ffb300');
  // player
  const [a, b] = tp(pp.x, pp.z);
  const h = P.vehicle ? P.vehicle.heading : P.heading;
  g.save();
  g.translate(a, b);
  g.rotate(Math.atan2(Math.cos(h), Math.sin(h)) + Math.PI / 2);
  g.scale(devicePixelRatio * 1.4, devicePixelRatio * 1.4);
  g.fillStyle = '#fff';
  g.strokeStyle = '#000';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(0, -9);
  g.lineTo(7, 8);
  g.lineTo(0, 4);
  g.lineTo(-7, 8);
  g.closePath();
  g.fill();
  g.stroke();
  g.restore();
}

export function showDeathScreen(kind, statsRows) {
  const el = $('deathscreen');
  $('death-title').textContent = kind === 'busted' ? 'BUSTED' : 'WASTED';
  $('death-title').className = kind;
  $('death-sub').textContent = kind === 'busted' ? 'Pursuit over' : 'You were taken to the hospital';
  $('death-stats').innerHTML = statsRows.map(([k, v]) => `<div class="row"><span>${k}</span><b>${v}</b></div>`).join('');
  el.hidden = false;
}
