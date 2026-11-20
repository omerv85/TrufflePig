import * as THREE from 'three';
import { terrainHeight } from './noise.js';
import { createCreature } from './creatures.js';

// Animals roaming the forest, all on the same algorithm. Far away they pad slowly across the
// pig's path (mostly perpendicular to where the pig is heading). If the pig comes close they stop
// and stare. Closer still:
//  - dangerous ones (wolf, bear) charge, leap over the pig, and the game is over. They show on
//    the minimap and call out (howl / growl) as they come into map range, and growl while staring.
//    The witch doesn't charge: she raises her wand and curses the pig into a toad (main.js).
//    The troll (night only, like the witch) lumbers along dragging its club, its lantern glowing
//    through the dark; it charges, swings the club overhead and smacks the pig with it.
//  - docile ones (deer, goat, moose) turn and flee. The squirrel dashes to the nearest tree,
//    scurries up the trunk into the leaves and is gone. Silent, and not on the map.
//    Small critters, day or night: the hedgehog curls into a spiky ball until the pig has gone,
//    the rabbit zigzags off and dives into a burrow, the badger just waddles away.
//    At night an owl sits on a fallen log, head turning to follow the pig, and flies off (with the
//    wing-flap recording) if the pig comes too close.
// At most one wolf, one bear, one witch and one docile animal are around at a time (and never more
// than MAX_DANGER of the dangerous ones), and they keep apart.

// ---------- tuning ----------
const MIN_SEP = 45;        // a new animal never appears this close to another one
const KEEP_APART = 35;     // walking animals steer away from each other inside this
const LEAP_START = 3.4;    // metres from the pig where a charging predator leaps
const LEAP_TIME = 0.62;
const CLIMB_SPEED = 2.6;   // m/s up a trunk (squirrel)
const TREE_SEARCH = 22;    // a squirrel looks for a tree this close
const MAX_DANGER = 2;      // dangerous animals around at once (of wolf, bear, witch)
const CAST_TIME = 1.1;     // the witch raises her wand, then the curse hits
const SMASH_REACH = 3.3;   // the charging troll starts its swing this far from the pig (it skids ~0.9 m on)
const SMASH_HIT = 0.42;    // seconds into the swing when the club lands
// The separate roars in troll-roars.mp3: [start, length] in seconds (found by measuring the file).
const TROLL_ROARS = [[0.05, 0.95], [1.75, 1.35], [3.55, 1.1], [5.35, 1.1], [7.05, 1.85], [9.45, 1.0]];

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
  witch: {
    danger: true, caster: true, size: 1.0, walk: 0.9, alert: 26, close: 9, calm: 36,
    spawn: [86, 96], barnKeep: 40,
    sounds: {
      map: { name: 'witchNear', vol: 1 },
      // the whole staring clip (5 s of voice), again after a pause while she keeps staring
      stare: { name: 'witchStaring', vol: 0.9, volClose: 0.3, whole: 5.6, gap: 2.5 },
    },
  },
  troll: {
    danger: true, smash: true, size: 1.0, radius: 0.85, walk: 0.8, run: 5.5, windup: 0.8, alert: 28, close: 12, calm: 38,
    spawn: [86, 96], barnKeep: 40,
    // far off: grumbling "troll idle" mutters now and then; close: the "troll roars" (one roar at a time)
    sounds: {
      map: { name: 'trollIdle', vol: 1.1, slice: 3.2 },
      idle: { name: 'trollIdle', vol: 0.9, every: [4, 8], len: [2.6, 3.6] },
      stare: { name: 'trollRoars', vol: 0.75, volClose: 0.4, clips: TROLL_ROARS, gap: [0.7, 1.6] },
      charge: { name: 'trollRoars', vol: 1.4, clip: TROLL_ROARS[4] },
    },
  },
  deer: { size: 1.0, walk: 1.2, run: 8, alert: 24, close: 12, calm: 34, spawn: [75, 90], barnKeep: 20 },
  goat: { size: 1.0, walk: 0.9, run: 6.5, alert: 16, close: 8, calm: 26, spawn: [75, 90], barnKeep: 20 },
  moose: { size: 1.1, walk: 1.0, run: 6.5, alert: 24, close: 12, calm: 34, spawn: [75, 90], barnKeep: 20 },
  hedgehog: { size: 1.3, walk: 0.35, run: 0, alert: 9, close: 4.5, calm: 9, spawn: [35, 50], barnKeep: 12, curls: true },
  rabbit: { size: 1.3, walk: 0.7, run: 5.5, alert: 18, close: 9, calm: 26, spawn: [45, 60], barnKeep: 12, hop: true, zigzag: true, burrows: true },
  badger: { size: 1.1, walk: 0.6, run: 1.7, alert: 14, close: 7, calm: 18, spawn: [55, 70], barnKeep: 15, waddle: true },
  owl: { size: 1.25, alert: 22, close: 9, calm: 30, spawn: [25, 65], perch: true, fly: 6 },
  squirrel: { size: 1.8, walk: 0.8, run: 5, alert: 10, close: 5, calm: 18, spawn: [55, 70], barnKeep: 15, hop: true, climbs: true },
};

