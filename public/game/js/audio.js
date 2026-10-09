// Procedural WebAudio sound: engines, sirens, guns, explosions.
import { G, clamp } from './core.js';

let ctx = null, master, noiseBuf;
let eng, siren, rotor, wind;
export let muted = false;

export function initAudio() {
  if (ctx) { ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    return;
  }
  master = ctx.createGain();
  master.gain.value = 0.6;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  // engine
  eng = { g: ctx.createGain(), f: ctx.createBiquadFilter(), o1: ctx.createOscillator(), o2: ctx.createOscillator() };
  eng.o1.type = 'sawtooth';
  eng.o2.type = 'square';
  eng.f.type = 'lowpass';
  eng.f.frequency.value = 600;
  eng.g.gain.value = 0;
  eng.o1.connect(eng.f);
  eng.o2.connect(eng.f);
  eng.f.connect(eng.g);
  eng.g.connect(master);
  eng.o1.start();
  eng.o2.start();
  // siren
  siren = { g: ctx.createGain(), o: ctx.createOscillator(), lfo: ctx.createOscillator(), lg: ctx.createGain() };
  siren.o.type = 'square';
  siren.o.frequency.value = 850;
  siren.lfo.type = 'square';
  siren.lfo.frequency.value = 1.6;
  siren.lg.gain.value = 180;
  siren.lfo.connect(siren.lg);
  siren.lg.connect(siren.o.frequency);
  const sf = ctx.createBiquadFilter();
  sf.type = 'lowpass';
  sf.frequency.value = 1800;
  siren.o.connect(sf);
  sf.connect(siren.g);
  siren.g.gain.value = 0;
  siren.g.connect(master);
  siren.o.start();
  siren.lfo.start();
  // rotor
  rotor = { g: ctx.createGain(), src: ctx.createBufferSource(), f: ctx.createBiquadFilter(), am: ctx.createGain(), lfo: ctx.createOscillator(), lg: ctx.createGain() };
  rotor.src.buffer = noiseBuf;
  rotor.src.loop = true;
  rotor.f.type = 'lowpass';
  rotor.f.frequency.value = 400;
  rotor.lfo.frequency.value = 11;
  rotor.lg.gain.value = 0.5;
  rotor.am.gain.value = 0.5;
  rotor.lfo.connect(rotor.lg);
  rotor.lg.connect(rotor.am.gain);
  rotor.src.connect(rotor.f);
  rotor.f.connect(rotor.am);
  rotor.am.connect(rotor.g);
  rotor.g.gain.value = 0;
  rotor.g.connect(master);
  rotor.src.start();
  rotor.lfo.start();
  // wind (speed)
  wind = { g: ctx.createGain(), src: ctx.createBufferSource(), f: ctx.createBiquadFilter() };
  wind.src.buffer = noiseBuf;
  wind.src.loop = true;
  wind.f.type = 'bandpass';
  wind.f.frequency.value = 700;
  wind.src.connect(wind.f);
  wind.f.connect(wind.g);
  wind.g.gain.value = 0;
  wind.g.connect(master);
  wind.src.start();
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.6;
}

function distVol(pos) {
  if (!pos) return 1;
  const c = G.camera.position;
  const d = Math.hypot(pos.x - c.x, pos.y - c.y, pos.z - c.z);
  return clamp(1 - d / 220, 0, 1) ** 2;
}

