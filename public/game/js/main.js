// Crimson Coast: bootstraps the renderer, input, game loop and game states.
import * as THREE from 'three';
import { G, resetStats, on, clamp } from './core.js';
import { buildWorld, updateWorld } from './world.js';
import { SPECIAL, groundHeight, cityPt, cityAngle } from './terrain.js';
import { initFx, updateFx, setFxScale } from './fx.js';
import { Player } from './player.js';
import { updatePeds, vehiclePedCollisions } from './characters.js';
import { collideVehicles } from './vehicles.js';
import { updateTraffic, setupFixedVehicles, updateFixed } from './traffic.js';
import { updatePolice, clearWanted, wanted } from './police.js';
import { updateRockets } from './weapons.js';
import { initAudio, updateAudio, sfx, setMuted, muted, radioNext, pauseRadio } from './audio.js';
import { initHud, buildMapImage, updateHud, drawBigMap, help, showDeathScreen, showVehicleName, notify } from './hud.js';
import { updateCamera, cycleZoom, snapCamera } from './camera.js';
import { initMissions, updateMissions, abortMission } from './missions.js';
import { loadModels } from './assets.js';
import { loadSounds } from './audio.js';

const $ = (id) => document.getElementById(id);
const START = { x: -8.9, z: 40 }; // logical city coordinates (see terrain.cityPt)
let renderer, scene, camera;
const focus = new THREE.Vector3();

function setLoading(t, p) {
  $('loadtext').textContent = t;
  if (p !== undefined) $('loadbar').style.width = p + '%';
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

async function boot() {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    setLoading('WebGL is not available in this browser.');
    return;
  }
  G.lowQ = /[?&]q=low/.test(location.search);
  renderer.setPixelRatio(G.lowQ ? 0.75 : Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = !G.lowQ;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  $('game').appendChild(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 7000);
  G.scene = scene;
  G.camera = camera;
  G.renderer = renderer;

  setLoading('Loading cars, people and buildings…', 5);
  const sounds = loadSounds();
  await loadModels((f) => setLoading('Loading cars, people and buildings…', 5 + f * 30));
  await sounds;
  setLoading('Raising mountains, carving rivers…', 40);
  await nextFrame();
  buildWorld(scene);
  setLoading('Painting the map…', 60);
  await nextFrame();
  initFx(scene);
  initHud();
  buildMapImage();
  setLoading('Waking up the city…', 80);
  await nextFrame();
  const sp = cityPt(START.x, START.z);
  G.player = new Player(sp.x, sp.z);
  G.player.heading = cityAngle(START.x, START.z);
  G.camYaw = G.player.heading;
  setupFixedVehicles();
  initMissions();
  resetStats();
  onResize();
  // warm up a frame so shaders compile behind the menu
  updateCamera(0.016);
  updateWorld(0.016, G.player.pos);
  renderer.compile(scene, camera);
  setLoading('Ready', 100);
  $('loading').hidden = true;
  $('menu').hidden = false;
  G.state = 'menu';
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- input
const canvasEl = () => renderer.domElement;
function lock() {
  try {
    const r = canvasEl().requestPointerLock && canvasEl().requestPointerLock();
    if (r && r.catch) r.catch(() => {});
  } catch (e) { /* pointer lock unavailable */ }
}
addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  if (!e.repeat) G.pressed[e.code] = true;
  G.keys[e.code] = true;
  if (e.repeat) return;
  if (G.state === 'play') {
    if (e.code === 'KeyM') openMap();
    if (e.code === 'KeyP' || e.code === 'Escape') pause();
    if (e.code === 'KeyV') cycleZoom();
    if (e.code === 'Tab') radioNext();
    if (e.code === 'KeyT') { G.dayTime = (G.dayTime + 1) % 24; notify(`Time skipped to ${Math.floor(G.dayTime)}:00`); }
    if (e.code === 'KeyN') { setMuted(!muted); notify(muted ? 'Sound off' : 'Sound on'); }
  } else if (G.state === 'map') {
    if (e.code === 'KeyM' || e.code === 'Escape') closeMap();
  } else if (G.state === 'paused') {
    if (e.code === 'KeyP') resume();
  }
});
addEventListener('keyup', (e) => {
  G.keys[e.code] = false;
});
addEventListener('mousemove', (e) => {
  if (G.state !== 'play') return;
  if (document.pointerLockElement || G.mouse.free) {
    G.mouse.dx += e.movementX || 0;
    G.mouse.dy += e.movementY || 0;
  }
});
addEventListener('mousedown', (e) => {
  if (G.state !== 'play') return;
  if (!document.pointerLockElement && !G.mouse.free) lock();
  if (e.button === 0) { G.mouse.left = true; G.mouse.leftPressed = true; }
  if (e.button === 2) G.mouse.right = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) G.mouse.left = false;
  if (e.button === 2) G.mouse.right = false;
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => { if (G.state === 'play') G.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
addEventListener('blur', () => { G.keys = {}; G.mouse.left = G.mouse.right = false; if (G.state === 'play') pause(); });
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && G.state === 'play' && !G.mouse.free) pause();
});
document.addEventListener('pointerlockerror', () => { G.mouse.free = true; });
addEventListener('resize', onResize);
function onResize() {
  if (!renderer) return;
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  setFxScale((innerHeight * renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360)));
}

