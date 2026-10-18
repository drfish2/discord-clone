// Screenshot every minigame at desktop + phone size.  node tests/tasks-shots.mjs [kind...]
import { createRequire } from 'module';
const { chromium } = createRequire('/opt/node22/lib/node_modules/')('playwright');
const PAGE = 'http://localhost:8094/tests/tasks-harness.html';
const OUT = new URL('./tasks-shots/', import.meta.url).pathname;
const KINDS = ['wires','swipe','download','fuel','asteroids','align','calibrate','garbage','scan','divert','leaves','numbers'];
const FIX = ['reactor','o2','lights','comms'];
const only = process.argv.slice(2);
const browser = await chromium.launch();
const errors = [];
for (const [tag, vp, mobile] of [['desktop', {width:1280,height:800}, false], ['phone', {width:390,height:844}, true]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(tag + ': ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_/.test(m.text())) errors.push(tag + ' console: ' + m.text()); });
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  for (const k of [...KINDS, ...FIX.map(f => 'fix-' + f)]) {
    if (only.length && !only.includes(k)) continue;
    if (k.startsWith('fix-')) await page.evaluate(f => openFix(f, 0), k.slice(4));
    else await page.evaluate(f => openTask(f), k);
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${OUT}${tag}-${k}.png` });
  }
  await ctx.close();
}
await browser.close();
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
