import { NodeIO } from '@gltf-transform/core';
import fs from 'fs';
const io = new NodeIO();
const doc = await io.read(process.argv[2]);
const out = process.argv[3];
fs.mkdirSync(out, { recursive: true });
for (const t of doc.getRoot().listTextures()) {
  const img = t.getImage();
  const name = (t.getName() || 'tex').replace(/[^\w.-]/g, '_');
  fs.writeFileSync(`${out}/${name}.png`, img);
  console.log(name, img.length, 'bytes');
}
