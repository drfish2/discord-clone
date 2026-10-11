// Graphics: quality presets, sky + sun/moon + environment lighting, height fog, street-lamp light,
// material tuning for reflections, and the post-processing chain (bloom, AO, grade, tone mapping).
//
// Presets (?q=low|medium|high|ultra, or the pause menu, stored in localStorage):
//   low     no post FX, no shadows, no environment map, 0.75 pixel ratio
//   medium  2k sun shadow, sky environment map (reflections), bloom + grade, MSAA x4
//   high    4k sun shadow over a wider area, 6 real street-lamp lights near the camera, 1.5 px ratio
//   ultra   high + ground-truth AO (half res), 12 lamp lights, wider shadow, up to 2x pixel ratio
//
// Every custom shader in the game patches standard chunks through onBeforeCompile. Nothing here
// replaces a material's onBeforeCompile; the fog upgrade is a global ShaderChunk change, and
// material tuning only touches plain properties (roughness, envMapIntensity, ...).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { G, clamp, lerp, sstep } from './core.js';
import { lamps } from './terrain.js';

// ---------------------------------------------------------------- presets
export const PRESET_NAMES = ['low', 'medium', 'high', 'ultra'];
const DPR = typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1;
export const PRESETS = {
  low: { pr: 0.75, shadow: 0, shadowR: 0, env: false, post: false, msaa: 0, ao: false, lampLights: 0, ground: 'low' },
  medium: { pr: Math.min(DPR, 1), shadow: 2048, shadowR: 110, env: true, post: true, msaa: 4, ao: false, lampLights: 0, ground: 'med' },
  high: { pr: Math.min(DPR, 1.5), shadow: 4096, shadowR: 150, env: true, post: true, msaa: 4, ao: false, lampLights: 6, ground: 'high' },
  ultra: { pr: Math.min(DPR, 2), shadow: 4096, shadowR: 190, env: true, post: true, msaa: 4, ao: true, lampLights: 12, ground: 'high' },
};
const DEFAULT_PRESET = 'high';
const LS_KEY = 'cc-gfx-preset';
function stored() {
  try { return localStorage.getItem(LS_KEY); } catch (e) { return null; }
}
function store(name) {
  try { localStorage.setItem(LS_KEY, name); } catch (e) { /* storage blocked */ }
}
// URL wins (?q=), then the saved choice, then the default. 'med' is accepted for medium.
export function presetFromEnv() {
  const m = typeof location !== 'undefined' && /[?&]q=(low|med|medium|high|ultra)\b/.exec(location.search);
  if (m) return { name: m[1] === 'med' ? 'medium' : m[1], explicit: true };
  const s = stored();
  if (s && PRESETS[s]) return { name: s, explicit: true };
  return { name: DEFAULT_PRESET, explicit: false };
}
export const P = () => PRESETS[G.gfxPreset] || PRESETS[DEFAULT_PRESET];

