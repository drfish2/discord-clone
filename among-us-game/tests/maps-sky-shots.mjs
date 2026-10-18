// Screenshots of the Sky HQ map via tests/maps-sky-harness.html. Run with the folder served on :8102.
// node tests/maps-sky-shots.mjs [scene,scene...] [--phone] [--noassets]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const args = process.argv.slice(2);
const phone = args.includes('--phone'), noassets = args.includes('--noassets');
const list = (args.find(a => !a.startsWith('--')) || 'cafeteria,launchpad,decon,lockers,hub,lab,reactor,greenhouse,office,admin,comms,medbay,storage,balcony').split(',');
const extra = (args.find(a => a.startsWith('--q=')) || '--q=').slice(4);
const browser = await chromium.launch({ executablePath: undefined });
const vp = phone ? { width: 390, height: 844 } : { width: 1280, height: 800 };
const page = await browser.newPage({ viewport: vp, deviceScaleFactor: phone ? 2 : 1 });
const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
for (const sc of list) {
  const [name, q] = sc.split(':');
  const qs = `scene=${name}${noassets ? '' : '&assets=1'}${q ? '&' + q.replace(/\+/g, '&') : ''}${extra ? '&' + extra.replace(/\+/g, '&') : ''}`;
  await page.goto(`http://localhost:8102/tests/maps-sky-harness.html?${qs}`);
  await page.waitForTimeout(900);
  const file = `tests/maps-sky-shots/${phone ? 'phone-' : ''}${noassets ? 'na-' : ''}${sc.replace(/[:=+&]/g, '_')}.png`;
  await page.screenshot({ path: file });
  console.log(file);
}
console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
await browser.close();
