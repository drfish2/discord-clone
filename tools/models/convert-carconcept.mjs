// Converts the Khronos CarConcept sample (CC-BY 4.0, Eric Chadwick / Darmstadt
// Graphics Group GmbH) into a plain host-safe GLB: Khronos logo neutralised,
// wheels rigged as wheel_xx nodes (front pair straightened), textures that
// relied on KHR_texture_transform tiling dropped (without the extension they
// stretch into giant blocks), simplified. Output: vector-gt.glb ("Vector GT").
import { NodeIO } from '@gltf-transform/core';
import { bakeAll, extractWheels, groundAndCentre, simplifyAndJoin, encodeTextures, checkCar, setCredit, tameMetal } from './rig.mjs';
import sharp from 'sharp';
import fs from 'fs';

const SRC = 'C:/Users/munee/.zcode/workspace/default/crimson-coast/car-models/car-concept/glTF/CarConcept.gltf';
const OUT = '../../public/game/assets/models/vector-gt.glb';

const io = new NodeIO();
const doc = await io.read(SRC);
const root = doc.getRoot();

for (const t of root.listTextures()) {
  if (t.getName() === 'Khronos_C' || /Khronos_C/.test(t.getURI())) {
    // fully black: kills the glowing logo decals and the logo plate in one go
    const black = await sharp({ create: { width: 8, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    t.setImage(black).setMimeType('image/png');
  }
}
// materials whose maps were tiled with KHR_texture_transform upstream
const TILED_NORMAL = /^(Interior 1|Interior 2|Interior 3 .*|Floormat|Paint .*|Tiretread|Disc)$/;
for (const m of root.listMaterials()) {
  const n = m.getName() || '';
  if (TILED_NORMAL.test(n)) m.setNormalTexture(null);
  if (n === 'Disc') { m.setBaseColorTexture(null); m.setBaseColorFactor([0.35, 0.35, 0.36, 1]); }
  if (n === 'License') { m.setBaseColorTexture(null); m.setBaseColorFactor([0.82, 0.82, 0.82, 1]); }
  // KHR_materials_transmission is dropped (host constraint): blended dark glass instead
  if (n === 'Glass') {
    m.setBaseColorFactor([0.05, 0.07, 0.08, 1]).setAlphaMode('BLEND').setAlpha(0.45).setRoughnessFactor(0.12).setMetallicFactor(0);
  }
  // main body colour -> 'paint' (traffic recolour); the secondary dark panels stay as trim
  if (n === 'Paint 1 Carmine') m.setName('paint');
  else if (/^Paint 2/.test(n)) m.setName('bodytrim');
  else if (/^Paint /.test(n)) m.setName('variant_' + n.split(' ').slice(1).join('_'));
}
// Wheel parts: everything under WheelFrontL/R, WheelRearL/R except the brake
// pads (they don't spin). Collected before flattening.
const spin = new Set();
for (const n of root.listNodes()) {
  if (!/^Wheel(Front|Rear)[LR]$/.test(n.getName())) continue;
  n.traverse((c) => { if (c.getMesh() && !/BrakePad/.test(c.getName())) spin.add(c); });
}
for (const n of root.listNodes()) {
  if (/SteeringWheel/.test(n.getName())) n.setName(n.getName().replace('SteeringWheel', 'Steering'));
  if (/emblem|khronos|3d commerce|sample/i.test(n.getName())) n.setName('trimpart');
}
// size: tangents are rebuilt by the renderer, and the second UV set only feeds
// the 2048 px shared occlusion map, which is dropped (no AO at game distances)
for (const m of root.listMaterials()) m.setOcclusionTexture(null);
for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
  p.setAttribute('TANGENT', null);
  p.setAttribute('TEXCOORD_1', null);
}
await bakeAll(doc);
extractWheels(doc, (n) => spin.has(n), { axleGap: 0.3 });
groundAndCentre(doc);
tameMetal(doc, 0.45);
await simplifyAndJoin(doc, { ratio: 0.12, error: 0.01, wheelRatio: 0.3 });
await encodeTextures(doc, { max: 1024, normalMax: 512 });
setCredit(doc, 'VectorGT', 'Vector GT: based on the Khronos glTF Sample Asset "CarConcept" by Eric Chadwick, Darmstadt Graphics Group GmbH (2024), CC BY 4.0, itself derived from a CC0 model by Unity Fan. Logos removed, simplified and rigged for Crimson Coast.');
checkCar(doc, 'vector-gt');
await io.write(OUT, doc);
console.log('wrote', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + 'KB');
