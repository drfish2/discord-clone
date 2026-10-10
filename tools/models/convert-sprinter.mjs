// Converts the Webots Mercedes-Benz Sprinter (Apache-2.0, Cyberbotics Ltd.) into
// a plain host-safe GLB for the game: "Courier Van".
// - OBJ meshes placed in their native Y-up, +Z-forward space (Webots' flatten
//   rotation is skipped; it maps OBJ +Z -> Webots +X, OBJ +Y -> Webots +Z).
// - Mercedes star logos (front_logo, front_logo_support, rear_logo) are skipped.
// - The detailed proto has no wheel geometry: four stylised wheels are generated
//   as named nodes so the game can spin/steer them (axles from Simple.proto:
//   front x=4.325, rear x=0, track +/-0.85, all in Webots metres).
// - Materials mirror the proto appearances (GlossyPaint, RoughPolymer, ...).
import { NodeIO, Document, Scene } from '@gltf-transform/core';
import { weld, simplify, prune, dedup, join } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { resizeTextures } from './lib.mjs';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const obj2gltf = require('obj2gltf');

const SRC = 'C:/Users/munee/.zcode/workspace/default/crimson-coast/car-models/webots-mercedes-sprinter/meshes';
const BUILD = 'build/van';
// stage 1 output; convert-finish.mjs rigs it into public/game/assets/models/courier-van.glb
const OUT = process.env.OUT || 'build/courier-van-raw.glb';

// part -> [materialName, color(r,g,b), roughness, metallic, alphaMode, alpha]
const PARTS = {
  coachwork: ['paint', [0.98, 0.1, 0.1, 1], 0.35, 0.6],
  coachwork_front: ['paint', [0.98, 0.1, 0.1, 1], 0.35, 0.6],
  roof_and_rear: ['paint', [0.98, 0.1, 0.1, 1], 0.35, 0.6],
  plastic: ['trim', [0.02, 0.02, 0.02, 1], 0.9, 0],
  bumper: ['trim', [0.02, 0.02, 0.02, 1], 0.9, 0],
  windows: ['glass', [0.35, 0.48, 0.61, 1], 0.1, 0, 'BLEND', 0.5],
  mirrors: ['greyplastic', [0.47, 0.53, 0.52, 1], 0.8, 0.2],
  central_mirror: ['greyplastic', [0.47, 0.53, 0.52, 1], 0.8, 0.2],
  rear_door_joints: ['hinge', [0.6, 0.6, 0.62, 1], 0.6, 0.5],
  handles: ['trim', [0.02, 0.02, 0.02, 1], 1, 0],
  front_radiator: ['radiator', [0.117, 0.118, 0.118, 1], 0.5, 0.8],
  front_light: ['lightfront', [0.99, 1, 1, 1], 0.4, 0],
  left_indicator: ['indicator', [0.87, 0.41, 0.15, 1], 0.5, 0],
  right_indicator: ['indicator', [0.87, 0.41, 0.15, 1], 0.5, 0],
  braking_side_lights: ['lightrear', [0.43, 0.04, 0.04, 1], 0.5, 0],
  braking_top_light: ['lightrear', [0.43, 0.04, 0.04, 1], 0.5, 0],
  tail_lights: ['lightrear', [0.43, 0.04, 0.04, 1], 0.5, 0],
  rear_fog_lights: ['lightrear', [0.43, 0.04, 0.04, 1], 0.5, 0],
  backwards_white_lights: ['lightfront', [0.99, 1, 1, 1], 0.5, 0],
  polymer: ['trim', [0.02, 0.02, 0.02, 1], 0.9, 0],
  body: ['carpet', [0.16, 0.16, 0.17, 1], 1, 0],
  steering_wheel: ['leather', [0.05, 0.05, 0.06, 1], 0.8, 0],
  cockpit: ['leather', [0.05, 0.05, 0.06, 1], 0.8, 0],
  seats: ['leather', [0.05, 0.05, 0.06, 1], 0.8, 0],
};
// proto transform for the radiator (inside the flattened group -> OBJ space)
const PART_TRANSFORM = {
  front_radiator: { translation: [0, -0.136, 0], scale: [1, 1.2, 1] },
};

// ---------------------------------------------------------------- convert OBJs
fs.mkdirSync(BUILD, { recursive: true });
for (const name of Object.keys(PARTS)) {
  const out = path.join(BUILD, name + '.glb');
  if (fs.existsSync(out)) continue;
  const glb = await obj2gltf(path.join(SRC, name + '.obj'), { binary: true });
  fs.writeFileSync(out, glb);
  console.log('obj2gltf', name);
}

// ---------------------------------------------------------------- merge + edit
const io = new NodeIO();
const doc = new Document();
const glbBuffer = doc.createBuffer('CourierVanBuffer');
const scene = doc.createScene('CourierVan');
const root = doc.createNode('CourierVan');
scene.addChild(root);

