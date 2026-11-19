import * as THREE from 'three';
import { terrainHeight, waterDepth } from './noise.js';

// Little flocks of songbirds pecking on the forest floor. They hop and peck until the pig
// comes close, then the whole flock bursts up and flies away (recorded wing flaps).

// ---------- tuning ----------
const MAX_FLOCKS = 3;
const SPAWN_MIN = 20, SPAWN_MAX = 32;  // metres ahead of the pig where new flocks land
const DESPAWN = 60;                    // grounded flocks this far away are removed
const SCARE = 4.5;                     // flee distance when the pig stands still...
const SCARE_SPEED = 1.0;               // ...plus this many metres per m/s of pig speed
const FLY_TIME = 4;                    // seconds a fleeing bird is kept before it's removed
const SIZE = 1.7;                     // overall bird scale

const rand = (a, b) => a + Math.random() * (b - a);

// Pastel species: back, breast, wing.
const SPECIES = [
  { back: '#a8978a', breast: '#ffb08a', wing: '#8f7f73' }, // robin
  { back: '#8fb9ea', breast: '#fff0d4', wing: '#76a1d6' }, // bluebird
  { back: '#f3d36c', breast: '#fbe7a0', wing: '#c9ad59' }, // finch
  { back: '#b9a48c', breast: '#efe3d0', wing: '#9b8670' }, // sparrow
];

// ---------- models ----------
// Body, head, beak, eyes, tail and legs merged into one vertex-coloured mesh; the wings are
// separate so they can fold and flap. Faces +Z, feet at y = 0.
function part(geo, color, m) {
  const g = (geo.index ? geo.toNonIndexed() : geo.clone()).applyMatrix4(m);
  const c = new THREE.Color(color), n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}
const M = (x, y, z, sx = 1, sy = 1, sz = 1, rx = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), new THREE.Vector3(sx, sy, sz));

function merge(parts) {
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array, o * 3);
    col.set(p.attributes.color.array, o * 3);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function bodyGeometry(sp) {
  const ball = new THREE.IcosahedronGeometry(1, 1);
  const leg = new THREE.CylinderGeometry(0.008, 0.008, 0.07, 4).translate(0, 0.035, 0);
  return merge([
    part(ball, sp.back, M(0, 0.13, -0.01, 0.1, 0.085, 0.135)),
    part(ball, sp.breast, M(0, 0.115, 0.04, 0.085, 0.075, 0.09)),
    part(ball, sp.back, M(0, 0.205, 0.095, 0.068, 0.064, 0.068)),
    part(ball, '#3a2f36', M(0.052, 0.218, 0.13, 0.013, 0.013, 0.013)),
    part(ball, '#3a2f36', M(-0.052, 0.218, 0.13, 0.013, 0.013, 0.013)),
    part(new THREE.ConeGeometry(0.02, 0.055, 5), '#f0ad55', M(0, 0.2, 0.18, 1, 1, 1, Math.PI / 2)),
    part(new THREE.BoxGeometry(0.075, 0.012, 0.11), sp.wing, M(0, 0.17, -0.16, 1, 1, 1, 0.4)),
    part(leg, '#d08a6c', M(0.03, 0, 0.0)),
    part(leg, '#d08a6c', M(-0.03, 0, 0.0)),
  ]);
}

// A rounded wing blade extending along +X from the shoulder.
function wingGeometry(sp, side) {
  return merge([part(new THREE.IcosahedronGeometry(1, 1), sp.wing, M(side * 0.085, 0, -0.02, 0.09, 0.012, 0.055))]);
}

const material = new THREE.MeshLambertMaterial({ vertexColors: true });
const MODELS = SPECIES.map((sp) => ({ body: bodyGeometry(sp), wing: [wingGeometry(sp, -1), wingGeometry(sp, 1)] }));