// One wolf, one bear, one witch, one troll, one docile animal at most. first: seconds of play before the first one.
// when: wolves and bears only appear by day, the witch and the troll only by night (one already around stays when it turns).
const SLOTS = [
  { kinds: ['wolf'], first: 35, respawn: [25, 50], when: 'day' },
  { kinds: ['bear'], first: 75, respawn: [35, 70], when: 'day' },
  { kinds: ['witch'], first: 110, respawn: [35, 70], when: 'night' },
  { kinds: ['troll'], first: 135, respawn: [30, 60], when: 'night' },
  // squirrels listed three times: half of the docile animals are squirrels
  { kinds: ['deer', 'goat', 'squirrel', 'squirrel', 'squirrel', 'moose'], first: 12, respawn: [8, 20] },
  // small critters, day or night
  { kinds: ['hedgehog', 'rabbit', 'badger'], first: 25, respawn: [10, 25] },
  // the owl: only at night, always on a fallen log
  { kinds: ['owl'], first: 95, respawn: [20, 45], when: 'night' },
];

const rand = (a, b) => a + Math.random() * (b - a);
const HOLE_GEO = new THREE.CircleGeometry(0.17, 10).rotateX(-Math.PI / 2);
const HOLE_MAT = new THREE.MeshBasicMaterial({ color: '#2e2420' });
const RIM_GEO = new THREE.RingGeometry(0.15, 0.3, 10).rotateX(-Math.PI / 2);
const RIM_MAT = new THREE.MeshLambertMaterial({ color: '#a8866c', polygonOffset: true, polygonOffsetFactor: -1 });
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
    this.state = 'walk';           // walk | alert | windup | run | leap | smash | cast | done | flee | totree | climb
    this.stateT = 0;
    this.inMap = false;
    this.howlCool = 0;
    this.idleT = 0;
    this.curl = 0;                 // 0..1 hedgehog rolled into a ball
    this.growl = null;
    this.growlT = 0;
    this.seed = Math.random() * 100;
    this.gone = false;
  }

  get attacking() { return ['windup', 'run', 'leap', 'smash', 'cast', 'done'].includes(this.state); }

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
    if (sp.danger && inMap && !this.inMap && !mgr.warned) {
      // The first time in a game a predator shows on the map, the girl warns the pig (once its call has begun).
      mgr.warned = true;
      mgr.audio.playSample?.('danger', { when: 1.2 });
    }
    if (sp.danger && inMap && !this.inMap && this.howlCool <= 0 && this.state === 'walk') {
      const s = sp.sounds.map;
      if (s.slice) mgr.audio.slice?.(s.name, { vol: s.vol, duration: s.slice, pan: this.pan(player), fade: 0.2 });
      else mgr.audio.call?.(s.name, { vol: s.vol, rate: s.rate, pan: this.pan(player) });
      this.howlCool = 30;
      this.idleT = rand(...(sp.sounds.idle?.every ?? [5, 5]));
    }
    this.inMap = inMap;

    let targetSpeed = 0, snarl = 0, look = 0;
    switch (this.state) {
      case 'perch': // the owl on its log: watches the pig, and takes off if it comes too close
        if (dist > mgr.despawn) { this.gone = true; return; }
        if (dist < sp.alert) {
          look = 1;
          // past where its head can turn: it shuffles round on the log to face the pig
          if (Math.abs(wrap(toPig - this.yaw)) > 1.6) this.turnTo(toPig, 1.5, dt);
        }
        if (dist < sp.close) {
          this.flyDir = toPig + Math.PI + (Math.random() - 0.5) * 0.8;
          mgr.audio.wings?.({ vol: Math.max(0.25, 1 - dist / 30), pan: this.pan(player) });
          this.setState('fly');
        }
        break;
      case 'fly': // up and away over the trees
        this.turnTo(this.flyDir, 6, dt);
        this.pos.x += Math.sin(this.yaw) * sp.fly * Math.min(1, this.stateT * 2) * dt;
        this.pos.z += Math.cos(this.yaw) * sp.fly * Math.min(1, this.stateT * 2) * dt;
        this.pos.y += (this.stateT < 0.4 ? 3.2 : 1.6) * dt;
        if (this.stateT > 4.5) { this.gone = true; return; }
        break;
      case 'curl': // hedgehog: a still, spiky ball until the pig has gone
        if (dist > sp.calm && this.stateT > 2.5) this.setState('walk');
        break;
      case 'burrow': // rabbit: down the hole and gone
        this.pos.y = terrainHeight(this.pos.x, this.pos.z) - this.stateT * 0.7;
        if (this.stateT > 0.45) { this.gone = true; return; }
        break;
      case 'walk': {
        if (dist > mgr.despawn) { this.gone = true; return; }
        const idle = sp.sounds?.idle;
        if (idle && inMap && (this.idleT -= dt) <= 0) {  // mutters to itself, quieter the farther off
          mgr.audio.slice?.(idle.name, { vol: idle.vol * (1 - 0.6 * dist / mgr.mapRange), duration: rand(...idle.len), pan: this.pan(player), fade: 0.25 });
          this.idleT = rand(...idle.every) + idle.len[1];
        }
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
          if (dist < sp.close && !busy && sp.caster) { this.setState('cast'); break; }
          if (dist < sp.close && !busy) {
            this.setState('windup');
            const c = sp.sounds.charge;
            if (c.clip) mgr.audio.playSample?.(c.name, { vol: c.vol, offset: c.clip[0], duration: c.clip[1], fade: 0.05, pan: this.pan(player) * 0.6 });
            else mgr.audio.slice?.(c.name, { vol: c.vol, rate: c.rate, duration: c.duration, end: c.end, pan: this.pan(player), fade: 0.05 });
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
        // (the rabbit zigzags, the badger just waddles off until it's left alone)
        this.turnTo(toPig + Math.PI + (sp.zigzag ? Math.sin(this.stateT * 6 + this.seed) * 0.8 : 0), sp.zigzag ? 9 : 5, dt);
        targetSpeed = sp.run;
        if (sp.waddle && dist > sp.calm) { this.setState('walk'); break; }
        if (sp.burrows && this.stateT > this.burrowAt) { this.mgr.addHole(this.pos.x, this.pos.z); this.setState('burrow'); break; }
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
        if (this.stateT > (sp.windup ?? 0.45)) this.setState('run');
        break;
      case 'run':
        this.turnTo(toPig, 8, dt);
        targetSpeed = sp.run;
        snarl = 0.6;
        if (sp.smash && dist < SMASH_REACH) { this.setState('smash'); break; }
        if (!sp.smash && dist < LEAP_START) {
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
      case 'smash': // the troll: club wound back overhead, then brought down on the pig
        this.turnTo(toPig, 6, dt);
        snarl = 1;
        if (this.stateT >= SMASH_HIT && !this.hit) { this.hit = true; mgr.onPounce?.(this.kind); }
        if (this.stateT > 0.75) this.setState('done');
        break;
      case 'cast': // the witch raises her wand overhead, then points it at the pig: the curse
        this.turnTo(toPig, 8, dt);
        snarl = 1;
        mgr.onCastTick?.(this, this.stateT / CAST_TIME, dt);
        if (this.stateT >= CAST_TIME) { mgr.onCurse?.(this.kind, this); this.setState('done'); }
        break;
      case 'done': // landed: turns round to stand over the pig, snarling
        if (!sp.smash) this.turnTo(toPig, 6, dt);
        snarl = 1;
        if (this.stateT > (sp.caster ? 2.9 : 1.4) && !this.over) { this.over = true; this.stopGrowl(0.4); mgr.onGameOver?.(this.kind); }
        break;
    }
    if (this.state !== 'alert') this.stopGrowl(0.35);

    if (this.state !== 'climb') this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-6 * dt));
    if (!['leap', 'climb', 'perch', 'fly', 'burrow'].includes(this.state)) {
      this.pos.x += Math.sin(this.yaw) * this.speed * dt;
      this.pos.z += Math.cos(this.yaw) * this.speed * dt;
      // (a squirrel near its tree skips collisions so it can reach the bark)
      const nearTree = this.state === 'totree' && Math.hypot(this.tree.x - this.pos.x, this.tree.z - this.pos.z) < this.tree.r + 1.5;
      if ((this.state === 'walk' || this.state === 'flee' || this.state === 'totree') && !nearTree) mgr.forest.collide(this.pos, sp.radius ?? 0.45 * sp.size);
      this.pos.y = terrainHeight(this.pos.x, this.pos.z);
    }
    const k = 1 - Math.exp(-8 * dt);
    this.snarl += (snarl - this.snarl) * k;
    this.look += (look - this.look) * k;
    this.curl += ((this.state === 'curl' ? 1 : 0) - this.curl) * (1 - Math.exp(-10 * dt));
    this.animate(dt, player);
    if (this.sp.curls) this.curlUp();
  }

  // Hedgehog rolled into a ball: head and legs tucked in, spines all round.
  curlUp() {
    const m = this.m, c = this.curl;
    if (c < 0.001) return;
    m.head.scale.setScalar(1 - 0.85 * c);
    m.neck.position.z = 0.13 - 0.07 * c;
    for (const leg of m.legs) leg.scale.y = 1 - 0.9 * c;
    m.body.position.y = -0.045 * c;
    m.body.scale.set(1, 1 + 0.3 * c, 1 - 0.15 * c);
  }

  // Docile animals flee; a squirrel heads for the nearest tree that isn't toward the pig.
  escape(player) {
    if (this.sp.curls) { this.setState('curl'); return; }
    if (this.sp.burrows) this.burrowAt = rand(1.4, 2.4);
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
    if (s.clips) { // one roar at a time, louder the closer
      const close = 1 - Math.min(1, Math.max(0, (dist - this.sp.close) / (this.sp.alert - this.sp.close)));
      const [at, len] = pick(s.clips);
      this.growl = this.mgr.audio.playSample?.(s.name, { vol: s.vol + s.volClose * close, offset: at, duration: len, fade: 0.06, pan: this.pan(player) * 0.6 }) || null;
      this.growlT = len + rand(...s.gap);
      return;
    }
    if (s.whole) {
      const close = 1 - Math.min(1, Math.max(0, (dist - this.sp.close) / (this.sp.alert - this.sp.close)));
      this.growl = this.mgr.audio.playSample?.(s.name, { vol: s.vol + s.volClose * close, duration: s.whole, fade: 0.3, pan: this.pan(player) * 0.6 }) || null;
      this.growlT = s.whole + s.gap;
      return;
    }
    const close = 1 - Math.min(1, Math.max(0, (dist - this.sp.close) / (this.sp.alert - this.sp.close)));
    const len = rand(2.6, 3.4);
    this.growl = this.mgr.audio.slice?.(s.name, { vol: s.vol + s.volClose * close, duration: len, end: s.end, rate: s.rate, pan: this.pan(player), fade: 0.25 }) || null;
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

  // The witch: robe sways and boots step as she walks; staring, she leans in and lifts her wand,
  // its tip glowing brighter; casting, she raises it overhead and then jabs it at the pig.
  animateWitch(dt) {
    const m = this.m, sn = this.snarl, t = performance.now() / 1000;
    this.gait += this.speed * dt * 4.5;
    const g = this.gait, moving = Math.min(1, this.speed / this.sp.walk);
    m.root.position.set(this.pos.x, this.pos.y, this.pos.z);
    m.root.rotation.set(0, this.yaw, 0);
    m.legs.forEach((leg, i) => { leg.rotation.x = Math.sin(g + i * Math.PI) * 0.5 * moving; });
    m.body.position.y = Math.abs(Math.sin(g)) * 0.03 * moving;
    m.body.rotation.z = Math.sin(g) * 0.05 * moving;
    let armX = Math.sin(g + Math.PI) * 0.25 * moving, wandX = Math.PI / 2, glow = 0.25 + 0.5 * sn;
    let lean = 0.12 * sn;
    if (this.state === 'alert') {
      armX = -0.9 * sn + Math.sin(t * 2.2) * 0.06;  // wand half raised, pointed her way
      wandX = Math.PI / 2 + 0.6 * sn;
      glow += 0.15 * Math.sin(t * 6);
    } else if (this.state === 'cast' || this.state === 'done') {
      const k = this.state === 'done' ? 1 : this.stateT / CAST_TIME;
      if (k < 0.65) {               // up overhead, wand swirling
        const u = k / 0.65;
        armX = -0.9 - 1.9 * u;
        wandX = Math.PI / 2 + 0.6 + 0.4 * u;
        lean = 0.12 - 0.2 * u;
        glow = 0.8 + 0.2 * u;
      } else if (k < 1) {           // the jab: arm and wand straight at the pig
        const u = Math.min(1, (k - 0.65) / 0.12);
        armX = -2.8 + 1.2 * u;
        wandX = Math.PI / 2 + 1.0 + 0.57 * u;
        lean = -0.08 + 0.3 * u;
        glow = 1.2;
      } else {                      // afterwards: lowers the wand slowly, pleased with herself
        const u = Math.min(1, this.stateT / 1.5);
        armX = -1.6 + 0.9 * u;
        wandX = Math.PI;
        lean = 0.22 - 0.15 * u;
        glow = 1.2 - 0.9 * u;
      }
    }
    m.body.rotation.x = lean;
    m.arm.rotation.x = armX;
    m.wand.rotation.x = wandX;
    m.head.rotation.x = -0.5 * lean + Math.sin(t * 1.7 + this.seed) * 0.04;
    m.head.rotation.z = this.state === 'walk' ? Math.sin(g * 0.5) * 0.06 : 0.12 * sn;   // tilts her head as she stares
    m.tip.scale.setScalar(0.025 * (1 + 0.8 * glow));
    const gl = Math.min(1, glow);
    m.tipMat.color.setRGB(0.45 + 0.3 * gl, 0.85 + 0.15 * gl, 0.3 + 0.25 * gl);   // green, brighter as she casts
  }

  // The troll: heavy rolling steps, the lantern held out in front and swaying on its handle, the
  // club dragged behind with its end on the ground. Staring, it straightens up, lifts the lantern
  // toward the pig and grips the club upright; charging, the club goes up overhead; then the smash.
  animateTroll(dt) {
    const m = this.m, sn = this.snarl, t = performance.now() / 1000;
    const running = this.state === 'run';
    this.gait += this.speed * dt * (running ? 1.5 : 2.4);
    const g = this.gait, moving = Math.min(1, this.speed / this.sp.walk);
    m.root.position.set(this.pos.x, this.pos.y, this.pos.z);
    m.root.rotation.set(0, this.yaw, 0);
    m.legs.forEach((leg, i) => { leg.rotation.x = Math.sin(g + i * Math.PI) * (running ? 0.75 : 0.42) * moving; });
    m.body.position.y = Math.abs(Math.sin(g)) * (running ? 0.12 : 0.05) * moving;
    m.body.rotation.z = Math.sin(g) * 0.07 * moving;
    let lean = 0.14 - 0.08 * sn + (running ? 0.18 : 0);
    let lampX = -0.55 + Math.sin(g) * 0.1 * moving - 0.5 * sn;   // the lantern arm, held out
    let armX = 0.3 + Math.sin(g + Math.PI) * 0.06 * moving, clubDir = null;  // null: dragging
    if (this.state === 'alert') {
      armX = -0.5; clubDir = 0.35;                       // club gripped upright in front of it
    } else if (this.state === 'windup') {
      const u = Math.min(1, this.stateT / (this.sp.windup * 0.7));
      armX = -0.5 - 2.2 * u; clubDir = 0.35 - 0.95 * u;  // up over its head
      lampX = -0.3;
    } else if (running) {
      armX = -2.7; clubDir = -0.6; lampX = -0.25 + Math.sin(g) * 0.3;
    } else if (this.state === 'smash' || this.state === 'done') {
      const k = this.state === 'done' ? 1 : this.stateT;
      if (k < SMASH_HIT - 0.12) {                        // winds back even further
        const u = k / (SMASH_HIT - 0.12);
        armX = -2.7 - 0.35 * u; clubDir = -0.6 - 0.6 * u; lean = 0.1 - 0.15 * u;
      } else {                                           // and brings it down: wham
        const u = Math.min(1, (k - (SMASH_HIT - 0.12)) / 0.12);
        armX = -3.05 + 2.15 * u; clubDir = -1.2 + 3.5 * u; lean = -0.05 + 0.4 * u;
      }
      if (this.state === 'done') {                       // leans on the club over the pig
        const u = Math.min(1, this.stateT / 1.2);
        armX = -0.9 + 0.3 * u; clubDir = 2.3 + 0.3 * u; lean = 0.35 - 0.15 * u;
      }
      lampX = -0.3;
    }
    m.body.rotation.x = lean;
    m.armL.rotation.x = lampX;
    // the lantern hangs straight down from the fist, swinging a little behind the motion
    m.lantern.rotation.x = -(lampX + lean) + Math.sin(t * 2.1 + this.seed) * 0.08 + Math.sin(g) * 0.12 * moving;
    m.arm.rotation.x = armX;
    if (clubDir === null) {
      // dragging: tip the club so its far end rests on the ground behind
      const hy = 2.2 * Math.cos(lean) + m.body.position.y - 1.15 * Math.cos(armX + lean);
      const c = Math.max(-1, Math.min(1, (0.12 - hy) / m.clubLen));
      m.club.rotation.x = -Math.acos(c) - armX - lean;
    } else m.club.rotation.x = clubDir - armX - lean;
    m.head.rotation.x = -0.15 * sn + Math.sin(t * 1.3 + this.seed) * 0.04 + (running ? -0.2 : 0);
    m.head.rotation.y = this.state === 'walk' ? Math.sin(t * 0.4 + this.seed) * 0.25 : 0;
    m.jaw.rotation.x = sn * (0.22 + 0.06 * Math.sin(t * 6));
    // the flame flickers
    const fl = 0.85 + 0.1 * Math.sin(t * 13 + this.seed) + 0.06 * Math.sin(t * 29);
    m.halo.scale.setScalar(1.6 * fl);
    this.flame = fl;
  }

  // The owl: perched upright, its head swivelling round to keep the pig in view (owls turn theirs
  // a long way); flying, its wings spread and beat, body tipped forward.
  animateOwl(dt, player) {
    const m = this.m, t = performance.now() / 1000;
    m.root.position.set(this.pos.x, this.pos.y, this.pos.z);
    m.root.rotation.set(0, this.yaw, 0);
    const flying = this.state === 'fly';
    let want = Math.sin(t * 0.5 + this.seed) * 0.9;                  // idly looking about
    if (this.look > 0.05 && player) {
      const toPig = Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z);
      want = Math.max(-2.3, Math.min(2.3, wrap(toPig - this.yaw)));
    }
    if (flying) want = 0;
    m.head.rotation.y += (want - m.head.rotation.y) * (1 - Math.exp(-6 * dt));
    m.head.rotation.z = flying ? 0 : Math.sin(t * 0.7 + this.seed) * 0.15 * this.look;   // a curious head tilt
    const flap = flying ? Math.sin(this.stateT * 22) : 0;
    for (const w of m.wings) w.rotation.z = w.userData.side * (flying ? 1.35 + flap * 0.8 : 0);
    m.body.rotation.x = flying ? 0.6 : 0;
    m.root.children.forEach((c) => { if (c.isMesh) c.visible = !flying || this.stateT < 0.15; });   // talons tuck up
  }

  animate(dt, player) {
    if (this.kind === 'owl') return this.animateOwl(dt, player);
    if (this.kind === 'witch') return this.animateWitch(dt);
    if (this.kind === 'troll') return this.animateTroll(dt);
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
      if (sp.hop && front) leg.rotation.x += 1.3 * look;                                         // sitting up: paws tucked at its chest
    }

    // Predators crouch low, head down and forward, lips pulled back, hackles up.
    // Docile animals lift their heads and stare, ears twitching.
    const bob = sp.hop ? Math.abs(Math.sin(g)) * m.hip * 0.6 * moving
      : Math.abs(Math.sin(g)) * (running ? 0.06 : 0.02 * moving);
    // a hopper's bounce lifts the whole animal, legs and all, so they stay attached
    if (sp.hop) m.root.position.y += bob;
    m.body.position.y = -0.1 * sn * (m.hip / 0.74) + (sp.hop ? 0 : bob);
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
  constructor({ scene, forest, audio, barn, mapRange, onPounce, onCastTick, onCurse, onGameOver }) {
    Object.assign(this, { scene, forest, audio, barn, mapRange, onPounce, onCastTick, onCurse, onGameOver });
    this.despawn = mapRange + 55;
    this.list = [];
    // The troll's lantern lights up the ground round it. One light, always in the scene (dark when
    // there's no troll), so the forest's shaders don't need rebuilding when a troll turns up.
    this.lanternLight = new THREE.PointLight('#ffb862', 0, 16, 1.6);
    scene.add(this.lanternLight);
    this.holes = []; // rabbit burrows: a dark hole in a ring of earth, left for a while after it dives in
    this.reset();
  }

  // A burrow where a rabbit dived in.
  addHole(x, z) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(HOLE_GEO, HOLE_MAT));
    const rim = new THREE.Mesh(RIM_GEO, RIM_MAT);
    rim.position.y = 0.01;
    g.add(rim);
    g.position.set(x, terrainHeight(x, z) + 0.02, z);
    this.scene.add(g);
    this.holes.push({ g, t: 40 });
  }

  reset() {
    for (const h of this.holes) this.scene.remove(h.g);
    this.holes = [];
    for (const c of this.list) c.remove();
    this.list = [];
    this.warned = false; // the girl's "danger nearby" warning has played this game
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
    if (sp.perch) return this.spawnPerched(kind, player);
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

  // The owl lands on a fallen log some way off, preferably ahead of the pig.
  spawnPerched(kind, player) {
    const sp = SPECIES[kind], fx = -Math.sin(player.heading), fz = -Math.cos(player.heading);
    const spots = [];
    for (const c of this.forest.nearbyColliders(player.pos.x, player.pos.z, sp.spawn[1])) {
      if (!c.log || c.top === undefined) continue;
      const dx = c.x - player.pos.x, dz = c.z - player.pos.z, d = Math.hypot(dx, dz);
      if (d < sp.spawn[0] || d > sp.spawn[1] || (dx * fx + dz * fz) / d < -0.3) continue;
      if (this.list.some((o) => Math.hypot(o.pos.x - c.x, o.pos.z - c.z) < 20)) continue;
      spots.push(c);
    }
    if (!spots.length) return null;
    const c = pick(spots);
    const o = this.add(kind, c.x, c.z, player);
    o.pos.y = c.top;
    // sitting across the log, facing the pig's side of it
    const toPig = Math.atan2(player.pos.x - c.x, player.pos.z - c.z);
    o.yaw = c.yaw + Math.PI / 2;
    if (Math.abs(wrap(toPig - o.yaw)) > Math.PI / 2) o.yaw += Math.PI;
    o.setState('perch');
    o.animate(0, player);
    return o;
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
    if (SPECIES[kind].perch) { slot.c = this.spawnPerched(kind, player); return slot.c; } // (on the nearest suitable log)
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

  // isNight: true from halfway into dusk until halfway through dawn (main.js night >= 0.5).
  update(dt, player, isNight = false) {
    const attacker = this.attacker;
    const troll = this.list.find((c) => c.kind === 'troll');
    if (troll) {
      troll.m.lanternCore.getWorldPosition(this.lanternLight.position);
      this.lanternLight.intensity = 7 * (troll.flame ?? 1);
    } else this.lanternLight.intensity = 0;
    for (const h of this.holes) if ((h.t -= dt) <= 0) this.scene.remove(h.g);
    this.holes = this.holes.filter((h) => h.t > 0);
    for (const slot of this.slots) {
      if (!slot.c) {
        slot.timer -= dt;
        // never more than MAX_DANGER wolves/bears/witches around at once: this one waits its turn
        const dangerous = SPECIES[slot.kinds[0]].danger;
        const wrongTime = slot.when && (slot.when === 'night') !== isNight;
        if (slot.timer <= 0 && wrongTime) slot.timer = rand(5, 12); // not its time of day: check again later
        else if (slot.timer <= 0 && dangerous && this.list.filter((c) => c.sp.danger).length >= MAX_DANGER) slot.timer = rand(8, 15);
        else if (slot.timer <= 0) {
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
