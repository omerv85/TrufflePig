import * as THREE from 'three';
import { fbm, mulberry32, hash2, smoothstep, terrainHeight, streamDist, waterLevel, STREAM_HALF } from './noise.js';

export { terrainHeight };

export const CHUNK = 36;   // metres per chunk side
const RADIUS = 3;          // chunks loaded around the pig in each direction
const GROUND_SEG = 32; // ~1.1 m cells so stream banks are smooth

// ---------- palette (pastel, afternoon) ----------
const C = (h) => new THREE.Color(h);
const PAL = {
  grassA: C('#a9dc8f'),
  grassB: C('#c4e89a'),
  grassSun: C('#e4efa2'),
  grassShade: C('#93cf98'),
  canopy: [C('#9fd88a'), C('#b6e39b'), C('#8fd09b'), C('#c8e8a2'), C('#a6dbb0')],
  pine: [C('#86c99a'), C('#7fc2a4'), C('#97d3a0')],
  birchLeaf: [C('#d8eea0'), C('#cbe89c')],
  trunk: C('#b98f74'),
  birch: C('#f2ece2'),
  bush: [C('#93d293'), C('#a8db92')],
  tuft: [C('#a2d98a'), C('#b8e398'), C('#95d39a'), C('#cbe79a')],
  flower: [C('#ffc4d6'), C('#dccbff'), C('#fff0a3'), C('#ffffff'), C('#ffd2b0')],
  rock: [C('#d9d3e3'), C('#e4ddd6'), C('#cfd6dd')],
  bank: C('#e8dcb5'),
  bed: C('#b9b6a0'),
  reed: [C('#9cc98a'), C('#b3d38f'), C('#8fbf8f')],
  cattail: C('#a77b62'),
};

// ---------- geometry templates ----------
function tpl(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g.attributes.uv) g.deleteAttribute('uv');
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

function grassGeometry() {
  const pos = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3;
    const ca = Math.cos(a), sa = Math.sin(a);
    const w = 0.07, lean = 0.16;
    const bx = ca * 0.05, bz = sa * 0.05;
    pos.push(bx - sa * w, 0, bz + ca * w, bx + sa * w, 0, bz - ca * w, bx + ca * lean, 1, bz + sa * lean);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

const T = {
  trunk: tpl(new THREE.CylinderGeometry(0.16, 0.26, 1, 6).translate(0, 0.5, 0)),
  blob: tpl(new THREE.IcosahedronGeometry(1, 1)),
  blobLo: tpl(new THREE.IcosahedronGeometry(1, 0)),
  cone: tpl(new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0)),
  rock: tpl(new THREE.DodecahedronGeometry(1, 0)),
  flower: tpl(new THREE.OctahedronGeometry(1, 0)),
  grass: tpl(grassGeometry()),
};

// ---------- merged-geometry builder ----------
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

function mat(x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

class Builder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.sway = []; }

  // swayBase/swayTip: wind sway weight at the bottom / top of the template.
  add(t, matrix, color, rng, swayBase = 0, swayTip = 0, jitter = 0.06) {
    const p = t.attributes.position, n = t.attributes.normal;
    const minY = t.boundingBox.min.y, hY = t.boundingBox.max.y - minY || 1;
    _nm.getNormalMatrix(matrix);
    let j = 1;
    for (let i = 0; i < p.count; i++) {
      if (i % 3 === 0) j = 1 + (rng() - 0.5) * jitter * 2;
      _v.fromBufferAttribute(p, i);
      const ty = (_v.y - minY) / hY;
      _v.applyMatrix4(matrix);
      _n.fromBufferAttribute(n, i).applyMatrix3(_nm).normalize();
      this.pos.push(_v.x, _v.y, _v.z);
      this.nor.push(_n.x, _n.y, _n.z);
      this.col.push(color.r * j, color.g * j, color.b * j);
      this.sway.push(swayBase + (swayTip - swayBase) * ty);
    }
  }

  tri(a, b, c, color) {
    _v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _n.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _v.cross(_n).normalize();
    for (const q of [a, b, c]) {
      this.pos.push(q[0], q[1], q[2]);
      this.nor.push(_v.x, _v.y, _v.z);
      this.col.push(color.r, color.g, color.b);
      this.sway.push(0);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 1));
    g.computeBoundingSphere();
    return g;
  }
}

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
const _tmpC = new THREE.Color();

