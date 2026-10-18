// Functional checks for js/ui.js via tests/ui-harness.html. Run: node tests/ui-func.cjs (server on :8095)
const { chromium } = require('playwright');
const BASE = 'http://localhost:8095/tests/ui-harness.html';
let fails = 0;
function ok(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; }

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE);
  await page.evaluate(() => window.harnessReady);
  const calls = () => page.evaluate(() => window.calls.splice(0));
  const last = async (name) => { const c = await calls(); const f = c.filter(x => x[0] === name); return f.length ? f[f.length - 1] : null; };

  // ---------------- menu
  await page.evaluate(() => scene('menu'));
  await page.fill('#ui-name', 'Tester');
  await page.click('.scr-menu .swatch:nth-child(5)');
  await page.click('text=Host Game');
  let c = await last('onCreate');
  ok(c && c[1].name === 'Tester' && c[1].color === 4, 'Host -> onCreate {name,color} ' + JSON.stringify(c));
  ok(await page.evaluate(() => localStorage.getItem('ss_name') === 'Tester' && localStorage.getItem('ss_color') === '4'), 'name + colour remembered in localStorage');
  await page.evaluate(() => IS.ui.showScreen('menu'));
  await page.fill('.join-row input', 'ab1cdo');
  ok(await page.inputValue('.join-row input') === 'ABCD', 'code input filtered to alphabet/uppercase');
  await page.click('.join-row .ui-btn');
  c = await last('onJoin');
  ok(c && c[1].code === 'ABCD' && c[1].name === 'Tester', 'Join -> onJoin ' + JSON.stringify(c));
  await page.evaluate(() => IS.ui.showScreen('menu'));
  await page.click('.game-row:first-child');
  c = await last('onJoin');
  ok(c && c[1].code === 'QXBT', 'click public game -> onJoin QXBT');
  ok(await page.$eval('.game-row:nth-child(3)', b => b.disabled), 'full game row disabled');
  await page.evaluate(() => IS.ui.showScreen('menu'));
  await page.click('text=Freeplay');
  c = await last('onFreeplay');
  ok(c && c[1].name === 'Tester', 'Freeplay -> onFreeplay');
  await page.click('.menu-mute');
  c = await last('onMute');
  ok(c && c[1] === true, 'mute toggle -> onMute(true)');
  await page.click('.menu-mute'); await calls();
  await page.waitForTimeout(50);
  const ae = await page.evaluate(() => document.activeElement.tagName + '.' + document.activeElement.className);
  ok(ae.startsWith('BODY'), 'buttons blur after mouse click (' + ae + ')');
  await page.evaluate(() => scene('menu-offline'));
  ok(await page.$eval('text=Host Game', b => b.closest('button').disabled), 'offline: Host disabled');

  // ---------------- lobby
  await page.evaluate(() => scene('lobby-host'));
  ok(await page.$eval('.start-btn', b => b.disabled), 'start disabled when !canStart');
  ok(await page.isVisible('text=Need at least 3 players'), 'start hint visible');
  await page.click('.lobby-panel .swatch:nth-child(3)');
  c = await last('onColor');
  ok(c && c[1] === 2, 'lobby colour -> onColor(2)');
  ok(await page.$eval('.lobby-panel .swatch:nth-child(1)', b => b.disabled), 'taken colour disabled');
  await page.click('.panel-tab:nth-child(2)');
  await page.click('[aria-label="Increase Impostors"]');
  c = await last('onSettings');
  ok(c && c[1].imp === 2 && c[1].kcd === 25 && 'nt' in c[1], 'settings + -> onSettings full object imp=2');
  await page.click('.seg button:nth-child(3)');
  c = await last('onSettings');
  ok(c && c[1].kd === 2 && c[1].imp === 2, 'kill distance Long -> kd=2 (keeps optimistic imp=2)');
  await page.click('.switch');
  c = await last('onSettings');
  ok(c && c[1].conf === 0, 'confirm ejects toggle -> conf=0');
  await page.evaluate(() => IS.ui.updateLobby({ code: 'QXBT', isHost: true, players: [{ slot: 0, name: 'A', color: 3, isMe: true, isHost: true }, { slot: 1, name: 'B', color: 0 }, { slot: 2, name: 'C', color: 1 }], settings: IS.CONFIG.DEFAULT_SETTINGS, canStart: true }));
  await page.click('.start-btn');
  c = await last('onStart');
  ok(!!c, 'Start -> onStart');
  await page.click('[aria-label="Copy game code"]');
  await page.waitForTimeout(200);
  ok(await page.isVisible('.toast'), 'copy code shows toast: ' + await page.textContent('.toast').catch(() => ''));
  await page.click('.lobby-leave');
  ok(!!(await last('onLeave')), 'Leave -> onLeave');
  await page.evaluate(() => scene('lobby-guest'));
  ok(await page.isVisible('.wait-pill') && !(await page.isVisible('.start-btn')), 'guest: waiting pill, no start');
  await page.click('.panel-tab:nth-child(2)');
  ok(!(await page.isVisible('.set-ctl')) && await page.isVisible('.set-ro'), 'guest: settings read-only');

  // ---------------- HUD
  await page.evaluate(() => scene('game-crew'));
  ok(!(await page.isVisible('.act--kill')) && !(await page.isVisible('.act--vent')) && !(await page.isVisible('.act--sabotage')), 'crew: no kill/vent/sabotage buttons');
  await page.click('.act--use'); ok(!!(await last('onUse')), 'USE -> onUse');
  await page.click('.act--report', { force: true }); ok(!(await last('onReport')), 'REPORT disabled -> no call');
  await page.click('.act--map'); ok(!!(await last('onMap')) && await page.isVisible('.ov-map'), 'MAP -> onMap + map open');
  await page.click('.ov-map [aria-label="Close map"]'); await page.waitForTimeout(50);
  ok(!(await page.isVisible('.ov-map')), 'map close button closes map');
  await calls();
  ok(await page.isVisible('text=Reactor meltdown'), 'reactor banner shown');
  await page.evaluate(() => IS.ui.updateHud({ role: 'imp', alive: true, tasks: [], progress: 0.1, buttons: { use: { on: false }, report: { on: false }, kill: { on: true, cd: 0, show: true }, sabotage: { on: true, cd: 0, show: true }, vent: { on: true, show: true }, map: { on: true } }, sabotage: null }));
  await page.click('.act--kill'); ok(!!(await last('onKill')), 'KILL -> onKill');
  await page.click('.act--vent'); ok(!!(await last('onVent')), 'VENT -> onVent');
  await page.click('.act--sabotage'); ok(await page.isVisible('.ov-sab'), 'SABOTAGE opens menu');
  await page.click('.sab-tile:nth-child(2)');
  c = await last('onSabotage');
  ok(c && c[1] === 'o2' && !(await page.isVisible('.ov-sab')), 'sabotage O2 -> onSabotage(o2) & closes');
  await page.evaluate(() => IS.ui.updateHud({ role: 'imp', alive: true, tasks: [], progress: 0.1, buttons: { kill: { on: false, cd: 12, show: true }, sabotage: { on: true, show: true }, vent: { on: false, show: true }, use: {}, report: {}, map: { on: true } } }));
  ok((await page.textContent('.act--kill .act-cd')) === '12', 'kill cooldown number shown');
  await page.click('.act--kill', { force: true }); ok(!(await last('onKill')), 'KILL on cooldown -> no call');
  // keyboard focus must not stick on HUD buttons
  ok(await page.evaluate(() => !document.activeElement.closest || !document.activeElement.closest('.act')), 'HUD buttons do not take focus');
  await page.evaluate(() => scene('game-ghost'));
  ok(await page.isVisible('text=You are a ghost'), 'ghost hint shown');
  ok(await page.isVisible('.tasks-note.comms'), 'comms sabotaged note shown');

  // ---------------- meeting
  await page.evaluate(() => scene('meeting-vote'));
  await page.waitForTimeout(2300);
  const firstCard = await page.$('.m-card:nth-child(4)');
  await firstCard.click();
  ok(await firstCard.evaluate(e => e.classList.contains('sel')), 'click card selects it');
  await page.click('.m-card:nth-child(4) .yes');
  c = await last('onVote');
  ok(c && c[1] === 3, 'confirm vote -> onVote(3)');
  ok(await page.evaluate(() => !document.querySelector('.m-card.votable')), 'cannot vote twice');
  ok((await page.textContent('.m-status')).includes('Pixel'), 'status shows who I voted for');
  // update without DOM recreation, chat focus kept
  await page.click('.chat-toggle');
  await page.waitForTimeout(150);
  await page.focus('.m-chat input');
  ok(await page.evaluate(() => IS.ui.isTyping()), 'isTyping() true in chat input');
  const same = await page.evaluate(() => {
    const before = document.querySelector('.m-card');
    IS.ui.updateMeeting({ by: { name: 'Nova', color: 1 }, body: null, players: meetPlayers('vote').map(p => Object.assign(p, { voted: true })), phase: 'vote', remain: 20, myVote: 3 });
    return before === document.querySelector('.m-card') && document.activeElement === document.querySelector('.m-chat input');
  });
  ok(same, 'updateMeeting keeps DOM + chat focus');
  await page.keyboard.type('hello there');
  await page.keyboard.press('Enter');
  c = await last('onChat');
  ok(c && c[1] === 'hello there', 'Enter in chat -> onChat');
  await page.evaluate(() => IS.ui.addChat({ name: 'Nova', color: 1, text: 'hi', dead: false }));
  ok((await page.$$('.msg')).length >= 1, 'addChat renders message');
  await page.keyboard.press('Escape');
  ok(!(await page.evaluate(() => IS.ui.isTyping())) && !(await page.isVisible('.m-chat.open')), 'Escape closes chat & blurs');
  await page.evaluate(() => IS.ui.addChat({ name: 'Nova', color: 1, text: 'unread', dead: false }));
  ok((await page.textContent('.chat-toggle .badge')) === '1', 'unread badge counts');
  await page.evaluate(() => { IS.ui.hideMeeting(); IS.ui.showMeeting({ by: { name: 'N', color: 1 }, body: null, players: meetPlayers('vote'), phase: 'vote', remain: 30, myVote: -2, canVote: true }); });
  await page.waitForTimeout(2300);
  await page.click('text=Skip vote');
  await page.click('.skip-confirm .yes');
  c = await last('onVote');
  ok(c && c[1] === -1, 'skip vote -> onVote(-1)');

  // ---------------- game over / eject
  await page.evaluate(() => scene('over-win'));
  await page.waitForTimeout(1300);
  await page.click('text=Play again'); ok(!!(await last('onAgain')), 'Play again -> onAgain');
  await page.click('.ov-over >> text=Leave'); ok(!!(await last('onLeave')), 'game over Leave -> onLeave');
  await page.evaluate(() => scene('over-lose'));
  ok(await page.isVisible('.over-wait') && !(await page.isVisible('text=Play again')), 'non-host: waiting for host');
  await page.evaluate(() => scene('eject'));
  await page.waitForTimeout(6300);
  ok(!(await page.isVisible('.ov-eject')), 'ejection auto-hides');
  await page.evaluate(() => scene('role-crew'));
  await page.waitForTimeout(4400);
  ok(!(await page.isVisible('.ov-role')), 'role splash auto-hides');
  ok(errors.length === 0, 'no page errors ' + errors.join(' | '));
  await ctx.close();

  // ---------------- touch joystick (phone)
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pp = await pctx.newPage();
  await pp.goto(BASE); await pp.evaluate(() => window.harnessReady);
  await pp.evaluate(() => scene('game-crew'));
  ok(await pp.isVisible('.stick-base'), 'joystick visible on coarse pointer');
  const box = await pp.$eval('.stick-base', e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await pp.mouse.move(box.x, box.y); await pp.mouse.down(); await pp.mouse.move(box.x + 60, box.y - 10, { steps: 4 });
  const v = await pp.evaluate(() => IS.ui.getStick());
  ok(v.x > 0.8 && Math.abs(v.y) < 0.3 && Math.hypot(v.x, v.y) <= 1.0001, 'stick drag right -> ' + JSON.stringify(v));
  await pp.mouse.up();
  const v2 = await pp.evaluate(() => IS.ui.getStick());
  ok(v2.x === 0 && v2.y === 0, 'stick release -> 0,0');
  await pp.tap('.act--use');
  ok(await pp.evaluate(() => window.calls.some(c => c[0] === 'onUse')), 'tap USE on phone -> onUse');
  await pp.evaluate(() => scene('lobby-host'));
  await pp.tap('[aria-label="Players and settings"]');
  await pp.waitForTimeout(400);
  await pp.screenshot({ path: __dirname + '/ui-shots/phone-lobby-panel.png' });
  await pp.tap('.panel-tab:nth-child(2)');
  await pp.waitForTimeout(200);
  await pp.screenshot({ path: __dirname + '/ui-shots/phone-lobby-panel-settings.png' });
  await pctx.close();
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
