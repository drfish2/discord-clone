// drive_test.js — before/after metric for the driving-bumps fix (fix/driving-bumps).
//
// Boots the game headless (kit harness), seeds Math.random so both runs see the
// same world behaviour, then drives a sports car THROUGH the worst
// terrain-through-road bumps measured on the UNFIXED build
// (tools-tests/bump_points.json, 40 points, baseline delta 0.4–4.9 m).
// For each bump: place the car 22 m back along the road, aligned with the
// segment, and hold W for 3 simulated seconds (dt = 1/60) — same geometry and
// inputs before and after, so the comparison is bump-response vs bump-response.
//
// Metrics (on the player's vehicle body):
//   - max |vertical velocity| (v.vy), count of |vy| > 2 m/s spikes
//   - max single-step |delta y|
//   - airborne time
//   - pass rate (did the car get past the bump within 3 s)
//   - mean top speed per section (did it keep driving)
//
// Usage: node drive_test.js [secondsPerSection=3]

const { boot } = require('C:/Users/munee/.zcode/workspace/default/crimson-coast/harness/harness.js');
const fs = require('fs');
const path = require('path');

(async () => {
  const secs = parseFloat(process.argv[2] || "4");
  const pts = JSON.parse(fs.readFileSync(path.join(__dirname, 'bump_points.json'), 'utf8'));
  const { browser, page } = await boot({ headless: true });
  await page.waitForFunction(() => window.__game && window.__game.G.state === 'menu', null, { timeout: 180000 });

  const result = await page.evaluate(async ({ pts, secs }) => {
    const G = window.__game.G;
    const T = await import('https://game.local/js/terrain.js');
    const VS = await import('https://game.local/js/vehicles.js');

    // deterministic traffic/ped behaviour for comparable before/after runs
    let seed = 20241010 >>> 0;
    Math.random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    // start the game like a user would (sets G.state = 'play')
    try { document.querySelector('#btn-play').click(); } catch (e) { /* headless */ }

    const P = G.player;
    // one car for the whole run, re-placed per section
    let v = null;
    const sections = [];

    for (let si = 0; si < pts.length; si++) {
      const p = pts[si];
      // start 22 m back along the road, aligned with the segment
      const x0 = p.x - p.dx * 22, z0 = p.z - p.dz * 22;
      if (!v) {
        P.reset(x0, z0);
        v = VS.spawnVehicle('sports', x0, z0, p.hd);
        P.enterVehicle(v);
      }
      // clear nearby traffic so sections measure the bump, not a fender bender
      for (const o of [...G.vehicles]) if (o !== v && !o.persist && Math.hypot(o.pos.x - x0, o.pos.z - z0) < 60) o.remove();
      // place + reset
      const y0 = T.groundHeight(x0, z0) + 0.05;
      v.pos.set(x0, y0, z0);
      v.vel.set(0, 0, 0);
      v.vy = 0;
      v.heading = p.hd;
      v.pitch = 0; v.roll = 0;
      if (v.phys) v.phys.reset(x0, y0, z0, p.hd);
      v.snapSync();
      G.keys.KeyW = true; G.keys.KeyS = false; G.keys.KeyA = false; G.keys.KeyD = false; G.keys.Space = false;

      const frames = Math.round(secs * 60);
      let maxAbsVy = 0, maxVyUp = 0, spikes = 0, maxDy = 0, airT = 0, topSpeed = 0;
      let prevY = v.pos.y, movedMax = 0;
      for (let f = 0; f < frames; f++) {
        // gentle steer toward the segment heading so mild road curves don't dump the
        // car off the edge — identical policy before/after.
        // NOTE: in this game KeyD turns the car toward DECREASING heading (steer + =
        // right = -X when facing +Z), so the key mapping is inverted vs the sign of
        // wrap(want - heading). Verified empirically.
        G.keys.KeyA = false; G.keys.KeyD = false;
        const wrap = (d) => (((d + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        const diff = wrap(p.hd - v.heading);
        if (diff > 0.05) G.keys.KeyA = true;
        else if (diff < -0.05) G.keys.KeyD = true;
        G.keys.KeyW = true;
        window.__game.step(1, 1 / 60);
        const ay = Math.abs(v.vy || 0);
        if (ay > maxAbsVy) maxAbsVy = ay;
        if ((v.vy || 0) > maxVyUp) maxVyUp = v.vy;
        if (ay > 2) spikes++;
        topSpeed = Math.max(topSpeed, Math.abs(v.speedAbs));
        const dy = Math.abs(v.pos.y - prevY);
        if (dy > maxDy) maxDy = dy;
        prevY = v.pos.y;
        if (v.onGround === false) airT += 1 / 60;
        movedMax = Math.max(movedMax, Math.hypot(v.pos.x - x0, v.pos.z - z0));
      }
      sections.push({
        i: si, d: p.d, x: p.x, z: p.z,
        maxAbsVy: +maxAbsVy.toFixed(2), maxVyUp: +maxVyUp.toFixed(2), spikes, maxDy: +maxDy.toFixed(3),
        air: +airT.toFixed(2), passed: movedMax > 24,
        topKmh: Math.round(topSpeed * 3.6),
        endY: +v.pos.y.toFixed(1), stuck: Math.abs(v.speedAbs) < 0.5,
      });
    }

    const agg = (key) => sections.reduce((a, s) => a + s[key], 0);
    return {
      sections: sections.length,
      maxAbsVy: +Math.max(...sections.map((s) => s.maxAbsVy)).toFixed(2),
      maxVyUp: +Math.max(...sections.map((s) => s.maxVyUp)).toFixed(2),
      spikesOver2ms: agg('spikes'),
      maxStepDy: +Math.max(...sections.map((s) => s.maxDy)).toFixed(3),
      airTime: +agg('air').toFixed(2),
      sectionsWithAir: sections.filter((s) => s.air > 0.05).length,
      passed: sections.filter((s) => s.passed).length,
      stuckAtEnd: sections.filter((s) => s.stuck).length,
      meanTopKmh: Math.round(sections.reduce((a, s) => a + s.topKmh, 0) / sections.length),
      worst: sections.slice().sort((a, b) => b.maxVyUp - a.maxVyUp).slice(0, 8),
    };
  }, { pts, secs });

  console.log(JSON.stringify(result, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
