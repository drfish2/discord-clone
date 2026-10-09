// HUD: radar minimap, speedometer, stats, messages, full map, menus.
import { G, clamp, on } from './core.js';
import { H, TN, HALF, segs, buildings, blockType, blockRect, AIRPORT, GANGS, SPECIAL, desertF, mountainF, forestF, zoneName, LAKE } from './terrain.js';
import { WEAPONS } from './weapons.js';

const $ = (id) => document.getElementById(id);
let mapCanvas, radar, rctx, speedo, sctx, bigMap, bctx;
const MAPPX = 2048;
const w2m = (x) => ((x + HALF) / (HALF * 2)) * MAPPX;

export const blips = []; // {x,z,color,icon,label, pulse}

export function buildMapImage() {
  mapCanvas = document.createElement('canvas');
  mapCanvas.width = mapCanvas.height = MAPPX;
  const g = mapCanvas.getContext('2d');
  const img = g.createImageData(MAPPX, MAPPX);
  const d = img.data;
  for (let py = 0; py < MAPPX; py++) {
    const z = (py / MAPPX) * HALF * 2 - HALF;
    const fj = ((z + HALF) / (HALF * 2)) * TN;
    const j = Math.min(TN, Math.floor(fj));
    for (let px = 0; px < MAPPX; px++) {
      const x = (px / MAPPX) * HALF * 2 - HALF;
      const i = Math.min(TN, Math.floor(((x + HALF) / (HALF * 2)) * TN));
      const h = H[j * (TN + 1) + i];
      let r, gg, b;
      if (h < -0.4) { const k = clamp(-h / 25, 0, 1); r = 52 - k * 20; gg = 108 - k * 30; b = 150 - k * 20; }
      else {
        r = 86; gg = 120; b = 70;
        const fw = forestF(x), dS = desertF(x, z), mN = mountainF(z);
        if (fw > 0.4) { r = 58; gg = 98; b = 56; }
        if (dS > 0.4) { r = 196; gg = 168; b = 120; }
        if (mN > 0.4) { const k = clamp((h - 60) / 300, 0, 1); r = 96 + k * 120; gg = 110 + k * 105; b = 80 + k * 140; }
        if (h < 2.2) { r = 200; gg = 188; b = 150; }
        const shade = clamp(1 + (H[j * (TN + 1) + Math.max(0, i - 1)] - h) * 0.03, 0.75, 1.2);
        r *= shade; gg *= shade; b *= shade;
        if (Math.abs(x) < 815 && Math.abs(z) < 815) { r = 110; gg = 112; b = 106; }
      }
      const o = (py * MAPPX + px) * 4;
      d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const sc = MAPPX / (HALF * 2);
  // city blocks
  for (let bi = 0; bi < 16; bi++)
    for (let bj = 0; bj < 16; bj++) {
      const t = blockType[bi][bj];
      if (t === 'river') continue;
      const r = blockRect(bi, bj);
      g.fillStyle = t === 'park' ? '#5c8a45' : t.startsWith('gang') ? '#7d7670' : '#9a9a92';
      g.fillRect(w2m(r.x0), w2m(r.z0), (r.x1 - r.x0) * sc, (r.z1 - r.z0) * sc);
    }
  // gang tint
  for (const gg of GANGS) {
    g.fillStyle = gg.css + '40';
    g.fillRect(w2m(gg.x0), w2m(gg.z0), (gg.x1 - gg.x0) * sc, (gg.z1 - gg.z0) * sc);
  }
  // airport
  g.fillStyle = '#7a7d80';
  g.fillRect(w2m(AIRPORT.runwayX0), w2m(AIRPORT.runwayZ - 25), (AIRPORT.runwayX1 - AIRPORT.runwayX0) * sc, 50 * sc);
  g.fillRect(w2m(1250), w2m(60), 800 * sc, 120 * sc);
  // roads
  g.lineCap = 'round';
  for (const s of segs) {
    g.strokeStyle = s.kind === 'hwy' ? '#e3d6a6' : '#d9d9d4';
    g.lineWidth = Math.max(2.2, s.w * sc * 1.05);
    g.beginPath();
    g.moveTo(w2m(s.a.x), w2m(s.a.z));
    g.lineTo(w2m(s.b.x), w2m(s.b.z));
    g.stroke();
  }
  // buildings
  g.fillStyle = '#5d6168';
  for (const b of buildings) g.fillRect(w2m(b.x0), w2m(b.z0), Math.max(1, (b.x1 - b.x0) * sc), Math.max(1, (b.z1 - b.z0) * sc));
  return mapCanvas;
}

export function initHud() {
  radar = $('radar');
  rctx = radar.getContext('2d');
  speedo = $('speedo');
  sctx = speedo.getContext('2d');
  bigMap = $('bigmap');
  bctx = bigMap.getContext('2d');
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
  // gang zones
  for (const gg of GANGS) {
    if (gg.hostile > 0) drawBlip(gg.cx, gg.cz, gg.css, 6, 'sq', false);
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
export function drawBigMap() {
  const P = G.player;
  const pp = P.vehicle ? P.vehicle.pos : P.pos;
  const W = (bigMap.width = bigMap.clientWidth * devicePixelRatio);
  const Hh = (bigMap.height = bigMap.clientHeight * devicePixelRatio);
  const g = bctx;
  g.fillStyle = '#244a5e';
  g.fillRect(0, 0, W, Hh);
  const sz = Math.min(W, Hh) * 0.96;
  const ox = (W - sz) / 2, oy = (Hh - sz) / 2;
  g.drawImage(mapCanvas, ox, oy, sz, sz);
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
  label('DOWNTOWN', 0, 0);
  label('CRIMSON INTL AIRPORT', 1700, -260);
  label('RED DUST DESERT', 1900, 1500, '#ffe0b2');
  label('SANDY ROCK', 2100, 2230);
  label('MT. EMBER', 100, -2300, '#e3f2fd');
  label('EMBER RIDGE', -700, -1700);
  label('PINEWOOD FOREST', -2100, -700, '#c8e6c9');
  label('MIRROR LAKE', LAKE.x, LAKE.z + 230);
  label('CORAL BEACH', -650, 2520);
  label('CRIMSON RIVER', -600, 1300, '#b3e5fc');
  for (const gg of GANGS) label(gg.name.toUpperCase(), gg.cx, gg.cz, gg.css);
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
  for (const b of blips) if (!b.hidden) dot(b.x, b.z, b.color, (b.size || 5) + 1);
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
