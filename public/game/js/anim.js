// Skeletal animation for people: realistic MakeHuman bodies driven by a shared clip set
// (Quaternius Universal Animation Library retargeted onto one 53-bone skeleton).
//
// Layers, blended by weight every frame (weights for each bone always add up to 1):
//   locomotion  idle / walk / jog / sprint, blended by ground speed with synced foot phase
//     upper body  replaced by the pistol aim poses (blended by pitch) or a punch
//   air, swim, drive, sit, knocked down, dead: full-body clips cross-faded with locomotion
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { damp, clamp } from './core.js';

const UPPER = /^(spine_02|spine_03|neck_01|head|clavicle_|upperarm_|lowerarm_|hand_|thumb_|index_|middle_|ring_|pinky_)/;
// locomotion keys: [clip, speed (m/s) where it is at full weight, metres travelled per cycle]
const LOCO = [
  ['Idle_Loop', 0, 0],
  ['Walk_Loop', 1.45, 1.35],
  ['Jog_Fwd_Loop', 4.4, 2.75],
  ['Sprint_Loop', 7.8, 3.6],
];
const FULL = {
  air: 'Jump_Loop',
  fall: 'LiftAir_Fall_Air_Loop',
  swim: 'Swim_Fwd_Loop',
  swimIdle: 'Swim_Idle_Loop',
  drive: 'Driving_Loop',
  sit: 'Sitting_Idle_Loop',
  down: 'IdleToLay',
  dead: 'Death01',
  dead2: 'Death02',
  getup: 'LayToIdle',
  panic: 'Jog_Fwd_Loop',
};

let CLIPS = null; // name -> {full, upper, lower}
export function setAnimationClips(gltf) {
  if (!gltf || !gltf.animations || !gltf.animations.length) return;
  CLIPS = {};
  for (const c of gltf.animations) {
    // in-place loops: drop horizontal root and pelvis translation so they don't drift
    const tracks = c.tracks.filter((t) => !/^Root\.position$/.test(t.name));
    for (const t of tracks)
      if (/^pelvis\.position$/.test(t.name)) {
        const v = t.values;
        const x0 = v[0], z0 = v[2];
        for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
      }
    const full = new THREE.AnimationClip(c.name, c.duration, tracks);
    const bone = (t) => t.name.split('.')[0];
    CLIPS[c.name] = {
      full,
      upper: new THREE.AnimationClip(c.name + '#u', c.duration, tracks.filter((t) => UPPER.test(bone(t)))),
      lower: new THREE.AnimationClip(c.name + '#l', c.duration, tracks.filter((t) => !UPPER.test(bone(t)))),
    };
  }
}
export function hasAnimations() {
  return !!CLIPS && !!CLIPS.Walk_Loop;
}

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _fwd = new THREE.Vector3();

