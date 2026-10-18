// Overlays with hats, no game logic: node tests/hats-ui.cjs (server on :8111)
const { chromium } = require('playwright');
const out = __dirname + '/hats-shots/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }
(async () => {
  const b = await chromium.launch();
  for (const vp of [{ name: 'desk', viewport: { width: 1280, height: 800 } }, { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]) {
    const ctx = await b.newContext(vp);
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://localhost:8111/tests/hats-ui.html');
    await p.evaluate(() => window.harnessReady);
    await p.evaluate(() => { IS.ui.showScreen('game'); IS.ui.showGameOver({ winner: 'imp', reason: 'kills', youWon: false, isHost: false, players: people(10) }); });
    await sleep(2600);
    await p.screenshot({ path: out + vp.name + '-over-imp.png' });
    await p.evaluate(() => { IS.ui.showGameOver({ winner: 'crew', reason: 'tasks', youWon: true, isHost: true, players: people(10) }); });
    await sleep(2600);
    await p.screenshot({ path: out + vp.name + '-over-crew.png' });
    await p.evaluate(() => { IS.ui.hideOverlays(); IS.ui.showRole({ role: 'imp', impostors: people(3).slice(0, 3).filter((x, i) => i !== 1).map((x) => ({ name: x.name, color: x.color, hat: x.hat })), count: 2 }); });
    await sleep(2600);
    await p.screenshot({ path: out + vp.name + '-role-imp.png' });
    await p.evaluate(() => { IS.ui.hideOverlays(); IS.ui.showMeeting({ by: { name: 'Nova', color: 1, hat: 24 }, body: null, players: people(10), phase: 'vote', remain: 30, myVote: -2, canVote: true }); });
    await sleep(2600);
    await p.screenshot({ path: out + vp.name + '-meeting.png' });
    await p.evaluate(() => { IS.ui.updateMeeting({ by: { name: 'Nova', color: 1, hat: 24 }, body: null, players: people(10), phase: 'result', remain: 3, myVote: 2, votes: { '2': [0, 1, 3], '-1': [5] } }); });
    await sleep(900);
    await p.screenshot({ path: out + vp.name + '-meeting-result.png' });
    await p.evaluate(() => { IS.ui.hideMeeting(); IS.ui.showScreen('lobby'); IS.ui.updateLobby({ code: 'QXBT', isHost: true, players: people(10), settings: IS.CONFIG.DEFAULT_SETTINGS, canStart: true, mode: 'local' }); });
    if (vp.name === 'phone') { await p.tap('[aria-label="Players and settings"]'); }
    await sleep(500);
    await p.screenshot({ path: out + vp.name + '-lobby-10.png' });
    ok(await p.evaluate(() => document.querySelectorAll('.plist li.speaking').length === 2), vp.name + ': 2 talking rows');
    ok(errs.length === 0, vp.name + ': no page errors ' + errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
