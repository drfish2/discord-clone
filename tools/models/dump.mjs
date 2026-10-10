import { NodeIO } from '@gltf-transform/core';
const io = new NodeIO();
const doc = await io.read(process.argv[2]);
const { Mesh, Material, Texture, Node: N } = await import('@gltf-transform/core');
console.log('NODES:', doc.getRoot().listNodes().map(n=>n.getName()).join(', '));
console.log('\nMESHES:', doc.getRoot().listMeshes().map(m=>m.getName()).join(', '));
console.log('\nMATERIALS:');
for (const m of doc.getRoot().listMaterials()) {
  console.log(' -', m.getName(), '| baseColor:', m.getBaseColorFactor().map(x=>+x.toFixed(2)).join(','), '| metal:', m.getMetallicFactor(), '| rough:', m.getRoughnessFactor(), '| alpha:', m.getAlphaMode(), m.getAlpha(), '| ext:', Object.keys(m.extensionData||{}).join('+')||'-');
}
console.log('\nTEXTURES:');
for (const t of doc.getRoot().listTextures()) {
  console.log(' -', t.getName(), t.getMimeType(), t.getSize()?.join('x'), 'uri:', (t.getURI()||'embedded').slice(0,60));
}
console.log('\nANIMS:', doc.getRoot().listAnimations().length, 'SCENES:', doc.getRoot().listScenes().length);
