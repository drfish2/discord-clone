// Turntable preview of GLB files for eyeballing scale/orientation/materials.
// Usage: node preview.mjs <model.glb> [more.glb ...]
// Screenshots land in build/preview/<name>-front.png / -back.png / -side.png.
const path = require('path');
const fs = require('fs');
const { chromium } = require(path.join('C:/Users/munee/.zcode/workspace/default/crimson-coast/node_modules', 'playwright'));

const VENDOR = 'C:/Users/munee/.zcode/workspace/default/crimson-coast/vendor/three';

const HTML = `<!doctype html><html><head><meta charset="utf8">
<style>body{margin:0;background:#3a4148}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/vendor/three.module.js","three/addons/":"/vendor/ex/"}}</script>
</head><body><script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

window.shot = async (url) => {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x3a4148);
  const root = gltf.scene;
  scene.add(root);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // ground the model
  root.position.y -= box.min.y;
  const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 2.2);
  hemi.position.set(0, 10, 0);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 2.4);
  dir.position.set(4, 8, 6);
  scene.add(dir);
  const grid = new THREE.GridHelper(Math.max(size.x, size.z) * 4, 20, 0x666666, 0x444444);
  scene.add(grid);
  const cam = new THREE.PerspectiveCamera(40, 640 / 480, 0.05, 500);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(640, 480);
  document.body.appendChild(renderer.domElement);
  window.__info = { size: size.toArray().map(v => +v.toFixed(3)), min: box.min.toArray().map(v => +v.toFixed(3)) };
  const names = [];
  root.traverse(o => { if (o.isMesh) names.push(o.name + ':' + (Array.isArray(o.material) ? o.material.map(m=>m.name).join('+') : o.material.name)); });
  window.__meshes = names;
  window.__render = (dirName, out) => {
    const r = Math.max(size.x, size.z);
    const ang = dirName === 'front' ? Math.PI : dirName === 'back' ? 0 : dirName === 'side' ? -Math.PI / 2 : 0;
    // game convention: model faces +z; 'front' view looks at the car's front (+z side)
    cam.position.set(center.x + Math.sin(ang) * r * 1.5, center.y + r * 0.55, center.z + Math.cos(ang) * r * 1.5);
    cam.lookAt(center.x, center.y + size.y * 0.35, center.z);
    renderer.render(scene, cam);
    return renderer.domElement.toDataURL('image/png');
  };
  window.__ready = true;
};
</script></body></html>`;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 680, height: 520 } });
  page.on('console', (m) => { if (m.type() === 'error') console.error('[console]', m.text()); });
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('https://preview.local/vendor/')) {
      const rel = url.replace('https://preview.local/vendor/', '');
      const candidates = [
        path.join(VENDOR, 'build', rel),
        path.join(VENDOR, 'examples', 'jsm', rel.replace(/^ex\//, '')),
        path.join(VENDOR, rel),
      ];
      const file = candidates.find((f) => fs.existsSync(f));
      if (file) {
        const mime = file.endsWith('.js') || file.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream';
        return route.fulfill({ status: 200, contentType: mime, body: fs.readFileSync(file) });
      }
      { console.error('[404]', url, '->', candidates.join(' | ')); return route.fulfill({ status: 404, body: 'nope' }); }
    }
    if (url.startsWith('https://preview.local/model/')) {
      const file = decodeURIComponent(url.replace('https://preview.local/model/', ''));
      return route.fulfill({ status: 200, contentType: 'model/gltf-binary', body: fs.readFileSync(file) });
    }
    { if (!url.startsWith('https://preview.local/')) console.error('[fallback]', url); return route.fulfill({ status: 200, contentType: 'text/html', body: HTML }); }
  });
  await page.goto('https://preview.local/');
  fs.mkdirSync('build/preview', { recursive: true });
  for (const model of process.argv.slice(2)) {
    const abs = path.resolve(model);
    await page.evaluate((u) => window.shot(u), 'https://preview.local/model/' + encodeURIComponent(abs));
    await page.waitForFunction('window.__ready', null, { timeout: 60000 });
    const info = await page.evaluate('window.__info');
    console.log(path.basename(model), JSON.stringify(info));
    const meshes = await page.evaluate('window.__meshes');
    console.log('  meshes:', meshes.join(' | '));
    const base = path.basename(model).replace(/\.glb$/i, '');
    for (const dirName of ['front', 'back', 'side']) {
      const dataUrl = await page.evaluate((d) => window.__render(d), dirName);
      fs.writeFileSync(`build/preview/${base}-${dirName}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
      console.log(`  -> build/preview/${base}-${dirName}.png`);
    }
  }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
