// car_physics.js — raycast-vehicle model for Crimson Coast (cars + motorbikes).
//
// Dependency-free ES module (no three.js import) so it runs in the browser and in node.
// Units: SI (m, kg, s, N, Nm, rad). World axes match the game: +Y up, heading 0 faces +Z.
// Body frame: origin at the centre of gravity (CoG), +Z forward, +Y up, +X = LEFT
// (right-handed, same as a three.js object with rotation.y = heading).
// Input convention matches Player.vehicleControl(): steer +1 = turn right (KeyD),
// throttle +1 = W, -1 = S (brake, then reverse when nearly stopped), handbrake = Space.
//
// Model overview (per fixed substep h = 1/120 s):
//   1. resolve input (smoothing, GTA-style brake/reverse logic, speed-sensitive steering,
//      countersteer assist, self-aligning return)
//   2. per wheel: ray along body -Y from the strut mount, groundQuery() gives the surface,
//      spring/damper (+ bump stop) -> normal load Fz, anti-roll bars per axle
//   3. tyre model: slip ratio kappa + slip angle alpha -> combined-slip "magic formula"
//      (normalised slip vector, friction ellipse, load sensitivity)
//   4. drivetrain: torque curve, torque converter, automatic gearbox, limited-slip diff,
//      brakes with ABS, traction control, handbrake on the rear axle (no ABS -> locks)
//   5. wheel spin integrated semi-implicitly (linearised backward Euler) so stiff tyres
//      stay stable at 120 Hz even at walking pace
//   6. aero drag/downforce, rolling resistance, body-corner contacts (roof/bumpers on
//      the ground), air control, motorbike lean controller
//   7. rigid body integration (semi-implicit Euler, quaternion orientation)
// Collisions against static OBB/cylinder colliders and between vehicles are impulse-based
// (see collideStatic / collideBodies at the bottom).

export const GRAVITY = 9.81;
const RHO = 1.225; // air density
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const approach = (v, t, d) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));

// ----------------------------------------------------------------------------- presets
// Engine curve: [rpm, Nm] pairs (full-throttle torque at the crank).
// Gears: forward ratios; reverse is separate. finalDrive multiplies all of them.
// Suspension is given as natural frequency (Hz) + damping ratio; spring rates are derived
// from the axle loads so a preset stays balanced when the mass changes.
const BASE = {
  mass: 1400, // kg
  inertiaScale: 1, // multiply the box-derived inertia
  length: 4.5, width: 1.9, height: 1.45, // body box (m), used for inertia + collisions
  wheelbase: 2.7, cgToFront: 1.3, // distance CoG -> front axle (m)
  trackF: 1.58, trackR: 1.58,
  cgHeight: 0.55, // CoG above ground at static ride height
  wheelRadius: 0.33, wheelMass: 20, wheelInertia: 1.0, // kg m^2 incl. brake disc
  // suspension
  restLength: 0.32, maxTravel: 0.25, // strut free length, usable compression before bump stop
  freqF: 1.6, freqR: 1.75, dampRatio: 0.35, reboundRatio: 1.5, bumpStopRate: 8, // x spring rate
  damperKnee: 0.35, damperHigh: 0.5, // m/s knee, high-speed damping ratio (digressive valving)
  arbF: 14000, arbR: 7000, // anti-roll bar N/m (difference in compression L-R)
  // tyres
  mu: 1.05, muX: 1.05, // peak friction (lateral, longitudinal scale)
  kappaPeak: 0.10, alphaPeak: 0.14, // slip at peak force (slip ratio / slip angle rad)
  mfB: 1.871, mfC: 1.45, mfE: 0.0, // shape so that peak is at normalised slip 1, slide = 76 %
  loadSens: 0.12, // friction drop per unit of (Fz/Fz0 - 1)
  vMinSlip: 3.0, // m/s, denominator floor for slip at low speed (stability)
  rollingResist: 0.013,
  pneumaticTrail: 0.035, // m, for self-aligning torque
  forceHeight: 0.2, // 0 = tyre forces at contact patch, 1 = at CoG height (anti-rollover assist)
  // engine / drivetrain
  drive: 'rwd', // 'fwd' | 'rwd' | 'awd'
  awdFront: 0.4, // torque fraction to the front in AWD
  idleRPM: 850, redline: 6500, stallRPM: 2600, engineInertia: 0.18,
  torqueCurve: [[800, 150], [2000, 215], [3500, 240], [4800, 245], [6000, 215], [6800, 180]],
  engineBrake: 45, // Nm at redline, closed throttle
  gears: [3.6, 2.19, 1.41, 1.0, 0.83, 0.69],
  reverseRatio: 3.3, finalDrive: 3.7, driveEff: 0.88,
  shiftTime: 0.22, lsd: 60, lsdMax: 400, // viscous LSD coupling Nm/(rad/s), cap
  // brakes
  brakeTorque: 2600, brakeBias: 0.66, handbrakeTorque: 2500, // per wheel max
  // aero
  cdA: 0.70, clA: 0.0, // drag area (Cd*A m^2), downforce area
  // steering + assists
  maxSteer: 0.60, steerSpeedRef: 0.85, // rad; speed-sensitive limit keeps steer near peak slip
  steerRate: 4.0, steerReturn: 6.0, // normalised units / s
  throttleRate: 5, brakeRate: 8,
  abs: true, absSlip: 0.14,
  tc: 0.6, tcSlip: 0.18, // traction control strength 0..1
  countersteer: 0.7, // 0..1
  yawAssist: 0.0, // extra yaw damping torque fraction (GTA "grip" feel); 0 = pure physics
  airControl: 3.0, airMaxRate: 1.2, // air control: max angular accel (rad/s^2) and rate (rad/s)
  vmax: Infinity, // m/s electronic limiter (many real cars are governed; also game balance)
  // bike
  bike: false, leanMax: 0.85, leanKp: 9, leanKd: 1.6, // (x Ixx) natural freq / damping of rider
  // body contacts
  bodyFriction: 0.45, bodyRestitution: 0.15,
  frontGrip: 1.0, // front tyre grip multiplier (<1 = built-in understeer)
  wheelProbe: true, // 2 extra ground samples per wheel for kerbs/steps
  airPitchDamp: 0.6, // 1/s, pitch-rate damping while airborne (rider/driver balance assist)
  gravity: GRAVITY,
};

