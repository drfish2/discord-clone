# Asset credits

Every image and sound in `assets/` comes from **Kenney** (https://kenney.nl), released under
**Creative Commons Zero (CC0 1.0)**: http://creativecommons.org/publicdomain/zero/1.0/.
You don't need to give credit under CC0, but we credit Kenney anyway. You can support Kenney at https://kenney.nl/donate.

kenney.nl itself couldn't be reached from the build machine, so the packs were downloaded from these
public GitHub mirrors. Each mirror ships Kenney's original `License.txt` (CC0) or a CC0 `LICENSE`:

| Mirror | Kenney pack(s) used | License file checked |
|---|---|---|
| https://github.com/shorepine/kenney (commit `3694c6879e487c108f55677be7dd2ca75b07cc3b`) | Space Station Kit, Space Kit, Blaster Kit, Factory Kit, Furniture Kit (3D), Space Shooter Redux, Simple Space (2D) | `LICENSE.txt`: Kenney, CC0 |
| https://github.com/Calinou/kenney-interface-sounds | Interface Sounds | `LICENSE.txt`: Kenney, CC0 |
| https://github.com/Calinou/kenney-ui-audio | UI Audio | `LICENSE.txt`: Kenney, CC0 |
| https://github.com/Boyquotes/kenney-digital-audio-for-godot | Digital Audio | `LICENSE`: CC0 1.0 |
| https://github.com/Boyquotes/kenney-impact-sounds-for-godot | Impact Sounds | `LICENSE`: CC0 1.0 |
| https://github.com/Boyquotes/kenney-rpg-audio-for-godot | RPG Audio | `LICENSE`: CC0 1.0 |
| https://github.com/Boyquotes/kenney-sci-fi-sounds-for-godot | Sci-Fi Sounds | `LICENSE`: CC0 1.0 |
| https://github.com/Boyquotes/kenney-music-jingles-for-godot | Music Jingles | `LICENSE`: CC0 1.0 |

## Images (`assets/img/`)

The props and tiles started as Kenney's low-poly 3D models (`.glb`). We rendered them to 2D sprites with a
small software renderer written for this project. It uses flat shading and Kenney's own colormap textures,
and adds a dark outline. Props use a 50° top-down 3/4 view. Floors use a straight top-down view and are
cropped to one tileable model unit. The wall is a straight front view. These derived renders are also CC0.

| Key | File | Source (Kenney pack → file) | Changes |
|---|---|---|---|
| floor_room | img/floor_room.png | Space Station Kit → `floor-detail.glb` | top-down render, 96×96, darkened |
| floor_hall | img/floor_hall.png | Space Station Kit → `floor-panel-straight.glb` | top-down render, 96×96, darkened |
| floor_tech | img/floor_tech.png | Space Station Kit → `floor-panel.glb` | top-down render, 96×96, darkened |
| wall | img/wall.png | Space Station Kit → `wall-banner.glb` | front render, 96×96 |
| prop_table | img/prop_table.png | Space Station Kit → `table-large.glb` | 3/4 render + outline |
| prop_crate | img/prop_crate.png | Blaster Kit → `crate-wide.glb` | 3/4 render (rotated 90°) + outline |
| prop_console | img/prop_console.png | Space Station Kit → `computer-wide.glb` | 3/4 render + outline |
| prop_bed | img/prop_bed.png | Space Station Kit → `bed-single.glb` | 3/4 render + outline |
| prop_engine | img/prop_engine.png | Space Kit → `machine_generatorLarge.glb` | 3/4 render (rotated 90°) + outline |
| prop_reactor | img/prop_reactor.png | Space Kit → `machine_barrelLarge.glb` | 3/4 render + outline |
| prop_plant | img/prop_plant.png | Furniture Kit → `pottedPlant.glb` | 3/4 render + outline |
| prop_chair | img/prop_chair.png | Space Station Kit → `chair-cushion.glb` | 3/4 render + outline |
| prop_screen | img/prop_screen.png | Space Station Kit → `table-display.glb` | 3/4 render + outline |
| prop_barrel | img/prop_barrel.png | Space Kit → `barrel.glb` | 3/4 render + outline |
| vent | img/vent.png | Factory Kit → `hopper-square.glb` | top-down render + outline |
| button | img/button.png | Factory Kit → `button-floor-round.glb` | 3/4 render, button cap recoloured red |
| stars | img/stars.png | Space Shooter Redux → `Backgrounds/black.png` + Simple Space → `star_tiny/small/medium/large.png` | background recoloured to navy and tiled to 512×512; star sprites scattered on top with wrap-around so it tiles seamlessly |

## Sounds (`assets/sfx/`)

All sounds are mono. They were trimmed and peak-normalised with ffmpeg and numpy, then encoded to MP3 (64–80 kbps).
The ambient loop is a 22 kHz 16-bit WAV, so it loops without gaps.

| Key | File | Source (Kenney pack → file) | Changes |
|---|---|---|---|
| click | sfx/click.mp3 | Interface Sounds → `click_001` | — |
| hover | sfx/hover.mp3 | UI Audio → `rollover2` | quieter |
| body | sfx/body.mp3 | Music Jingles → `Hit jingles/jingles_hit_14` | — |
| alarm | sfx/alarm.mp3 | Digital Audio → `high_up` + `high_down` | concatenated ×2 (siren) |
| vote | sfx/vote.mp3 | Interface Sounds → `confirmation_001` | — |
| eject | sfx/eject.mp3 | Sci-Fi Sounds → `thruster_fire_000` | first 2.4 s, fade in/out |
| task | sfx/task.mp3 | Digital Audio → `power_up_8` | — |
| task_step | sfx/task_step.mp3 | Interface Sounds → `toggle_001` | — |
| vent | sfx/vent.mp3 | Sci-Fi Sounds → `impact_metal_000` + Impact Sounds → `impact_metal_heavy_001` | mixed |
| sabotage | sfx/sabotage.mp3 | Digital Audio → `zap_three_tone_down` | — |
| win | sfx/win.mp3 | Music Jingles → `Pizzicato jingles/jingles_pizzi_2` | — |
| lose | sfx/lose.mp3 | Music Jingles → `Pizzicato jingles/jingles_pizzi_1` | — |
| step | sfx/step.mp3 | Impact Sounds → `footstep_concrete_000` | quieter |
| role | sfx/role.mp3 | Sci-Fi Sounds → `low_frequency_explosion_000` | first 1.9 s, fade out |
| door | sfx/door.mp3 | Sci-Fi Sounds → `door_open_000` | — |
| ambient | sfx/ambient.wav | Sci-Fi Sounds → `space_engine_low_000` | seamless loop (tail cross-faded into head), −14 dB, 22 kHz |

## Fonts

The UI loads "Russo One" and "Rubik" from Google Fonts. Both are under the SIL Open Font License 1.1. They aren't
bundled here.

## User-supplied sounds (not open source)

These were supplied by the project owner. Judging by their titles they are sound effects from
the game Among Us (© Innersloth), so they are not covered by the CC0 licence that applies to the
Kenney assets above. Replace them before distributing the game if you don't have the rights.

| Key | File | Source | Edits |
|---|---|---|---|
| `sab_alarm` | `sfx/sab_alarm.wav` | "Sabotage Alarm Among Us Crisis - Sound Effect for editing" (uploaded) | one 2.0 s period cut for a seamless loop, mono 22 kHz, +7 dB |
| `kill` | `sfx/kill.mp3` | "Among Us Kill Sound Effect shorts" (uploaded; replaced the Kenney knife/impact mix) | trimmed to 0.95 s with fade-out, mono |
| `emergency` | `sfx/emergency.mp3` | "Emergency Meeting Call Among us pushing red button - Sound Effect for editing" (uploaded) | leading silence trimmed, 2.1 s with fade-out, mono, +8 dB |
