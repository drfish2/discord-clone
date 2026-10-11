// art_shots.js: street-level screenshots in every district (player in frame for scale), day and
// night, plus high aerial views, boot time, a rough frame time and console errors.
// Usage: GAME_ROOT=.../public/game NODE_PATH=.../node_modules node art_shots.js <tag> [q]
//   env ONLY=name,name   only these scenes (names from scenes.json, or aerial names)
//   env TIMES=13,22      hours to shoot (default both)   env NOAERIAL=1 skip aerials
const path = require('path');
const fs = require('fs');
const { boot } = require('C:/Users/munee/.zcode/workspace/default/crimson-coast/harness/harness.js');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const tag = process.argv[2] || 'shot';
const q = process.argv[3] || null;
const SCENES = JSON.parse(fs.readFileSync(path.join(__dirname, 'scenes.json'), 'utf8'));
const TIMES = (process.env.TIMES || '13,22').split(',').map(Number);
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
// [name, camera position, look-at]
const AERIALS = [
  ['air_downtown', [-1300, 420, -2100], [-2300, 0, -3000]],
  ['air_west', [-2600, 700, -600], [-3600, 0, -2600]],
  ['air_coral', [1500, 380, 2000], [900, 0, 2900]],
  ['air_east', [2200, 650, -200], [3900, 0, 1800]],
  ['air_south', [-1600, 600, 1400], [-2700, 0, 2900]],
];

// landmarks: [name, landmark type (terrain.js LANDMARKS) or 'crimson', index, camera offset
// (x, y above ground, z; in the landmark's own frame when it has a rotation), look-at height, hour]
const LANDMARKS = [
  ['lm_crimson', 'crimson', 0, [330, 90, 260], 120, 15],
  ['lm_crimson_night', 'crimson', 0, [330, 90, 260], 120, 22],
  ['lm_pier', 'pier', 0, [60, 10, -150], 16, 16],
  ['lm_pier_night', 'pier', 0, [60, 10, -150], 16, 22],
  ['lm_sign', 'hillsign', 0, [0, 30, 320], 9, 15],
  ['lm_sign_night', 'hillsign', 0, [0, 30, 320], 9, 22],
  ['lm_lighthouse', 'lighthouse', 0, [70, 15, 70], 18, 14],
  ['lm_lighthouse_night', 'lighthouse', 0, [140, 40, 140], 18, 22],
  ['lm_port', 'crane', 0, [-130, 40, -60], 25, 14],
  ['lm_port2', 'crane', 2, [-130, 40, -60], 25, 14],
  ['lm_harbour', 'crane', 5, [120, 35, -60], 20, 15],
  ['lm_tower_north', 'watertower', 0, [60, 12, 50], 22, 14],
  ['lm_tower_desert', 'watertower', 1, [-60, 10, 50], 20, 17],
  ['lm_lift', 'chairlift', 0, [380, 120, 160], 60, 13],
  ['lm_kingsbay', 'tank', 0, [70, 45, 60], 25, 15],
  ['lm_eastgate_night', 'eastgate', 0, [0, 30, 90], 30, 22],
];

