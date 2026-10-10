// accel_compare.js: straight-line launch per vehicle type on an open flat road
// (3 s full throttle from rest, then 2 s braking). Works on builds with or
// without the realistic cars, so the same script gives a before/after comparison.
// Usage: GAME_ROOT=<public/game> NORENDER=1 node tools-tests/accel_compare.js [q]
const { boot } = require('C:/Users/munee/.zcode/workspace/default/crimson-coast/harness/harness.js');
const TYPES = ['sedan', 'sports', 'suv', 'hatchback', 'taxi', 'police', 'van', 'pickup', 'firetruck', 'ambulance', 'bus'];
(async () => {
  const { browser, page } = await boot({ headless: true, viewport: { width: 480, height: 320 }, q: process.argv[2] === undefined ? '' : process.argv[2] });
  try {
    await page.waitForFunction(() => window.__game && window.__game.G.state === 'menu', null, { timeout: 240000 });
    const res = await page.evaluate(async (TYPES) => {
      const G = window.__game.G;
      const VS = await import('https://game.local/js/vehicles.js');
      const T = await import('https://game.local/js/terrain.js');
      let seed = 777;
      Math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
      document.querySelector('#btn-play').click();
      window.__game.step(5, 1 / 60);
      const P = G.player;
      let x0 = P.pos.x, z0 = P.pos.z, hd0 = 0;
      search: for (let r = 0; r < 800; r += 10) for (let a = 0; a < Math.PI * 2; a += 10 / Math.max(r, 10)) {
        const x = P.pos.x + Math.cos(a) * r, z = P.pos.z + Math.sin(a) * r;
        const nr = T.nearestRoad(x, z);
        if (!nr || nr.d > -2.5 || T.isWater(x, z)) continue;
        const hd = Math.atan2(nr.s.dx, nr.s.dz);
        let ok = true;
        for (let k = -8; k <= 48; k += 8) {
          const px = x + Math.sin(hd) * k, pz = z + Math.cos(hd) * k;
          if (T.collideCircle(px, pz, 6, T.groundHeight(px, pz) + 0.3, 4).hit) ok = false;
          if (Math.abs(T.groundHeight(px, pz) - T.groundHeight(x, z)) > 0.5) ok = false;
        }
        if (ok) { x0 = x; z0 = z; hd0 = hd; break search; }
      }
      const out = [];
      for (const type of TYPES) {
        if (P.vehicle) P.exitVehicle(true);
        for (const o of [...G.vehicles]) if (Math.hypot(o.pos.x - x0, o.pos.z - z0) < 150) o.remove();
        P.reset(x0, z0);
        const v = VS.spawnVehicle(type, x0, z0, hd0, 0x0d47a1);
        P.enterVehicle(v);
        G.keys.KeyW = G.keys.KeyS = G.keys.KeyA = G.keys.KeyD = G.keys.Space = false;
        window.__game.step(60, 1 / 60);
        let v3 = 0;
        for (let f = 0; f < 180; f++) { G.keys.KeyW = true; window.__game.step(1, 1 / 60); }
        v3 = v.speedAbs;
        const d3 = Math.hypot(v.pos.x - x0, v.pos.z - z0);
        G.keys.KeyW = false;
        let stopF = -1;
        for (let f = 0; f < 180; f++) { G.keys.KeyS = v.fwdSpeed > 0.5; window.__game.step(1, 1 / 60); if (stopF < 0 && v.speedAbs < 0.5) stopF = f; }
        G.keys.KeyS = false;
        out.push({ type, model: v.m.file || (v.m.model ? 'kenney' : 'procedural'), kmh3s: Math.round(v3 * 3.6), dist3s: +d3.toFixed(1), stopS: stopF < 0 ? '>3' : +(stopF / 60).toFixed(2), wheelbase: v.phys ? +v.phys.p.wheelbase.toFixed(2) : null });
      }
      return out;
    }, TYPES);
    for (const r of res) console.log(JSON.stringify(r));
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
