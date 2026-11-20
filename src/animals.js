import { terrainHeight } from './noise.js';
import { createCreature } from './creatures.js';

// Animals roaming the forest, all on the same algorithm. Far away they pad slowly across the
// pig's path (mostly perpendicular to where the pig is heading). If the pig comes close they stop
// and stare. Closer still:
//  - dangerous ones (wolf, bear) charge, leap over the pig, and the game is over. They show on
//    the minimap and call out (howl / growl) as they come into map range, and growl while staring.
//  - docile ones (deer, goat, moose) turn and flee. The squirrel dashes to the nearest tree,
//    scurries up the trunk into the leaves and is gone. Silent, and not on the map.
// At most one wolf, one bear and one docile animal are around at a time, and they keep apart.

// ---------- tuning ----------
const MIN_SEP = 45;        // a new animal never appears this close to another one
const KEEP_APART = 35;     // walking animals steer away from each other inside this
const LEAP_START = 3.4;    // metres from the pig where a charging predator leaps
const LEAP_TIME = 0.62;
const CLIMB_SPEED = 2.6;   // m/s up a trunk (squirrel)
const TREE_SEARCH = 22;    // a squirrel looks for a tree this close

// map: sound as it comes into minimap range. stare: growl slices while staring (end = last usable
// second of the recording). charge: the snarl as it charges.
export const SPECIES = {
  wolf: {
    danger: true, size: 1.2, walk: 1.1, run: 10, alert: 26, close: 12, calm: 36, leapH: 2.5,
    spawn: [86, 96], barnKeep: 40,
    sounds: {
      map: { name: 'howl', vol: 0.9 },
      stare: { name: 'growl', vol: 0.55, volClose: 0.5 },
      charge: { name: 'growl', vol: 1.5, rate: 1.12, duration: 2.5 },
    },
  },
  bear: {
    danger: true, size: 1.15, walk: 0.9, run: 9, alert: 26, close: 12, calm: 36, leapH: 2.2,
    spawn: [86, 96], barnKeep: 40,
    sounds: {
      map: { name: 'bearGrowl', vol: 1 },
      stare: { name: 'bearGrowling', vol: 0.55, volClose: 0.5, end: 5.0 },
      charge: { name: 'bearGrowling', vol: 1.5, rate: 0.95, duration: 2.4, end: 5.0 },
    },
  },
  deer: { size: 1.0, walk: 1.2, run: 8, alert: 24, close: 12, calm: 34, spawn: [75, 90], barnKeep: 20 },
  goat: { size: 1.0, walk: 0.9, run: 6.5, alert: 16, close: 8, calm: 26, spawn: [75, 90], barnKeep: 20 },
  moose: { size: 1.1, walk: 1.0, run: 6.5, alert: 24, close: 12, calm: 34, spawn: [75, 90], barnKeep: 20 },
  squirrel: { size: 1.8, walk: 0.8, run: 5, alert: 10, close: 5, calm: 18, spawn: [55, 70], barnKeep: 15, hop: true, climbs: true },
};

// One wolf, one bear, one docile animal at most. first: seconds of play before the first one.
const SLOTS = [
  { kinds: ['wolf'], first: 35, respawn: [25, 50] },
  { kinds: ['bear'], first: 75, respawn: [35, 70] },
  // squirrels listed three times: half of the docile animals are squirrels
  { kinds: ['deer', 'goat', 'squirrel', 'squirrel', 'squirrel', 'moose'], first: 12, respawn: [8, 20] },
];

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const right = (h) => [Math.cos(h), -Math.sin(h)]; // the pig's right-hand direction

class Creature {
  constructor(kind, mgr, x, z, side) {
    this.kind = kind;
    this.sp = SPECIES[kind];
    this.mgr = mgr;
    this.m = createCreature(kind, this.sp.size);
    mgr.scene.add(this.m.root);
    this.pos = { x, y: terrainHeight(x, z), z };
    this.side = side;              // walks along (+1) or against (-1) the pig's right-hand direction
    this.yaw = 0;
    this.speed = 0;
    this.gait = 0;
    this.snarl = 0;                // 0..1 snarl pose (predators)
    this.look = 0;                 // 0..1 alert head-up pose (docile)
    this.state = 'walk';           // walk | alert | windup | run | leap | done | flee | totree | climb
    this.stateT = 0;
    this.inMap = false;
    this.howlCool = 0;
    this.growl = null;
    this.growlT = 0;
    this.seed = Math.random() * 100;
    this.gone = false;
  }

