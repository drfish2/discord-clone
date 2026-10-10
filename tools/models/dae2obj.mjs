// Minimal Collada (.dae) -> Wavefront (.obj/.mtl) converter for the gazebo
// vehicle meshes: handles <triangles>/<polylist> with position/normal/uv
// inputs, per-primitive materials, and node-level <matrix>/<translate>/
// <rotate>/<scale> transforms from the visual scene. Usage:
//   node dae2obj.mjs <in.dae> <outBase>   (writes <outBase>.obj + .mtl)
import fs from 'fs';
import path from 'path';

const [daePath, outBase] = process.argv.slice(2);
const xml = fs.readFileSync(daePath, 'utf8');

const all = (re) => [...xml.matchAll(re)];
const nums = (s) => (s ? s.trim().split(/\s+/).map(Number) : []);

const arrays = {};
for (const m of all(/<float_array id="([^"]+)"[^>]*>([^<]*)<\/float_array>/g)) arrays[m[1]] = nums(m[2]);

// visual_scene slice (skip library_* transforms)
const vsIdx = xml.indexOf('<visual_scene');
const vsEnd = xml.indexOf('</visual_scene');

// identity or composed node transform(s) within the visual scene
function composeNodeTransforms() {
  let m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; // column-major like collada <matrix>
  const mul = (a, b) => {
    const r = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) for (let k = 0; k < 4; k++) r[c * 4 + rr] += a[k * 4 + rr] * b[c * 4 + k];
    return r;
  };
  const vs = xml.slice(vsIdx, vsEnd);
  for (const t of vs.matchAll(/<(matrix|translate|rotate|scale)[^>]*>([^<]*)<\/\1>/g)) {
    const v = nums(t[2]);
    if (t[1] === 'matrix') m = mul(m, v);
    else if (t[1] === 'translate') m = mul(m, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v[0], v[1], v[2], 1]);
    else if (t[1] === 'scale') m = mul(m, [v[0], 0, 0, 0, 0, v[1], 0, 0, 0, 0, v[2], 0, 0, 0, 0, 1]);
    else if (t[1] === 'rotate') {
      const [x, y, z, ang] = v, a = (ang * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), ic = 1 - c;
      m = mul(m, [
        c + x * x * ic, x * y * ic - z * s, x * z * ic + y * s, 0,
        y * x * ic + z * s, c + y * y * ic, y * z * ic - x * s, 0,
        z * x * ic - y * s, z * y * ic + x * s, c + z * z * ic, 0,
        0, 0, 0, 1,
      ]);
    }
  }
  return m;
}
const M = composeNodeTransforms();

// material name -> texture basename:
// effect <surface><init_from>IMAGE_ID</init_from> -> <image id> -> <init_from>file
const effectTex = {};
for (const m of all(/<effect id="([^"]+)"[\s\S]*?<surface[^>]*>[\s\S]*?<init_from>([^<]*)<\/init_from>/g)) effectTex['#' + m[1]] = m[2].trim();
const imgFile = {};
for (const m of all(/<image id="([^"]+)"[^>]*>[\s\S]*?<init_from>([^<]*)<\/init_from>/g)) imgFile['#' + m[1]] = m[2].trim();
for (const [eff, imgId] of Object.entries(effectTex)) {
  if (imgFile[imgId.startsWith('#') ? imgId : '#' + imgId]) effectTex[eff] = path.basename(imgFile['#' + imgId]);
  else if (/\.\w+$/.test(imgId)) effectTex[eff] = path.basename(imgId);
}
// symbol (from <triangles material=...>) -> effect name is usually identical
// (material id "<symbol>-material" wraps effect "#<symbol>")
const matTex = { ...effectTex };
for (const m of all(/<material[^>]*id="([^"]+)"[^>]*>[\s\S]*?<instance_effect url="([^"]+)"/g)) {
  const sym = m[1].replace(/-material$/, '');
  const eff = m[2].startsWith('#') ? m[2] : '#' + m[2];
  if (effectTex[eff]) matTex[sym] = effectTex[eff];
}

const outV = [], outVt = [], outVn = [], outFaces = [];
const mtlLines = ['# converted from ' + path.basename(daePath)];
const mtlDone = new Set();

