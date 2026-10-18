# Starship Sus — architecture spec (shared contract for all modules)

An Among-Us-style social deduction game. Vanilla JS, HTML5 canvas, **no external JS libraries,
no build step for development, no ES modules**. Every file in `js/` is a classic script wrapped in
an IIFE that attaches its public API to the global namespace `window.IS`
(`window.IS = window.IS || {}` at the top of each file).

Script load order (index.html): `config.js, assets.js, net.js, host.js, client.js, map.js,
render.js, maps/*.js, tasks.js, ui.js, main.js`. A module may only *call* other modules at runtime (inside
functions), never at load time, except for reading `IS.CONFIG`.

For release, `tools/build.mjs` inlines everything (scripts, CSS, and assets as data URIs) into one
HTML file, so: **reference assets only through `IS.assets`** (never hard-code `assets/...` URLs in
other modules), and do not use `fetch()` for local files.

Target: desktop (keyboard + mouse) and phones (touch joystick + buttons). Canvas fills the window.

---------------------------------------------------------------------------------------------------
## 1. File ownership

| File | Owner | Purpose |
|---|---|---|
| `SPEC.md`, `js/config.js`, `js/main.js`, `tools/build.mjs` | lead | contract, constants, glue/game loop, build |
| `assets/**`, `assets/CREDITS.md`, `js/assets.js` | assets agent | CC0 art/sfx download + loader + sound |
| `js/net.js`, `js/host.js`, `js/client.js`, `tests/host.test.mjs` | net agent | transport, authoritative rules, client state |
| `js/map.js`, `js/render.js` | world agent | station map, collision, vents, stations, drawing, vision |
| `js/tasks.js` | tasks agent | task + sabotage-fix minigames (DOM overlay) |
| `index.html`, `js/ui.js` | ui agent | page shell, CSS, menus, lobby, HUD, meeting, ejection, game over, touch controls |

Do not edit files you don't own. If you need something from another module, code against the
interface below and degrade gracefully when it's missing (`IS.x && IS.x.fn ? ... : fallback`).

---------------------------------------------------------------------------------------------------
## 2. Units, coordinates, time

* World units are pixels. `IS.CONFIG.TILE = 48`. Map is a tile grid (see map.js).
* Player is a circle of radius `IS.CONFIG.PLAYER_RADIUS` (16) at its feet position `(x, y)`.
  The crewmate is drawn standing on that point (body extends upward ~56px).
* Base speed `IS.CONFIG.SPEED` px/s (multiplied by settings.spd).
* All shared timestamps are **host clock** ms (`Date.now()` on the host). Clients convert with
  `IS.client.now()` (local `Date.now()` + offset estimated from `hs.now`).

---------------------------------------------------------------------------------------------------
## 3. Networking model

Transport = the claude.ai artifact **room** capability (`await claude.use("room")`), using **presence
only** (no `emit`, because event topics need elevated permission; presence is open to everyone).
Fallback transport for development/outside claude.ai = `BroadcastChannel` that emulates the same
API (so several tabs of one browser can play together). If neither works → offline: only freeplay.

`IS.net` (net.js) normalises both to:

```js
IS.net.init() -> Promise<{mode: 'room'|'local'}>
IS.net.lobby            // Room-like object for the shared lobby (everyone with the page open)
IS.net.join(name) -> Promise<Room>   // named room, name ^[a-z0-9][a-z0-9_.-]{0,47}$
// Room-like:
room.presence(patch)    // merge patch into my presence (null removes a key); coalesced
room.peers()            // [{peer, isMe, sameTab, presence, updatedAt}] (me included)
room.onPeers(fn)        // fn({peers, joined, left, updated}) ; returns unsubscribe
room.connected()        // bool
room.leave()
IS.net.myPeer           // my peer id string (known after first onPeers / immediately in local mode)
```

Local transport: peer id random 12 chars; broadcasts its full presence on change (throttled to
20/s) and as a heartbeat every 1s; a peer not heard from for 4s is removed.

### 3.1 Lobby room presence (main lobby, used for the public game list)
`{v:1, n:name, g: code|null, gc: playerCount, gp: phase, gm: maxPlayers}` — `g` is set only
by a player currently **hosting** game `code`.

### 3.2 Game room
Game code = 4 uppercase letters A–Z without I/O (e.g. `QXBT`); named room = `ss-` + lowercase code.