for (const [name, matDef] of Object.entries(PARTS)) {
  const partDoc = await io.read(path.join(BUILD, name + '.glb'));
  const [matName, color, rough, metal, alphaMode, alpha] = matDef;
  let mat = doc.getRoot().listMaterials().find((m) => m.getName() === matName);
  if (!mat) {
    mat = doc.createMaterial(matName);
    mat.setBaseColorFactor(color);
    mat.setRoughnessFactor(rough);
    mat.setMetallicFactor(metal);
    if (alphaMode) { mat.setAlphaMode(alphaMode); mat.setAlpha(alpha); }
  }
  // adopt the part's meshes under a named node
  const holder = doc.createNode(name);
  root.addChild(holder);
  for (const srcNode of partDoc.getRoot().listNodes()) {
    const mesh = srcNode.getMesh();
    if (!mesh) continue;
    // copy primitive data into the new document
    const newMesh = doc.createMesh(name + '_mesh');
    for (const prim of mesh.listPrimitives()) {
      const newPrim = doc.createPrimitive();
      newPrim.setMaterial(mat);
      for (const sem of prim.listSemantics()) {
        const srcAcc = prim.getAttribute(sem);
        const acc = doc.createAccessor(sem);
        acc.setType(srcAcc.getType());
        acc.setArray(srcAcc.getArray()).setBuffer(glbBuffer);
        newPrim.setAttribute(sem, acc);
      }
      const idx = prim.getIndices();
      if (idx) {
        const iAcc = doc.createAccessor('indices_' + name);
        iAcc.setType('SCALAR');
        iAcc.setArray(idx.getArray()).setBuffer(glbBuffer);
        newPrim.setIndices(iAcc);
      }
      newMesh.addPrimitive(newPrim);
    }
    const n = doc.createNode(name);
    n.setMesh(newMesh);
    const t = PART_TRANSFORM[name];
    if (t) {
      if (t.translation) n.setTranslation(t.translation);
      if (t.scale) n.setScale(t.scale);
    }
    holder.addChild(n);
  }
}

// ---------------------------------------------------------------- wheels
// capped cylinder along X (axle), centred on the origin
function cylinderMesh(doc, r, w, mat, seg = 16) {
  const mesh = doc.createMesh('wheel_mesh_' + r);
  const pos = [], nor = [], idx = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const y0 = Math.cos(a0) * r, z0 = Math.sin(a0) * r;
    const y1 = Math.cos(a1) * r, z1 = Math.sin(a1) * r;
    const ny0 = Math.cos(a0), nz0 = Math.sin(a0), ny1 = Math.cos(a1), nz1 = Math.sin(a1);
    const b = pos.length / 3;
    // side quad (two tris)
    pos.push(-w / 2, y0, z0, -w / 2, y1, z1, w / 2, y1, z1, w / 2, y0, z0);
    nor.push(0, ny0, nz0, 0, ny1, nz1, 0, ny1, nz1, 0, ny0, nz0);
    idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    // caps
    for (const [sx, capStart] of [[-w / 2, 0], [w / 2, 1]]) {
      const c = pos.length / 3;
      pos.push(sx, 0, 0, sx, y0, z0, sx, y1, z1);
      const s = capStart ? 1 : -1;
      nor.push(s, 0, 0, s, 0, 0, s, 0, 0);
      if (capStart) idx.push(c, c + 1, c + 2); else idx.push(c, c + 2, c + 1);
    }
  }
  const prim = doc.createPrimitive();
  const posAcc = doc.createAccessor("p").setType("VEC3").setArray(new Float32Array(pos)).setBuffer(glbBuffer);
  const norAcc = doc.createAccessor("n").setType("VEC3").setArray(new Float32Array(nor)).setBuffer(glbBuffer);
  const idxAcc = doc.createAccessor("i").setType("SCALAR").setArray(new Uint32Array(idx)).setBuffer(glbBuffer);
  prim.setAttribute('POSITION', posAcc);
  prim.setAttribute('NORMAL', norAcc);
  prim.setIndices(idxAcc);
  prim.setMaterial(mat);
  mesh.addPrimitive(prim);
  return mesh;
}
const tyreMat = doc.createMaterial('tyre').setBaseColorFactor([0.04, 0.04, 0.04, 1]).setRoughnessFactor(0.95).setMetallicFactor(0);
const rimMat = doc.createMaterial('rim').setBaseColorFactor([0.75, 0.76, 0.78, 1]).setRoughnessFactor(0.35).setMetallicFactor(0.9);
const WHEEL_R = 0.4, TRACK = 0.85, ZF = 4.325, ZR = 0.0;
for (const [wn, x, z] of [['wheel_front_left', -TRACK, ZF], ['wheel_front_right', TRACK, ZF], ['wheel_rear_left', -TRACK, ZR], ['wheel_rear_right', TRACK, ZR]]) {
  const node = doc.createNode(wn).setTranslation([x, WHEEL_R, z]);
  const tyre = doc.createNode(wn + '_tyre').setMesh(cylinderMesh(doc, WHEEL_R, 0.3, tyreMat));
  const rim = doc.createNode(wn + '_rim').setMesh(cylinderMesh(doc, WHEEL_R * 0.55, 0.31, rimMat));
  node.addChild(tyre, rim);
  root.addChild(node);
}

await doc.transform(
  dedup(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.35, error: 0.002 }),
  prune(),
  join()
);
await resizeTextures(doc); // no-op (no textures)
await io.write(OUT, doc);
console.log('wrote', OUT);
let tris = 0;
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
  const idx = p.getIndices();
  tris += Math.round((idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3);
}
console.log('tris:', tris);
// world bbox
const wp = doc.createScene === undefined ? null : null;
const s = doc.getRoot().listScenes()[0];
let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
s.traverse((n) => {
  const mesh = n.getMesh(); if (!mesh) return;
  const m = n.getWorldMatrix();
  for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION');
    for (let i = 0; i < pos.getCount(); i++) {
      const e = pos.getElement(i, [0, 0, 0]);
      const w = [m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12], m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13], m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14]];
      for (let q = 0; q < 3; q++) { mn[q] = Math.min(mn[q], w[q]); mx[q] = Math.max(mx[q], w[q]); }
    }
  }
});
console.log('bbox min', mn.map((v) => +v.toFixed(2)).join(','), 'max', mx.map((v) => +v.toFixed(2)).join(','), 'size', mx.map((v, q) => +(v - mn[q]).toFixed(2)).join(','));
