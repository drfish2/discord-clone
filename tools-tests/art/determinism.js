// determinism.js: hashes of the generated world (trees, street props, lamps, specials, mission
// pickups, building count) so changes to building generation can be checked for RNG drift.
// Usage: GAME_ROOT=... NORENDER=1 node determinism.js > out.json
const { boot } = require('C:/Users/munee/.zcode/workspace/default/crimson-coast/harness/harness.js');
(async () => {
  const { browser, page } = await boot({ headless: true, q: 'low' });
  try {
    await page.waitForFunction(() => window.__game && window.__game.G.state === 'menu', null, { timeout: 300000 });
    const r = await page.evaluate(async () => {
      const T = await import('./js/terrain.js');
      const h = (arr, f) => { let s = 0; for (const o of arr) s = (s * 31 + Math.round(f(o) * 10)) % 1000000007; return s; };
      const M = await import('./js/missions.js').catch(() => null);
      return {
        treePos: T.trees.map((t) => Math.round(t.x * 10) + ',' + Math.round(t.z * 10)),
        buildings: T.buildings.length,
        trees: T.trees.length, treesHash: h(T.trees, (t) => t.x * 3 + t.z * 7 + t.s * 11),
        props: T.props.filter((p) => !/dumpster/.test(p.file)).length,
        propsHash: h(T.props.filter((p) => !/dumpster/.test(p.file)), (p) => p.x * 3 + p.z * 7),
        lamps: T.lamps.length, lampsHash: h(T.lamps, (p) => p.x * 3 + p.z * 7),
        special: JSON.stringify(T.SPECIAL).length + ':' + Math.round(T.SPECIAL.police.x) + ',' + Math.round(T.SPECIAL.hospital.x) + ',' + Math.round(T.SPECIAL.spray.x),
        ramps: T.ramps.map((r) => Math.round(r.x) + ',' + Math.round(r.z) + ',' + r.base.toFixed(1)).join(' '),
        fences: T.fences.length,
        missions: M ? Object.keys(M).join(',') : null,
        G: (() => { const G = window.__game.G; return { pickups: (G.pickups || []).map((p) => Math.round(p.x) + ',' + Math.round(p.z)).join(' ') }; })(),
      };
    });
    console.log(JSON.stringify(r, null, 1));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
