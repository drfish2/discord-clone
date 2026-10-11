// gfx_perf.js: real-GPU frame rate per graphics preset (headed Chromium, vsync and the frame cap off).
// Serve the game first:  GAME_ROOT=.../public/game node harness/serve.js 8792
// Usage: NODE_PATH=.../node_modules node gfx_perf.js [port] [presets] [w] [h]
//   presets: comma list, e.g. low,medium,high,ultra  ('default' = no ?q=); 'PORT:q' targets another server
// Starts play from script (no pointer lock), visits three spots at noon and night, 3 s each.
const { chromium } = require('playwright');
const port = process.argv[2] || '8792';
const presets = (process.argv[3] || 'low,medium,high,ultra').split(',');
const W = +(process.argv[4] || 1600), H = +(process.argv[5] || 900);

(async () => {
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--ignore-gpu-blocklist', `--window-size=${W + 20},${H + 120}`],
  });
  const results = {};
  try {
    for (const q of presets) {
      const context = await browser.newContext({ viewport: { width: W, height: H } });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      const t0 = Date.now();
      const [pp, qq] = q.includes(':') ? q.split(':') : [port, q];
      await page.goto(`http://localhost:${pp}/index.html${qq === 'default' ? '' : '?q=' + qq}`);
      await page.waitForFunction(() => window.__game && window.__game.G.state === 'menu', null, { timeout: 180000 });
      const bootMs = Date.now() - t0;
      const r = await page.evaluate(async () => {
        const wait = (t) => new Promise((res) => setTimeout(res, t));
        const G = window.__game.G;
        document.getElementById('menu').hidden = true;
        document.getElementById('hud').hidden = false;
        G.state = 'play'; // no pointer lock
        const T = await import(location.origin + '/js/terrain.js');
        const [cx, cz, , hz, rot] = [35.7, 2994.4, 7, 6.3, 0.811];
        const u = T.beachProps.find((b) => b.type === 'umbrella');
        const spots = {
          street: [cx + Math.sin(rot) * (hz + 7), cz + Math.cos(rot) * (hz + 7), rot + Math.PI * 0.72],
          beach: [u.x, u.z, 0],
          downtown: [-3985.7 + Math.sin(-2.848) * 25, -3510.2 + Math.cos(-2.848) * 25, -2.848 + Math.PI],
        };
        const fps = async () => {
          const ts = [];
          await new Promise((res) => { const f = (t) => { ts.push(t); if (t - ts[0] < 3000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
          const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
          return { avg: Math.round((ts.length - 1) / ((ts[ts.length - 1] - ts[0]) / 1000)), p95ms: +d[Math.floor(d.length * 0.95)].toFixed(1) };
        };
        const out = { pr: G.renderer.getPixelRatio(), preset: G.gfxPreset || null };
        for (const [k, s] of Object.entries(spots)) for (const t of [13, 22]) {
          G.player.reset(s[0], s[1]); G.camYaw = s[2]; G.dayTime = t; G.state = 'play'; document.getElementById('pause').hidden = true;
          await wait(1500);
          out[`${k}_${t}`] = await fps();
          out[`${k}_${t}`].calls = G.renderer.info.render.calls;
        }
        out.gl = (() => { const gl = G.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; })();
        return out;
      });
      results[q] = { bootMs, ...r, errors };
      console.log(q, JSON.stringify(results[q]));
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
