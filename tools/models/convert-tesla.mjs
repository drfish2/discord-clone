// Converts the Webots Tesla Model 3 geometry protos (CC-BY 4.0, Cyberbotics Ltd.,
// pinned commit 67d291f) into a plain host-safe GLB for the game: "Volt 3".
// The restrictive TeslaModel3.proto wrapper is NOT used. The 5 CC-BY geometry
// protos are parsed (VRML IndexedFaceSet: points + coordIndex triangles),
// mapped from Webots axes (+X fwd, +Y left, +Z up) to glTF (+Z fwd, +X right,
// +Y up), grounded (body frame origin sits 0.4 m above the road), and the 4
// wheel proto instances are placed at the Car track/wheelbase (1.72 / 2.94).
// The Tesla "T" badge texel region is blanked. Webots' separate metallic and
// roughness maps are merged into a glTF metallicRoughness texture (B/G).
import { NodeIO, Document } from '@gltf-transform/core';
import { prune, dedup } from '@gltf-transform/functions';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const SRC = 'C:/Users/munee/.zcode/workspace/default/crimson-coast/car-models/webots-tesla-model3/';
// stage 1 output; convert-volt3.mjs rigs it into public/game/assets/models/volt3.glb
const OUT = process.env.OUT || 'build/volt3-raw.glb';

// ---------------------------------------------------------------- VRML parsing
function parseProto(file) {
  const x = fs.readFileSync(SRC + file, 'utf8');
  const sec = (re) => {
    const m = x.match(re);
    return m ? m[1] : '';
  };
  const nums = (s) => s.trim().split(/[\s,]+/).filter((v) => v.length).map(Number);
  const points = nums(sec(/Coordinate\s*\{[^{}]*?point\s*\[([^\]]*)\]/));
  const uvs = nums(sec(/TextureCoordinate\s*\{[^{}]*?point\s*\[([^\]]*)\]/));
  const coordIndex = nums(sec(/coordIndex\s*\[([^\]]*)\]/));
  const texCoordIndex = nums(sec(/texCoordIndex\s*\[([^\]]*)\]/));
  // texture files
  const tex = (slot) => {
    const m = x.match(new RegExp(slot + 'Map\\s+ImageTexture\\s*\\{\\s*url\\s*\\[\\s*"([^"]+)"'));
    return m ? m[1] : null;
  };
  const baseColorMap = tex('baseColor');
  const roughnessMap = tex('roughness');
  const metalnessMap = tex('metalness');
  const normalMap = tex('normal');
  const occlusionMap = tex('occlusion');
  const bm = x.match(/baseColor\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  const baseColor = bm ? [+bm[1], +bm[2], +bm[3], 1] : [1, 1, 1, 1];
  const tr = x.match(/transparency\s+([\d.]+)/);
  const transparency = tr ? +tr[1] : 0;
  return { points, uvs, coordIndex, texCoordIndex, baseColor, transparency, maps: { baseColorMap, roughnessMap, metalnessMap, normalMap, occlusionMap } };
}

// The proto geometry is authored X-backward (front = -X), Y up, Z across.
// Map to glTF (+Z fwd, +X right, +Y up): (x,y,z) -> (z, y, -x); determinant
// is +1 so the VRML CCW winding survives as-is.
const MAP = (p) => [p[2], p[1], -p[0]];
const GROUND = 0; // the data already sits on y=0 (wheel bottoms, body sills)

