// gfx_shots.js: time-of-day screenshots of a shopping street, the beach and a highway for one
// graphics preset, plus boot time, renderer stats and console errors.
// Usage: GAME_ROOT=.../public/game NODE_PATH=.../node_modules node gfx_shots.js <tag> [q]
//   env ONLY=street,beach,highway  TIMES=13,17.4,18.7,22
const path = require('path');
const fs = require('fs');
const { boot } = require('C:/Users/munee/.zcode/workspace/default/crimson-coast/harness/harness.js');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const tag = process.argv[2] || 'shot';
const q = process.argv[3] || null;
const TIMES = (process.env.TIMES || '13,17.6,18.3,22').split(',').map(Number);
const NAMES = { 13: 'noon', 17.6: 'golden', 18.3: 'dusk', 22: 'night', 17.4: 'golden', 18.7: 'dusk' };
const SCENES = (process.env.ONLY || 'street,beach,highway,car').split(',');

(async () => {
  const errors = [];
  const t0 = Date.now();
  const { browser, page } = await boot({ headless: true, viewport: { width: 640, height: 400 }, q });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.waitForFunction(() => window.__game && window.__game.G.state === 'menu', null, { timeout: 300000 });
    const bootMs = Date.now() - t0;
    await page.evaluate(() => document.getElementById('btn-play').click());
    await page.waitForFunction(() => window.__game.G.state === 'play', null, { timeout: 60000 });
    await page.addStyleTag({ content: '#hud{display:none!important}' });
    // debug: PRE="code" runs in the page before the shots (e.g. tweak a preset)
    if (process.env.PRE) await page.evaluate(`(async () => { ${process.env.PRE} })()`);
    // camera spots, computed in the page from the world data
    const spots = await page.evaluate(async () => {
      const T = await import('https://game.local/js/terrain.js');
      const out = {};
      // shopping street (dense shop lots), camera on the pavement looking along the road
      const [cx, cz, , hz, rot] = [35.7, 2994.4, 7, 6.3, 0.811];
      const fx = Math.sin(rot), fz = Math.cos(rot);
      const px = cx + fx * (hz + 7), pz = cz + fz * (hz + 7);
      out.street = { player: [px, pz], eye: [px - Math.cos(rot) * 14 + fx * 2, 3.2, pz + Math.sin(rot) * 14 + fz * 2], look: [px + Math.cos(rot) * 30 - fx * 3, 2.5, pz - Math.sin(rot) * 30 - fz * 3] };
      // beach: an umbrella, looking out to sea (downhill)
      const u = T.beachProps.find((b) => b.type === 'umbrella') || T.beachProps[0];
      let best = null;
      for (let a = 0; a < 6.283; a += 0.2) { const h = T.terrainHeight(u.x + Math.sin(a) * 40, u.z + Math.cos(a) * 40); if (!best || h < best.h) best = { a, h }; }
      const sx = Math.sin(best.a), sz = Math.cos(best.a);
      out.beach = { player: [u.x + sx * 3, u.z + sz * 3], eye: [u.x - sx * 10 + sz * 4, 3.5, u.z - sz * 10 - sx * 4], look: [u.x + sx * 60, 0.5, u.z + sz * 60] };
      // highway: a long straight main road segment outside town
      const far = (x, z) => T.buildings.every((b) => Math.abs(b.cx - x) > 90 || Math.abs(b.cz - z) > 90);
      const hw = T.segs.filter((s) => s.kind === "main" && !s.bridge && s.len > 8);
      let s = null;
      for (let k = 0; k < hw.length && !s; k += 1) { const c = hw[(k * 37) % hw.length]; if (far((c.a.x + c.b.x) / 2, (c.a.z + c.b.z) / 2)) s = c; }
      s = s || hw[0];
      const mx = (s.a.x + s.b.x) / 2, mz = (s.a.z + s.b.z) / 2;
      const nx = -s.dz, nz = s.dx;
      out.highway = { player: [mx + nx * (s.w / 2 + 2), mz + nz * (s.w / 2 + 2)], eye: [mx - s.dx * 20 + nx * (s.w / 2 + 1), 4.5, mz - s.dz * 20 + nz * (s.w / 2 + 1)], look: [mx + s.dx * 60, 1, mz + s.dz * 60] };
      // car: the parked vehicle nearest the start spot, three-quarter view
      const G = window.__game.G;
      const st = G.player.pos;
      const v = G.vehicles.filter((v) => v.kind === 'car').sort((a, b) => a.pos.distanceTo(st) - b.pos.distanceTo(st))[0];
      if (v) {
        const h = v.heading || 0, fx = Math.sin(h), fz = Math.cos(h);
        out.car = { player: [v.pos.x - fz * 4, v.pos.z + fx * 4], eye: [v.pos.x + fx * 5.5 + fz * 3.5, 1.6, v.pos.z + fz * 5.5 - fx * 3.5], look: [v.pos.x, 0.6, v.pos.z], abs: v.pos.y };
      }
      return out;
    });
    for (const name of SCENES) {
      const sp = spots[name];
      for (const time of TIMES) {
        await page.evaluate(({ sp, time }) => {
          const G = window.__game.G;
          G.player.reset(sp.player[0], sp.player[1]);
          G.dayTime = time;
          const gy = sp.abs ?? G.player.pos.y;
          const r = G.renderer;
          if (!r.__orig) { r.__orig = r.render.bind(r); r.render = (s, c) => { if (window.__cam && c === G.camera) { c.position.set(...window.__cam[0]); c.lookAt(...window.__cam[1]); c.updateMatrixWorld(); } r.__orig(s, c); }; }
          window.__cam = [[sp.eye[0], gy + sp.eye[1], sp.eye[2]], [sp.look[0], gy + sp.look[1], sp.look[2]]];
          G.camera.position.set(...window.__cam[0]);
          G.camera.lookAt(...window.__cam[1]);
          G.camera.updateMatrixWorld();
        }, { sp, time });
        await page.evaluate(() => window.__game.step(3, 1 / 30));
        await page.waitForTimeout(3000);
        const file = path.join(OUT, `${tag}_${name}_${NAMES[time] || time}.png`);
        await page.screenshot({ path: file });
        if (process.env.PICK) {
          // debug: what is under these pixels? PICK=x,y;x,y
          const hits = await page.evaluate(async (pick) => {
            const THREE = await import('three');
            const G = window.__game.G, rc = new THREE.Raycaster();
            return pick.split(';').map((p) => {
              const [x, y] = p.split(',').map(Number);
              rc.setFromCamera(new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1), G.camera);
              return rc.intersectObjects(G.scene.children, true).slice(0, 4).map((h) => `${h.object.type}:${h.object.name}:${h.object.material && h.object.material.type}:${Math.round(h.distance)}`);
            });
          }, process.env.PICK);
          console.log('pick', JSON.stringify(hits));
        }
        console.log('saved', path.basename(file));
      }
    }
    const stats = await page.evaluate(() => {
      const r = window.__game.G.renderer.info;
      return { calls: r.render.calls, tris: r.render.triangles, geos: r.memory.geometries, tex: r.memory.textures, progs: r.programs.length, preset: window.__game.G.gfxPreset || null };
    });
    console.log(JSON.stringify({ tag, q, bootMs, stats, errors }));
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
