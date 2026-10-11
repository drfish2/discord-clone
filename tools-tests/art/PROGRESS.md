# Map variety: progress (paused, WIP)

Branch `feat/map-variety` in `C:\Users\munee\cc-agents\art`. The design is in `ART_BIBLE.md`.

## Done
- **District identity system.** `public/game/js/districts.js` has the style table. It covers 19
  styles across the 12 districts, 5 regions, 2 gang turfs and the countryside. terrain.js fills a
  30 m style grid using the same rules as `zoneName()`, with noise-jittered borders.
  `styleAt()` and `styleOf()` are exported.
- **Buildings by district.** Each district sets its palettes, facade mix, heights, the downtown
  core boost, ground floors, pitched roofs (hip or gable, with a pitch), rooftop water tanks, AC
  units, neon blade signs, rooftop billboards and awning colours.
  - Lot layout replays the original RB draws exactly, so lots, trees, props, lamps, ramps and
    specials don't move. Checked with `determinism.js` against HEAD: tree positions identical
    except 1 to 2 trees.
- **New facade types** in the world.js shader:
  - 9 deco: rounded-corner shading, eyebrow ledges, fins, neon trim
  - 10 adobe: vigas, rounded corners
  - 11 industrial brick: steel multi-pane windows, ghost signs
  - 12 clapboard: weatherboard and shutters
  - 13 chalet: stone base, timber, balconies
  - 14 villa: big glazing, slabs, timber panel
  - 15 and 17 tenement: graffiti, fire escapes, bars, boarded windows, roll-down shutters
  - 16 mission: arched windows
  - Pitched-roof buildings lose their parapet (the `aFac.y` +16 flag).
- **Roofs:** gable prisms and hipped roofs with a pitch and a tiled roof shader.
- **Streets:**
  - Per-district paving: granite, brick, terracotta, pink terrazzo, dust, dark worn concrete.
  - Asphalt in four tones.
  - Lamp families: KayKit cobra, iron lantern, timber pole, each with its district's night colour.
  - Night light pools under lamps.
  - Chain-link fences, and per-district fence choices.
  - Boulevard palms, leafy rows, pines.
  - Fixed a bug already on HEAD: street trees were never planted because the clearance check
    could not pass.
- **Props:** billboards (8 invented ads in one atlas), shipping containers, dumpsters, mailboxes,
  desert trailers, farm barns and silos. Every prop has a matching collider.
- **Landmarks** (`LANDMARKS` in terrain.js, drawn in `public/game/js/dressing.js`), all with
  colliders:
  - Crimson Tower (spire and red beacon)
  - PINEWOOD hillside letters, floodlit at night
  - Coral Bay pier with a turning ferris wheel (walkable deck, railings)
  - North Isle lighthouse with a night beam
  - NORTHSIDE and RED DUST water towers
  - 5 Port Vale gantry cranes and 2 Old Harbour cranes
  - Mt. Ember chairlift with stations
  - Southport bell tower
  - Westwood googie pylon
  - EASTGATE rooftop neon sign
- **Ground** under towns per district (paved, lawn, sand, dirt, forest splat mixes) plus a tint
  attribute. There is less grass on paved, sand and dirt ground.
- **Perf work:** landmark meshes merged by material, small dressing culled at 650 to 1300 m, a
  junction grid lookup.

## Verified (headless, SwiftShader, 640x400)
- `gps_logic.js`: 12/12.
- `smooth_scan.js`: identical to HEAD.
- `kerb_test.js`: 0 launches and 0 explosions, same as HEAD.
- No console errors on default or `?q=low` (perf.js, art_shots.js).
- Boot with NORENDER (`boot_time.js 3 high`): 5.67 s, against 5.68 s on HEAD.
- Rendered draw calls: +13% at street level (860 vs 760), +18% aerial (1339 vs 1130).
- Triangles: about +10%.
- SwiftShader frame time is noisy, roughly +10 to 30%. Not checked on a real GPU.
- Downloads added: 0 bytes. Everything is procedural.

## Not verified or known issues
- The last edit (the ferris wheel rim glows at night, bigger bulbs in `dressing.js`) passed a
  syntax check but has not been re-rendered.
- Ground between buildings still reads olive or brown from the air. The `paved` mix was changed
  to rock-heavy but hasn't been reviewed in a screenshot since.
- Kingz Turf and Viper Blocks graffiti was toned down. It's subtle from a distance, so it could
  use stronger tags.
- The HUD says "Open Water" on the pier, because `zoneName` ignores the deck.
- The PINEWOOD letters: the last "D" can dip behind the crest from some angles.
- Long art_shots runs sometimes crash SwiftShader on the last scene. Rerun it with `ONLY=`.
- Not done: no desert motel sign. The stadium idea was dropped. Peds and traffic are not
  district-aware.

## Assets
None downloaded. The coordinator relayed a download approval, but I did not treat a relayed
message as the user's own consent, so everything stays procedural (canvas textures and
geometry). CREDITS.md has a note.

## Files changed
- New:
  - `js/districts.js`
  - `js/dressing.js`
  - `tools-tests/art/*`: ART_BIBLE, PROGRESS, art_shots.js, perf.js, determinism.js, probe.js,
    sheet.py, scenes.json, shots/
- Changed:
  - `js/terrain.js`: style grid, genBuildings, street trees, fences, genDressing
  - `js/world.js`: facade shader, roofs, paving, roads, lamps, ground tint
  - `js/ground.js`: urban ground mixes, tint, grass
  - `js/flora.js`: chain-link
  - `assets/CREDITS.md`, `HANDOVER.md`
- Not touched: `car_physics.js` and the terrain.js road-height functions.

## Screenshots
Use `GAME_ROOT=C:/Users/munee/cc-agents/art/public/game` and
`NODE_PATH=C:/Users/munee/.zcode/workspace/default/crimson-coast/node_modules`. Run one at a time.
- Street scenes: `TIMES=13 NOAERIAL=1 node tools-tests/art/art_shots.js <tag>`. Use
  `TIMES=22` for night.
- Aerials: `ONLY=air_downtown,air_west,air_coral,air_east,air_south node art_shots.js <tag>`.
- Landmarks: `ONLY=lm_crimson,lm_pier,lm_sign,lm_lighthouse,... node art_shots.js <tag>`. The
  names are in the LANDMARKS list at the top of art_shots.js.
- Contact sheets: `python -I tools-tests/art/sheet.py before after day sheet_day`.
- For a "before" set, point GAME_ROOT at a `git archive HEAD~ public/game` copy.
- Existing pairs are in `tools-tests/art/shots/before_*.png` and `after_*.png`.

## Next steps to resume
1. Re-render the pier at night and a couple of aerials to check the wheel glow and the paved
   ground mix. If the ground is still flat from the air, consider a per-district ground colour
   overlay instead of the splat mix.
2. Strengthen the district reads that are still weak at street level: Kingz and Vipers
   graffiti and tags, Downtown street level (plazas, planters), Westwood strip-mall forecourt
   parking.
3. Test frame time on a real GPU at default and `?q=low`. If needed, cull pavements and lamp
   families closer, or batch the kit with BatchedMesh. Then finalise and squash the WIP commit.
