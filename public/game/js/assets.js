// Loads the open-licensed glTF models (see assets/CREDITS.md) and prepares
// reusable templates. Every consumer falls back to the procedural models when
// a file is missing, so the game still runs without the assets folder.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { setAnimationClips, hasAnimations, makeAnimatedRig } from './anim.js';

const BASE = 'assets/models/';
// realistic bodies, by role (files that are missing are skipped)
export const HUMANS = {
  player: ['mh_player'],
  civ: ['mh_ped_m1', 'mh_ped_f1', 'mh_ped_m2', 'mh_ped_f2', 'mh_ped_m3', 'mh_ped_f3', 'mh_ped_m4', 'mh_ped_m5'],
  cop: ['mh_cop'],
  gang: ['mh_gang'],
};
function HUMAN_FILES() {
  return [...new Set(Object.values(HUMANS).flat())];
}
// GLB by default; a host that can't serve .glb can set window.CC_MODEL_EXT (e.g. '.gltf.json')
const EXT = (typeof window !== 'undefined' && window.CC_MODEL_EXT) || '.glb';
export const FILES = [
  // vehicles (Kenney via pmndrs market, CC0; helicopter & bicycle Blendswap CC0; plane Babylon.js CC-BY 4.0)
  'sedan', 'sports-sedan', 'suv', 'suv-luxury', 'hatchback', 'taxi', 'police-car', 'van', 'truck', 'delivery-truck',
  'firetruck', 'garbage-truck', 'ambulance', 'race-car', 'tractor', 'helicopter', 'bike', 'motorcycle', 'aerobatic_plane',
  'boat-large',
  // people: realistic MakeHuman bodies (CC0) + shared animation clips (Quaternius UAL, CC0);
  // Kenney's cartoon characters remain as a fallback
  'mh_anims', ...HUMAN_FILES(),
  'male', 'survivor-male', 'survivor-female', 'skater-male', 'skater-female',
  // nature (Kenney / pmndrs market, CC0)
  'tree-big', 'tree-small', 'low-poly-tree', 'palm-long', 'palm-short', 'formation-rock',
  // city (KayKit City Builder Bits, CC0); buildings are procedural, at human scale (world.js)
  'kk_streetlight', 'kk_trafficlight_A', 'kk_bench', 'kk_firehydrant', 'kk_dumpster', 'kk_trash_A',
];

