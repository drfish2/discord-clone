// ground_shots.js: before/after screenshots of the ground dressing (terrain textures,
// grass, plants, fences) at fixed spots, plus boot time and a rough frame time.
//
// Spots are picked from the map data on the first run and cached in
// tools-tests/ground/spots.json so later runs (after the change) shoot the same views.
// Each spot gets an eye-level view (1.7 m), a car-height chase view and one high view.
//
// Usage:
//   GAME_ROOT=C:/Users/munee/cc-agents/ground/public/game \
//   NODE_PATH=C:/Users/munee/.zcode/workspace/default/crimson-coast/node_modules \
//   node tools-tests/ground_shots.js <tag> [q=default|low] [only=spot1,spot2]
// Writes tools-tests/ground/<tag>_<spot>_<view>.png and <tag>_metrics.json.
const path = require('path');
const fs = require('fs');
const { boot } = require('C:/Users/munee/.zcode/workspace/default/crimson-coast/harness/harness.js');

const OUT = path.join(__dirname, 'ground');
const tag = process.argv[2] || 'shot';
const q = (process.argv[3] || 'default') === 'low' ? 'low' : '';
const only = process.argv[4] ? process.argv[4].split(',') : null;
fs.mkdirSync(OUT, { recursive: true });
const SPOTS = path.join(OUT, 'spots.json');