function buildGeometry(shape, { wheel = false } = {}) {
  // VRML IndexedFaceSet with per-corner texCoordIndex (one UV per corner):
  // vertices are shared only where BOTH position and UV match (keeps UV seams).
  const pos = [], uv = [], idx = [];
  const vmap = new Map();
  const corner = (pi, ui) => {
    const key = pi + '_' + ui;
    let out = vmap.get(key);
    if (out === undefined) {
      const p = [shape.points[pi * 3], shape.points[pi * 3 + 1], shape.points[pi * 3 + 2]];
      const g = MAP(p);
      out = pos.length / 3;
      pos.push(g[0], g[1] + (wheel ? 0 : GROUND), g[2]);
      uv.push(shape.uvs[ui * 2], 1 - shape.uvs[ui * 2 + 1]); // VRML V origin is bottom-left
      vmap.set(key, out);
    }
    return out;
  };
  // fan-triangulate the (-1 separated) index runs (winding kept: map det +1)
  let run = [], runUV = [];
  const flush = () => {
    for (let k = 1; k < run.length - 1; k++) {
      const a = corner(run[0], runUV[0]), b = corner(run[k], runUV[k]), c = corner(run[k + 1], runUV[k + 1]);
      idx.push(a, b, c);
    }
    run = []; runUV = [];
  };
  for (let k = 0; k < shape.coordIndex.length; k++) {
    const i = shape.coordIndex[k];
    if (i === -1) { flush(); continue; }
    run.push(i);
    runUV.push(shape.texCoordIndex.length ? shape.texCoordIndex[k] : k);
  }
  flush();
  const n = pos.length / 3;
  // smooth vertex normals
  const nor = new Array(n * 3).fill(0);
  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]];
    const p0 = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]];
    const p1 = [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]];
    const p2 = [pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]];
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const j of [a, b, c]) {
      nor[j * 3] += fn[0]; nor[j * 3 + 1] += fn[1]; nor[j * 3 + 2] += fn[2];
    }
  }
  for (let i = 0; i < nor.length; i += 3) {
    const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1;
    nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l;
  }
  return { pos, uv, idx, nor, count: n };
}

// ---------------------------------------------------------------- textures
const texCache = new Map();
async function loadTex(rel) {
  if (!rel) return null;
  if (texCache.has(rel)) return texCache.get(rel);
  const path = rel.startsWith('/') || /^[A-Za-z]:/.test(rel) ? rel : SRC + rel;
  const buf = await sharp(path).png().toBuffer(); // force png so the mimeType matches
  texCache.set(rel, buf);
  return buf;
}
const absTex = (rel) => (rel.startsWith('/') || /^[A-Za-z]:/.test(rel) ? rel : SRC + rel);
async function mergeMetalRough(shape) {
  if (!shape.maps.roughnessMap && !shape.maps.metalnessMap) return null;
  const W = 1024, H = 1024;
  const rough = shape.maps.roughnessMap ? await sharp(absTex(shape.maps.roughnessMap)).resize(W, H, { fit: 'fill' }).greyscale().raw().toBuffer() : null;
  const metal = shape.maps.metalnessMap ? await sharp(absTex(shape.maps.metalnessMap)).resize(W, H, { fit: 'fill' }).greyscale().raw().toBuffer() : null;
  const out = Buffer.alloc(W * H * 3, 255);
  for (let i = 0; i < W * H; i++) {
    out[i * 3 + 1] = rough ? rough[i] : 255; // G = roughness
    out[i * 3 + 2] = metal ? metal[i] : 0;   // B = metallic
  }
  return sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}

// ---------------------------------------------------------------- assembly
const doc = new Document();
doc.createBuffer('volt3');
const scene = doc.createScene('Volt3');
const root = doc.createNode('Volt3');
scene.addChild(root);
const io = new NodeIO();

const usedNames = new Set();
function addPart(name, geom, material, parentNode) {
  const prim = doc.createPrimitive();
  const mkAcc = (arr, type, comps) => {
    const a = doc.createAccessor(name + '_' + type).setType(comps).setArray(arr).setBuffer(doc.getRoot().listBuffers()[0]);
    return a;
  };
  prim.setAttribute('POSITION', mkAcc(new Float32Array(geom.pos), 'POSITION', 'VEC3'));
  if (geom.nor) prim.setAttribute('NORMAL', mkAcc(new Float32Array(geom.nor), 'NORMAL', 'VEC3'));
  if (geom.uv.length) prim.setAttribute('TEXCOORD_0', mkAcc(new Float32Array(geom.uv), 'TEXCOORD_0', 'VEC2'));
  prim.setIndices(mkAcc(new Uint32Array(geom.idx), 'IDX', 'SCALAR'));
  prim.setMaterial(material);
  const mesh = doc.createMesh(name + '_mesh').addPrimitive(prim); // addPrimitive returns this? guard:
  const node = doc.createNode(name).setMesh(mesh);
  (parentNode || root).addChild(node);
}