  get attacking() { return ['windup', 'run', 'leap', 'done'].includes(this.state); }

  setState(s) { this.state = s; this.stateT = 0; }

  update(dt, player, busy) {
    const sp = this.sp, mgr = this.mgr;
    this.stateT += dt;
    this.howlCool -= dt;
    const dx = player.pos.x - this.pos.x, dz = player.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const toPig = Math.atan2(dx, dz);

    // A predator coming into map range calls out through the trees.
    const inMap = dist < mgr.mapRange;
    if (sp.danger && inMap && !this.inMap && this.howlCool <= 0 && this.state === 'walk') {
      mgr.audio.call?.(sp.sounds.map.name, { vol: sp.sounds.map.vol, pan: this.pan(player) });
      this.howlCool = 30;
    }
    this.inMap = inMap;

    let targetSpeed = 0, snarl = 0, look = 0;
    switch (this.state) {
      case 'walk': {
        if (dist > mgr.despawn) { this.gone = true; return; }
        if (dist < sp.alert) { this.setState('alert'); break; }
        // mostly perpendicular to the pig's heading, wandering a little
        const [rx, rz] = right(player.heading);
        let want = Math.atan2(rx * this.side, rz * this.side) + 0.35 * Math.sin(this.stateT * 0.13 + this.seed);
        // keep away from the barn and from other animals
        const bx = this.pos.x - mgr.barn.x, bz = this.pos.z - mgr.barn.z;
        if (Math.hypot(bx, bz) < sp.barnKeep) want = Math.atan2(bx, bz);
        const o = mgr.nearestOther(this);
        if (o && o.d < KEEP_APART) want = Math.atan2(this.pos.x - o.c.pos.x, this.pos.z - o.c.pos.z);
        this.turnTo(want, 1.2, dt);
        targetSpeed = sp.walk;
        break;
      }
      case 'alert': {
        this.turnTo(toPig, 4, dt);
        if (sp.danger) {
          snarl = 1;
          // only one predator attacks at a time; another keeps staring
          if (dist < sp.close && !busy) {
            this.setState('windup');
            const c = sp.sounds.charge;
            mgr.audio.slice?.(c.name, { vol: c.vol, rate: c.rate, duration: c.duration, end: c.end, pan: this.pan(player), fade: 0.05 });
            break;
          }
          this.updateGrowl(dt, player, dist);
        } else {
          look = 1;
          if (dist < sp.close) { this.escape(player); break; }
        }
        if (dist > sp.calm && this.stateT > 2) {
          // wander off, away from the pig
          const [rx, rz] = right(player.heading);
          this.side = -dx * rx - dz * rz > 0 ? 1 : -1;
          this.setState('walk');
        }
        break;
      }
      case 'flee': // docile: bolt away from the pig and vanish into the forest
        this.turnTo(toPig + Math.PI, 5, dt);
        targetSpeed = sp.run;
        if (dist > 85 || this.stateT > 15) { this.gone = true; return; }
        break;
      case 'totree': { // squirrel: dash to the trunk
        const T = this.tree, tx = T.x - this.pos.x, tz = T.z - this.pos.z;
        const td = Math.hypot(tx, tz);
        this.turnTo(Math.atan2(tx, tz), 12, dt);
        targetSpeed = sp.run;
        if (td < T.r + 0.3) {
          // at the trunk: face it, feet on the bark, and start climbing
          this.yaw = Math.atan2(tx, tz);
          this.pos.x = T.x - (tx / td) * (T.r + 0.04);
          this.pos.z = T.z - (tz / td) * (T.r + 0.04);
          this.climbY = this.pos.y;
          this.setState('climb');
        } else if ((this.checkT -= dt) <= 0) {
          // blocked (by a rock or the barn), or taking too long: just bolt instead
          if (td > this.lastTd - 1 || this.stateT > 8) this.setState('flee');
          this.lastTd = td; this.checkT = 0.6;
        }
        break;
      }
      case 'climb': // up the trunk into the leaves, then gone
        this.climbY += CLIMB_SPEED * Math.min(1, this.stateT * 4) * dt;
        this.pos.y = this.climbY;
        this.speed = CLIMB_SPEED; // keeps the legs scrabbling
        if (this.climbY > this.tree.leaf) { this.gone = true; return; }
        break;
      case 'windup': // a brief crouch before the lunge (and time for the pig to turn and see it)
        this.turnTo(toPig, 8, dt);
        snarl = 1;
        if (this.stateT > 0.45) this.setState('run');
        break;
      case 'run':
        this.turnTo(toPig, 8, dt);
        targetSpeed = sp.run;
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
      case 'leap': {
        const L = this.leap, k = Math.min(1, this.stateT / LEAP_TIME);
        this.pos.x = L.sx + (L.ex - L.sx) * k;
        this.pos.z = L.sz + (L.ez - L.sz) * k;
        this.pos.y = L.sy + (L.ey - L.sy) * k + Math.sin(k * Math.PI) * sp.leapH;
        if (k > 0.45 && !L.hit) { L.hit = true; mgr.onPounce?.(this.kind); }
        if (k >= 1) this.setState('done');
        break;
      }
      case 'done': // landed: turns round to stand over the pig, snarling
        this.turnTo(toPig, 6, dt);
        snarl = 1;
        if (this.stateT > 1.4 && !this.over) { this.over = true; this.stopGrowl(0.4); mgr.onGameOver?.(this.kind); }
        break;
    }
    if (this.state !== 'alert') this.stopGrowl(0.35);

    if (this.state !== 'climb') this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-6 * dt));
    if (this.state !== 'leap' && this.state !== 'climb') {
      this.pos.x += Math.sin(this.yaw) * this.speed * dt;
      this.pos.z += Math.cos(this.yaw) * this.speed * dt;
      // (a squirrel near its tree skips collisions so it can reach the bark)
      const nearTree = this.state === 'totree' && Math.hypot(this.tree.x - this.pos.x, this.tree.z - this.pos.z) < this.tree.r + 1.5;
      if ((this.state === 'walk' || this.state === 'flee' || this.state === 'totree') && !nearTree) mgr.forest.collide(this.pos, 0.45 * sp.size);
      this.pos.y = terrainHeight(this.pos.x, this.pos.z);
    }
    const k = 1 - Math.exp(-8 * dt);
    this.snarl += (snarl - this.snarl) * k;
    this.look += (look - this.look) * k;
    this.animate(dt);
  }

  // Docile animals flee; a squirrel heads for the nearest tree that isn't toward the pig.
  escape(player) {
    if (this.sp.climbs) {
      let best = null, bestScore = Infinity;
      for (const c of this.mgr.forest.nearbyColliders(this.pos.x, this.pos.z, TREE_SEARCH)) {
        if (c.leaf === undefined) continue;
        const d = Math.hypot(c.x - this.pos.x, c.z - this.pos.z);
        if (d > TREE_SEARCH) continue;
        const dp = Math.hypot(c.x - player.pos.x, c.z - player.pos.z);
        if (dp < 2.5) continue;
        const score = d - 0.5 * dp;
        if (score < bestScore) { bestScore = score; best = c; }
      }
      if (best) {
        this.tree = best; this.lastTd = Infinity; this.checkT = 0.6;
        this.setState('totree');
        return;
      }
    }
    this.setState('flee');
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
    const s = this.sp.sounds.stare;
    const close = 1 - Math.min(1, Math.max(0, (dist - this.sp.close) / (this.sp.alert - this.sp.close)));
    const len = rand(2.6, 3.4);
    this.growl = this.mgr.audio.slice?.(s.name, { vol: s.vol + s.volClose * close, duration: len, end: s.end, pan: this.pan(player), fade: 0.25 }) || null;
    this.growlT = len - 0.25;
  }

  stopGrowl(fade) {
    if (this.growl) { this.mgr.audio.stopSample?.(this.growl, fade); this.growl = null; }
    this.growlT = 0;
  }

  remove() {
    this.stopGrowl(0.3);
    this.mgr.scene.remove(this.m.root);
  }

  animate(dt) {
    const m = this.m, sp = this.sp, sn = this.snarl, look = this.look;
    const climbing = this.state === 'climb';
    const running = this.state === 'run' || this.state === 'flee' || this.state === 'totree' || climbing, leaping = this.state === 'leap';
    const hipW = m.hip * sp.size;
    this.gait += (this.speed * dt * (running ? 1.7 : 3.2)) / hipW;
    const g = this.gait;
    const t = performance.now() / 1000;

    m.root.position.set(this.pos.x, this.pos.y, this.pos.z);
    m.root.rotation.y = this.yaw;
    // pitch along the slope (and along the arc of the leap)
    let pitch;
    if (leaping) pitch = -Math.cos(Math.min(1, this.stateT / LEAP_TIME) * Math.PI) * 0.45;
    else if (climbing) pitch = -Math.PI / 2 * Math.min(1, this.stateT * 6); // upright on the trunk, nose up
    else {
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), L = Math.max(0.3, hipW * 0.7);
      const hF = terrainHeight(this.pos.x + fx * L, this.pos.z + fz * L);
      const hB = terrainHeight(this.pos.x - fx * L, this.pos.z - fz * L);
      pitch = -Math.atan2(hF - hB, 2 * L);
    }
    m.root.rotation.x = pitch;

    const moving = Math.min(1, this.speed / sp.walk);
    for (const leg of m.legs) {
      const { front, side } = leg.userData;
      let a;
      if (leaping) a = front ? -1.1 : 0.9;                                                       // stretched out mid-air
      else if (sp.hop) a = Math.sin(g + (front ? 0 : Math.PI * 0.5)) * 0.8 * moving;               // bounding hops
      else if (running) a = Math.sin(g + (front ? 0 : Math.PI * 0.8) + side * 0.25) * 0.95;       // gallop
      else a = Math.sin(g + (front ? 0 : Math.PI) + (side > 0 ? Math.PI : 0)) * 0.45 * moving;     // walk
      leg.rotation.x = a + (front ? -0.18 : 0.12) * sn * (leaping ? 0 : 1);                        // crouched: front legs splay
    }

    // Predators crouch low, head down and forward, lips pulled back, hackles up.
    // Docile animals lift their heads and stare, ears twitching.
    const bob = sp.hop ? Math.abs(Math.sin(g)) * m.hip * 0.6 * moving
      : Math.abs(Math.sin(g)) * (running ? 0.06 : 0.02 * moving);
    m.body.position.y = -0.1 * sn * (m.hip / 0.74) + bob;
    m.body.rotation.x = 0.08 * sn + (running && !sp.hop ? Math.sin(g) * 0.08 : 0) - (sp.hop ? 0.55 * look : 0); // squirrel sits up
    m.neck.rotation.x = 0.25 * sn - 0.1 + (this.state === 'walk' ? 0.12 : 0) - 0.35 * look;
    m.head.rotation.x = -0.15 * sn + Math.sin(t * 9) * 0.03 * sn;
    m.head.rotation.y = Math.sin(t * 5.3) * 0.05 * sn;
    if (m.jaw) m.jaw.rotation.x = sn * (0.32 + 0.12 * Math.sin(t * 7));
    const twitch = look * Math.max(0, Math.sin(t * 2.3 + this.seed)) ** 8 * 0.5;
    for (const e of m.ears) e.rotation.x = -0.5 * sn - twitch;
    m.hackles.scale.y = 0.4 + 1.1 * sn;

    const tail = m.tail;
    switch (this.kind) {
      case 'wolf': // hanging low and stiff, streaming out behind when it runs
        tail.rotation.x = -(0.55 + 0.25 * sn) + (running || leaping ? 0.45 : 0);
        tail.rotation.y = this.state === 'walk' ? Math.sin(g * 0.5) * 0.25 : 0;
        break;
      case 'deer': // white flag up when it bolts
        tail.rotation.x = this.state === 'flee' ? 2.4 : Math.sin(t * 4 + this.seed) * 0.12;
        break;
      case 'goat':
        tail.rotation.y = Math.sin(t * 7 + this.seed) * 0.35;
        break;
      case 'squirrel': // flicks, and flattens out behind when it runs
        tail.rotation.x = Math.sin(t * 2 + this.seed) * 0.12 + (running ? -0.6 : 0);
        break;
    }
  }
}

