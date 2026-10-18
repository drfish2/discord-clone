// node tests/hats-world.cjs (server on :8111)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1000, height: 640 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8111/tests/hats-world.html');
  await p.waitForFunction(() => window.ready);
  await p.evaluate(() => draw(1.3));
  await p.screenshot({ path: __dirname + '/hats-shots/world-a.png' });
  await p.evaluate(() => draw(1.62));
  await p.screenshot({ path: __dirname + '/hats-shots/world-b.png' });
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'ok');
  await b.close();
})();