// Sandboxed hosts (like the artifact page) may block fetch() of data: and blob:
// URLs. Decode embedded buffers and images directly instead of fetching them.
function dataBytes(uri) {
  const s = atob(uri.slice(uri.indexOf(',') + 1));
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
function inlineData(parser) {
  const loadBuffer = parser.loadBuffer.bind(parser);
  parser.loadBuffer = (i) => {
    const uri = parser.json.buffers[i].uri;
    return uri && uri.startsWith('data:') ? Promise.resolve(dataBytes(uri).buffer) : loadBuffer(i);
  };
  const loadImageSource = parser.loadImageSource.bind(parser);
  parser.loadImageSource = (i, l) => {
    if (typeof createImageBitmap === 'undefined') return loadImageSource(i, l);
    if (parser.sourceCache[i] !== undefined) return parser.sourceCache[i].then((t) => t.clone());
    const def = parser.json.images[i];
    let bytes, mime = def.mimeType;
    if (def.uri && def.uri.startsWith('data:')) {
      bytes = Promise.resolve(dataBytes(def.uri));
      mime = mime || def.uri.slice(5, def.uri.search(/[;,]/));
    } else if (def.bufferView !== undefined) bytes = parser.getDependency('bufferView', def.bufferView);
    else return loadImageSource(i, l);
    const p = bytes
      .then((b) => createImageBitmap(new Blob([b], { type: mime }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
      .then((bmp) => {
        const t = new THREE.Texture(bmp);
        t.needsUpdate = true;
        t.userData.mimeType = mime;
        return t;
      });
    parser.sourceCache[i] = p;
    return p;
  };
  return { name: 'cc_inline_data' };
}

const raw = new Map(); // name -> gltf
export function hasModel(n) {
  return raw.has(n);
}

export async function loadModels(onProgress) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.register(inlineData);
  let done = 0;
  await Promise.all(
    FILES.map((n) =>
      loader
        .loadAsync(BASE + n + EXT)
        .then((g) => { raw.set(n, g); if (n === 'mh_anims') setAnimationClips(g); })
        .catch((e) => console.warn('model missing, using fallback:', n, e && e.message))
        .finally(() => onProgress && onProgress(++done / FILES.length))
    )
  );
  return raw.size;
}

// ---------------------------------------------------------------- helpers
const _box = new THREE.Box3();
function boundsOf(obj) {
  obj.updateMatrixWorld(true);
  _box.makeEmpty();
  obj.traverse((o) => {
    if (!o.isMesh) return;
    if (o.isSkinnedMesh) {
      o.computeBoundingBox();
      _box.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld));
    } else {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      _box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
    }
  });
  return _box.clone();
}

// Wrap a scene so that it faces +z, is uniformly scaled, centred on x/z and sits on y=0.
function normalize(scene, { rotY = 0, length = null, height = null, width = null, center = true }) {
  const inner = new THREE.Group();
  inner.add(scene);
  scene.rotation.y = rotY;
  let b = boundsOf(inner);
  const size = b.getSize(new THREE.Vector3());
  let k = 1;
  if (length) k = length / size.z;
  else if (height) k = height / size.y;
  else if (width) k = width / size.x;
  scene.scale.multiplyScalar(k);
  b = boundsOf(inner);
  const c = b.getCenter(new THREE.Vector3());
  if (center) {
    scene.position.x -= c.x;
    scene.position.z -= c.z;
  }
  scene.position.y -= b.min.y;
  const outer = new THREE.Group();
  outer.add(inner);
  outer.updateMatrixWorld(true);
  return { root: outer, size: boundsOf(outer).getSize(new THREE.Vector3()) };
}

// Move a mesh's geometry so its origin is at the centre of its own bounds (so it can spin in place).
function recenter(mesh) {
  const g = mesh.geometry;
  g.computeBoundingBox();
  const c = g.boundingBox.getCenter(new THREE.Vector3());
  g.translate(-c.x, -c.y, -c.z);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  const pivot = new THREE.Group();
  pivot.position.copy(c).applyMatrix4(mesh.matrix);
  mesh.parent.add(pivot);
  mesh.position.set(0, 0, 0);
  // keep the mesh's own rotation/scale under the pivot
  const m = mesh.matrix.clone();
  m.setPosition(0, 0, 0);
  m.decompose(mesh.position, mesh.quaternion, mesh.scale);
  mesh.position.set(0, 0, 0);
  pivot.add(mesh);
  return pivot;
}

// ---------------------------------------------------------------- vehicles
// type -> model description. rotY turns the model so it faces +z.
export const VEHICLE_MODELS = {
  sedan: { file: 'sedan' },
  sports: { file: 'sports-sedan' },
  suv: { file: 'suv' },
  luxury: { file: 'suv-luxury' },
  hatchback: { file: 'hatchback' },
  taxi: { file: 'taxi' },
  police: { file: 'police-car' },
  van: { file: 'van' },
  pickup: { file: 'truck' },
  truck: { file: 'delivery-truck' },
  firetruck: { file: 'firetruck' },
  garbage: { file: 'garbage-truck' },
  ambulance: { file: 'ambulance' },
  racecar: { file: 'race-car' },
  tractor: { file: 'tractor' },
  bike: { file: 'motorcycle' },
  bicycle: { file: 'bike', rotY: -Math.PI / 2 },
  heli: { file: 'helicopter' },
  policeHeli: { file: 'helicopter' },
  plane: { file: 'aerobatic_plane' },
  boat: { file: 'boat-large', rotY: Math.PI },
};

const vehTemplates = new Map();
// Returns {root, size, wheels:[{pivot,front}], paint:[materials], rotor, tail, prop} template or null.
function vehicleTemplate(type, spec) {
  if (vehTemplates.has(type)) return vehTemplates.get(type);
  const d = VEHICLE_MODELS[type];
  const g = d && raw.get(d.file);
  if (!g) {
    vehTemplates.set(type, null);
    return null;
  }
  const scene = SkeletonUtils.clone(g.scene);
  const sizeKey = spec.kind === 'plane' ? { width: spec.wid } : { length: spec.len };
  const { root, size } = normalize(scene, { rotY: d.rotY || 0, ...sizeKey });
  const t = { root, size };
  // collisions and camera use the model's real proportions
  if (spec.kind === 'plane') spec.len = size.z;
  else spec.wid = size.x;
  spec.height = size.y;
  // tag spinning parts, then give wheels and rotors their own pivots (once, on the template)
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((o) => o.isMesh && meshes.push(o));
  const wheelMeshes = [];
  for (const m of meshes) {
    const n = (m.name + ' ' + (m.parent ? m.parent.name : '')).toLowerCase();
    if (/wheel/.test(n)) wheelMeshes.push(m);
    if (/topfin/.test(n)) recenter(m).userData.part = 'rotor';
    if (/helicopterbackwings|backwingscontainer/.test(n)) recenter(m).userData.part = 'tail';
  }
  const byParent = new Map();
  for (const m of wheelMeshes) {
    // tyre + rim share a wheel node; otherwise each wheel mesh stands alone
    const key = /wheel/i.test(m.parent.name) ? m.parent : m;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(m);
  }
  for (const [, list] of byParent) {
    const parent = list[0].parent;
    const b = new THREE.Box3();
    for (const m of list) {
      m.geometry.computeBoundingBox();
      b.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrix));
    }
    const c = b.getCenter(new THREE.Vector3());
    const pivot = new THREE.Group();
    pivot.position.copy(c);
    parent.add(pivot);
    const spin = new THREE.Group();
    spin.userData.part = 'spin';
    pivot.add(spin);
    for (const m of list) {
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrix);
      g.translate(-c.x, -c.y, -c.z);
      m.geometry = g;
      m.position.set(0, 0, 0);
      m.quaternion.identity();
      m.scale.set(1, 1, 1);
      spin.add(m);
    }
    root.updateMatrixWorld(true);
    const wc = root.worldToLocal(pivot.getWorldPosition(new THREE.Vector3()));
    pivot.userData.part = wc.z > 0 ? 'wheelF' : 'wheelB';
  }
  vehTemplates.set(type, t);
  return t;
}

