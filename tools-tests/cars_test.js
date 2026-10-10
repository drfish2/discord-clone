// cars_test.js: realistic car models (feat/realistic-cars).
//
// Boots the game headless (logic only, NORENDER=1 recommended) with ?q=high so the
// heavy sports models load too, then:
//   1. checks every REAL_CARS GLB loaded and no console/page errors
//   2. for every road vehicle type: spawns it on open ground next to the player,
//      enters it, lets it settle for 1 s, then measures
//        - which model file it got, its size and the physics wheel layout
//        - physics wheels on the ground, settled ride height
//        - visual wheel centres vs. the raycast wheel mounts (body frame, metres)
//        - visual tyre bottoms vs. the terrain under them
//      then holds W for 3 s (and steers for 1 s) and records top speed, max |vy|,
//      flips and NaNs.
// Usage: GAME_ROOT=.../public/game NORENDER=1 node tools-tests/cars_test.js [q=high]
// Runs ONE browser and closes it at the end.

const { boot } = require('C:/Users/munee/.zcode/workspace/default/crimson-coast/harness/harness.js');

const TYPES = ['sedan', 'sports', 'suv', 'luxury', 'hatchback', 'taxi', 'police', 'van', 'pickup', 'truck', 'firetruck', 'garbage', 'ambulance', 'bus', 'racecar', 'tractor'];
// colours that hash to each realistic variant are found by trying CAR_COLORS
(async () => {
  const q = process.argv[2] === undefined ? '' : process.argv[2];
  const errors = [];
  const t0 = Date.now();
  const { browser, page } = await boot({ headless: true, viewport: { width: 640, height: 400 }, q });
  page.on('console', (m) => { if (m.type() === 'error' || /model missing|without wheel/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  try {
    await page.waitForFunction(() => window.__game && window.__game.G.state === 'menu', null, { timeout: 240000 });
    const bootMs = Date.now() - t0;
    const res = await page.evaluate(async ({ TYPES }) => {
      const G = window.__game.G;
      const A = await import('https://game.local/js/assets.js');
      const VS = await import('https://game.local/js/vehicles.js');
      const T = await import('https://game.local/js/terrain.js');
      const THREE = await import('three');
      let seed = 12345;
      Math.random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
      document.querySelector('#btn-play').click();
      window.__game.step(5, 1 / 60);
      const loaded = Object.keys(A.REAL_CARS).map((f) => [f, A.hasModel(f)]);
      const P = G.player;
      // an open, straight, flat stretch of road near the start
      let x0 = P.pos.x, z0 = P.pos.z, hd0 = P.heading || 0;
      search: for (let r = 0; r < 600; r += 10) for (let a = 0; a < Math.PI * 2; a += 10 / Math.max(r, 10)) {
        const x = P.pos.x + Math.cos(a) * r, z = P.pos.z + Math.sin(a) * r;
        const nr = T.nearestRoad(x, z);
        if (!nr || nr.d > -2.5 || T.isWater(x, z)) continue;
        const hd = Math.atan2(nr.s.dx, nr.s.dz);
        let ok = true;
        for (const k of [-8, -4, 0, 4, 8, 16, 24, 32]) {
          const px = x + Math.sin(hd) * k, pz = z + Math.cos(hd) * k;
          if (T.collideCircle(px, pz, 7, T.groundHeight(px, pz) + 0.3, 4).hit) ok = false;
          if (Math.abs(T.groundHeight(px, pz) - T.groundHeight(x, z)) > 0.4) ok = false;
        }
        if (ok) { x0 = x; z0 = z; hd0 = hd; break search; }
      }
      const out = [];
      const wp = new THREE.Vector3();
      for (const type of TYPES) {
        // every realistic variant of the type: find a colour per variant
        const files = (A.VEHICLE_MODELS[type].real || []).filter((f) => A.hasModel(f));
        const seen = new Set();
        const colours = [];
        for (const c of VS.CAR_COLORS.concat([0x123456, 0x654321, 0xabcdef, 0x777777, 0x334455])) {
          if (colours.length >= Math.max(1, files.length)) break;
          const v = VS.spawnVehicle(type, x0 + 1000, z0 + 1000, 0, c);
          const f = v.m.file || 'kenney';
          v.remove();
          if (!seen.has(f)) { seen.add(f); colours.push(c); }
        }
        for (const colour of colours) {
          for (const o of [...G.vehicles]) if (!o.persist && Math.hypot(o.pos.x - x0, o.pos.z - z0) < 120) o.remove();
          if (P.vehicle) P.exitVehicle(true);
          P.reset(x0, z0);
          const hd = hd0;
          const v = VS.spawnVehicle(type, x0, z0, hd, colour);
          P.enterVehicle(v);
          G.keys.KeyW = G.keys.KeyS = G.keys.KeyA = G.keys.KeyD = G.keys.Space = false;
          window.__game.step(60, 1 / 60); // settle 1 s
          const r = { type, file: v.m.file || 'kenney', name: v.spec.name, phys: !!v.phys };
          r.size = [v.spec.wid, v.spec.height, v.spec.len].map((n) => +n.toFixed(2));
          if (v.spec.geom) r.geom = Object.fromEntries(Object.entries(v.spec.geom).map(([k, n]) => [k, +n.toFixed(3)]));
          if (v.phys) {
            const ph = v.phys;
            r.wheelsOnGround = ph.wheelsOnGround;
            r.p = { wheelbase: +ph.p.wheelbase.toFixed(3), cgToFront: +ph.p.cgToFront.toFixed(3), trackF: +ph.p.trackF.toFixed(3), wheelRadius: +ph.p.wheelRadius.toFixed(3) };
            // visual wheels vs physics mounts, in the vehicle's body frame
            v.root.updateMatrixWorld(true);
            let maxXZ = 0, maxBottom = -1e9, minBottom = 1e9;
            for (const w of v.m.wheels) {
              w.pivot.getWorldPosition(wp);
              const local = v.root.worldToLocal(wp.clone());
              // nearest physics wheel on the same side/axle
              let best = 1e9;
              for (const pw of ph.wheels) best = Math.min(best, Math.hypot(local.x - pw.lx, local.z - pw.lz));
              maxXZ = Math.max(maxXZ, best);
              const bottom = wp.y - ph.p.wheelRadius - T.groundHeight(wp.x, wp.z, wp.y);
              maxBottom = Math.max(maxBottom, bottom); minBottom = Math.min(minBottom, bottom);
            }
            r.visualWheels = v.m.wheels.length;
            r.wheelMountErr = +maxXZ.toFixed(3);
            r.tyreGap = [+minBottom.toFixed(3), +maxBottom.toFixed(3)]; // tyre bottom above terrain (m)
          }
          // drive: 3 s throttle, steer right for the middle second
          let top = 0, maxVy = 0, nan = false, flips = 0, wheelSpin0 = v.spin;
          for (let f = 0; f < 180; f++) {
            G.keys.KeyW = true;
            G.keys.KeyD = f > 60 && f < 120;
            window.__game.step(1, 1 / 60);
            top = Math.max(top, v.speedAbs);
            maxVy = Math.max(maxVy, Math.abs(v.vy || 0));
            if (!isFinite(v.pos.x + v.pos.y + v.pos.z)) nan = true;
            if (v.phys && v.phys.isFlipped()) flips++;
          }
          G.keys.KeyW = G.keys.KeyD = false;
          r.drive = { topKmh: Math.round(top * 3.6), maxVy: +maxVy.toFixed(2), moved: +Math.hypot(v.pos.x - x0, v.pos.z - z0).toFixed(1), nan, flippedFrames: flips, wheelsSpun: Math.abs(v.spin - wheelSpin0) > 1 };
          out.push(r);
        }
      }
      return { loaded, out, spot: [x0, z0, hd0] };
    }, { TYPES });
    console.log('boot to menu:', bootMs, 'ms');
    console.log('test spot:', res.spot.map((n) => n.toFixed(1)).join(', '));
    console.log('loaded:', res.loaded.map(([f, ok]) => f + (ok ? '' : ' MISSING')).join(', '));
    for (const r of res.out) console.log(JSON.stringify(r));
    console.log('errors:', errors.length ? errors : 'none');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