const geoms = all(/<geometry id="([^"]+)"[^>]*>([\s\S]*?)<\/geometry>/g);
for (const g of geoms) {
  const body = g[2];
  const posSrc = body.match(/<source id="([^"]*)"[^>]*>[\s\S]*?<accessor[^>]*stride="3"[^>]*>[\s\S]*?<param name="X"[\s\S]*?<\/source>/);
  // find the position source robustly: the source referenced by a VERTEX input
  const vertsInput = body.match(/<input semantic="VERTEX" source="([^"]+)"/);
  const vertSrcId = vertsInput ? vertsInput[1].slice(1) : null;
  // VERTEX input points to <vertices> which points at the position source
  const verticesBlock = body.match(new RegExp(`<vertices id="${vertSrcId}"[\\s\\S]*?<input semantic="POSITION" source="([^"]+)"`));
  const posArrId = (verticesBlock ? verticesBlock[1].slice(1) : vertSrcId) + '-array';
  const P = arrays[posArrId];
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = P[i + 1], z = P[i + 2];
    outV.push(
      (M[0] * x + M[4] * y + M[8] * z + M[12]).toFixed(6),
      (M[1] * x + M[5] * y + M[9] * z + M[13]).toFixed(6),
      (M[2] * x + M[6] * y + M[10] * z + M[14]).toFixed(6)
    );
  }
  const vCount = P.length / 3;

  const nrmSrc = body.match(/<source id="([^"]*normals[^"]*)"/);
  const N = nrmSrc ? arrays[nrmSrc[1] + '-array'] : null;
  const uvSrc = body.match(/<source id="([^"]*(?:map|uv|tex)[^"]*)"/);
  const UVraw = uvSrc ? arrays[uvSrc[1] + '-array'] : null;
  const uvStride = uvSrc ? +((body.match(new RegExp(`<source id="${uvSrc[1]}"[\\s\\S]*?<accessor[^>]*stride="(\\d+)"`)) || [])[1] || 2) : 2;
  const UV = UVraw ? (() => { const o = []; for (let i = 0; i < UVraw.length; i += uvStride) o.push(UVraw[i], UVraw[i + 1]); return o; })() : null;
  const uvCount = UV ? UV.length / 2 : 0;
  const nCount = N ? N.length / 3 : 0;
  for (let i = 0; i < uvCount; i++) outVt.push(`${UV[i * 2].toFixed(6)} ${UV[i * 2 + 1].toFixed(6)}`);
  for (let i = 0; i < nCount; i++) outVn.push(`${N[i * 3]} ${N[i * 3 + 1]} ${N[i * 3 + 2]}`);

  const prims = [...body.matchAll(/<(triangles|polylist) material="([^"]*)" count="(\d+)"[^>]*>([\s\S]*?)<\/\1>/g)];
  for (const pr of prims) {
    const matName = pr[2].split('-material')[0] || pr[2];
    const pb = pr[4];
    const inputs = [...pb.matchAll(/<input semantic="([^"]+)" source="([^"]+)"([^>]*)>/g)].map((i2) => {
      const off = i2[3].match(/offset="(\d+)"/);
      return { semantic: i2[1], source: i2[2], offset: off ? +off[1] : 0 };
    });
    const stride = Math.max(...inputs.map((i2) => i2.offset)) + 1;
    const p = nums((pb.match(/<p>([^<]*)<\/p>/) || [])[1]);
    const vcount = pr[1] === 'polylist' ? nums((pb.match(/<vcount>([^<]*)<\/vcount>/) || [])[1]) : null;
    const byOff = {};
    for (const i2 of inputs) byOff[i2.offset] = i2;
    const texIn = Object.values(byOff).find((x) => x.semantic === 'TEXCOORD');
    const nrmIn = Object.values(byOff).find((x) => x.semantic === 'NORMAL');

    outFaces.push(`usemtl ${matName}`, `g ${matName}`);
    const tris = [];
    if (vcount) { let o = 0; for (const vc of vcount) { for (let k = 1; k < vc - 1; k++) tris.push([o, o + k, o + k + 1]); o += vc; } }
    else for (let i = 0; i < p.length / stride; i += 3) tris.push([i, i + 1, i + 2]);
    for (const [a, b, c] of tris) {
      const f = [a, b, c].map((i0) => {
        const base = i0 * stride;
        const vi = p[base] + 1;
        const ti = texIn ? p[base + texIn.offset] + 1 : '';
        const ni = nrmIn ? p[base + nrmIn.offset] + 1 : '';
        return `${vi}/${ti}/${ni}`;
      }).join(' ');
      outFaces.push('f ' + f);
    }
    if (!mtlDone.has(matName)) {
      mtlDone.add(matName);
      const tex = matTex[matName];
      mtlLines.push(`newmtl ${matName}`, 'Kd 0.8 0.8 0.8', 'illum 2', tex ? `map_Kd ${tex}` : '');
    }
  }
}

// assemble: v block, vt block, vn block, then faces (indices are global in OBJ)
const lines = [`# converted from ${path.basename(daePath)}`];
for (let i = 0; i < outV.length; i += 3) lines.push(`v ${outV[i]} ${outV[i + 1]} ${outV[i + 2]}`);
for (const t of outVt) lines.push('vt ' + t);
for (const n of outVn) lines.push('vn ' + n);
lines.push('mtllib ' + path.basename(outBase) + '.mtl', ...outFaces);
fs.writeFileSync(outBase + '.obj', lines.join('\n') + '\n');
fs.writeFileSync(outBase + '.mtl', mtlLines.join('\n') + '\n');
console.log('wrote', outBase + '.obj', outV.length / 3, 'v,', outVt.length, 'vt,', outVn.length, 'vn,', outFaces.filter((l) => l.startsWith('f ')).length, 'faces');
