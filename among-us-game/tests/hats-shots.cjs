// Contact sheet screenshots: node tests/hats-shots.cjs (server on :8111)
const { chromium } = require('playwright');
const out = __dirname + '/hats-shots/';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const shot = async (qs, name) => {
    await p.goto('http://localhost:8111/tests/hats-sheet.html?' + qs);
    await p.waitForFunction(() => window.ready);
    await p.locator('#cv').screenshot({ path: out + name });
  };
  await shot('mode=overview', 'sheet-overview.png');
  await shot('mode=detail&from=1&to=6', 'sheet-1.png');
  await shot('mode=detail&from=7&to=12', 'sheet-2.png');
  await shot('mode=detail&from=13&to=19', 'sheet-3.png');
  await shot('mode=detail&from=20&to=25', 'sheet-4.png');
  console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'ok');
  await b.close();
})();