const paintCache = new Map();
function paintFor(mat, hex) {
  const k = mat.uuid + ':' + hex;
  let m = paintCache.get(k);
  if (!m) {
    m = mat.clone();
    m.color.setHex(hex);
    paintCache.set(k, m);
  }
  return m;
}

// Build an instance of a vehicle model. Returns null when the model is unavailable.
export function buildVehicleModel(type, spec, color) {
  const t = vehicleTemplate(type, spec);
  if (!t) return null;
  const root = SkeletonUtils.clone(t.root);
  const out = { root, wheels: [], size: t.size, model: true, meshes: [] };
  root.traverse((o) => {
    const part = o.userData.part;
    if (part === 'wheelF' || part === 'wheelB') out.wheels.push({ pivot: o, spin: o.children[0], front: part === 'wheelF' });
    else if (part === 'rotor') out.rotor = o;
    else if (part === 'tail') out.tail = o;
    if (!o.isMesh) return;
    o.castShadow = true;
    out.meshes.push(o);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (color !== null && color !== undefined && mats.some((m) => /paint|helicopterbody/i.test(m.name))) {
      o.material = Array.isArray(o.material) ? o.material.map((m) => (/paint|helicopterbody/i.test(m.name) ? paintFor(m, color) : m)) : paintFor(o.material, color);
    }
    if (o.isSkinnedMesh) {
      o.frustumCulled = false;
      const prop = o.skeleton.bones.find((b) => /propel/i.test(b.name));
      if (prop) out.propBone = prop;
    }
  });
  return out;
}

// ---------------------------------------------------------------- people
const CHAR_FILES = { player: 'male', civ: ['survivor-male', 'survivor-female', 'skater-male', 'skater-female'], cop: 'male', gang: 'skater-male' };
const charTemplates = new Map();

