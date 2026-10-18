// Real-game smoke test for the Polar map (served on :8101).
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tests/maps-polar-smoke.cjs [outdir]
const { chromium } = require('playwright');
const out = process.argv[2] || '/tmp/polar-smoke';
require('fs').mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(page, fn, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await page.evaluate(fn).catch(() => false)) return true; await sleep(150); }
  return false;
}
(async () => {
  const browser = await chromium.launch();
  for (const [tag, vp] of [['desk', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
    const ctx = await browser.newContext(vp.isMobile ? { viewport: { width: vp.width, height: vp.height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: vp });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto('http://localhost:8101/index.html');
    await sleep(1200);
    await page.click('text=Freeplay');
    console.log(tag, 'lobby', await waitFor(page, () => IS.client.state() && IS.client.state().phase === 'lobby'));
    await page.evaluate(() => IS.client.act('set', Object.assign({}, IS.client.state().hs.st, { map: IS.map.indexOf('polar') })));
    await sleep(600);
    await page.screenshot({ path: `${out}/${tag}-lobby.png` });
    await page.evaluate(() => IS.client.act('start'));
    console.log(tag, 'play', await waitFor(page, () => IS.client.state().phase === 'play', 20000), await page.evaluate(() => IS.map.id));
    await sleep(800);
    await page.screenshot({ path: `${out}/${tag}-play.png` });
    if (!vp.isMobile) {
      // walk west out of the office onto the snowy trail
      await page.keyboard.down('ArrowLeft'); await sleep(1800); await page.keyboard.up('ArrowLeft');
      await page.keyboard.down('ArrowUp'); await sleep(400); await page.keyboard.up('ArrowUp');
      await sleep(300);
      await page.screenshot({ path: `${out}/${tag}-walk.png` });
      await page.keyboard.press('Tab'); await sleep(600);
      await page.screenshot({ path: `${out}/${tag}-map.png` });
      await page.keyboard.press('Tab');
    }
    console.log(tag, 'errors:', errors.length ? errors.join(' | ') : 'none');
    await ctx.close();
  }
  await browser.close();
})();