// Open meadow around the spawn point and the barn behind it.
export const BARN_POS = { x: 0, z: 10 };
function inClearing(x, z) {
  const dz = z - 4;
  return x * x + dz * dz < 15 * 15;
}

function forestDensity(x, z) {
  return 0.12 + 0.6 * smoothstep(0.35, 0.65, fbm(x * 0.014, z * 0.014, 5, 2));
}

// ---------- props ----------
// Leaves never hang lower than this above the ground under them, so the pig (1.44 m to the
// ear tips) can walk beneath any canopy without its head poking into the leaves.
const LEAF_CLEAR = 2.0;

// How far a canopy whose lowest leaves sit at `bottom` must be raised to clear the highest
// ground within `spread` metres of the trunk (on a slope, the uphill side is the tight one).
function canopyLift(wx, wz, bottom, spread) {
  let top = terrainHeight(wx, wz);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    top = Math.max(top, terrainHeight(wx + Math.cos(a) * spread, wz + Math.sin(a) * spread));
  }
  return Math.max(0, top + LEAF_CLEAR - bottom);
}

function roundTree(b, x, y, z, rng, colliders, wx, wz) {
  let h = 2.2 + rng() * 1.8;
  const s = 0.9 + rng() * 0.5;
  const t0 = b.pos.length;
  b.add(T.trunk, mat(x, y - 0.2, z, s, h + 1.2, s, rng() * 6), PAL.trunk, rng, 0, 0.12, 0.05);
  const R = 1.6 + rng() * 1.0;
  // Raise a low canopy, stretching the trunk to match (keeps the random sequence, and so the forest, unchanged).
  const lift = canopyLift(wx, wz, y + h - 0.31 * R, R);
  if (lift > 0) {
    const k = (h + lift + 1.2) / (h + 1.2);
    for (let i = t0 + 1; i < b.pos.length; i += 3) b.pos[i] = y - 0.2 + (b.pos[i] - (y - 0.2)) * k;
    h += lift;
  }
  const col = pick(PAL.canopy, rng);
  const cy = y + h + R * 0.55;
  b.add(T.blob, mat(x, cy, z, R, R * 0.85, R, rng() * 6), col, rng, 0.15, 0.4);
  const n = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2, d = R * (0.5 + rng() * 0.3), r = R * (0.5 + rng() * 0.25);
    _tmpC.copy(col).offsetHSL((rng() - 0.5) * 0.03, 0, (rng() - 0.5) * 0.06);
    b.add(T.blob, mat(x + Math.cos(a) * d, cy + (rng() - 0.3) * R * 0.6, z + Math.sin(a) * d, r, r * 0.9, r, rng() * 6), _tmpC, rng, 0.2, 0.45);
  }
  colliders.push({ x: wx, z: wz, r: 0.3 * s + 0.05 });
}

function pineTree(b, x, y, z, rng, colliders, wx, wz) {
  const sc = 0.85 + rng() * 0.5;
  const lift = canopyLift(wx, wz, y + sc, 2.1 * sc); // the lowest tier's skirt starts 1 m up
  b.add(T.trunk, mat(x, y - 0.2, z, 0.9 * sc, 1.6 * sc + lift, 0.9 * sc, rng() * 6), PAL.trunk, rng, 0, 0.05, 0.05);
  const col = pick(PAL.pine, rng);
  const tiers = [[2.1, 2.5, 1.0], [1.65, 2.2, 2.2], [1.1, 1.9, 3.3]];
  for (const [r, h, oy] of tiers) {
    b.add(T.cone, mat(x, y + oy * sc + lift, z, r * sc, h * sc, r * sc, rng() * 6), col, rng, 0.05, 0.3);
  }
  colliders.push({ x: wx, z: wz, r: 0.3 * sc });
}