function createBird(kind) {
  const m = MODELS[kind];
  const root = new THREE.Group();
  const body = new THREE.Group(); // pitches forward to peck, pivoting at the feet
  root.add(body);
  const mesh = new THREE.Mesh(m.body, material);
  mesh.castShadow = true;
  body.add(mesh);
  const wings = [-1, 1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.07, 0.16, 0.03);
    pivot.userData.side = side;
    const w = new THREE.Mesh(m.wing[side > 0 ? 1 : 0], material);
    w.castShadow = true;
    pivot.add(w);
    body.add(pivot);
    return pivot;
  });
  root.scale.setScalar(SIZE * rand(0.9, 1.1));
  return { root, body, wings };
}

// fold: 1 = tucked along the body, 0 = spread. flap: up/down angle when spread.
function poseWings(b, fold, flap) {
  for (const w of b.wings) {
    const s = w.userData.side;
    w.rotation.y = s * fold * 1.35;       // swing back along the body
    w.rotation.z = s * (flap * (1 - fold) - 0.12 * fold);
  }
}

// ---------- flocks ----------
export class Birds {
  constructor({ scene, forest, audio }) {
    this.scene = scene;
    this.forest = forest;
    this.audio = audio;
    this.flocks = [];
    this.spawnTimer = 1;
  }

  // Dry, open ground away from tree trunks, rocks and the barn.
  freeSpot(x, z) {
    if (waterDepth(x, z) > -0.15) return false;
    for (const c of this.forest.nearbyColliders(x, z, 2)) {
      const dx = c.x - x, dz = c.z - z;
      if (dx * dx + dz * dz < (c.r + 0.8) ** 2) return false;
    }
    for (const b of this.forest.boxes) {
      if (x > b.minX - 1 && x < b.maxX + 1 && z > b.minZ - 1 && z < b.maxZ + 1) return false;
    }
    return true;
  }

  spawn(player, dist = rand(SPAWN_MIN, SPAWN_MAX)) {
    for (let tries = 0; tries < 8; tries++) {
      const a = player.heading + rand(-1.1, 1.1);
      const d = dist + rand(-3, 3);
      const cx = player.pos.x - Math.sin(a) * d, cz = player.pos.z - Math.cos(a) * d;
      if (!this.freeSpot(cx, cz)) continue;
      const kind = Math.floor(Math.random() * SPECIES.length);
      const n = 2 + Math.floor(Math.random() * 4);
      const birds = [];
      for (let i = 0; i < n; i++) {
        let x = cx, z = cz;
        for (let k = 0; k < 4; k++) {
          const r = Math.sqrt(Math.random()) * 1.6, t = Math.random() * Math.PI * 2;
          x = cx + Math.cos(t) * r; z = cz + Math.sin(t) * r;
          if (this.freeSpot(x, z)) break;
        }
        // mostly one species, now and then a stray from another
        const b = createBird(Math.random() < 0.8 ? kind : Math.floor(Math.random() * SPECIES.length));
        Object.assign(b, {
          x, z, y: terrainHeight(x, z), yaw: Math.random() * Math.PI * 2,
          peckT: rand(0, 2), hopT: -1, hopDir: 0, nextHop: rand(0.5, 3),
          flying: false, delay: 0, flyT: 0, vx: 0, vy: 0, vz: 0, flapPhase: Math.random() * 6,
        });
        poseWings(b, 1, 0);
        this.scene.add(b.root);
        birds.push(b);
      }
      this.flocks.push({ x: cx, z: cz, birds, fleeing: false });
      return true;
    }
    return false;
  }

  scare(flock, player) {
    flock.fleeing = true;
    for (const b of flock.birds) {
      let dx = b.x - player.pos.x, dz = b.z - player.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const a = Math.atan2(dx / d, dz / d) + rand(-0.7, 0.7);
      const sp = rand(4.5, 7);
      Object.assign(b, {
        flying: true, delay: rand(0, 0.3), flyT: 0,
        vx: Math.sin(a) * sp, vz: Math.cos(a) * sp, vy: rand(2.2, 3.6),
      });
    }
    // One burst of wing flaps per flock, panned toward it and quieter further away.
    const dx = flock.x - player.pos.x, dz = flock.z - player.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const h = player.heading;
    const pan = Math.max(-0.8, Math.min(0.8, ((dx * Math.cos(h) - dz * Math.sin(h)) / d) * 0.8));
    const vol = Math.max(0.25, 1 - d / 16) * (0.7 + flock.birds.length * 0.08);
    this.audio.wings?.({ vol, pan });
  }

