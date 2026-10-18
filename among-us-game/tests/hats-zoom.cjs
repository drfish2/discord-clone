// node tests/hats-zoom.cjs 6,8,13,16 name.png  (server on :8111)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1300, height: 500 } });
  await p.goto('http://localhost:8111/tests/hats-sheet.html?mode=zoom&hats=' + (process.argv[2] || '6,8,13,16'));
  await p.waitForFunction(() => window.ready);
  await p.locator('#cv').screenshot({ path: __dirname + '/hats-shots/' + (process.argv[3] || 'zoom.png') });
  await b.close();
})();
