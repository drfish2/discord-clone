// Ground dressing: the textured (splat-blended) terrain material, the shoreline fade on the sea,
// and the near-camera streamer for grass blades and small plants (ferns, flowers, weeds, reeds,
// dune grass, pebbles, driftwood). Trees, bushes, hedges and fences live in flora.js.
// Textures: Poly Haven (CC0). Small plant models: Poly Haven (CC0), decimated with tools/ground/decimate.py.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { G, clamp, sstep, WATER } from './core.js';
import {
  H, TN, TS, HALF, BIOMES, biomeAt, urbanAt, terrainHeight, nearestRoad, buildingsNear, inAirfield, onAirportSlab, styleOf,
} from './terrain.js';
import { noise2, mulberry32 } from './noise.js';
import { inlineData } from './assets.js'; // CSP-safe embedded buffers/images (artifact host)

// low | med (default) | high
export function quality() {
  if (G.lowQ) return 'low';
  return typeof location !== 'undefined' && /[?&]q=high/.test(location.search) ? 'high' : 'med';
}

const TEX = 'assets/textures/ground/';
const MOD = 'assets/models/';
export const GTEX = {}; // loaded textures by name
export const PLANTS = {}; // model name -> [{ geometry, material, h }] variants (base at y=0)

// ---------------------------------------------------------------- loading
const TEX_FILES = [
  't_grass', 't_meadow', 't_forest', 't_dirt', 't_sand', 't_wetsand', 't_rock', 't_mud', 't_snow',
  'bark_oak', 'bark_pine', 'wood_white', 'wood_weathered', 'wall_brick', 'wall_stone',
];
const PLANT_FILES = ['ph_fern_02', 'ph_shrub_sorrel_01', 'ph_shrub_03', 'ph_weed_plant_02', 'ph_rock_07', 'ph_dry_branches_medium_01'];

function loadTex(loader, url, aniso) {
  return new Promise((res) => {
    loader.load(url, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = aniso;
      res(t);
    }, undefined, () => { console.warn('ground texture missing:', url); res(null); });
  });
}

// Bake every mesh node of a plant GLB into its own geometry (a "variant"): node rotation/scale
// applied, centred on x/z, base on y = 0. Materials become alpha-tested Lambert (cheaper, and lit
// like the terrain).
function plantVariants(gltf) {
  const out = [];
  const mats = new Map();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    const m = o.matrixWorld.clone();
    m.setPosition(0, 0, 0);
    g.applyMatrix4(m);
    for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
    g.computeBoundingBox();
    const b = g.boundingBox;
    g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
    g.computeBoundingBox();
    const src = o.material;
    let mat = mats.get(src);
    if (!mat) {
      mat = new THREE.MeshLambertMaterial({
        map: src.map || null, color: src.map ? 0xffffff : src.color,
        alphaTest: src.alphaTest || (src.transparent ? 0.5 : 0), side: src.alphaTest || src.transparent ? THREE.DoubleSide : THREE.FrontSide,
      });
      if (mat.map) mat.map.anisotropy = 4;
      mats.set(src, mat);
    }
    out.push({ geometry: g, material: mat, h: g.boundingBox.max.y, w: Math.max(g.boundingBox.max.x - g.boundingBox.min.x, g.boundingBox.max.z - g.boundingBox.min.z) });
  });
  return out;
}

export async function loadGroundAssets() {
  const aniso = Math.min(8, (G.renderer && G.renderer.capabilities.getMaxAnisotropy()) || 4);
  const tl = new THREE.TextureLoader();
  const jobs = TEX_FILES.map((n) => loadTex(tl, TEX + n + '.jpg', aniso).then((t) => { if (t) GTEX[n] = t; }));
  jobs.push(loadTex(tl, TEX + 'foliage_atlas.webp', aniso).then((t) => { if (t) GTEX.foliage = t; }));
  const ext = (typeof window !== 'undefined' && window.CC_MODEL_EXT) || '.glb';
  const gl = new GLTFLoader();
  gl.register(inlineData);
  for (const f of PLANT_FILES) {
    jobs.push(gl.loadAsync(MOD + f + ext).then((g) => { PLANTS[f.replace(/^ph_/, '')] = plantVariants(g); })
      .catch(() => console.warn('plant model missing:', f)));
  }
  await Promise.all(jobs);
}

