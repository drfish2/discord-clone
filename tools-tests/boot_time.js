// boot_time.js: time from page boot to the main menu (world.json + all models loaded).
// Usage: GAME_ROOT=.../public/game NORENDER=1 node tools-tests/boot_time.js [runs=3] [q=low|high]
const { boot } = require('C:/Users/munee/.zcode/workspace/default/crimson-coast/harness/harness.js');
(async () => {
  const runs = +(process.argv[2] || 3), q = process.argv[3] || 'low';
  const times = [];
  for (let i = 0; i < runs; i++) {
    const t0 = Date.now();
    const { browser, page } = await boot({ headless: true, q });
    await page.waitForFunction(() => window.__game && window.__game.G.state === 'menu', null, { timeout: 300000 });
    times.push(Date.now() - t0);
    const bytes = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /\.glb/.test(e.name)).length);
    console.log(`run ${i + 1}: ${times[i]} ms (glb requests: ${bytes})`);
    await browser.close();
  }
  times.sort((a, b) => a - b);
  console.log(`q=${q} median boot: ${times[Math.floor(times.length / 2)]} ms`);
})();