function birchTree(b, x, y, z, rng, colliders, wx, wz) {
  let h = 4 + rng() * 1.8;
  h += canopyLift(wx, wz, y + h - 1.8, 1.9); // worst case: the biggest leaf ball, low and off-centre
  b.add(T.trunk, mat(x, y - 0.2, z, 0.6, h + 0.4, 0.6, rng() * 6), PAL.birch, rng, 0, 0.15, 0.04);
  const col = pick(PAL.birchLeaf, rng);
  for (let i = 0; i < 3; i++) {
    const a = rng() * Math.PI * 2, d = 0.3 + rng() * 0.5, r = 0.9 + rng() * 0.5;
    b.add(T.blob, mat(x + Math.cos(a) * d, y + h - 0.4 + i * 0.6, z + Math.sin(a) * d, r, r, r, rng() * 6), col, rng, 0.2, 0.5);
  }
  colliders.push({ x: wx, z: wz, r: 0.2 });
}

function bush(b, x, y, z, rng) {
  const col = pick(PAL.bush, rng);
  const n = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < n; i++) {
    const r = 0.5 + rng() * 0.5;
    b.add(T.blobLo, mat(x + (rng() - 0.5) * 1.2, y + r * 0.4, z + (rng() - 0.5) * 1.2, r, r * 0.8, r, rng() * 6), col, rng, 0, 0.25, 0.08);
  }
}

