import * as THREE from 'three';
import { Forest, createForestMaterial, createWaterMaterial, terrainHeight, BARN_POS } from './forest.js';
import { streamDist, waterLevel, waterDepth } from './noise.js';
import { createBarn } from './barn.js';
import { Hud, MAP_RANGE } from './hud.js';
import { TruffleHunt } from './truffles.js';
import { Birds } from './birds.js';
import { Animals } from './animals.js';
import { createPig } from './pig.js';
import { Joystick } from './joystick.js';
import { Ambience } from './audio.js';

// ---------- tuning ----------
const MAX_SPEED = 5.2;      // m/s at full joystick
const MAX_TURN = 2.3;       // rad/s
const PIG_RADIUS = 0.55;
const CAM_BACK = 1.75;      // camera distance behind the pig
const CAM_UP = 1.75;        // camera height above the pig's feet
const LOOK_AHEAD = 7;
const LOOK_UP = 1.25;

// ---------- renderer / scene ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const FOG = new THREE.Color('#f5e6cf');
scene.fog = new THREE.Fog(FOG, 26, 98);
scene.background = FOG;

const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 600);

// Afternoon sun, low and warm.
const sunDir = new THREE.Vector3(0.85, 0.5, -0.3).normalize();
const hemi = new THREE.HemisphereLight('#d6ebff', '#b5d69a', 1.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffe2b6', 2.1);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 140 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);

// Sky dome: pastel blue overhead fading into the warm haze, with a soft sun glow
// and light, feathery white cirrus clouds that drift very slowly.
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(450, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color('#a8d2f0') },
      horizon: { value: FOG.clone() },
      sunCol: { value: new THREE.Color('#fff2cf') },
      sunDir: { value: sunDir },
      moonDir: { value: new THREE.Vector3(-0.42, 0.27, -0.87).normalize() },
      uTime: { value: 0 },
      uNight: { value: 0 },
    },
    vertexShader: `varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunCol; uniform vec3 sunDir; uniform float uTime;
      uniform vec3 moonDir; uniform float uNight;
      varying vec3 vDir;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
        return v;
      }
      // Feather (cirrus) clouds on a flat cloud layer: long wispy streaks with fine fibres.
      float cirrus(vec3 d) {
        vec2 p = d.xz / max(d.y, 0.05) * 2.2;
        p = mat2(0.8, -0.6, 0.6, 0.8) * p + vec2(uTime * 0.006, 0.0);
        p += 0.6 * vec2(fbm(p * 0.5), fbm(p * 0.5 + 7.3)) ;      // curl the streaks a little
        float body = fbm(vec2(p.x * 0.35, p.y * 1.4));           // stretched: long, thin bands
        float fibres = fbm(vec2(p.x * 0.8, p.y * 11.0));         // hair-like strands along them
        float c = smoothstep(0.4, 0.68, body) * (0.4 + 0.6 * fibres);
        return c * smoothstep(0.015, 0.12, d.y);                   // fade into the haze near the horizon
      }
      // Night sky: twinkling stars of a few sizes, scattered on a grid in sky angles.
      float stars(vec3 d) {
        vec2 a = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0))) * 64.0;
        vec2 cell = floor(a), f = fract(a);
        float h = hash(cell);
        if (h < 0.93) return 0.0;
        vec2 at = vec2(hash(cell + 3.1), hash(cell + 7.7)) * 0.6 + 0.2;
        float size = 0.07 + 0.12 * hash(cell + 1.3);
        float s = smoothstep(size, 0.0, length(f - at));
        float tw = 0.65 + 0.35 * sin(uTime * (1.5 + 3.0 * hash(cell + 5.0)) + h * 60.0);
        return s * tw * (0.5 + 0.5 * (h - 0.93) / 0.07);
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 c = mix(horizon, top, pow(smoothstep(0.0, 0.7, h), 0.8));
        float s = max(dot(d, sunDir), 0.0);
        float cl = cirrus(d);
        vec3 cloudCol = mix(vec3(1.0, 0.995, 0.985), sunCol, pow(s, 4.0) * 0.6);
        cloudCol = mix(cloudCol, vec3(0.13, 0.16, 0.26), uNight);  // clouds go dusky at night
        c = mix(c, cloudCol, cl * mix(0.8, 0.35, uNight));
        c += sunCol * (pow(s, 90.0) * 0.8 + pow(s, 8.0) * 0.22) * (1.0 - uNight);
        if (uNight > 0.01) {
          float up = smoothstep(0.03, 0.3, d.y);
          c += vec3(0.92, 0.95, 1.0) * stars(d) * up * (1.0 - cl) * smoothstep(0.35, 0.9, uNight);
          float m = max(dot(d, moonDir), 0.0);
          float disc = smoothstep(0.99955, 0.9997, m);
          vec3 moon = vec3(1.0, 0.97, 0.88) * disc * (0.85 + 0.15 * fbm(d.xy * 400.0));
          c += (moon + vec3(0.45, 0.55, 0.8) * (pow(m, 300.0) * 0.35 + pow(m, 12.0) * 0.08)) * smoothstep(0.3, 0.8, uNight);
        }
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  })
);
sky.frustumCulled = false;
sky.renderOrder = -1;
scene.add(sky);

// Floating pollen / dust motes catching the light.
const motes = (() => {
  const N = 220, AREA = 34, H = 7;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * AREA;
    pos[i * 3 + 1] = Math.random() * H;
    pos[i * 3 + 2] = (Math.random() - 0.5) * AREA;
    seed[i] = Math.random() * 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(255,255,240,1)');
  grd.addColorStop(1, 'rgba(255,255,240,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  const mat = new THREE.PointsMaterial({
    size: 0.09, map: new THREE.CanvasTexture(c), color: '#fff3cf',
    transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  const base = pos.slice();
  return {
    mat,
    update(t, center) {
      for (let i = 0; i < N; i++) {
        const s = seed[i];
        let x = base[i * 3] + Math.sin(t * 0.3 + s) * 0.8;
        let z = base[i * 3 + 2] + Math.cos(t * 0.25 + s * 1.3) * 0.8;
        // wrap around the camera so the motes never run out
        x = ((x - center.x) % AREA + AREA * 1.5) % AREA - AREA / 2 + center.x;
        z = ((z - center.z) % AREA + AREA * 1.5) % AREA - AREA / 2 + center.z;
        pos[i * 3] = x;
        pos[i * 3 + 1] = terrainHeight(x, z) + 0.3 + ((base[i * 3 + 1] + t * 0.08 + Math.sin(t + s) * 0.2) % H);
        pos[i * 3 + 2] = z;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
})();

// ---------- day and night ----------
// The light fades from afternoon through a pink dusk into a moonlit night over CYCLE/2 seconds
// of play, then back to day over the next CYCLE/2, and so on. Only the look and the ambience
// change; the game plays the same.
const CYCLE = 360;
const clock = { t: 0 };   // seconds of play since the game (or a new game) started
const dn = (day, dusk, night) => [new THREE.Color(day), new THREE.Color(dusk), new THREE.Color(night)];
const PAL = {
  fog: dn('#f5e6cf', '#e8aa98', '#121a34'),
  top: dn('#a8d2f0', '#8c97cf', '#050a1e'),
  sunCol: dn('#fff2cf', '#ffc39a', '#9fb4e8'),
  hemiSky: dn('#d6ebff', '#c9b6e6', '#5a74b8'),
  hemiGround: dn('#b5d69a', '#b39a8c', '#1a2433'),
  light: dn('#ffe2b6', '#ffaa80', '#a9bdff'),
  motes: dn('#fff3cf', '#ffe0a8', '#d8ff6a'),
};
const DUSK = 0.4; // where on the way to night the pink dusk peaks
function pal(key, n, out) {
  const [a, b, c] = PAL[key];
  return n < DUSK ? out.copy(a).lerp(b, n / DUSK) : out.copy(b).lerp(c, (n - DUSK) / (1 - DUSK));
}
const lerp = (a, b, k) => a + (b - a) * k;
const moonDir = sky.material.uniforms.moonDir.value;
const lightDir = new THREE.Vector3();
let night = 0;
// 0 = day, 1 = night. Eased, so it lingers a little at full day and full night.
function nightAt(t) {
  const p = (t % CYCLE) / CYCLE;
  const tri = p < 0.5 ? p * 2 : 2 - p * 2;
  return tri * tri * (3 - 2 * tri);
}
function applyDayNight(n) {
  night = n;
  pal('fog', n, FOG);  // scene.fog.color and the background share this colour
  scene.fog.color.copy(FOG);
  const u = sky.material.uniforms;
  u.horizon.value.copy(FOG);
  pal('top', n, u.top.value);
  pal('sunCol', n, u.sunCol.value);
  u.uNight.value = n;
  pal('hemiSky', n, hemi.color);
  pal('hemiGround', n, hemi.groundColor);
  hemi.intensity = lerp(1.9, 0.85, n);
  pal('light', n, sun.color);
  sun.intensity = n < 0.5 ? lerp(2.1, 1.0, n / 0.5) : lerp(1.0, 0.7, (n - 0.5) / 0.5);
  lightDir.copy(sunDir).lerp(moonDir, smooth(Math.min(1, Math.max(0, (n - 0.3) / 0.5)))).normalize();
  // pollen motes turn into fireflies
  pal('motes', n, motes.mat.color);
  motes.mat.size = lerp(0.09, 0.15, n);
  document.documentElement.style.setProperty('--night', n.toFixed(3));
  audio.setNight(n);
}

// Expanding rings on the water when the pig wades.
const ripples = (() => {
  const geo = new THREE.RingGeometry(0.42, 0.5, 32).rotateX(-Math.PI / 2);
  const pool = [];
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false;
    m.renderOrder = 2;
    m.userData.t = 1;
    scene.add(m);
    pool.push(m);
  }
  let next = 0;
  return {
    spawn(x, z, size) {
      const m = pool[next];
      next = (next + 1) % pool.length;
      m.position.set(x, waterLevel(x, z) + 0.04, z);
      m.userData.t = 0;
      m.userData.size = size;
      m.visible = true;
    },
    update(dt) {
      for (const m of pool) {
        if (!m.visible) continue;
        const t = (m.userData.t += dt / 1.3);
        if (t >= 1) { m.visible = false; continue; }
        m.scale.setScalar(0.5 + t * 3 * m.userData.size);
        m.material.opacity = 0.7 * (1 - t);
      }
    },
  };
})();

// ---------- world ----------
const time = { value: 0 };
const forest = new Forest(scene, createForestMaterial(time), createWaterMaterial(time));

const pig = createPig();
scene.add(pig.root);

const player = {
  pos: new THREE.Vector3(0, terrainHeight(0, 0), 0),
  heading: 0,
  speed: 0,
  turnVel: 0,
  gait: 0,
  pitch: 0,
};
forest.update(player.pos, Infinity);
createBarn(scene, forest, BARN_POS);
const hud = new Hud();

// ---------- input ----------
const joy = new Joystick(document.getElementById('touch'));
const keys = new Set();
addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

function readInput() {
  const j = joy.read();
  if (j.mag > 0) return j;
  let x = 0, y = 0;
  if (keys.has('ArrowLeft') || keys.has('KeyA')) x -= 1;
  if (keys.has('ArrowRight') || keys.has('KeyD')) x += 1;
  if (keys.has('ArrowUp') || keys.has('KeyW')) y -= 1;
  if (keys.has('ArrowDown') || keys.has('KeyS')) y += 1;
  const run = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1 : 0.6;
  const m = Math.hypot(x, y);
  return m ? { x: (x / m) * run, y: (y / m) * run, mag: run } : { x: 0, y: 0, mag: 0 };
}

// ---------- audio / UI ----------
const audio = new Ambience();
let started = false;

document.getElementById('play').addEventListener('click', () => {
  // on phones, starting also goes full screen (same as RatSniper); must run inside this tap's click
  if (isTouch() && fsSupported && !isFullscreen()) enterFullscreen();
  audio.start();
  audio.playIntro();
  started = true;
  nextSnort = 3 + Math.random() * 3;
  document.getElementById('start').classList.add('hide');
  pauseBtn.classList.remove('hidden');
  applyHalt();
});

// ---------- pause menu & orientation ----------
// The world freezes (movement, wind, mist, sound) while paused or while a phone is held upright.
const pauseBtn = document.getElementById('pause-btn');
const pauseEl = document.getElementById('pause');
const soundBtn = document.getElementById('sound');
const rotateEl = document.getElementById('rotate');
let paused = false;
let needsRotate = false;
let gameOver = false;
const halted = () => paused || needsRotate || gameOver;

function applyHalt() {
  const h = halted();
  joy.enabled = started && !h;
  if (h) { joy.cancel(); keys.clear(); }
  audio.setPaused(h);
}

function setPaused(p) {
  if (!started || gameOver) return;
  paused = p;
  pauseEl.classList.toggle('hidden', !p);
  applyHalt();
}

pauseBtn.classList.add('hidden'); // shown once the game starts
pauseBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
pauseBtn.addEventListener('click', () => setPaused(true));
document.getElementById('resume').addEventListener('click', () => setPaused(false));
addEventListener('keydown', (e) => { if (e.code === 'Escape' || e.code === 'KeyP') setPaused(!paused); });
// Leaving the app (switching apps, locking the phone) pauses the game.
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });

// Sound on/off lives in the pause menu and is remembered on this device.
function showSound() {
  soundBtn.textContent = audio.muted ? 'Sound: off' : 'Sound: on';
  soundBtn.setAttribute('aria-pressed', String(!audio.muted));
}
try { audio.muted = localStorage.getItem('tp-muted') === '1'; } catch {}
showSound();
soundBtn.addEventListener('click', () => {
  audio.toggleMute();
  try { localStorage.setItem('tp-muted', audio.muted ? '1' : '0'); } catch {}
  showSound();
});

// Phones must be held sideways; an upright phone gets the "turn your phone" screen.
const isPhone = matchMedia('(pointer: coarse)').matches;
function checkOrientation() {
  needsRotate = isPhone && innerHeight > innerWidth;
  rotateEl.classList.toggle('hidden', !needsRotate);
  applyHalt();
}
addEventListener('resize', checkOrientation);
addEventListener('orientationchange', checkOrientation);
checkOrientation();

// ---------- full screen ----------
// Browsers only allow full screen from a tap, so phones go full screen when "Tap to start" is
// tapped. The bottom-left button offers it again whenever it's off.
// iPhones don't support full screen for web pages, so the button stays hidden there.
const fsBtn = document.getElementById('fs-btn');
const docEl = document.documentElement;
const fsSupported = !!(docEl.requestFullscreen || docEl.webkitRequestFullscreen);
const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

async function enterFullscreen() {
  try {
    if (docEl.requestFullscreen) await docEl.requestFullscreen({ navigationUI: 'hide' });
    else docEl.webkitRequestFullscreen();
  } catch {}
  try { await screen.orientation?.lock?.('landscape'); } catch {} // Android: keep it sideways
}
function showFsButton() { fsBtn.classList.toggle('hidden', !fsSupported || isFullscreen()); }
document.addEventListener('fullscreenchange', showFsButton);
document.addEventListener('webkitfullscreenchange', showFsButton);
showFsButton();

fsBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
fsBtn.addEventListener('click', enterFullscreen);
// ---------- WhatsApp share ----------
// In the pause menu and on the game-over screen: opens WhatsApp (the app on phones, WhatsApp Web
// on desktop) with a message saying how many truffles were found and inviting the friend to beat it.
const GAME_URL = 'https://trufflepig.o-vertman.workers.dev/';
const plural = (n) => `${n} truffle${n === 1 ? '' : 's'}`;
const KILLER = { wolf: ['a wolf', '🐺'], bear: ['a bear', '🐻'] };
// caughtBy: the kind of animal that ended the game ('wolf' / 'bear'), or null from the pause menu.
function shareText(n, caughtBy) {
  const k = KILLER[caughtBy];
  const found = k
    ? (n === 0 ? `${k[0][0].toUpperCase() + k[0].slice(1)} got me in the forest in TrufflePig 🐷${k[1]}` : `I found ${plural(n)} in TrufflePig 🐷 before ${k[0]} got me ${k[1]}`)
    : (n === 0 ? "I'm hunting for truffles in the forest in TrufflePig 🐷" : `I found ${plural(n)} in the forest in TrufflePig 🐷`);
  return `${found}
