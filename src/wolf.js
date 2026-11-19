import * as THREE from 'three';
import { terrainHeight } from './noise.js';

// A lone wolf prowling the forest: the danger that can end the game.
// Far away it pads slowly across the pig's path (mostly perpendicular to where the pig is
// heading) and shows on the minimap, howling as it comes into map range. If the pig comes
// close it stops, stares and growls; closer still and it charges, leaps over the pig, and
// the game is over. Only one wolf is ever around at a time.

// ---------- tuning ----------
const FIRST_DELAY = 35;              // seconds of play before the first wolf turns up
const RESPAWN = [25, 50];            // seconds between one wolf leaving and the next arriving
const SPAWN_DIST = [86, 96];         // metres from the pig where a wolf appears (beyond the map, lost in the haze)
const DESPAWN = 125;                 // a wolf this far away slips off into the forest
const WALK_SPEED = 1.1;              // m/s, slow prowl
const ALERT = 26;                    // the pig this close: stop, stare and growl
const ATTACK = 12;                   // the pig this close: charge
const CALM = 36;                     // a staring wolf goes back to prowling once the pig is this far
const BARN_KEEP = 40;                // wolves keep this far from the barn
const RUN_SPEED = 10;                // m/s charge
const LEAP_START = 3.4;              // metres from the pig where the leap starts
const LEAP_TIME = 0.62;
const LEAP_HEIGHT = 2.5;
const SIZE = 1.2;                    // overall model scale (shoulder ~1 m)