// ---------- chunk ----------
function buildChunk(cx, cz) {
  const rng = mulberry32(Math.floor(hash2(cx, cz, 99) * 4294967296));
  const ox = cx * CHUNK, oz = cz * CHUNK;
  const b = new Builder();
  const colliders = [];
  // Truffles use their own random stream so adding them doesn't reshuffle the forest.
  const trng = mulberry32(Math.floor(hash2(cx, cz, 777) * 4294967296));
  const truffles = [];

  // Sample the terrain once on a grid shared by the ground and the water.
  const step = CHUNK / GROUND_SEG, N = GROUND_SEG + 1;
  const H = new Float32Array(N * N), D = new Float32Array(N * N), WL = new Float32Array(N * N);
  let anyWater = false;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const wx = ox + i * step, wz = oz + j * step, k = i * N + j;
      D[k] = streamDist(wx, wz);
      H[k] = terrainHeight(wx, wz);
      WL[k] = waterLevel(wx, wz);
      if (D[k] < STREAM_HALF + 2) anyWater = true;
    }
  }
  const at = (A, i, j) => A[i * N + j];

  // Ground
  const gc = new THREE.Color();
  for (let i = 0; i < GROUND_SEG; i++) {
    for (let j = 0; j < GROUND_SEG; j++) {
      const x0 = i * step, x1 = x0 + step, z0 = j * step, z1 = z0 + step;
      const h00 = at(H, i, j), h10 = at(H, i + 1, j), h01 = at(H, i, j + 1), h11 = at(H, i + 1, j + 1);
      const dCell = Math.min(at(D, i, j), at(D, i + 1, j), at(D, i, j + 1), at(D, i + 1, j + 1));
      for (let t = 0; t < 2; t++) {
        const mx = ox + x0 + step * (t ? 0.66 : 0.33), mz = oz + z0 + step * (t ? 0.66 : 0.33);
        gc.copy(PAL.grassA).lerp(PAL.grassB, fbm(mx * 0.06, mz * 0.06, 11, 2));
        gc.lerp(PAL.grassSun, smoothstep(0.55, 0.75, fbm(mx * 0.02, mz * 0.02, 23, 2)) * 0.7);
        gc.lerp(PAL.grassShade, forestDensity(mx, mz) * 0.5);
        // sandy banks and a pebbly bed near streams
        if (dCell < STREAM_HALF + 2.2) {
          gc.lerp(PAL.bank, smoothstep(STREAM_HALF + 2.2, STREAM_HALF + 0.6, dCell));
          gc.lerp(PAL.bed, smoothstep(STREAM_HALF + 0.4, STREAM_HALF - 0.6, dCell));
        }
        gc.multiplyScalar(1 + (rng() - 0.5) * 0.05);
        if (t === 0) b.tri([x0, h00, z0], [x0, h01, z1], [x1, h10, z0], gc);
        else b.tri([x1, h10, z0], [x0, h01, z1], [x1, h11, z1], gc);
      }
    }
  }

  // Water surface: only cells near a stream. Anything poking above the banks is hidden by the ground.
  let water = null;
  if (anyWater) {
    const wpos = [];
    for (let i = 0; i < GROUND_SEG; i++) {
      for (let j = 0; j < GROUND_SEG; j++) {
        const dCell = Math.min(at(D, i, j), at(D, i + 1, j), at(D, i, j + 1), at(D, i + 1, j + 1));
        if (dCell > STREAM_HALF + 0.9) continue;
        const x0 = i * step, x1 = x0 + step, z0 = j * step, z1 = z0 + step;
        const w00 = at(WL, i, j), w10 = at(WL, i + 1, j), w01 = at(WL, i, j + 1), w11 = at(WL, i + 1, j + 1);
        wpos.push(x0, w00, z0, x0, w01, z1, x1, w10, z0, x1, w10, z0, x0, w01, z1, x1, w11, z1);
      }
    }
    if (wpos.length) {
      water = new THREE.BufferGeometry();
      water.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
      water.computeVertexNormals();
      water.computeBoundingSphere();
    }
  }
  const wet = (wx, wz, margin) => streamDist(wx, wz) < STREAM_HALF + margin;

  // Reeds and cattails along the banks, pebbles in the water
  if (anyWater) {
    for (let i = 0; i < 90; i++) {
      const lx = rng() * CHUNK, lz = rng() * CHUNK, wx = ox + lx, wz = oz + lz;
      const d = streamDist(wx, wz);
      if (d < STREAM_HALF - 0.2 || d > STREAM_HALF + 1.4) continue;
      const y = terrainHeight(wx, wz), h = 0.7 + rng() * 0.6;
      b.add(T.grass, mat(lx, y - 0.05, lz, 0.45, h, 0.45, rng() * 6), pick(PAL.reed, rng), rng, 0, 0.8, 0.08);
      if (rng() < 0.45) b.add(T.flower, mat(lx + 0.08, y + h * 0.95, lz, 0.045, 0.15, 0.045, 0), PAL.cattail, rng, 0.8, 0.8, 0.05);
    }
    for (let i = 0; i < 40; i++) {
      const lx = rng() * CHUNK, lz = rng() * CHUNK, wx = ox + lx, wz = oz + lz;
      if (streamDist(wx, wz) > STREAM_HALF) continue;
      const r = 0.08 + rng() * 0.2;
      b.add(T.rock, mat(lx, terrainHeight(wx, wz) + r * 0.2, lz, r, r * 0.5, r * 1.2, rng() * 6), pick(PAL.rock, rng), rng, 0, 0, 0.06);
    }
  }

  // Trees & bushes on a jittered grid
  const CELL = 6;
  for (let gx = 0; gx < CHUNK / CELL; gx++) {
    for (let gz = 0; gz < CHUNK / CELL; gz++) {
      const lx = gx * CELL + 0.5 + rng() * (CELL - 1), lz = gz * CELL + 0.5 + rng() * (CELL - 1);
      const wx = ox + lx, wz = oz + lz;
      const spawnClear = inClearing(wx, wz) || wet(wx, wz, 2.2);
      const y = terrainHeight(wx, wz);
      const roll = rng();
      if (!spawnClear && roll < forestDensity(wx, wz)) {
        const k = rng();
        if (k < 0.5) roundTree(b, lx, y, lz, rng, colliders, wx, wz);
        else if (k < 0.82) pineTree(b, lx, y, lz, rng, colliders, wx, wz);
        else birchTree(b, lx, y, lz, rng, colliders, wx, wz);
        // Some trees hide a truffle in the ground just beside the trunk.
        if (trng() < 0.012) { // scarce: ~1 in 80 trees, roughly 100 m apart
          const tree = colliders[colliders.length - 1];
          const a = trng() * Math.PI * 2, d = tree.r + 0.65 + trng() * 0.45;
          const tx = wx + Math.cos(a) * d, tz = wz + Math.sin(a) * d;
          if (!wet(tx, tz, 0.6)) truffles.push({ id: `${cx},${cz},${truffles.length}`, x: tx, z: tz });
        }
      } else if (!spawnClear && rng() < 0.25) {
        bush(b, lx, y, lz, rng);
      }
    }
  }

  // Rocks
  const rocks = rng() < 0.6 ? 1 + Math.floor(rng() * 2) : 0;
  for (let i = 0; i < rocks; i++) {
    const lx = rng() * CHUNK, lz = rng() * CHUNK, wx = ox + lx, wz = oz + lz;
    if (inClearing(wx, wz) || wet(wx, wz, 1.8)) continue;
    const r = 0.3 + rng() * 0.6;
    b.add(T.rock, mat(lx, terrainHeight(wx, wz) + r * 0.2, lz, r, r * 0.6, r * 1.1, rng() * 6), pick(PAL.rock, rng), rng, 0, 0, 0.05);
    if (r > 0.55) colliders.push({ x: wx, z: wz, r: r * 0.9 });
  }

  // Grass tufts
  for (let i = 0; i < 170; i++) {
    const lx = rng() * CHUNK, lz = rng() * CHUNK;
    const s = 0.7 + rng() * 0.7;
    if (anyWater && wet(ox + lx, oz + lz, 0.3)) continue;
    b.add(T.grass, mat(lx, terrainHeight(ox + lx, oz + lz) - 0.02, lz, s, 0.28 + rng() * 0.32, s, rng() * 6), pick(PAL.tuft, rng), rng, 0, 1, 0.1);
  }

  // Flower patches
  const patches = 2 + Math.floor(rng() * 4);
  for (let p = 0; p < patches; p++) {
    const px = rng() * CHUNK, pz = rng() * CHUNK;
    const fc = pick(PAL.flower, rng);
    const n = 4 + Math.floor(rng() * 7);
    for (let i = 0; i < n; i++) {
      const lx = px + (rng() - 0.5) * 3, lz = pz + (rng() - 0.5) * 3;
      if (anyWater && wet(ox + lx, oz + lz, 0.5)) continue;
      const y = terrainHeight(ox + lx, oz + lz);
      const h = 0.25 + rng() * 0.15;
      b.add(T.grass, mat(lx, y - 0.02, lz, 0.4, h, 0.4, rng() * 6), PAL.tuft[0], rng, 0, 1, 0.05);
      b.add(T.flower, mat(lx + 0.06, y + h, lz, 0.07, 0.06, 0.07, rng() * 6), fc, rng, 1, 1, 0.08);
    }
  }

  return { geometry: b.build(), water, colliders, truffles };
}

