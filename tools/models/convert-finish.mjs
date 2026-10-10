// Second stage for the two Webots conversions (convert-tesla.mjs ->
// build/volt3-raw.glb, convert-sprinter.mjs -> build/courier-van-raw.glb):
// canonical wheel_xx nodes, game-sized textures (the raw Volt 3 carries
// 2048 px PNG normal/occlusion maps, 26 MB), body paint named 'paint',
// credits in asset.copyright.
// Usage: node convert-finish.mjs [volt3|courier-van]
import { NodeIO } from '@gltf-transform/core';
import { bakeAll, extractWheels, groundAndCentre, simplifyAndJoin, encodeTextures, checkCar, setCredit, tameMetal } from './rig.mjs';
import sharp from 'sharp';
import fs from 'fs';

// Fill rects (x, y, w, h in 1024 px texture space) with the rect's median
// colour: wipes small lettering/badges printed on flat-colour atlas areas.
async function scrubTexture(tex, rects) {
  const { data, info } = await sharp(tex.getImage()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const k = info.width / 1024;
  for (const r of rects) {
    const [x, y, w, h] = r.map((v) => Math.round(v * k));
    const med = [0, 1, 2, 3].map((c) => {
      const vals = [];
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) vals.push(data[((y + j) * info.width + x + i) * 4 + c]);
      vals.sort((a, b) => a - b);
      return vals[vals.length >> 1];
    });
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) for (let c = 0; c < 4; c++) data[((y + j) * info.width + x + i) * 4 + c] = med[c];
  }
  tex.setImage(await sharp(data, { raw: info }).png().toBuffer()).setMimeType('image/png');
}

const OUT_DIR = '../../public/game/assets/models/';
const JOBS = {
  volt3: {
    src: 'build/volt3-raw.glb',
    scene: 'Volt3',
    // wheel proto instances are separate nodes in the raw file
    wheel: (node) => /^wheel_(front|rear)_(left|right)$/.test(node.getName()),
    ratio: 1,
    // normal maps at 512 px / q80 showed as creases on the body panels
    tex: { max: 1024, normalMax: 1024, quality: 88 },
    // occlusion maps add little at game distance and are the bulk of the file
    dropOcclusion: true,
    paint: 'body',
    // stage 1 placed all four wheel instances with the same orientation, so the
    // right-hand rims face inwards and sit 8 cm further out: mirror them
    mirrorRight: true,
    // the wheel atlas still carries the brand: centre-cap badge + 4 sidewall/cap lettering
    scrub: { wheel: [[334, 398, 32, 30], [450, 246, 40, 32], [210, 230, 35, 24], [526, 282, 28, 32], [756, 260, 40, 26]] },
    copyright: 'Volt 3: geometry and textures from the Webots TeslaModel3 Coachwork/Details/Wheel/Windows/FrontLights protos (Cyberbotics Ltd., webots commit 67d291f, CC BY 4.0, https://github.com/cyberbotics/webots). Badges removed, converted and rigged for Crimson Coast.',
  },
  'courier-van': {
    src: 'build/courier-van-raw.glb',
    scene: 'CourierVan',
    wheel: (node) => /^wheel_(front|rear)_(left|right)_tyre$/.test(node.getName()),
    ratio: 0.4,
    tex: { max: 1024 },
    copyright: 'Courier Van: meshes from the Webots MercedesBenzSprinter protos (Cyberbotics Ltd., Apache License 2.0, https://github.com/cyberbotics/webots). Logos removed, generic wheels added, converted and rigged for Crimson Coast.',
  },
};

// Turn x<0 wheels 180 deg about Y (rim face outwards) and place them at the
// mirror image of their left-hand partner.
function mirrorRightWheels(doc) {
  const nodes = doc.getRoot().listNodes().filter((n) => /^wheel_/.test(n.getName()));
  for (const n of nodes) {
    const t = n.getTranslation();
    if (t[0] >= 0) continue;
    const partner = nodes.find((o) => o.getName() === n.getName().replace(/^wheel_(.)r/, 'wheel_$1l'));
    const mesh = n.getMesh().clone();
    n.setMesh(mesh);
    for (const p of mesh.listPrimitives()) for (const sem of ['POSITION', 'NORMAL']) {
      const a = p.getAttribute(sem);
      if (!a) continue;
      const e = [0, 0, 0];
      for (let i = 0; i < a.getCount(); i++) { a.getElement(i, e); a.setElement(i, [-e[0], e[1], -e[2]]); }
    }
    n.setTranslation([-partner.getTranslation()[0], t[1], t[2]]);
    console.log('  mirrored', n.getName(), 'to x', n.getTranslation()[0].toFixed(3));
  }
}

const io = new NodeIO();
const want = process.argv.slice(2);
for (const [name, job] of Object.entries(JOBS)) {
  if (want.length && !want.includes(name)) continue;
  console.log(name);
  const doc = await io.read(job.src);
  await bakeAll(doc);
  // the cabin steering wheel must not look like a road wheel to the game
  for (const n of doc.getRoot().listNodes()) if (/steering/i.test(n.getName())) n.setName('steering');
  extractWheels(doc, (n) => job.wheel(n), { axleGap: 0.3, symmetrize: !job.mirrorRight });
  if (job.mirrorRight) mirrorRightWheels(doc);
  groundAndCentre(doc);
  if (job.paint) for (const m of doc.getRoot().listMaterials()) if (m.getName() === job.paint) m.setName('paint');
  if (job.scrub) for (const [mat, rects] of Object.entries(job.scrub)) {
    const m = doc.getRoot().listMaterials().find((o) => o.getName() === mat);
    await scrubTexture(m.getBaseColorTexture(), rects);
  }
  if (job.dropOcclusion) for (const m of doc.getRoot().listMaterials()) m.setOcclusionTexture(null);
  tameMetal(doc, 0.45);
  await simplifyAndJoin(doc, { ratio: job.ratio, error: 0.003 });
  await encodeTextures(doc, job.tex);
  setCredit(doc, job.scene, job.copyright);
  checkCar(doc, name);
  await io.write(OUT_DIR + name + '.glb', doc);
  console.log('  wrote', (fs.statSync(OUT_DIR + name + '.glb').size / 1024).toFixed(0) + 'KB');
}