function noiseBurst(dur, freq, vol, type = 'lowpass', q = 1, sweepTo = null) {
  const t = ctx.currentTime;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f);
  f.connect(g);
  g.connect(master);
  s.start(t, Math.random());
  s.stop(t + dur + 0.05);
}
function tone(freq, dur, vol, type = 'sine', to = null, delay = 0) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export function sfx(name, pos = null) {
  if (!ctx || muted) return;
  const v = distVol(pos);
  if (v <= 0.01) return;
  switch (name) {
    case 'pistol': noiseBurst(0.16, 2600, 0.5 * v); tone(140, 0.12, 0.35 * v, 'triangle', 45); break;
    case 'smg': noiseBurst(0.08, 3200, 0.35 * v); tone(160, 0.07, 0.2 * v, 'triangle', 60); break;
    case 'rifle': noiseBurst(0.12, 2200, 0.45 * v); tone(120, 0.1, 0.3 * v, 'triangle', 40); break;
    case 'shotgun': noiseBurst(0.35, 1500, 0.7 * v); tone(90, 0.25, 0.5 * v, 'triangle', 30); break;
    case 'rpg': noiseBurst(0.7, 400, 0.5 * v, 'bandpass', 2, 3000); break;
    case 'explosion': noiseBurst(1.8, 700, 1.0 * v, 'lowpass', 1, 80); tone(70, 1.0, 0.7 * v, 'sine', 25); break;
    case 'punch': noiseBurst(0.08, 600, 0.25); break;
    case 'hit': tone(110, 0.1, 0.4, 'sine', 50); break;
    case 'empty': tone(2200, 0.03, 0.15, 'square'); break;
    case 'crash': noiseBurst(0.35, 1100, 0.6 * v); tone(80, 0.2, 0.4 * v, 'sine', 40); break;
    case 'horn': tone(420, 0.45, 0.12 * v, 'square'); tone(530, 0.45, 0.1 * v, 'square'); break;
    case 'pickup': tone(880, 0.1, 0.2, 'sine'); tone(1320, 0.15, 0.2, 'sine', null, 0.08); break;
    case 'cash': tone(1200, 0.08, 0.15, 'square'); tone(1600, 0.12, 0.15, 'square', null, 0.07); break;
    case 'door': noiseBurst(0.12, 900, 0.3); break;
    case 'reload': tone(1500, 0.03, 0.12, 'square'); tone(900, 0.04, 0.12, 'square', null, 0.25); break;
    case 'mission': [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 0.2, 'triangle', null, i * 0.12)); break;
    case 'fail': [392, 330, 262].forEach((f, i) => tone(f, 0.35, 0.2, 'triangle', null, i * 0.18)); break;
    case 'checkpoint': tone(1046, 0.12, 0.2, 'sine'); break;
    case 'wanted': tone(660, 0.15, 0.15, 'square'); tone(880, 0.2, 0.15, 'square', null, 0.12); break;
    case 'splash': noiseBurst(0.6, 1200, 0.5 * v, 'lowpass', 1, 300); break;
    case 'busted': tone(196, 1.2, 0.3, 'sawtooth', 98); break;
  }
}

export function updateAudio(dt) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const P = G.player;
  const v = P && P.vehicle;
  let eGain = 0, eFreq = 60, rGain = 0, wGain = 0;
  if (v && !v.dead && G.state === 'play') {
    const sp = v.speedAbs;
    if (v.kind === 'car' || v.kind === 'bike' || v.kind === 'boat') {
      const ratio = clamp(Math.abs(v.fwdSpeed) / v.spec.speed, 0, 1);
      const gears = v.kind === 'bike' ? 6 : 5;
      const g = Math.min(gears - 1, Math.floor(ratio * gears));
      const rpm = ratio * gears - g;
      eFreq = (v.kind === 'bike' ? 70 : 45) + rpm * (v.kind === 'bike' ? 120 : 80) + g * 6 + Math.abs(v.input.throttle) * 8;
      eGain = 0.05 + Math.abs(v.input.throttle) * 0.05;
      if (v.kind === 'boat') eFreq *= 0.8;
    } else if (v.kind === 'plane') {
      eFreq = 70 + v.throttleLevel * 120 + v.speed * 0.4;
      eGain = 0.03 + v.throttleLevel * 0.07;
    } else if (v.kind === 'heli') {
      rGain = v.rotor * 0.35;
      eFreq = 90 + v.rotor * 30;
      eGain = v.rotor * 0.02;
    }
    wGain = clamp(sp / 80, 0, 1) * 0.12;
  }
  // nearby choppers (police)
  for (const h of G.vehicles) {
    if (h.kind === 'heli' && h !== v && h.rotor > 0.2) {
      const d = h.pos.distanceTo(G.camera.position);
      rGain = Math.max(rGain, clamp(1 - d / 250, 0, 1) * 0.25 * h.rotor);
    }
  }
  eng.o1.frequency.setTargetAtTime(eFreq, t, 0.05);
  eng.o2.frequency.setTargetAtTime(eFreq * 0.5, t, 0.05);
  eng.f.frequency.setTargetAtTime(300 + eFreq * 4, t, 0.05);
  eng.g.gain.setTargetAtTime(eGain, t, 0.08);
  rotor.g.gain.setTargetAtTime(rGain, t, 0.1);
  wind.g.gain.setTargetAtTime(wGain, t, 0.2);
  // sirens
  let sGain = 0;
  for (const c of G.vehicles) {
    if (!c.siren || c.dead) continue;
    const d = c.pos.distanceTo(G.camera.position);
    sGain = Math.max(sGain, clamp(1 - d / 300, 0, 1) ** 1.5 * 0.08);
  }
  if (G.state !== 'play') sGain = 0;
  siren.g.gain.setTargetAtTime(sGain, t, 0.1);
  siren.lfo.type = G.wanted && G.wanted.level >= 3 ? 'sine' : 'square';
  siren.lfo.frequency.value = G.wanted && G.wanted.level >= 3 ? 0.35 : 1.6;
  siren.lg.gain.value = G.wanted && G.wanted.level >= 3 ? 320 : 180;
}