export const PRESETS = {
  sedan: {},
  taxi: {},
  hatchback: { mass: 1150, length: 4.1, wheelbase: 2.55, cgToFront: 1.05, drive: 'fwd', torqueCurve: [[800, 130], [2000, 190], [3500, 215], [5000, 210], [6200, 180], [6800, 150]], cdA: 0.66 },
  sports: {
    mass: 1350, length: 4.4, width: 1.95, height: 1.2, wheelbase: 2.55, cgToFront: 1.22, cgHeight: 0.45,
    trackF: 1.62, trackR: 1.6, freqF: 2.1, freqR: 2.3, dampRatio: 0.4, arbF: 30000, arbR: 18000,
    mu: 1.2, muX: 1.15, redline: 7600, idleRPM: 950, stallRPM: 3000,
    torqueCurve: [[900, 260], [2500, 400], [4500, 470], [6000, 480], [7000, 440], [7800, 380]],
    gears: [3.2, 2.15, 1.6, 1.25, 1.0, 0.82], finalDrive: 3.42, cdA: 0.62, clA: 0.25,
    brakeTorque: 3400, maxSteer: 0.58, tc: 0.4,
  },
  police: { mass: 1700, length: 4.7, wheelbase: 2.9, cgToFront: 1.38, torqueCurve: [[800, 280], [2500, 420], [4000, 470], [5200, 450], [6000, 400], [6500, 340]], mu: 1.1, brakeTorque: 3200, cdA: 0.75 },
  suv: { mass: 2100, length: 4.9, width: 2.05, height: 1.9, wheelbase: 2.9, cgToFront: 1.4, cgHeight: 0.75, trackF: 1.65, trackR: 1.65, wheelRadius: 0.38, wheelInertia: 1.6, drive: 'awd', restLength: 0.36, maxTravel: 0.26, freqF: 1.4, freqR: 1.5, mu: 1.0, torqueCurve: [[800, 280], [2000, 400], [3500, 430], [5000, 400], [6000, 330]], redline: 6000, brakeTorque: 3600, cdA: 1.05 },
  pickup: { mass: 2200, length: 5.2, wheelbase: 3.3, cgToFront: 1.45, cgHeight: 0.75, wheelRadius: 0.38, wheelInertia: 1.6, restLength: 0.36, maxTravel: 0.26, freqF: 1.4, freqR: 1.6, mu: 0.98, torqueCurve: [[800, 300], [2000, 420], [3500, 450], [5000, 400], [5800, 330]], redline: 5800, brakeTorque: 3600, cdA: 1.1 },
  van: { mass: 2400, length: 5.0, width: 2.1, height: 2.1, wheelbase: 3.2, cgToFront: 1.5, cgHeight: 0.85, wheelRadius: 0.36, drive: 'fwd', freqF: 1.4, freqR: 1.6, mu: 0.95, torqueCurve: [[800, 260], [2000, 360], [3500, 380], [5000, 330], [5800, 260]], redline: 5800, brakeTorque: 3600, cdA: 1.3 },
  truck: { mass: 7500, length: 7.2, width: 2.5, height: 3.2, wheelbase: 4.4, cgToFront: 1.9, cgHeight: 1.15, trackF: 2.0, trackR: 1.9, wheelRadius: 0.5, wheelInertia: 8, restLength: 0.42, maxTravel: 0.3, freqF: 1.3, freqR: 1.4, arbF: 90000, arbR: 90000, mu: 0.9, idleRPM: 650, redline: 3200, stallRPM: 1700, torqueCurve: [[600, 700], [1200, 1100], [1800, 1150], [2500, 1000], [3200, 800]], gears: [5.5, 3.4, 2.2, 1.5, 1.1, 0.85], finalDrive: 4.1, brakeTorque: 9000, handbrakeTorque: 9000, cdA: 5.5, maxSteer: 0.55, forceHeight: 0.5 },
  bus: { mass: 11000, length: 11, width: 2.6, height: 3.2, wheelbase: 6.0, cgToFront: 3.4, cgHeight: 1.2, trackF: 2.1, trackR: 2.0, wheelRadius: 0.55, wheelInertia: 10, restLength: 0.4, maxTravel: 0.28, freqF: 1.2, freqR: 1.3, arbF: 140000, arbR: 140000, mu: 0.88, idleRPM: 600, redline: 2800, stallRPM: 1600, torqueCurve: [[600, 1100], [1200, 1500], [1800, 1500], [2400, 1250], [2800, 1000]], gears: [4.8, 2.9, 1.9, 1.35, 1.0, 0.8], finalDrive: 4.6, brakeTorque: 12000, handbrakeTorque: 12000, cdA: 6.5, maxSteer: 0.6, forceHeight: 0.5 },
  racecar: { mass: 1100, length: 4.6, width: 2.0, height: 1.0, wheelbase: 2.7, cgToFront: 1.4, cgHeight: 0.33, trackF: 1.7, trackR: 1.65, freqF: 2.8, freqR: 3.0, dampRatio: 0.45, restLength: 0.2, maxTravel: 0.1, mu: 1.45, muX: 1.35, redline: 8500, idleRPM: 1200, stallRPM: 3500, torqueCurve: [[1000, 300], [3000, 480], [5500, 560], [7500, 540], [8600, 470]], gears: [3.0, 2.2, 1.7, 1.38, 1.15, 0.98], finalDrive: 3.3, cdA: 0.8, clA: 1.8, brakeTorque: 4200, tc: 0.25, maxSteer: 0.5 },
  bike: {
    bike: true, mass: 280, // bike + rider
    length: 2.1, width: 0.7, height: 1.25, wheelbase: 1.45, cgToFront: 0.72, cgHeight: 0.62,
    trackF: 0, trackR: 0, wheelRadius: 0.31, wheelInertia: 0.6, restLength: 0.32, maxTravel: 0.24,
    freqF: 2.0, freqR: 2.2, dampRatio: 0.45, arbF: 0, arbR: 0, mu: 1.15, muX: 1.15,
    idleRPM: 1200, redline: 11000, stallRPM: 4000, engineInertia: 0.05,
    torqueCurve: [[1000, 45], [4000, 80], [7000, 100], [9500, 95], [11500, 75]],
    gears: [2.8, 2.0, 1.6, 1.35, 1.17, 1.05], reverseRatio: 2.8, finalDrive: 3.0,
    brakeTorque: 900, brakeBias: 0.7, handbrakeTorque: 600, cdA: 0.45,
    maxSteer: 0.45, steerSpeedRef: 0.1, frontGrip: 0.92, forceHeight: 0, countersteer: 0.5, tc: 0.7,
    lsd: 0, lsdMax: 0, bodyFriction: 0.6, airPitchDamp: 3,
  },
};

// Build a full parameter set: preset + overrides + derived constants.
export function makeParams(preset = 'sedan', overrides = {}) {
  const p = Object.assign({}, BASE, PRESETS[preset] || {}, overrides);
  const L = p.wheelbase, a = p.cgToFront, b = L - a;
  const g = p.gravity;
  // static axle loads
  const nPerAxle = p.bike ? 1 : 2;
  p.cornerMassF = (p.mass * b) / L / nPerAxle;
  p.cornerMassR = (p.mass * a) / L / nPerAxle;
  p.kF = p.cornerMassF * (TAU * p.freqF) ** 2;
  p.kR = p.cornerMassR * (TAU * p.freqR) ** 2;
  p.cF = 2 * p.dampRatio * Math.sqrt(p.kF * p.cornerMassF);
  p.cR = 2 * p.dampRatio * Math.sqrt(p.kR * p.cornerMassR);
  p.Fz0 = (p.mass * g) / (nPerAxle * 2); // nominal tyre load for load sensitivity
  // inertia of a solid box, scaled down a bit (mass is concentrated low and central)
  const m = p.mass * 0.85 * p.inertiaScale, w = p.width, hgt = p.height, len = p.length;
  p.Ix = (m / 12) * (hgt * hgt + len * len); // pitch (about left axis)
  p.Iy = (m / 12) * (w * w + len * len); // yaw
  p.Iz = (m / 12) * (w * w + hgt * hgt) * (p.bike ? 2.2 : 1); // roll (rider adds roll inertia)
  p.tanAlphaPeak = Math.tan(p.alphaPeak);
  p.maxGear = p.gears.length;
  return p;
}

// Map the game's VSPEC entries (models.js) onto presets.
export function presetForVehicleType(type, spec) {
  const map = { luxury: 'suv', firetruck: 'truck', garbage: 'truck', ambulance: 'van', tractor: 'pickup', bicycle: 'bike' };
  return PRESETS[type] ? type : map[type] || (spec && spec.kind === 'bike' ? 'bike' : 'sedan');
}
// Fraction of the wheelbase between the CoG and the front axle for a type's preset
// (assets.js puts a realistic model's origin there so its wheels line up with the sim).
export function cgFractionForVehicleType(type, spec) {
  const p = Object.assign({}, BASE, PRESETS[presetForVehicleType(type, spec)] || {});
  return p.cgToFront / p.wheelbase;
}
export function paramsForVehicleType(type, spec, extra = {}) {
  const preset = presetForVehicleType(type, spec);
  const o = {};
  if (spec) {
    o.length = spec.len; o.width = spec.wid; o.height = spec.height;
    if (spec.wheelR) o.wheelRadius = spec.wheelR;
    if (spec.speed) o.vmax = spec.speed * 1.1; // keep the game's per-class top speeds as a governor
    // realistic models measure their own wheel layout (assets.js vehicleTemplate)
    const g = spec.geom;
    if (g) {
      o.wheelbase = g.wheelbase; o.cgToFront = g.cgToFront;
      o.trackF = g.trackF; o.trackR = g.trackR; o.wheelRadius = g.wheelR;
    }
  }
  if (type === 'bicycle') Object.assign(o, { mass: 95, torqueCurve: [[300, 25], [1500, 30], [3000, 20]], redline: 3000, idleRPM: 0, stallRPM: 300, cdA: 0.5, brakeTorque: 250 });
  return makeParams(preset, Object.assign(o, extra));
}