**Every player's presence in the game room** (client.js maintains it):
```js
{
  v: 1,
  n: "Name",          // ≤ 14 chars
  c: 3,               // preferred colour index (lobby)
  j: 1729200000000,   // my join time (local clock) — host election key
  x: 1234, y: 567,    // feet position (ints)
  f: 1,               // facing: 1 right, -1 left
  m: 1,               // moving 0/1 (walk animation)
  vt: 0,              // in vent 0/1 (impostor hidden in vent)
  fx: "",             // fix station currently being HELD ("r0","r1" for reactor hand scanners) or ""
  a: [[seq, type, ...args], ...],   // last ≤ 10 actions (see 3.4), seq strictly increasing from 1
  ch: [[seq, text], ...],           // last ≤ 4 chat messages (meeting chat), seq strictly increasing
  hs: {...}           // ONLY on the current host: the authoritative game state (3.3)
}
```

**Host election:** among peers in the game room whose `presence.v === 1`, the host is the one with
the smallest `j`, ties broken by `peer` string compare. Everyone computes this independently.
When a client becomes host it starts from the **last `hs` it saw** (from the previous host), so
the game survives the host leaving. The host recomputes and republishes `hs` ~8×/s during play
(at least whenever it changes, and every 1s as a heartbeat) — it always includes `now`.

### 3.3 Host state `hs` (must stay < 3.5 KB JSON for 10 players)
```js
{
  v: 1,
  ep: "k3v6q2",       // epoch: random id per created lobby
  gn: 0,              // game number, ++ on each start
  sq: 123,            // publish counter
  now: 1729200000000, // host Date.now() at publish
  ph: "lobby",        // "lobby"|"roles"|"play"|"meeting"|"eject"|"over"
  pe: 0,              // phase end (host time) for timed phases (roles, meeting, eject), else 0
  st: {map:0, imp:1, kcd:25, spd:1, cvis:1, ivis:1.5, dis:15, vot:45, emg:1, nt:5, conf:1, kd:1, free:0},
  sd: 12345,          // seed (task assignment + spawn shuffle) — new on each start
  pl: [               // slot table; index = slot. Lobby: every present player gets a slot (max 10).
    // [peer, colour, alive, role, doneMask, nTasks, conn]
    ["k3v6q2rt7wac", 3, 1, 0, 0, 5, 1]
  ],                  // role 0 crewmate, 1 impostor. conn 0 = disconnected (counts as dead)
  ls: [0],            // per slot: last action seq processed (so a new host doesn't replay)
  lc: [0],            // per slot: (unused by host) reserved
  bd: [[slot, x, y]], // dead bodies on the floor
  mt: null | {by: slot, bd: slot|-1, ds: hostTime discussion end, vt: [target per slot]},
                      // vt[i]: -2 not voted yet, -1 skip, >=0 voted that slot
  ej: null | {s: slot|-1, imp: 0|1, tie: 0|1, left: impostorsRemaining},
  sb: null | {k: "reactor"|"o2"|"lights"|"comms", end: hostTime|0, fx: [0,0]},
                      // end>0 only for critical (reactor/o2); fx = parts fixed
  sc: 0,              // sabotage cooldown end (host time)
  em: [0],            // per slot: emergency meetings used
  kc: [0],            // per slot: kill cooldown end (host time)
  wn: null | {t: "crew"|"imp", r: "tasks"|"vote"|"kills"|"sabotage"|"disconnect"}
}
```

### 3.4 Actions (client → host, via own presence `a`)
`[seq, type, ...args]`. The host processes, for each slot, actions with `seq > hs.ls[slot]` in
order, then sets `ls[slot]` to the max seq. Invalid actions are ignored silently.

