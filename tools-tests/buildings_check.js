// buildings_check.js: logic checks for the human-scale buildings (no rendering).
// - building counts by kind and facade type
// - how many building footprints reach onto a carriageway or pavement (sampled points)
// - roof boxes sit inside their parent's footprint and on its roof
// - the player start and special sites are not inside a building
// Usage: NORENDER=1 GAME_ROOT=.../public/game NODE_PATH=.../node_modules node buildings_check.js
const { boot } = require('C:/Users/munee/.zcode/workspace/default/crimson-coast/harness/harness.js');

(async () => {
  const { browser, page } = await boot({ headless: true, viewport: { width: 320, height: 200 }, q: 'low' });
  try {
    await page.waitForFunction(() => window.__game && window.__game.G.state === 'menu', null, { timeout: 300000 });
    const res = await page.evaluate(async () => {
      const T = await import('https://game.local/js/terrain.js');
      const byKind = {}, byFac = {};
      let onRoad = 0, onPave = 0, sampled = 0;
      const offenders = [];
      for (const b of T.buildings) {
        byKind[b.kind] = (byKind[b.kind] || 0) + 1;
        byFac[b.fac] = (byFac[b.fac] || 0) + 1;
        if (b.kind === 'roof' || b.kind === 'hangar' || b.kind === 'mid' || b.kind === 'tower' && b.hx < 9) continue;
        sampled++;
        let r = false, p = false;
        for (const [u, v] of [[-0.9, 1], [0, 1], [0.9, 1], [-1, 0], [1, 0], [0, -1]]) {
          const lx = u * (b.hx - 0.2), lz = v * (b.hz - 0.2);
          const x = b.cx + lx * b.c + lz * b.s, z = b.cz - lx * b.s + lz * b.c;
          const segs = T.segsAt(x, z);
          if (!segs) continue;
          const nr = T.nearestRoad(x, z);
          if (nr && nr.d < 0) r = true;
          else if (T.onPavement(x, z)) p = true;
        }
        if (r) { onRoad++; if (offenders.length < 5) offenders.push([b.kind, Math.round(b.cx), Math.round(b.cz)]); }
        else if (p) onPave++;
      }
      // roof boxes inside a parent roof
      let roofBad = 0, roofN = 0;
      for (const b of T.buildings) {
        if (b.kind !== 'roof') continue;
        roofN++;
        const parent = T.buildingsNear(b.cx, b.cz).find((o) => o !== b && o.t === 0 && o.kind !== 'roof' && Math.abs(o.y1 - b.y0) < 1e-6);
        if (!parent) roofBad++;
      }
      const G = window.__game.G;
      const inside = (x, z) => T.collideCircle(x, z, 0.3, T.groundHeight(x, z), 1.8).hit;
      const sp = T.SPECIAL;
      return {
        total: T.buildings.length, byKind, byFac, sampled, onRoad, onPave, offenders, roofN, roofBad,
        playerInside: inside(G.player.pos.x, G.player.pos.z),
        specials: ['police', 'hospital', 'spray'].map((k) => [k, !!sp[k], sp[k] ? inside(sp[k].x, sp[k].z) : null]),
      };
    });
    console.log(JSON.stringify(res, null, 1));
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
