# TrufflePig: project guide for Claude sessions

Read this first. It explains what the game is, how the code is laid out, how to ship a change, and the
design decisions the owner (GitHub user `omerv85`) has already made, so you don't undo them.

- Live game: https://trufflepig.o-vertman.workers.dev/ (a Cloudflare Worker named `trufflepig` on the owner's
  Cloudflare account, connected to this GitHub repo with Workers Builds, so every push to `main` is published
  automatically in about a minute). `wrangler.jsonc` makes it a static-assets Worker serving the repo root;
  `.assetsignore` keeps tooling and docs (`CLAUDE.md`, `README.md`, `tools/`, `.claude/`, config files) off the site.
- Repo: https://github.com/omerv85/TrufflePig
- Sister project with the same setup and owner: RatSniper (`C:\Users\User\Documents\RatSniper`), whose `CLAUDE.md`
  this one follows.

## What the game is

A mobile-first 3D forest wander. You are a cute pink pig, seen from just behind its head (first-person-ish
third person, see the owner's sketch: head and ears at the bottom of the screen, forest ahead). The pig roams an
endless, procedurally generated pastel forest on a warm afternoon, follows faint yellow scent mist to truffles
hidden in the ground beside tree trunks, digs them up, and can find its way back to the barn where it started
using the minimap. **Phones play in landscape** (an upright phone gets a "Turn your phone sideways" screen); test at
812×375. Desktop works with mouse or keyboard.

Danger: a **wolf** and a **bear** prowl the forest. Getting too close to either ends the game (game-over screen with
Share and New game). Docile animals (deer, goat, squirrel, moose) wander too: they stare, then flee.

## Files

No build step and no npm dependencies: plain ES modules, Three.js 0.160.0 from jsDelivr via an import map in
`index.html`, the Caveat font from Google Fonts. Ambient sound is synthesized with Web Audio; only the pig's
voice is recorded.
- `index.html`: canvas, HUD (minimap canvas, truffle counter, pause button), full-screen button, start card,
  pause menu, rotate screen, speech bubble, import map, and the Open Graph tags for link previews.
- `src/style.css`: all styles (HUD, joystick, buttons, start card, pause menu, rotate screen, bubble).
- `src/main.js`: entry point. Renderer, lights, sky dome with feather clouds, fog, pollen motes, water ripples,
  camera, input, pause menu (`setPaused`, `applyHalt`), orientation check (`checkOrientation`), full screen
  (`enterFullscreen`), the movement loop, the pig's periodic nose raise (`updateSnort`), wading, and wiring of every
  other module.
- `src/noise.js`: seeded hashing/noise (`hash2`, `mulberry32`, `fbm`), terrain (`baseHeight`, `terrainHeight`)
  and the stream network (`streamDist`, `waterLevel`, `waterDepth`).
- `src/forest.js`: the chunked forest (`Forest`, `buildChunk`), tree/bush/rock/grass/flower/reed props, stream water
  meshes, colliders, truffle placement, `BARN_POS`, and the two shared materials (`createForestMaterial` with wind sway
  and near-camera dither fade, `createWaterMaterial`).
- `src/pig.js`: the pig model (primitives) and `animate()` (trot, ears, tail, nose raise, excitement, digging).
- `src/joystick.js`: floating drag joystick.
- `src/hud.js`: minimap and truffle counter (`Hud`).
- `src/barn.js`: the barn at the start point (`createBarn`), with a box collider.
- `src/truffles.js`: the truffle hunt (`TruffleHunt`): mist particles, scent clouds, excitement, squeals, digging,
  the reward.
- `src/birds.js`: songbirds on the forest floor (`Birds`): little flocks that hop and peck, and burst up and fly
  away when the pig comes close (`SCARE` 4.5 m + 1 m per m/s of pig speed), with the wing-flap recording.
- `src/animals.js`: all forest animals on one algorithm (`Animals` manager, `Creature`): the `SPECIES` table (sizes,
  speeds, stare/attack/calm distances, spawn distances, sounds), spawn `SLOTS`, walk/stare/attack/flee states, growls.
- `src/creatures.js`: the animal models from primitives (`createCreature(kind, size)`): wolf (grey, yellow eyes, broad
  chest, mane, shaggy cheek ruffs), bear (brown, shoulder hump, heavy cheeks), deer (antlers, white tail), goat (white,
  horns, beard), squirrel (bushy tail), moose (palmate antlers, dewlap).
- `src/audio.js`: `Ambience`: synthesized breeze, leaf gusts, insect drone, cicadas, birds, brook, splashes,
  footsteps, digging, chime; recorded pig calls (`loadSamples`, `playSample`).
- `assets/sounds/*.mp3`: pig recordings from Pixabay (Pixabay Content License; credits in `README.md`):
  `pig-grunt.mp3`, `pig-oink.mp3`, `pig-porco.mp3`, `pig-grunting-excitedly.mp3`, plus `bird-wings.mp3` (flock taking off;
  played from 1.3 s because the file starts near-silent), and `creek.mp3` (freesound_community "small creek", the
  brook near streams: a 19.8 s loop with its ends crossfaded in `startCreek`; the old synthesized babble is only a
  fallback if it fails to load). Wolf sounds: `wolf-howl.mp3` (DRAGON-STUDIO "howling wolves", 7.6 s, played once when
  a wolf comes into minimap range) and `wolf-growl.mp3` (alice_soundz "scary wolf growling", 36 s; random 2.6-3.6 s
  slices chained while the wolf stares, and a louder sped-up slice as the snarl when it charges). Bear sounds:
  `bear-growl.mp3` (universfield "bear growl", 1.3 s, played once when a bear comes into minimap range) and
  `bear-growling.mp3` (gargamel10 "growling bear", 6.1 s, sound only in the first 5 s; slices while it stares and as
  it charges). The docile animals are silent (no recordings yet). `intro-girl.mp3`: a little British girl saying
  "Finding truffles is hard... but I bet you can do it! Just follow the yellow mist!", played once 0.8 s after "Tap to
  start" (`playIntro`). Generated with Microsoft's neural TTS voice en-GB-MaisieNeural via the `edge-tts` Python
  package (rate -8%, pitch +12Hz). `hint-girl.mp3`: the same voice saying "There's a truffle nearby! Follow the yellow
  mist!", played once per game when the pig first comes within `HINT_DIST` 22 m of a truffle (`truffles.js`, `hinted`).
- `share.jpg` (1200×630): the link-preview picture WhatsApp and others show (`og:image` in `index.html`). A real
  frame of the game (sunlit pig behind a tree with truffle mist, feather clouds) with "TrufflePig" and "Follow your nose
  to the truffles" drawn on top in Caveat. Made by rendering the scene at 1200×630 in the browser from a staged spot
  (the second-nearest truffle to the barn, 6.5 m away, heading offset -0.35), compositing the text on a 2D canvas and
  saving the JPEG through a temporary local helper. WhatsApp caches previews per link, so a new picture can take a
  while to show up.
- `tools/serve.mjs`: local static server (Node, no packages).
- `wrangler.jsonc`, `.assetsignore`: Cloudflare hosting (see above). `.claude/launch.json`: preview config.

## How to ship a change

1. Edit the files under `src/`, `index.html`, `assets/`.
2. Test (see Testing).
3. Commit and push to `main`; Cloudflare deploys it. Check the Worker's Deployments tab (or the GitHub check on the
   commit) if a deploy seems missing.