How many can you find? ${GAME_URL}`;
}
let caughtBy = null;
function share(by) {
  window.open('https://wa.me/?text=' + encodeURIComponent(shareText(hud.truffles, by)), '_blank', 'noopener');
}
document.getElementById('pause-share').addEventListener('click', () => share(null));
document.getElementById('go-share').addEventListener('click', () => share(caughtBy));

function isTouch() { return isPhone || 'ontouchstart' in window; }

const sniffEl = document.getElementById('sniff');
function showBubble(text) {
  sniffEl.textContent = text;
  sniffEl.classList.remove('show');
  void sniffEl.offsetWidth; // restart animation
  sniffEl.classList.add('show');
}

// ---------- truffle hunt ----------
const hunt = new TruffleHunt({
  scene, forest, audio,
  onFound: () => hud.setTruffles(hud.truffles + 1),
  onSqueal: (e) => { if (!sniffEl.classList.contains('show')) showBubble(e > 0.8 ? 'squee! squee!' : 'squee!'); },
});

// ---------- birds on the forest floor ----------
const birds = new Birds({ scene, forest, audio });

// ---------- forest animals: wolf and bear (danger, and the way the game ends), deer, goat, squirrel, moose ----------
const flashEl = document.getElementById('flash');
const gameOverEl = document.getElementById('gameover');
let knock = 0;      // 0..1 the pig bowled over by a wolf or bear
let knocked = false;
let camPull = 0;    // 0..1 camera pulls back to show the attack
const animals = new Animals({
  scene, forest, audio, barn: BARN_POS, mapRange: MAP_RANGE,
  onPounce: () => {
    knocked = true;
    flashEl.classList.remove('hit');
    void flashEl.offsetWidth;
    flashEl.classList.add('hit');
    audio.playSample('porco', { offset: 0.1, duration: 0.7, rate: 1.25, vol: 1.1, fade: 0.04 }); // a frightened squeal
  },
  onGameOver: (kind) => showGameOver(kind),
});

function showGameOver(kind) {
  gameOver = true;
  caughtBy = kind;
  document.getElementById('go-why').textContent = `The ${kind} got you!`;
  const n = hud.truffles;
  document.getElementById('go-count').textContent = n;
  document.getElementById('go-word').textContent = n === 1 ? 'truffle' : 'truffles';
  gameOverEl.classList.remove('hidden');
  pauseBtn.classList.add('hidden');
  applyHalt();
}

// New game: back to the barn with an empty basket; the truffles grow back.
document.getElementById('new-game').addEventListener('click', () => {
  animals.reset();
  hunt.reset();
  forest.collected.clear();
  hud.setTruffles(0);
  clock.t = 0; // a new game starts in the afternoon again
  player.pos.set(0, terrainHeight(0, 0), 0);
  Object.assign(player, { heading: 0, speed: 0, turnVel: 0, pitch: 0 });
  knock = 0; knocked = false; camPull = 0;
  snortT = -1; nextSnort = 3 + Math.random() * 3;
  flashEl.classList.remove('hit');
  forest.update(player.pos, Infinity);
  cameraTargets(camPos, camLook);
  gameOver = false;
  gameOverEl.classList.add('hidden');
  pauseBtn.classList.remove('hidden');
  applyHalt();
});

// ---------- snort behaviour ----------
const SNORT_LEN = 1.7;
let snortT = -1;
let nextSnort = 6;
let lastStepSign = 1;

function updateSnort(dt) {
  if (snortT < 0) {
    nextSnort -= dt * (1 + 2 * hunt.excite); // sniffs the air more often near a truffle
    if (nextSnort <= 0 && started && !hunt.digging) {
      snortT = 0;
      audio.snort();
    }
    return { lift: 0, sniff: 0 };
  }
  const prev = snortT;
  snortT += dt;
  const crossed = (t) => prev < t && snortT >= t;
  if (crossed(0.42)) audio.sniff();
  if (crossed(0.72)) audio.sniff();
  if (crossed(1.0) && Math.random() < 0.5) audio.sniff();

  const t = snortT;
  const lift = t < 0.3 ? smooth(t / 0.3) : t < 1.25 ? 1 : 1 - smooth((t - 1.25) / (SNORT_LEN - 1.25));
  const wig = (c) => Math.max(0, 1 - Math.abs(t - c) / 0.09);
  const sniff = Math.max(wig(0.46), wig(0.76), wig(1.04));
  if (snortT >= SNORT_LEN) {
    snortT = -1;
    nextSnort = 5 + Math.random() * 8;
  }
  return { lift: Math.max(0, lift), sniff };
}
const smooth = (x) => x * x * (3 - 2 * x);
const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);

// ---------- camera ----------
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _tmp = new THREE.Vector3();

function cameraTargets(outPos, outLook) {
  const h = player.heading, p = player.pos;
  _fwd.set(-Math.sin(h), 0, -Math.cos(h));
  const back = CAM_BACK + 2.6 * camPull, up = CAM_UP + 0.8 * camPull;
  outPos.set(p.x - _fwd.x * back, p.y + up, p.z - _fwd.z * back);
  const floor = terrainHeight(outPos.x, outPos.z) + 0.7;
  if (outPos.y < floor) outPos.y = floor;
  const ahead = LOOK_AHEAD - 4 * camPull;
  outLook.set(p.x + _fwd.x * ahead, p.y + LOOK_UP - 0.3 * camPull, p.z + _fwd.z * ahead);
}
cameraTargets(camPos, camLook);

// ---------- loop ----------
function update(dt) {
  // Movement from joystick: direction steers, distance from the press point sets speed.
  const attacker = animals.attacker;
  const attacked = !!attacker;
  const inp = started && !attacked ? readInput() : { x: 0, y: 0, mag: 0 };
  let targetSpeed = 0, targetTurn = 0;
  if (inp.mag > 0.08) {
    const ang = Math.atan2(inp.x, -inp.y); // 0 = straight ahead, +right
    targetTurn = -THREE.MathUtils.clamp(ang, -1.5, 1.5) / 1.5 * MAX_TURN * Math.min(1, inp.mag * 1.8);
    const forwardness = 0.3 + 0.7 * Math.max(0, Math.cos(ang));
    targetSpeed = MAX_SPEED * Math.pow(inp.mag, 1.3) * forwardness;
  }
  const sn = updateSnort(dt); // raising its nose doesn't slow the pig down

  // While digging the pig stays put and turns to face the spot.
  if (hunt.digging) {
    targetSpeed = 0;
    const t = hunt.target;
    const want = Math.atan2(-(t.x - player.pos.x), -(t.z - player.pos.z));
    let diff = want - player.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    targetTurn = THREE.MathUtils.clamp(diff * 6, -MAX_TURN, MAX_TURN);
  }

  // A wolf or bear is charging: the pig freezes and turns to face it.
  if (attacked) {
    targetSpeed = 0;
    const w = attacker.pos;
    const want = Math.atan2(-(w.x - player.pos.x), -(w.z - player.pos.z));
    const diff = Math.atan2(Math.sin(want - player.heading), Math.cos(want - player.heading));
    targetTurn = knocked ? 0 : THREE.MathUtils.clamp(diff * 8, -6, 6);
  }
  camPull = damp(camPull, attacked ? 1 : 0, 3, dt);

  // Wading through a stream slows the pig down.
  const depth = waterDepth(player.pos.x, player.pos.z);
  const inWater = depth > 0.04;
  targetSpeed *= 1 - 0.4 * Math.min(1, Math.max(0, depth) / 0.3);

  player.speed = damp(player.speed, targetSpeed, 5, dt);
  player.turnVel = damp(player.turnVel, targetTurn, 8, dt);
  player.heading += player.turnVel * dt;

  _fwd.set(-Math.sin(player.heading), 0, -Math.cos(player.heading));
  player.pos.addScaledVector(_fwd, player.speed * dt);
  forest.collide(player.pos, PIG_RADIUS);
  player.pos.y = damp(player.pos.y, terrainHeight(player.pos.x, player.pos.z), 14, dt);

  // Pitch the pig along the slope.
  const hF = terrainHeight(player.pos.x + _fwd.x * 0.6, player.pos.z + _fwd.z * 0.6);
  const hB = terrainHeight(player.pos.x - _fwd.x * 0.6, player.pos.z - _fwd.z * 0.6);
  player.pitch = damp(player.pitch, Math.atan2(hF - hB, 1.2), 8, dt);

  // Gait + footsteps
  const speedNorm = Math.min(1, player.speed / MAX_SPEED);
  player.gait += player.speed * dt * 3.0;
  const stepSign = Math.sign(Math.sin(player.gait));
  if (stepSign !== lastStepSign && player.speed > 0.6) {
    if (inWater) {
      audio.splash(speedNorm);
      ripples.spawn(player.pos.x + _fwd.x * 0.3, player.pos.z + _fwd.z * 0.3, 0.8 + speedNorm * 0.6);
    } else audio.step(speedNorm);
  }
  lastStepSign = stepSign;
  if (inWater && player.speed < 0.6 && Math.random() < dt * 0.8) ripples.spawn(player.pos.x, player.pos.z, 0.6);
  ripples.update(dt);

  // Babbling brook gets louder near water.
  audio.setWater(1 - smooth(Math.min(1, Math.max(0, (streamDist(player.pos.x, player.pos.z) - 2) / 26))));

  if (knocked) knock = Math.min(1, knock + dt / 0.35);
  pig.root.position.copy(player.pos);
  pig.root.rotation.y = player.heading;
  pig.root.rotation.x = player.pitch;
  pig.animate(dt, {
    speedNorm: Math.min(1, player.speed / 3),
    gait: player.gait,
    turn: player.turnVel / MAX_TURN,
    snort: sn.lift,
    sniff: Math.max(sn.sniff, hunt.smell),
    excite: hunt.excite,
    dig: hunt.digAmount,
    digPhase: hunt.digPhase,
  });
  if (knock > 0) pig.root.rotation.z = smooth(knock) * 1.4; // bowled over onto its side

  forest.update(player.pos, 2);
  if (started && !attacked) hunt.update(dt, player);
  if (started) animals.update(dt, player);
  birds.update(dt, player, started);
}

const _headWorld = new THREE.Vector3();
function updateSniffLabel() {
  if (!sniffEl.classList.contains('show')) return;
  pig.head.getWorldPosition(_headWorld);
  _headWorld.y += 0.75;
  _headWorld.project(camera);
  sniffEl.style.left = ((_headWorld.x + 1) / 2) * innerWidth + 'px';
  sniffEl.style.top = ((1 - _headWorld.y) / 2) * innerHeight + 'px';
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = camera.aspect < 1 ? 72 : 58;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let last = performance.now();
let gameTime = 0; // advances only while the game runs, so wind and water freeze on pause
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!halted()) {
    gameTime += dt;
    time.value = gameTime;
    sky.material.uniforms.uTime.value = gameTime;
    if (started) clock.t += dt;
    update(dt);
  }

  // Camera stays snugly behind the pig's head.
  cameraTargets(_tmp, camLook);
  camPos.lerp(_tmp, 1 - Math.exp(-10 * dt));
  camera.position.copy(camPos);
  camera.position.y += Math.abs(Math.sin(player.gait)) * 0.02 * Math.min(1, player.speed / 3);
  camera.lookAt(camLook);

  sky.position.copy(camera.position);
  sun.target.position.copy(player.pos);
  applyDayNight(nightAt(clock.t));
  sun.position.copy(player.pos).addScaledVector(lightDir, 70);
  motes.update(time.value, player.pos);
  updateSniffLabel();
  hud.drawMap(player, BARN_POS, forest, animals.mapIcons());

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// For debugging in the console.
window.__game = { player, forest, camera, renderer, scene, audio, hud, hunt, birds, animals, setPaused, sky, clock, snortNow: () => { nextSnort = 0; } };