// ---------------------------------------------------------------- states
function play() {
  initAudio();
  $('menu').hidden = true;
  $('pause').hidden = true;
  $('hud').hidden = false;
  G.state = 'play';
  lock();
  if (!G.started) {
    G.started = true;
    help('Walk with <b>WASD</b>, look with the <b>mouse</b>. Press <b>F</b> near a car to get in — the red sports car is right behind you. <b>M</b> opens the map. Yellow markers start missions.', 9);
  }
}
function pause() {
  if (G.state !== 'play') return;
  G.state = 'paused';
  G.keys = {};
  G.mouse.left = G.mouse.right = false;
  $('pause').hidden = false;
  pauseRadio();
}
function resume() {
  $('pause').hidden = true;
  G.state = 'play';
  lock();
}
function openMap() {
  G.state = 'map';
  pauseRadio();
  $('mapview').hidden = false;
  drawBigMap();
}
function closeMap() {
  $('mapview').hidden = true;
  G.state = 'play';
  lock();
}
$('btn-play').addEventListener('click', play);
$('btn-resume').addEventListener('click', resume);
$('btn-map-close').addEventListener('click', closeMap);
$('btn-continue').addEventListener('click', respawn);
$('btn-free').addEventListener('click', () => {
  G.mouse.free = !G.mouse.free;
  $('btn-free').textContent = G.mouse.free ? 'Mouse look: always on' : 'Mouse look: captured';
});

let deathKind = null, deathT = 0;
function handleDeath(kind) {
  if (deathKind) return;
  deathKind = kind;
  deathT = 0;
  abortMission();
  sfx('busted');
  if (kind === 'busted') {
    const P = G.player;
    if (P.vehicle) P.exitVehicle(true);
    P.vel.set(0, 0, 0);
  }
}
on('wasted', () => handleDeath('wasted'));
on('busted', () => handleDeath('busted'));

function fmtTime(s) {
  const m = Math.floor(s / 60);
  return `${m} min ${String(Math.floor(s % 60)).padStart(2, '0')} s`;
}
function showResults() {
  const S = G.stats;
  const pursuit = S.pursuitStart !== null ? G.time - S.pursuitStart : 0;
  const stars = '★'.repeat(S.maxWanted) + '☆'.repeat(5 - S.maxWanted);
  showDeathScreen(deathKind, [
    ['Pursuit time', fmtTime(pursuit)],
    ['Distance driven', (S.distance / 1000).toFixed(2) + ' km'],
    ['Top speed', Math.round(S.topSpeed * 3.6) + ' km/h'],
    ['Highest wanted level', stars],
    ['People taken out', S.kills],
    ['Cops taken out', S.copsKilled],
    ['Vehicles destroyed', S.carsDestroyed],
    ['Vehicles stolen', S.carsStolen],
  ]);
  document.exitPointerLock && document.exitPointerLock();
  $('hud').hidden = true;
  pauseRadio();
  G.state = 'dead';
}
function respawn() {
  const P = G.player;
  const busted = deathKind === 'busted';
  const sp = busted ? { x: SPECIAL.police.x - 8, z: SPECIAL.police.z + 1 } : { x: SPECIAL.hospital.spawnX, z: SPECIAL.hospital.spawnZ };
  if (busted) sp.z = SPECIAL.police.z - 9;
  P.reset(sp.x, sp.z);
  P.heading = busted ? 0 : Math.PI;
  G.camYaw = P.heading;
  const fee = Math.min(P.money, busted ? 250 : 150);
  P.money -= fee;
  if (busted) {
    for (const w of Object.keys(P.ammo)) if (w !== 'fist') { P.ammo[w] = 0; P.clip[w] = 0; }
    P.ammo.pistol = 24;
    P.clip.pistol = 12;
    P.weapon = 'pistol';
  }
  P.armor = 0;
  clearWanted();
  // clear the chase
  for (const v of [...G.vehicles]) if (v.isPolice && !v.persist && v.pos.distanceTo(P.pos) < 300) v.remove();
  for (const p of [...G.peds]) if (p.type === 'cop') p.remove();
  $('deathscreen').hidden = true;
  $('hud').hidden = false;
  deathKind = null;
  resetStats();
  snapCamera();
  notify(busted ? `Bail paid: $${fee}. Your weapons were confiscated.` : `Hospital bill: $${fee}.`);
  G.state = 'play';
  lock();
}

