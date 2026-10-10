// Inspect converted car GLBs: extensions, scale/orientation, node tree,
// wheel candidates, triangle count, materials, textures, brand-name scan.
// Usage: node inspect.mjs <file.glb> [--tree]
import { NodeIO } from '@gltf-transform/core';
import fs from 'fs';
const file = process.argv[2];
const tree = process.argv.includes('--tree');
const raw = fs.readFileSync(file);
const jsonLen = raw.readUInt32LE(12);
const json = JSON.parse(raw.slice(20, 20 + jsonLen).toString());
const doc = await new NodeIO().read(file);
const root = doc.getRoot();
let tris = 0, prims = 0;
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
  const idx = p.getIndices(); prims++;
  tris += Math.round((idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3);
}
const mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
const nodeBox = (n) => {
  const mesh = n.getMesh(); if (!mesh) return null;
  const m = n.getWorldMatrix();
  const a = [1e9,1e9,1e9], b = [-1e9,-1e9,-1e9];
  for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION');
    for (let i = 0; i < pos.getCount(); i++) {
      const e = pos.getElement(i, [0,0,0]);
      const w = [m[0]*e[0]+m[4]*e[1]+m[8]*e[2]+m[12], m[1]*e[0]+m[5]*e[1]+m[9]*e[2]+m[13], m[2]*e[0]+m[6]*e[1]+m[10]*e[2]+m[14]];
      for (let k = 0; k < 3; k++) { a[k] = Math.min(a[k], w[k]); b[k] = Math.max(b[k], w[k]); }
    }
  }
  return [a, b];
};
const boxes = new Map();
for (const n of root.listNodes()) { const bb = nodeBox(n); if (bb) { boxes.set(n, bb); for (let k=0;k<3;k++){mn[k]=Math.min(mn[k],bb[0][k]);mx[k]=Math.max(mx[k],bb[1][k]);} } }
const f = (v) => v.map(x => x.toFixed(2)).join(',');
console.log('==', file.split(/[\/]/).pop(), (raw.length/1024).toFixed(0)+'KB');
console.log(' extUsed:', JSON.stringify(json.extensionsUsed || []), 'extReq:', JSON.stringify(json.extensionsRequired || []));
console.log(' tris:', tris, 'prims:', prims, 'nodes:', root.listNodes().length, 'meshes:', root.listMeshes().length, 'mats:', root.listMaterials().length);
console.log(' bbox min', f(mn), 'max', f(mx), 'size', f(mx.map((v,k)=>v-mn[k])));
console.log(' textures:', root.listTextures().map(t => `${t.getName()||'?'}:${t.getMimeType()}:${t.getSize()?.join('x')}:${(t.getImage().length/1024).toFixed(0)}K`).join(' '));
console.log(' materials:', root.listMaterials().map(m => m.getName()).join(', '));
const wheels = root.listNodes().filter(n => /wheel|tire|tyre|rim/i.test(n.getName()));
console.log(' wheel-named nodes:', wheels.map(n => { const b = boxes.get(n); return n.getName() + (b ? ` ctr(${f(b[0].map((v,k)=>(v+b[1][k])/2))}) sz(${f(b[1].map((v,k)=>v-b[0][k]))})` : ' (no mesh)'); }).join('\n   '));
const brand = /porsche|carrera|tesla|mercedes|benz|sprinter|toyota|prius|ford|chevrolet|dodge|khronos|sketchfab/i;
const hits = [];
for (const n of root.listNodes()) if (brand.test(n.getName())) hits.push('node:'+n.getName());
for (const n of root.listMeshes()) if (brand.test(n.getName())) hits.push('mesh:'+n.getName());
for (const n of root.listMaterials()) if (brand.test(n.getName())) hits.push('mat:'+n.getName());
for (const n of root.listTextures()) if (brand.test(n.getName()+' '+n.getURI())) hits.push('tex:'+n.getName());
if (json.asset && brand.test(JSON.stringify(json.asset))) hits.push('asset:'+JSON.stringify(json.asset));
console.log(' brand-name hits:', hits.length ? hits.join(', ') : 'none');
if (tree) {
  const walk = (n, d) => { const b = boxes.get(n); console.log('  '.repeat(d+1) + n.getName() + (n.getMesh() ? ` [mesh ${n.getMesh().getName()}]` : '') + (b ? ` ctr(${f(b[0].map((v,k)=>(v+b[1][k])/2))}) sz(${f(b[1].map((v,k)=>v-b[0][k]))})` : '')); n.listChildren().forEach(c => walk(c, d+1)); };
  for (const s of root.listScenes()) s.listChildren().forEach(c => walk(c, 0));
}
