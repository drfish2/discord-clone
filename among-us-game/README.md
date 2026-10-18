# Starship Sus

An Among-Us-style social deduction game for the browser, with real-time multiplayer for up to
10 players. Crewmates finish tasks around the station and vote out the Impostors. Impostors
sabotage the ship and pick the crew off one by one.

## Play

* **Hosted:** published as a claude.ai Artifact. Multiplayer runs on the Artifact `room`
  capability, so everyone who opens the page can see the open games list and join by code.
* **Locally:** `npx http-server among-us-game -p 8080` and open several tabs of
  `http://localhost:8080`. Outside claude.ai the game falls back to a `BroadcastChannel`
  transport, so the tabs of one browser play together.

Controls: WASD / arrow keys to move, `E`/Space to use, `Q` kill, `R` report, `V` vent,
`Tab` map. On phones you get a joystick and on-screen buttons.

## Features

* Lobby with 4-letter game codes, public game list, colour picker, host-editable settings
  (impostors, kill cooldown, speed, vision, meeting timers, emergency meetings, task count,
  confirm ejects, kill distance).
* Three maps, picked by the host in the lobby settings:
  * **The Starship**: a 14-room spaceship with engines, reactor and a big cafeteria.
  * **Polar Outpost**: a research base on a frozen planet, with buildings linked by snowy
    trails, a dropship, a drill site and a seismic lab.
  * **Sky Headquarters**: a compact HQ above the clouds, with a launchpad, a long
    decontamination corridor, a greenhouse and one big vent network.
* Line-of-sight vision, vents, an emergency button and a minimap on every map.
* 12 task minigames (wires, card swipe, download, fuel, asteroids, engine alignment, distributor
  calibration, garbage, med scan, power diversion, O2 filter, reactor numbers).
* Impostor kills with cooldown, venting, and four sabotages: reactor meltdown (two players
  must hold the scanners), oxygen depletion (two keypads), lights (reduced crew vision), comms
  (hides the task list).
* Body reports, emergency meetings, discussion and voting with chat, ghost chat, ejection
  cinematic, and every win condition (tasks, votes, kills, sabotage, disconnects).
* Host migration: if the host leaves, the next player takes over the running game.
* Freeplay mode for solo practice on any map.

## Code

Vanilla JS, canvas 2D, no dependencies. See [SPEC.md](SPEC.md) for the architecture and the
network protocol. `node tools/build.mjs` inlines everything (assets as data URIs) into
`dist/index.html`. Art and sound credits are in [assets/CREDITS.md](assets/CREDITS.md).