// ---------------------------------------------------------------- global fog upgrade
// Exponential height fog (dense near sea level, thinning with altitude) measured from fogNear, with
// warm in-scattering towards the sun on lit materials. scene.fog stays a THREE.Fog:
//   fogNear = distance where haze starts, fogFar = 1/density at sea level (metres).
const FOG_FALLOFF = (1 / 260).toFixed(6);
THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogRay;
#endif`;
THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogRay = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
#endif`;
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogRay;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    vec3 fogCol = fogColor;
  #else
    float fogDist = length( vFogRay );
    vec3 fogDir = vFogRay / max( fogDist, 1e-3 );
    float fogD = max( fogDist - fogNear, 0.0 );
    float fogK = fogDir.y * ${FOG_FALLOFF} * fogD;
    float fogLine = abs( fogK ) > 1e-4 ? ( 1.0 - exp( - fogK ) ) / fogK : 1.0;
    float fogAmt = fogD / fogFar * exp( - ${FOG_FALLOFF} * max( cameraPosition.y + fogDir.y * fogNear, -20.0 ) ) * fogLine;
    float fogFactor = 1.0 - exp( - fogAmt );
    vec3 fogCol = fogColor;
    #if ( defined( LAMBERT ) || defined( STANDARD ) || defined( PHONG ) ) && NUM_DIR_LIGHTS > 0
      {
        vec3 fs = normalize( ( vec4( directionalLights[ 0 ].direction, 0.0 ) * viewMatrix ).xyz );
        vec3 fc = directionalLights[ 0 ].color;
        float fm = max( fc.r, max( fc.g, fc.b ) );
        float mu = max( dot( fogDir, fs ), 0.0 );
        fogCol += fc / max( fm, 1e-3 ) * min( fm, 1.0 ) * ( pow( mu, 6.0 ) * 0.45 + pow( mu, 40.0 ) * 0.5 ) * fogColor * 2.2;
      }
    #endif
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor );
#endif`;

// ---------------------------------------------------------------- day palette
// Keyed by the sun's elevation (sine). Colours are sRGB hex, blended in linear space.
//   zen/hor: sky zenith and horizon, glow: sun halo, sun: light colour, sunI: intensity,
//   sky/gnd: hemisphere colours, hemiI, fogFar (1/density), exp: exposure
const KEYS = [
  { e: -0.4, zen: 0x040a1c, hor: 0x142038, glow: 0x05070c, sun: 0x8ea8ff, sunI: 0.32, sky: 0x4a5c8e, gnd: 0x161618, hemiI: 0.75, fogFar: 2600, exp: 1.1 },
  { e: -0.14, zen: 0x07112a, hor: 0x24305a, glow: 0x3a2a4a, sun: 0x8ea8ff, sunI: 0.3, sky: 0x5262a0, gnd: 0x1a1a20, hemiI: 0.72, fogFar: 2400, exp: 1.1 },
  { e: -0.04, zen: 0x182a5c, hor: 0x8a6a8a, glow: 0xd8603a, sun: 0xff8040, sunI: 0.25, sky: 0x6a70a8, gnd: 0x2a2420, hemiI: 0.6, fogFar: 2000, exp: 1.12 },
  { e: 0.03, zen: 0x2a4c8e, hor: 0xf2a066, glow: 0xff7a2e, sun: 0xff9a4a, sunI: 1.6, sky: 0x8a90b8, gnd: 0x4a3a2a, hemiI: 0.62, fogFar: 1900, exp: 1.05 },
  { e: 0.12, zen: 0x3266b2, hor: 0xf4c890, glow: 0xffb469, sun: 0xffc27e, sunI: 2.8, sky: 0xaabbd8, gnd: 0x5a4a38, hemiI: 0.6, fogFar: 2300, exp: 1.0 },
  { e: 0.32, zen: 0x2e6ccc, hor: 0xbcd6ec, glow: 0xffeccc, sun: 0xfff0dc, sunI: 3.3, sky: 0xc6dcf6, gnd: 0x5e5446, hemiI: 0.58, fogFar: 3200, exp: 1.0 },
  { e: 0.95, zen: 0x2862c6, hor: 0xc2dcf0, glow: 0xfff6e6, sun: 0xfff6ec, sunI: 3.5, sky: 0xcce0f8, gnd: 0x605648, hemiI: 0.6, fogFar: 3600, exp: 1.0 },
];
const COLS = ['zen', 'hor', 'glow', 'sun', 'sky', 'gnd'];
const NUMS = ['sunI', 'hemiI', 'fogFar', 'exp'];
const KC = KEYS.map((k) => { const o = { e: k.e }; for (const c of COLS) o[c] = new THREE.Color(k[c]); for (const n of NUMS) o[n] = k[n]; return o; });
const PAL = {}; for (const c of COLS) PAL[c] = new THREE.Color(); for (const n of NUMS) PAL[n] = 0;
function palette(e) {
  let i = 0;
  while (i < KC.length - 2 && e > KC[i + 1].e) i++;
  const a = KC[i], b = KC[i + 1];
  const t = clamp((e - a.e) / (b.e - a.e), 0, 1);
  const s = t * t * (3 - 2 * t);
  for (const c of COLS) PAL[c].copy(a[c]).lerp(b[c], s);
  for (const n of NUMS) PAL[n] = lerp(a[n], b[n], s);
  return PAL;
}

