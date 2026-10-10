// Per-primitive material + bbox dump (world space).
import { NodeIO } from '@gltf-transform/core';
const doc = await new NodeIO().read(process.argv[2]);
for (const n of doc.getRoot().listNodes()) {
  const mesh = n.getMesh(); if (!mesh) continue;
  const m = n.getWorldMatrix();
  for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION');
    const a=[1e9,1e9,1e9], b=[-1e9,-1e9,-1e9];
    for (let i = 0; i < pos.getCount(); i++) { const e = pos.getElement(i,[0,0,0]);
      const w=[m[0]*e[0]+m[4]*e[1]+m[8]*e[2]+m[12], m[1]*e[0]+m[5]*e[1]+m[9]*e[2]+m[13], m[2]*e[0]+m[6]*e[1]+m[10]*e[2]+m[14]];
      for (let k=0;k<3;k++){a[k]=Math.min(a[k],w[k]);b[k]=Math.max(b[k],w[k]);} }
    const idx = p.getIndices();
    console.log(n.getName(), '|', p.getMaterial()?.getName(), 'tris', (idx?idx.getCount():pos.getCount())/3, 'min', a.map(v=>v.toFixed(2)).join(','), 'max', b.map(v=>v.toFixed(2)).join(','), 'attrs', p.listSemantics().join('/'));
  }
}
