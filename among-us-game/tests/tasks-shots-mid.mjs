// In-progress screenshots (desktop) of several minigames.  node tests/tasks-shots-mid.mjs
import { createRequire } from 'module';
const { chromium } = createRequire('/opt/node22/lib/node_modules/')('playwright');
const OUT = new URL('./tasks-shots/', import.meta.url).pathname;
const browser = await chromium.launch();
const vp = process.argv[2] === 'phone' ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 800 } };
const tag = process.argv[2] === 'phone' ? 'phone' : 'desktop';
const page = await (await browser.newContext(vp)).newPage();
await page.goto('http://localhost:8094/tests/tasks-harness.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(500);
const P = (x, y) => page.evaluate(([x, y]) => IS.tasks._debug.toClient(x, y), [x, y]);
const S = () => page.evaluate(() => JSON.parse(JSON.stringify(IS.tasks._debug.state)));
const m = page.mouse;
async function to(x, y) { const p = await P(x, y); await m.move(p.x, p.y, { steps: 6 }); }
const shot = n => page.screenshot({ path: `${OUT}mid-${tag}-${n}.png` });
const w = ms => page.waitForTimeout(ms);
const open = k => page.evaluate(k => openTask(k), k);

await open('wires'); let d = await S();
await to(d.leftPts[0].x, d.leftPts[0].y); await m.down(); await to(d.rightPts[d.pairs[0]].x, d.rightPts[d.pairs[0]].y); await m.up();
await to(d.leftPts[2].x, d.leftPts[2].y); await m.down(); await to(250, 300); await w(100); await shot('wires'); await m.up();
await open('swipe'); d = await S(); await to(d.wallet.x, d.wallet.y); await m.down(); await m.up(); await w(700); d = await S();
await to(d.card.x + 80, d.card.y + 50); await m.down(); await to(d.card.x + 200, d.card.y + 50); await w(50); await shot('swipe'); await m.up(); await w(100); await shot('swipe-bad');
await open('download'); d = await S(); await to(d.button.x, d.button.y); await m.down(); await m.up(); await w(800); await shot('download-early'); await w(1500); await shot('download');
await open('fuel'); d = await S(); await to(d.button.x, d.button.y); await m.down(); await w(1300); await shot('fuel'); await m.up();
await open('asteroids'); await w(800); d = await S(); { const r = d.rocks[0]; await to(r.x, r.y); await m.down(); await m.up(); await w(60); await shot('asteroids'); }
await open('align'); d = await S(); await to(d.handle.x, d.handle.y); await m.down(); await to(d.centre.x, d.centre.y); await w(80); await shot('align'); await m.up();
await open('garbage'); d = await S(); await to(d.knob.x, d.knob.y); await m.down(); await to(d.bottom.x, d.bottom.y); await w(900); await shot('garbage'); await m.up();
await open('scan'); d = await S(); await to(d.button.x, d.button.y); await m.down(); await m.up(); await w(5200); await shot('scan');
await open('divert'); d = await S(); await to(d.handle.x, d.handle.y); await m.down(); await to(d.handle.x, d.handle.y - 110); await w(80); await shot('divert'); await m.up();
await open('leaves'); d = await S(); { const l = d.leaves[0]; await to(l.x, l.y); await m.down(); await to(d.vent.x + 30, d.vent.y); await m.up(); await w(150); await shot('leaves'); }
await open('numbers'); d = await S(); for (const n of [1, 2, 3]) { const t = d.tiles.find(t => t.n === n); await to(t.x, t.y); await m.down(); await m.up(); } await w(80); await shot('numbers');
await open('calibrate'); await w(100); await shot('calibrate');
await page.evaluate(() => openFix('comms', 0)); d = await S();
{ const delta = ((d.target - d.angle) % 360 + 540) % 360 - 180; await to(d.knob.x + 60, d.knob.y); await m.down(); for (let i = 1; i <= 20; i++) { const a = delta * i / 20 * Math.PI / 180; await to(d.knob.x + Math.cos(a) * 60, d.knob.y + Math.sin(a) * 60); } await w(200); await shot('comms'); await m.up(); }
await page.evaluate(() => openFix('o2', 0)); d = await S(); for (const k of d.code.slice(0, 3)) { await to(d.keys[k].x, d.keys[k].y); await m.down(); await m.up(); } await shot('o2');
await page.evaluate(() => openFix('lights', 0)); d = await S(); for (let i = 0; i < 5; i++) if (!d.states[i]) { await to(d.switches[i].x, d.switches[i].y); await m.down(); await m.up(); } await w(450); await shot('flourish');
await page.evaluate(() => openFix('reactor', 1)); d = await S(); await to(d.pad.x, d.pad.y); await m.down(); await page.evaluate(() => CTRL.setStatus('Holding… waiting for a second user')); await w(300); await shot('reactor'); await m.up();
await browser.close();
console.log('ok');
