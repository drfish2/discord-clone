// buildings_shots.js: street-level screenshots of buildings with the player in frame for scale.
// Shopping street, residential street and downtown, by day and by night, plus boot time,
// a rough frame time and any console errors.
// Usage: GAME_ROOT=.../public/game NODE_PATH=.../node_modules node buildings_shots.js <tag> [q]
//   tag: file prefix (e.g. before / after); q: 'low' or omitted for the default preset
const path = require('path');
const { boot } = require('C:/Users/munee/.zcode/workspace/default/crimson-coast/harness/harness.js');
const OUT = path.join(__dirname, 'buildings');
const tag = process.argv[2] || 'shot';
const q = process.argv[3] || null;

// lot centres from assets/map/world.json (densest areas of each lot style)
const SCENES = [
  { name: 'shops', lot: [35.7, 2994.4, 7, 6.3, 0.811], off: 6, views: ['front', 'along', 'aerial'] },
  { name: 'houses', lot: [4169, -467.5, 5.5, 6.9, -1.975], off: 7, views: ['front', 'along'] },
  { name: 'downtown', lot: [-3985.7, -3510.2, 11.5, 13.8, -2.848], off: 9, views: ['front', 'along'] },
];

(async () => {
  const errors = [];
  const t0 = Date.now();
  const { browser, page } = await boot({ headless: true, viewport: { width: 640, height: 360 }, q });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForFunction(() => window.__game && window.__game.G.state === 'menu', null, { timeout: 300000 });
  const bootMs = Date.now() - t0;
  await page.evaluate(() => document.getElementById('btn-play').click());
  await page.waitForFunction(() => window.__game.G.state === 'play', null, { timeout: 60000 });
  await page.addStyleTag({ content: '#help{display:none!important}' });
  const stats = await page.evaluate(() => {
    const r = window.__game.G.renderer.info;
    return { calls: r.render.calls, tris: r.render.triangles, geos: r.memory.geometries, tex: r.memory.textures };
  });

  for (const sc of SCENES.filter((s) => !process.env.ONLY || process.env.ONLY.split(',').includes(s.name))) {
    for (const view of sc.views) {
      for (const time of [13, 22]) {
        await page.evaluate(({ lot, off, view, time }) => {
          const G = window.__game.G;
          const [cx, cz, hx, hz, rot] = lot;
          const fx = Math.sin(rot), fz = Math.cos(rot);
          const d = hz + off;
          let x = cx + fx * d, z = cz + fz * d, yaw = rot + Math.PI;
          if (view === 'along') { x += Math.cos(rot) * 4; z -= Math.sin(rot) * 4; yaw = rot + Math.PI * 0.72; }
          G.player.reset(x, z);
          G.camYaw = yaw;
          G.camPitch = view === 'front' ? -0.05 : 0.02;
          G.dayTime = time;
          // aerial: override the camera just before each render
          const r = G.renderer;
          if (!r.__orig) { r.__orig = r.render.bind(r); r.render = (s, c) => { if (window.__cam) { c.position.set(...window.__cam[0]); c.lookAt(...window.__cam[1]); c.updateMatrixWorld(); } r.__orig(s, c); }; }
          window.__cam = view === 'aerial' ? [[cx + fx * 55 + Math.cos(rot) * 30, G.player.pos.y + 45, cz + fz * 55 - Math.sin(rot) * 30], [cx, G.player.pos.y, cz]] : null;
        }, { lot: sc.lot, off: sc.off, view, time });
        await page.evaluate(() => window.__game.step(3, 1 / 30));
        await page.waitForTimeout(2500);
        const file = path.join(OUT, `${tag}_${sc.name}_${view}_${time < 18 ? 'day' : 'night'}.png`);
        await page.screenshot({ path: file });
        console.log('saved', path.basename(file));
      }
    }
  }
  // rough frame time: synchronous renders of the shopping street by day (gl.finish via readPixels)
  const ft = await page.evaluate(() => {
    const G = window.__game.G;
    G.dayTime = 13;
    const gl = G.renderer.getContext(), px = new Uint8Array(4);
    const one = () => { G.renderer.render(G.scene, G.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    one();
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) one();
    return (performance.now() - t0) / 5;
  });
  console.log(JSON.stringify({ tag, q, bootMs, frameMs: Math.round(ft), stats, errors }));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
