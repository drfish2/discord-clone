# Crimson Coast

An open-world, GTA-style browser game built with Three.js. No build step: the page loads Three.js from a CDN and everything else is plain ES modules in `js/`.

Vehicles, people, city buildings, street furniture, trees, sound effects and radio music are open-licensed assets from Kenney, KayKit, Blendswap artists, Babylon.js, Xonotic and the Godot demo projects (CC0, CC BY 4.0, MIT and GPL v3+). See [`assets/CREDITS.md`](assets/CREDITS.md). Without the `assets/` folder the game falls back to its procedural models and synthesized sound.

## Running

- With the Next.js app: `npm run dev`, then open `http://localhost:3000/game/index.html`.
- Standalone: serve this folder with any static server (for example `npx serve public/game`) and open it. ES modules don't load from `file://`.
- On slower machines, add `?q=low` to the URL (no shadows, lower resolution).

## The world

A procedurally generated island on a 6 × 6 km map (fixed seed, so it's the same every time). The heightmap uses domain-warped noise for an irregular coastline with bays and offshore islets, and every road and town is kept on dry land. [`heightmap-preview.png`](heightmap-preview.png) shows it:

- **City**: winding streets laid out on a curl-noise-warped grid with an irregular edge, T-junctions and merged blocks. Downtown towers, midtown blocks, residential streets, parks, a plaza, police station, hospital and Pay 'n' Spray.
- **Crimson River**: rises at a mountain tarn below Mt. Ember, meanders downhill through the west side of the city under bridges and reaches the sea on the southwest coast.
- **Gang turf**: the Purple Kingz (northwest) and Red Vipers (southeast) hang out in groups and turn hostile if you shoot near them, attack them, or loiter.
- **Airport** with a runway, hangars, stunt planes, a jet and helicopters.
- **Red Dust Desert** with the town of Sandy Rock, cacti and stunt ramps.
- **Mt. Ember** and Ember Ridge: snowy ridged mountains with a winding pass up to an observatory.
- **Pinewood Forest** and Mirror Lake, Coral Beach, the coastline, and highways linking everything.

## Gameplay

- Steal any vehicle: sedans, hatchbacks, SUVs, sports cars, taxis, vans, pickups, delivery trucks, ambulances, fire trucks, garbage trucks, a race car, a tractor, police cruisers, motorbikes, bicycles, helicopters, planes, a jet and boats.
- In-car radio with six stations.
- Traffic follows the road network; pedestrians walk the sidewalks and flee from gunfire.
- Weapons: fists, pistol, SMG, shotgun, assault rifle, rocket launcher (pickups are marked on the radar). Drive-by shooting works from cars, bikes, boats and helicopters.
- Five-star wanted system: police cruisers path-find to you, box you in and get out to arrest or shoot; at three stars a police chopper with a spotlight joins in. Break line of sight to lose them, or pay $100 at the Pay 'n' Spray.
- BUSTED / WASTED results screen with pursuit stats.
- Five missions (yellow markers): a street race, a car theft, a gang turf war, a desert truck run and a flying course through rings over the mountains.
- Stunt bonuses for air time, a day/night cycle with lit windows and street lamps, a radar minimap and a full map (M).

## Multiplayer

Everyone who has the game open at the same time shares the island. You see the other players (with name tags and radar dots) and the vehicles they drive, and you can shoot, blow up or run each other over; the kill feed shows who wasted whom.

- When the game is published as a claude.ai artifact, players are connected through the artifact's live room, and names come from their Claude accounts.
- Anywhere else, the game connects tabs of the same browser (handy for testing), and each player gets a random callsign.

Each player's own traffic, pedestrians, police and missions are simulated locally and are not shared; only the players themselves (position, vehicle, health and gunfire) are. Damage is decided by the shooter and applied by the victim's game.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move / drive |
| Mouse | Look (click to capture the pointer) |
| F | Enter / exit vehicle (steal occupied ones too) |
| LMB / RMB | Shoot / aim |
| 1–6, wheel | Switch weapon |
| R | Reload |
| Shift | Sprint · helicopter down · plane pitch down |
| Space | Jump · handbrake · helicopter up · plane pitch up |
| Q / E | Helicopter strafe · plane rudder |
| ↑ / ↓ | Plane pitch |
| H | Horn |
| M | Map |
| V | Camera distance |
| T | Skip an hour |
| N | Sound on/off |
| Tab | Change radio station (in vehicles) |
| Esc / P | Pause |

## Code layout

| File | Purpose |
| --- | --- |
| `js/terrain.js` | Heightfield, road graph, city layout, colliders, ground and ray queries |
| `js/world.js` | Meshes for terrain, roads, buildings, nature; sky, lighting, day/night |
| `js/assets.js` | Loads the glTF models, prepares vehicles (wheels, rotors, paint), rigged characters and instanced props |
| `js/models.js` | Vehicle specs; procedural fallback models |
| `js/vehicles.js` | Car/bike/heli/plane/boat physics, damage, vehicle collisions |
| `js/characters.js` | Pedestrians, gangs, police officers on foot |
| `js/player.js` | Player controls, entering/exiting vehicles |
| `js/traffic.js` | Traffic AI, parked cars, fixed vehicle spawns, A* pathfinding |
| `js/police.js` | Wanted level, police pursuit and arrests |
| `js/weapons.js` | Hitscan, rockets, explosions, NPC gunfire |
| `js/missions.js` | Missions, pickups, Pay 'n' Spray, stunt bonuses |
| `js/audio.js` | Sample playback, engine/skid/ambience loops, in-car radio, synthesized fallbacks |
| `js/net.js` | Multiplayer: shares player state, draws other players, relays hits |
| `js/hud.js`, `js/camera.js`, `js/fx.js` | HUD/radar/map, chase camera, particles |