  update(dt, player, active) {
    // keep a few flocks around ahead of the pig
    this.spawnTimer -= dt;
    const grounded = this.flocks.filter((f) => !f.fleeing).length;
    if (this.spawnTimer <= 0 && grounded < MAX_FLOCKS) {
      this.spawnTimer = rand(4, 9);
      this.spawn(player);
    }

    const scareDist = SCARE + SCARE_SPEED * player.speed;
    for (let fi = this.flocks.length - 1; fi >= 0; fi--) {
      const f = this.flocks[fi];
      const fd = Math.hypot(f.x - player.pos.x, f.z - player.pos.z);
      if (!f.fleeing) {
        if (fd > DESPAWN) { this.remove(fi); continue; }
        if (active) {
          for (const b of f.birds) {
            if (Math.hypot(b.x - player.pos.x, b.z - player.pos.z) < scareDist) { this.scare(f, player); break; }
          }
        }
      }
      let alive = 0;
      for (const b of f.birds) {
        if (b.flying) this.fly(b, dt); else this.idle(b, dt, player);
        if (!b.gone) alive++;
      }
      if (!alive) this.remove(fi);
    }
  }

  // Pecking, looking around and the odd little hop.
  idle(b, dt, player) {
    b.peckT += dt;
    // pecks come in quick double taps every couple of seconds
    const cyc = b.peckT % 2.4;
    const peck = cyc < 0.5 ? Math.max(0, Math.sin((cyc / 0.5) * Math.PI * 2)) : 0;
    b.body.rotation.x = peck * 0.75;

    b.nextHop -= dt;
    if (b.hopT < 0 && b.nextHop <= 0) {
      b.hopT = 0;
      b.yaw += rand(-1.2, 1.2);
      b.nextHop = rand(1, 4);
    }
    let lift = 0;
    if (b.hopT >= 0) {
      b.hopT += dt / 0.22;
      const nx = b.x + Math.sin(b.yaw) * dt * 0.8, nz = b.z + Math.cos(b.yaw) * dt * 0.8;
      if (this.freeSpot(nx, nz)) { b.x = nx; b.z = nz; }
      lift = Math.sin(Math.min(1, b.hopT) * Math.PI) * 0.07;
      if (b.hopT >= 1) b.hopT = -1;
    }
    b.y = terrainHeight(b.x, b.z);
    b.root.position.set(b.x, b.y + lift, b.z);
    b.root.rotation.y = b.yaw;
    poseWings(b, 1, lift > 0 ? 0.3 : 0);
  }

  fly(b, dt) {
    if (b.gone) return;
    if (b.delay > 0) { b.delay -= dt; this.idleFreeze(b); return; }
    b.flyT += dt;
    const k = Math.min(1, b.flyT / 0.6); // burst up, then level off and speed away
    b.x += b.vx * dt * (0.6 + 0.6 * k);
    b.z += b.vz * dt * (0.6 + 0.6 * k);
    b.y += b.vy * dt * (1.4 - 0.7 * k);
    b.flapPhase += dt * 28;
    b.root.position.set(b.x, b.y, b.z);
    b.root.rotation.y = Math.atan2(b.vx, b.vz);
    b.body.rotation.x = -0.5 * (1 - k) - 0.15; // nose up as it takes off
    poseWings(b, Math.max(0, 1 - b.flyT * 6), Math.sin(b.flapPhase) * 1.1);
    if (b.flyT > FLY_TIME) {
      b.gone = true;
      this.scene.remove(b.root);
    }
  }

  idleFreeze(b) {
    b.body.rotation.x *= 0.8; // looks up, about to go
  }

  remove(i) {
    for (const b of this.flocks[i].birds) this.scene.remove(b.root);
    this.flocks.splice(i, 1);
  }
}
