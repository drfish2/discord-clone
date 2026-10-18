// Polar map screenshots. NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tests/maps-polar-shots.mjs [outdir] [filter]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const out = process.argv[2] || '/tmp/polar-shots';
const filter = process.argv[3] || '';
const base = 'http://localhost:8101/tests/maps-polar-harness.html';
const rooms = ['office', 'admin', 'comms', 'dropship', 'weapons', 'o2', 'observatory', 'electrical', 'yard', 'field', 'seismic', 'storage', 'medbay', 'lab', 'drill', 'specimen', 'trail'];
const shots = rooms.map(r => [r, `?scene=${r}&ghost=1&zoom=0.75`, 1280, 800]);
shots.push(['dark_office', '?scene=office', 1280, 800], ['dark_yard', '?scene=yard', 1280, 800], ['dark_field', '?scene=field&hl=station', 1280, 800],
  ['lights_seismic', '?scene=seismic&lights=1&sab=1', 1280, 800], ['minimap', '?scene=office&mini=1&sab=1', 1280, 800],
  ['phone', '?scene=office', 390, 844, 3], ['phone_dropship', '?scene=dropship&ghost=1', 390, 844, 3], ['phone_mini', '?scene=lab&mini=1', 390, 844, 3],
  ['noassets_office', '?scene=office&assets=0&ghost=1&zoom=0.75', 1280, 800]);
const fs = await import('node:fs');
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const [name, qs, w, h, dsf] of shots) {
  if (filter && !filter.split(',').some(f => name.includes(f))) continue;
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dsf || 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(base + qs + '&noloop=1');
  await page.waitForFunction(() => window.harness);
  await page.waitForTimeout(1200);
  const ms = await page.evaluate(() => { let t = 0; for (let i = 0; i < 20; i++) t += harness.frame(); return t / 20; });
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(name.padEnd(16), ms.toFixed(2) + 'ms', errs.length ? 'ERRORS: ' + errs.join(' | ') : '');
  await page.close();
}
await browser.close();