// rig over a cloned body: {root, mixer, update(state, dt), setGun(v), animated: true}
export function makeAnimatedRig(template, opts = {}) {
  const root = SkeletonUtils.clone(template);
  const meshes = [];
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.frustumCulled = false;
      meshes.push(o);
    }
  });
  if (opts.tint) {
    for (const o of meshes) {
      if (!opts.tint.test(o.material.name)) continue;
      o.material = o.material.clone();
      o.material.color.setHex(opts.tintColor);
    }
  }
  const mixer = new THREE.AnimationMixer(root);
  const act = (clip) => {
    const a = mixer.clipAction(clip);
    a.play();
    a.setEffectiveWeight(0);
    return a;
  };
  // locomotion: lower and upper halves separately so the upper half can be overridden
  const loco = LOCO.map(([name]) => ({ lower: act(CLIPS[name].lower), upper: act(CLIPS[name].upper), dur: CLIPS[name].full.duration }));
  for (const l of loco) { l.lower.timeScale = 0; l.upper.timeScale = 0; }
  const aimUp = act(CLIPS.Pistol_Aim_Up.upper), aimMid = act(CLIPS.Pistol_Aim_Neutral.upper), aimDown = act(CLIPS.Pistol_Aim_Down.upper);
  const holdGun = act(CLIPS.Pistol_Idle_Loop.upper);
  const punches = ['Punch_Jab', 'Punch_Cross'].map((n) => {
    const a = act(CLIPS[n].upper);
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    return a;
  });
  const full = {};
  for (const [k, name] of Object.entries(FULL)) {
    if (!CLIPS[name]) continue;
    const a = act(CLIPS[name].full);
    if (['down', 'dead', 'dead2', 'getup'].includes(k)) {
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
    }
    full[k] = a;
  }
  // gun: a child of the root, placed at the right hand every frame
  const hand = root.getObjectByName('hand_r');
  const gun = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.11, 0.2).translate(0, 0.02, 0.06), new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.4, metalness: 0.6 }));
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.05).translate(0, -0.04, -0.01).rotateX(-0.25), body.material);
  gun.add(body, grip);
  gun.visible = false;
  root.add(gun);

  const W = { loco: 1, air: 0, fall: 0, swim: 0, drive: 0, sit: 0, down: 0, dead: 0, getup: 0 };
  let phase = Math.random(), idleT = Math.random() * 3, aimW = 0, holdW = 0, punchW = 0, punchA = null, wasDown = false, getupT = 0;
  let deadClip = null, airT = 0;
  const blend = [0, 0, 0, 0];
  const rig = {
    root,
    animated: true,
    skinned: true,
    mixer,
    gun,
    setGun(v) {
      gun.visible = v;
    },
    pose() {},
    // s: {speed, onGround, swim, dead, down, aim, aimPitch, punch, drive, sit, armed, far}
    update(s, dt) {
      // ---- target layer weights
      const T = { loco: 0, air: 0, fall: 0, swim: 0, drive: 0, sit: 0, down: 0, dead: 0, getup: 0 };
      airT = s.onGround ? 0 : airT + dt;
      if (s.dead) T.dead = 1;
      else if (s.down) T.down = 1;
      else if (s.drive) T.drive = 1;
      else if (s.sit) T.sit = 1;
      else if (s.swim) T.swim = 1;
      else if (getupT > 0) T.getup = 1;
      else if (!s.onGround && airT > 0.12) (airT > 0.9 ? (T.fall = 1) : (T.air = 1));
      else T.loco = 1;
      if (wasDown && !s.down && !s.dead) {
        // stand back up after being knocked over
        getupT = full.getup ? full.getup.getClip().duration * 0.8 : 0;
        if (full.getup) full.getup.reset().play();
        T.getup = 1; T.loco = 0;
      }
      if (s.down && !wasDown && full.down) full.down.reset().play();
      wasDown = !!s.down;
      if (getupT > 0) getupT -= dt;
      if (s.dead && !deadClip) {
        deadClip = Math.random() < 0.5 || !full.dead2 ? 'dead' : 'dead2';
        full[deadClip].reset().play();
      }
      if (!s.dead) deadClip = null;
      const k = s.dead || s.down ? 14 : 9;
      let sum = 0;
      for (const n in W) { W[n] = damp(W[n], T[n], k, dt); sum += W[n]; }
      for (const n in W) W[n] /= sum || 1;

      // ---- locomotion blend by speed, all clips sharing one foot phase
      const sp = s.speed;
      blend.fill(0);
      let i = 1;
      while (i < LOCO.length - 1 && sp > LOCO[i][1]) i++;
      const t = clamp((sp - LOCO[i - 1][1]) / (LOCO[i][1] - LOCO[i - 1][1]), 0, 1);
      blend[i] = t;
      blend[i - 1] = 1 - t;
      const cyc = i === 1 ? LOCO[1][2] : LOCO[i - 1][2] + (LOCO[i][2] - LOCO[i - 1][2]) * t;
      if (sp > 0.05) phase = (phase + (dt * sp) / cyc) % 1;
      idleT += dt;
      // ---- upper body: aim / hold a gun / punch
      aimW = damp(aimW, s.aim ? 1 : 0, 14, dt);
      holdW = damp(holdW, s.armed && !s.aim ? 1 : 0, 8, dt);
      if (s.punch && !punchA) {
        punchA = punches[Math.floor(Math.random() * punches.length)];
        punchA.reset().play();
        punchA.timeScale = 1.6;
      }
      if (punchA && !punchA.isRunning()) punchA = null;
      punchW = damp(punchW, punchA ? 1 : 0, 20, dt);
      const upperOther = Math.min(1, aimW + punchW + holdW * 0.75);
      const L = W.loco;
      loco.forEach((l, k2) => {
        const b = blend[k2] * L;
        l.lower.setEffectiveWeight(b);
        l.upper.setEffectiveWeight(b * (1 - upperOther));
        const tt = k2 === 0 ? idleT % l.dur : phase * l.dur;
        l.lower.time = tt;
        l.upper.time = tt;
      });
      const pitch = clamp(s.aimPitch || 0, -1, 1);
      const aw = L * aimW * (1 - punchW);
      aimUp.setEffectiveWeight(aw * Math.max(0, pitch / 0.9));
      aimDown.setEffectiveWeight(aw * Math.max(0, -pitch / 0.9));
      aimMid.setEffectiveWeight(aw * (1 - Math.min(1, Math.abs(pitch) / 0.9)));
      holdGun.setEffectiveWeight(L * holdW * 0.75 * (1 - aimW) * (1 - punchW));
      for (const p of punches) p.setEffectiveWeight(p === punchA ? L * punchW : 0);
      for (const [n, a] of Object.entries(full)) {
        let w = W[n] || 0;
        if (n === 'dead' || n === 'dead2') w = deadClip === n ? W.dead : 0;
        if (n === 'swim') w = W.swim * clamp(sp / 1.5, 0, 1);
        if (n === 'swimIdle') w = W.swim * (1 - clamp(sp / 1.5, 0, 1));
        if (n === 'panic') w = 0;
        a.setEffectiveWeight(w);
      }
      // far-away people animate at a lower rate
      if (s.far) {
        rig._acc = (rig._acc || 0) + dt;
        if (rig._acc < 0.1) return;
        dt = rig._acc;
        rig._acc = 0;
      }
      mixer.update(dt);
      if (gun.visible && hand) {
        // hold the gun in the right hand, pointing where the character aims (or down when not aiming)
        root.updateMatrixWorld(true);
        hand.getWorldPosition(_v);
        root.worldToLocal(_v);
        gun.position.copy(_v);
        const p = s.aim ? pitch : -1.05;
        gun.rotation.set(-p, 0, 0);
      }
    },
  };
  return rig;
}
