# Crimson Coast: handover

State of the GTA-style browser game as of 10 Oct 2026, and what to do next.

- **Playable build:** https://claude.ai/artifact/EsjEdNTA51UfaviiW4ULEA (private; share it from the page's Share menu).
- **Branch:** `claude/gta-style-game-00jt9t`. Pushing to GitHub has failed all session with a 403 because Claude has no access to `drfish2/discord-clone`. Every commit below exists only in the local clone until someone reconnects GitHub (https://claude.ai/customize/connectors) or installs the Claude GitHub App on the repo, and then pushes.

## Running it

- **Standalone:** serve `public/game/` with any static server (`npx serve public/game`) and open `index.html`. ES modules don't load from `file://`.
- **Low quality:** add `?q=low`. This currently only turns off shadows and lowers the resolution.
- **Multiplayer:** open two tabs in the same browser (BroadcastChannel). On claude.ai, players join through the artifact's live room.

## What works now

### Map
- The island is compiled from the user's reference image (`tools/mapgen/reference-map.png`) into `public/game/assets/map/world.json` (4.8 MB) by `tools/mapgen/*.py`. See `tools/mapgen/README.md`.
- Scale: 15 m per pixel, so the map is a 12.4 km square.
- Contents:
  - About 4,000 roads and 53k graph segments, in three classes: main, city and rural.
  - Bridges over water.
  - Five airports.
  - About 28k street-facing buildings.
  - Biomes, districts, two gang turfs, and landmarks (police, hospital, Pay 'n' Spray, start point).
- `js/terrain.js` loads that file and builds the road graph, colliders and ground queries. `js/world.js` builds the meshes:
  - terrain chunks, plus road strips with pavements, curbs, junction patches and crosswalks;
  - bridges with pillars;
  - airports;
  - instanced buildings, trees and lamps, culled per 500 m tile.

### People
- `js/anim.js` drives realistic MakeHuman bodies (`assets/models/mh_*.glb`, CC0) with 82 Quaternius UAL clips (`mh_anims.glb`, CC0) through an AnimationMixer:
  - speed-blended idle, walk, jog and sprint with synced foot phase;
  - an upper-body pistol aim layer;
  - punches, jump and fall, swim, drive or ride, knock-down and get-up, and two deaths.
- `js/characters.js` `animateRig()` sends the rig a state object.
- The Kenney cartoon characters remain as a fallback.
- Pedestrians walk along pavements on the road graph. Gangs spawn inside their turf circles.

### Driving
- `js/car_physics.js` is a raycast vehicle model:
  - suspension and anti-roll bars;
  - combined-slip tyres;
  - engine curve, automatic gearbox and limited-slip differential;
  - ABS and traction control, and countersteer assist;
  - bike lean;
  - impulse collisions with buildings and other cars.
- It runs for the player's car and any car or bike within 170 m (`vehicles.js` `PHYS_R`). Distant traffic uses the old arcade model, with state handed over both ways (`attachPhys`, `pullExternal`, `pushPhys`).
- The engine sound and speedometer read the simulated rpm and gear.
- Helicopters, planes and boats still use the arcade models.

### Gameplay
- Traffic AI and police pursuit, with A* routing on the new graph, and busted / wasted.
- Five missions and pickups placed on the new map; the radio; stunt bonuses.
- Multiplayer through `js/net.js`.

### GPS (newest, `js/gps.js` + `hud.js`)
- Click the full map (M) to set or clear a waypoint. The map zooms with the wheel and pans by dragging.
- The road route is drawn on the radar and the map, with the distance shown under the radar. It re-routes when the player strays more than 35 m.
- Mission objectives are routed automatically when no waypoint is set.
- A* uses a binary heap; a cross-island route takes about 50 ms.
- The routing logic is tested headlessly. **I didn't get a screenshot of the GPS line (the user stopped that step), so check it in a browser.**

## Known problems (fix first)

1. **Driving is bumpy and the car "jumps" (reported by the user).** Measured cause: on hills the terrain pokes up through the road surface. The terrain is a 15 m bilinear grid, while roads sit on their own height profile.
   - In 1.8% of samples across road surfaces the terrain is above the road, by up to 4.7 m.
   - `groundHeight()` in `terrain.js` takes `max(terrain, road)`, so the suspension rays hit those bumps.
   - Fixes:
     - (a) In `groundHeight`, when `roadAt()` finds a road under the point, return the road height instead of the max. This is a few lines; keep bridges and roofs correct through `maxY`.
     - (b) In `tools/mapgen/compile.py`, carve harder: force terrain nodes within `w/2 + 4` m of a road to at most the road height − 0.3. The bilinear cell interpolation is what lets terrain through between nodes, so also clamp the neighbouring nodes. Then re-run `compile.py`.
     - (c) Optionally lift the road mesh (`world.js`, the 0.06 offset in `stripRange`) or render it with a polygon offset.
   - Also check the junction patches and the curb step (`CURB` = 0.15 m pavement) against `car_physics.js`'s `wheelProbe`.
   - Test with the harness script `s_bump.js` (below). Note that its `maxStep1m` figure is inflated: it sampled `groundHeight` with `maxY = 50`, which counts roofs.
2. **Car models are still Kenney low-poly.** Research found usable realistic models (licences checked):
   - Webots Tesla Model 3 (CC-BY 4.0, 12.6k tris, wheels separate), also for the taxi and police recolours;
   - the OSRF Gazebo set (CC-BY 3.0): hatchback, SUV, Prius, pickup, ambulance, bus, fire truck, Cessna;
   - Webots Mercedes Sprinter (Apache-2.0);
   - Porsche 911 by Karol Miklas (CC-BY-SA 4.0);
   - Khronos Car Concept (CC-BY 4.0).
   - **All of those downloads lived in the session's temporary scratch folder and will be gone.** Re-fetch them:
     - Webots: `raw.githubusercontent.com/cyberbotics/webots/<commit>/projects/vehicles/protos/tesla|mercedes_benz/`
     - Gazebo: `raw.githubusercontent.com/osrf/gazebo_models/<commit>/<model>/`
     - Porsche: pmndrs/examples `building-live-envmaps/src/911-transformed.glb`
     - Car Concept: KhronosGroup/glTF-Sample-Assets `Models/CarConcept`
   - Remove logos and give the cars fictional names.
   - Final GLBs must not use meshopt, Draco or KTX2 (see the hosting notes).
3. **The Ultra graphics preset is unfinished.** The paused agent's work is saved as WIP commit `b44bcd2` on local branch `worktree-agent-ad40c8d74005d9917`, in worktree `.claude/worktrees/agent-ad40c8d74005d9917`. It touches `gfx.js` (new), `main.js`, `world.js`, `index.html` and `assets/textures/` (CC0 ambientCG textures), and adds 792 lines. It is **untested**: review it, finish it, and merge it.
   - Intended Ultra pipeline: EffectComposer, then GTAOPass, half-res UnrealBloom (night-aware), OutputPass with AgX, then SMAA.
   - Also intended: Sky.js with a PMREM environment map regenerated when the sun moves; CSM shadows with 4 cascades; Water.js on the sea; height fog; terrain detail textures; grass near the camera.
   - Gotcha: CSM `setupMaterial` overwrites `onBeforeCompile`, which the building window shader and water shader rely on, so chain the hooks.
4. **Enterable shops, banks and gun shops: not started** (user request).
   - Suggested design:
     - Replace a few street-front lots with storefront buildings: a glass front with a door gap, built as wall colliders instead of one solid box.
     - Build interiors from props: shelves, fridges, counter and register, gun cases, bank counter and vault.
     - Put clerk NPCs inside. Buy guns and ammo, buy snacks for health, and rob the counter for cash plus a wanted level. A bank heist mission.
     - Add map blips.
   - Asset research had started; candidates were Kenney furniture or commercial kits and KayKit furniture via GitHub mirrors, plus ambientCG facade textures re-hosted on GitHub. Nothing was finalised.
5. **SwiftShader test renders crash now and then** when many skinned people are on screen. The game logic is fine (NORENDER runs pass). Verify performance on a real GPU, and consider LODs or culling for distant pedestrians.
6. **Boot takes about 13 s headless.** World generation and model decoding are the bulk; consider a loading-time profile.

## Hosting (claude.ai artifact) notes

- The artifact host can't serve `.glb`. The published page sets `window.CC_MODEL_EXT = ".gltf.json"`, and models are converted to glTF JSON with embedded base64.
- The sandbox CSP may block WebAssembly and fetch() of data: and blob: URLs:
  - `assets.js` decodes embedded buffers and images itself (`inlineData` plugin).
  - Published models must not use meshopt or `EXT_texture_webp`.
  - The conversion script strips both. Its logic: read with the meshopt decoder, dispose `EXT_meshopt_compression` and `EXT_texture_webp`, write JSON with data URIs.
- Republishing:
  1. Strip the doctype, html/head/body tags and the charset and viewport metas from `index.html`.
  2. Insert `<script>window.CC_MODEL_EXT = ".gltf.json";</script>` before the `main.js` module script.
  3. Publish with a files map: `js/*.js`, `assets/models/*.gltf.json`, `assets/map/world.json`, and the unchanged `assets/sfx` and `assets/music` already on the artifact.
- The artifact declares the `room` capability (topics hit, shot, boom and died open to Contributors) and `user` (profile scope). Leave `capabilities` out on redeploys to keep them.

## Testing approach used

- Headless Playwright plus Chromium/SwiftShader. A harness routes `cdn.jsdelivr.net` to a local three@0.160.0 copy and serves `public/game` (set `GAME_ROOT` to override).
- `window.__game = {G, step(n, dt)}` steps the simulation without rendering. With `NORENDER=1` the harness strips the render call so logic tests are fast.
- Real renders are very slow and sometimes crash, so keep the viewport small.
- Regression scripts covered: drive, traffic flow and stuck count, police pursuit and busted, combat and rocket, respawn, gangs, multiplayer with two tabs, models under a strict CSP, and GPS.
- The harness and scripts lived in the scratch folder and need recreating. Each is about 30 lines of Playwright.

## Code map

| File | Role |
| --- | --- |
| `js/terrain.js` | Loads `world.json`. Road graph (`nodes`, `segs`, `roads`), ground queries (`groundHeight`, `roadAt`, `onPavement`), colliders, buildings, trees, lamps, airports, places, `streetSpot`, `zoneName` |
| `js/world.js` | Meshes for terrain, roads, pavements, bridges, buildings, nature, lamps and airports; sky, lights, water, day/night |
| `js/assets.js` | Model loading (CSP-safe), vehicle templates, `HUMANS` roster, building `buildCharacterModel` |
| `js/anim.js` | Skeletal animation rig for realistic people |
| `js/car_physics.js` | Raycast vehicle model (from the physics research) |
| `js/vehicles.js` | Vehicle simulation; physics hand-over; arcade heli, plane and boat |
| `js/characters.js` | Pedestrians (pavement walking), gangs, cops |
| `js/traffic.js` | Traffic AI, parked and fixed spawns, pathfinding helpers |
| `js/police.js` | Wanted level, pursuit, arrests |
| `js/gps.js` | A* routing for the GPS |
| `js/hud.js` | Radar, full map (zoom, pan, waypoint), speedometer, messages |
| `js/missions.js` | Missions, pickups, Pay 'n' Spray |
| `js/net.js` | Multiplayer |
| `tools/mapgen/` | Reference map to `world.json` compiler (Python: numpy, scipy, scikit-image, pillow) |
