import { NodeIO } from '@gltf-transform/core';
const io = new NodeIO();
const doc = await io.read(process.argv[2]);
const pat = new RegExp(process.argv[3] || '.', 'i');
for (const n of doc.getRoot().listNodes()) {
  const mesh = n.getMesh();
  if (!mesh || !pat.test(n.getName() + ' ' + mesh.getName())) continue;
  for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION');
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let i = 0; i < pos.getCount(); i++) {
      const e = pos.getElement(i, [0, 0, 0]);
      for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], e[a]); mx[a] = Math.max(mx[a], e[a]); }
    }
    console.log(n.getName().padEnd(24), 'mesh', mesh.getName().padEnd(18), 'mat', p.getMaterial().getName().padEnd(12),
      'size', mx.map((v,a)=>(v-mn[a]).toFixed(2)).join('x'), 'ctr', mx.map((v,a)=>((v+mn[a])/2).toFixed(2)).join(','));
  }
}
