// gps_visual.js: screenshot the GPS route on the HUD radar and on the full map.
// Boots WITH rendering (small viewport), sets a waypoint ~1.5 km away on a road,
// steps the sim, then saves tools-tests/gps/radar.png, radar_crop.png, map.png.
// Usage: GAME_ROOT=C:/Users/munee/cc-agents/gps/public/game node gps_visual.js
const path = require('path');
const { boot } = require('C:/Users/munee/.zcode/workspace/default/crimson-coast/harness/harness.js');
const OUT = path.join(__dirname, 'gps');

(async () => {
  const { browser, page } = await boot({ headless: true, viewport: { width: 640, height: 400 }, q: 'low' });
  await page.waitForFunction(() => window.__game && window.__game.G.state === 'menu', null, { timeout: 180000 });
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__game.G.state === 'play', null, { timeout: 60000 });
  await page.evaluate(() => window.__game.step(20, 1 / 30));

  const info = await page.evaluate(async () => {
    const H = await import('https://game.local/js/hud.js');
    const T = await import('https://game.local/js/terrain.js');
    const p = window.__game.G.player.pos;
    // road node closest to 1500 m away from the player
    let best = null, bd = Infinity;
    for (const nd of T.nodes) {
      const d = Math.abs(Math.hypot(nd.x - p.x, nd.z - p.z) - 1500);
      if (d < bd) { bd = d; best = nd; }
    }
    H.setWaypoint(best.x, best.z);
    window.__game.step(5, 1 / 30);
    return { player: [Math.round(p.x), Math.round(p.z)], wp: [best.x, best.z], straight: Math.round(Math.hypot(best.x - p.x, best.z - p.z)),
      pathNodes: H.GPS.path && H.GPS.path.length, dist: Math.round(H.GPS.dist) };
  });
  console.log('waypoint:', JSON.stringify(info));
  if (!info.pathNodes) throw new Error('no GPS path');

  await page.waitForTimeout(1500); // let a few real frames draw the radar
  await page.screenshot({ path: path.join(OUT, 'radar.png') });
  const box = await page.locator('#radar').boundingBox();
  await page.screenshot({ path: path.join(OUT, 'radar_crop.png'), clip: { x: box.x - 4, y: box.y - 4, width: box.width + 8, height: box.height + 8 } });

  await page.keyboard.press('KeyM');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, 'map.png') });
  const mapOpen = await page.evaluate(() => !document.getElementById('bigmap').parentElement.hidden);
  console.log('map open:', mapOpen);
  await page.keyboard.press('Escape');
  console.log('saved', OUT);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
