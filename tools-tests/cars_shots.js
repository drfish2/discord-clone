// cars_shots.js: close-up screenshots of the realistic cars, rendering ON.
// One headless browser, 640x400, one manual render per shot (SwiftShader is slow).
// Output: tools-tests/cars/<file>-<view>.png
// Usage: GAME_ROOT=.../public/game node tools-tests/cars_shots.js [type:colour ...]
const { boot } = require('C:/Users/munee/.zcode/workspace/default/crimson-coast/harness/harness.js');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'cars');
// [type, colour or null, wanted file] (colour picks the variant; null = type default)
const SHOTS = [
  ['sports', 'rossini-9x'], ['sports', 'vector-gt'], ['sports', 'volt3'], ['police', 'volt3'], ['taxi', 'volt3'],
  ['sedan', 'gz-prius'], ['hatchback', 'gz-hatchback'], ['suv', 'gz-suv'], ['pickup', 'gz-pickup'],
  ['van', 'courier-van'], ['ambulance', 'gz-ambulance'], ['firetruck', 'gz-firetruck'], ['bus', 'gz-bus'],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  delete process.env.NORENDER;
  const { browser, page } = await boot({ headless: true, viewport: { width: 640, height: 400 }, q: '' });
  try {
    await page.waitForFunction(() => window.__game && window.__game.G.state === 'menu', null, { timeout: 240000 });
    // an open, straight stretch of road near the start (no buildings within ~8 m of a 14 m car)
    const spot = await page.evaluate(async () => {
      document.querySelector('#btn-play').click();
      window.__game.step(5, 1 / 60);
      const T = await import('https://game.local/js/terrain.js');
      const P = window.__game.G.player;
      for (let r = 0; r < 600; r += 10) for (let a = 0; a < Math.PI * 2; a += 10 / Math.max(r, 10)) {
        const x = P.pos.x + Math.cos(a) * r, z = P.pos.z + Math.sin(a) * r;
        const nr = T.nearestRoad(x, z);
        if (!nr || nr.d > -2.5 || T.isWater(x, z)) continue;
        const hd = Math.atan2(nr.s.dx, nr.s.dz);
        let ok = true;
        for (const k of [-8, -4, 0, 4, 8]) {
          const px = x + Math.sin(hd) * k, pz = z + Math.cos(hd) * k;
          if (T.collideCircle(px, pz, 7, T.groundHeight(px, pz) + 0.3, 4).hit) ok = false;
          if (Math.abs(T.groundHeight(px, pz) - T.groundHeight(x, z)) > 0.4) ok = false;
        }
        if (ok) return { x, z, hd };
      }
      return { x: P.pos.x, z: P.pos.z, hd: 0 };
    });
    console.log('spot', JSON.stringify(spot));
    for (const [type, want] of SHOTS) {
      const shots = await page.evaluate(async ({ type, want, spot }) => {
        const G = window.__game.G;
        const VS = await import('https://game.local/js/vehicles.js');
        const THREE = await import('three');
        const P = G.player;
        if (P.vehicle) P.exitVehicle(true);
        const x0 = spot.x, z0 = spot.z;
        P.reset(x0 + 30, z0 + 30);
        for (const o of [...G.vehicles]) if (Math.hypot(o.pos.x - x0, o.pos.z - z0) < 60) o.remove();
        let v = null;
        for (const c of [0xb71c1c, 0x0d47a1, 0xf5f5f5, 0x2e7d32, 0x9e9e9e, 0x00838f, 0xe65100, 0x880e4f, 0xf9a825, 0x546e7a].concat(VS.CAR_COLORS)) {
          v = VS.spawnVehicle(type, x0, z0, spot.hd, c);
          if ((v.m.file || 'kenney') === want) break;
          v.remove(); v = null;
        }
        if (!v) return { err: 'no variant ' + want };
        P.enterVehicle(v);
        window.__game.step(40, 1 / 60); // settle on the suspension
        const r = G.renderer, cam = G.camera;
        const s = v.spec, k = Math.max(s.len, 4.2);
        const out = {};
        const views = { front34: [0.85, 0.42, 0.95], rear34: [-0.8, 0.38, -0.95] };
        for (const [name, [lx, ly, lz]] of Object.entries(views)) {
          const local = new THREE.Vector3(lx * k * 0.75, ly * k * 0.55 + 0.6, lz * k * 0.95);
          v.root.updateMatrixWorld(true);
          const wpos = v.root.localToWorld(local.clone());
          cam.position.copy(wpos);
          cam.fov = 50; cam.aspect = 640 / 400; cam.updateProjectionMatrix();
          cam.lookAt(v.pos.x, v.pos.y + s.height * 0.4, v.pos.z);
          cam.updateMatrixWorld(true);
          r.render(G.scene, cam);
          out[name] = r.domElement.toDataURL('image/png');
        }
        return { out, file: v.m.file, name: s.name };
      }, { type, want, spot });
      if (shots.err) { console.log(type, shots.err); continue; }
      for (const [view, url] of Object.entries(shots.out)) {
        const f = path.join(OUT, `${type}-${shots.file}-${view}.png`);
        fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
        console.log('wrote', path.relative(process.cwd(), f), shots.name);
      }
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
