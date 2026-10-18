// Screenshot every UI screen at desktop + phone. Usage: node tests/ui-shots.mjs [filter]
const { chromium } = require('playwright');
const BASE = 'http://localhost:8095/tests/ui-harness.html';
const OUT = __dirname + '/ui-shots/';
const filter = process.argv[2] || '';
const scenes = [
  ['menu', 300], ['menu-empty', 300], ['menu-offline', 300],
  ['lobby-host', 500], ['lobby-host-settings', 500], ['lobby-guest', 500],
  ['game-crew', 300], ['game-imp', 300], ['game-ghost', 300], ['sabmenu', 400], ['map', 400],
  ['role-crew', 2200], ['role-imp', 2200],
  ['splash-body', 900], ['splash-emg', 900],
  ['meeting-discuss', 2600], ['meeting-vote', 2600], ['chat', 600], ['meeting-result', 3400],
  ['eject', 2600], ['eject-skip', 2600], ['over-win', 2200], ['over-lose', 2200],
];
const sizes = [['desk', { width: 1280, height: 800 }, false], ['phone', { width: 390, height: 844 }, true]];
(async () => {
const browser = await chromium.launch();
for (const [tag, viewport, mobile] of sizes) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', tag, e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', tag, m.text()); });
  await page.goto(BASE);
  await page.evaluate(() => window.harnessReady);
  for (const [name, wait] of scenes) {
    if (filter && !name.includes(filter) && !(filter === 'chat' && name === 'meeting-vote')) continue;
    await page.evaluate(n => window.scene(n), name);
    if (name === 'chat') await page.evaluate(() => document.querySelector('.chat-toggle').click());
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${OUT}${tag}-${name}.png` });
  }
  await ctx.close();
}
await browser.close();
console.log('done');
})();
