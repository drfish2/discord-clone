// World agent: screenshots + render timing. Run with
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tests/world-shots.mjs [outdir] [filter]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const out = process.argv[2] || '/tmp/world-shots';
const filter = process.argv[3] || '';
const base = 'http://localhost:8093/tests/world-harness.html';
const shots = [
  ['cafeteria', '?scene=cafeteria', 1280, 720],
  ['cafeteria_hl', '?scene=cafeteria&hl=button', 1280, 720],
  ['electrical', '?scene=electrical&hl=station', 1280, 720],
  ['reactor', '?scene=reactor&sab=1', 1280, 720],
  ['medbay', '?scene=medbay', 1280, 720],
  ['admin', '?scene=admin', 1280, 720],
  ['navigation', '?scene=navigation', 1280, 720],
  ['storage', '?scene=storage', 1280, 720],
  ['weapons', '?scene=weapons', 1280, 720],
  ['shields', '?scene=shields', 1280, 720],
  ['comms', '?scene=comms', 1280, 720],
  ['o2', '?scene=o2', 1280, 720],
  ['upper', '?scene=upper', 1280, 720],
  ['lower', '?scene=lower', 1280, 720],
  ['security', '?scene=security&role=1', 1280, 720],
  ['lights', '?scene=cafeteria&lights=1', 1280, 720],
  ['ghost', '?scene=cafeteria&ghost=1&zoom=0.8', 1280, 720],
  ['minimap', '?scene=admin&mini=1&sab=1', 1280, 720],
  ['phone', '?scene=cafeteria', 390, 844, 3],
  ['phone_land', '?scene=electrical', 844, 390, 3],
  ['assets', '?scene=cafeteria&assets=1', 1280, 720],
  ['assets_reactor', '?scene=reactor&assets=1&sab=1', 1280, 720],
];
const fs = await import('node:fs');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const [name, qs, w, h, dsf] of shots) {
  if (filter && !name.includes(filter)) continue;
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dsf || 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(base + qs + '&noloop=1');
  await page.waitForFunction(() => window.harness);
  await page.waitForTimeout(qs.includes('assets') ? 1500 : 300);
  const stats = await page.evaluate(() => {
    const t = [];
    for (let i = 0; i < 60; i++) { harness.others.forEach((o, k) => { o.x += Math.cos(i * 0.1 + k) * 2; }); t.push(harness.frame()); }
    t.sort((a, b) => a - b);
    return { first: harness.times[0], avg: t.reduce((a, b) => a + b, 0) / t.length, p95: t[Math.floor(t.length * 0.95)] };
  });
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(name.padEnd(16), `first ${stats.first.toFixed(1)}ms  avg ${stats.avg.toFixed(2)}ms  p95 ${stats.p95.toFixed(2)}ms`, errs.length ? 'ERRORS: ' + errs.join(' | ') : '');
  await page.close();
}
await browser.close();