| type | args | valid when | effect |
|---|---|---|---|
| `col` | colourIdx | lobby | set slot colour if not taken |
| `set` | settingsObj | lobby, host only | replace `st` (clamped) |
| `start` | – | lobby, host only, ≥ 3 connected players (or `st.free`) | assign roles, `ph=roles`, `pe=now+4500`, new `sd`, `gn++` |
| `kill` | targetSlot | play, sender impostor alive, target alive crew, `now ≥ kc[s]`, distance ≤ KILL_RANGE[st.kd]×1.6 (positions from presence) | target alive=0, push body at target pos, `kc[s]=now+kcd*1000`. Killer client snaps to target pos. |
| `rep` | bodySlot | play, sender alive, body exists | meeting |
| `emg` | – | play, sender alive, `em[s] < st.emg`, no critical sabotage | meeting, `em[s]++` |
| `vote` | targetSlot \| -1 | meeting, after `mt.ds`, sender alive, not yet voted | `mt.vt[s]=t` |
| `task` | taskIndex (0..nTasks-1) | play (alive or ghost crewmate) | set bit in doneMask |
| `sab` | kind | play, sender impostor (alive or dead), no sabotage active, `now ≥ sc` | `sb={k, end: critical? now+SAB_TIME*1000 : 0, fx:[0,0]}`, `sc=now+SAB_COOLDOWN*1000` |
| `fix` | kind, part | play, sb.k===kind | o2: `fx[part]=1`, fixed when both. lights/comms: fixed. (reactor is fixed via presence `fx`, see below) |
| `again` | – | over, host only | `ph=lobby`, keep slots, clear game fields |

Reactor fix: sabotage fixed while two *different* players simultaneously have presence `fx` equal
to `"r0"` and `"r1"`. Meeting: on `rep`/`emg` → `ph=meeting`, `mt={by, bd, ds: now+dis*1000, vt:[-2…]}`,
`pe = ds + vot*1000`; bodies cleared, sabotage lights/comms kept, critical sabotage cleared.
Meeting ends when every alive connected player has voted or at `pe` → tally (most votes wins,
tie or skip-majority → nobody) → `ph=eject`, `ej`, `pe=now+7000` → then win check → `ph=play`,
every impostor `kc = now + kcd*1000`.

Win checks (skip all when `st.free`): impostors alive ≥ crew alive → imp (`kills`, or `vote` if it
happened by ejection); no impostor alive → crew (`vote`/`disconnect`); all crew tasks done
(sum over crew slots, including dead crew) → crew `tasks`; critical sabotage `end` passed → imp
`sabotage`. `ph=over` then. Disconnected players (in `pl` but not in room for > 3s) → `conn=0`,
`alive=0`; in lobby they are simply removed from `pl` (slots compacted, lobby only).

Players present in the room but not in `pl` during a game are spectators (ghost camera).

Impostor count at start: `min(st.imp, floor((n-1)/2))`, at least 1.

Task assignment: `IS.map.assignTasks(seed, slot, nTasks)` → array of task ids from `IS.map.TASKS`
(deterministic; same on every client). `doneMask` bit i ↔ the i-th assigned task.

Chat: each client merges others' `ch` entries keyed by (peer, seq); shows only during meetings;
messages from dead players are only shown to dead players.

---------------------------------------------------------------------------------------------------
## 4. Module interfaces

### 4.1 `IS.CONFIG` (config.js) — read it, don't duplicate constants.

### 4.2 `IS.assets` / `IS.audio` (assets.js)
```js
IS.assets.load(onProgress?) -> Promise   // loads every image in the manifest; never rejects
IS.assets.img(key) -> HTMLImageElement|null   // null if missing/not loaded (callers fall back to vector drawing)
IS.assets.has(key) -> bool
IS.assets.FONT_DISPLAY, IS.assets.FONT_BODY   // CSS font-family strings
IS.audio.unlock()                // call from first user gesture
IS.audio.play(key, {volume?})    // one-shot sfx; silently no-op if missing
IS.audio.loop(key) / IS.audio.stopLoop(key)
IS.audio.setMuted(bool) / IS.audio.muted
```
Image keys (any may be missing; consumers must fall back):
`floor_room`, `floor_hall`, `floor_tech`, `wall`, `prop_table`, `prop_crate`, `prop_console`,
`prop_bed`, `prop_engine`, `prop_reactor`, `prop_plant`, `prop_chair`, `prop_screen`,
`prop_barrel`, `vent`, `button`, `stars` (tileable starfield background).
Sound keys: `click`, `hover`, `kill`, `body`, `alarm` (emergency/report), `vote`, `eject`,
`task`, `task_step`, `vent`, `sabotage`, `win`, `lose`, `step`, `role`, `door`, `ambient` (loop).

