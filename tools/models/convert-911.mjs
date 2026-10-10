// Converts the Draco-compressed Porsche 911 (CC-BY-SA 4.0, Karol Miklas) into a
// plain, host-safe GLB for the game: decal branding neutralised, wheels split
// into wheel_xx nodes (front pair straightened), mesh simplified, textures
// <=1024, extensions cleared. Output: rossini-9x.glb ("Rossini 9X").
// build/911-decoded.glb is the upstream Draco GLB decoded once with
//   npx gltf-transform copy <car-models>/porsche-911/911-transformed.glb build/911-decoded.glb
import { NodeIO } from '@gltf-transform/core';
import { bakeAll, extractWheels, groundAndCentre, simplifyAndJoin, encodeTextures, checkCar, setCredit, tameMetal } from './rig.mjs';
import { PNG } from 'pngjs';
import fs from 'fs';

const SRC = 'build/911-decoded.glb';
const OUT = '../../public/game/assets/models/rossini-9x.glb';

// ---------------------------------------------------------------- texture patches
// logo_baseColor.png (512x512): the whole texture is the Porsche crest badge —
// replace with a flat neutral dark (badge keeps its 3D shape, loses the logo).
const logoPng = PNG.sync.read(fs.readFileSync('build/tex911/logo_baseColor.png'));
for (let i = 0; i < logoPng.data.length; i += 4) {
  logoPng.data[i] = 26; logoPng.data[i + 1] = 26; logoPng.data[i + 2] = 28; logoPng.data[i + 3] = 255;
}
// tex_shiny_baseColor.png (1024x1024): blank the crest (y 40-395) and the
// "PORSCHE / 911 Carrera 4S" script band (y 400-640); keep taillight art below.
const shinyPng = PNG.sync.read(fs.readFileSync('build/tex911/tex_shiny_baseColor.png'));
const blankRect = (png, x0, y0, x1, y1) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * png.width + x) * 4;
    png.data[i] = 0; png.data[i + 1] = 0; png.data[i + 2] = 0; png.data[i + 3] = 0;
  }
};
blankRect(shinyPng, 380, 40, 660, 395);
blankRect(shinyPng, 70, 400, 975, 645);
fs.writeFileSync('build/tex911/logo_baseColor_patched.png', PNG.sync.write(logoPng));
fs.writeFileSync('build/tex911/tex_shiny_baseColor_patched.png', PNG.sync.write(shinyPng));
console.log('textures patched');

// ---------------------------------------------------------------- document edit
const io = new NodeIO();
const doc = await io.read(SRC);
const root = doc.getRoot();

for (const t of root.listTextures()) {
  const n = t.getName() || '';
  if (n === 'logo_baseColor') t.setImage(fs.readFileSync('build/tex911/logo_baseColor_patched.png'));
  if (n === 'tex_shiny_baseColor') t.setImage(fs.readFileSync('build/tex911/tex_shiny_baseColor_patched.png'));
}

// The 'coat' material is a second, semi-transparent shell over the whole body
// that fakes clearcoat; it only darkens the paint in the game (no env map) and
// costs a full body's worth of triangles.
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
  if (p.getMaterial()?.getName() === 'coat') { m.removePrimitive(p); p.dispose(); }
}
await bakeAll(doc);
// Cylinder.000 = rear axle, Cylinder.001 = front axle, each one mesh holding
// both wheels: _0 rim (silver), _1 spokes/disc (plastic), _2 tyre (rubber).
// _3 are the brake calipers, which stay on the body (they don't spin).
extractWheels(doc, (n) => /^Cylinder.00[01]_[012]$/.test(n.getName()), { axleGap: 0.3 });
groundAndCentre(doc);

// neutral, fictional names everywhere
const matRename = { logo: 'badge', tex_shiny: 'decal', license: 'plate', 'Material.001': 'caliper' };
for (const m of root.listMaterials()) m.setName(matRename[m.getName()] || m.getName());
tameMetal(doc, 0.45);
await simplifyAndJoin(doc, { ratio: 0.07, error: 0.003, wheelRatio: 0.12 });
await encodeTextures(doc, { max: 1024, normalMax: 512 });
setCredit(doc, 'Rossini9X', 'Rossini 9X: based on "Porsche 911 Carrera 4S" by Karol Miklas (https://sketchfab.com/karolmiklas), CC BY-SA 4.0, via the pmndrs examples. Modified for Crimson Coast (badges and lettering removed, simplified, rigged); this derivative is CC BY-SA 4.0.');
checkCar(doc, 'rossini-9x');
fs.mkdirSync('../../public/game/assets/models', { recursive: true });
await io.write(OUT, doc);
console.log('wrote', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + 'KB');
