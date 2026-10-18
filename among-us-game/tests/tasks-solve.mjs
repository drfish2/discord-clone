// Solve every minigame with real pointer input (mouse on desktop, touch on phone) and check callbacks.
// Run: node tests/tasks-solve.mjs   (needs `npx http-server <game> -p 8094 -s` running)
import { createRequire } from 'module';
const { chromium } = createRequire('/opt/node22/lib/node_modules/')('playwright');
const PAGE = 'http://localhost:8094/tests/tasks-harness.html';
const KINDS = ['wires','swipe','download','fuel','asteroids','align','calibrate','garbage','scan','divert','leaves','numbers'];
const FIX = ['reactor','o2','lights','comms'];
const only = process.argv.slice(2);
let fails = 0, passes = 0;
function ok(cond, msg) { if (cond) { passes++; } else { fails++; console.log('  FAIL: ' + msg); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(mode) {
  const browser = await chromium.launch();
  const touch = mode === 'touch';
  const ctx = await browser.newContext(touch
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  const cdp = touch ? await ctx.newCDPSession(page) : null;

  const P = async (x, y) => page.evaluate(([x, y]) => IS.tasks._debug.toClient(x, y), [x, y]);
  const dbg = async (expr) => page.evaluate(new Function('return (' + expr + ')'));
  const down = async (p) => touch
    ? cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }] })
    : (await page.mouse.move(p.x, p.y), await page.mouse.down());
  const move = async (p) => touch
    ? cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y, id: 1 }] })
    : page.mouse.move(p.x, p.y);
  const up = async () => touch
    ? cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    : page.mouse.up();
  const tap = async (p) => { await down(p); await up(); };
  const tapL = async (x, y) => tap(await P(x, y));
  async function dragL(a, b, steps = 12, ms = 200, hold = 0) {
    const A = await P(a.x, a.y), Bc = await P(b.x, b.y);
    await down(A);
    if (!ms) { for (let i = 1; i <= steps; i++) await move({ x: A.x + (Bc.x - A.x) * i / steps, y: A.y + (Bc.y - A.y) * i / steps }); }
    else {
      const t0 = Date.now();
      for (;;) {
        const u = Math.min(1, (Date.now() - t0) / ms);
        await move({ x: A.x + (Bc.x - A.x) * u, y: A.y + (Bc.y - A.y) * u });
        if (u >= 1) break;
        await sleep(Math.max(0, ms / steps - 5));
      }
    }
    if (hold) await sleep(hold);
    await up();
  }
  const log = () => page.evaluate(() => LOG.slice());
  const clearLog = () => page.evaluate(() => { LOG.length = 0; });
  const layerEmpty = () => page.evaluate(() => document.getElementById('task-layer').children.length === 0 && !IS.tasks.isOpen());

  const solvers = {
    async wires() {
      const d = await dbg('IS.tasks._debug.state');
      for (let i = 0; i < 4; i++) await dragL(d.leftPts[i], d.rightPts[d.pairs[i]], 10, 120);
    },
    async swipe() {
      let d = await dbg('IS.tasks._debug.state');
      await tapL(d.wallet.x, d.wallet.y);
      await page.waitForFunction(() => IS.tasks._debug.state.state === 'ready');
      d = await dbg('IS.tasks._debug.state');
      const from = { x: d.card.x + d.CW / 2, y: d.card.y + d.CH / 2 };
      const to = { x: from.x + (d.END - d.START) + 20, y: from.y };
      await dragL(from, to, 4, 0);                        // way too fast
      ok(/TOO FAST/.test(await dbg('IS.tasks._debug.state.msg')), 'swipe: too fast message');
      await page.waitForFunction(() => IS.tasks._debug.state.state === 'ready');
      await dragL(from, to, 20, 2200);                    // too slow
      ok(/TOO SLOW/.test(await dbg('IS.tasks._debug.state.msg')), 'swipe: too slow message');
      await page.waitForFunction(() => IS.tasks._debug.state.state === 'ready');
      await dragL(from, to, 20, 750);                     // just right
      const dur = await dbg('IS.tasks._debug.state && IS.tasks._debug.state.lastDur');
      ok(dur == null || (dur >= 0.4 && dur <= 1.2), 'swipe: accepted duration ' + dur);
    },
    async download() {
      const d = await dbg('IS.tasks._debug.state');
      await tapL(d.button.x, d.button.y);
      await sleep(5600);
    },
    async fuel() {
      const d = await dbg('IS.tasks._debug.state');
      const b = await P(d.button.x, d.button.y);
      await down(b); await sleep(1200); await up();
      const l1 = await dbg('IS.tasks._debug.state.level');
      await sleep(500);
      const l2 = await dbg('IS.tasks._debug.state.level');
      ok(l1 > 0.25 && l1 < 0.6 && l1 === l2, `fuel: partial fill persists while released (${l1.toFixed(2)} → ${l2.toFixed(2)})`);
      await down(b); await sleep(2300); await up();
    },
    async asteroids() {
      const t0 = Date.now();
      while (Date.now() - t0 < 30000) {
        const s = await dbg('IS.tasks._debug.state && {count: IS.tasks._debug.state.count, rocks: IS.tasks._debug.state.rocks.map(r => ({x:r.x,y:r.y,vx:r.vx,vy:r.vy}))}');
        if (!s || s.count >= 15) break;
        const r = s.rocks.find(r => r.x > 50 && r.x < 450);
        if (!r) { await sleep(60); continue; }
        await tapL(r.x + r.vx * 0.02, r.y + r.vy * 0.02);
        await sleep(30);
      }
    },
    async align() {
      const d = await dbg('IS.tasks._debug.state');
      await dragL(d.handle, d.centre, 14, 300);
    },
    async calibrate() {
      // first a deliberate miss to verify reset
      await page.waitForFunction(() => { const s = IS.tasks._debug.state, a = s.angles[0]; const d = ((a + 90) % 360 + 540) % 360 - 180; return Math.abs(d) > 90; });
      let d = await dbg('IS.tasks._debug.state');
      await tapL(d.buttons[0].x, d.buttons[0].y);
      ok((await dbg('IS.tasks._debug.state.active')) === 0, 'calibrate: miss keeps row 0 active');
      for (let i = 0; i < 3; i++) {
        await page.waitForFunction((i) => { const s = IS.tasks._debug.state; const d = ((s.angles[i] + 90) % 360 + 540) % 360 - 180; return d > -14 && d < 2; }, i, { polling: 'raf' });
        await tapL(d.buttons[i].x, d.buttons[i].y);
        ok((await dbg('IS.tasks._debug.state ? IS.tasks._debug.state.active : 3')) === i + 1, 'calibrate: row ' + i + ' locked');
      }
    },
    async garbage() {
      const d = await dbg('IS.tasks._debug.state');
      await dragL(d.knob, d.bottom, 10, 200, 600);       // partial
      const p1 = await dbg('IS.tasks._debug.state.prog');
      ok(p1 > 0.1 && p1 < 0.8, 'garbage: partial progress ' + p1.toFixed(2));
      await sleep(400);
      const d2 = await dbg('IS.tasks._debug.state');
      await dragL(d2.knob, d2.bottom, 10, 200, 2200);
    },
    async scan() {
      const d = await dbg('IS.tasks._debug.state');
      await tapL(d.button.x, d.button.y);
      await sleep(10500);
    },
    async divert() {
      const d = await dbg('IS.tasks._debug.state');
      await dragL(d.handle, d.top, 12, 250);
    },
    async leaves() {
      for (let k = 0; k < 10; k++) {
        const s = await dbg('IS.tasks._debug.state && IS.tasks._debug.state.leaves.filter(l => !l.suck).map(l => ({x:l.x,y:l.y}))');
        if (!s || !s.length) break;
        const v = await dbg('IS.tasks._debug.state.vent');
        await dragL(s[0], { x: v.x + 30, y: v.y }, 12, 200);
        await sleep(50);
      }
    },
    async numbers() {
      const d = await dbg('IS.tasks._debug.state');
      const t = n => d.tiles.find(x => x.n === n);
      await tapL(t(1).x, t(1).y); await tapL(t(3).x, t(3).y);   // mistake → reset
      await sleep(700);
      for (let n = 1; n <= 10; n++) { await tapL(t(n).x, t(n).y); await sleep(40); }
    },
    async 'fix-o2'() {
      const d = await dbg('IS.tasks._debug.state');
      const wrong = d.code.split('').map(c => String((+c + 1) % 10));
      for (const k of wrong) await tapL(d.keys[k].x, d.keys[k].y);
      await tapL(d.keys.ok.x, d.keys.ok.y);
      ok((await dbg('IS.tasks._debug.state.entry')) === '', 'o2: wrong code clears entry');
      ok(!(await log()).some(l => /complete/.test(l)), 'o2: wrong code does not complete');
      await sleep(800);
      for (const k of d.code) await tapL(d.keys[k].x, d.keys[k].y);
      await tapL(d.keys.ok.x, d.keys.ok.y);
    },
    async 'fix-lights'() {
      const d = await dbg('IS.tasks._debug.state');
      for (let i = 0; i < 5; i++) if (!d.states[i]) { await tapL(d.switches[i].x, d.switches[i].y); await sleep(40); }
    },
    async 'fix-comms'() {
      const d = await dbg('IS.tasks._debug.state');
      const delta = ((d.target - d.angle) % 360 + 540) % 360 - 180;
      const R = 60, a0 = 0;
      const pts = [];
      for (let i = 0; i <= 24; i++) { const a = (a0 + delta * i / 24) * Math.PI / 180; pts.push({ x: d.knob.x + Math.cos(a) * R, y: d.knob.y + Math.sin(a) * R }); }
      const cp = []; for (const p of pts) cp.push(await P(p.x, p.y));
      await down(cp[0]);
      for (const p of cp.slice(1)) { await move(p); await sleep(15); }
      await sleep(800);
      await up();
    },
  };

  const all = [...KINDS, ...FIX.filter(f => f !== 'reactor').map(f => 'fix-' + f)];
  for (const k of all) {
    if (only.length && !only.includes(k)) continue;
    await clearLog();
    if (k.startsWith('fix-')) await page.evaluate(f => openFix(f, 1), k.slice(4)); else await page.evaluate(f => openTask(f), k);
    await page.waitForTimeout(250);
    const t0 = Date.now();
    try { await solvers[k](); } catch (e) { ok(false, k + ' solver threw ' + e.message); }
    await page.waitForTimeout(1300);
    const L = await log();
    const tag = k;
    const nComplete = L.filter(l => l === tag + ':complete').length;
    ok(nComplete === 1, `${mode} ${k}: onComplete fired exactly once (got ${nComplete}; log ${JSON.stringify(L)})`);
    ok(!L.some(l => /:close$/.test(l)), `${mode} ${k}: onClose not called on completion`);
    ok(await layerEmpty(), `${mode} ${k}: no DOM left after completion`);
    console.log(`${mode} ${k}: ${nComplete === 1 ? 'solved' : 'NOT solved'} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (nComplete !== 1) await page.screenshot({ path: new URL('./tasks-shots/fail-' + mode + '-' + k + '.png', import.meta.url).pathname });
  }

  // reactor: hold semantics + setStatus
  if (!only.length || only.includes('fix-reactor')) {
    await clearLog();
    await page.evaluate(() => openFix('reactor', 0));
    await page.waitForTimeout(200);
    const d = await dbg('IS.tasks._debug.state');
    ok(/second user/.test(d.status), 'reactor: default status text');
    const pad = await P(d.pad.x, d.pad.y);
    await down(pad); await sleep(150);
    ok(JSON.stringify(await log()) === '["fix-reactor:hold:true"]', 'reactor: onHold(true) on press ' + JSON.stringify(await log()));
    await page.evaluate(() => CTRL.setStatus('Holding…'));
    ok((await dbg('IS.tasks._debug.state.status')) === 'Holding…', 'reactor: setStatus');
    if (touch) await page.screenshot({ path: new URL('./tasks-shots/phone-fix-reactor-held.png', import.meta.url).pathname });
    else await page.screenshot({ path: new URL('./tasks-shots/desktop-fix-reactor-held.png', import.meta.url).pathname });
    await up(); await sleep(100);
    ok((await log()).join() === 'fix-reactor:hold:true,fix-reactor:hold:false', 'reactor: onHold(false) on release');
    await down(pad); await sleep(100);
    await page.evaluate(() => CTRL.close());
    await sleep(100);
    if (touch) await up(); else await page.mouse.up();
    const L = await log();
    ok(L.join() === 'fix-reactor:hold:true,fix-reactor:hold:false,fix-reactor:hold:true,fix-reactor:hold:false,fix-reactor:close', 'reactor: close while held releases then closes ' + L.join());
    ok(await layerEmpty(), 'reactor: no DOM after close');
    console.log(mode + ' fix-reactor: checked');
  }

  // close semantics (once, desktop only)
  if (!touch && !only.length) {
    for (const k of [...KINDS, ...FIX.map(f => 'fix-' + f)]) {
      for (const how of ['escape', 'api', 'button']) {
        await clearLog();
        if (k.startsWith('fix-')) await page.evaluate(f => openFix(f, 0), k.slice(4)); else await page.evaluate(f => openTask(f), k);
        await page.waitForTimeout(60);
        if (how === 'escape') await page.keyboard.press('Escape');
        else if (how === 'api') await page.evaluate(() => CTRL.close());
        else await page.click('.tk-close');
        await page.waitForTimeout(30);
        const L = (await log()).filter(l => !/hold/.test(l));
        ok(L.join() === k + ':close', `close via ${how} on ${k}: ${L.join()}`);
        ok(await layerEmpty(), `close via ${how} on ${k}: DOM cleaned`);
      }
    }
    // stale controller + replacing panels + unknown kind
    await clearLog();
    await page.evaluate(() => { window.A = IS.tasks.open('wires', {}, cbs('A')); window.B2 = IS.tasks.open('fuel', {}, cbs('B')); });
    ok((await log()).join() === 'A:close', 'opening a new panel closes the old one with onClose');
    ok(await page.evaluate(() => document.querySelectorAll('.tk-overlay').length === 1 && IS.tasks._debug.kind === 'fuel'), 'only one overlay present');
    await page.evaluate(() => A.close());
    ok((await log()).join() === 'A:close', 'stale controller close() is a no-op');
    await page.evaluate(() => B2.close());
    await page.evaluate(() => B2.close());
    ok((await log()).join() === 'A:close,B:close', 'double close only fires once');
    await page.evaluate(() => { window.U = IS.tasks.open('bogus', {}, cbs('U')); });
    ok(await page.evaluate(() => IS.tasks._debug.kind === 'download' && document.querySelector('.tk-overlay').dataset.kind === 'download'), 'unknown kind falls back to download');
    await page.evaluate(() => U.close());
    ok(await page.evaluate(() => JSON.stringify(IS.tasks.KINDS) === JSON.stringify(['wires','swipe','download','fuel','asteroids','align','calibrate','garbage','scan','divert','leaves','numbers'])), 'KINDS exact');
    ok(await page.evaluate(() => document.querySelectorAll('style#tk-style').length === 1), 'CSS injected once');
    // close during completion flourish → onComplete (not onClose)
    await clearLog();
    await page.evaluate(() => openFix('lights', 0));
    const d = await dbg('IS.tasks._debug.state');
    for (let i = 0; i < 5; i++) if (!d.states[i]) await tapL(d.switches[i].x, d.switches[i].y);
    await sleep(400);
    await page.keyboard.press('Escape');
    await sleep(900);
    ok((await log()).join() === 'fix-lights:complete', 'Escape during flourish finishes with onComplete once: ' + (await log()).join());
    ok(await layerEmpty(), 'flourish close: DOM cleaned');
    console.log('close semantics: checked');
  }
  ok(errs.length === 0, mode + ': page errors ' + errs.join('; '));
  await browser.close();
}

await run('mouse');
await run('touch');
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