// ---------------------------------------------------------------- terrain splat weights
// Eight layers in two vec4 vertex attributes:
//   splatA = grass, forest floor, dry dirt, sand      splatB = mud, meadow/verge, rock, snow
// Rock on steep pixels and wet sand at the waterline are added per pixel in the shader.
const W8 = new Float32Array(8);
function biomeOneHot(b, w, k) {
  if (b === BIOMES.FOREST) w[1] += k;
  else if (b === BIOMES.DESERT) w[2] += k;
  else if (b === BIOMES.BEACH) w[3] += k;
  else if (b === BIOMES.WETLAND) { w[4] += k * 0.55; w[5] += k * 0.45; }
  else if (b === BIOMES.URBAN) { w[5] += k * 0.7; w[2] += k * 0.3; }
  else if (b === BIOMES.ALPINE) { w[5] += k * 0.6; w[2] += k * 0.4; }
  else w[0] += k;
}
// urban ground mixes over the 8 layers: grass, forest, dirt, sand, mud, meadow, rock, snow
const URBAN_GROUND = {
  mixed: [0, 0, 0.25, 0, 0, 0.75, 0, 0],
  paved: [0, 0, 0.05, 0, 0.1, 0.15, 0.7, 0],
  lawn: [0.6, 0, 0.05, 0, 0, 0.35, 0, 0],
  sand: [0, 0, 0.2, 0.45, 0, 0.35, 0, 0],
  dirt: [0, 0, 0.85, 0.1, 0, 0.05, 0, 0],
  forest: [0.2, 0.45, 0.1, 0, 0, 0.25, 0, 0],
};
export function splatWeights(x, z, h, slope, outA, outB, o) {
  W8.fill(0);
  // the biome grid is 30 m nearest-neighbour: average a few taps so borders blend
  biomeOneHot(biomeAt(x, z), W8, 0.4);
  biomeOneHot(biomeAt(x + 13, z + 7), W8, 0.15);
  biomeOneHot(biomeAt(x - 13, z - 7), W8, 0.15);
  biomeOneHot(biomeAt(x + 7, z - 13), W8, 0.15);
  biomeOneHot(biomeAt(x - 7, z + 13), W8, 0.15);
  // fields vs rough meadow, patchy
  const m = clamp(noise2(x * 0.0035, z * 0.0035) * 0.9 + 0.1, 0, 0.8);
  W8[5] += W8[0] * m; W8[0] *= 1 - m;
  const u = urbanAt(x, z);
  if (u > 0.05) {
    // what lies between the buildings depends on the district (districts.js `ground`):
    // paved/gravel yards in the dense and industrial quarters, lawns in the suburbs,
    // sand in the beach towns, bare dirt in the desert
    const k = sstep(0.05, 0.5, u) * 0.85;
    for (let i = 0; i < 8; i++) W8[i] *= 1 - k;
    const gw = URBAN_GROUND[styleOf(x, z).ground || 'mixed'];
    for (let i = 0; i < 8; i++) W8[i] += k * gw[i];
  }
  // coast: sand within ~3 m of sea level (wet sand is done per pixel), dunes behind beaches
  const n = noise2(x * 0.02, z * 0.02);
  const sand = 1 - sstep(1.4, 3.4, h + n * 0.9);
  if (sand > 0) { for (let i = 0; i < 8; i++) W8[i] *= 1 - sand; W8[3] += sand; }
  if (W8[3] > 0.3 && h > 2.5) { const d = sstep(2.5, 6, h) * 0.45; W8[5] += W8[3] * d; W8[3] *= 1 - d; }
  const rock = clamp(slope * 1.4 - 0.5 + (h - 220) / 260, 0, 1);
  for (let i = 0; i < 8; i++) W8[i] *= 1 - rock;
  W8[6] += rock;
  const snow = sstep(430, 520, h + n * 120) * (1 - clamp(slope - 0.9, 0, 1));
  for (let i = 0; i < 8; i++) W8[i] *= 1 - snow;
  W8[7] += snow;
  let s = 0;
  for (let i = 0; i < 8; i++) s += W8[i];
  s = s || 1;
  outA[o] = W8[0] / s; outA[o + 1] = W8[1] / s; outA[o + 2] = W8[2] / s; outA[o + 3] = W8[3] / s;
  outB[o] = W8[4] / s; outB[o + 1] = W8[5] / s; outB[o + 2] = W8[6] / s; outB[o + 3] = W8[7] / s;
}

// ---------------------------------------------------------------- terrain material
// Per layer: mean colour of the photo (linear) and the colour it should read as in game (sRGB).
// The shader keeps the photo's detail but re-centres it on the target colour, partially keeping
// the photo's own colour variation (chroma). Means measured with tools/ground (64x64 average).
const LAYERS = [
  ['t_grass', [0.079, 0.048, 0.008], [0.35, 0.43, 0.19], 0.3],
  ['t_forest', [0.279, 0.166, 0.047], [0.30, 0.34, 0.19], 0.55],
  ['t_dirt', [0.302, 0.174, 0.078], [0.74, 0.58, 0.41], 0.7],
  ['t_sand', [0.378, 0.304, 0.16], [0.86, 0.79, 0.63], 0.6],
  ['t_mud', [0.037, 0.019, 0.007], [0.33, 0.31, 0.21], 0.4],
  ['t_meadow', [0.311, 0.229, 0.101], [0.41, 0.44, 0.23], 0.45],
  ['t_rock', [0.121, 0.061, 0.031], [0.50, 0.47, 0.43], 0.3],
  ['t_snow', [0.378, 0.378, 0.389], [0.94, 0.95, 0.98], 0.5],
];
const WET = ['t_wetsand', [0.152, 0.117, 0.075], [0.52, 0.47, 0.38], 0.7];
const toLin = (c) => c.map((v) => Math.pow(v, 2.2));

