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
- `src/audio.js` – synthesized ambience (breeze, leaves, insects, birds, brook), plus the pig's recorded calls
- `assets/sounds/` – pig recordings from Pixabay, used under the Pixabay Content License:
  freesound_community "pig grunt" (100272) and "pig oink" (47167), magiaz "porco" (326303),
  cartoon_music "pig grunting excitedly" (537017)
- `src/noise.js` – seeded noise, terrain height, and the stream network (streams follow a noise contour, so they meander endlessly and line up across chunks)