export class Animals {
  constructor({ scene, forest, audio, barn, mapRange, onPounce, onGameOver }) {
    Object.assign(this, { scene, forest, audio, barn, mapRange, onPounce, onGameOver });
    this.despawn = mapRange + 55;
    this.list = [];
    this.reset();
  }

  reset() {
    for (const c of this.list) c.remove();
    this.list = [];
    this.slots = SLOTS.map((s) => ({ ...s, timer: s.first, c: null }));
  }

  get attacker() { return this.list.find((c) => c.attacking) || null; }

  // Dangerous animals for the minimap.
  mapIcons() {
    return this.list.filter((c) => c.sp.danger && c.state !== 'done')
      .map((c) => ({ x: c.pos.x, z: c.pos.z, kind: c.kind, angry: c.state !== 'walk' }));
  }

  nearestOther(me) {
    let best = null;
    for (const c of this.list) {
      if (c === me) continue;
      const d = Math.hypot(c.pos.x - me.pos.x, c.pos.z - me.pos.z);
      if (!best || d < best.d) best = { c, d };
    }
    return best;
  }

  // Ahead and off to one side of the pig, so it crosses in front; away from the barn and the others.
  spawn(kind, player) {
    const sp = SPECIES[kind];
    for (let tries = 0; tries < 10; tries++) {
      const a = player.heading + (Math.random() < 0.5 ? -1 : 1) * rand(0.45, 1.25);
      const d = rand(...sp.spawn);
      const x = player.pos.x - Math.sin(a) * d, z = player.pos.z - Math.cos(a) * d;
      if (Math.hypot(x - this.barn.x, z - this.barn.z) < sp.barnKeep + 5) continue;
      if (this.list.some((c) => Math.hypot(c.pos.x - x, c.pos.z - z) < MIN_SEP)) continue;
      return this.add(kind, x, z, player);
    }
    return null;
  }