// Interpolate the torque curve.
function curveTorque(curve, rpm) {
  if (rpm <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    if (rpm <= curve[i][0]) {
      const [r0, t0] = curve[i - 1], [r1, t1] = curve[i];
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  }
  return curve[curve.length - 1][1];
}

// Combined-slip tyre: normalise both slips by their peak values, run one magic-formula
// curve on the length of the slip vector, then split the force along that vector.
// This gives a friction ellipse automatically (full braking leaves no lateral grip, a
// locked or spinning wheel slides sideways) and is smooth everywhere.
const TF = { fx: 0, fy: 0, sNorm: 0 };
function tyre(p, Fz, kappa, tanAlpha, gripScale) {
  if (Fz <= 0) { TF.fx = TF.fy = TF.sNorm = 0; return TF; }
  const muEff = p.mu * gripScale * clamp(1 - p.loadSens * (Fz / p.Fz0 - 1), 0.65, 1.15);
  const sx = kappa / p.kappaPeak, sy = tanAlpha / p.tanAlphaPeak;
  const s = Math.hypot(sx, sy);
  TF.sNorm = s;
  const D = muEff * Fz;
  let f_over_s; // force / s  (finite at s -> 0)
  if (s < 1e-4) f_over_s = D * p.mfC * p.mfB;
  else {
    const Bs = p.mfB * s;
    f_over_s = (D * Math.sin(p.mfC * Math.atan(Bs - p.mfE * (Bs - Math.atan(Bs))))) / s;
  }
  TF.fx = f_over_s * sx * (p.muX / p.mu);
  TF.fy = -f_over_s * sy; // opposes the lateral slip velocity
  return TF;
}

// ----------------------------------------------------------------------------- vehicle
export class RaycastVehicle {
  constructor(params, init = {}) {
    const p = (this.p = params);
    this.pos = { x: init.x || 0, y: 0, z: init.z || 0 };
    const h = init.heading || 0;
    this.q = { x: 0, y: Math.sin(h / 2), z: 0, w: Math.cos(h / 2) };
    this.vel = { x: 0, y: 0, z: 0 };
    this.angVel = { x: 0, y: 0, z: 0 }; // world frame
    this.R = new Float64Array(9); // rotation matrix, row-major; columns = body axes in world
    this._updateR();
    this.pos.y = (init.y ?? 0) + p.cgHeight;
    // wheels
    const a = p.cgToFront, b = p.wheelbase - a;
    const mk = (x, z, front, side) => {
      const k = front ? p.kF : p.kR;
      const sag = ((front ? p.cornerMassF : p.cornerMassR) * p.gravity) / k;
      return {
        front, side, // side +1 = left, -1 = right, 0 = centre (bike)
        lx: x, lz: z,
        ly: -p.cgHeight + p.wheelRadius + p.restLength - sag, // strut top in body frame
        k, c: front ? p.cF : p.cR,
        driven: p.drive === 'awd' || (p.drive === 'fwd' ? front : !front),
        omega: 0, spin: 0, steer: 0,
        comp: 0, compPrev: 0, contact: false, Fz: 0, Fx: 0, Fy: 0, kappa: 0, alpha: 0, sNorm: 0,
        absScale: 1, Mz: 0,
        cx: 0, cy: 0, cz: 0, nx: 0, ny: 1, nz: 0, // contact point and ground normal
        surfaceGrip: 1,
      };
    };
    this.wheels = p.bike
      ? [mk(0, a, true, 0), mk(0, -b, false, 0)]
      : [mk(p.trackF / 2, a, true, 1), mk(-p.trackF / 2, a, true, -1), mk(p.trackR / 2, -b, false, 1), mk(-p.trackR / 2, -b, false, -1)];
    // body collision corners (body frame): bottom 4, top 4
    const hl = p.length / 2, hw = p.width / 2, yb = -p.cgHeight + 0.18, yt = p.height - p.cgHeight;
    this.corners = [];
    for (const y of [yb, yt]) for (const sx of [1, -1]) for (const sz of [1, -1]) this.corners.push([sx * hw, y, sz * hl]);
    // drivetrain + controls state
    this.gear = 1; this.rpm = p.idleRPM; this.shiftT = 0; this.shiftCooldown = 0;
    this.tcScale = 1;
    this.ctl = { throttle: 0, brake: 0, steer: 0, handbrake: 0, drive: 0 };
    this.steerAngle = 0;
    this.acc = 0; // fixed-step accumulator
    this.h = 1 / 120;
    this.maxSubsteps = 8;
    this.wheelsOnGround = 0;
    this.airTime = 0;
    this.lastImpact = 0;
    this.telemetry = { speed: 0, kmh: 0, rpm: 0, gear: 1, latG: 0, longG: 0, slip: 0, skid: 0, abs: false, tc: false };
    this._prevVel = { x: 0, y: 0, z: 0 };
  }

  // ---- helpers -------------------------------------------------------------
  _updateR() {
    const { x, y, z, w } = this.q, R = this.R;
    R[0] = 1 - 2 * (y * y + z * z); R[1] = 2 * (x * y - z * w); R[2] = 2 * (x * z + y * w);
    R[3] = 2 * (x * y + z * w); R[4] = 1 - 2 * (x * x + z * z); R[5] = 2 * (y * z - x * w);
    R[6] = 2 * (x * z - y * w); R[7] = 2 * (y * z + x * w); R[8] = 1 - 2 * (x * x + y * y);
  }
  // body -> world direction
  toWorld(lx, ly, lz, o) {
    const R = this.R;
    o.x = R[0] * lx + R[1] * ly + R[2] * lz;
    o.y = R[3] * lx + R[4] * ly + R[5] * lz;
    o.z = R[6] * lx + R[7] * ly + R[8] * lz;
    return o;
  }
  // world -> body direction
  toBody(x, y, z, o) {
    const R = this.R;
    o.x = R[0] * x + R[3] * y + R[6] * z;
    o.y = R[1] * x + R[4] * y + R[7] * z;
    o.z = R[2] * x + R[5] * y + R[8] * z;
    return o;
  }
  // inverse world inertia times vector
  invInertia(x, y, z, o) {
    const p = this.p;
    this.toBody(x, y, z, o);
    const bx = o.x / p.Ix, by = o.y / p.Iy, bz = o.z / p.Iz;
    return this.toWorld(bx, by, bz, o);
  }
  // velocity of a world point
  pointVel(px, py, pz, o) {
    const rx = px - this.pos.x, ry = py - this.pos.y, rz = pz - this.pos.z, w = this.angVel;
    o.x = this.vel.x + w.y * rz - w.z * ry;
    o.y = this.vel.y + w.z * rx - w.x * rz;
    o.z = this.vel.z + w.x * ry - w.y * rx;
    return o;
  }
  // apply an impulse J (world) at world point P
  applyImpulse(px, py, pz, jx, jy, jz) {
    const m = this.p.mass;
    this.vel.x += jx / m; this.vel.y += jy / m; this.vel.z += jz / m;
    const rx = px - this.pos.x, ry = py - this.pos.y, rz = pz - this.pos.z;
    const t = this.invInertia(ry * jz - rz * jy, rz * jx - rx * jz, rx * jy - ry * jx, _t0);
    this.angVel.x += t.x; this.angVel.y += t.y; this.angVel.z += t.z;
  }
  // 1 / effective mass of the body at point P along unit n
  invMassAt(px, py, pz, nx, ny, nz) {
    const rx = px - this.pos.x, ry = py - this.pos.y, rz = pz - this.pos.z;
    const t = this.invInertia(ry * nz - rz * ny, rz * nx - rx * nz, rx * ny - ry * nx, _t0);
    // (I^-1 (r x n)) x r . n
    const cx = t.y * rz - t.z * ry, cy = t.z * rx - t.x * rz, cz = t.x * ry - t.y * rx;
    return 1 / this.p.mass + cx * nx + cy * ny + cz * nz;
  }
  get forwardSpeed() { return this.vel.x * this.R[2] + this.vel.y * this.R[5] + this.vel.z * this.R[8]; }
  get speed() { return Math.hypot(this.vel.x, this.vel.y, this.vel.z); }

  // Game-compatible Euler angles: root.rotation.set(-pitch, heading, roll, 'YXZ')
  getEuler(out = {}) {
    const R = this.R;
    const x = Math.asin(-clamp(R[5], -1, 1));
    if (Math.abs(R[5]) < 0.9999999) { out.heading = Math.atan2(R[2], R[8]); out.roll = Math.atan2(R[3], R[4]); }
    else { out.heading = Math.atan2(-R[6], R[0]); out.roll = 0; }
    out.pitch = -x;
    return out;
  }
  // Position of the model root (models are built with y = 0 at the tyre contact patch)
  getRootPosition(out = {}) {
    const d = this.toWorld(0, -this.p.cgHeight, 0, _t1);
    out.x = this.pos.x + d.x; out.y = this.pos.y + d.y; out.z = this.pos.z + d.z;
    return out;
  }
  isFlipped() { return this.R[4] < 0.2; }
  // put the car back on its wheels (GTA-style recover), keeps heading
  reset(x, y, z, heading) {
    this.q.x = 0; this.q.y = Math.sin(heading / 2); this.q.z = 0; this.q.w = Math.cos(heading / 2);
    this._updateR();
    this.pos.x = x; this.pos.y = y + this.p.cgHeight + 0.05; this.pos.z = z;
    this.vel.x = this.vel.y = this.vel.z = 0; this.angVel.x = this.angVel.y = this.angVel.z = 0;
    for (const w of this.wheels) { w.omega = 0; w.comp = w.compPrev = 0; }
  }

  // ---- public step -----------------------------------------------------------
  // dt: frame time (any value up to ~0.05 s). input: {throttle, steer, handbrake, brake?}
  // ground(x, z, yRef) -> height | {h, nx, ny, nz}. yRef = height of the strut top, so the
  //   game's groundHeight(x, z, maxY) can ignore roofs/bridges above the car.
  // obstacles (optional): array of static colliders near the car, see collideStatic().
  step(dt, input, ground, obstacles = null) {
    this.acc = Math.min(this.acc + dt, this.h * this.maxSubsteps);
    let n = 0;
    this._prevVel.x = this.vel.x; this._prevVel.y = this.vel.y; this._prevVel.z = this.vel.z;
    let impact = 0;
    this.lastImpact = 0;
    while (this.acc >= this.h) {
      this.acc -= this.h;
      this._substep(this.h, input, ground);
      if (obstacles && obstacles.length) impact = Math.max(impact, collideStatic(this, obstacles));
      n++;
    }
    this.lastImpact = Math.max(this.lastImpact, impact);
    // telemetry (per frame)
    const T = this.telemetry, R = this.R;
    if (dt > 0 && n > 0) {
      const tdt = n * this.h;
      const ax = (this.vel.x - this._prevVel.x) / tdt, az = (this.vel.z - this._prevVel.z) / tdt;
      T.longG = (ax * R[2] + az * R[8]) / GRAVITY;
      T.latG = -(ax * R[0] + az * R[6]) / GRAVITY; // + = acceleration to the right
    }
    T.speed = this.forwardSpeed; T.kmh = Math.abs(T.speed) * 3.6;
    T.rpm = this.rpm; T.gear = this.gear;
    let skid = 0;
    for (const w of this.wheels) if (w.contact) skid = Math.max(skid, clamp(w.sNorm - 1, 0, 2) * Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 4));
    T.skid = skid;
    return n;
  }

  // ---- input -------------------------------------------------------------------
  _controls(h, I) {
    const p = this.p, c = this.ctl;
    const vF = this.forwardSpeed;
    const want = clamp(I.throttle || 0, -1, 1);
    // GTA semantics: W accelerates / brakes when reversing; S brakes then reverses.
    let drive = 0, brake = clamp(I.brake || 0, 0, 1);
    if (want > 0) {
      if (vF < -1.0) brake = Math.max(brake, want);
      else { drive = want; if (this.gear < 1) this.gear = 1; }
    } else if (want < 0) {
      if (vF > 1.0) brake = Math.max(brake, -want);
      else { drive = -want; this.gear = -1; }
    }
    c.drive = approach(c.drive, drive, (drive > c.drive ? p.throttleRate : p.throttleRate * 2) * h);
    c.brake = approach(c.brake, brake, p.brakeRate * h);
    c.handbrake = approach(c.handbrake, I.handbrake ? 1 : 0, 10 * h);
    // steering: smoothed normalised input, faster return to centre
    const sIn = clamp(I.steer || 0, -1, 1);
    const rate = Math.abs(sIn) < Math.abs(c.steer) || sIn * c.steer < 0 ? p.steerReturn : p.steerRate;
    c.steer = approach(c.steer, sIn, rate * h);
    // speed-sensitive lock: the angle that produces ~peak lateral accel + some slip margin
    const v = Math.max(Math.abs(vF), 0.1);
    const limit = Math.min(p.maxSteer, p.alphaPeak * p.steerSpeedRef + Math.atan((p.wheelbase * p.mu * p.gravity) / (v * v)));
    let target = c.steer * limit; // + = right
    // countersteer assist: point the front wheels along the direction of travel when the
    // rear steps out (only when the player isn't steering against the slide)
    if (p.countersteer > 0 && Math.abs(vF) > 3) {
      const vl = this.toBody(this.vel.x, this.vel.y, this.vel.z, _t0);
      const beta = Math.atan2(-vl.x, Math.abs(vl.z)); // body slip angle, + = sliding right
      if (Math.abs(beta) > 0.05) {
        const assist = clamp(beta, -0.6, 0.6) * p.countersteer * (I.handbrake ? 0.2 : 1);
        if (sIn === 0 || Math.sign(sIn) === Math.sign(assist)) target += assist * (vF > 0 ? 1 : -1);
      }
    }
    // self-aligning: with no input, the aligning torque of the front tyres helps re-centre
    if (sIn === 0) {
      let mz = 0;
      for (const w of this.wheels) if (w.front) mz += w.Mz;
      target += clamp(mz * 0.00002, -0.05, 0.05);
    }
    this.steerAngle = clamp(target, -p.maxSteer, p.maxSteer);
  }

  // ---- one fixed substep -------------------------------------------------------------
  _substep(h, I, ground) {
    const p = this.p, R = this.R, pos = this.pos, vel = this.vel, w = this.angVel;
    this._controls(h, I);
    const c = this.ctl;
    let Fx = 0, Fy = -p.mass * p.gravity, Fz = 0; // world force accumulator (gravity)
    let Tx = 0, Ty = 0, Tz = 0; // world torque about CoG
    const addForceAt = (fx, fy, fz, px, py, pz) => {
      Fx += fx; Fy += fy; Fz += fz;
      const rx = px - pos.x, ry = py - pos.y, rz = pz - pos.z;
      Tx += ry * fz - rz * fy; Ty += rz * fx - rx * fz; Tz += rx * fy - ry * fx;
    };
    const upX = R[1], upY = R[4], upZ = R[7];
    const fwX = R[2], fwY = R[5], fwZ = R[8];

    // ---------------- suspension rays ----------------
    let onGround = 0;
    const nW = this.wheels.length;
    for (const wh of this.wheels) {
      const m = this.toWorld(wh.lx, wh.ly, wh.lz, _t1);
      const mx = pos.x + m.x, my = pos.y + m.y, mz = pos.z + m.z; // strut top (world)
      const reach = p.restLength + p.wheelRadius;
      // ray along -up from the strut top; ground is a height field, so intersect the ray
      // with the local tangent plane at the sample below the hub
      const g0 = sampleGround(ground, mx - upX * reach * 0.7, mz - upZ * reach * 0.7, my);
      // round-wheel probe: also sample 0.7 R ahead/behind along the body's forward axis,
      // lowered by the wheel's curvature, so kerbs and steps are climbed over ~0.3 m instead
      // of hitting the bump stop in a single substep
      if (p.wheelProbe) {
        const a = p.wheelRadius * 0.7, drop = p.wheelRadius * 0.286;
        const bx = mx - upX * reach * 0.7, bz = mz - upZ * reach * 0.7;
        const h0 = g0.h;
        let hm = h0;
        for (const sgn of [1, -1]) {
          const r = ground(bx + fwX * a * sgn, bz + fwZ * a * sgn, my);
          const hh = (typeof r === 'number' ? r : r.h) - drop;
          if (hh > hm) hm = hh;
        }
        g0.h = hm;
      }
      const denom = upX * g0.nx + upY * g0.ny + upZ * g0.nz; // cos(angle between up and normal)
      wh.compPrev = wh.comp;
      wh.contact = false;
      if (denom > 0.2) {
        const sx = mx - upX * reach * 0.7, sz = mz - upZ * reach * 0.7;
        const perp = (my - g0.h) * g0.ny + (mx - sx) * g0.nx + (mz - sz) * g0.nz; // height above plane
        // cars: distance along the strut axis (-up). Bikes: along the ground normal, i.e. the
        // tyre behaves like a torus whose contact patch rolls round the side when leaning.
        const d = p.bike ? perp : perp / denom;
        const comp = reach - d;
        if (comp > 0 && comp < reach + 0.5) {
          wh.contact = true;
          wh.comp = comp;
          wh.nx = g0.nx; wh.ny = g0.ny; wh.nz = g0.nz;
          if (p.bike) { wh.cx = mx - g0.nx * d; wh.cy = my - g0.ny * d; wh.cz = mz - g0.nz * d; }
          else { wh.cx = mx - upX * d; wh.cy = my - upY * d; wh.cz = mz - upZ * d; }
          wh.surfaceGrip = g0.grip;
        }
      }
      if (!wh.contact) wh.comp = 0;
      if (wh.contact) onGround++;
    }
    // anti-roll bars + spring/damper -> normal load
    for (let i = 0; i < nW; i++) {
      const wh = this.wheels[i];
      if (!wh.contact) { wh.Fz = 0; continue; }
      let comp = wh.comp;
      let fs = wh.k * Math.min(comp, p.maxTravel);
      if (comp > p.maxTravel) fs += wh.k * p.bumpStopRate * (comp - p.maxTravel); // bump stop
      const cv = (wh.comp - (wh.compPrev || wh.comp)) / h; // compression velocity
      // digressive damper: full rate up to the knee, then blow-off (sharp bumps don't launch the car)
      const av = Math.abs(cv), kn = p.damperKnee;
      const dv = av < kn ? av : kn + (av - kn) * p.damperHigh;
      let fd = wh.c * Math.sign(cv) * dv * (cv < 0 ? p.reboundRatio : 1);
      // bump stop is a stiff, well-damped rubber (absorbs instead of springing back)
      if (comp > p.maxTravel && cv > 0) fd += wh.c * 4 * cv * Math.min(1, (comp - p.maxTravel) / 0.03);
      let arb = 0;
      if (!p.bike) {
        const other = this.wheels[i ^ 1];
        arb = (wh.front ? p.arbF : p.arbR) * (comp - (other.contact ? other.comp : 0));
      }
      wh.Fz = Math.max(0, fs + fd + arb);
    }

    // ---------------- drivetrain ----------------
    const drivenWheels = this.wheels.filter((x) => x.driven);
    let wAvg = 0;
    for (const wh of drivenWheels) wAvg += wh.omega;
    wAvg /= drivenWheels.length;
    const gr = this.gear === -1 ? -p.reverseRatio : this.gear >= 1 ? p.gears[this.gear - 1] : 0;
    const ratio = gr * p.finalDrive;
    const turbineRPM = Math.abs(wAvg * ratio) * 60 / TAU;
    this.shiftT = Math.max(0, this.shiftT - h);
    this.shiftCooldown = Math.max(0, this.shiftCooldown - h);
    // torque converter: engine can rev up to the stall speed while the car is slow
    const free = p.idleRPM + c.drive * (p.stallRPM - p.idleRPM);
    const rpmTarget = clamp(Math.max(turbineRPM, free), p.idleRPM, p.redline * 1.02);
    this.rpm = lerp(this.rpm, rpmTarget, 1 - Math.exp(-h * 12)); // smooth (engine inertia + sound)
    const sr = clamp(turbineRPM / Math.max(this.rpm, 1), 0, 1);
    const tMult = sr < 0.9 ? lerp(2.0, 1.0, sr / 0.9) : 1.0;
    // traction control: cut throttle if driven wheels spin
    let maxSpin = 0;
    for (const wh of drivenWheels) if (wh.contact) maxSpin = Math.max(maxSpin, wh.kappa * Math.sign(ratio || 1));
    if (p.tc > 0 && maxSpin > p.tcSlip) this.tcScale = Math.max(1 - p.tc, this.tcScale - 6 * h);
    else this.tcScale = Math.min(1, this.tcScale + 3 * h);
    this.telemetry.tc = this.tcScale < 0.98;
    let engineT = 0;
    if (this.shiftT <= 0 && ratio !== 0) {
      // electronic speed limiter (soft cut over the last 3 m/s)
      const lim = clamp((p.vmax - Math.abs(this.forwardSpeed)) / 3, 0, 1);
      const thr = c.drive * this.tcScale * lim;
      engineT = curveTorque(p.torqueCurve, this.rpm) * thr * tMult;
      if (this.rpm >= p.redline) engineT = 0; // limiter
      if (thr < 0.05 && sr > 0.8) engineT -= p.engineBrake * (this.rpm / p.redline); // engine braking
    }
    const axleT = engineT * ratio * p.driveEff; // total torque at the driven wheels
    // reflected engine inertia when the converter is locked (makes low gears feel heavy)
    const reflI = sr > 0.85 ? (p.engineInertia * ratio * ratio) / drivenWheels.length : 0;
    // automatic gearbox
    if (this.shiftT <= 0 && this.shiftCooldown <= 0 && this.gear >= 1) {
      const up = p.redline * lerp(0.62, 0.95, c.drive);
      const down = p.redline * lerp(0.3, 0.5, c.drive);
      if (turbineRPM > up && this.gear < p.maxGear && Math.abs(wAvg) > 1) { this.gear++; this.shiftT = p.shiftTime; this.shiftCooldown = 0.6; }
      else if (this.gear > 1) {
        const lower = (turbineRPM * p.gears[this.gear - 2]) / p.gears[this.gear - 1];
        if (turbineRPM < down && lower < p.redline * 0.85) { this.gear--; this.shiftT = p.shiftTime * 0.6; this.shiftCooldown = 0.6; }
      }
    }

    // ---------------- tyres + wheel spin ----------------
    const steer = this.steerAngle; // + = right
    const ack = Math.abs(steer) > 1e-4 && !p.bike;
    let wantAbs = false;
    let mzTot = 0;
    // snapshot wheel speeds so the diff coupling is symmetric (no update-order bias)
    const om0 = this._om0 || (this._om0 = new Float64Array(nW));
    for (let i = 0; i < nW; i++) om0[i] = this.wheels[i].omega;
    for (let i = 0; i < nW; i++) {
      const wh = this.wheels[i];
      // steering angle per wheel (Ackermann). Body +X is left; a right turn rotates the
      // wheel heading towards -X, i.e. a negative rotation about +Y.
      let delta = 0;
      if (wh.front) {
        delta = steer;
        if (ack) {
          const R0 = p.wheelbase / Math.tan(Math.abs(steer)); // turn radius at the rear axle centre
          const inner = (steer > 0 && wh.side < 0) || (steer < 0 && wh.side > 0);
          delta = Math.sign(steer) * Math.atan(p.wheelbase / (R0 + (inner ? -1 : 1) * (p.trackF / 2)));
        }
      }
      wh.steer = delta;
      // wheel heading in body frame: forward (0,0,1) rotated by -delta about Y
      const sd = Math.sin(-delta), cd = Math.cos(-delta);
      const wf = this.toWorld(sd, 0, cd, _t2); // wheel forward (world)
      // per-wheel torques
      let driveT = 0;
      if (wh.driven) {
        let share = 1 / drivenWheels.length;
        if (p.drive === 'awd') share = (wh.front ? p.awdFront : 1 - p.awdFront) / (p.bike ? 1 : 2);
        driveT = axleT * share;
        // limited-slip diff: viscous coupling between left/right of the same axle
        if (!p.bike && p.lsd > 0) {
          driveT -= clamp(p.lsd * (om0[i] - om0[i ^ 1]), -p.lsdMax, p.lsdMax);
        }
      }
      let brakeT = c.brake * p.brakeTorque * (wh.front ? p.brakeBias : 1 - p.brakeBias) * 2;
      if (p.abs && wh.contact && Math.abs(this.forwardSpeed) > 2) {
        // ABS: release pressure when the wheel approaches lock, re-apply when it recovers
        if (wh.kappa * Math.sign(wh.omega || this.forwardSpeed) < -p.absSlip && brakeT > 0) { wh.absScale = Math.max(0.15, wh.absScale - 25 * h); wantAbs = true; }
        else wh.absScale = Math.min(1, wh.absScale + 8 * h);
        brakeT *= wh.absScale;
      }
      if (!wh.front) brakeT += c.handbrake * p.handbrakeTorque; // rear only, no ABS
      brakeT += p.rollingResist * wh.Fz * p.wheelRadius;
      const Iw = p.wheelInertia + reflI * (wh.driven ? 1 : 0);
      if (!wh.contact) {
        // free wheel: drive and brake only
        let om = wh.omega + (driveT / Iw) * h;
        const db = (brakeT / Iw) * h;
        om = Math.abs(om) <= db ? 0 : om - Math.sign(om) * db;
        wh.omega = om; wh.Fx = wh.Fy = wh.kappa = wh.alpha = wh.sNorm = wh.Mz = 0;
        wh.spin = (wh.spin + om * h) % TAU;
        continue;
      }
      // contact frame: project wheel forward onto the ground plane, lateral = n x f (left)
      const nx = wh.nx, ny = wh.ny, nz = wh.nz;
      let fdn = wf.x * nx + wf.y * ny + wf.z * nz;
      let fx = wf.x - nx * fdn, fy = wf.y - ny * fdn, fz = wf.z - nz * fdn;
      const fl = Math.hypot(fx, fy, fz) || 1;
      fx /= fl; fy /= fl; fz /= fl;
      const lx = ny * fz - nz * fy, ly = nz * fx - nx * fz, lz = nx * fy - ny * fx; // left
      // contact patch velocity
      // (bikes: measured on the centre line at CoG height, where their forces act, so the
      // rider's lean rate doesn't leak into tyre slip)
      const pv = p.bike ? this.pointVel(pos.x + fwX * wh.lz, pos.y + fwY * wh.lz, pos.z + fwZ * wh.lz, _t3) : this.pointVel(wh.cx, wh.cy, wh.cz, _t3);
      const vx = pv.x * fx + pv.y * fy + pv.z * fz;
      const vy = pv.x * lx + pv.y * ly + pv.z * lz;
      const vden = Math.max(Math.abs(vx), p.vMinSlip);
      const tanA = vy / vden;
      const Rw = p.wheelRadius, Fzw = wh.Fz, grip = wh.surfaceGrip * (wh.front ? p.frontGrip : 1);
      // semi-implicit wheel spin: linearise tyre Fx around the current omega
      const fxAt = (om) => tyre(p, Fzw, (om * Rw - vx) / vden, tanA, grip).fx;
      const F0 = fxAt(wh.omega);
      const dOm = 0.05;
      const kF = Math.max(0, (fxAt(wh.omega + dOm) - F0) / dOm); // dFx/domega
      const Ieff = Iw + h * Rw * kF;
      let om = wh.omega + (h * (driveT - Rw * F0)) / Ieff;
      // brake = Coulomb friction on the wheel: may stop it but never reverse it
      const db = (h * brakeT) / Ieff;
      if (Math.abs(om) <= db) om = 0; else om -= Math.sign(om) * db;
      wh.omega = om;
      wh.spin = (wh.spin + om * h) % TAU;
      // final tyre forces at the new omega
      const kappa = (om * Rw - vx) / vden;
      const t = tyre(p, Fzw, kappa, tanA, grip);
      let Fl = t.fx, Fs = t.fy;
      // static hold: a locked/braked wheel at (almost) zero speed shouldn't creep
      if (om === 0 && Math.abs(vx) < 0.5 && (brakeT > p.rollingResist * Fzw * Rw * 1.01)) {
        const hold = -vx * (p.mass / nW) / h * 0.5;
        Fl = clamp(hold, -p.muX * Fzw, p.muX * Fzw);
      }
      if (Math.abs(vx) < 0.5 && Math.abs(vy) < 0.5) {
        const hold = -vy * (p.mass / nW) / h * 0.3;
        Fs = clamp(hold, -p.mu * Fzw, p.mu * Fzw);
      }
      wh.kappa = kappa; wh.alpha = Math.atan(tanA); wh.sNorm = t.sNorm; wh.Fx = Fl; wh.Fy = Fs;
      // self-aligning moment (pneumatic trail collapses as the tyre saturates)
      wh.Mz = -Fs * p.pneumaticTrail * Math.max(0, 1 - t.sNorm);
      mzTot += wh.Mz;
      // force application point: contact patch lifted towards the CoG (rollover assist)
      // P' = C - up * ((C - CoG) . up) * forceHeight
      const hUp = ((wh.cx - pos.x) * upX + (wh.cy - pos.y) * upY + (wh.cz - pos.z) * upZ) * p.forceHeight;
      let ax = wh.cx - upX * hUp, ay = wh.cy - upY * hUp, az = wh.cz - upZ * hUp;
      let sx = wh.cx, sy = wh.cy, sz = wh.cz;
      if (p.bike) {
        // bikes: apply everything on the bike's centre line at CoG height. Tyre/suspension
        // forces then make no roll moment and lean is owned by the rider controller below —
        // equivalent to a perfectly balanced rider, and far more stable than simulating
        // capsize/countersteer dynamics with a keyboard.
        ax = sx = pos.x + fwX * wh.lz; ay = sy = pos.y + fwY * wh.lz; az = sz = pos.z + fwZ * wh.lz;
      }
      addForceAt(fx * Fl + lx * Fs, fy * Fl + ly * Fs, fz * Fl + lz * Fs, ax, ay, az);
      // suspension force along the ground normal at the contact patch
      addForceAt(nx * Fzw, ny * Fzw, nz * Fzw, sx, sy, sz);
    }
    this.telemetry.abs = wantAbs;
    this.wheelsOnGround = onGround;

    // ---------------- aero ----------------
    const sp = Math.hypot(vel.x, vel.y, vel.z);
    if (sp > 0.01) {
      const k = 0.5 * RHO * p.cdA * sp;
      Fx -= k * vel.x; Fy -= k * vel.y; Fz -= k * vel.z;
      const vF = vel.x * fwX + vel.y * fwY + vel.z * fwZ;
      const dn = 0.5 * RHO * p.clA * vF * vF;
      Fx -= upX * dn; Fy -= upY * dn; Fz -= upZ * dn;
    }

    // ---------------- bike rider: lean into the turn ----------------
    if (p.bike && !I.noRider) {
      const leanNow = Math.asin(clamp(R[3], -1, 1)); // left axis .y, + = leaning right
      let target = 0;
      if (onGround > 0) {
        const yawRate = w.x * upX + w.y * upY + w.z * upZ;
        const vF = vel.x * fwX + vel.y * fwY + vel.z * fwZ;
        target = clamp(Math.atan((-yawRate * vF) / p.gravity), -p.leanMax, p.leanMax);
      }
      const rollRate = w.x * fwX + w.y * fwY + w.z * fwZ;
      const wn = p.leanKp;
      const tq = p.Iz * (wn * wn * (target - leanNow) - 2 * p.leanKd * wn * 0.5 * rollRate);
      Tx += fwX * tq; Ty += fwY * tq; Tz += fwZ * tq;
    }

    // ---------------- air control ----------------
    if (onGround === 0) {
      this.airTime += h;
      // GTA-style air control: W/S pitch (W = nose down), A/D yaw. Drives the body rate
      // towards input * airMaxRate with limited angular acceleration; no input = free flight.
      const ac = p.airControl;
      const s = clamp(I.steer || 0, -1, 1), t = clamp(I.throttle || 0, -1, 1);
      const lAx = R[0], lAy = R[3], lAz = R[6];
      let tp = 0, ty = 0;
      if (t !== 0) {
        const rate = w.x * lAx + w.y * lAy + w.z * lAz;
        tp = p.Ix * clamp((t * p.airMaxRate - rate) * 4, -ac, ac);
      }
      if (s !== 0) {
        const rate = w.x * upX + w.y * upY + w.z * upZ;
        ty = p.Iy * clamp((-s * p.airMaxRate - rate) * 4, -ac, ac);
      }
      Tx += lAx * tp + upX * ty; Ty += lAy * tp + upY * ty; Tz += lAz * tp + upZ * ty;
      if (p.airPitchDamp > 0 && t === 0) {
        const rate = w.x * lAx + w.y * lAy + w.z * lAz;
        const tq = -rate * p.Ix * p.airPitchDamp;
        Tx += lAx * tq; Ty += lAy * tq; Tz += lAz * tq;
      }
    } else this.airTime = 0;

    // optional extra yaw damping (arcade grip feel)
    if (p.yawAssist > 0 && onGround > 0) {
      const yr = w.x * upX + w.y * upY + w.z * upZ;
      const tq = -yr * p.Iy * p.yawAssist * 4;
      Tx += upX * tq; Ty += upY * tq; Tz += upZ * tq;
    }

    // ---------------- integrate (semi-implicit Euler) ----------------
    vel.x += (Fx / p.mass) * h; vel.y += (Fy / p.mass) * h; vel.z += (Fz / p.mass) * h;
    const dw = this.invInertia(Tx, Ty, Tz, _t0);
    w.x += dw.x * h; w.y += dw.y * h; w.z += dw.z * h;
    // mild angular damping (air + suspension friction not modelled elsewhere)
    const ad = Math.exp(-0.15 * h);
    w.x *= ad; w.y *= ad; w.z *= ad;
    pos.x += vel.x * h; pos.y += vel.y * h; pos.z += vel.z * h;
    // q += 0.5 * (w,0) * q * h
    const q = this.q;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    q.x += 0.5 * h * (w.x * qw + w.y * qz - w.z * qy);
    q.y += 0.5 * h * (w.y * qw + w.z * qx - w.x * qz);
    q.z += 0.5 * h * (w.z * qw + w.x * qy - w.y * qx);
    q.w += 0.5 * h * (-w.x * qx - w.y * qy - w.z * qz);
    const ql = Math.hypot(q.x, q.y, q.z, q.w);
    q.x /= ql; q.y /= ql; q.z /= ql; q.w /= ql;
    this._updateR();

    // ---------------- body corners vs ground (impulses) ----------------
    this._bodyContacts(h, ground);
  }

  // Body corners vs ground. Jacobi-style impulses (all contacts see the same velocity and
  // share the correction) so left/right corners stay symmetric — sequential impulses would
  // inject a tiny yaw on every scrape, which a symmetric ramp then amplifies.
  _bodyContacts(h, ground) {
    const p = this.p, pos = this.pos;
    const C = this._contacts || (this._contacts = this.corners.map(() => ({ px: 0, py: 0, pz: 0, nx: 0, ny: 1, nz: 0, pen: 0, jn: 0 })));
    let n = 0;
    for (const cn of this.corners) {
      const o = this.toWorld(cn[0], cn[1], cn[2], _t1);
      const px = pos.x + o.x, py = pos.y + o.y, pz = pos.z + o.z;
      const g = sampleGround(ground, px, pz, py + 0.5, true);
      const pen = g.h - py;
      if (pen <= 0) continue;
      const c = C[n++];
      c.px = px; c.py = py; c.pz = pz; c.nx = g.nx; c.ny = g.ny; c.nz = g.nz; c.pen = pen;
      const v = this.pointVel(px, py, pz, _t2);
      this.lastImpact = Math.max(this.lastImpact, -(v.x * c.nx + v.y * c.ny + v.z * c.nz));
    }
    if (!n) return;
    for (let it = 0; it < 4; it++) {
      // normal impulses from the current velocity, applied together and scaled by 1/n
      for (let i = 0; i < n; i++) {
        const c = C[i];
        const v = this.pointVel(c.px, c.py, c.pz, _t2);
        const vn = v.x * c.nx + v.y * c.ny + v.z * c.nz;
        const bias = Math.min(4, (0.3 * c.pen) / h);
        const target = Math.max(vn < -1 ? -p.bodyRestitution * vn : 0, bias);
        c.jn = vn < target ? (target - vn) / this.invMassAt(c.px, c.py, c.pz, c.nx, c.ny, c.nz) / n : 0;
        c.vt = 0;
      }
      for (let i = 0; i < n; i++) { const c = C[i]; if (c.jn > 0) this.applyImpulse(c.px, c.py, c.pz, c.nx * c.jn, c.ny * c.jn, c.nz * c.jn); }
      // friction (Coulomb, bounded by this iteration's normal impulse)
      const F = [];
      for (let i = 0; i < n; i++) {
        const c = C[i];
        if (c.jn <= 0) continue;
        const v = this.pointVel(c.px, c.py, c.pz, _t2);
        const vn = v.x * c.nx + v.y * c.ny + v.z * c.nz;
        let tx = v.x - c.nx * vn, ty = v.y - c.ny * vn, tz = v.z - c.nz * vn;
        const vt = Math.hypot(tx, ty, tz);
        if (vt < 1e-4) continue;
        tx /= vt; ty /= vt; tz /= vt;
        const jt = Math.min(vt / this.invMassAt(c.px, c.py, c.pz, tx, ty, tz) / n, p.bodyFriction * c.jn);
        F.push(c, -tx * jt, -ty * jt, -tz * jt);
      }
      for (let i = 0; i < F.length; i += 4) this.applyImpulse(F[i].px, F[i].py, F[i].pz, F[i + 1], F[i + 2], F[i + 3]);
    }
  }
}

