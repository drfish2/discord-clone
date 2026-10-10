// kerb_test.js — does driving over a pavement launch the car? (fix/pavement-jump)
//
// Picks seeded straight pavement stretches, places a car on the carriageway angled
// toward the kerb, holds W and logs the body's vertical velocity, airtime and the
// ground profile under its path (road -> kerb -> pavement -> verge behind it).
// Usage: GAME_ROOT=<repo>/public/game NORENDER=1 node kerb_test.js [cases=30] [vehicle=sports]
const { boot } = require('C:/Users/munee/.zcode/workspace/default/crimson-coast/harness/harness.js');
(async () => {
  const N = parseInt(process.argv[2] || '30', 10), TYPE = process.argv[3] || 'sports', TRACE = process.env.TRACE ? +process.env.TRACE : -1;
  const { browser, page } = await boot({ headless: true });
  await page.waitForFunction(() => window.__game && window.__game.G.state === 'menu', null, { timeout: 180000 });
  const r = await page.evaluate(async ({ N, TYPE, TRACE }) => {
    const G = window.__game.G;
    const T = await import('https://game.local/js/terrain.js');
    const VS = await import('https://game.local/js/vehicles.js');
    // case picks get their own stream so game randomness can't shift them between builds
    let seed = 777, gseed = 4242;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    Math.random = () => ((gseed = (gseed * 1103515245 + 12345) >>> 0) / 4294967296);
    document.querySelector('#btn-play').click();
    const P = G.player;
    const cand = T.segs.filter((s) => s.sidewalk && !s.bridge && s.len > 12);
    let v = null;
    const cases = [];
    const angles = [10, 25, 45];
    for (let k = 0; k < N; k++) {
      const s = cand[Math.floor(rnd() * cand.length)];
      const ang = angles[k % 3] * Math.PI / 180, side = rnd() < 0.5 ? 1 : -1;
      const nx = -s.dz * side, nz = s.dx * side; // toward the kerb on `side`
      // start in the middle of the lane so the kerb is crossed after ~(w/4)/sin(ang) m
      const lat0 = s.w / 4;
      const along0 = s.len / 2 - (s.w / 4) / Math.tan(ang);
      const x0 = s.a.x + s.dx * along0 + nx * lat0 * 0, z0 = s.a.z + s.dz * along0;
      const fx = s.dx * Math.cos(ang) + nx * Math.sin(ang), fz = s.dz * Math.cos(ang) + nz * Math.sin(ang);
      const hd = Math.atan2(fx, fz);
      // run-up: start 15 m further back along the heading so it arrives at speed
      const sx = x0 - fx * 15, sz = z0 - fz * 15;
      // fresh car per case: a reused one gathers crash damage and explodes (destroy() sets vy = 7)
      if (v) { if (P.vehicle) P.exitVehicle && P.exitVehicle(true); v.remove(); }
      P.reset(sx, sz); v = VS.spawnVehicle(TYPE, sx, sz, hd); P.enterVehicle(v);
      for (const o of [...G.vehicles]) if (o !== v && !o.persist && Math.hypot(o.pos.x - sx, o.pos.z - sz) < 80) o.remove();
      for (const p of [...G.peds]) if (Math.hypot(p.pos.x - sx, p.pos.z - sz) < 80 && p !== P) p.remove && p.remove();
      const y0 = T.groundHeight(sx, sz) + 0.6; // spawn just above the ground, then settle
      v.pos.set(sx, y0, sz); v.vel.set(0, 0, 0); v.vy = 0; v.heading = hd; v.pitch = 0; v.roll = 0;
      if (v.phys) v.phys.reset(sx, y0, sz, hd);
      v.snapSync();
      // settle 1 s with no input so spawn placement never counts as a launch
      G.keys.KeyW = G.keys.KeyS = G.keys.KeyA = G.keys.KeyD = false;
      window.__game.step(60, 1 / 60);
      let maxUp = 0, air = 0, spikes = 0, top = 0, crossKmh = null;
      const trace = TRACE === k ? [] : null;
      for (let f = 0; f < 60 * 3.5; f++) {
        G.keys.KeyW = true; G.keys.KeyA = G.keys.KeyD = false;
        window.__game.step(1, 1 / 60);
        const vy = v.vy || 0;
        if (vy > maxUp) maxUp = vy;
        if (Math.abs(vy) > 2) spikes++;
        if (v.onGround === false) air += 1 / 60;
        top = Math.max(top, Math.abs(v.speedAbs));
        if (crossKmh === null && T.onPavement(v.pos.x, v.pos.z)) crossKmh = Math.round(Math.abs(v.speedAbs) * 3.6);
        if (trace && v.phys) trace.push({ f, y: +v.pos.y.toFixed(2), vy: +vy.toFixed(2), kmh: Math.round(Math.abs(v.speedAbs) * 3.6), pav: T.onPavement(v.pos.x, v.pos.z),
          w: v.phys.wheels.map((w) => [w.contact ? 1 : 0, +w.comp.toFixed(2), +w.cy.toFixed(2)]),
          near: G.vehicles.filter((o) => o !== v).map((o) => [o.type || o.kind, +Math.hypot(o.pos.x - v.pos.x, o.pos.z - v.pos.z).toFixed(1)]).filter((e) => e[1] < 8),
          bld: (T.buildingsNear(v.pos.x, v.pos.z) || []).filter((o) => o.t === 0 && Math.abs(v.pos.x - o.cx) < o.hx + o.hz + 4 && Math.abs(v.pos.z - o.cz) < o.hx + o.hz + 4).map((o) => [o.kind, +(o.y0 - v.pos.y).toFixed(2), +(o.y1 - v.pos.y).toFixed(2)]).slice(0, 4),
          road: +(T.roadAt(v.pos.x, v.pos.z) ?? NaN).toFixed(2), ter: +T.terrainHeight(v.pos.x, v.pos.z).toFixed(2), gh: +T.groundHeight(v.pos.x, v.pos.z, v.pos.y + 0.6).toFixed(2) });
      }
      // ground profile along the path from the start, every 0.5 m for 40 m
      const prof = [];
      for (let d = 10; d <= 40; d += 0.5) {
        const x = sx + fx * d, z = sz + fz * d;
        prof.push(+(T.groundHeight(x, z, (T.roadAt(x, z) ?? T.terrainHeight(x, z)) + 1) - y0).toFixed(2));
      }
      const exploded = v.dead || v.health <= 0;
      if (trace) window.__trace = trace;
      cases.push({ k, exploded, deg: angles[k % 3], maxUp: +maxUp.toFixed(2), air: +air.toFixed(2), spikes, topKmh: Math.round(top * 3.6), crossKmh, x: Math.round(sx), z: Math.round(sz), hd: +hd.toFixed(3), prof });
    }
    G.keys.KeyW = false;
    const sum = (f) => cases.reduce((a, c) => a + f(c), 0);
    return {
      vehicle: TYPE, cases: cases.length,
      withAir: cases.filter((c) => c.air > 0.1).length,
      launches: cases.filter((c) => c.maxUp > 2).length, exploded: cases.filter((c) => c.exploded).length,
      totalAir: +sum((c) => c.air).toFixed(2), maxUp: Math.max(...cases.map((c) => c.maxUp)),
      trace: window.__trace || null,
      worst: cases.slice().sort((a, b) => b.maxUp - a.maxUp).slice(0, 5),
    };
  }, { N, TYPE, TRACE });
  console.log(JSON.stringify(r));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
