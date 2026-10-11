const { boot } = require('C:/Users/munee/.zcode/workspace/default/crimson-coast/harness/harness.js');
(async () => {
  const { browser, page } = await boot({ headless: true, q: 'low' });
  try {
    await page.waitForFunction(() => window.__game && window.__game.G.state === 'menu', null, { timeout: 300000 });
    const r = await page.evaluate(async (code) => eval(code), process.argv[2]);
    console.log(JSON.stringify(r, null, 1));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
