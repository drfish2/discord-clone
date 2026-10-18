// Smoke test: real index.html with all modules; freeplay flow through the UI. node tests/ui-smoke.cjs
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const out = __dirname + '/ui-shots/';
  for (const [tag, vp, mob] of [['desk', { width: 1280, height: 800 }, false], ['phone', { width: 390, height: 844 }, true]]) {
    const ctx = await b.newContext({ viewport: vp, isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 2 : 1 });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push('pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await p.goto('http://localhost:8095/index.html');
    await p.waitForTimeout(2500);
    await p.screenshot({ path: out + tag + '-real-menu.png' });
    console.log(tag, 'status:', await p.textContent('.status'));
    await p.click('text=Freeplay');
    await p.waitForTimeout(2500);
    await p.screenshot({ path: out + tag + '-real-after-freeplay.png' });
    console.log(tag, 'screens on:', await p.evaluate(() => [...document.querySelectorAll('.screen.on, .ov.on')].map(e => e.className).join(' | ')));
    await p.waitForTimeout(4000);
    await p.screenshot({ path: out + tag + '-real-play.png' });
    console.log(tag, 'after 4s:', await p.evaluate(() => [...document.querySelectorAll('.screen.on, .ov.on')].map(e => e.className).join(' | ')));
    console.log(tag, 'errors:', errs.length ? errs.join('\n  ') : 'none');
    await ctx.close();
  }
  await b.close();
})();
