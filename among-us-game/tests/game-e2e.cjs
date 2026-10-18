// End-to-end: 5 tabs of the built single-file game (dist/index.html) play one full round over the
// BroadcastChannel transport. Run `node tools/build.mjs` first, then:
//   NODE_PATH=/opt/node22/lib/node_modules node tests/game-e2e.cjs
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 8097;
const root = path.join(__dirname, '..');
const shots = path.join(__dirname, 'e2e-shots');
require('fs').mkdirSync(shots, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failures++; }

async function waitFor(page, fn, arg, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(fn, arg)) return true;
    await sleep(150);
  }
  return false;
}

(async () => {
  const server = spawn('npx', ['http-server', path.join(root, 'dist'), '-p', String(PORT), '-s', '-c-1'], { stdio: 'ignore' });
  await sleep(1500);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const pages = [];
  const errors = [];
  for (let i = 0; i < 5; i++) {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`[${i}] ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(`[${i}] console: ${m.text()}`); });
    await p.goto(`http://localhost:${PORT}/index.html`);
    pages.push(p);
  }
  await sleep(1500);
  const names = ['Hosty', 'Bea', 'Cid', 'Dot', 'Eve'];

  // host creates
  await pages[0].fill('#ui-name', names[0]);
  await pages[0].click('text=Host Game');
  check(await waitFor(pages[0], () => IS.client.state() && IS.client.state().code), 'host created a game');
  const code = await pages[0].evaluate(() => IS.client.state().code);
  console.log('code', code);
  await pages[0].screenshot({ path: path.join(shots, '01-lobby-host.png') });

  // public list visible on another tab
  check(await waitFor(pages[1], () => document.body.innerText.includes('Hosty')), 'game listed on menu of tab 1');

  for (let i = 1; i < 5; i++) {
    const p = pages[i];
    await p.fill('#ui-name', names[i]);
    await p.fill('input[aria-label="Game code"]', code);
    await p.click('button:has-text("Join")');
  }
  check(await waitFor(pages[0], () => IS.client.state().players.length === 5), 'host sees 5 players in lobby');
  const colors = await pages[0].evaluate(() => IS.client.state().players.map((p) => p.color));
  check(new Set(colors).size === 5, 'all colours unique: ' + colors.join(','));
  await pages[2].screenshot({ path: path.join(shots, '02-lobby-guest.png') });

  // map switching: every tab follows the host's pick
  const mapList = await pages[0].evaluate(() => IS.map.list().map((m) => m.id));
  check(mapList.length >= 3, 'maps registered: ' + mapList.join(','));
  for (let mi = 1; mi < mapList.length; mi++) {
    await pages[0].evaluate((i) => IS.client.act('set', Object.assign({}, IS.client.state().hs.st, { map: i })), mi);
    for (let i = 0; i < 5; i++) check(await waitFor(pages[i], (id) => IS.map.id === id, mapList[mi]), `tab ${i} on map ${mapList[mi]}`);
    await sleep(700);
    await pages[3].screenshot({ path: path.join(shots, `02-lobby-${mapList[mi]}.png`) });
  }
  const PLAY_MAP = Number(process.env.MAP || 1);

  // fast settings, then start via the Start button
  await pages[0].evaluate((pm) => IS.client.act("set", Object.assign({}, IS.client.state().hs.st, { dis: 0, vot: 30, kcd: 10, nt: 3, map: pm })), PLAY_MAP);
  await sleep(500);
  await pages[0].click('button.start-btn');
  for (let i = 0; i < 5; i++) check(await waitFor(pages[i], () => IS.client.state().phase === 'roles' || IS.client.state().phase === 'play'), `tab ${i} left lobby`);
  await sleep(800);
  await pages[0].screenshot({ path: path.join(shots, '03-role.png') });
  for (let i = 0; i < 5; i++) check(await waitFor(pages[i], () => IS.client.state().phase === 'play', null, 10000), `tab ${i} in play`);
  await sleep(500);

  // who is who
  const info = [];
  for (let i = 0; i < 5; i++) info.push(await pages[i].evaluate(() => ({ slot: IS.client.state().mySlot, role: IS.client.state().myRole })));
  const impIdx = info.findIndex((x) => x.role === 1);
  check(impIdx >= 0 && info.filter((x) => x.role === 1).length === 1, 'exactly one impostor: tab ' + impIdx);
  const crewIdx = [0, 1, 2, 3, 4].filter((i) => i !== impIdx);
  await pages[crewIdx[0]].screenshot({ path: path.join(shots, '04-play-crew.png') });
  await pages[impIdx].screenshot({ path: path.join(shots, '05-play-imp.png') });

  // a crewmate walks to its first task and opens it
  const tp = pages[crewIdx[1]];
  const opened = await tp.evaluate(async () => {
    const s = IS.client.state();
    const tid = IS.map.assignTasks(s.hs.sd, s.mySlot, s.hs.pl[s.mySlot][5])[0];
    const t = IS.map.TASKS.find((x) => x.id === tid);
    const stn = IS.map.STATIONS.find((x) => x.id === t.station);
    const near = IS.map.moveCircle(stn.x, stn.y + 40, 0, 0, 16);
    IS.main._me.x = near.x; IS.main._me.y = near.y;
    await new Promise((r) => setTimeout(r, 300));
    IS.main._debug.doUse();
    await new Promise((r) => setTimeout(r, 400));
    return IS.tasks.isOpen();
  });
  check(opened, 'crewmate opened a task at its station');
  await tp.screenshot({ path: path.join(shots, '06-task.png') });
  await tp.keyboard.press('Escape');

  // complete a task through the protocol and check the task bar on another tab
  await tp.evaluate(() => IS.client.act('task', 1));
  check(await waitFor(pages[0], () => IS.client.state().hs.pl.some((r) => r[4] & 2)), 'task completion reached host');

  // sabotage lights
  await pages[impIdx].evaluate(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  check(await waitFor(pages[impIdx], () => (IS.client.state().hs.sc || 0) <= IS.client.now(), null, 15000), 'sabotage cooldown elapsed');
  await pages[impIdx].evaluate(() => IS.client.act('sab', 'lights'));
  check(await waitFor(pages[crewIdx[0]], () => IS.client.state().hs.sb && IS.client.state().hs.sb.k === 'lights'), 'lights sabotage seen by crew');
  await sleep(500);
  await pages[crewIdx[0]].screenshot({ path: path.join(shots, '07-lights.png') });

  // kill: impostor moves next to victim
  const victim = crewIdx[2];
  const vslot = info[victim].slot;
  check(await waitFor(pages[impIdx], () => (IS.client.state().hs.kc[IS.client.state().mySlot] || 0) <= IS.client.now(), null, 15000), 'kill cooldown elapsed');
  const vpos = await pages[victim].evaluate(() => ({ x: IS.main._me.x, y: IS.main._me.y }));
  await pages[impIdx].evaluate((v) => { IS.main._me.x = v.x + 30; IS.main._me.y = v.y; }, vpos);
  await sleep(600);
  await pages[impIdx].evaluate(() => IS.main._debug.doKill());
  check(await waitFor(pages[0], (s) => IS.client.state().hs.pl[s][2] === 0, vslot), 'victim died');
  check(await waitFor(pages[victim], () => !IS.client.state().alive), 'victim sees itself dead');
  await sleep(600);
  await pages[victim].screenshot({ path: path.join(shots, '08-ghost.png') });

  // report: another crewmate walks to the body
  const rep = crewIdx[0];
  const body = await pages[0].evaluate(() => IS.client.state().hs.bd[0]);
  await pages[rep].evaluate((b) => { IS.main._me.x = b[1] + 20; IS.main._me.y = b[2]; }, body);
  await sleep(600);
  await pages[rep].screenshot({ path: path.join(shots, '09-body.png') });
  await pages[rep].evaluate(() => IS.main._debug.doReport());
  for (let i = 0; i < 5; i++) check(await waitFor(pages[i], () => IS.client.state().phase === 'meeting'), `tab ${i} in meeting`);
  await sleep(2500);
  await pages[rep].screenshot({ path: path.join(shots, '10-meeting.png') });

  // chat
  await pages[rep].evaluate(() => IS.client.chat('It was ' + 'the impostor!'));
  check(await waitFor(pages[crewIdx[1]], () => document.body.innerText.includes('It was the impostor!'), null, 6000), 'chat delivered');

  // everyone alive votes the impostor (via UI handler path)
  const impSlot = info[impIdx].slot;
  for (const i of [0, 1, 2, 3, 4]) {
    if (i === victim) continue;
    await pages[i].evaluate((t) => IS.client.act('vote', t), impSlot);
  }
  check(await waitFor(pages[0], () => IS.client.state().phase === 'eject', null, 10000), 'eject phase');
  await sleep(1000);
  await pages[rep].screenshot({ path: path.join(shots, '11-votes.png') });
  await sleep(2500);
  await pages[rep].screenshot({ path: path.join(shots, '12-eject.png') });
  check(await waitFor(pages[0], () => IS.client.state().phase === 'over', null, 12000), 'game over');
  const wn = await pages[0].evaluate(() => IS.client.state().hs.wn);
  check(wn && wn.t === 'crew', 'crew won: ' + JSON.stringify(wn));
  await sleep(1200);
  await pages[rep].screenshot({ path: path.join(shots, '13-over.png') });

  // play again -> lobby
  await pages[0].evaluate(() => IS.client.act('again'));
  for (let i = 0; i < 5; i++) check(await waitFor(pages[i], () => IS.client.state().phase === 'lobby'), `tab ${i} back in lobby`);
  await sleep(800);
  await pages[3].screenshot({ path: path.join(shots, '14-lobby-again.png') });

  // host leaves; someone else takes over
  await pages[0].close();
  check(await waitFor(pages[1], () => IS.client.state().players.length === 4 && !!IS.client.state().hostPeer, null, 12000), 'lobby recovered after host left');
  const hosts = [];
  for (let i = 1; i < 5; i++) hosts.push(await pages[i].evaluate(() => IS.client.isHost()));
  check(hosts.filter(Boolean).length === 1, 'exactly one new host');

  console.log(errors.length ? 'page errors:\n  ' + errors.join('\n  ') : 'no page errors');
  if (errors.length) failures++;
  console.log(failures ? `${failures} FAILURES` : 'ALL PASSED');
  await browser.close();
  server.kill();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