export function terrainTextured() {
  return LAYERS.every((l) => GTEX[l[0]]) && GTEX.t_wetsand;
}

export function terrainMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
  if (!terrainTextured()) { mat.vertexColors = true; return mat; }
  const low = quality() === 'low';
  mat.onBeforeCompile = (sh) => {
    const L = [...LAYERS, WET];
    L.forEach(([n, avg, tgt, ch], i) => {
      sh.uniforms['tL' + i] = { value: GTEX[n] };
      sh.uniforms['aL' + i] = { value: new THREE.Vector4(...avg, ch) };
      sh.uniforms['cL' + i] = { value: new THREE.Vector3(...toLin(tgt)) };
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splatA; attribute vec4 splatB; attribute vec3 tint; varying vec4 vSA; varying vec4 vSB; varying vec3 vWP; varying vec3 vWN; varying vec3 vTint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSA = splatA; vSB = splatB; vWP = (modelMatrix * vec4(position, 1.0)).xyz; vWN = normal; vTint = tint;');
    let uni = '';
    for (let i = 0; i < L.length; i++) uni += `uniform sampler2D tL${i}; uniform vec4 aL${i}; uniform vec3 cL${i};\n`;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vSA; varying vec4 vSB; varying vec3 vWP; varying vec3 vWN; varying vec3 vTint;
        ${uni}
        float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float gNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(gHash(i), gHash(i + vec2(1, 0)), f.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), f.x), f.y); }
        // two scales (and a rotation) per layer hide the tiling; far away only the large scale is used
        vec3 gLayer(sampler2D t, vec4 avg, vec3 tgt, vec2 uv1, vec2 uv2, float nearK) {
          vec3 b = texture2D(t, uv2).rgb;
          ${low ? 'vec3 c = b;' : 'vec3 a = texture2D(t, uv1).rgb; vec3 c = mix(b, mix(a, b, 0.4), nearK);'}
          vec3 rel = c / avg.rgb;
          float l = dot(rel, vec3(0.3333));
          return tgt * mix(vec3(l), rel, avg.a);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 wp = vWP;
          float dist = length(cameraPosition - wp);
          float nearK = 1.0 - smoothstep(30.0, 220.0, dist);
          vec2 uv1 = wp.xz * 0.21;
          vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * wp.xz * 0.047;
          float n1 = gNoise(wp.xz * 0.013), n2 = gNoise(wp.xz * 0.11);
          vec4 A = vSA, B = vSB;
          // rock on steep pixels (cuttings, cliffs), not just steep vertices
          float slopeRock = smoothstep(0.5, 0.75, 1.0 - normalize(vWN).y) * 0.9;
          float rk = max(B.z, slopeRock);
          A *= (1.0 - rk) / max(1e-3, 1.0 - B.z); B.xyw *= (1.0 - rk) / max(1e-3, 1.0 - B.z); B.z = rk;
          // wet sand at the waterline, a little noisy so the line isn't ruler straight
          float y = wp.y - ${WATER.toFixed(1)} + (n2 - 0.5) * 0.35;
          float wet = 1.0 - smoothstep(0.05, 1.1, y);
          vec3 col = vec3(0.0);
          if (A.x > 0.004) col += A.x * gLayer(tL0, aL0, cL0, uv1, uv2, nearK);
          if (A.y > 0.004) col += A.y * gLayer(tL1, aL1, cL1, uv1, uv2, nearK);
          if (A.z > 0.004) col += A.z * gLayer(tL2, aL2, cL2, uv1, uv2, nearK);
          if (A.w > 0.004) col += A.w * gLayer(tL3, aL3, cL3, uv1 * 0.8, uv2, nearK);
          if (B.x > 0.004) col += B.x * gLayer(tL4, aL4, cL4, uv1, uv2, nearK);
          if (B.y > 0.004) col += B.y * gLayer(tL5, aL5, cL5, uv1, uv2, nearK);
          if (B.z > 0.004) col += B.z * gLayer(tL6, aL6, cL6, uv1 * 0.5, uv2 * 0.5, nearK);
          if (B.w > 0.004) col += B.w * gLayer(tL7, aL7, cL7, uv1, uv2, nearK);
          if (wet > 0.004) {
            vec3 ws = gLayer(tL8, aL8, cL8, uv1, uv2, nearK);
            // underwater: darker and bluer with depth (seen through the sea)
            ws *= mix(vec3(1.0), vec3(0.45, 0.6, 0.65), smoothstep(0.0, -3.0, y));
            col = mix(col, ws, wet * (0.55 + 0.45 * (A.w + B.y * 0.3)));
          }
          // large-scale brightness / hue patches
          col *= 0.86 + 0.22 * n1 + 0.08 * (n2 - 0.5);
          col = mix(col, col * vec3(1.08, 1.0, 0.82), smoothstep(0.55, 0.9, gNoise(wp.xz * 0.004 + 7.0)) * (A.x + B.y) * 0.6);
          diffuseColor.rgb = col * vTint;
        }`);
  };
  mat.customProgramCacheKey = () => 'cc-terrain-splat2' + (low ? '-low' : '');
  return mat;
}

// ---------------------------------------------------------------- sea: shoreline fade + foam
// Samples the terrain height near sea level from a small byte texture, fades the water out over
// the last few decimetres and draws a soft animated foam band. Chains the existing onBeforeCompile.
export function patchWaterShore(waterMat) {
  if (!H.length) return;
  const N = TN + 1;
  const data = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) data[i] = clamp(Math.round(((H[i] - WATER) + 6) / 12 * 255), 0, 255);
  const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const prev = waterMat.onBeforeCompile;
  waterMat.onBeforeCompile = (sh, r) => {
    prev(sh, r);
    sh.uniforms.tShoreH = { value: tex };
    sh.uniforms.uShore = { value: new THREE.Vector3(HALF, TS, N) };
    sh.fragmentShader = sh.fragmentShader
      .replace('uniform float uTime;', 'uniform float uTime; uniform sampler2D tShoreH; uniform vec3 uShore;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 suv = ((vW.xz + uShore.x) / uShore.y + 0.5) / uShore.z;
          float th = texture2D(tShoreH, vec2(suv.x, suv.y)).r * 12.0 - 6.0;
          float depth = -th; // metres of water above the sea floor here
          float foamBand = 1.0 - smoothstep(0.0, 0.9, depth);
          float wave = 0.5 + 0.5 * sin(uTime * 1.3 - depth * 7.0 + sin(vW.x * 0.05) * 2.0 + sin(vW.z * 0.043) * 2.0);
          float foam = foamBand * (0.35 + 0.65 * wave) * step(0.0, depth + 0.05);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 0.96), foam * 0.75);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.5, 0.55), (1.0 - smoothstep(0.3, 4.0, depth)) * 0.35 * (1.0 - foam));
          diffuseColor.a *= smoothstep(-0.05, 0.35, depth) * (1.0 - foamBand * 0.25) + foam * 0.2;
        }`);
  };
  waterMat.customProgramCacheKey = () => 'cc-water-shore';
  waterMat.needsUpdate = true;
}