const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (x) => x * x * (3 - 2 * x);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ---------- model ----------
// Low-poly grey wolf from primitives. Faces +Z, feet at y = 0.
function createWolfModel() {
  const fur = new THREE.MeshLambertMaterial({ color: '#77727f', flatShading: true });
  const furDark = new THREE.MeshLambertMaterial({ color: '#58535f', flatShading: true });
  const furLight = new THREE.MeshLambertMaterial({ color: '#c3bcc4', flatShading: true });
  const black = new THREE.MeshLambertMaterial({ color: '#2a2630' });
  const mouth = new THREE.MeshLambertMaterial({ color: '#7d2f3d' });
  const tooth = new THREE.MeshLambertMaterial({ color: '#fbf6ea' });
  // bright yellow eyes (unlit; fogged like the rest so they don't give it away before the map does)
  const eye = new THREE.MeshBasicMaterial({ color: '#ffd84a' });

  const ball = (r = 1) => new THREE.IcosahedronGeometry(r, 1);
  const mesh = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    return m;
  };

  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const body = new THREE.Group(); // crouches and pitches; legs stay on the root
  root.add(body);

  body.add(
    mesh(ball(), fur, 0, 0.84, 0, 0.27, 0.29, 0.62),          // torso
    mesh(ball(), furDark, 0, 0.98, -0.05, 0.2, 0.14, 0.55),   // dark saddle along the back
    mesh(ball(), fur, 0, 0.9, 0.42, 0.37, 0.42, 0.36),        // deep, broad chest
    mesh(ball(), furLight, 0, 0.8, 0.6, 0.29, 0.34, 0.22),    // pale ruff
    mesh(ball(), fur, 0, 1.08, 0.5, 0.3, 0.2, 0.26),          // thick mane over the shoulders
    mesh(ball(), fur, 0, 0.84, -0.46, 0.25, 0.27, 0.26),      // haunches
  );

  // Hackles: a ridge of fur spikes that bristles up when it snarls.
  const hackles = new THREE.Group();
  hackles.position.set(0, 1.04, 0.1);
  const spike = new THREE.ConeGeometry(0.05, 0.16, 4);
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(spike, furDark);
    s.position.set(0, 0, 0.3 - i * 0.13);
    s.rotation.x = -0.5;
    hackles.add(s);
  }
  body.add(hackles);

  // Head on a neck pivot.
  const neck = new THREE.Group();
  neck.position.set(0, 1.0, 0.6);
  body.add(neck);
  const head = new THREE.Group();
  head.position.set(0, 0.1, 0.12);
  head.scale.setScalar(1.2);
  neck.add(head);
  head.add(
    mesh(ball(), fur, 0, 0.04, 0, 0.2, 0.18, 0.22),               // skull
    mesh(ball(), furLight, 0.14, -0.05, -0.02, 0.1, 0.13, 0.13),    // big cheek ruffs
    mesh(ball(), furLight, -0.14, -0.05, -0.02, 0.1, 0.13, 0.13),
    mesh(new THREE.BoxGeometry(1, 1, 1), fur, 0, 0.0, 0.25, 0.15, 0.12, 0.26),  // muzzle
    mesh(new THREE.BoxGeometry(1, 1, 1), furLight, 0, -0.04, 0.27, 0.13, 0.06, 0.24),
    mesh(ball(), black, 0, 0.04, 0.39, 0.05, 0.04, 0.035),        // nose
    mesh(ball(0.032), eye, 0.085, 0.09, 0.15),
    mesh(ball(0.032), eye, -0.085, 0.09, 0.15),
    // stern brows over the eyes
    mesh(new THREE.BoxGeometry(1, 1, 1), furDark, 0.08, 0.13, 0.15, 0.08, 0.025, 0.05),
    mesh(new THREE.BoxGeometry(1, 1, 1), furDark, -0.08, 0.13, 0.15, 0.08, 0.025, 0.05),
  );
  head.children[8].rotation.z = -0.35;
  head.children[9].rotation.z = 0.35;
  // shaggy pointed tufts flaring out and down from the cheeks
  const tuftGeo = new THREE.ConeGeometry(0.07, 0.27, 4);
  for (const s of [-1, 1]) {
    for (const [y, z, tilt] of [[-0.02, -0.04, 0.35], [-0.11, -0.01, 0.75]]) {
      const t = new THREE.Mesh(tuftGeo, furLight);
      t.position.set(s * 0.22, y, z);
      t.rotation.z = -s * (Math.PI / 2 + tilt);
      head.add(t);
    }
  }
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(s * 0.1, 0.17, -0.03);
    const e = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.2, 4), furDark);
    e.position.y = 0.09;
    ear.add(e);
    ear.rotation.z = -s * 0.2;
    head.add(ear);
    ears.push(ear);
  }
  // fangs on the upper jaw, red mouth and a lower jaw that opens in a snarl
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.06, 4), tooth);
    f.position.set(s * 0.045, -0.085, 0.33);
    f.rotation.x = Math.PI;
    head.add(f);
  }
  head.add(mesh(new THREE.BoxGeometry(1, 1, 1), mouth, 0, -0.07, 0.24, 0.11, 0.02, 0.2));
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.07, 0.12);
  head.add(jaw);
  jaw.add(mesh(new THREE.BoxGeometry(1, 1, 1), furLight, 0, -0.025, 0.12, 0.11, 0.045, 0.22));
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.013, 0.045, 4), tooth);
    f.position.set(s * 0.04, 0.01, 0.2);
    jaw.add(f);
  }

  // Legs hang from hip/shoulder pivots.
  const legGeo = new THREE.CylinderGeometry(0.075, 0.055, 0.72, 6).translate(0, -0.36, 0);
  const pawGeo = new THREE.SphereGeometry(0.065, 6, 4).scale(1, 0.6, 1.4).translate(0, -0.72, 0.03);
  const legs = [];
  for (const [x, z, front] of [[-0.15, 0.45, 1], [0.15, 0.45, 1], [-0.15, -0.45, 0], [0.15, -0.45, 0]]) {
    const leg = new THREE.Group();
    leg.position.set(x, 0.74, z);
    leg.add(new THREE.Mesh(legGeo, front ? fur : furDark), new THREE.Mesh(pawGeo, furDark));
    leg.userData = { front, side: Math.sign(x) };
    root.add(leg);
    legs.push(leg);
  }

  // Bushy tail.
  const tail = new THREE.Group();
  tail.position.set(0, 0.95, -0.66);
  const t = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), fur);
  t.scale.set(0.1, 0.1, 0.36);
  t.position.z = -0.3;
  const tip = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), furDark);
  tip.scale.set(0.07, 0.07, 0.12);
  tip.position.z = -0.62;
  tail.add(t, tip);
  body.add(tail);

  root.traverse((o) => { if (o.isMesh && o.material !== eye) o.castShadow = true; });
  root.scale.setScalar(SIZE);
  return { root, body, neck, head, jaw, ears, legs, tail, hackles };
}

