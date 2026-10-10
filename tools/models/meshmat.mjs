import { NodeIO } from '@gltf-transform/core';
const io = new NodeIO();
const doc = await io.read(process.argv[2]);
const want = process.argv[3] ? process.argv[3].split(',') : null;
for (const m of doc.getRoot().listMeshes()) {
  for (const p of m.listPrimitives()) {
    const mat = p.getMaterial();
    const names = doc.getRoot().listNodes().filter(n => n.getMesh() === m).map(n => n.getName());
    if (!want || want.includes(mat.getName())) console.log('mesh', m.getName(), '->', mat.getName(), '| nodes:', names.slice(0,3).join('/'));
  }
}