// ---------------------------------------------------------------- sky
const SKY_U = {
  uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
  uGround: { value: new THREE.Color() }, uNight: G.uniforms.uNight, uSunVis: { value: 1 }, uCity: { value: new THREE.Color(0x2a1c16) },
};
function skyMaterial(env) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: !env, fog: false,
    uniforms: { ...SKY_U, uEnv: { value: env ? 1 : 0 } },
    vertexShader: `varying vec3 vD;
      void main(){ vD = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform vec3 uZen, uHor, uGlow, uGround, uCity; uniform vec3 uSunDir, uMoonDir; uniform float uNight, uSunVis, uEnv; varying vec3 vD;
      float h3(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); } // no sin(): no precision blocks
      void main(){
        vec3 d = normalize(vD);
        float y = d.y, hy = max(y, 0.0);
        vec3 c = mix(uHor, uZen, pow(hy, 0.45));
        c = mix(c, uHor * 1.12, exp(-hy * 14.0) * 0.6);            // bright haze band on the horizon
        float mu = dot(d, uSunDir);
        float g = 0.8, mie = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * mu, 1.5);
        float low = exp(-hy * 3.0);
        c += uGlow * (mie * 0.012 * (0.4 + 0.6 * low) + pow(max(mu, 0.0), 3.0) * low * 0.55) * uSunVis;
        // sun disk (HDR, so it blooms), softer and dimmer in the environment map
        float disk = uEnv > 0.5 ? smoothstep(0.995, 0.9995, mu) * 6.0 : smoothstep(0.99965, 0.99985, mu) * 40.0;
        c += uGlow * disk * uSunVis * smoothstep(-0.02, 0.02, y);
        // warm city glow low on the horizon at night
        c += uCity * exp(-hy * 9.0) * uNight * (1.0 - 0.75 * uEnv);
        // moon and stars
        float mm = dot(d, uMoonDir);
        c += vec3(0.75, 0.8, 0.95) * (smoothstep(0.99955, 0.9997, mm) * 3.0 + pow(max(mm, 0.0), 60.0) * 0.06) * uNight;
        if (uEnv < 0.5) {
          vec3 q = floor(d * 320.0);
          float st = step(0.9978, h3(q)) * (0.5 + 0.5 * h3(q + 3.1));
          c += vec3(st) * 0.7 * uNight * smoothstep(0.03, 0.2, y); // kept under the bloom threshold
        }
        // below the horizon: ground (the environment map's lower half), sea elsewhere
        c = mix(c, uGround, smoothstep(0.0, -0.08, y) * (uEnv > 0.5 ? 1.0 : 0.85));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

let sun, hemi, skyMesh, clouds, cloudMat, envScene, pmrem, envRT = null, lampPools, lampPoolMat;
const lampLights = [];
const lastEnv = { dir: new THREE.Vector3(), night: -1, t: 0 };
const SUN_DIR = new THREE.Vector3(), LIGHT_DIR = new THREE.Vector3(), MOON_DIR = new THREE.Vector3();
const V = new THREE.Vector3(), V2 = new THREE.Vector3(), M = new THREE.Matrix4(), MI = new THREE.Matrix4();
const C = new THREE.Color();
const ORIGIN = new THREE.Vector3();

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildAtmosphere(scene) {
  hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a5040, 0.9);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun, sun.target);
  scene.fog = new THREE.Fog(0xbfdcf2, 40, 3000);
  G.sun = sun;
  G.hemi = hemi;

  skyMesh = new THREE.Mesh(new THREE.SphereGeometry(6000, 48, 24), skyMaterial(false));
  skyMesh.renderOrder = -1;
  skyMesh.frustumCulled = false;
  G.skyMesh = skyMesh;
  scene.add(skyMesh);
  envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMaterial(true)));

  // soft cumulus sprites, tinted by the sun and sky every frame
  const cloudTex = canvasTex(256, 128, (g, w, h) => {
    for (let i = 0; i < 30; i++) {
      const x = w * 0.15 + Math.random() * w * 0.7, y = h * 0.42 + (Math.random() - 0.5) * h * 0.3;
      const r = 16 + Math.random() * 30;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.85)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }
  });
  cloudMat = new THREE.SpriteMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, opacity: 0.9 });
  clouds = new THREE.Group();
  for (let i = 0; i < 110; i++) {
    const s = new THREE.Sprite(cloudMat);
    s.position.set((Math.random() - 0.5) * 12000, 1150 + Math.random() * 450, (Math.random() - 0.5) * 12000);
    const sc = 350 + Math.random() * 600;
    s.scale.set(sc, sc * 0.42, 1);
    clouds.add(s);
  }
  scene.add(clouds);
  G.cloudMat = cloudMat;

  buildLampLight(scene);
}

// ---------------------------------------------------------------- street lamps
// Every lamp gets a soft additive light pool on the road (one instanced draw per tile); on high and
// ultra the nearest few lamps also get real point lights so cars and people standing under them are lit.
const lampHead = (l, out) => out.set(l.x + Math.sin(l.dir) * 1.8, l.y + 6.6, l.z + Math.cos(l.dir) * 1.8);
function buildLampLight(scene) {
  if (!lamps.length) return;
  const tex = canvasTex(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
  lampPoolMat = new THREE.MeshBasicMaterial({
    map: tex, color: 0x000000, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: true,
  });
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  lampPools = new THREE.InstancedMesh(geo, lampPoolMat, lamps.length);
  const q = new THREE.Quaternion(), s = new THREE.Vector3(15, 1, 15);
  lamps.forEach((l, i) => {
    M.compose(V.set(l.x + Math.sin(l.dir) * 2.6, l.y + 0.06, l.z + Math.cos(l.dir) * 2.6), q, s);
    lampPools.setMatrixAt(i, M);
  });
  lampPools.renderOrder = 2;
  lampPools.frustumCulled = true;
  lampPools.computeBoundingSphere();
  lampPools.visible = false;
  scene.add(lampPools);
  for (let i = 0; i < 12; i++) {
    const L = new THREE.PointLight(0xffc27a, 0, 30, 2);
    L.visible = false;
    lampLights.push(L);
    scene.add(L);
  }
}
let lampT = 0;
const near = [];
function updateLampLights(dt, night) {
  if (!lampPools) return;
  const n = P().lampLights;
  lampPools.visible = night > 0.02;
  // fewer real lights -> brighter pools; pools fade where real lights take over
  lampPoolMat.color.setRGB(1.0, 0.72, 0.42).multiplyScalar(night * (n ? 0.3 : 0.36));
  lampT -= dt;
  if (lampT > 0) return;
  lampT = 0.35;
  const cam = G.camera.position;
  near.length = 0;
  if (n && night > 0.02) {
    for (let i = 0; i < lamps.length; i++) {
      const l = lamps[i];
      const d = (l.x - cam.x) ** 2 + (l.z - cam.z) ** 2;
      if (d > 140 * 140) continue;
      near.push([d, l]);
    }
    near.sort((a, b) => a[0] - b[0]);
  }
  for (let i = 0; i < lampLights.length; i++) {
    const L = lampLights[i];
    const on = i < n; // keep the light count fixed per preset (no shader recompiles at dusk)
    L.visible = on;
    if (!on) continue;
    if (near[i]) { lampHead(near[i][1], L.position); L.intensity = 28 * night; } else L.intensity = 0;
  }
}

// ---------------------------------------------------------------- per-frame lighting
const tmpTop = new THREE.Color();
export function updateAtmosphere(dt, focus) {
  const t = G.dayTime;
  const ang = ((t - 6) / 24) * Math.PI * 2; // 6am sunrise, 18 sunset
  const sy = Math.sin(ang), sx = Math.cos(ang);
  SUN_DIR.set(sx * 0.8, sy, 0.45).normalize();
  MOON_DIR.set(-sx * 0.6, -sy, 0.4).normalize();
  G.sunDir = (G.sunDir || new THREE.Vector3()).copy(SUN_DIR);
  const e = SUN_DIR.y;
  const day = sstep(-0.12, 0.25, e);
  G.night = 1 - day;
  G.uniforms.uNight.value = G.night;
  const pal = palette(e);
  const env = P().env;

  SKY_U.uZen.value.copy(pal.zen);
  SKY_U.uHor.value.copy(pal.hor);
  SKY_U.uGlow.value.copy(pal.glow);
  SKY_U.uSunDir.value.copy(SUN_DIR);
  SKY_U.uMoonDir.value.copy(MOON_DIR);
  SKY_U.uSunVis.value = sstep(-0.2, 0.0, e);
  // what the ground bounces back up (environment map lower half)
  SKY_U.uGround.value.copy(pal.gnd).multiplyScalar(0.25 + Math.max(e, 0) * pal.sunI * 0.25 + pal.hemiI * 0.2);
  skyMesh.position.copy(G.camera.position);

  // sun by day, moon by night: one shadowed directional light
  const isSun = e > -0.06;
  LIGHT_DIR.copy(isSun ? SUN_DIR : MOON_DIR);
  if (isSun && LIGHT_DIR.y < 0.06) LIGHT_DIR.y = 0.06; // keep shadows finite at sunrise/sunset
  LIGHT_DIR.normalize();
  sun.intensity = isSun ? pal.sunI * sstep(-0.06, 0.03, e) + 0.02 : pal.sunI * sstep(0.0, 0.25, MOON_DIR.y);
  sun.color.copy(pal.sun);
  hemi.color.copy(pal.sky);
  hemi.groundColor.copy(pal.gnd);
  hemi.intensity = pal.hemiI * (env ? 0.85 : 1.0);
  placeShadow(focus);

  // fog matches the horizon, a touch towards the zenith colour
  const fog = G.scene.fog;
  fog.color.copy(pal.hor).lerp(tmpTop.copy(pal.zen), 0.12);
  fog.far = pal.fogFar;
  fog.near = 30;
  G.renderer.setClearColor(fog.color);
  G.renderer.toneMappingExposure = pal.exp * (P().post ? 1.0 : 1.05);

  // clouds: lit by the sun colour by day, dim blue-grey at night
  C.copy(pal.sun).multiplyScalar(0.55 * Math.min(pal.sunI, 2.5) / 2.5).add(tmpTop.copy(pal.sky).multiplyScalar(0.6 * pal.hemiI));
  cloudMat.color.copy(C);
  cloudMat.opacity = 0.35 + day * 0.55;
  clouds.position.x = (G.time * 3) % 1000;

  G.lampOn = 1 - sstep(-0.07, 0.05, e); // street lamps switch on around sunset
  updateLampLights(dt, G.lampOn);
  updateEnv(dt);
  updatePost(dt);
}

// Shadow box: follows the camera, pushed ahead along the view direction, snapped to whole shadow
// texels in light space so edges don't crawl as the camera moves.
const camFwd = new THREE.Vector3();
function placeShadow(focus) {
  const p = P();
  const R = p.shadowR || 110;
  G.camera.getWorldDirection(camFwd);
  camFwd.y = 0;
  if (camFwd.lengthSq() < 1e-4) camFwd.set(0, 0, 1);
  camFwd.normalize();
  const c = V.copy(G.camera.position).addScaledVector(camFwd, R * 0.4);
  c.y = focus.y;
  M.identity().lookAt(ORIGIN, V2.copy(LIGHT_DIR).negate(), THREE.Object3D.DEFAULT_UP); // rotation only
  MI.copy(M).transpose();
  c.applyMatrix4(MI);
  const texel = (2 * R) / (p.shadow || 2048);
  c.x = Math.round(c.x / texel) * texel;
  c.y = Math.round(c.y / texel) * texel;
  c.applyMatrix4(M);
  sun.target.position.copy(c);
  sun.position.copy(c).addScaledVector(LIGHT_DIR, 700);
}

// Environment map from the sky shader, regenerated when the sun has moved ~1 degree.
function updateEnv(dt) {
  const scene = G.scene;
  if (!P().env) {
    if (scene.environment) scene.environment = null;
    return;
  }
  lastEnv.t -= dt;
  const moved = lastEnv.dir.angleTo(SUN_DIR) > 0.018 || Math.abs(lastEnv.night - G.night) > 0.03;
  if (envRT && (!moved || lastEnv.t > 0)) {
    if (scene.environment !== envRT.texture) scene.environment = envRT.texture;
    return;
  }
  if (!pmrem) pmrem = new THREE.PMREMGenerator(G.renderer);
  const old = envRT;
  envRT = pmrem.fromScene(envScene, 0, 0.1, 100);
  scene.environment = envRT.texture;
  if (old) old.dispose();
  lastEnv.dir.copy(SUN_DIR);
  lastEnv.night = G.night;
  lastEnv.t = 0.8;
}

// ---------------------------------------------------------------- materials
// Called on new objects every so often (vehicles and people spawn all the time). Only plain
// properties change, so custom onBeforeCompile hooks stay untouched.
const tuned = new WeakSet();
export const roadMats = [];
function tuneMaterial(m) {
  if (tuned.has(m)) return;
  tuned.add(m);
  if (!m.isMeshStandardMaterial) return;
  const n = (m.name || '').toLowerCase();
  if (m.userData.gfx === 'road') return;
  if (m.userData.gfx === 'water') { m.envMapIntensity = 1.0; return; }
  if (/paint|carpaint|body|helicopterbody/.test(n)) {
    // glossy car paint now that there is something to reflect
    m.metalness = Math.max(m.metalness, 0.45);
    m.roughness = Math.min(m.roughness, 0.28);
    m.envMapIntensity = 1.25;
  } else if (/glass|window|windshield|windscreen/.test(n)) {
    m.roughness = Math.min(m.roughness, 0.06);
    m.envMapIntensity = 1.4;
  } else if (/chrome|mirror|rim\d?$|^metal/.test(n)) {
    m.metalness = Math.max(m.metalness, 0.85);
    m.roughness = Math.min(m.roughness, 0.25);
    m.envMapIntensity = 1.1;
  } else if (m.envMapIntensity === 1) {
    m.envMapIntensity = 0.45;
  }
}
let scanT = 0;
function scanMaterials(dt) {
  scanT -= dt;
  if (scanT > 0) return;
  scanT = 1.2;
  G.scene.traverse((o) => {
    if (!o.material) return;
    if (Array.isArray(o.material)) o.material.forEach(tuneMaterial);
    else tuneMaterial(o.material);
  });
}
// roads: wet-looking sheen at night (the lamp lights streak across them)
function updateRoads() {
  const n = G.night;
  for (const m of roadMats) {
    m.roughness = lerp(0.93, 0.5, n);
    m.envMapIntensity = lerp(0.35, 0.8, n);
  }
}

// ---------------------------------------------------------------- post-processing
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uNight: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uNight; uniform vec2 uRes; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // split toning: teal shadows, warm highlights (cooler overall at night)
      vec3 shT = mix(vec3(-0.012, 0.006, 0.022), vec3(-0.01, 0.0, 0.03), uNight);
      vec3 hiT = mix(vec3(0.03, 0.012, -0.022), vec3(0.02, 0.008, -0.01), uNight);
      c += shT * (1.0 - smoothstep(0.0, 0.45, l)) + hiT * smoothstep(0.45, 1.0, l);
      c = clamp(c, 0.0, 1.0);
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.25);        // gentle S-curve
      float l2 = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l2), c, 1.1);                         // a little more saturation
      vec2 d = vUv - 0.5;
      c *= 1.0 - dot(d, d) * (0.55 + 0.25 * uNight);     // vignette
      c += (hash(vUv * uRes + fract(uTime) * 61.0) - 0.5) * (0.018 + 0.012 * uNight);  // film grain
      gl_FragColor = vec4(c, 1.0);
    }`,
};
let composer = null, bloom = null, grade = null, gtao = null;
function buildComposer() {
  disposeComposer();
  const p = P();
  if (!p.post) return;
  const r = G.renderer;
  const size = r.getSize(new THREE.Vector2());
  const pr = r.getPixelRatio();
  const rt = new THREE.WebGLRenderTarget(Math.round(size.x * pr), Math.round(size.y * pr), { type: THREE.HalfFloatType, samples: p.msaa });
  if (p.ao) rt.depthTexture = new THREE.DepthTexture(rt.width, rt.height); // AO reads the main pass depth
  composer = new EffectComposer(r, rt);
  composer.addPass(new RenderPass(G.scene, G.camera));
  if (p.ao) {
    gtao = new GTAOPass(G.scene, G.camera, size.x, size.y);
    gtao.updateGtaoMaterial({ radius: 3.5, distanceExponent: 1.5, thickness: 6, scale: 1.8, samples: 12 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    gtao.blendIntensity = 1.0;
    const set = gtao.setSize.bind(gtao); // AO at half resolution
    gtao.setSize = (w, h) => set(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    // No second scene render for a G-buffer: AO uses the main pass depth (normals rebuilt from
    // depth). setGBuffer is called after construction because r160's constructor path with a
    // depth texture touches a normal target it never created. The composer ping-pongs between two
    // targets, so the depth texture is picked per frame from whichever one holds the scene.
    gtao.setGBuffer(rt.depthTexture);
    const render = gtao.render.bind(gtao);
    gtao.render = (renderer, write, read, ...a) => {
      const d = read.depthTexture;
      gtao.gtaoMaterial.uniforms.tDepth.value = d;
      gtao.pdMaterial.uniforms.tDepth.value = d;
      render(renderer, write, read, ...a);
    };
    composer.addPass(gtao);
  }
  bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3, 0.55, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.setPixelRatio(pr);
  composer.setSize(size.x, size.y);
  G.gfxPasses = { composer, bloom, grade, gtao }; // debug handle
}
function disposeComposer() {
  if (!composer) return;
  for (const p of composer.passes) if (p.dispose) p.dispose();
  composer.renderTarget1.dispose();
  composer.renderTarget2.dispose();
  composer = bloom = grade = gtao = null;
}
function updatePost(dt) {
  updateRoads();
  scanMaterials(dt);
  if (!composer) return;
  const n = G.night;
  bloom.strength = lerp(0.2, 0.42, n);
  bloom.threshold = lerp(1.1, 0.85, n);
  bloom.radius = lerp(0.45, 0.6, n);
  grade.uniforms.uTime.value = G.time;
  grade.uniforms.uNight.value = n;
  const s = G.renderer.getDrawingBufferSize(V2);
  grade.uniforms.uRes.value.set(s.x, s.y);
}

// main.js renders through this when post-processing is on (null on low)
export const getComposer = () => composer;
export function resizeGfx(w, h) {
  if (composer) { composer.setPixelRatio(G.renderer.getPixelRatio()); composer.setSize(w, h); }
}

// ---------------------------------------------------------------- applying a preset
// Applied at boot and live from the pause menu. Grass/plant density is read at world build, so a
// different ground level only shows after a reload.
export function applyPreset(name, { save = false } = {}) {
  if (!PRESETS[name]) name = DEFAULT_PRESET;
  const prev = G.gfxPreset;
  G.gfxPreset = name;
  G.lowQ = name === 'low';
  if (save) store(name);
  const p = P();
  const r = G.renderer;
  if (!r) return;
  r.setPixelRatio(p.pr);
  r.setSize(innerWidth, innerHeight);
  const shadows = p.shadow > 0;
  const shadowChange = r.shadowMap.enabled !== shadows;
  r.shadowMap.enabled = shadows;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  if (sun) {
    sun.castShadow = shadows;
    if (shadows) {
      const R = p.shadowR;
      const sc = sun.shadow.camera;
      sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 50; sc.far = 1500;
      sc.updateProjectionMatrix();
      if (sun.shadow.mapSize.x !== p.shadow) {
        sun.shadow.mapSize.set(p.shadow, p.shadow);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      }
      const texel = (2 * R) / p.shadow;
      sun.shadow.bias = -0.00025;
      sun.shadow.normalBias = texel * 1.4;
      sun.shadow.radius = 1;
    }
  }
  if (shadowChange && G.scene) G.scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
  if (G.scene && G.camera) buildComposer();
  lastEnv.night = -1; // force an environment refresh
  if (G.scene) G.scene.environment = p.env && envRT ? envRT.texture : null; // also right while paused
  updateMenu();
  if (prev && typeof window !== 'undefined') window.dispatchEvent(new Event('resize')); // particle scale follows the pixel ratio
  return prev;
}

// ---------------------------------------------------------------- pause menu control
function updateMenu() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('[data-gfx]').forEach((b) => {
    const on = b.dataset.gfx === G.gfxPreset;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const note = document.getElementById('gfx-note');
  if (note) note.textContent = PRESETS[G.gfxPreset].ground !== G.groundBuilt ? 'Grass density changes after a reload.' : '';
}
export function initGfxMenu() {
  document.querySelectorAll('[data-gfx]').forEach((b) => b.addEventListener('click', () => applyPreset(b.dataset.gfx, { save: true })));
  updateMenu();
}

// ---------------------------------------------------------------- automatic fallback
// Only when the player never picked a preset: if the default runs slowly in the first seconds of
// play, step down once or twice and remember it. Skipped under automation (test harness).
let autoState = null;
export function initAutoQuality(explicit) {
  const webdriver = typeof navigator !== 'undefined' && navigator.webdriver;
  autoState = explicit || webdriver ? null : { t: 0, frames: 0, warm: 3 };
}
export function autoQuality(dt, notify) {
  if (!autoState || G.state !== 'play') return;
  if (autoState.warm > 0) { autoState.warm -= dt; return; }
  autoState.t += dt;
  autoState.frames++;
  if (autoState.t < 6) return;
  const fps = autoState.frames / autoState.t;
  const i = PRESET_NAMES.indexOf(G.gfxPreset);
  // the game is often CPU-bound, where lower presets barely help: only react to really low rates
  if (fps < 30 && i > 0) {
    const next = PRESET_NAMES[i - (fps < 20 && i > 1 ? 2 : 1)];
    applyPreset(next, { save: true });
    if (notify) notify(`Graphics set to ${next[0].toUpperCase() + next.slice(1)} for a smoother frame rate (pause menu to change)`);
    autoState = { t: 0, frames: 0, warm: 3 };
    if (next === 'low') autoState = null;
  } else autoState = null;
}
