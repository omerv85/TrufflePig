import * as THREE from 'three';
import { Forest, createForestMaterial, createWaterMaterial, terrainHeight, BARN_POS } from './forest.js';
import { streamDist, waterLevel, waterDepth } from './noise.js';
import { createBarn } from './barn.js';
import { Hud } from './hud.js';
import { TruffleHunt } from './truffles.js';
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

// Sky dome: pastel blue overhead fading into the warm haze, with a soft sun glow.
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
    },
    vertexShader: `varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunCol; uniform vec3 sunDir; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 c = mix(horizon, top, pow(smoothstep(0.0, 0.7, h), 0.8));
        float s = max(dot(d, sunDir), 0.0);
        c += sunCol * (pow(s, 90.0) * 0.8 + pow(s, 8.0) * 0.22);
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
  audio.start();
  started = true;
  joy.enabled = true;
  nextSnort = 3 + Math.random() * 3;
  document.getElementById('start').classList.add('hide');
});

const muteBtn = document.getElementById('mute');
muteBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
muteBtn.addEventListener('click', () => {
  const muted = audio.toggleMute();
  muteBtn.classList.toggle('off', muted);
});

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
  outPos.set(p.x - _fwd.x * CAM_BACK, p.y + CAM_UP, p.z - _fwd.z * CAM_BACK);
  const floor = terrainHeight(outPos.x, outPos.z) + 0.7;
  if (outPos.y < floor) outPos.y = floor;
  outLook.set(p.x + _fwd.x * LOOK_AHEAD, p.y + LOOK_UP, p.z + _fwd.z * LOOK_AHEAD);
}
cameraTargets(camPos, camLook);

// ---------- loop ----------
function update(dt) {
  // Movement from joystick: direction steers, distance from the press point sets speed.
  const inp = started ? readInput() : { x: 0, y: 0, mag: 0 };
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

  forest.update(player.pos, 2);
  if (started) hunt.update(dt, player);
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
  // metres -> pixels for the mist particles
  hunt.setPixelScale(renderer.domElement.height * 0.5 * camera.projectionMatrix.elements[5]);
}
addEventListener('resize', resize);
resize();

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time.value = now / 1000;

  update(dt);

  // Camera stays snugly behind the pig's head.
  cameraTargets(_tmp, camLook);
  camPos.lerp(_tmp, 1 - Math.exp(-10 * dt));
  camera.position.copy(camPos);
  camera.position.y += Math.abs(Math.sin(player.gait)) * 0.02 * Math.min(1, player.speed / 3);
  camera.lookAt(camLook);

  sky.position.copy(camera.position);
  sun.target.position.copy(player.pos);
  sun.position.copy(player.pos).addScaledVector(sunDir, 70);
  motes.update(time.value, player.pos);
  updateSniffLabel();
  hud.drawMap(player, BARN_POS, forest);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// For debugging in the console.
window.__game = { player, forest, camera, audio, hud, hunt, snortNow: () => { nextSnort = 0; } };