async function makeMaterial(name, shape, { paint = false, alpha = null } = {}) {
  const mat = doc.createMaterial(name);
  const baseTex = await loadTex(shape.maps.baseColorMap);
  if (baseTex) {
    mat.setBaseColorTexture(doc.createTexture(name + '_base').setImage(baseTex).setMimeType('image/png'));
  }
  const mr = await mergeMetalRough(shape);
  if (mr) mat.setMetallicRoughnessTexture(doc.createTexture(name + '_mr').setImage(mr).setMimeType('image/png'));
  if (shape.maps.normalMap) {
    const nm = await loadTex(shape.maps.normalMap);
    mat.setNormalTexture(doc.createTexture(name + '_n').setImage(nm).setMimeType('image/png'));
  }
  if (shape.maps.occlusionMap) {
    const om = await loadTex(shape.maps.occlusionMap);
    mat.setOcclusionTexture(doc.createTexture(name + '_o').setImage(om).setMimeType('image/png'));
  }
  mat.setBaseColorFactor(paint ? [1, 1, 1, 1] : shape.baseColor);
  if (alpha !== null) { mat.setAlphaMode('BLEND'); mat.setAlpha(alpha); }
  return mat;
}

// blank the Tesla "T" badge regions:
//  - details base colour: white T on dark (emblem island)
//  - bodywork base colour: grey T on body white (nose + trunk badges)
const DETAILS_SRC = SRC + 'textures/tesla_model3_details_base_color.jpg';
const BADGE = { left: 980, top: 1270, w: 150, h: 140 };
const BODY_SRC = SRC + 'textures/tesla_model3_bodywork_base_color.png';
// grey T badge on the nose + "TESLA" lettering on the trunk lid
const BODY_BADGES = [
  { left: 90, top: 1710, w: 90, h: 85 },
  { left: 290, top: 1690, w: 110, h: 120 },
  { left: 1375, top: 310, w: 290, h: 100 },
];
const patchedDetails = path.resolve('build/textesla/details_nobrand.png');
const patchedBody = path.resolve('build/textesla/body_nobrand.png');
const shapeMapsPatch = {};
fs.mkdirSync('build/textesla', { recursive: true });
{
  const fill = await sharp(DETAILS_SRC).extract({ left: BADGE.left - 30, top: BADGE.top + BADGE.h + 20, width: 8, height: 8 }).raw().toBuffer();
  await sharp(DETAILS_SRC).composite([{
    input: { create: { width: BADGE.w, height: BADGE.h, channels: 4, background: { r: fill[0], g: fill[1], b: fill[2], alpha: 255 } } },
    left: BADGE.left, top: BADGE.top,
  }]).png().toFile(patchedDetails);
  console.log('details badge blanked with fill', fill[0], fill[1], fill[2]);
  const fill2 = await sharp(BODY_SRC).extract({ left: BODY_BADGES[0].left + BODY_BADGES[0].w + 40, top: BODY_BADGES[0].top, width: 8, height: 8 }).raw().toBuffer();
  await sharp(BODY_SRC).composite(BODY_BADGES.map((b) => ({
    input: { create: { width: b.w, height: b.h, channels: 4, background: { r: fill2[0], g: fill2[1], b: fill2[2], alpha: 255 } } },
    left: b.left, top: b.top,
  }))).png().toFile(patchedBody);
  console.log('bodywork badges blanked with fill', fill2[0], fill2[1], fill2[2]);
  // the T badge also lives in the roughness/metallic/normal/occlusion maps —
  // blank it there too or it renders as a dark chrome logo
  for (const slot of ['roughness', 'metallic', 'normal', 'occlusion']) {
    const src2 = SRC + 'textures/tesla_model3_bodywork_' + slot + '.jpg';
    const out2 = path.resolve('build/textesla/body_' + slot + '_nobrand.png');
    const s2 = await sharp(src2).raw().toBuffer({ resolveWithObject: true });
    const px = (x, y) => {
      const i = (Math.min(y, s2.info.height - 1) * s2.info.width + Math.min(x, s2.info.width - 1)) * s2.info.channels;
      return [s2.data[i], s2.data[i + 1], s2.data[i + 2]];
    };
    const layers = [];
    for (const b of BODY_BADGES) {
      const sx = Math.round(b.left * s2.info.width / 2048), sy = Math.round(b.top * s2.info.height / 2048);
      const sw = Math.max(2, Math.round(b.w * s2.info.width / 2048)), sh = Math.max(2, Math.round(b.h * s2.info.height / 2048));
      const fill = px(sx + sw + 6, sy + Math.round(sh / 2));
      layers.push({
        input: { create: { width: sw, height: sh, channels: 3, background: { r: fill[0], g: fill[1], b: slot === 'normal' ? 255 : fill[2] } } },
        left: sx, top: sy,
      });
    }
    await sharp(src2).composite(layers).png().toFile(out2);
    shapeMapsPatch[slot] = out2;
  }
}

