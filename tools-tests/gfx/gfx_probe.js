// gfx_probe.js: boots a preset and evaluates an expression file in the page (debug helper).
// Usage: node gfx_probe.js <q> <file.js>   (the file's code is evaluated as an async function body)
const fs = require('fs');
const { boot } = require('C:/Users/munee/.zcode/workspace/default/crimson-coast/harness/harness.js');
(async () => {
  const { browser, page } = await boot({ headless: true, viewport: { width: +(process.env.VW || 480), height: +(process.env.VH || 300) }, q: process.argv[2] || 'high' });
  try {
    await page.waitForFunction(() => window.__game && window.__game.G.state === 'menu', null, { timeout: 300000 });
    await page.evaluate(() => document.getElementById('btn-play').click());
    await page.waitForTimeout(1500);
    const code = fs.readFileSync(process.argv[3], 'utf8');
    const r = await page.evaluate(`(async () => { ${code} })()`);
    console.log(JSON.stringify(r, null, 1));
    if (process.argv[4]) await page.screenshot({ path: process.argv[4] });
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