### 4.3 `IS.map` (map.js)
```js
IS.map.W, IS.map.H          // size in tiles
IS.map.grid                 // Uint8Array W*H: 0 void/space, 1 floor, 2 wall
IS.map.isWalkable(x, y)     // world px
IS.map.moveCircle(x, y, dx, dy, r) -> {x, y}   // slide along walls
IS.map.rooms     // [{id, name, x, y, w, h}] in tiles (for labels/minimap)
IS.map.props     // [{key, x, y, w, h, solid}] in px (render draws them; solid ones block movement)
IS.map.spawn(slot, n) -> {x, y}    // positions around the cafeteria table (game start & after meeting)
IS.map.button    // {x, y} emergency button (px)
IS.map.vents     // [{id, x, y, links:[ids]}] px
IS.map.STATIONS  // [{id, kind, room, x, y}] task stations (px); kind = minigame kind in tasks.js
IS.map.TASKS     // [{id, name, station, kind}] — task id -> station
IS.map.FIX       // {reactor:[{part:0,x,y},{part:1,x,y}], o2:[{part:0,..},{part:1,..}], lights:[{part:0,..}], comms:[{part:0,..}]}
IS.map.assignTasks(seed, slot, n) -> [taskId,...]
IS.map.roomAt(x, y) -> room|null
IS.map.raycast(x0, y0, x1, y1) -> {x, y}  // first wall hit (for vision)
```

Multiple maps: `IS.map.define(id, def)` registers a map (map.js defines `station`; `js/maps/*.js`
add more), `IS.map.select(idOrIndex)` builds it once and copies its fields onto `IS.map` (bumping
`IS.map.version`), `IS.map.list()` → `[{id, name, short, blurb, index}]`. The host's
`settings.map` is an index into that list; client.js selects it on every state update, main.js
respawns players when `IS.map.version` changes. Per-map look comes from `IS.map.theme`
(`bg: 'stars'|'snow'|'sky'`, `void`, `hall`, `hallFloor`, `wall`), room `floor` kinds
(`room|tech|hall|snow|carpet|wood|grass|dirt`) and room `tint`. Map files may add vector props
with `IS.render.registerProp(key, draw, ext)`.

### 4.4 `IS.render` (render.js)
```js
IS.render.init(canvas)
IS.render.frame(view)     // draw one frame. view:
// { me:{x,y,slot,alive,role,color}, cam:{x,y} (centre, px), zoom,
//   players:[{slot,peer,x,y,f,m,color,alive,name,role? (only known for impostor teammates/me),
//             ghost:bool, inVent:bool, isMe}],
//   bodies:[{slot,x,y,color}], vision: px radius (Infinity for ghosts), lights:bool (sabotaged),
//   highlight: {type:'station'|'vent'|'body'|'button'|'fix', x, y} | null,
//   taskTargets:[{x,y}] (arrows/markers for my pending tasks), sabotageTargets:[{x,y}],
//   showNames:true, time: seconds, phase }
IS.render.drawCrewmate(ctx, x, y, colorIdx, opts)  // opts {facing, walk (0..1 phase), dead, ghost, scale, hat}
// Draws the classic bean crewmate with visor + backpack, procedurally (recolourable). (x,y) = feet.
IS.render.drawMinimap(ctx, w, h, view)   // full-map overview (for the Map button / sabotage map)
IS.render.screenToWorld(sx, sy)
```
Vision: darkness everywhere except a visibility polygon (raycast against walls) of radius
`view.vision` around me; other players/bodies outside it are not drawn. Ghosts: full vision.

### 4.5 `IS.tasks` (tasks.js)
```js
IS.tasks.KINDS   // ['wires','swipe','download','fuel','asteroids','align','calibrate','garbage','scan','divert','leaves','numbers']
IS.tasks.open(kind, {title}, {onComplete(), onClose()}) -> {close()}   // modal overlay #task-layer
IS.tasks.openFix(kind, part, {onComplete(), onHold(bool), onClose()}) -> {close()}
// fix kinds: 'reactor' (hold hand on scanner → onHold(true/false) while held),
//            'o2' (enter 5-digit code shown on a note → onComplete), 'lights' (flip 5 switches to all-up → onComplete),
//            'comms' (rotate dial to target frequency → onComplete)
IS.tasks.isOpen() -> bool
```
Works with mouse and touch (pointer events). Escape / close button → `onClose`. Must be fully
self-contained (creates its own DOM inside `#task-layer`, its own scoped CSS injected once).

