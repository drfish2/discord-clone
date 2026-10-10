// Round-trip a GLB through plain NodeIO (drops all non-required extensions),
// then prune/dedup. Usage: node finalize.mjs <in.glb> <out.glb> [outName]
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup } from '@gltf-transform/functions';
const [inFile, outFile] = process.argv.slice(2);
const doc = await new NodeIO().read(inFile);
await doc.transform(dedup(), prune());
await new NodeIO().write(outFile, doc);
console.log('finalized', outFile);
let tris = 0;
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
  const idx = p.getIndices();
  tris += Math.round((idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3);
}
console.log('  tris:', tris, 'extensions:', JSON.stringify(doc.getRoot().listExtensionsUsed().map((e) => e.extensionName)));