// ---------- manager ----------
export class Forest {
  constructor(scene, material, waterMaterial) {
    this.scene = scene;
    this.material = material;
    this.waterMaterial = waterMaterial;
    this.chunks = new Map();
    this.boxes = []; // static axis-aligned obstacles, e.g. the barn
    this.collected = new Set(); // truffle ids already dug up (survive chunk reloads)
  }

  // Uncollected truffles in chunks near (x, z).
  *nearbyTruffles(x, z, range) {
    const pcx = Math.floor(x / CHUNK), pcz = Math.floor(z / CHUNK), n = Math.ceil(range / CHUNK);
    for (let dx = -n; dx <= n; dx++) {
      for (let dz = -n; dz <= n; dz++) {
        const c = this.chunks.get(Forest.key(pcx + dx, pcz + dz));
        if (!c) continue;
        for (const t of c.truffles) if (!this.collected.has(t.id)) yield t;
      }
    }
  }

  collect(id) { this.collected.add(id); }

  addBox(minX, maxX, minZ, maxZ) { this.boxes.push({ minX, maxX, minZ, maxZ }); }

  // World-space collider circles near (x, z), for the minimap.
  *nearbyColliders(x, z, range) {
    const pcx = Math.floor(x / CHUNK), pcz = Math.floor(z / CHUNK), n = Math.ceil(range / CHUNK);
    for (let dx = -n; dx <= n; dx++) {
      for (let dz = -n; dz <= n; dz++) {
        const c = this.chunks.get(Forest.key(pcx + dx, pcz + dz));
        if (c) yield* c.colliders;
      }
    }
  }

  static key(cx, cz) { return cx + ',' + cz; }

