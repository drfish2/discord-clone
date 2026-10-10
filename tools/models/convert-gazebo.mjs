// Second stage for the OSRF gazebo_models vehicles (CC-BY 3.0). batch_gazebo.py
// (Blender) turns the upstream OBJ/DAE into build/gz/<name>.glb in metres,
// facing +Z. This stage rigs them for the game: the wheel material's triangles
// are split into wheel_xx nodes, textures go to JPEG, upstream names are
// neutralised and the credit goes into asset.copyright.
// Usage: node convert-gazebo.mjs [name ...]
import { NodeIO } from '@gltf-transform/core';
import { bakeAll, extractWheels, groundAndCentre, simplifyAndJoin, encodeTextures, checkCar, setCredit, tameMetal } from './rig.mjs';
import sharp from 'sharp';
import fs from 'fs';

// Clone-stamp patches that paint over manufacturer badges baked into the body
// atlas: [x, y, w, h, dx, dy] copies the rect at (x+dx, y+dy) over (x, y).
// Coordinates are in the 1024x1024 body texture.
async function patchTexture(tex, patches) {
  const { data, info } = await sharp(tex.getImage()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, k = W / 1024;
  for (const [x0, y0, w0, h0, dx0, dy0] of patches) {
    const [x, y, w, h, dx, dy] = [x0, y0, w0, h0, dx0, dy0].map((v) => Math.round(v * k));
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const d = ((y + j) * W + x + i) * 4, s = ((y + j + dy) * W + x + i + dx) * 4;
      for (let c = 0; c < 4; c++) data[d + c] = data[s + c];
    }
  }
  tex.setImage(await sharp(data, { raw: info }).png().toBuffer()).setMimeType('image/png');
}

const OUT_DIR = '../../public/game/assets/models/';
const CREDIT = (what) => `${what} from the OSRF gazebo_models collection (Open Source Robotics Foundation), CC BY 3.0, https://github.com/osrf/gazebo_models. Converted and rigged for Crimson Coast.`;

// wheels: material names whose triangles are wheels. bodyName: scene name.
const JOBS = {
  'gz-hatchback': { wheels: /^Wheels3$/, scene: 'Hatchback', credit: 'Hatchback' },
  'gz-hatchback-red': { wheels: /^Wheels3$/, scene: 'HatchbackRed', credit: 'Hatchback (red)' },
  'gz-prius': { wheels: /^Wheels3$/, scene: 'HybridSedan', credit: 'Hybrid sedan (prius_hybrid)' },
  'gz-suv': { wheels: /^SUV_Wheels$/, scene: 'SUV', credit: 'SUV', badges: [[574, 814, 50, 26, -56, 0]] },
  'gz-pickup': { wheels: /^Pickup_Wheels$/, scene: 'Pickup', credit: 'Pickup', badges: [[258, 874, 36, 30, -44, 0]] },
  'gz-ambulance': { wheels: /^Firetruck_Wheels$/, scene: 'Ambulance', credit: 'Ambulance' },
  'gz-bus': { wheels: /^Wheels_01$/, scene: 'Bus', credit: 'Bus' },
  // tyres are 'Firetruck_Wheels'; the 'Firetruck_Axle' hubs/shafts stay on the body
  'gz-firetruck': { wheels: /^Firetruck_Wheels$/, scene: 'FireTruck', credit: 'Fire truck',
    badges: [[862, 571, 25, 15, -24, 0], [928, 603, 23, 24, 23, 0], [994, 621, 22, 20, 0, 22], [553, 966, 27, 18, 0, -16]] },
};

const io = new NodeIO();
const want = process.argv.slice(2);
for (const [name, job] of Object.entries(JOBS)) {
  if (want.length && !want.includes(name)) continue;
  console.log(name);
  const doc = await io.read(`build/gz/${name}.glb`);
  await bakeAll(doc);
  extractWheels(doc, (n, mesh, p) => job.wheels.test(p.getMaterial()?.getName() || ''), { axleGap: 0.15 });
  groundAndCentre(doc);
  // neutral node/material names (upstream names include the product names)
  for (const m of doc.getRoot().listMaterials()) {
    if (/hybrid/i.test(m.getName())) m.setName(m.getName().replace(/hybrid/i, 'Sedan'));
  }
  if (job.badges) {
    const body = doc.getRoot().listMaterials().find((m) => m.getBaseColorTexture() && !/wheel|interior/i.test(m.getName()));
    await patchTexture(body.getBaseColorTexture(), job.badges);
  }
  // untextured wheel materials (bus, ambulance, fire truck) import as plain white
  for (const m of doc.getRoot().listMaterials()) {
    if (!m.getBaseColorTexture() && /wheel/i.test(m.getName())) m.setBaseColorFactor([0.06, 0.06, 0.06, 1]).setRoughnessFactor(0.9).setMetallicFactor(0);
  }
  tameMetal(doc, 0.4);
  const texBase = job.scene.toLowerCase();
  doc.getRoot().listTextures().forEach((t, i) => t.setName(texBase + '_' + i));
  await simplifyAndJoin(doc, { ratio: 1 });
  await encodeTextures(doc, { max: 1024, quality: 82 });
  setCredit(doc, job.scene, CREDIT(job.credit));
  checkCar(doc, name);
  await io.write(OUT_DIR + name + '.glb', doc);
  console.log('  wrote', (fs.statSync(OUT_DIR + name + '.glb').size / 1024).toFixed(0) + 'KB');
}
