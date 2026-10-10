// ground_boot.js: boot the game once (headless, 640x400), report boot time, page errors with
// stacks, world counts (trees, fences, beach props) and streamer counts, then close.
// Usage: node tools-tests/ground_boot.js [low|default]
const { boot } = require('C:/Users/munee/.zcode/workspace/default/crimson-coast/harness/harness.js');

(async () => {
  const q = process.argv[2] === 'low' ? 'low' : '';
  const t0 = Date.now();
  const { browser, page } = await boot({ headless: true, viewport: { width: 640, height: 400 }, q });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.stack || e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
  try {
    await page.waitForFunction(() => window.__game && window.__game.G.state === 'menu', null, { timeout: 240000 });
    const bootMs = Date.now() - t0;
    await page.evaluate(() => document.querySelector('#btn-play').click());
    await page.waitForFunction(() => window.__game.G.state === 'play', null, { timeout: 60000 });
    await page.evaluate(() => window.__game.step(30, 1 / 30));
    await page.waitForTimeout(1500);
    const info = await page.evaluate(async () => {
      const T = await import('https://game.local/js/terrain.js');
      const Gd = await import('https://game.local/js/ground.js');
      const G = window.__game.G;
      const types = {};
      for (const t of T.trees) types[t.type] = (types[t.type] || 0) + 1;
      const ft = {};
      for (const f of T.fences || []) ft[f.type] = (ft[f.type] || 0) + 1;
      const r = G.renderer.info;
      // visible triangles by kind (instances x triangles), before frustum culling
      const kinds = {};
      G.scene.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        let p = o.parent, vis = true;
        while (p) { if (!p.visible) vis = false; p = p.parent; }
        if (!vis) return;
        const g = o.geometry, tri = (g.index ? g.index.count : g.attributes.position.count) / 3;
        const n = o.isInstancedMesh ? o.count : 1;
        const k = o.userData.kind || (o.isInstancedMesh ? 'inst-other' : 'mesh');
        kinds[k] = kinds[k] || { meshes: 0, tris: 0 };
        kinds[k].meshes++; kinds[k].tris += Math.round(tri * n);
      });
      return { trees: types, fences: ft, fenceTotal: (T.fences || []).length, beach: (T.beachProps || []).length, detail: Gd.groundDetailStats(), kinds, calls: r.render.calls, tris: r.render.triangles, fps: document.getElementById('fps').textContent, T: window.__T };
    });
    console.log(JSON.stringify({ bootMs, ...info }, null, 1));
  } catch (e) {
    console.log('FAILED', e.message);
  }
  console.log('errors:', errs.slice(0, 10).join('\n---\n'));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
