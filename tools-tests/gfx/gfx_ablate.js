// gfx_ablate.js: in one session, toggle graphics features one at a time and measure the frame rate
// (real GPU, headed Chromium, vsync off), so background load affects every variant alike.
// Usage: NODE_PATH=.../node_modules node gfx_ablate.js [port] [w] [h]
const { chromium } = require('playwright');
const port = process.argv[2] || '8792';
const W = +(process.argv[3] || 1600), H = +(process.argv[4] || 900);
(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', `--window-size=${W + 20},${H + 120}`] });
  try {
    const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
    page.on('pageerror', (e) => console.log('pageerror', e.message));
    await page.goto(`http://localhost:${port}/index.html?q=high`);
    await page.waitForFunction(() => window.__game && window.__game.G.state === 'menu', null, { timeout: 180000 });
    const r = await page.evaluate(async () => {
      const wait = (t) => new Promise((res) => setTimeout(res, t));
      const G = window.__game.G;
      const g = await import(location.origin + '/js/gfx.js');
      document.getElementById('menu').hidden = true;
      G.state = 'play';
      const [cx, cz, , hz, rot] = [-3985.7, -3510.2, 11.5, 13.8, -2.848];
      G.player.reset(cx + Math.sin(rot) * 25, cz + Math.cos(rot) * 25); G.camYaw = rot + Math.PI; G.dayTime = 21;
      const fps = async () => { await wait(2500); let n = 0; const t0 = performance.now(); await new Promise((res) => { const f = () => { n++; if (performance.now() - t0 < 2500) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); }); return Math.round(n / ((performance.now() - t0) / 1000)); };
      const base = JSON.parse(JSON.stringify(g.PRESETS.high));
      const variants = {
        high: {}, noPost: { post: false }, noShadow: { shadow: 0 }, shadow2k: { shadow: 2048 }, noEnv: { env: false }, noLampLights: { lampLights: 0 }, noMSAA: { msaa: 0 }, ao: { ao: true }, pr075: { pr: 0.75 }, low: null,
      };
      const out = {};
      for (let rep = 0; rep < 3; rep++) for (const [k, v] of Object.entries(variants)) {
        G.state = 'play';
        if (v === null) g.applyPreset('low');
        else { Object.assign(g.PRESETS.high, base, v); g.applyPreset('high'); }
        (out[k] = out[k] || []).push(await fps());
      }
      return out;
    });
    console.log(JSON.stringify(r));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