// ----------------------------------------------------------------------------- ground
const G0 = { h: 0, nx: 0, ny: 1, nz: 0, grip: 1 };
// Accepts a number or {h, nx, ny, nz, grip}. Without a normal, estimate it from two
// extra samples (0.35 m apart) — enough to follow kerbs, ramps and terrain triangles.
function sampleGround(ground, x, z, yRef, cheap = false) {
  const r = ground(x, z, yRef);
  if (typeof r === 'number') {
    G0.h = r; G0.grip = 1;
    if (cheap) { G0.nx = 0; G0.ny = 1; G0.nz = 0; return G0; }
    const e = 0.35;
    const hx = ground(x + e, z, yRef), hz = ground(x, z + e, yRef);
    const ax = (typeof hx === 'number' ? hx : hx.h) - r, az = (typeof hz === 'number' ? hz : hz.h) - r;
    // a step (kerb, slab edge) taller than 0.25 m over 0.35 m is treated as a wall, not a slope
    let dx = Math.abs(ax) > 0.25 ? 0 : ax, dz = Math.abs(az) > 0.25 ? 0 : az;
    const l = Math.hypot(dx, e, dz);
    G0.nx = -dx / l; G0.ny = e / l; G0.nz = -dz / l;
    return G0;
  }
  G0.h = r.h; G0.nx = r.nx ?? 0; G0.ny = r.ny ?? 1; G0.nz = r.nz ?? 0; G0.grip = r.grip ?? 1;
  return G0;
}