// ---------------------------------------------------------------- shared shader bits
// Alpha-tested foliage lit like the ground: no normal flip on back faces (both sides of a card or a
// blade get the same light) and an optional wind sway that grows with height above the base.
export function foliagePatch(mat, { wind = 0, cacheKey = 'f', fade = null } = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = G.uniforms.uTime;
    if (fade) sh.uniforms.uFadeCam = fade;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec4 uFadeCam;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec3 iw = instanceMatrix[3].xyz;
          #else
            vec3 iw = vec3(0.0);
          #endif
          ${fade ? `float fd = distance(uFadeCam.xz, iw.xz); transformed *= 1.0 - smoothstep(uFadeCam.w * 0.72, uFadeCam.w, fd);` : ''}
          ${wind ? `float hh = max(position.y, 0.0);
          float ph = iw.x * 0.13 + iw.z * 0.17;
          float w = sin(uTime * 1.6 + ph) * 0.6 + sin(uTime * 2.7 + ph * 2.3) * 0.25 + 0.35;
          vec3 wv = vec3(w, 0.0, w * 0.45) * ${wind.toFixed(3)} * hh * hh;
          #ifdef USE_INSTANCING
            mat3 im = mat3(instanceMatrix);
            wv = transpose(im) * wv / max(1e-4, dot(im[0], im[0]));
          #endif
          transformed += wv;` : ''}
        }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>',
      'float faceDirection = gl_FrontFacing ? 1.0 : -1.0;\nvec3 normal = normalize( vNormal );\nvec3 nonPerturbedNormal = normal;');
  };
  mat.customProgramCacheKey = () => 'cc-fol-' + cacheKey + wind + (fade ? 'f' : '');
  return mat;
}
// camera xz + streaming radius for the distance fades of grass (G) and small plants (P)
const FADE_G = { value: new THREE.Vector4() }, FADE_P = { value: new THREE.Vector4() };