  add(kind, x, z, player) {
    const [rx, rz] = right(player.heading);
    const side = (x - player.pos.x) * rx + (z - player.pos.z) * rz > 0 ? -1 : 1;
    const c = new Creature(kind, this, x, z, side);
    c.yaw = Math.atan2(rx * side, rz * side);
    this.list.push(c);
    return c;
  }

  // For testing from the console: put an animal of this kind at (x, z) right now.
  spawnAt(kind, x, z, player) {
    const slot = this.slots.find((s) => s.kinds.includes(kind));
    if (slot.c) this.drop(slot);
    slot.c = this.add(kind, x, z, player);
    slot.c.yaw = Math.atan2(player.pos.x - x, player.pos.z - z) + Math.PI / 2;
    return slot.c;
  }

  drop(slot) {
    slot.c.remove();
    this.list.splice(this.list.indexOf(slot.c), 1);
    slot.c = null;
    slot.timer = rand(...slot.respawn);
  }

  update(dt, player) {
    const attacker = this.attacker;
    for (const slot of this.slots) {
      if (!slot.c) {
        slot.timer -= dt;
        if (slot.timer <= 0) {
          slot.c = this.spawn(pick(slot.kinds), player);
          if (!slot.c) slot.timer = 3;
        }
        continue;
      }
      slot.c.update(dt, player, !!attacker && attacker !== slot.c);
      if (slot.c.gone) this.drop(slot);
    }
  }
}