// ----------------------------------------------------------------------------- collisions
// Horizontal footprint of a body as an OBB: centre, forward axis (unit, xz), half sizes.
function footprint(b, o) {
  const R = b.R;
  let fx = R[2], fz = R[8];
  const l = Math.hypot(fx, fz) || 1;
  fx /= l; fz /= l;
  o.cx = b.pos.x; o.cz = b.pos.z; o.fx = fx; o.fz = fz;
  o.hl = b.p.length / 2; o.hw = b.p.width / 2;
  o.y0 = b.pos.y - b.p.cgHeight; o.y1 = b.pos.y - b.p.cgHeight + b.p.height;
  return o;
}
// 2-D SAT between two OBBs given as {cx, cz, ax:[x,z], bx:[x,z], ha, hb}
// (ax/bx = unit axes, ha/hb = half extents). Returns normal from A to B + depth + contact.
const SAT = { nx: 0, nz: 0, depth: 0, px: 0, pz: 0 };
function satOBB(A, B) {
  const axes = [A.ax, A.bx, B.ax, B.bx];
  const dx = B.cx - A.cx, dz = B.cz - A.cz;
  let best = Infinity, bi = -1, bnx = 0, bnz = 0;
  const proj = (O, n) => Math.abs(O.ax[0] * n[0] + O.ax[1] * n[1]) * O.ha + Math.abs(O.bx[0] * n[0] + O.bx[1] * n[1]) * O.hb;
  for (let i = 0; i < 4; i++) {
    const n = axes[i];
    const d = dx * n[0] + dz * n[1];
    const o = proj(A, n) + proj(B, n) - Math.abs(d);
    if (o <= 0) return null;
    if (o < best) { best = o; bi = i; bnx = d < 0 ? -n[0] : n[0]; bnz = d < 0 ? -n[1] : n[1]; }
  }
  SAT.nx = bnx; SAT.nz = bnz; SAT.depth = best;
  // contact point: deepest vertex of the box whose face was *not* the separating axis
  const V = bi < 2 ? B : A, sgn = bi < 2 ? -1 : 1; // B's vertex deepest towards A, or A's towards B
  let bestP = -Infinity;
  for (const sa of [1, -1]) for (const sb of [1, -1]) {
    const vx = V.cx + V.ax[0] * V.ha * sa + V.bx[0] * V.hb * sb;
    const vz = V.cz + V.ax[1] * V.ha * sa + V.bx[1] * V.hb * sb;
    const pr = (vx * bnx + vz * bnz) * sgn;
    if (pr > bestP) { bestP = pr; SAT.px = vx; SAT.pz = vz; }
  }
  return SAT;
}
const _A = { cx: 0, cz: 0, ax: [0, 0], bx: [0, 0], ha: 0, hb: 0 };
const _B = { cx: 0, cz: 0, ax: [0, 0], bx: [0, 0], ha: 0, hb: 0 };
const _F = {}, _F2 = {};
function bodyOBB(b, out, F = _F) {
  const f = footprint(b, F);
  out.cx = f.cx; out.cz = f.cz; out.ax[0] = f.fx; out.ax[1] = f.fz; out.ha = f.hl;
  out.bx[0] = -f.fz; out.bx[1] = f.fx; out.hb = f.hw;
  return f;
}