(async () => {
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
    await page.addStyleTag({ content: '#help{display:none!important}' });
    await page.evaluate(() => import('./js/camera.js').then((m) => m.cycleZoom())); // wider third-person view
    await page.evaluate(() => {
      const G = window.__game.G, r = G.renderer;
      if (!r.__orig) { r.__orig = r.render.bind(r); r.render = (s, c) => { if (window.__cam) { c.position.set(...window.__cam[0]); c.lookAt(...window.__cam[1]); c.updateMatrixWorld(); } r.__orig(s, c); }; }
    });
    const shoot = async (file) => {
      await page.evaluate(() => window.__game.step(18, 1 / 30)); // > 0.4 s so tile culling refreshes after a teleport
      await page.waitForTimeout(2000);
      await page.screenshot({ path: path.join(OUT, file) });
      console.log('saved', file);
    };
    for (const sc of SCENES) {
      if (ONLY && !ONLY.includes(sc.name)) continue;
      for (const time of TIMES) {
        const zone = await page.evaluate(({ lot, time }) => {
          const G = window.__game.G;
          const [cx, cz, hx, hz, rot] = lot;
          const fx = Math.sin(rot), fz = Math.cos(rot);
          const d = hz + 8;
          const x = cx + fx * d + Math.cos(rot) * 4, z = cz + fz * d - Math.sin(rot) * 4;
          G.player.reset(x, z);
          G.camYaw = rot + Math.PI * 0.75;
          G.camPitch = 0.1;
          G.dayTime = time;
          window.__cam = null;
          return document.querySelector('#zone, .zone') ? document.querySelector('#zone, .zone').textContent : '';
        }, { lot: sc.lot, time });
        await shoot(`${tag}_${sc.name}_${time < 18 ? 'day' : 'night'}.png`);
        if (zone) console.log('  zone:', zone);
      }
    }
    if (!process.env.NOAERIAL) for (const [name, pos, at] of AERIALS) {
      if (ONLY && !ONLY.includes(name)) continue;
      await page.evaluate(({ pos, at }) => {
        const G = window.__game.G;
        G.player.reset(at[0], at[2]);
        G.dayTime = 15;
        window.__cam = [pos, at];
      }, { pos, at });
      await shoot(`${tag}_${name}.png`);
    }
    for (const [name, cx, cz, off, lookDy, hour] of LANDMARKS) {
      if (!ONLY || !ONLY.includes(name)) continue; // landmarks only on request
      await page.evaluate(async ({ cx, cz, off, lookDy, hour }) => {
        const T = await import('./js/terrain.js');
        const G = window.__game.G;
        {
          let L = null;
          if (cx === 'crimson') { const k = T.kit.find((o) => o.beacon); L = { x: k.x, z: k.z }; }
          else if (cx === 'tank') { const k = T.kit.filter((o) => o.tank)[cz]; L = { x: k.x, z: k.z }; }
          else if (cx === 'eastgate') { const sg = T.signs.find((o) => o.text === 'EASTGATE'); L = sg ? { x: sg.x, z: sg.z, rot: sg.rot } : { x: 2812, z: 262 }; }
          else {
            L = T.LANDMARKS.filter((l) => l.type === cx)[cz] || T.LANDMARKS.filter((l) => l.type === cx)[0];
            if (cx === 'chairlift') { const p = L.pylons[Math.floor(L.pylons.length / 2)]; L = { x: p.x, z: p.z }; }
            if (cx === 'pier') L = { x: L.wc.x, z: L.wc.z, rot: L.rot };
          }
          if (L.rot !== undefined && cx !== 'crane') {
            const fx = Math.sin(L.rot), fz = Math.cos(L.rot);
            off = [fx * off[2] + Math.cos(L.rot) * off[0], off[1], fz * off[2] - Math.sin(L.rot) * off[0]];
          }
          cx = L.x; cz = L.z;
        }
        const h = Math.max(0, T.terrainHeight(cx, cz));
        G.player.reset(cx + off[0] * 0.5, cz + off[2] * 0.5);
        G.dayTime = hour;
        window.__cam = [[cx + off[0], h + off[1], cz + off[2]], [cx, h + lookDy, cz]];
      }, { cx, cz, off, lookDy, hour });
      await shoot(`${tag}_${name}.png`);
    }
    const ft = await page.evaluate(() => {
      const G = window.__game.G;
      window.__cam = null;
      G.dayTime = 13;
      const gl = G.renderer.getContext(), px = new Uint8Array(4);
      const one = () => { G.renderer.render(G.scene, G.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
      one();
      const t1 = performance.now();
      for (let i = 0; i < 5; i++) one();
      const r = G.renderer.info;
      return { frameMs: Math.round((performance.now() - t1) / 5), calls: r.render.calls, tris: r.render.triangles };
    });
    console.log(JSON.stringify({ tag, q, bootMs, ...ft, errors }));
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