// body parts
const bodySpecs = [
  ['TeslaModel3Coachwork.proto', 'body', { paint: true }],
  ['TeslaModel3Details.proto', 'details', {}],
  ['TeslaModel3Windows.proto', 'glass', { alpha: 0.85 }],
  ['TeslaModel3FrontLights.proto', 'lights', { alpha: 0.5 }],
];
for (const [file, name, opts] of bodySpecs) {
  const shape = parseProto(file);
  if (name === 'details') shape.maps.baseColorMap = patchedDetails;
  if (name === 'body') {
    shape.maps.baseColorMap = patchedBody;
    shape.maps.roughnessMap = shapeMapsPatch.roughness || shape.maps.roughnessMap;
    shape.maps.metalnessMap = shapeMapsPatch.metallic || shape.maps.metalnessMap;
    shape.maps.normalMap = shapeMapsPatch.normal || shape.maps.normalMap;
    shape.maps.occlusionMap = shapeMapsPatch.occlusion || shape.maps.occlusionMap;
  }
  const mat = await makeMaterial(name, shape, opts);
  addPart(name, buildGeometry(shape), mat);
}

// wheels: 4 instances of the Wheel proto at the Car track/wheelbase
const wheelShape = parseProto('TeslaModel3Wheel.proto');
const wheelMat = await makeMaterial('wheel', wheelShape, {});
const wheelGeom = buildGeometry(wheelShape, { wheel: true });
const TRACK = 1.72 / 2, WB = 2.94 / 2, WHEEL_R = 0.37;
for (const [nm, x, z] of [['wheel_front_left', -TRACK, WB], ['wheel_front_right', TRACK, WB], ['wheel_rear_left', -TRACK, -WB], ['wheel_rear_right', TRACK, -WB]]) {
  const g = { ...wheelGeom, pos: wheelGeom.pos.map((v, i) => (i % 3 === 0 ? v + x : i % 3 === 2 ? v + z : v + WHEEL_R)) };
  addPart(nm, g, wheelMat);
}


// dedup/prune disabled while debugging
await io.write(OUT, doc);
console.log('wrote', OUT);
let tris = 0;
for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
  const idx2 = p.getIndices();
  tris += Math.round((idx2 ? idx2.getCount() : p.getAttribute('POSITION').getCount()) / 3);
}
console.log('tris:', tris);
