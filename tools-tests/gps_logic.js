// gps_logic.js: assertion tests for GPS tracking (headless, NORENDER).
//  1. A* timing (cross-island routes)
//  2. re-plan when the player strays > 35 m from the route
//  3. distance falls continuously while moving along the route (10 m steps, mid-segment too)
//  4. arriving at the waypoint clears it
//  5. no waypoint + active mission objective => auto-route to the objective
// Usage: NORENDER=1 GAME_ROOT=C:/Users/munee/cc-agents/gps/public/game node gps_logic.js
const { boot } = require('C:/Users/munee/.zcode/workspace/default/crimson-coast/harness/harness.js');

(async () => {
  const { browser, page } = await boot({ headless: true });
  await page.waitForFunction(() => window.__game && window.__game.G.state === 'menu', null, { timeout: 180000 });
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__game.G.state === 'play', null, { timeout: 60000 });

  const res = await page.evaluate(async () => {
    const H = await import('https://game.local/js/hud.js');
    const T = await import('https://game.local/js/terrain.js');
    const S = await import('https://game.local/js/gps.js');
    const G = window.__game.G, P = G.player;
    const step = (n = 1) => window.__game.step(n, 1 / 30);
    const out = { checks: [], info: {} };
    const check = (name, ok, detail) => out.checks.push({ name, ok: !!ok, detail });
    const tp = (x, z) => P.reset(x, z);

    // ---- 1. A* timing: 20 random cross-island pairs (> 6 km apart)
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    const pairs = [];
    while (pairs.length < 20) {
      const a = T.nodes[Math.floor(rnd() * T.nodes.length)], b = T.nodes[Math.floor(rnd() * T.nodes.length)];
      if (Math.hypot(a.x - b.x, a.z - b.z) > 6000) pairs.push([a, b]);
    }
    S.route(pairs[0][0], pairs[0][1]); // warm up
    const times = []; let found = 0;
    for (const [a, b] of pairs) { const t0 = performance.now(); const r = S.route(a, b); times.push(performance.now() - t0); if (r) found++; }
    times.sort((x, y) => x - y);
    out.info.astar = { nodes: T.nodes.length, pairs: pairs.length, found, medianMs: +times[10].toFixed(1), maxMs: +times[19].toFixed(1) };
    check('A* cross-island median < 60 ms', times[10] < 60, out.info.astar);

    // pick a start road node near the player and a waypoint ~1.5 km away
    const p0 = P.pos;
    const start = S.nodeNear(p0.x, p0.z);
    let wpN = null, bd = Infinity;
    for (const nd of T.nodes) { const d = Math.abs(Math.hypot(nd.x - start.x, nd.z - start.z) - 1500); if (d < bd) { bd = d; wpN = nd; } }
    tp(start.x, start.z); step(2);
    H.setWaypoint(wpN.x, wpN.z); step(2);
    check('route exists after setWaypoint', H.GPS.path && H.GPS.path.length > 1, { nodes: H.GPS.path && H.GPS.path.length, dist: Math.round(H.GPS.dist) });
    const fullPath = H.GPS.path.slice();

    // ---- 3. distance tracking: walk along the route polyline in 10 m steps
    const pts = [];
    for (let k = 0; k < fullPath.length - 1 && pts.length < 60; k++) {
      const a = fullPath[k], b = fullPath[k + 1], L = Math.hypot(b.x - a.x, b.z - a.z);
      for (let s = 0; s < L; s += 10) pts.push({ x: a.x + (b.x - a.x) * s / L, z: a.z + (b.z - a.z) * s / L });
    }
    const dists = [];
    for (const q of pts) { tp(q.x, q.z); step(1); dists.push(H.GPS.dist); }
    // actual travelled distance along the polyline between samples
    let travelled = 0;
    for (let i = 1; i < pts.length; i++) travelled += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    let flat = 0, rises = 0;
    const totalDrop = dists[0] - dists[dists.length - 1];
    for (let i = 1; i < dists.length; i++) {
      const step_ = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      const dd = dists[i - 1] - dists[i];
      if (step_ > 4 && dd < 1) flat++;
      if (dd < -2) rises++;
    }
    out.info.track = { samples: dists.length, travelled: Math.round(travelled), drop: Math.round(totalDrop), flatSteps: flat, rises, first: dists.slice(0, 10).map(Math.round) };
    check('distance falls on every step (no flat steps)', flat === 0, out.info.track);
    check('distance never rises while on route', rises === 0, out.info.track);
    check('distance drop matches travelled (+-10%)', Math.abs(totalDrop - travelled) < travelled * 0.1, out.info.track);

    // ---- 2. re-plan on stray: teleport onto a road node 60-150 m off the route
    const cur = H.GPS.path;
    let off = null;
    for (const nd of T.nodes) {
      const dn = Math.hypot(nd.x - P.pos.x, nd.z - P.pos.z);
      if (dn > 250) continue;
      const d = S.distToPath(cur, nd.x, nd.z).d;
      if (d > 60 && d < 150) { off = nd; break; }
    }
    check('found an off-route test node', off, off && { x: off.x, z: off.z });
    if (off) {
      tp(off.x, off.z);
      step(1);
      const dImmediately = S.distToPath(cur, off.x, off.z).d; // distance from the old route
      step(45); // 1.5 s: re-plan check runs at most once per second
      const after = H.GPS.path;
      const dAfter = S.distToPath(after, off.x, off.z).d;
      out.info.replan = { offRouteBy: Math.round(dImmediately), afterRouteDist: Math.round(dAfter), firstNodeDist: Math.round(Math.hypot(after[0].x - off.x, after[0].z - off.z)), dist: Math.round(H.GPS.dist) };
      check('re-plans after straying > 35 m (within 1.5 s)', dImmediately > 35 && dAfter < 35, out.info.replan);
    }

    // small stray (< 35 m) keeps the route (it should not jump to a different road)
    {
      const pth = H.GPS.path, mid = pth[Math.min(3, pth.length - 1)];
      tp(mid.x + 12, mid.z); step(45);
      const d = S.distToPath(H.GPS.path, P.pos.x, P.pos.z).d;
      check('small stray (< 35 m) stays on route', d < 35, { d: Math.round(d) });
    }

    // ---- 4. arrival clears the waypoint
    tp(wpN.x + 10, wpN.z); step(2);
    check('arrival clears waypoint and route', H.GPS.wp === null && H.GPS.path === null, { wp: H.GPS.wp, path: !!H.GPS.path });

    // ---- 5. mission auto-route (no waypoint): walk onto a mission giver
    const givers = H.blips.filter((b) => b.shape === 'sq' && b.size === 5 && b.color === '#ffd23f');
    out.info.givers = givers.map((b) => [Math.round(b.x), Math.round(b.z)]);
    let started = null;
    for (const gv of givers.slice().reverse()) {
      tp(gv.x, gv.z); step(4 * 30); // mission cooldown mT is 3 s
      started = H.blips.find((b) => b.gps && !b.hidden);
      if (started) break;
    }
    check('a mission started and exposes a gps blip', started, started && { x: Math.round(started.x), z: Math.round(started.z) });
    if (started) {
      step(2);
      const ok = H.GPS.wp === null && H.GPS.path && H.GPS.target === started;
      const end = H.GPS.path && H.GPS.path[H.GPS.path.length - 1];
      out.info.mission = { pathNodes: H.GPS.path && H.GPS.path.length, dist: Math.round(H.GPS.dist), endToTarget: end && Math.round(Math.hypot(end.x - started.x, end.z - started.z)), objective: document.getElementById('objective').textContent };
      check('mission objective auto-routes with no waypoint', ok, out.info.mission);
      // a player waypoint overrides the mission route, clearing it returns to the mission
      H.setWaypoint(wpN.x, wpN.z); step(2);
      const wpOverride = H.GPS.target === H.GPS.wp;
      H.setWaypoint(null); step(2);
      check('waypoint overrides mission, clearing it returns to mission', wpOverride && H.GPS.target === started, {});
    }
    return out;
  });

  console.log(JSON.stringify(res.info, null, 1));
  let fails = 0;
  for (const c of res.checks) { console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + (c.ok ? '' : '  ' + JSON.stringify(c.detail))); if (!c.ok) fails++; }
  console.log(`${res.checks.length - fails}/${res.checks.length} passed`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