const uniformMats = new Map();
function uniformMaterial(base, kind, tint) {
  const key = base.uuid + ':' + kind + ':' + tint;
  if (uniformMats.has(key)) return uniformMats.get(key);
  const m = base.clone();
  const col = new THREE.Color(kind === 'cop' ? 0x16264a : tint);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTint = { value: col };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uTint;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec3 c = diffuseColor.rgb;
          float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
          float sat = mx > 0.0 ? (mx - mn) / mx : 0.0;
          ${kind === 'cop'
            ? 'if (sat < 0.2 && mx > 0.38) diffuseColor.rgb = uTint * (0.7 + mx * 0.6);'
            : 'if (c.r > c.g * 1.7 && c.r > c.b * 1.7 && sat > 0.45) diffuseColor.rgb = uTint * (0.5 + mx);'}
        }`
      );
  };
  m.customProgramCacheKey = () => 'uniform-' + kind;
  uniformMats.set(key, m);
  return m;
}

function charTemplate(file) {
  if (charTemplates.has(file)) return charTemplates.get(file);
  const g = raw.get(file);
  if (!g) {
    charTemplates.set(file, null);
    return null;
  }
  const scene = SkeletonUtils.clone(g.scene);
  // Kenney's characters are chibi-proportioned; shrink the head and lengthen the
  // limbs for a more adult silhouette (normalize() below re-grounds the feet).
  const ADULT = { Head: 0.62, Neck: 1.0, LeftUpLeg: 1.16, RightUpLeg: 1.16, LeftArm: 1.12, RightArm: 1.12, Spine: 1.06 };
  scene.traverse((o) => {
    if (o.isBone && ADULT[o.name]) o.scale.multiplyScalar(ADULT[o.name]);
  });
  // undo the limb scaling on hands/feet so they don't grow too
  scene.traverse((o) => {
    if (o.isBone && /^(Left|Right)(Foot|Hand)$/.test(o.name)) o.scale.multiplyScalar(1 / (/Foot/.test(o.name) ? 1.16 : 1.12));
    if (o.isBone && o.name === 'Chest') o.scale.multiplyScalar(1 / 1.06);
  });
  const { root } = normalize(scene, { height: 1.8 });
  charTemplates.set(file, root);
  return root;
}

// realistic body templates (feet on the ground, facing +Z)
const humanTemplates = new Map();
function humanTemplate(file) {
  if (humanTemplates.has(file)) return humanTemplates.get(file);
  const g = raw.get(file);
  let t = null;
  if (g) {
    t = g.scene;
    t.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(t);
    if (Math.abs(b.min.y) > 0.02) t.position.y -= b.min.y;
  }
  humanTemplates.set(file, t);
  return t;
}
function pickHuman(kind, variant) {
  const list = (HUMANS[kind] || HUMANS.civ).filter((f) => raw.has(f));
  if (!list.length) return null;
  return list[variant % list.length];
}

// Returns a rig {root, pose(p) or update(state, dt), setGun(v), skinned:true} or null
export function buildCharacterModel(kind, variant = 0, tint = null) {
  if (hasAnimations()) {
    const file = pickHuman(kind, variant);
    const tpl = file && humanTemplate(file);
    if (tpl) {
      const opts = {};
      // uniforms and gang colours: tint the outfit material when the body has no dedicated one
      if (kind === 'gang' && tint !== null) Object.assign(opts, { tint: /gangtop/i, tintColor: tint });
      return makeAnimatedRig(tpl, opts);
    }
  }
  let file = CHAR_FILES[kind] || CHAR_FILES.civ;
  if (Array.isArray(file)) file = file[variant % file.length];
  const tpl = charTemplate(file);
  if (!tpl) return null;
  const root = SkeletonUtils.clone(tpl);
  let mesh = null;
  root.traverse((o) => {
    if (o.isSkinnedMesh) mesh = o;
    if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; }
  });
  if (!mesh) return null;
  // police uniforms and gang colours: recolour texels in the shader
  if (kind === 'cop' || kind === 'gang') mesh.material = uniformMaterial(mesh.material, kind, tint);
  return makeRig(root, mesh);
}

// Procedural pose driver for the Kenney humanoid skeleton.
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
function makeRig(root, mesh) {
  const bones = {};
  for (const b of mesh.skeleton.bones) bones[b.name] = b;
  root.updateMatrixWorld(true);
  const rootQ = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  const J = {};
  // for each animated bone: rest quaternion + character axes expressed in the parent's frame
  for (const n of ['Hips', 'Spine', 'Chest', 'Neck', 'Head', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftShoulder', 'RightShoulder']) {
    const b = bones[n];
    if (!b) continue;
    const pq = b.parent.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootQ).invert();
    J[n] = {
      b,
      rest: b.quaternion.clone(),
      x: AX.clone().applyQuaternion(pq).normalize(),
      y: AY.clone().applyQuaternion(pq).normalize(),
      z: AZ.clone().applyQuaternion(pq).normalize(),
    };
  }
  // rotate a joint by (ax, ay, az) radians about the character's axes, applied z, then y, then x
  const set = (n, ax = 0, ay = 0, az = 0) => {
    const j = J[n];
    if (!j) return;
    _q.copy(j.rest);
    if (az) _q.premultiply(_q2.setFromAxisAngle(j.z, az));
    if (ay) _q.premultiply(_q2.setFromAxisAngle(j.y, ay));
    if (ax) _q.premultiply(_q2.setFromAxisAngle(j.x, ax));
    j.b.quaternion.copy(_q);
  };
  // gun in the right hand
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.24, 0.1).translate(0, 0.1, 0.03), new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
  gun.visible = false;
  const hand = bones.RightHand;
  if (hand) {
    hand.add(gun);
    const s = new THREE.Vector3();
    hand.getWorldScale(s);
    gun.scale.setScalar(1 / s.x);
  }
  return {
    root,
    skinned: true,
    gun,
    setGun(v) {
      gun.visible = v;
    },
    // p: {legL, legR, kneeL, kneeR, armL, armR (swing), aim, aimPitch, lift (arms up), punch, lean}
    pose(p) {
      const down = 1.25; // T-pose -> arms by the side
      set('LeftUpLeg', -p.legL);
      set('RightUpLeg', -p.legR);
      set('LeftLeg', p.kneeL || 0);
      set('RightLeg', p.kneeR || 0);
      if (p.aim) {
        set('RightArm', -(p.aimPitch || 0), 1.5, 0);
        set('LeftArm', -(p.aimPitch || 0), -1.2, -0.35);
        set('RightForeArm', 0, 0, 0);
        set('LeftForeArm', 0, -0.3, 0);
      } else if (p.lift) {
        set('LeftArm', p.armL * 0.4, 0, 0.6);
        set('RightArm', p.armR * 0.4, 0, -0.6);
        set('LeftForeArm', 0, 0, 0.4);
        set('RightForeArm', 0, 0, -0.4);
      } else if (p.punch) {
        set('RightArm', 0, 1.45, 0);
        set('LeftArm', -p.armL, 0, -down);
      } else {
        set('LeftArm', -p.armL, 0, -down);
        set('RightArm', -p.armR, 0, down);
        set('LeftForeArm', 0, 0, 0);
        set('RightForeArm', 0, 0, 0);
      }
      set('Spine', p.lean || 0);
    },
  };
}

// ---------------------------------------------------------------- static props (instancing)
// Merge a model into one geometry per material with transforms baked in (for InstancedMesh).
const propCache = new Map();
export function propParts(file, { height = null, width = null, rotY = 0, center = true } = {}) {
  const key = file + ':' + height + ':' + width + ':' + rotY + ':' + center;
  if (propCache.has(key)) return propCache.get(key);
  const g = raw.get(file);
  if (!g) {
    propCache.set(key, null);
    return null;
  }
  const scene = g.scene.clone(true);
  const { root, size } = normalize(scene, { rotY, height, width, center });
  root.updateMatrixWorld(true);
  const byMat = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
    for (const a of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(a)) geo.deleteAttribute(a);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const mat = o.material;
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat).push(geo.index ? geo.toNonIndexed() : geo);
  });
  const parts = [];
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    if (merged) parts.push({ geometry: merged, material: mat });
  }
  const res = { parts, size };
  propCache.set(key, res);
  return res;
}

// Make InstancedMeshes for a prop from a list of matrices, split into map tiles so
// the renderer can frustum-cull them and updateTileVisibility can drop far ones.
export const TILED = [];
const TILE = 500;
export function instanceProp(file, opts, matrices, { shadow = true } = {}) {
  const p = propParts(file, opts);
  if (!p || !matrices.length) return null;
  const tiles = new Map();
  for (const mx of matrices) {
    const k = Math.floor(mx.elements[12] / TILE) + ':' + Math.floor(mx.elements[14] / TILE);
    if (!tiles.has(k)) tiles.set(k, []);
    tiles.get(k).push(mx);
  }
  const out = [];
  for (const list of tiles.values()) {
    let cx = 0, cz = 0;
    for (const mx of list) { cx += mx.elements[12]; cz += mx.elements[14]; }
    cx /= list.length;
    cz /= list.length;
    for (const { geometry, material } of p.parts) {
      const m = new THREE.InstancedMesh(geometry, material, list.length);
      list.forEach((mx, i) => m.setMatrixAt(i, mx));
      m.castShadow = shadow;
      m.receiveShadow = true;
      m.computeBoundingSphere();
      m.userData.tile = { x: cx, z: cz, r: m.boundingSphere.radius };
      TILED.push(m);
      out.push(m);
    }
  }
  return out;
}

export function updateTileVisibility(cam, maxDist) {
  for (const m of TILED) {
    const t = m.userData.tile;
    m.visible = Math.hypot(cam.x - t.x, cam.z - t.z) - t.r < maxDist;
  }
}
