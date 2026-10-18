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

* **Self-hosted with voice chat:** the Discord clone's Next.js app serves a second build at
  `/among-us` that uses LiveKit for both multiplayer and proximity voice (see below).

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
* 25 cosmetic hats, picked in the menu or the lobby.
* Voice chat (self-hosted build only): proximity voice during play, with volume and stereo pan by
  distance, silence behind walls, and impostors muted in vents. Everyone talks in meetings, ghosts
  hear everyone but only other ghosts hear them, and talking players get a speaker icon. Open mic
  or push-to-talk (hold `T`).

## Code

Vanilla JS, canvas 2D, no dependencies. See [SPEC.md](SPEC.md) for the architecture and the
network protocol. `node tools/build.mjs` inlines everything (assets as data URIs) into
`dist/index.html`. Art and sound credits are in [assets/CREDITS.md](assets/CREDITS.md).

## Voice chat (self-hosted)

The claude.ai page can't use the microphone, so voice lives in a separate build:

1. Set `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` and `NEXT_PUBLIC_LIVEKIT_URL` for the Next app
   (the same variables the Discord clone's voice channels use). LiveKit server 1.12 or newer.
2. `node among-us-game/tools/build.mjs --selfhost` writes `public/among-us/index.html`.
3. Run the app and open `/among-us`. Tokens come from the public route `/api/among-us/token`.

Without the Next app: `LIVEKIT_URL=… LIVEKIT_API_KEY=… LIVEKIT_API_SECRET=…
node among-us-game/tools/voice-dev-server.mjs` serves the game and signs tokens itself.
The mic needs HTTPS (or localhost).