4. Tell the owner what changed and that it's live.

Version: a small label under "Tap to start" (`<div id="version">` in `index.html`, e.g. `v0.1`) so the owner can see
which build a phone is showing. **On every push to GitHub, bump it** (v0.1 → v0.2 → …) in the same commit, and tell
the owner the version number you pushed.

Owner preferences:
- For new visual content (new creatures, props, effects), **show it for review**: screenshots from a local preview.
- Keep replies plain and concise. Test at phone size.
- Commit and push only when asked.
- Commit identity for this repo (repo-local git config): `omerv85 <omerv85@users.noreply.github.com>`
  (keeps the real email private, same as RatSniper).
- Git is at `C:\Program Files\Git\cmd\git.exe`; Node.js at `C:\Program Files\nodejs\node.exe`. No `gh` CLI and no
  global `wrangler`. Pushes use the saved GitHub sign-in.

## Testing

- `node tools/serve.mjs` serves http://localhost:5173 (`HOST=0.0.0.0` to open it from a phone on the same Wi-Fi;
  it then prints the LAN address). `.claude/launch.json` has the `trufflepig` config for the browser pane. A server
  started inside a Claude session stops when the session ends; the owner can run it in their own terminal.
- Open it at phone size in landscape (812×375), tap "Tap to start" (it also unlocks audio). The browser pane's
  "mobile" preset is portrait and emulates touch, so it shows the rotate screen; a custom 812×375 size doesn't count
  as a phone. The pane also blocks full screen, so that can only be checked on a real phone. From the console:
  `window.__game = { player, forest, camera, renderer, scene, audio, hud, hunt, birds, animals, setPaused, sky, snortNow }`, e.g. teleport with `player.pos.set(...)`,
  turn with `player.heading`, find truffles with `[...forest.nearbyTruffles(x, z, range)]`, set the counter with
  `hud.setTruffles(n)`, trigger a nose raise with `snortNow()`, put an animal anywhere with
  `animals.spawnAt('bear', x, z, player)` (any kind; replaces the one in its slot). A wolf/bear within 26 m stares,
  within 12 m attacks. The game must be started for animals to move. Modules can be imported directly
  (`await import('/src/noise.js')`) for checks such as `streamDist`.