  // Streams chunks in nearest-first; maxBuilds limits hitches while moving.
  update(pos, maxBuilds = 2) {
    const pcx = Math.floor(pos.x / CHUNK), pcz = Math.floor(pos.z / CHUNK);
    const want = [];
    for (let dx = -RADIUS; dx <= RADIUS; dx++) {
      for (let dz = -RADIUS; dz <= RADIUS; dz++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > (RADIUS + 0.5) ** 2) continue;
        const k = Forest.key(pcx + dx, pcz + dz);
        if (!this.chunks.has(k)) want.push([d2, pcx + dx, pcz + dz, k]);
      }
    }
    want.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < Math.min(maxBuilds, want.length); i++) {
      const [, cx, cz, k] = want[i];
      const { geometry, water, colliders, truffles } = buildChunk(cx, cz);
      const mesh = new THREE.Mesh(geometry, this.material);
      mesh.position.set(cx * CHUNK, 0, cz * CHUNK);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.scene.add(mesh);
      let waterMesh = null;
      if (water) {
        waterMesh = new THREE.Mesh(water, this.waterMaterial);
        waterMesh.position.copy(mesh.position);
        waterMesh.receiveShadow = true;
        waterMesh.renderOrder = 1;
        waterMesh.matrixAutoUpdate = false;
        waterMesh.updateMatrix();
        this.scene.add(waterMesh);
      }
      this.chunks.set(k, { cx, cz, mesh, waterMesh, colliders, truffles });
    }
    for (const [k, c] of this.chunks) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz > (RADIUS + 1.5) ** 2) {
        this.scene.remove(c.mesh);
        c.mesh.geometry.dispose();
        if (c.waterMesh) {
          this.scene.remove(c.waterMesh);
          c.waterMesh.geometry.dispose();
        }
        this.chunks.delete(k);
      }
    }
  }

  // Push a circle of radius r at p out of tree trunks / big rocks.
  collide(p, r) {
    const pcx = Math.floor(p.x / CHUNK), pcz = Math.floor(p.z / CHUNK);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const c = this.chunks.get(Forest.key(pcx + dx, pcz + dz));
        if (!c) continue;
        for (const o of c.colliders) {
          const ex = p.x - o.x, ez = p.z - o.z, min = r + o.r;
          const d2 = ex * ex + ez * ez;
          if (d2 < min * min && d2 > 1e-8) {
            const d = Math.sqrt(d2);
            p.x = o.x + (ex / d) * min;
            p.z = o.z + (ez / d) * min;
          }
        }
      }
    }
    for (const b of this.boxes) {
      const x0 = b.minX - r, x1 = b.maxX + r, z0 = b.minZ - r, z1 = b.maxZ + r;
      if (p.x <= x0 || p.x >= x1 || p.z <= z0 || p.z >= z1) continue;
      // push out along the shallowest side
      const pen = [p.x - x0, x1 - p.x, p.z - z0, z1 - p.z];
      const i = pen.indexOf(Math.min(...pen));
      if (i === 0) p.x = x0; else if (i === 1) p.x = x1; else if (i === 2) p.z = z0; else p.z = z1;
    }
  }
}

// Pastel stream water: faceted, gently rippling so the facets catch the sun.
export function createWaterMaterial(timeUniform) {
  const m = new THREE.MeshPhongMaterial({
    color: '#a3d8ea', specular: '#fff4dc', shininess: 70, flatShading: true,
    transparent: true, opacity: 0.8, depthWrite: false,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = timeUniform;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vec4 wWorld = modelMatrix * vec4(transformed, 1.0);
      transformed.y += sin(uTime * 2.2 + wWorld.x * 1.7 + wWorld.z * 0.9) * 0.025
                     + sin(uTime * 3.1 - wWorld.z * 2.1 + wWorld.x * 0.6) * 0.018;`
    );
  };
  return m;
}

// Shared material with a cheap wind sway in the vertex shader.
export function createForestMaterial(timeUniform) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = timeUniform;
    sh.vertexShader = 'attribute float aSway;\nuniform float uTime;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vec4 swWorld = modelMatrix * vec4(transformed, 1.0);
      float sw = sin(uTime * 1.6 + swWorld.x * 0.35 + swWorld.z * 0.27) + 0.5 * sin(uTime * 2.9 + swWorld.x * 0.9);
      transformed.x += sw * aSway * 0.1;
      transformed.z += cos(uTime * 1.3 + swWorld.z * 0.3) * aSway * 0.07;`
    ).replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vCamDist = -mvPosition.z;`
    ).replace('void main() {', 'varying float vCamDist;\nvoid main() {');
    // Dither away leaves that come right up to the camera so it never sits inside a tree.
    sh.fragmentShader = sh.fragmentShader.replace(
      'void main() {',
      `varying float vCamDist;
      void main() {
        float fadeNear = smoothstep(0.6, 1.8, vCamDist);
        float dither = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
        if (fadeNear < dither) discard;`
    );
  };
  return m;
}
