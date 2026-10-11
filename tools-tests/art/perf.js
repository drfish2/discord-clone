// perf.js: boot time to menu, then synchronous frame time (gl.readPixels fence) at fixed views,
// draw calls, triangles, console errors.
// Usage: GAME_ROOT=... NODE_PATH=... node perf.js [q]
const { boot } = require('C:/Users/munee/.zcode/workspace/default/crimson-coast/harness/harness.js');
const VIEWS = [
  ['street_downtown', [-2583, -1525], null],
  ['street_coral', [1116, 2603], null],
  ['aerial_west', null, [[-2600, 700, -600], [-3600, 0, -2600]]],
];
(async () => {
  const q = process.argv[2] || null;
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
    const out = { q, bootMs, views: {} };
    for (const [name, at, cam] of VIEWS) {
      out.views[name] = await page.evaluate(({ at, cam }) => {
        const G = window.__game.G;
        if (at) G.player.reset(at[0], at[1]); else G.player.reset(cam[1][0], cam[1][2]);
        G.dayTime = 13;
        window.__game.step(18, 1 / 30);
        const c = G.camera;
        const gl = G.renderer.getContext(), px = new Uint8Array(4);
        const one = () => {
          if (cam) { c.position.set(...cam[0]); c.lookAt(...cam[1]); c.updateMatrixWorld(); }
          G.renderer.render(G.scene, c); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        };
        one(); one();
        const t = performance.now();
        for (let i = 0; i < 4; i++) one();
        const r = G.renderer.info;
        return { ms: Math.round((performance.now() - t) / 4), calls: r.render.calls, tris: r.render.triangles };
      }, { at, cam });
    }
    out.mem = await page.evaluate(() => { const r = window.__game.G.renderer.info; return { geos: r.memory.geometries, tex: r.memory.textures, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null }; });
    out.errors = errors;
    console.log(JSON.stringify(out));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