// ---------- behaviour ----------
export class Wolves {
  constructor({ scene, forest, audio, barn, mapRange, onPounce, onGameOver }) {
    this.scene = scene;
    this.forest = forest;
    this.audio = audio;
    this.barn = barn;
    this.mapRange = mapRange;
    this.onPounce = onPounce;
    this.onGameOver = onGameOver;
    this.m = createWolfModel();
    this.m.root.visible = false;
    scene.add(this.m.root);
    this.reset();
  }

  reset() {
    this.stopGrowl(0.1);
    this.state = 'none';        // none | walk | alert | windup | run | leap | done
    this.timer = FIRST_DELAY;   // until the next wolf arrives
    this.m.root.visible = false;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.side = 1;
    this.gait = 0;
    this.speed = 0;
    this.snarl = 0;             // 0..1 snarl pose
    this.inMap = false;
    this.howlCool = 0;
    this.growlT = 0;
    this.growl = null;
    this.stateT = 0;
    this.seed = Math.random() * 100;
    this.leap = null;
  }

  get active() { return this.state !== 'none'; }
  get attacking() { return this.state === 'windup' || this.state === 'run' || this.state === 'leap' || this.state === 'done'; }
  get visibleOnMap() { return this.active && this.state !== 'done'; }

  // Pig's right-hand direction; the wolf walks along it (side = +1) or against it (-1).
  static right(h) { return [Math.cos(h), -Math.sin(h)]; }

  spawn(player) {
    for (let tries = 0; tries < 10; tries++) {
      // ahead and off to one side, so it crosses in front of the pig
      const a = player.heading + (Math.random() < 0.5 ? -1 : 1) * rand(0.45, 1.25);
      const d = rand(...SPAWN_DIST);
      const x = player.pos.x - Math.sin(a) * d, z = player.pos.z - Math.cos(a) * d;
      if (Math.hypot(x - this.barn.x, z - this.barn.z) < BARN_KEEP + 5) continue;
      this.pos.set(x, terrainHeight(x, z), z);
      const [rx, rz] = Wolves.right(player.heading);
      this.side = (x - player.pos.x) * rx + (z - player.pos.z) * rz > 0 ? -1 : 1;
      this.yaw = Math.atan2(rx * this.side, rz * this.side);
      this.state = 'walk';
      this.stateT = 0;
      this.inMap = false;
      this.m.root.visible = true;
      return true;
    }
    return false;
  }

