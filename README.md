# TrufflePig

A mobile-first 3D forest wander: you're a little pink pig, seen from just behind its head, trotting through an endless pastel afternoon forest.

## Run

```
node tools/serve.mjs
```

Open http://localhost:5173. To play on a phone on the same Wi-Fi, run with `HOST=0.0.0.0` (PowerShell: `$env:HOST='0.0.0.0'; node tools/serve.mjs`) and open the printed address.

No build step: plain ES modules, Three.js from a CDN.

## Hosting

Deployed as a Cloudflare Worker serving static files (`wrangler.jsonc`). The Worker is connected to this GitHub repo with Workers Builds, so every push to `main` deploys automatically. `.assetsignore` lists the repo files that are not part of the site.

## Controls

- **Touch / mouse:** press anywhere and drag. Direction steers; the further you drag from the press point, the faster the pig trots.
- **Keyboard:** WASD / arrows, hold Shift to trot.

## Code

- `src/main.js` – renderer, lights, sky, camera, movement, snort timing
- `src/forest.js` – chunked procedural forest (trees, grass, flowers, rocks), collisions, wind-sway material
- `src/pig.js` – the pig model and its animation
- `src/joystick.js` – floating drag joystick
- `src/hud.js` – truffle counter and heading-up minimap (pig nose = you, barn = home)
- `src/barn.js` – the barn at the starting point
- `src/truffles.js` – hidden truffles: yellow scent mist, the pig's excitement and squeals, digging and the reward
- `src/birds.js` – flocks of songbirds pecking on the forest floor that fly off when the pig gets close
- `src/animals.js` – forest animals on one algorithm: the wolf and bear (on the minimap, growl when you get close, end
  the game if you get too close) and the docile deer, goat, squirrel and moose (stare, then flee)
- `src/creatures.js` – the animal models
- `src/audio.js` – synthesized ambience (breeze, leaves, insects, birds, brook), plus the pig's recorded calls
- `assets/sounds/` – pig recordings from Pixabay, used under the Pixabay Content License:
  freesound_community "pig grunt" (100272) and "pig oink" (47167), magiaz "porco" (326303),
  cartoon_music "pig grunting excitedly" (537017), DRAGON-STUDIO "bird wings" (463212), and
  freesound_community "small creek" (70653), plus wolf sounds DRAGON-STUDIO "howling wolves" (515977) and
  alice_soundz "scary wolf growling" (224086), and bear sounds universfield "bear growl" (191995) and
  gargamel10 "growling bear" (379127), and troll sounds freesound_community "troll idle noises" (29925) and
  "troll roars" (100312); `walking-in-water.mp3` (splashing steps in creeks and puddles) was supplied by the owner
- `src/noise.js` – seeded noise, terrain height, and the stream network (streams follow a noise contour, so they meander endlessly and line up across chunks)
