// Hats in the real game (index.html served on :8111):
//   npx http-server . -p 8111 -s -c-1 &
//   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tests/hats-game.cjs
const { chromium } = require('playwright');
const BASE = 'http://localhost:8111/index.html';
const out = __dirname + '/hats-shots/';
require('fs').mkdirSync(out, { recursive: true });
let fails = 0;
function ok(c, m) { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(page, fn, arg, t = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < t) { if (await page.evaluate(fn, arg)) return true; await sleep(100); }
  return false;
}
async function noHOverflow(page, sel) {
  return page.evaluate((sel) => {
    const bad = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('document');
    document.querySelectorAll(sel).forEach((el) => {
      if (el.offsetParent === null) return;
      const r = el.getBoundingClientRect();
      if (r.left < -1 || r.right > innerWidth + 1) bad.push(el.className + ' off-screen ' + Math.round(r.left) + '..' + Math.round(r.right));
      if (el.scrollWidth > el.clientWidth + 1) bad.push(el.className + ' scrollW ' + el.scrollWidth + '>' + el.clientWidth);
    });
    return bad;
  }, sel);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];

  // ------------------------------------------------------------ desktop
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('[host] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[host] console: ' + m.text()); });
  await page.goto(BASE);
  await page.waitForSelector('.scr-menu .hat-btn');
  await sleep(600);
  ok(await page.evaluate(() => IS.HATS.length >= 20 && IS.HATS[0].name === 'No hat'), 'IS.HATS has ' + await page.evaluate(() => IS.HATS.length) + ' entries, 0 = No hat');
  ok((await page.$$('.scr-menu .hat-btn')).length === await page.evaluate(() => IS.HATS.length), 'menu hat grid shows every hat');
  await page.fill('#ui-name', 'Hatter');
  await page.click('.scr-menu .swatch:nth-child(4)');
  await page.click('.scr-menu .hat-btn:nth-child(3)'); // Party Hat
  ok(await page.evaluate(() => localStorage.getItem('ss_hat') === '2'), 'menu hat remembered in localStorage (ss_hat=2)');
  ok(await page.$eval('.scr-menu .hat-btn:nth-child(3)', (b) => b.getAttribute('aria-pressed') === 'true'), 'picked hat button is pressed');
  ok(await page.evaluate(() => IS.ui.profile().hat === 2), 'IS.ui.profile() includes hat');
  ok((await page.textContent('.scr-menu .hat-cur')) === 'Party Hat', 'current hat name shown');
  // hero repaint: logo canvas has pixels above the head area
  await sleep(200);
  await page.screenshot({ path: out + 'game-menu-desktop.png' });
  const menuBad = await noHOverflow(page, '.menu-main, .hat-grid, .swatches');
  ok(menuBad.length === 0, 'desktop menu: no horizontal overflow ' + menuBad.join(', '));
  const mh = await page.evaluate(() => { const g = document.querySelector('.scr-menu .hat-grid'); return [g.clientHeight, g.scrollHeight]; });
  ok(mh[1] > mh[0], 'menu hat grid scrolls (' + mh.join('/') + ')');

  await page.click('text=Host Game');
  ok(await waitFor(page, () => IS.client.state() && IS.client.state().code && document.querySelector('.scr-lobby.on')), 'hosted a lobby');
  ok(await page.evaluate(() => IS.client.hat() === 2), 'client hat = 2 after create');
  ok(await waitFor(page, () => { const s = IS.client.state(); const me = s.players.find((p) => p.isMe); return me && me.hat === 2; }), 'state().players[me].hat === 2');
  await sleep(700);
  ok(await page.evaluate(() => document.querySelectorAll('.plist li .av canvas').length === 1), 'lobby list row has an avatar');
  ok(await page.$eval('.lobby-panel .hat-btn:nth-child(3)', (b) => b.getAttribute('aria-pressed') === 'true'), 'lobby hat picker shows current hat');
  await page.screenshot({ path: out + 'game-lobby-desktop.png' });
  // close-up of my crewmate in the world
  const crop = await page.evaluate(() => { const p = IS.render.worldToScreen(0, 0); return null; });
  void crop;

  // change hat in the lobby
  const before = await page.evaluate(() => document.querySelector('.plist li'));
  void before;
  await page.locator('.lobby-panel .hat-btn:nth-child(13)').scrollIntoViewIfNeeded();
  await page.click('.lobby-panel .hat-btn:nth-child(13)'); // Wizard Hat
  ok(await waitFor(page, () => IS.client.hat() === 12 && IS.client.state().players.find((p) => p.isMe).hat === 12), 'lobby pick -> onHat -> client hat 12');
  ok(await page.evaluate(() => localStorage.getItem('ss_hat') === '12'), 'lobby hat remembered');
  await sleep(500);
  await page.screenshot({ path: out + 'game-lobby-wizard.png' });
  const lobbyBad = await noHOverflow(page, '.lobby-panel, .panel-body, .hat-grid');
  ok(lobbyBad.length === 0, 'desktop lobby: no horizontal overflow ' + lobbyBad.join(', '));

  // a guest joins with another hat -> visible in host's list + world
  const g = await ctx.newPage();
  g.on('pageerror', (e) => errors.push('[guest] ' + e.message));
  await g.goto(BASE);
  await g.waitForSelector('.scr-menu .hat-btn');
  await g.fill('#ui-name', 'Guesty');
  await g.click('.scr-menu .hat-btn:nth-child(6)'); // Cowboy
  const code = await page.evaluate(() => IS.client.state().code);
  await g.fill('.join-row input', code);
  await g.click('.join-row .ui-btn');
  ok(await waitFor(page, () => IS.client.state().players.length === 2 && IS.client.state().players.some((p) => !p.isMe && p.hat === 5)), 'host sees guest hat (cowboy) in state');
  // walk the guest next to the host so both are on screen
  await g.evaluate(() => { window.__k = true; });
  await g.keyboard.down('ArrowRight'); await sleep(450); await g.keyboard.up('ArrowRight');
  await sleep(800);
  ok(await page.evaluate(() => document.querySelectorAll('.plist li').length === 2), 'host lobby list has 2 rows');

  // speaking indicators (fake voice module)
  await page.evaluate(() => { IS.voice = Object.assign(IS.voice || {}, { isSpeaking: (peer) => peer !== IS.client.me() || true }); });
  ok(await waitFor(page, () => document.querySelectorAll('.plist li.speaking').length === 2), 'lobby rows get .speaking');
  const rowsBefore = await page.evaluate(() => { window.__row0 = document.querySelector('.plist li'); return true; });
  void rowsBefore;
  await sleep(400);
  ok(await page.evaluate(() => window.__row0 === document.querySelector('.plist li')), 'speaking toggles do not rebuild lobby rows');
  await page.screenshot({ path: out + 'game-lobby-speaking.png' });
  await page.evaluate(() => { IS.voice.isSpeaking = (peer) => peer !== IS.client.me(); });
  ok(await waitFor(page, () => document.querySelectorAll('.plist li.speaking').length === 1), 'only the talking player keeps .speaking');
  await page.evaluate(() => { IS.voice.isSpeaking = () => false; });

  // UI overlays with hats (fake data through the public API)
  const P = (slot, name, color, hat, extra) => Object.assign({ slot, name, color, hat, alive: true, isMe: slot === 0, voted: false, canVote: true }, extra || {});
  await page.evaluate(() => { IS.ui.showScreen('game'); });
  await page.evaluate(() => IS.ui.showRole({ role: 'crew', count: 2, impostors: [] }));
  await sleep(2600);
  await page.screenshot({ path: out + 'ui-role.png' });
  await page.evaluate(() => IS.ui.hideOverlays());
  const players = [P(0, 'Hatter', 3, 12), P(1, 'Guesty', 0, 5, { speaking: true }), P(2, 'Nova', 1, 24), P(3, 'Pixel', 5, 7, { voted: true }), P(4, 'Comet', 10, 0, { alive: false }), P(5, 'Zappy', 8, 1, { speaking: true }), P(6, 'Blip', 4, 21), P(7, 'Luna', 7, 9)];
  await page.evaluate((pl) => IS.ui.showMeeting({ by: { name: 'Guesty', color: 0, hat: 5 }, body: { name: 'Comet', color: 10, hat: 0 }, players: pl, phase: 'vote', remain: 30, myVote: -2, canVote: true }), players);
  await sleep(700);
  await page.screenshot({ path: out + 'ui-meeting-splash.png' });
  await sleep(1800);
  await page.click('.chat-toggle'); await sleep(150); await page.focus('.m-chat input');
  const keep = await page.evaluate((pl) => {
    const c0 = document.querySelector('.m-card');
    pl[2].speaking = true; pl[1].speaking = false;
    IS.ui.updateMeeting({ by: { name: 'Guesty', color: 0, hat: 5 }, body: null, players: pl, phase: 'vote', remain: 25, myVote: -2, canVote: true });
    return c0 === document.querySelector('.m-card') && document.activeElement === document.querySelector('.m-chat input') &&
      document.querySelectorAll('.m-card.speaking').length === 2 && document.querySelectorAll('.m-card')[2].classList.contains('speaking');
  }, players);
  ok(keep, 'updateMeeting toggles .speaking without rebuilding cards, chat focus kept');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: out + 'ui-meeting.png' });
  await page.evaluate(() => { IS.ui.hideMeeting(); IS.ui.showEjection({ name: 'Nova', color: 1, hat: 24, text: 'Nova was not An Impostor.\n1 Impostor remains.' }); });
  await sleep(2200);
  await page.screenshot({ path: out + 'ui-eject.png' });
  await page.evaluate((pl) => IS.ui.showGameOver({ winner: 'crew', reason: 'tasks', youWon: true, isHost: true, players: pl.map((p, i) => Object.assign({}, p, { role: i === 5 ? 1 : 0 })) }), players);
  await sleep(1200);
  await page.screenshot({ path: out + 'ui-over.png' });
  await page.evaluate(() => IS.ui.showScreen('lobby'));
  await sleep(300);

  // world close-up: zoom in on the two crewmates, both talking
  await page.evaluate(() => { IS.voice.isSpeaking = () => true; });
  await sleep(500);
  const me = await page.evaluate(() => { const s = IS.client.state(); const m = s.players.find((p) => p.isMe); return IS.render.worldToScreen(m.x, m.y); });
  await page.screenshot({ path: out + 'game-world-closeup.png', clip: { x: Math.max(0, me.x - 260), y: Math.max(0, me.y - 220), width: 520, height: 300 } });
  await page.evaluate(() => { IS.voice.isSpeaking = () => false; });

  // ------------------------------------------------------------ phone
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const pp = await pctx.newPage();
  pp.on('pageerror', (e) => errors.push('[phone] ' + e.message));
  await pp.goto(BASE);
  await pp.waitForSelector('.scr-menu .hat-btn');
  await sleep(700);
  await pp.screenshot({ path: out + 'phone-menu-top.png' });
  await pp.locator('.scr-menu .hat-grid').scrollIntoViewIfNeeded();
  await pp.tap('.scr-menu .hat-btn:nth-child(16)'); // Santa
  ok(await pp.evaluate(() => IS.ui.profile().hat === 15), 'phone: tap hat -> profile().hat 15');
  await sleep(200);
  await pp.screenshot({ path: out + 'phone-menu-hats.png' });
  let bad = await noHOverflow(pp, '.menu-main, .hat-grid, .swatches, .menu-hero');
  ok(bad.length === 0, 'phone menu: no horizontal overflow ' + bad.join(', '));
  await pp.tap('text=Host Game');
  ok(await waitFor(pp, () => document.querySelector('.scr-lobby.on')), 'phone: hosted');
  await pp.tap('[aria-label="Players and settings"]');
  await sleep(500);
  await pp.screenshot({ path: out + 'phone-lobby-panel.png' });
  await pp.locator('.lobby-panel .hat-grid').scrollIntoViewIfNeeded();
  await sleep(200);
  await pp.screenshot({ path: out + 'phone-lobby-hats.png' });
  bad = await noHOverflow(pp, '.lobby-panel, .panel-body, .hat-grid');
  ok(bad.length === 0, 'phone lobby: no horizontal overflow ' + bad.join(', '));
  await pp.tap('.lobby-panel .hat-btn:nth-child(24)'); // Cat ears
  ok(await waitFor(pp, () => IS.client.hat() === 23), 'phone: lobby hat -> client hat 23');
  await pp.tap('[aria-label="Players and settings"]');
  await sleep(500);
  await pp.screenshot({ path: out + 'phone-lobby-world.png' });
  await pctx.close();

  ok(errors.length === 0, 'no page errors ' + errors.join(' | '));
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