// ---------------------------------------------------------------- near-camera streamer
// The ground near the camera is split into chunks. Each chunk deterministically scatters its
// instances (same chunk -> same plants every time) and caches the matrices; whenever the set of
// chunks changes, the cached arrays are concatenated into one InstancedMesh per kind, so the
// whole streamer costs ~15 draw calls.
const CFG = {
  low: { grassR: 0, grassD: 0, plantR: 50, plantK: 0.35 },
  med: { grassR: 46, grassD: 1.5, plantR: 95, plantK: 1 },
  high: { grassR: 66, grassD: 2.4, plantR: 130, plantK: 1.3 },
};
const GC = 12; // grass chunk size (m)
const PC = 32; // plant chunk size (m)
let cfg = null, grassMesh = null, scene = null;
const grassChunks = new Map();
const plantChunks = new Map();
const kinds = []; // plant kinds: { name, variants: [{mesh, cap}], ... }
let dirtyG = false, dirtyP = false;

// is (x,z) open ground (not road/pavement, building, airfield or water)? r = clearance (m)
function openGround(x, z, r) {
  const nr = nearestRoad(x, z);
  if (nr && nr.d < r + (nr.s.sidewalk ? 3.3 : 0.4)) return false;
  const l = buildingsNear(x, z);
  if (l) for (const o of l) {
    if (o.t !== 0) { if (Math.hypot(x - o.x, z - o.z) < o.r + r) return false; continue; }
    if (x < o.x0 - r || x > o.x1 + r || z < o.z0 - r || z > o.z1 + r) continue;
    const dx = x - o.cx, dz = z - o.cz;
    if (Math.abs(dx * o.c - dz * o.s) < o.hx + r && Math.abs(dx * o.s + dz * o.c) < o.hz + r) return false;
  }
  return true;
}
function slopeAt(x, z) {
  const a = terrainHeight(x - 1.5, z), b = terrainHeight(x + 1.5, z), c = terrainHeight(x, z - 1.5), d = terrainHeight(x, z + 1.5);
  return Math.hypot(b - a, d - c) / 3;
}