### 4.6 `IS.ui` (ui.js + index.html)
```js
IS.ui.init(handlers)
// handlers: onCreate({name,color}), onJoin({code,name,color}), onFreeplay({name,color}),
//   onStart(), onSettings(st), onColor(idx), onLeave(), onAgain(),
//   onUse(), onReport(), onKill(), onSabotage(kind), onVent(), onMap(), onVote(slotOr-1), onChat(text),
//   onEmergency(), onMute(bool)
IS.ui.showScreen(name)      // 'menu' | 'lobby' | 'game'
IS.ui.setGameList(list)     // [{code, host, count, max, phase}] public games on menu
IS.ui.updateLobby({code, isHost, players:[{slot,name,color,isMe,isHost}], settings, canStart, mode})
IS.ui.updateHud({role, alive, tasks:[{name, room, done}], progress (0..1), hidden (comms), 
                 buttons:{use:{on,label}, report:{on}, kill:{on, cd}, sabotage:{on}, vent:{on}, map:{on}},
                 sabotage: null|{k, remain (s)|null}, freeplay})
IS.ui.showRole({role, impostors:[{name,color}], count})   // role reveal splash ~4s
IS.ui.showMeeting({by:{name,color}, body:{name,color}|null, players:[{slot,name,color,alive,isMe,voted,canVote}],
                   phase:'discuss'|'vote'|'result', remain, votes?: result tallies {target: [voterColors]}, myVote})
IS.ui.updateMeeting(sameShape)
IS.ui.hideMeeting()
IS.ui.addChat({name, color, text, dead, isMe})
IS.ui.showEjection({name, color, text})   // "X was an Impostor." / "No one was ejected. (Skipped)"
IS.ui.showGameOver({winner:'crew'|'imp', reason, youWon, players:[{name,color,role,alive}], isHost})
IS.ui.hideOverlays()
IS.ui.toast(text)
IS.ui.showSabotageMenu(open:bool)
IS.ui.showMap(open:bool)  // calls IS.render.drawMinimap on its own canvas
IS.ui.getStick() -> {x, y}   // touch joystick vector, |v| ≤ 1 (0,0 when idle)
IS.ui.isTyping() -> bool     // a text input has focus (main.js ignores movement keys)
```
DOM ids main.js relies on: `#game-canvas` (full-window canvas, behind UI), `#task-layer`
(empty container for tasks.js, above canvas).

### 4.7 `IS.client` (client.js)
```js
IS.client.boot() -> Promise<{mode}>
IS.client.onGames(fn)                 // fn(list) public game list from lobby presence
IS.client.create({name, color, free}) -> Promise<code>
IS.client.join({code, name, color}) -> Promise<void>   // rejects Error('full'|'not_found'|'in_progress'?) — joining in progress is allowed (spectator)
IS.client.leave()
IS.client.me()          // my peer id
IS.client.isHost()
IS.client.state()       // latest decoded view (below), recomputed on change
IS.client.now()         // host-clock ms
IS.client.setSelf({x,y,f,m,vt,fx})    // my live presence fields (call every frame; it de-dups)
IS.client.act(type, ...args)          // append action
IS.client.chat(text)
IS.client.on(evt, fn)   // 'state' (every hs/peers change), 'phase' (ph changed: {from,to}), 'chat' (msg), 'kicked'
// state():
// { code, phase, hs, mySlot (-1 spectator), myRole, alive,
//   players: [{slot, peer, name, color, alive, role, conn, x, y, f, m, vt, isMe, isHost, done, total}],
//   spectators:[{peer,name}], hostPeer }
```
The host loop (`IS.host.step(hs, peersArray, nowMs) -> newHs`) is pure and lives in host.js;
client.js runs it when `isHost()` and publishes the result.

### 4.8 main.js (lead)
Game loop, keyboard input (WASD/arrows move, E/Space use, Q kill, R report, V vent, Tab map),
local movement through `IS.map.moveCircle`, nearest-interactable detection, wiring
UI handlers ↔ client actions ↔ tasks ↔ render, freeplay.

---------------------------------------------------------------------------------------------------
## 5. Look & feel
Dark space theme (single dark look by design): deep navy `#0b1020`, panel `#151c33`, ink `#e8ecff`,
accent amber `#ffcc33`, danger `#ff3b4a`, crew-cyan `#52e0ff`. Display font: Google Fonts
"Russo One" (fallback `system-ui, sans-serif`); body font "Rubik". Chunky rounded buttons with
thick dark outlines, like a cartoon space game. Everything must work at 400px phone width.
