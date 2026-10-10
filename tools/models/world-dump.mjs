import { NodeIO } from '@gltf-transform/core';
const io = new NodeIO();
const doc = await io.read(process.argv[2]);
const pat = new RegExp(process.argv[3] || '.', 'i');
for (const n of doc.getRoot().listNodes()) {
  const mesh = n.getMesh();
  if (!mesh || !pat.test(n.getName())) continue;
  const m = n.getWorldMatrix();
  for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION');
    const mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
    for (let i = 0; i < pos.getCount(); i++) {
      const e = pos.getElement(i, [0,0,0]);
      const w = [ m[0]*e[0]+m[4]*e[1]+m[8]*e[2]+m[12], m[1]*e[0]+m[5]*e[1]+m[9]*e[2]+m[13], m[2]*e[0]+m[6]*e[1]+m[10]*e[2]+m[14] ];
      for (let a = 0; a < 3; a++) { mn[a]=Math.min(mn[a],w[a]); mx[a]=Math.max(mx[a],w[a]); }
    }
    console.log(n.getName().padEnd(24), 'mat', p.getMaterial().getName().padEnd(12),
      'wsize', mx.map((v,a)=>(v-mn[a]).toFixed(2)).join('x'), 'wctr', mx.map((v,a)=>((v+mn[a])/2).toFixed(2)).join(','));
  }
}