// ---------------------------------------------------------------- loop
let last = performance.now();
let fpsT = 0, fpsN = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fpsT += dt; fpsN++;
  if (fpsT > 1) { $('fps').textContent = Math.round(fpsN / fpsT) + ' fps'; fpsT = 0; fpsN = 0; }
  if (G.state === 'play') update(dt);
  else if (G.state === 'menu') {
    // slow orbit behind the menu
    G.time += dt;
    G.camYaw += dt * 0.05;
    updateCamera(dt);
    updateWorld(dt * 0.2, G.player.pos);
  }
  renderer.render(scene, camera);
  G.pressed = {};
  G.mouse.leftPressed = false;
}

function update(dt) {
  if (deathKind) {
    // slow motion before the results screen
    deathT += dt;
    dt *= 0.35;
    G.keys = {};
    G.mouse.left = false;
    if (deathT > 2.6) showResults();
  }
  G.time += dt;
  const P = G.player;
  P.update(dt);
  for (const v of [...G.vehicles]) if (!v.removed) v.update(dt);
  collideVehicles(dt);
  vehiclePedCollisions();
  updatePeds(dt);
  updateTraffic(dt);
  updateFixed(dt);
  updatePolice(dt);
  updateRockets(dt);
  updateFx(dt);
  updateMissions(dt);
  if (P.vehicle) {
    const sp = P.vehicle.speedAbs;
    G.stats.distance += sp * dt;
    G.stats.topSpeed = Math.max(G.stats.topSpeed, sp);
  }
  updateCamera(dt);
  focus.copy(P.vehicle ? P.vehicle.pos : P.pos);
  updateWorld(dt, focus);
  updateHud(dt);
  updateAudio(dt);
  // fell out of the world
  if (P.pos.y < -60 && !P.vehicle) { const sp = cityPt(START.x, START.z); P.reset(sp.x, sp.z); }
}

on('enterVehicle', (v) => {
  showVehicleName(v.spec.name);
  const k = v.kind;
  if (k === 'car' || k === 'bike')
    help('<b>W/S</b> gas / brake · <b>A/D</b> steer · <b>Space</b> handbrake · <b>H</b> horn · <b>F</b> exit · hold <b>LMB</b> for drive-by', 6);
  else if (k === 'boat') help('<b>W/S</b> throttle · <b>A/D</b> steer · <b>F</b> exit', 5);
  else if (k === 'heli') help('<b>Space</b> / <b>Shift</b> climb / descend · <b>W/S</b> forward / back · <b>A/D</b> turn · <b>Q/E</b> strafe · <b>F</b> exit', 8);
  else if (k === 'plane') help('<b>W/S</b> throttle up / down · <b>A/D</b> roll · <b>↑/↓</b> (or <b>Shift/Space</b>) pitch · <b>Q/E</b> rudder. Build speed on the runway, then pull up.', 9);
});
on('vehicleDestroyed', (v) => {
  if (v === G.player.vehicle) G.player.hurt(999, v.lastHitBy);
});
void clamp; void groundHeight; void wanted;

// test/debug hook: step the simulation without rendering
window.__game = { G, step(n, dt = 1 / 30) { for (let i = 0; i < n; i++) { update(dt); G.pressed = {}; G.mouse.leftPressed = false; } } };

boot();
