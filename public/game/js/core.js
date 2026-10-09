// Shared game state and small math helpers.
export const G = {
  scene: null,
  camera: null,
  renderer: null,
  time: 0,
  dayTime: 10, // hours, 0..24
  night: 0, // 0 = day, 1 = full night
  state: 'loading', // loading | menu | play | paused | dead | map
  player: null,
  vehicles: [],
  peds: [],
  keys: {},
  pressed: {}, // keys pressed this frame
  mouse: { dx: 0, dy: 0, left: false, right: false, leftPressed: false, wheel: 0, locked: false },
  uniforms: { uNight: { value: 0 }, uTime: { value: 0 } },
  camYaw: 0,
  camPitch: 0.25,
  shake: 0,
  stats: null,
};

export const WATER = 0;
export const GRAV = 24;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function sstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export function angWrap(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));

export function resetStats() {
  G.stats = {
    start: G.time,
    distance: 0,
    topSpeed: 0,
    kills: 0,
    copsKilled: 0,
    carsDestroyed: 0,
    carsStolen: 0,
    maxWanted: 0,
    pursuitStart: null,
  };
}

// small event bus
const listeners = {};
export function on(evt, fn) {
  (listeners[evt] = listeners[evt] || []).push(fn);
  return () => {
    const l = listeners[evt];
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  };
}
export function emit(evt, ...args) {
  (listeners[evt] || []).slice().forEach((fn) => fn(...args));
}
