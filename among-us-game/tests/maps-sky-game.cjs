// Real-game smoke for the Sky HQ map: index.html -> Freeplay -> lobby -> set map 'sky' -> Start -> play.
// Run with the folder served on :8102: NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tests/maps-sky-game.cjs
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const out = __dirname + '/maps-sky-shots/';
  let bad = 0;
  for (const [tag, vp, mob] of [['desk', { width: 1280, height: 800 }, false], ['phone', { width: 390, height: 844 }, true]]) {
    const ctx = await b.newContext({ viewport: vp, isMobile: mob, hasTouch: mob, deviceScaleFactor: mob ? 2 : 1 });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push('pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await p.goto('http://localhost:8102/index.html');
    await p.waitForTimeout(2000);
    await p.click('text=Freeplay');
    await p.waitForTimeout(1500);
    const st = await p.evaluate(() => { const s = IS.client.state(); return { phase: s.phase, st: s.hs && s.hs.st }; });
    console.log(tag, 'after freeplay:', JSON.stringify(st));
    await p.evaluate(() => IS.client.act('set', Object.assign({}, IS.client.state().hs.st, { map: IS.map.indexOf('sky') })));
    await p.waitForTimeout(800);
    await p.screenshot({ path: out + tag + '-game-lobby.png' });
    await p.evaluate(() => IS.client.act('start'));
    let phase = '';
    for (let i = 0; i < 40; i++) { await p.waitForTimeout(500); phase = await p.evaluate(() => IS.client.state().phase); if (phase === 'play') break; }
    await p.waitForTimeout(1500);
    const info = await p.evaluate(() => ({ phase: IS.client.state().phase, map: IS.map.id, room: (() => { const s = IS.client.state(); const me = s.players && s.players.find(q => q.isMe); return me ? (IS.map.roomAt(me.x, me.y) || {}).name : null; })() }));
    console.log(tag, 'game:', JSON.stringify(info));
    await p.screenshot({ path: out + tag + '-game-play.png' });
    if (info.phase !== 'play' || info.map !== 'sky') bad++;
    console.log(tag, 'errors:', errs.length ? errs.join('\n  ') : 'none');
    bad += errs.length;
    await ctx.close();
  }
  await b.close();
  console.log(bad ? 'SMOKE FAIL' : 'SMOKE OK');
  process.exit(bad ? 1 : 0);
})();