// ---- grass
function bladeClumpGeo(low) {
  const pos = [], col = [], nor = [], idx = [];
  const R = mulberry32(99);
  const blades = low ? 5 : 9;
  for (let b = 0; b < blades; b++) {
    const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 0.3;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const h = 0.22 + R() * 0.26, w = 0.03 + R() * 0.018;
    const yaw = R() * Math.PI * 2, lean = (R() - 0.3) * 0.35;
    const cx = Math.cos(yaw), cz = Math.sin(yaw);
    const segs = 3, o = pos.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const ww = w * (1 - t * 0.85);
      const off = lean * t * t * h; // curve forward
      const y = h * t;
      const px = bx + cz * off, pz = bz - cx * off;
      pos.push(px - cx * ww, y, pz - cz * ww, px + cx * ww, y, pz + cz * ww);
      const c = 0.5 + t * 0.75;
      col.push(c, c, c, c, c, c);
      nor.push(0, 1, 0, 0, 1, 0);
      if (s > 0) { const k = o + (s - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}
// grass colour by biome (linear-ish RGB multipliers on the blade gradient)
function grassTint(b, x, z, out) {
  const n = noise2(x * 0.03, z * 0.03) * 0.5 + 0.5;
  // linear RGB, close to the terrain's grass layer so blades blend into the ground
  let r = 0.1, g = 0.18, bl = 0.032;
  if (b === BIOMES.FOREST) { r = 0.075; g = 0.13; bl = 0.03; }
  else if (b === BIOMES.WETLAND) { r = 0.12; g = 0.16; bl = 0.04; }
  else if (b === BIOMES.ALPINE) { r = 0.11; g = 0.15; bl = 0.045; }
  else if (b === BIOMES.URBAN) { r = 0.1; g = 0.17; bl = 0.035; }
  // dry, yellowed patches
  const dry = sstep(0.55, 0.95, n) * 0.6;
  r += dry * 0.08; g += dry * 0.03; bl += dry * 0.005;
  out[0] = r; out[1] = g; out[2] = bl;
}
const TINT = [0, 0, 0];
function genGrassChunk(ci, cj) {
  const R = mulberry32((ci * 73856093) ^ (cj * 19349663) ^ 0x5bd1e995);
  const n = Math.round(GC * GC * cfg.grassD);
  const m = new Float32Array(n * 16), c = new Float32Array(n * 3);
  let k = 0;
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  // the chunk centre decides if this chunk can have grass at all (cheap reject)
  const x0 = ci * GC, z0 = cj * GC;
  for (let i = 0; i < n; i++) {
    const x = x0 + R() * GC, z = z0 + R() * GC;
    const r1 = R(), r2 = R(), r3 = R();
    const h = terrainHeight(x, z);
    if (h < 2.7) continue; // beaches, shore and water: no grass
    const b = biomeAt(x, z);
    if (b === BIOMES.DESERT || b === BIOMES.BEACH) continue;
    let keep = 1;
    if (b === BIOMES.FOREST) keep = 0.4;
    else if (b === BIOMES.ALPINE) keep = h > 330 ? 0 : 0.5;
    else if (b === BIOMES.URBAN) keep = 0.75;
    const u = urbanAt(x, z);
    keep *= 1 - sstep(0.45, 0.9, u) * 0.85;
    // paved yards, sandy beach towns and the desert town grow little grass between the buildings
    if (u > 0.1) { const gk = styleOf(x, z).ground; if (gk === 'paved' || gk === 'dirt' || gk === 'sand') keep *= 1 - sstep(0.1, 0.4, u) * 0.85; }
    // patchy fields: thinner in some places
    keep *= 0.55 + 0.45 * sstep(-0.4, 0.3, noise2(x * 0.05, z * 0.05));
    if (r1 > keep) continue;
    if (slopeAt(x, z) > 0.7) continue;
    if (!openGround(x, z, 0.25)) continue;
    if (inAirfield(x, z, -150) || onAirportSlab(x, z)) continue;
    const s = 0.7 + r2 * 0.6;
    M.compose(P.set(x, h - 0.03, z), Q.setFromAxisAngle(UP, r3 * 6.283), S.set(s, s * (0.75 + r1 * 0.6), s));
    M.toArray(m, k * 16);
    grassTint(b, x, z, TINT);
    const v = 0.85 + r2 * 0.3;
    c[k * 3] = TINT[0] * v; c[k * 3 + 1] = TINT[1] * v; c[k * 3 + 2] = TINT[2] * v;
    k++;
  }
  return { m, c, n: k };
}

// ---- small plants
// density per m2 (before quality scaling) by context; each kind returns a density for a spot
function plantKinds() {
  const K = [];
  const add = (name, variants, opts) => { if (variants && variants.length) K.push({ name, variants, ...opts }); };
  const P = PLANTS;
  // ferns: forest floor
  add('fern', P.fern_02, { size: [0.45, 0.85], wind: 0.08, dens: (c) => (c.b === BIOMES.FOREST ? 0.03 : c.b === BIOMES.WETLAND ? 0.006 : 0) });
  // flowers (wood sorrel clumps): meadows and gardens
  add('flower', P.shrub_sorrel_01, { size: [0.18, 0.4], wind: 0.1, dens: (c) => (c.b === BIOMES.GRASS ? 0.012 * c.mead : c.b === BIOMES.URBAN ? 0.004 : c.b === BIOMES.FOREST ? 0.004 : 0) });
  // weeds along verges and in rough grass
  add('weed', P.weed_plant_02, { size: [0.25, 0.6], wind: 0.1, dens: (c) => (c.b === BIOMES.DESERT || c.b === BIOMES.BEACH ? 0 : c.verge * 0.05 + (c.b === BIOMES.GRASS ? 0.003 : 0)) });
  // small shrubs
  add('shrub', P.shrub_03, { size: [0.35, 0.75], wind: 0.07, dens: (c) => (c.b === BIOMES.GRASS || c.b === BIOMES.WETLAND ? 0.004 : c.b === BIOMES.FOREST ? 0.006 : 0) });
  // pebbles and rocks: beaches, desert, high ground, a few in forests
  add('rock', P.rock_07, { size: [0.15, 0.9], wind: 0, shadow: true, dens: (c) => (c.sand ? 0.0025 : c.b === BIOMES.DESERT ? 0.005 : c.b === BIOMES.ALPINE ? 0.01 : c.b === BIOMES.FOREST ? 0.002 : 0.0006) });
  // driftwood near the waterline
  add('driftwood', P.dry_branches_medium_01, { size: [0.3, 0.6], wind: 0, flat: true, dens: (c) => (c.h > 0.35 && c.h < 1.8 && c.sand ? 0.004 : c.b === BIOMES.FOREST ? 0.002 : 0) });
  // card plants (foliage atlas): reeds and dune grass
  if (GTEX.foliage) {
    K.push({ name: 'reed', card: [0, 0, 0.5, 0.5], size: [1.2, 2.0], wind: 0.12, cards: 3, dens: (c) => (c.b === BIOMES.WETLAND ? 0.05 : c.h > 0.2 && c.h < 1.4 && !c.sand ? 0.03 : 0) });
    K.push({ name: 'dune', card: [0.5, 0, 1, 0.5], size: [0.7, 1.2], wind: 0.18, cards: 3, dens: (c) => (c.sand && c.h > 2.1 && c.h < 7 ? 0.022 : c.b === BIOMES.BEACH && c.h >= 7 ? 0.015 : c.b === BIOMES.DESERT ? 0.004 : c.b === BIOMES.GRASS ? 0.004 : 0) });
  }
  return K;
}
function cardTuftGeo(uv, cards) {
  const pos = [], uvs = [], nor = [], idx = [];
  for (let k = 0; k < cards; k++) {
    const a = (k / cards) * Math.PI;
    const cx = Math.cos(a) * 0.5, cz = Math.sin(a) * 0.5;
    const o = pos.length / 3;
    pos.push(-cx, 0, -cz, cx, 0, cz, -cx, 1, -cz, cx, 1, cz);
    uvs.push(uv[0], uv[1], uv[2], uv[1], uv[0], uv[3], uv[2], uv[3]);
    for (let i = 0; i < 4; i++) nor.push(0, 1, 0);
    idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}
const CTX = { b: 0, h: 0, sand: false, verge: 0, mead: 0 };
function genPlantChunk(ci, cj) {
  const R = mulberry32((ci * 83492791) ^ (cj * 2971215073) ^ 0x2545f491);
  const out = kinds.map((k) => k.variants.map(() => []));
  const x0 = ci * PC, z0 = cj * PC;
  // candidate spots on a jittered 2 m grid; each spot rolls every kind
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Euler();
  for (let gx = 0; gx < PC; gx += 2)
    for (let gz = 0; gz < PC; gz += 2) {
      const x = x0 + gx + R() * 2, z = z0 + gz + R() * 2;
      const roll = R(), r2 = R(), r3 = R(), r4 = R();
      const h = terrainHeight(x, z);
      if (h < 0.2) continue;
      CTX.b = biomeAt(x, z);
      CTX.h = h;
      CTX.sand = h < 3.2 || CTX.b === BIOMES.BEACH;
      CTX.mead = 0.4 + 0.6 * sstep(-0.2, 0.5, noise2(x * 0.01, z * 0.01));
      // pick a kind by cumulative density (area 4 m2 per spot)
      let acc = 0, pick = -1;
      const nr = nearestRoad(x, z);
      CTX.verge = nr && nr.d > 0 && nr.d < 6 && !nr.s.sidewalk ? 1 : 0;
      for (let k = 0; k < kinds.length; k++) {
        acc += kinds[k].dens(CTX) * 4 * cfg.plantK;
        if (roll < acc) { pick = k; break; }
      }
      if (pick < 0) continue;
      const K = kinds[pick];
      if (inAirfield(x, z, -150) || onAirportSlab(x, z)) continue;
      if (!openGround(x, z, K.name === 'rock' ? 1.2 : 0.5)) continue;
      if (slopeAt(x, z) > (K.name === 'rock' ? 1.2 : 0.65)) continue;
      const vi = Math.floor(r2 * K.variants.length);
      const V = K.variants[vi];
      const s = K.size[0] + (K.size[1] - K.size[0]) * r3 * r3; // metres tall (unit-height geometry)
      E.set(0, r4 * 6.283, 0);
      Q.setFromEuler(E);
      M.compose(P.set(x, h - (K.name === 'rock' ? 0.2 * s : 0.03), z), Q, S.set(s, s * (0.85 + r2 * 0.3), s));
      out[pick][vi].push(M.clone());
    }
  return out.map((vs) => vs.map((list) => { const a = new Float32Array(list.length * 16); list.forEach((m, i) => m.toArray(a, i * 16)); return a; }));
}

export function initGroundDetail(sc) {
  scene = sc;
  cfg = CFG[quality()];
  if (cfg.grassR > 0) {
    const mat = foliagePatch(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { wind: 0.22, cacheKey: 'grass', fade: FADE_G });
    const cap = Math.ceil(Math.PI * (cfg.grassR + GC) ** 2 * cfg.grassD * 0.8);
    grassMesh = new THREE.InstancedMesh(bladeClumpGeo(false), mat, cap);
    grassMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    grassMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    grassMesh.count = 0;
    grassMesh.frustumCulled = false;
    grassMesh.receiveShadow = true;
    grassMesh.userData.cap = cap;
    scene.add(grassMesh);
  }
  // small plants: normalise each model variant to unit height so sizes are in metres
  for (const K of plantKinds()) {
    const k = { ...K, variants: [] };
    if (K.card) {
      const mat = foliagePatch(new THREE.MeshLambertMaterial({ map: GTEX.foliage, alphaTest: 0.42, side: THREE.DoubleSide, color: K.name === 'dune' ? 0xb4b890 : 0xa8b890 }), { wind: K.wind, cacheKey: K.name, fade: FADE_P });
      k.variants.push({ geometry: cardTuftGeo(K.card, K.cards), material: mat, h: 1 });
    } else {
      for (const V of K.variants) {
        const g = V.geometry.clone();
        const sc = 1 / V.h; // unit height, then K.size scales to metres
        g.scale(sc, sc, sc);
        const mat = V.material.clone();
        foliagePatch(mat, { wind: K.wind, cacheKey: K.name, fade: FADE_P });
        k.variants.push({ geometry: g, material: mat, h: 1 });
      }
    }
    for (const V of k.variants) {
      const cap = 3000;
      const m = new THREE.InstancedMesh(V.geometry, V.material, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = !!K.shadow;
      m.receiveShadow = true;
      V.mesh = m;
      V.cap = cap;
      scene.add(m);
    }
    kinds.push(k);
  }
}

let accT = 0;
export function updateGroundDetail(dt, cam) {
  if (!cfg) return;
  FADE_G.value.set(cam.x, 0, cam.z, cfg.grassR);
  FADE_P.value.set(cam.x, 0, cam.z, cfg.plantR);
  accT -= dt;
  if (accT > 0) return;
  accT = 0.15;
  const t0 = performance.now();
  // grass chunks
  if (grassMesh) {
    const R = cfg.grassR, ci0 = Math.floor((cam.x - R) / GC), ci1 = Math.floor((cam.x + R) / GC);
    const cj0 = Math.floor((cam.z - R) / GC), cj1 = Math.floor((cam.z + R) / GC);
    const want = new Set();
    const todo = [];
    for (let i = ci0; i <= ci1; i++)
      for (let j = cj0; j <= cj1; j++) {
        const cx = (i + 0.5) * GC, cz = (j + 0.5) * GC;
        if (Math.hypot(cx - cam.x, cz - cam.z) > R + GC * 0.71) continue;
        const key = i + ':' + j;
        want.add(key);
        if (!grassChunks.has(key)) todo.push([i, j, Math.hypot(cx - cam.x, cz - cam.z)]);
      }
    for (const k of grassChunks.keys()) if (!want.has(k)) { grassChunks.delete(k); dirtyG = true; }
    todo.sort((a, b) => a[2] - b[2]);
    for (const [i, j] of todo) {
      if (performance.now() - t0 > 6) break;
      grassChunks.set(i + ':' + j, genGrassChunk(i, j));
      dirtyG = true;
    }
  }
  // plant chunks
  if (kinds.length) {
    const R = cfg.plantR, ci0 = Math.floor((cam.x - R) / PC), ci1 = Math.floor((cam.x + R) / PC);
    const cj0 = Math.floor((cam.z - R) / PC), cj1 = Math.floor((cam.z + R) / PC);
    const want = new Set();
    const todo = [];
    for (let i = ci0; i <= ci1; i++)
      for (let j = cj0; j <= cj1; j++) {
        const cx = (i + 0.5) * PC, cz = (j + 0.5) * PC;
        if (Math.hypot(cx - cam.x, cz - cam.z) > R + PC * 0.71) continue;
        const key = i + ':' + j;
        want.add(key);
        if (!plantChunks.has(key)) todo.push([i, j, Math.hypot(cx - cam.x, cz - cam.z)]);
      }
    for (const k of plantChunks.keys()) if (!want.has(k)) { plantChunks.delete(k); dirtyP = true; }
    todo.sort((a, b) => a[2] - b[2]);
    for (const [i, j] of todo) {
      if (performance.now() - t0 > 10) break;
      plantChunks.set(i + ':' + j, genPlantChunk(i, j));
      dirtyP = true;
    }
  }
  if (dirtyG) {
    dirtyG = false;
    const cap = grassMesh.userData.cap;
    const ma = grassMesh.instanceMatrix.array, ca = grassMesh.instanceColor.array;
    let n = 0;
    for (const ch of grassChunks.values()) {
      const k = Math.min(ch.n, cap - n);
      if (k <= 0) break;
      ma.set(ch.m.subarray(0, k * 16), n * 16);
      ca.set(ch.c.subarray(0, k * 3), n * 3);
      n += k;
    }
    grassMesh.count = n;
    grassMesh.instanceMatrix.needsUpdate = true;
    grassMesh.instanceColor.needsUpdate = true;
  }
  if (dirtyP) {
    dirtyP = false;
    kinds.forEach((K, ki) => K.variants.forEach((V, vi) => {
      const a = V.mesh.instanceMatrix.array;
      let n = 0;
      for (const ch of plantChunks.values()) {
        const src = ch[ki][vi];
        const k = Math.min(src.length / 16, V.cap - n);
        if (k <= 0) continue;
        a.set(src.subarray(0, k * 16), n * 16);
        n += k;
      }
      V.mesh.count = n;
      V.mesh.instanceMatrix.needsUpdate = true;
    }));
  }
}
export function groundDetailStats() {
  return { grass: grassMesh ? grassMesh.count : 0, plants: kinds.map((k) => k.name + ':' + k.variants.reduce((s, v) => s + v.mesh.count, 0)).join(' ') };
}
void TS;