(async () => {
  const errors = [];
  const t0 = Date.now();
  const { browser, page } = await boot({ headless: true, viewport: { width: 640, height: 400 }, q });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  await page.waitForFunction(() => window.__game && window.__game.G.state === 'menu', null, { timeout: 300000 });
  const bootMs = Date.now() - t0;
  await page.evaluate(() => document.querySelector('#btn-play').click());
  await page.waitForFunction(() => window.__game.G.state === 'play', null, { timeout: 60000 });

  let spots = fs.existsSync(SPOTS) ? JSON.parse(fs.readFileSync(SPOTS, 'utf8')) : null;
  if (!spots) {
    spots = await page.evaluate(async () => {
      const T = await import('https://game.local/js/terrain.js');
      const B = T.BIOMES;
      const out = {};
      const segAt = (pred, score) => {
        let best = null, bs = -Infinity;
        for (let i = 0; i < T.segs.length; i += 7) {
          const s = T.segs[i];
          if (s.bridge || s.len < 12) continue;
          const mx = (s.a.x + s.b.x) / 2, mz = (s.a.z + s.b.z) / 2;
          if (!pred(s, mx, mz)) continue;
          const sc = score(s, mx, mz);
          if (sc > bs) { bs = sc; best = s; }
        }
        return best;
      };
      const houses = (x, z, r) => {
        let n = 0;
        for (const b of T.buildings) if (b.kind === 'house' && Math.abs(b.cx - x) < r && Math.abs(b.cz - z) < r) n++;
        return n;
      };
      const frac = (x, z, r, b) => { let n = 0, t = 0; for (let dx = -r; dx <= r; dx += r / 3) for (let dz = -r; dz <= r; dz += r / 3) { t++; if (T.biomeAt(x + dx, z + dz) === b) n++; } return n / t; };
      // residential: pavement street with the most houses nearby (sampled subset for speed)
      const resCand = T.segs.filter((s, i) => i % 23 === 0 && s.sidewalk && s.kind === 'city' && !s.bridge && s.len > 12);
      let best = null, bn = -1;
      for (const s of resCand.slice(0, 900)) { const n = houses((s.a.x + s.b.x) / 2, (s.a.z + s.b.z) / 2, 80); if (n > bn) { bn = n; best = s; } }
      const mk = (s, off) => {
        const mx = (s.a.x + s.b.x) / 2, mz = (s.a.z + s.b.z) / 2;
        return { x: mx - s.dz * off, z: mz + s.dx * off, dx: s.dx, dz: s.dz, w: s.w };
      };
      if (best) out.residential = mk(best, best.w / 2 + 1.6);
      const country = segAt((s, x, z) => s.kind === 'rural' && T.urbanAt(x, z) < 0.01 && T.biomeAt(x, z) === B.GRASS && T.terrainHeight(x, z) > 10 && T.terrainHeight(x, z) < 120, (s, x, z) => frac(x, z, 150, B.GRASS) - Math.abs(s.a.h - s.b.h) / s.len * 5);
      if (country) out.countryside = mk(country, country.w / 2 + 2.5);
      const forest = segAt((s, x, z) => T.urbanAt(x, z) < 0.01 && T.biomeAt(x, z) === B.FOREST, (s, x, z) => frac(x, z, 120, B.FOREST));
      if (forest) out.forest = mk(forest, forest.w / 2 + 2.5);
      const desert = segAt((s, x, z) => T.urbanAt(x, z) < 0.01 && T.biomeAt(x, z) === B.DESERT, (s, x, z) => frac(x, z, 120, B.DESERT));
      if (desert) out.desert = mk(desert, desert.w / 2 + 2.5);
      const beach = segAt((s, x, z) => T.biomeAt(x, z) === B.BEACH && T.terrainHeight(x, z) > 1, (s, x, z) => frac(x, z, 60, B.BEACH) - T.urbanAt(x, z));
      if (beach) out.beach = mk(beach, beach.w / 2 + 2.5);
      const wet = segAt((s, x, z) => T.biomeAt(x, z) === B.WETLAND && T.urbanAt(x, z) < 0.05, (s, x, z) => frac(x, z, 100, B.WETLAND));
      if (wet) out.wetland = mk(wet, wet.w / 2 + 2.5);
      return out;
    });
    fs.writeFileSync(SPOTS, JSON.stringify(spots, null, 1));
  }
  // extra spots added later (beaches, open desert): found once and cached like the rest
  if (!spots.shore || !spots.desertopen) {
    const extra = await page.evaluate(async () => {
      const T = await import('https://game.local/js/terrain.js');
      const B = T.BIOMES;
      const out = {};
      // shore: dry land 1-3 m above the sea with open water 30-60 m away, away from towns/roads
      let best = null, bs = -Infinity;
      for (let x = -6000; x < 6000; x += 45)
        for (let z = -6000; z < 6000; z += 45) {
          const h = T.terrainHeight(x, z);
          if (h < 1.2 || h > 3) continue;
          if (T.urbanAt(x, z) > 0.03) continue;
          const r = T.nearestRoad(x, z);
          if (r && r.d < 25) continue;
          // direction to the sea
          let sx = 0, sz = 0, n = 0;
          for (let a = 0; a < 16; a++) { const c = Math.cos(a / 16 * 6.283), s = Math.sin(a / 16 * 6.283); if (T.terrainHeight(x + c * 45, z + s * 45) < -1) { sx += c; sz += s; n++; } }
          if (n < 3 || n > 8) continue;
          const sc = (T.biomeAt(x, z) === B.BEACH ? 2 : 0) - Math.abs(n - 5) * 0.2 + (r ? Math.min(r.d, 200) / 200 : 1);
          if (sc > bs) { bs = sc; const L = Math.hypot(sx, sz); best = { x, z, sx: sx / L, sz: sz / L }; }
        }
      // look along the coast (perpendicular to the sea direction), standing a bit inland
      if (best) out.shore = { x: best.x - best.sx * 10, z: best.z - best.sz * 10, dx: -best.sz * 0.8 + best.sx * 0.6, dz: best.sx * 0.8 + best.sz * 0.6, w: 0 };
      let bd = null, bds = -Infinity;
      for (let x = -6000; x < 6000; x += 60)
        for (let z = -6000; z < 6000; z += 60) {
          if (T.biomeAt(x, z) !== B.DESERT || T.urbanAt(x, z) > 0.01) continue;
          const r = T.nearestRoad(x, z);
          if (!r || r.d > 12 || r.d < 3 || r.s.bridge) continue;
          const sc = -T.urbanAt(x, z) + Math.random() * 0.01;
          if (sc > bds) { bds = sc; bd = { x, z, dx: r.s.dx, dz: r.s.dz, w: r.s.w }; }
        }
      if (bd) out.desertopen = bd;
      return out;
    });
    Object.assign(spots, extra);
    fs.writeFileSync(SPOTS, JSON.stringify(spots, null, 1));
  }
  console.log('spots', Object.keys(spots).join(', '));
  // hide the HUD so the shots show the world only
  await page.addStyleTag({ content: 'body > *:not(#game) { display: none !important; } #game > *:not(canvas) { display: none !important; }' });

  // freeze the game: render loop keeps drawing whatever camera we set
  await page.evaluate(() => { const G = window.__game.G; G.state = 'shot'; G.dayTime = 11;
    // stop the rAF loop from rendering every frame (SwiftShader is CPU heavy); we render on demand
    const r = G.renderer; r.__render = r.render.bind(r); r.render = () => {}; for (const p of G.peds || []) if (p.mesh) p.mesh.visible = false; });

  const frameTimes = [];
  for (const [name, s] of Object.entries(spots)) {
    if (only && !only.includes(name)) continue;
    const views = {
      eye: { back: 0, up: 1.7, look: 40, lookUp: 0.6, side: 0 },
      car: { back: 7, up: 2.6, look: 40, lookUp: 0.2, side: -s.w / 2 - 1.0 },
      high: { back: 40, up: 45, look: 70, lookUp: -20, side: 25 },
    };
    for (const [vn, v] of Object.entries(views)) {
      const ft = await page.evaluate(async ({ s, v }) => {
        const G = window.__game.G;
        const T = await import('https://game.local/js/terrain.js');
        const W = await import('https://game.local/js/world.js');
        const nx = -s.dz, nz = s.dx;
        const cx = s.x - s.dx * v.back + nx * v.side, cz = s.z - s.dz * v.back + nz * v.side;
        const gy = T.groundHeight(cx, cz);
        const cam = G.camera;
        cam.position.set(cx, gy + v.up, cz);
        const lx = s.x + s.dx * v.look, lz = s.z + s.dz * v.look;
        cam.lookAt(lx, T.groundHeight(lx, lz) + v.lookUp + (v.up > 20 ? 0 : 1.2), lz);
        cam.fov = 62; cam.updateProjectionMatrix();
        G.player.pos.set(cx, gy, cz);
        // streamers and tile culling follow the camera
        for (let i = 0; i < 6; i++) W.updateWorld(0.5, G.player.pos);
        await new Promise((r) => setTimeout(r, 300));
        // rough frame time: N timed renders
        const t = performance.now();
        const N = 3;
        for (let i = 0; i < N; i++) { G.renderer.__render(G.scene, cam); G.renderer.getContext().finish(); }
        return (performance.now() - t) / N;
      }, { s, v });
      frameTimes.push(ft);
      await page.waitForTimeout(400);
      const f = path.join(OUT, `${tag}_${name}_${vn}.png`);
      await page.screenshot({ path: f });
      console.log(f, ft.toFixed(0) + ' ms/frame');
    }
  }
  const info = await page.evaluate(() => { const r = window.__game.G.renderer.info; return { calls: r.render.calls, tris: r.render.triangles, geos: r.memory.geometries, tex: r.memory.textures }; });
  const metrics = { tag, q: q || 'default', bootMs, meanFrameMs: frameTimes.reduce((a, b) => a + b, 0) / Math.max(1, frameTimes.length), lastFrame: info, errors: errors.slice(0, 40) };
  fs.writeFileSync(path.join(OUT, `${tag}_metrics.json`), JSON.stringify(metrics, null, 1));
  console.log(JSON.stringify(metrics, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