// Resolve a contact between body b (and optionally body c) along horizontal normal n
// (pointing from b towards the other object) at point P. Impulse with restitution e and
// Coulomb friction mu. Returns the closing speed.
function resolveContact(b, c, px, py, pz, nx, nz, depth, e, mu) {
  // positional correction (split by mass)
  const mb = b.p.mass, mc = c ? c.p.mass : Infinity;
  const tb = c ? mc / (mb + mc) : 1, tc = c ? mb / (mb + mc) : 0;
  const corr = Math.max(0, depth - 0.005);
  b.pos.x -= nx * corr * tb; b.pos.z -= nz * corr * tb;
  if (c) { c.pos.x += nx * corr * tc; c.pos.z += nz * corr * tc; }
  const vb = b.pointVel(px, py, pz, _t2);
  let rvx = -vb.x, rvy = -vb.y, rvz = -vb.z;
  if (c) { const vc = c.pointVel(px, py, pz, _t3); rvx += vc.x; rvy += vc.y; rvz += vc.z; }
  const vn = rvx * nx + rvz * nz; // relative velocity of other w.r.t. b along n (< 0 = closing)
  if (vn >= 0) return 0;
  const k = b.invMassAt(px, py, pz, nx, 0, nz) + (c ? c.invMassAt(px, py, pz, nx, 0, nz) : 0);
  const ee = -vn < 1.5 ? 0 : e; // no bounce for slow contacts (no jitter)
  const jn = (-(1 + ee) * vn) / k;
  b.applyImpulse(px, py, pz, -nx * jn, 0, -nz * jn);
  if (c) c.applyImpulse(px, py, pz, nx * jn, 0, nz * jn);
  // friction along the tangent (scrape)
  let tx = rvx - nx * vn, ty = rvy, tz = rvz - nz * vn;
  const vt = Math.hypot(tx, ty, tz);
  if (vt > 1e-3) {
    tx /= vt; ty /= vt; tz /= vt;
    const kt = b.invMassAt(px, py, pz, tx, ty, tz) + (c ? c.invMassAt(px, py, pz, tx, ty, tz) : 0);
    const jt = Math.min(vt / kt, mu * jn);
    b.applyImpulse(px, py, pz, tx * jt, ty * jt, tz * jt);
    if (c) c.applyImpulse(px, py, pz, -tx * jt, -ty * jt, -tz * jt);
  }
  return -vn;
}