- If the browser pane is hidden, `requestAnimationFrame` slows or stops, so timed checks see stale state. For logic,
  step it by hand instead, e.g. `for (...) hunt.update(1/30, player)`. That's how the scent trail was verified.
- Audio can't be listened to in a session: check that `audio.samples` has every clip and count `playSample` calls.

## Code map

- Movement (`main.js` `update`): joystick angle steers (turn rate up to `MAX_TURN`), distance from the press point
  sets speed up to `MAX_SPEED` (5.2 m/s); keyboard WASD/arrows, Shift to trot. Collisions: `forest.collide` (tree
  trunks, big rocks, the barn box). The pig follows the terrain and pitches with the slope.
- Camera (`cameraTargets`): `CAM_BACK` 1.75 m behind, `CAM_UP` 1.75 m up, looking `LOOK_AHEAD` 7 m ahead at
  `LOOK_UP`; FOV 72 in portrait, 58 in landscape. Leaves within ~1.8 m of the camera dither away so it never sits
  inside a tree.
- Forest (`forest.js`): `CHUNK` 36 m, `RADIUS` 3 chunks loaded around the pig, built nearest-first, 2 per frame while
  moving. Each chunk is one merged vertex-coloured mesh (+ one water mesh if a stream crosses it), built from a
  per-chunk seed (`hash2(cx, cz, 99)`), so the world is the same every visit. Truffles use their own seed
  (`hash2(cx, cz, 777)`) so changing them doesn't reshuffle the trees.
- Streams (`noise.js`): they follow the 0.5 contour of low-frequency noise, so they meander endlessly and line up
  across chunks; `streamDist` ≈ metres from the centre. Offsets `SOX`/`SOZ` were chosen so no stream crosses the
  barn meadow and the nearest is ~35 m from it. No trees, bushes or big rocks in or right next to the water.
