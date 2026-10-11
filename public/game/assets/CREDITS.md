# Asset credits

All third-party assets are open-licensed. Models were converted to GLB with
[glTF-Transform](https://gltf-transform.dev/) (meshopt compression, WebP textures, some
mesh simplification); audio was transcoded to MP3. If a file is missing, the game
falls back to its built-in procedural models and synthesized sound.

## 3D models (`models/`)

| Files | Author | Source | License |
| --- | --- | --- | --- |
| sedan, sports-sedan, suv, suv-luxury, hatchback, taxi, police-car, van, truck, delivery-truck, firetruck, garbage-truck, ambulance, race-car, tractor, boat-large | Kenney ([kenney.nl](https://kenney.nl)) | [pmndrs/market-assets](https://github.com/pmndrs/market-assets) | CC0 1.0 |
| male, survivor-male, survivor-female, skater-male, skater-female (animated characters) | Kenney | pmndrs/market-assets | CC0 1.0 |
| tree-big, tree-small, palm-long, palm-short, formation-rock | Kenney | pmndrs/market-assets | CC0 1.0 |
| low-poly-tree | saravieira | pmndrs/market-assets | CC0 1.0 |
| helicopter | sriniwasjha ([Blendswap #25911](https://blendswap.com/blend/25911)) | pmndrs/market-assets | CC0 1.0 |
| bike (bicycle) | hugodutra ([Blendswap #27768](https://blendswap.com/blend/27768)) | pmndrs/market-assets | CC0 1.0 |
| motorcycle | Kenney | [KenneyNL/Starter-Kit-Racing](https://github.com/KenneyNL/Starter-Kit-Racing) | CC0 1.0 |
| kk_bld_A–H, kk_streetlight, kk_trafficlight_A, kk_bench, kk_firehydrant, kk_dumpster, kk_trash_A | Kay Lousberg ([KayKit](https://kaylousberg.com)) | [KayKit City Builder Bits](https://github.com/KayKit-Game-Assets/KayKit-City-Builder-Bits-1.0) | CC0 1.0 |
| mh_player, mh_ped_*, mh_cop, mh_gang (realistic people) | Built with [MakeHuman](http://www.makehumancommunity.org) / MPFB2 | MakeHuman 1.1 assets | CC0 1.0 |
| mh_anims (82 animation clips, retargeted) | Quaternius, Universal Animation Library 1 & 2 | [quaternius.com](https://quaternius.com) | CC0 1.0 |
| aerobatic_plane | Babylon.js team | [BabylonJS/Assets](https://github.com/BabylonJS/Assets) | CC BY 4.0 |
| rossini-9x ("Rossini 9X", realistic sports car) | Karol Miklas, "Porsche 911 Carrera 4S" ([Sketchfab](https://sketchfab.com/karolmiklas)) | via [pmndrs/examples](https://github.com/pmndrs/examples) (building-live-envmaps) | CC BY-SA 4.0 (this modified version is also CC BY-SA 4.0) |
| vector-gt ("Vector GT", realistic sports car) | Eric Chadwick, Darmstadt Graphics Group GmbH (from a CC0 model by Unity Fan) | [KhronosGroup/glTF-Sample-Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) "CarConcept" | CC BY 4.0 |
| volt3 ("Volt 3", sports car, police, taxi) | Cyberbotics Ltd., Webots TeslaModel3 geometry protos (commit 67d291f) | [cyberbotics/webots](https://github.com/cyberbotics/webots) | CC BY 4.0 |
| courier-van ("Courier Van") | Cyberbotics Ltd., Webots MercedesBenzSprinter protos (wheels added) | [cyberbotics/webots](https://github.com/cyberbotics/webots) | Apache 2.0 |
| gz-hatchback, gz-hatchback-red, gz-prius, gz-suv, gz-pickup, gz-ambulance, gz-firetruck, gz-bus (realistic traffic) | Open Source Robotics Foundation | [osrf/gazebo_models](https://github.com/osrf/gazebo_models) | CC BY 3.0 |

The realistic cars are modified: manufacturer badges, logos and lettering were removed,
meshes simplified, wheels split into separate nodes and textures resized (plain GLB, no
compression extensions). In-game names are fictional and the cars are not endorsed by
any manufacturer. Conversion scripts are in `tools/models/` in the repository; the
Kenney cars remain as a fallback.

Buildings are procedural (`js/world.js`): facades, windows, shopfronts and doors are drawn by a shader on a
grid measured in metres, with a detail texture generated at load time, so they need no downloaded assets.
The KayKit `kk_bld_A`-`H` models are no longer loaded (scaled up to fill a city lot they read as toys).

| ph_fern_02, ph_shrub_sorrel_01, ph_shrub_03, ph_weed_plant_02, ph_rock_07, ph_dry_branches_medium_01 (small plants, rock, driftwood) | Poly Haven artists (Rob Tuytel, Rico Cilliers, Greg Zaal, Jenelle van Heerden and others) | [polyhaven.com](https://polyhaven.com/models) (decimated, normal maps dropped, 512 px textures; `tools/ground/decimate.py`) | CC0 1.0 |

## Textures (`textures/ground/`)

| Files | Source | License |
| --- | --- | --- |
| t_grass (sparse_grass), t_meadow (leafy_grass), t_forest (forest_leaves_02), t_dirt (dry_ground_rocks), t_sand (sand_01), t_wetsand (damp_beach_sand), t_rock (rock_face), t_mud (mud_forest), t_snow (snow_02), bark_oak (bark_brown_02), bark_pine (pine_bark), wood_white (white_planks_clean), wood_weathered (weathered_planks), wall_brick (red_brick_03), wall_stone (stacked_stone_wall) | [Poly Haven](https://polyhaven.com/textures), diffuse maps re-encoded at 1K / 512 px | CC0 1.0 |
| foliage_atlas.webp (leaf clusters, needle branches, reed and dune grass tufts) | Composed by `tools/ground/compose.py` from [ambientCG](https://ambientcg.com) LeafSet024, Foliage001, Foliage002, Foliage004, Foliage007 | CC0 1.0 |

Trees, bushes, hedges, fences and beach furniture are built in code (`js/flora.js`) from these textures.

## Sound effects (`sfx/`)

| Files | Source | License |
| --- | --- | --- |
| smg, rifle, shotgun, rpg, explosion, explosion2, reload, weapon_switch, empty, weapon_pickup, pickup, armor, health, step1–4, punch, hit, fall, splash, ric1–2, aircraft, jet | [Xonotic](https://xonotic.org) ([xonotic-data.pk3dir](https://gitlab.com/xonotic/xonotic-data.pk3dir)) | GPL v3 or later |
| engine, engine_bike, skid, impact | Kenney (skid by Landeplage), [Starter-Kit-Racing](https://github.com/KenneyNL/Starter-Kit-Racing) | CC0 1.0 |
| cash, jump, land | Kenney, [Starter-Kit-3D-Platformer](https://github.com/KenneyNL/Starter-Kit-3D-Platformer) | CC0 1.0 |
| ambience | Kenney, [Starter-Kit-City-Builder](https://github.com/KenneyNL/Starter-Kit-City-Builder) | MIT (the kit's README lists only its sprites and models as CC0) |
| horn, horn2, crash1–3, engine_truck | Godot Engine contributors, [godot-demo-projects/3d/truck_town](https://github.com/godotengine/godot-demo-projects) | MIT |

The police siren is still synthesized in code.

## Music (`music/`, in-car radio)

| File | Track | Source | License |
| --- | --- | --- | --- |
| neon | "Neon" | Xonotic soundtrack ([xonotic-music.pk3dir](https://gitlab.com/xonotic/xonotic-music.pk3dir)) | GPL v3 or later |
| kojinsmokin | "Kojin Smokin" | Xonotic soundtrack | GPL v3 or later |
| sixtyfour | "Sixtyfour" | Xonotic soundtrack | GPL v3 or later |
| gogetem | "Go Get 'Em" | Xonotic soundtrack | GPL v3 or later |
| ninesix | "Ninesix" | Xonotic soundtrack | GPL v3 or later |
| the_comeback | "The Comeback" | Godot demo projects (audio/rhythm_game) | CC0 1.0 |

Radio station names in the game are made up; the tracks are the ones listed above.

## District dressing (feat/map-variety)

No new asset files. District buildings, paving, billboards (invented brands), containers, cranes,
lighthouse, pier and ferris wheel, water towers, chairlift and hillside letters are procedural
geometry and canvas textures generated at load time (`js/districts.js`, `js/dressing.js`).