// Static colliders in the game's bGrid format:
//   box: {t:0, cx, cz, hx, hz, c, s, y0, y1}  (local = (wx*c - wz*s, wx*s + wz*c))
//   cylinder: {t:1, x, z, r, y0, y1}
// Returns the largest closing speed (use it for damage / crash sounds).
export function collideStatic(b, list, restitution = 0.25, friction = 0.35) {
  let impact = 0;
  for (const o of list) {
    const f = bodyOBB(b, _A);
    if (f.y1 < o.y0 || f.y0 > o.y1 - 0.25) continue; // drives over it / under it
    let hit = null;
    if (o.t === 0) {
      _B.cx = o.cx; _B.cz = o.cz; _B.ax[0] = o.c; _B.ax[1] = -o.s; _B.ha = o.hx; _B.bx[0] = o.s; _B.bx[1] = o.c; _B.hb = o.hz;
      hit = satOBB(_A, _B);
    } else {
      // circle vs OBB: closest point of the car box to the circle centre
      const dx = o.x - _A.cx, dz = o.z - _A.cz;
      const la = clamp(dx * _A.ax[0] + dz * _A.ax[1], -_A.ha, _A.ha);
      const lb = clamp(dx * _A.bx[0] + dz * _A.bx[1], -_A.hb, _A.hb);
      const qx = _A.cx + _A.ax[0] * la + _A.bx[0] * lb, qz = _A.cz + _A.ax[1] * la + _A.bx[1] * lb;
      let nx = o.x - qx, nz = o.z - qz;
      const d = Math.hypot(nx, nz);
      if (d < o.r) {
        if (d < 1e-6) { nx = dx; nz = dz; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l; } else { nx /= d; nz /= d; }
        SAT.nx = nx; SAT.nz = nz; SAT.depth = o.r - d; SAT.px = qx; SAT.pz = qz;
        hit = SAT;
      }
    }
    if (hit) {
      const py = b.pos.y - 0.1; // bumper height ~ just below the CoG
      impact = Math.max(impact, resolveContact(b, null, hit.px, py, hit.pz, hit.nx, hit.nz, hit.depth, restitution, friction));
    }
  }
  return impact;
}

// Vehicle vs vehicle (call once per frame for nearby pairs, after both stepped).
export function collideBodies(a, b, restitution = 0.2, friction = 0.3) {
  const fa = bodyOBB(a, _A);
  const fb = bodyOBB(b, _B, _F2);
  if (fa.y1 < fb.y0 || fb.y1 < fa.y0) return 0;
  const hit = satOBB(_A, _B);
  if (!hit) return 0;
  const py = (a.pos.y + b.pos.y) / 2 - 0.1;
  return resolveContact(a, b, hit.px, py, hit.pz, hit.nx, hit.nz, hit.depth, restitution, friction);
}

// scratch vectors
const _t0 = { x: 0, y: 0, z: 0 }, _t1 = { x: 0, y: 0, z: 0 }, _t2 = { x: 0, y: 0, z: 0 }, _t3 = { x: 0, y: 0, z: 0 };