- Minimap (`hud.js`): heading-up, `MAP_RANGE` 70 m (raised from 48 so a wolf or bear shows on the map before it can be seen
  in the haze). Streams are painted into a cached world-aligned layer rebuilt
  every 20 m. Trees from `forest.nearbyColliders`. Map size `clamp(140px, 44vmin, 200px)` (enlarged for the wolf, at
  the owner's request). The stream layer covers 205 m.
- Truffle hunt (`truffles.js`): constants at the top (`SCENT_RANGE`, `WISP_RANGE`, `NEAR`, `DIG_DIST`, `DIG_TIME`).
  `excite` 0..1 (closeness to the nearest truffle, ^1.6, smoothed) drives the pig's body language, sound choice and
  frequency, and cloud frequency/strength.
- Animals (`animals.js`): states `walk` → `alert` → `windup` → `run` → `leap` → `done` (wolf, bear) or `walk` → `alert`
  → `flee` (docile). `animals.attacker` is the one attacking (only one at a time; another predator keeps staring).
  While attacking, `main.js` ignores input, turns the pig to face it, pulls the camera back (`camPull`), skips the truffle hunt, knocks
  the pig onto its side at the pounce (`knock`), then `showGameOver()` freezes the world (`gameOver` is part of
  `halted()`). New game removes all animals and resets the hunt, counter, collected truffles and puts the pig back at the barn.

## Design decisions already made (don't reverse without asking)

World and look
- Pastel afternoon: pastel blue sky fading to a peach haze, warm low sun from the side (`sunDir`) so both the barn's
  front and the pig's back are lit, soft shadows, fog, floating pollen, warm vignette. Low-poly flat-shaded props.
- Light white feather (cirrus) clouds, drawn in the sky shader (`cirrus()`): long thin streaks with fine fibres on a
  flat cloud layer, fading into the haze near the horizon, drifting very slowly with game time.
- The barn (pastel red, cream roof, white X doors) stands just behind the spawn point, doors facing it, in a tree-free
  meadow (`inClearing`).
- Tree leaves never hang lower than `LEAF_CLEAR` 2 m above the highest ground under the canopy (the pig is 1.44 m
  to the ear tips), at the owner's request: low canopies are raised and their trunks stretched (`canopyLift`), without
  changing the random sequence, so the forest layout stays the same.
- Day and night (`main.js` "day and night", `FADE` 180 s, `NIGHT_HOLD` 120 s, 8 min cycle): from the start (and each
  New game) the light fades over 3 min of play through a pink dusk into a moonlit night, stays full night for 2 min
  (owner asked for a longer starry night), then fades back to day over the next 3 min, repeating. `clock.t` only
  advances while playing. Night: dark blue fog and sky, twinkling stars and a moon (sky shader `stars()`, `moonDir`),
  dim bluish moonlight from the moon's side, pollen motes become green fireflies, a blue vignette (`--night`). Audio
  (`setNight`): day insects, cicadas and birdsong fade out; crickets, owl hoots and quiet, muffled distant wolf howls fade
  in (these mean no danger). Gameplay is unchanged. Test with `__game.clock.t = 180` (full night).
- The pig: smooth pink skin. A shell-fur "fuzz" was tried and **removed at the owner's request** (looked weird).

Controls
- Press anywhere and drag; a ring and pink knob show the joystick. Direction steers, distance sets speed.
- Raising its nose does **not** slow the pig down (owner's request).

Screens and buttons
- Pause button in the **top-right corner** (right of the truffle counter); Escape or P on a keyboard. Pause menu:
  a pink "Game paused" banner, Resume, "Sound: on/off" (the only mute control; remembered on the device in
  `localStorage` `tp-muted`), and a green WhatsApp Share button. Paused = everything frozen: movement, wind sway, water, mist, sound (the audio clock is
  suspended). Switching apps or locking the phone pauses the game.
- Phones (`pointer: coarse`) held upright get a full "Turn your phone sideways" screen (tilting phone icon) and the
  game freezes until it's sideways. Desktop browsers are never blocked.
- Full screen: on a phone the first tap anywhere (normally "Tap to start") enters full screen and asks Android to lock
  landscape. Browsers don't allow full screen without a tap, so it can't happen on page load. A full-screen button sits
  bottom-left whenever the game isn't full screen; if the player leaves full screen, only that button brings it back.
  iPhones don't support full screen for web pages, so the button is hidden there.

HUD
- Top left: minimap. Pig nose (pink, two nostrils) at the centre with a view cone; barn icon at its real spot when
  in range; when out of range the barn sits **on the rim line itself** pointing home, with the distance ("94 m")
  just inside next to it. No distance label when the barn is in range.
- Top right: truffle counter (truffle icon + number, bounces on change), then the pause button.
- No share button during play (**moved into the pause menu and the game-over screen at the owner's request**). It
  opens `wa.me` with "I found N truffles in the forest in TrufflePig 🐷 / How many can you find? <game link>"; from
  the game-over screen "I found N truffles in TrufflePig 🐷 before a wolf got me 🐺 / ..." or "... before a bear got me
  🐻" (with 0 truffles: "A bear got me in the forest ..."; `shareText` in `main.js`).
- Game over: dark reddish wash, grey "Game over" banner, "The wolf got you!" / "The bear got you!", "You found N truffles", Share and
  New game. The pause button is hidden and Escape/P do nothing while it's up.
- Wolf and bear on the minimap: grey wolf head with yellow eyes / brown bear head with round ears, only while it's inside the map; a pulsing red glow behind it
  once it's staring or attacking.
- Speech bubble over the pig: only "squee!" / "squee! squee!" when very close to a truffle. The "sniff sniff"
  bubble on the nose raise was **removed at the owner's request**.

Pig behaviour and sounds (owner-chosen mapping)
- Every 5-13 s (more often near a truffle) the pig raises its nose: **"pig grunt"** recording, then quiet
  synthesized sniffs.
- Catching a truffle's scent: **"pig oink"** when it first smells one and each time a drifting yellow cloud reaches
  its snout (at most about once a second; snout twitch). Pitched up and louder as excitement grows.
- Close to a truffle (excite > 0.6, about 20 m): **"porco"** squeals, short slices of its two 2-second phrases, longer
  and louder the closer; sometimes a whole phrase right on top of it. Each call finishes before the next starts.
- Found a truffle: happy bell chime plus **"pig grunting excitedly"** (first 1.5 s of the file).
- Synthesized grunt/squeal remain only as fallbacks if a file fails to load.

Truffles (owner asked for them to be scarce, with a long trail to follow)
- Hidden beside ~1.2% of trees (`trng() < 0.012`): median ~43 m between neighbours, nearest to the barn ~56 m.
  Never in or near water. Dug-up truffles stay gone (`forest.collected`, survives chunk reloads, not saved).
- Invisible in the ground; they give off mist: faint wisps only within `WISP_RANGE` 18 m, a strong steady plume
  from the spot within `NEAR` 7 m.
- Mist and dirt are camera-facing squares in one instanced mesh (`Particles`), not GL point sprites: phone GPUs cap
  point size, which made close-up mist shrink and fade on phones. Phones also draw the mist 1.4× stronger
  (`MIST_BOOST`) because the owner found the yellow fumes hard to see on a phone screen.
- Scent clouds: within `SCENT_RANGE` 75 m, faint yellow clouds appear a few metres ahead in the truffle's direction
  and drift to the pig, fading as they arrive; they don't persist. More frequent and stronger as you close in.
- Excitement: nose up and sniffing the air, looking around, ears perked, faster tail wag, more frequent nose raises.
- Digging starts automatically when the pig reaches the spot (`DIG_DIST`): it stops, turns to face it, digs for
  2.6 s (head down, trotters scraping, dirt flying, scratch sounds), leaves a dug-earth patch; then the truffle pops
  up above the pig's head and spins away, and the counter goes up. Input is ignored while digging.

Streams
- Small streams the pig can wade through: slower in water (up to 40%), splashes instead of footsteps, ripple rings,
  a babbling-brook sound that fades in within ~25 m. Sandy banks, reeds and cattails, pebbles. Shown on the minimap.

Birds
- Up to 3 flocks of 2-5 pastel songbirds (robin, bluebird, finch, sparrow; mostly one species per flock) land
  20-32 m ahead of the pig on dry ground away from trunks, rocks and the barn. They peck and hop; grounded flocks
  over 60 m away are removed. When the pig gets close the whole flock takes off away from it with one wing-flap
  sound (panned and quieter with distance) and is removed after 4 s of flight.

Animals (the owner's design)
- All animals use the same algorithm. At most one wolf, one bear and one docile animal (deer, goat, squirrel or moose,
  picked at random) at a time; a wolf and a bear can be around together. They keep apart: a new animal never appears
  within `MIN_SEP` 45 m of another, and walking animals steer away from each other inside `KEEP_APART` 35 m.
- Bear: same as the wolf, bigger and brown, first after 75 s (then 35-70 s after the last left). **"bear growl"** when it
  comes into map range, **"growling bear"** while it stares and as it charges. Bear head on the map. "The bear got
  you!" and "a bear got me 🐻" in the share text.
- Docile animals: first after 12 s (then 8-20 s after the last one left), appear 75-90 m away (squirrel 55-70 m),
  walk across the pig's path like the wolf, stop and stare (head up, ears twitching; the squirrel sits up) when the
  pig comes close, and flee when it gets too close (deer 24/12 m, moose 24/12, goat 16/8, squirrel 10/5); the deer
  raises its white tail as it bolts. They vanish once 85 m away. Harmless, silent, and not on the minimap.
- Wolf: only one at a time. The first comes after `FIRST_DELAY` 35 s of play, later ones 25-50 s after the last one
  left. It appears 86-96 m away (lost in the haze; its eyes are fogged too), ahead and off to one side, and walks slowly (1.1 m/s) **mostly perpendicular to the
  pig's heading** (a gentle wobble), so it crosses in front of the pig. It keeps 40 m from the barn and leaves for
  good beyond 125 m.
- Coming into minimap range (70 m): it appears on the map and the **"howling wolves"** recording plays (once per
  wolf, at most every 30 s).
- Pig within 26 m: it stops, turns to stare at the pig, crouches, snarls (jaw open, fangs, ears back, hackles up) and
  **growls** ("scary wolf" recording, louder the closer). If the pig backs off past 36 m it slinks away. (Stare/attack distances were
  raised from 16/7 m at the owner's request.)
- Pig within 12 m: a short crouch, a loud snarl, then it charges (10 m/s), leaps over the pig and lands behind it; red
  flash, frightened squeal, the pig is bowled over, and ~1.4 s later the game-over screen.

## Ideas discussed but not built
- Returning to the barn with the truffles as a goal (the reason for the barn and minimap).
- An in-game update check like RatSniper's.
- More Pixabay pig sounds (the owner may pick more from https://pixabay.com/sound-effects/search/pig/).
