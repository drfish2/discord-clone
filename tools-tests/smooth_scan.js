// smooth_scan.js — what the wheels feel along the road network (fix/driving-bumps).
//
// Walks N seeded-random roads end to end and samples groundHeight() under both wheel
// tracks (±0.9 m) every 0.5 m, with maxY = previous sample + 1 m like a car's strut.
// Counts height steps between consecutive samples. Unlike drive_test.js (40 points
// picked where the OLD build buried the road), this is unbiased across the network.
//
// Usage: GAME_ROOT=<repo>/public/game NORENDER=1 node smooth_scan.js [roads=1500]
const { boot } = require('C:/Users/munee/.zcode/workspace/default/crimson-coast/harness/harness.js');
(async () => {
  const N = parseInt(process.argv[2] || '1500', 10);
  const { browser, page } = await boot({ headless: true });
  await page.waitForFunction(() => window.__game && window.__game.G.state === 'menu', null, { timeout: 180000 });
  const r = await page.evaluate(async (N) => {
    const T = await import('https://game.local/js/terrain.js');
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    let km = 0, s10 = 0, s25 = 0, s50 = 0, s100 = 0, maxStep = 0, maxAt = null, samples = 0;
    for (let k = 0; k < N; k++) {
      const road = T.roads[Math.floor(rnd() * T.roads.length)];
      for (const lat of [-0.9, 0.9]) {
        let prev = null;
        for (const s of road.segs) {
          if (s.bridge) { prev = null; continue; }
          const nx = -s.dz, nz = s.dx;
          for (let t = 0; t < s.len; t += 0.5) {
            const x = s.a.x + s.dx * t + nx * lat, z = s.a.z + s.dz * t + nz * lat;
            const ref = prev === null ? (T.roadAt(x, z) ?? T.terrainHeight(x, z)) + 0.5 : prev + 1;
            const h = T.groundHeight(x, z, ref);
            samples++;
            if (prev !== null) {
              const d = Math.abs(h - prev);
              if (d > 0.10) s10++;
              if (d > 0.25) s25++;
              if (d > 0.50) s50++;
              if (d > 1.00) s100++;
              if (d > maxStep) { maxStep = d; maxAt = { x: Math.round(x), z: Math.round(z), from: +prev.toFixed(2), to: +h.toFixed(2) }; }
            }
            prev = h;
          }
          if (lat < 0) km += s.len / 1000;
        }
      }
    }
    const per = (n) => +(n / km).toFixed(2);
    return { roads: N, km: +km.toFixed(1), samples, stepsPerKm: { '>0.10m': per(s10), '>0.25m': per(s25), '>0.50m': per(s50), '>1.00m': per(s100) }, maxStep: +maxStep.toFixed(2), maxAt };
  }, N);
  console.log(JSON.stringify(r, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