  update(dt, player) {
    const m = this.m;
    if (this.state === 'none') {
      this.timer -= dt;
      if (this.timer <= 0 && !this.spawn(player)) this.timer = 3;
      return;
    }
    this.stateT += dt;
    this.howlCool -= dt;
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const toPig = Math.atan2(dx, dz);

    // Coming into map range: a howl through the trees.
    const inMap = dist < this.mapRange;
    if (inMap && !this.inMap && this.howlCool <= 0 && this.state === 'walk') {
      this.audio.howl?.({ pan: this.pan(player), vol: 0.9 });
      this.howlCool = 30;
    }
    this.inMap = inMap;

    let targetSpeed = 0, snarl = 0;
    switch (this.state) {
      case 'walk': {
        if (dist > DESPAWN) { this.leave(); return; }
        if (dist < ALERT) { this.setState('alert'); break; }
        // mostly perpendicular to the pig's heading, wandering a little
        const [rx, rz] = Wolves.right(player.heading);
        let wx = rx * this.side, wz = rz * this.side;
        const wob = 0.35 * Math.sin(this.stateT * 0.13 + this.seed);
        let want = Math.atan2(wx, wz) + wob;
        // keep away from the barn
        const bx = this.pos.x - this.barn.x, bz = this.pos.z - this.barn.z;
        if (Math.hypot(bx, bz) < BARN_KEEP) want = Math.atan2(bx, bz);
        this.turnTo(want, 1.2, dt);
        targetSpeed = WALK_SPEED;
        break;
      }
      case 'alert': {
        this.turnTo(toPig, 4, dt);
        snarl = 1;
        if (dist < ATTACK) { this.setState('windup'); this.audio.snarl?.({ pan: this.pan(player) }); break; }
        if (dist > CALM && this.stateT > 2) {
          // slink off, away from the pig
          const [rx, rz] = Wolves.right(player.heading);
          this.side = -dx * rx - dz * rz > 0 ? 1 : -1;
          this.setState('walk');
          break;
        }
        this.updateGrowl(dt, player, dist);
        break;
      }
      case 'windup': // a brief crouch before the lunge (and time for the pig to turn and see it)
        this.turnTo(toPig, 8, dt);
        snarl = 1;
        if (this.stateT > 0.45) this.setState('run');
        break;
      case 'run': {
        this.turnTo(toPig, 8, dt);
        targetSpeed = RUN_SPEED;
        snarl = 0.6;
        if (dist < LEAP_START) {
          // leap over the pig, landing a little behind and to the side of it
          const ux = dx / dist, uz = dz / dist;
          const s = Math.random() < 0.5 ? -1 : 1;
          const ex = player.pos.x + ux * 2.0 - uz * s * 1.1, ez = player.pos.z + uz * 2.0 + ux * s * 1.1;
          this.leap = { sx: this.pos.x, sz: this.pos.z, sy: this.pos.y, ex, ez, ey: terrainHeight(ex, ez), hit: false };
          this.setState('leap');
        }
        break;
      }
      case 'leap': {
        const L = this.leap, k = Math.min(1, this.stateT / LEAP_TIME);
        this.pos.x = L.sx + (L.ex - L.sx) * k;
        this.pos.z = L.sz + (L.ez - L.sz) * k;
        this.pos.y = L.sy + (L.ey - L.sy) * k + Math.sin(k * Math.PI) * LEAP_HEIGHT;
        if (k > 0.45 && !L.hit) { L.hit = true; this.onPounce?.(); }
        if (k >= 1) { this.setState('done'); }
        break;
      }
      case 'done': // landed: turns round to stand over the pig, snarling
        this.turnTo(toPig, 6, dt);
        snarl = 1;
        if (this.stateT > 1.4 && !this.over) { this.over = true; this.stopGrowl(0.4); this.onGameOver?.(); }
        break;
    }
    if (this.state !== 'alert') this.stopGrowl(0.35);

    this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-6 * dt));
    if (this.state !== 'leap') {
      this.pos.x += Math.sin(this.yaw) * this.speed * dt;
      this.pos.z += Math.cos(this.yaw) * this.speed * dt;
      if (this.state === 'walk') this.forest.collide(this.pos, 0.5);
      this.pos.y = terrainHeight(this.pos.x, this.pos.z);
    }
    this.snarl += (snarl - this.snarl) * (1 - Math.exp(-8 * dt));
    this.animate(dt, player);
  }

  setState(s) {
    this.state = s;
    this.stateT = 0;
    if (s === 'windup') this.over = false;
  }

  leave() {
    this.stopGrowl(0.3);
    this.state = 'none';
    this.m.root.visible = false;
    this.timer = rand(...RESPAWN);
  }

  turnTo(want, rate, dt) {
    const d = wrap(want - this.yaw);
    this.yaw += Math.max(-rate * dt, Math.min(rate * dt, d));
  }

  pan(player) {
    const dx = this.pos.x - player.pos.x, dz = this.pos.z - player.pos.z;
    const d = Math.hypot(dx, dz) || 1, h = player.heading;
    return Math.max(-0.8, Math.min(0.8, ((dx * Math.cos(h) - dz * Math.sin(h)) / d) * 0.8));
  }

  // Low growls, one slice after another, while it stares the pig down.
  updateGrowl(dt, player, dist) {
    this.growlT -= dt;
    if (this.growlT > 0) return;
    const close = 1 - Math.min(1, Math.max(0, (dist - ATTACK) / (ALERT - ATTACK)));
    const len = rand(2.6, 3.6);
    this.growl = this.audio.growl?.({ pan: this.pan(player), vol: 0.55 + 0.5 * close, duration: len }) || null;
    this.growlT = len - 0.25;
  }

  stopGrowl(fade) {
    if (this.growl) { this.audio.stopSample?.(this.growl, fade); this.growl = null; }
    this.growlT = 0;
  }

  animate(dt, player) {
    const m = this.m, sn = this.snarl;
    const running = this.state === 'run', leaping = this.state === 'leap';
    this.gait += this.speed * dt * (running ? 1.9 : 3.6);
    const g = this.gait;

    m.root.position.copy(this.pos);
    m.root.rotation.y = this.yaw;
    // pitch along the slope (and along the arc of the leap)
    let pitch;
    if (leaping) {
      const k = Math.min(1, this.stateT / LEAP_TIME);
      pitch = -Math.cos(k * Math.PI) * 0.45;
    } else {
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      const hF = terrainHeight(this.pos.x + fx * 0.6, this.pos.z + fz * 0.6);
      const hB = terrainHeight(this.pos.x - fx * 0.6, this.pos.z - fz * 0.6);
      pitch = -Math.atan2(hF - hB, 1.2);
    }
    m.root.rotation.x = pitch;

    const amp = Math.min(1, this.speed / WALK_SPEED) * 0.45;
    for (const leg of m.legs) {
      const { front, side } = leg.userData;
      let a;
      if (leaping) a = front ? -1.1 : 0.9;                         // stretched out mid-air
      else if (running) a = Math.sin(g + (front ? 0 : Math.PI * 0.8) + side * 0.25) * 0.95; // gallop
      else a = Math.sin(g + (front ? 0 : Math.PI) + (side > 0 ? Math.PI : 0)) * amp;        // walk
      // crouched: front legs splay forward a touch
      leg.rotation.x = a + (front ? -0.18 : 0.12) * sn * (leaping ? 0 : 1);
    }

    // Crouch low, head down and forward, lips pulled back; hackles up and tail low and stiff.
    const t = performance.now() / 1000;
    m.body.position.y = -0.1 * sn + (running ? Math.abs(Math.sin(g)) * 0.06 : Math.abs(Math.sin(g)) * 0.02 * amp);
    m.body.rotation.x = 0.08 * sn + (running ? Math.sin(g) * 0.08 : 0);
    m.neck.rotation.x = 0.25 * sn - 0.1 + (this.state === 'walk' ? 0.12 : 0);
    m.head.rotation.x = -0.15 * sn + Math.sin(t * 9) * 0.03 * sn;
    m.head.rotation.y = Math.sin(t * 5.3) * 0.05 * sn;
    m.jaw.rotation.x = sn * (0.32 + 0.12 * Math.sin(t * 7));
    for (const e of m.ears) e.rotation.x = -0.5 * sn; // pinned back
    m.hackles.scale.y = 0.4 + 1.1 * sn;
    m.tail.rotation.x = -(0.55 + 0.25 * sn) + (running || leaping ? 0.45 : 0); // negative = hanging down
    m.tail.rotation.y = this.state === 'walk' ? Math.sin(g * 0.5) * 0.25 : 0;
  }
}
