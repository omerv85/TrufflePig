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
  oak: [C('#8ccb86'), C('#9ad18a'), C('#86c592')],
  oakBark: C('#a7826b'),
  poplar: [C('#b8de8c'), C('#aad78c'), C('#c3e292')],
  spruce: [C('#73b398'), C('#6cae94'), C('#7cb99c')],
  bush: [C('#93d293'), C('#a8db92')],
  tuft: [C('#a2d98a'), C('#b8e398'), C('#95d39a'), C('#cbe79a')],
  flower: [C('#ffc4d6'), C('#dccbff'), C('#fff0a3'), C('#ffffff'), C('#ffd2b0')],
  rock: [C('#d9d3e3'), C('#e4ddd6'), C('#cfd6dd')],
  creekRock: [C('#c9c4d4'), C('#d4cdc4'), C('#bcc5ce'), C('#b3b0be'), C('#e0dad2')],
  bank: C('#e8dcb5'),
  bed: C('#b9b6a0'),
  reed: [C('#9cc98a'), C('#b3d38f'), C('#8fbf8f')],
  cattail: C('#a77b62'),
  litter: C('#dccb9c'),
  bark: C('#c19d84'),
  cutWood: C('#efd9b4'),
  moss: [C('#a6d48a'), C('#b5dc8f'), C('#98cc8e')],
  leaf: [C('#557f3f'), C('#4a7038'), C('#6a8c45'), C('#6e4a30'), C('#5e3f2a'), C('#80583a'), C('#8e3b28'), C('#9c4a2e'), C('#7c3324')],
  shroom: [C('#f4a9a0'), C('#f3d5a5'), C('#e6c4ea'), C('#fbe7c6')],
  stem: C('#fbf3e6'),
  mud: C('#b8957c'),
  mudEdge: C('#d0b498'),
  puddle: C('#c3dce8'),
  puddleDeep: C('#acc8d8'),
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
  log: tpl(new THREE.CylinderGeometry(1, 1, 1, 7, 1)),
};

// ---------- merged-geometry builder ----------
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

function mat(x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

// Same, but with the template's y axis pointing along `dir` (unit), rolled by `roll` about it.
const UP = new THREE.Vector3(0, 1, 0), _q2 = new THREE.Quaternion();
function matDir(x, y, z, dir, sx, sy, sz, roll = 0) {
  _q.setFromUnitVectors(UP, dir).multiply(_q2.setFromAxisAngle(UP, roll));
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
  colliders.push({ x: wx, z: wz, r: 0.3 * s + 0.05, leaf: cy }); // leaf: canopy centre height (squirrels climb to it)
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
  colliders.push({ x: wx, z: wz, r: 0.3 * sc, leaf: y + 2.2 * sc + lift });
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
  colliders.push({ x: wx, z: wz, r: 0.2, leaf: y + h + 0.2 });
}

// ---------- extra tree kinds ----------
// Picked from their own random stream (see buildChunk), so they replace some of the trees
// above in place without moving anything else in the forest.

// Broad oak: thick trunk, two side boughs, a wide flattish crown of many leaf balls.
function oakTree(b, x, y, z, rng, colliders, wx, wz) {
  const s = 1.4 + rng() * 0.4;
  const R = 2.3 + rng() * 0.8;
  let h = 2.3 + rng() * 0.8;
  h += canopyLift(wx, wz, y + h - R * 0.35, R * 1.5); // lowest leaf ball bottom
  const cy = y + h + R * 0.25;
  b.add(T.trunk, mat(x, y - 0.2, z, s, h + 0.9, s, rng() * 6), PAL.oakBark, rng, 0, 0.08, 0.05);
  for (let i = 0; i < 2; i++) {
    const a = rng() * Math.PI * 2 + i * Math.PI;
    _v.set(Math.cos(a) * 0.75, 1, Math.sin(a) * 0.75).normalize();
    b.add(T.trunk, matDir(x, y + h * 0.7, z, _v, 0.55, R * 0.8, 0.55), PAL.oakBark, rng, 0.05, 0.2, 0.05);
  }
  const col = pick(PAL.oak, rng);
  b.add(T.blob, mat(x, cy + R * 0.15, z, R, R * 0.62, R, rng() * 6), col, rng, 0.15, 0.35);
  const n = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng() * 0.6, d = R * (0.7 + rng() * 0.25), r = R * (0.42 + rng() * 0.18);
    _tmpC.copy(col).offsetHSL((rng() - 0.5) * 0.03, 0, (rng() - 0.5) * 0.07);
    b.add(T.blob, mat(x + Math.cos(a) * d, cy + (rng() - 0.4) * R * 0.3, z + Math.sin(a) * d, r, r * 0.75, r, rng() * 6), _tmpC, rng, 0.2, 0.42);
  }
  colliders.push({ x: wx, z: wz, r: 0.3 * s + 0.05, leaf: cy });
}

// Forked tree: the trunk splits in a Y into two branches, each topped with its own leaf crown.
function forkTree(b, x, y, z, rng, colliders, wx, wz) {
  const s = 1.0 + rng() * 0.3;
  let f = 1.5 + rng() * 0.7;                 // fork height
  const R = 2.2 + rng() * 0.5;               // crown size (big: the two crowns overlap, owner's request)
  const a0 = rng() * Math.PI;
  // Each branch gets its own tilt from vertical, direction and length, so no two Ys look alike.
  const br = [0, 1].map((k) => ({
    a: a0 + k * Math.PI + (rng() - 0.5) * 0.8,
    t: 0.35 + rng() * 0.45,
    L: 2.8 + rng() * 0.9,
  }));
  let low = Infinity, reach = 0;
  for (const q of br) {
    low = Math.min(low, Math.cos(q.t) * q.L);
    reach = Math.max(reach, Math.sin(q.t) * q.L);
  }
  f += canopyLift(wx, wz, y + f + low - R * 0.55, reach + R * 1.3); // lowest leaf bottom, widest reach
  b.add(T.trunk, mat(x, y - 0.2, z, s, f + 0.35, s, rng() * 6), PAL.trunk, rng, 0, 0.06, 0.05);
  b.add(T.blobLo, mat(x, y + f, z, 0.24 * s, 0.32 * s, 0.24 * s, rng() * 6), PAL.trunk, rng, 0.06, 0.08, 0.05); // knot at the fork
  const col = pick(PAL.canopy, rng);
  for (const { a, t, L } of br) {
    _v.set(Math.cos(a) * Math.sin(t), Math.cos(t), Math.sin(a) * Math.sin(t));
    const tx = x + _v.x * L, ty = y + f + _v.y * L + R * 0.35, tz = z + _v.z * L; // before add(), which reuses _v
    b.add(T.trunk, matDir(x, y + f - 0.1, z, _v, 0.8 * s, L + 0.25, 0.8 * s, rng() * 6), PAL.trunk, rng, 0.06, 0.25, 0.05);
    _tmpC.copy(col).offsetHSL((rng() - 0.5) * 0.03, 0, (rng() - 0.5) * 0.06);
    b.add(T.blob, mat(tx, ty, tz, R, R * 0.85, R, rng() * 6), _tmpC, rng, 0.25, 0.45);
    for (let i = 0; i < 2; i++) { // smaller balls round each crown
      const b2 = rng() * Math.PI * 2, d = R * 0.55, r = R * (0.55 + rng() * 0.15);
      b.add(T.blob, mat(tx + Math.cos(b2) * d, ty + (rng() - 0.2) * R * 0.4, tz + Math.sin(b2) * d, r, r * 0.85, r, rng() * 6), _tmpC, rng, 0.3, 0.5);
    }
  }
  colliders.push({ x: wx, z: wz, r: 0.3 * s + 0.05, leaf: y + f + low, fork: a0 });
}

// Branched tree: a straight trunk with a crown on top, and one or two branches angling off to
// the side partway up, each with its own crown.
// With `twin`: always two branches at the same angle, on opposite sides, from different heights.
function branchTree(b, x, y, z, rng, colliders, wx, wz, twin = false) {
  const s = 1.05 + rng() * 0.3;
  const H = 4.6 + rng() * 1.4;               // trunk height (to the top crown)
  const R = 1.9 + rng() * 0.5;               // top crown size
  const crowns = [{ dx: 0, dy: H, dz: 0, r: R }];
  const nb = twin || rng() >= 0.55 ? 2 : 1;
  const a0 = rng() * Math.PI * 2;
  let tTwin, atTwin, gap; // drawn only for the twin, so the one/two-branch trees stay as they were
  if (twin) { tTwin = 0.8 + rng() * 0.3; atTwin = H * (0.36 + rng() * 0.1); gap = H * (0.15 + rng() * 0.08); }
  const br = [];
  for (let k = 0; k < nb; k++) {
    // two branches go off to different sides (exactly opposite on the twin)
    const a = a0 + k * (twin ? Math.PI : Math.PI * (0.7 + rng() * 0.6));
    const t = twin ? tTwin : 0.75 + rng() * 0.4; // angle from vertical
    const L = 2.0 + rng() * 0.9;
    const at = twin ? atTwin + k * gap : H * (0.42 + rng() * 0.25) + k * 0.4; // where on the trunk it starts
    const d = [Math.cos(a) * Math.sin(t), Math.cos(t), Math.sin(a) * Math.sin(t)];
    const r = R * (0.65 + rng() * 0.15);
    br.push({ at, d, L });
    crowns.push({ dx: d[0] * L, dy: at + d[1] * L, dz: d[2] * L, r });
  }
  // Raise the whole tree (stretching the trunk) if its lowest crown would hang into the pig's way.
  let low = Infinity, reach = 0;
  for (const c of crowns) {
    low = Math.min(low, c.dy + c.r * 0.35 - c.r * 0.85);
    reach = Math.max(reach, Math.hypot(c.dx, c.dz) + c.r * 1.3);
  }
  const lift = canopyLift(wx, wz, y + low, reach);
  b.add(T.trunk, mat(x, y - 0.2, z, s, H + lift + 0.2, s, rng() * 6), PAL.trunk, rng, 0, 0.1, 0.05);
  for (const { at, d, L } of br) {
    _v.set(d[0], d[1], d[2]);
    b.add(T.trunk, matDir(x, y + at + lift - 0.15, z, _v, 0.7 * s, L + 0.2, 0.7 * s, rng() * 6), PAL.trunk, rng, 0.05, 0.25, 0.05);
  }
  const col = pick(PAL.canopy, rng);
  for (const c of crowns) {
    const cx = x + c.dx, cy = y + c.dy + lift + c.r * 0.35, cz = z + c.dz;
    _tmpC.copy(col).offsetHSL((rng() - 0.5) * 0.03, 0, (rng() - 0.5) * 0.06);
    b.add(T.blob, mat(cx, cy, cz, c.r, c.r * 0.85, c.r, rng() * 6), _tmpC, rng, 0.25, 0.45);
    for (let i = 0; i < 2; i++) {
      const b2 = rng() * Math.PI * 2, d = c.r * 0.55, r = c.r * (0.55 + rng() * 0.15);
      b.add(T.blob, mat(cx + Math.cos(b2) * d, cy + (rng() - 0.2) * c.r * 0.4, cz + Math.sin(b2) * d, r, r * 0.85, r, rng() * 6), _tmpC, rng, 0.3, 0.5);
    }
  }
  colliders.push({ x: wx, z: wz, r: 0.3 * s + 0.05, leaf: y + H * 0.8 + lift, side: a0 });
}

// Two-sided tree: a straight trunk with one branch out each side, at the same angle but from
// different heights up the trunk.
function twinBranchTree(b, x, y, z, rng, colliders, wx, wz) {
  branchTree(b, x, y, z, rng, colliders, wx, wz, true);
}

// Poplar: a tall narrow column of leaves on a short trunk.
function poplarTree(b, x, y, z, rng, colliders, wx, wz) {
  const R = 0.95 + rng() * 0.35, L = 3.6 + rng() * 1.8;
  let h = 1.0 + rng() * 0.5;
  h += canopyLift(wx, wz, y + h + 0.3, R * 1.1);
  b.add(T.trunk, mat(x, y - 0.2, z, 0.8, h + 1.5, 0.8, rng() * 6), PAL.trunk, rng, 0, 0.08, 0.05);
  const col = pick(PAL.poplar, rng);
  const cy = y + h + 0.3 + L / 2;
  b.add(T.blob, mat(x, cy, z, R, L / 2, R, rng() * 6), col, rng, 0.1, 0.5);
  _tmpC.copy(col).offsetHSL(0, 0, -0.04);
  b.add(T.blob, mat(x + (rng() - 0.5) * 0.3, cy + L * 0.08, z + (rng() - 0.5) * 0.3, R * 0.8, L * 0.42, R * 0.8, rng() * 6), _tmpC, rng, 0.15, 0.55);
  colliders.push({ x: wx, z: wz, r: 0.22, leaf: cy - L * 0.15 });
}

// Spruce: taller and darker than the pine, five narrowing tiers up to a spike.
function spruceTree(b, x, y, z, rng, colliders, wx, wz) {
  const sc = 0.95 + rng() * 0.45;
  const lift = canopyLift(wx, wz, y + 1.0 * sc, 1.9 * sc);
  b.add(T.trunk, mat(x, y - 0.2, z, 0.8 * sc, 1.6 * sc + lift, 0.8 * sc, rng() * 6), PAL.oakBark, rng, 0, 0.05, 0.05);
  const col = pick(PAL.spruce, rng);
  const tiers = [[1.9, 2.1, 1.0], [1.6, 2.0, 2.0], [1.3, 1.9, 3.0], [1.0, 1.8, 4.0], [0.65, 1.8, 5.0]];
  for (const [r, th, oy] of tiers) {
    _tmpC.copy(col).offsetHSL(0, 0, (rng() - 0.5) * 0.04);
    b.add(T.cone, mat(x, y + oy * sc + lift, z, r * sc, th * sc, r * sc, rng() * 6), _tmpC, rng, 0.05, 0.3);
  }
  colliders.push({ x: wx, z: wz, r: 0.27 * sc, leaf: y + 3 * sc + lift });
}

// Whether a tree becomes one of the extra kinds (null: keep the usual round/pine/birch).
// Oaks gather in groves in some parts of the forest, spruces in others.
function treeVariant(wx, wz, vr) {
  if (vr() > 0.6) return null;
  const g = fbm(wx * 0.011, wz * 0.011, 41, 2), u = vr();
  if (g > 0.6 && u < 0.4) return oakTree;
  if (g < 0.4 && u < 0.4) return spruceTree;
  // Forked and side-branch trees are the most common of the extra kinds (owner's request).
  return pick([oakTree, poplarTree, poplarTree, spruceTree,
    forkTree, forkTree, forkTree, forkTree, branchTree, branchTree, branchTree, branchTree,
    twinBranchTree, twinBranchTree, twinBranchTree, twinBranchTree], vr);
}

function bush(b, x, y, z, rng) {
  const col = pick(PAL.bush, rng);
  const n = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < n; i++) {
    const r = 0.5 + rng() * 0.5;
    b.add(T.blobLo, mat(x + (rng() - 0.5) * 1.2, y + r * 0.4, z + (rng() - 0.5) * 1.2, r, r * 0.8, r, rng() * 6), col, rng, 0, 0.25, 0.08);
  }
}

// Maple leaf outline, base to tip and back: five pointed lobes with notches between
// (u along the leaf, v across; [u, v, lift]). Drawn as a fan from a point in the middle.
const MAPLE = [
  [0, 0, 0.006], [0.1, 0.3, 0.002], [0.04, 0.55, 0], [0.3, 0.33, 0.008], [0.42, 0.62, 0],
  [0.6, 0.6, 0.002], [0.56, 0.24, 0.01], [0.72, 0.2, 0.008], [1, 0, 0.012],
  [0.72, -0.2, 0.008], [0.56, -0.24, 0.01], [0.6, -0.6, 0.002], [0.42, -0.62, 0],
  [0.3, -0.33, 0.008], [0.04, -0.55, 0], [0.1, -0.3, 0.002],
];

// ---------- chunk ----------
function buildChunk(cx, cz) {
  const rng = mulberry32(Math.floor(hash2(cx, cz, 99) * 4294967296));
  const ox = cx * CHUNK, oz = cz * CHUNK;
  const b = new Builder();
  const colliders = [];
  // Truffles use their own random stream so adding them doesn't reshuffle the forest.
  const trng = mulberry32(Math.floor(hash2(cx, cz, 777) * 4294967296));
  const truffles = [];
  // The extra tree kinds have their own stream too.
  const vrng = mulberry32(Math.floor(hash2(cx, cz, 321) * 4294967296));

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
        // patches of old leaf litter under the trees
        gc.lerp(PAL.litter, smoothstep(0.45, 0.7, fbm(mx * 0.09, mz * 0.09, 31, 2)) * Math.min(0.7, forestDensity(mx, mz)));
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
        const base = k < 0.5 ? roundTree : k < 0.82 ? pineTree : birchTree;
        const variant = treeVariant(wx, wz, vrng);
        if (variant) {
          // Build the usual tree off to the side so `rng` advances exactly as before
          // (the rest of the chunk stays put), then the new kind in its place.
          base(new Builder(), lx, y, lz, rng, [], wx, wz);
          variant(b, lx, y, lz, vrng, colliders, wx, wz);
          colliders[colliders.length - 1].kind = variant.name; // e.g. 'oakTree' (handy for finding one in tests)
        } else base(b, lx, y, lz, rng, colliders, wx, wz);
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

  // Forest-floor clutter (fallen logs, stones, leaves, mud puddles) uses its own random stream
  // too, so the trees and truffles stay where they were.
  const frng = mulberry32(Math.floor(hash2(cx, cz, 555) * 4294967296));
  // Height of the ground mesh itself (not the smooth terrain) so flat things lie right on it.
  const gy = (lx, lz) => {
    const fi = Math.min(GROUND_SEG - 1e-4, Math.max(0, lx / step)), fj = Math.min(GROUND_SEG - 1e-4, Math.max(0, lz / step));
    const i = Math.floor(fi), j = Math.floor(fj), fx = fi - i, fz = fj - j;
    const h00 = at(H, i, j), h10 = at(H, i + 1, j), h01 = at(H, i, j + 1), h11 = at(H, i + 1, j + 1);
    return fx + fz <= 1 ? h00 + (h10 - h00) * fx + (h01 - h00) * fz
      : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  };
  const trees = colliders.filter((c) => c.leaf !== undefined);
  const nearBarn = (wx, wz) => (wx - BARN_POS.x) ** 2 + (wz - BARN_POS.z) ** 2 < 8 * 8;
  const clearOf = (wx, wz, r) => {
    for (const c of colliders) if ((c.x - wx) ** 2 + (c.z - wz) ** 2 < (c.r + r) ** 2) return false;
    for (const t of truffles) if ((t.x - wx) ** 2 + (t.z - wz) ** 2 < (r + 2.2) ** 2) return false;
    return true;
  };

  // Fallen logs
  const logTries = frng() < 0.25 + forestDensity(ox + CHUNK / 2, oz + CHUNK / 2) ? 4 : 1;
  let logs = 0;
  for (let k = 0; k < logTries && logs < 2; k++) {
    const len = 2.8 + frng() * 3.4, r = 0.2 + frng() * 0.17, a = frng() * Math.PI * 2;
    const lx = frng() * CHUNK, lz = frng() * CHUNK;
    frng(); // (was the root-plate roll; kept so the logs stay where they are)
    const dx = Math.cos(a), dz = Math.sin(a);
    const ax = lx - dx * len / 2, az = lz - dz * len / 2, bx = lx + dx * len / 2, bz = lz + dz * len / 2;
    if (Math.min(ax, az, bx, bz) < 1.2 || Math.max(ax, az, bx, bz) > CHUNK - 1.2) continue;
    const yA = gy(ax, az) + r * 0.7, yB = gy(bx, bz) + r * 0.7;
    let ok = true;
    for (let t = 0; t <= 1.0001 && ok; t += 0.1) {
      const sx = ax + (bx - ax) * t, sz = az + (bz - az) * t, wx = ox + sx, wz = oz + sz;
      const lift = yA + (yB - yA) * t - gy(sx, sz);
      ok = lift > r * 0.25 && lift < r * 1.5 && !inClearing(wx, wz) && !nearBarn(wx, wz) && !wet(wx, wz, 2.2)
        && clearOf(wx, wz, r + 0.45);
    }
    if (!ok) continue;
    logs++;
    const dir = new THREE.Vector3(bx - ax, yB - yA, bz - az).normalize();
    const side = new THREE.Vector3(-dz, 0, dx); // horizontal, across the log
    b.add(T.log, matDir(lx, (yA + yB) / 2, lz, dir, r, len, r, frng() * 6), PAL.bark, frng, 0, 0, 0.07);
    // pale cut ends
    b.add(T.log, matDir(ax - dir.x * 0.015, yA - dir.y * 0.015, az - dir.z * 0.015, dir, r * 0.88, 0.04, r * 0.88), PAL.cutWood, frng, 0, 0, 0.04);
    b.add(T.log, matDir(bx + dir.x * 0.015, yB + dir.y * 0.015, bz + dir.z * 0.015, dir, r * 0.88, 0.04, r * 0.88), PAL.cutWood, frng, 0, 0, 0.04);
    // moss on top, squashed flat onto the bark
    const moss = 2 + Math.floor(frng() * 3), mossN = T.blobLo.attributes.position.count;
    for (let i = 0; i < moss; i++) {
      const t = 0.15 + frng() * 0.7, ms = r * (0.55 + frng() * 0.35), cy = yA + (yB - yA) * t + r * 0.78;
      b.add(T.blobLo, matDir(ax + (bx - ax) * t, cy, az + (bz - az) * t, dir, ms, ms * 1.6, ms, frng() * 6),
        pick(PAL.moss, frng), frng, 0, 0, 0.08);
      for (let v = b.pos.length - mossN * 3 + 1; v < b.pos.length; v += 3) b.pos[v] = cy + (b.pos[v] - cy) * 0.22;
    }
    // a snapped-off branch
    if (frng() < 0.6) {
      const t = 0.3 + frng() * 0.5, s = frng() < 0.5 ? 1 : -1;
      b.add(T.trunk, mat(ax + (bx - ax) * t, yA + (yB - yA) * t + r * 0.3, az + (bz - az) * t, 0.4, 0.7 + frng() * 0.6, 0.4,
        0, side.z * 0.8 * s, -side.x * 0.8 * s), PAL.bark, frng, 0, 0, 0.05);
    }
    // a little cluster of mushrooms on its side
    if (frng() < 0.55) {
      const t0 = 0.2 + frng() * 0.6, s = frng() < 0.5 ? 1 : -1, col = pick(PAL.shroom, frng), n = 2 + Math.floor(frng() * 3);
      for (let i = 0; i < n; i++) {
        const t = t0 + (frng() - 0.5) * 0.12, h = 0.06 + frng() * 0.06, cr = 0.05 + frng() * 0.04;
        const mx = ax + (bx - ax) * t + side.x * s * r * 0.8, mz = az + (bz - az) * t + side.z * s * r * 0.8;
        const my = yA + (yB - yA) * t + r * 0.3 + (frng() - 0.5) * r * 0.3;
        b.add(T.trunk, mat(mx, my, mz, 0.12, h, 0.12), PAL.stem, frng, 0, 0, 0.03);
        b.add(T.blob, mat(mx, my + h, mz, cr, cr * 0.5, cr), col, frng, 0, 0, 0.05);
      }
    }
    const nc = Math.ceil(len / 0.6);
    for (let i = 0; i < nc; i++) {
      const t = (i + 0.5) / nc;
      colliders.push({ x: ox + ax + (bx - ax) * t, z: oz + az + (bz - az) * t, r: r + 0.05, log: true, top: yA + (yB - yA) * t + r * 0.95, yaw: a });
    }
  }

  // Stones: little clusters half sunk in the ground, some with moss on top
  const clusters = 2 + Math.floor(frng() * 3);
  for (let k = 0; k < clusters; k++) {
    const px = 1.5 + frng() * (CHUNK - 3), pz = 1.5 + frng() * (CHUNK - 3);
    const n = 2 + Math.floor(frng() * 5), big = frng() < 0.35;
    if (inClearing(ox + px, oz + pz) || wet(ox + px, oz + pz, 1.5)) continue;
    for (let i = 0; i < n; i++) {
      const lx = Math.min(CHUNK, Math.max(0, px + (frng() - 0.5) * 2.4)), lz = Math.min(CHUNK, Math.max(0, pz + (frng() - 0.5) * 2.4));
      const wx = ox + lx, wz = oz + lz;
      const r = i === 0 && big ? 0.38 + frng() * 0.25 : 0.07 + frng() * 0.2;
      const sy = 0.45 + frng() * 0.3, sz = 0.9 + frng() * 0.4, ry = frng() * 6, rx = (frng() - 0.5) * 0.4, rz = (frng() - 0.5) * 0.4;
      const col = pick(PAL.rock, frng), mossy = r > 0.2 && frng() < 0.6;
      if (!clearOf(wx, wz, r + 0.1)) continue;
      const y = gy(lx, lz);
      b.add(T.rock, mat(lx, y + r * 0.15, lz, r, r * sy, r * sz, ry, rx, rz), col, frng, 0, 0, 0.06);
      if (mossy) b.add(T.blobLo, mat(lx, y + r * (0.15 + sy * 0.75), lz, r * 0.7, r * 0.16, r * 0.75, ry), pick(PAL.moss, frng), frng, 0, 0, 0.08);
      if (r > 0.45) colliders.push({ x: wx, z: wz, r: r * 0.85 });
    }
  }

  // Creek rocks: pebbles on the bed, stones and the odd boulder breaking the surface, more along the banks
  if (anyWater) {
    for (let i = 0; i < 380; i++) {
      const lx = frng() * CHUNK, lz = frng() * CHUNK, wx = ox + lx, wz = oz + lz;
      const roll = frng(), ry = frng() * 6, sy = 0.75 + frng() * 0.45, sz = 0.85 + frng() * 0.4, col = pick(PAL.creekRock, frng);
      const tilt = (frng() - 0.5) * 0.5, mossy = frng() < 0.5;
      const d = streamDist(wx, wz);
      if (d > STREAM_HALF + 1.1) continue;
      const inWater = d < STREAM_HALF - 0.1;
      // in the water: fewer pebbles, more stones and boulders tall enough to break the surface
      const r = roll < (inWater ? 0.3 : 0.5) ? 0.06 + roll * 0.3        // pebble
        : roll < (inWater ? 0.85 : 0.97) ? 0.22 + (roll - 0.3) * 0.3     // stone
        : 0.4 + (roll - 0.85) * 1.5;                                    // boulder
      if (!clearOf(wx, wz, r * 0.5)) continue;
      const y = gy(lx, lz);
      const lift = inWater && r > 0.2 ? 0.3 : 0.15;
      b.add(T.rock, mat(lx, y + r * lift, lz, r, r * sy, r * sz, ry, tilt, -tilt), col, frng, 0, 0, 0.07);
      if (r > 0.3 && mossy) b.add(T.blobLo, mat(lx, y + r * (lift + sy * 0.78), lz, r * 0.6, r * 0.15, r * 0.65, ry), pick(PAL.moss, frng), frng, 0, 0, 0.08);
      if (r > 0.45) colliders.push({ x: wx, z: wz, r: r * 0.85 });
    }
  }

  // Mud puddles: their own glossy mesh, draped over the ground
  const ppos = [], pcol = [], puddles = [];
  const nPud = frng() < 0.55 ? 1 + (frng() < 0.3 ? 1 : 0) : 0;
  for (let k = 0; k < nPud; k++) {
    const R = 0.7 + frng() * 0.9, mudR = R * 1.3 + 0.2;
    const lx = mudR + 0.5 + frng() * (CHUNK - 2 * mudR - 1), lz = mudR + 0.5 + frng() * (CHUNK - 2 * mudR - 1);
    const wx = ox + lx, wz = oz + lz;
    const ph1 = frng() * 6, ph2 = frng() * 6, ph3 = frng() * 6;
    if (nearBarn(wx, wz) || wet(wx, wz, mudR + 2) || !clearOf(wx, wz, mudR + 0.3)) continue;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2, h = gy(lx + Math.cos(a) * mudR, lz + Math.sin(a) * mudR);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    if (hi - lo > 0.35) continue; // too steep for standing water
    const shape = (a) => 1 + 0.17 * Math.sin(3 * a + ph1) + 0.09 * Math.sin(5 * a + ph2) + 0.05 * Math.sin(2 * a + ph3);
    puddles.push({ x: wx, z: wz, r: R * 0.85, mudR, shape });
    const SEG = 18;
    const pt = (a, rad, lift) => { const x = lx + Math.cos(a) * rad, z = lz + Math.sin(a) * rad; return [x, gy(x, z) + lift, z]; };
    const quad = (p00, p01, p10, p11, c0, c1) => {
      ppos.push(...p00, ...p10, ...p01, ...p01, ...p10, ...p11);
      for (const c of [c0, c1, c0, c0, c1, c1]) pcol.push(c.r, c.g, c.b);
    };
    // rings from the middle out: [radius factor, height above ground, colour]
    const rings = [
      [0.001, 0.05, PAL.puddleDeep], [0.5, 0.05, PAL.puddleDeep], [1.0, 0.045, PAL.puddle],
      [1.0, 0.03, PAL.mud], [(mudR - 0.12) / R, 0.025, PAL.mud], [mudR / R, 0.012, PAL.mudEdge],
    ];
    for (let s = 0; s < SEG; s++) {
      const a0 = (s / SEG) * Math.PI * 2, a1 = ((s + 1) / SEG) * Math.PI * 2, f0 = shape(a0), f1 = shape(a1);
      for (let q = 0; q < rings.length - 1; q++) {
        const [ra, la, ca] = rings[q], [rb, lb, cb] = rings[q + 1];
        quad(pt(a0, R * ra * f0, la), pt(a1, R * ra * f1, la), pt(a0, R * rb * f0, lb), pt(a1, R * rb * f1, lb), ca, cb);
      }
    }
  }
  let puddleGeo = null;
  if (ppos.length) {
    puddleGeo = new THREE.BufferGeometry();
    puddleGeo.setAttribute('position', new THREE.Float32BufferAttribute(ppos, 3));
    puddleGeo.setAttribute('color', new THREE.Float32BufferAttribute(pcol, 3));
    const nor = new Float32Array(ppos.length);
    for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
    puddleGeo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    puddleGeo.computeBoundingSphere();
  }

  // Fallen maple leaves: scattered under each tree, a few everywhere else
  const leaf = (lx, lz) => {
    if (lx < 0 || lz < 0 || lx > CHUNK || lz > CHUNK) return;
    const wx = ox + lx, wz = oz + lz;
    const a = frng() * Math.PI * 2, L = 0.26 + frng() * 0.16, W = 0.85 + frng() * 0.3;
    const ca = Math.cos(a), sa = Math.sin(a), lift = 0.022 + frng() * 0.01;
    const col = pick(PAL.leaf, frng), shade = 0.9 + frng() * 0.2;
    if (anyWater && wet(wx, wz, 0.4)) return;
    // u along the leaf (base 0 -> tip 1), v across it (scaled by W), up = curl
    const P = (u, v, up) => {
      const uu = u * L, vv = v * L * W;
      const x = lx + ca * uu - sa * vv, z = lz + sa * uu + ca * vv;
      return [x, gy(x, z) + lift + up, z];
    };
    _tmpC.copy(col).multiplyScalar(shade);
    const c = P(0.4, 0, 0.018), rim = MAPLE.map(([u, v, up]) => P(u, v, up));
    for (let i = 0; i < rim.length; i++) b.tri(c, rim[i], rim[(i + 1) % rim.length], _tmpC);
    b.tri(P(0, 0.025, 0.004), P(-0.3, 0, 0.002), P(0, -0.025, 0.004), _tmpC); // stem
  };
  for (const t of trees) {
    const n = 8 + Math.floor(frng() * 12);
    for (let i = 0; i < n; i++) {
      const a = frng() * Math.PI * 2, d = t.r + 0.2 + Math.pow(frng(), 0.7) * 3;
      leaf(t.x - ox + Math.cos(a) * d, t.z - oz + Math.sin(a) * d);
    }
  }
  for (let i = 0; i < 130; i++) {
    const lx = frng() * CHUNK, lz = frng() * CHUNK;
    if (frng() < forestDensity(ox + lx, oz + lz) + 0.15) leaf(lx, lz);
  }

  // Grass and flowers come last so they can keep out of the mud puddles (they use the main
  // random stream, which nothing after them draws from, so moving them changed nothing).
  const inPuddle = (wx, wz) => puddles.some((p) => {
    const dx = wx - p.x, dz = wz - p.z;
    return dx * dx + dz * dz < (p.mudR * p.shape(Math.atan2(dz, dx)) + 0.15) ** 2;
  });

  // Grass tufts
  for (let i = 0; i < 170; i++) {
    const lx = rng() * CHUNK, lz = rng() * CHUNK;
    const s = 0.7 + rng() * 0.7;
    if ((anyWater && wet(ox + lx, oz + lz, 0.3)) || inPuddle(ox + lx, oz + lz)) continue;
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
      if ((anyWater && wet(ox + lx, oz + lz, 0.5)) || inPuddle(ox + lx, oz + lz)) continue;
      const y = terrainHeight(ox + lx, oz + lz);
      const h = 0.25 + rng() * 0.15;
      b.add(T.grass, mat(lx, y - 0.02, lz, 0.4, h, 0.4, rng() * 6), PAL.tuft[0], rng, 0, 1, 0.05);
      b.add(T.flower, mat(lx + 0.06, y + h, lz, 0.07, 0.06, 0.07, rng() * 6), fc, rng, 1, 1, 0.08);
    }
  }

  return { geometry: b.build(), water, puddleGeo, puddles, colliders, truffles };
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
    this.puddleMaterial = new THREE.MeshPhongMaterial({
      vertexColors: true, specular: '#fff6e4', shininess: 60, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
  }

  // The mud puddle (x, z) is standing in, if any: { x, z, r }.
  puddleAt(x, z) {
    const c = this.chunks.get(Forest.key(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
    if (!c) return null;
    for (const p of c.puddles) if ((p.x - x) ** 2 + (p.z - z) ** 2 < p.r * p.r) return p;
    return null;
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
      const { geometry, water, puddleGeo, puddles, colliders, truffles } = buildChunk(cx, cz);
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
      let puddleMesh = null;
      if (puddleGeo) {
        puddleMesh = new THREE.Mesh(puddleGeo, this.puddleMaterial);
        puddleMesh.position.copy(mesh.position);
        puddleMesh.receiveShadow = true;
        puddleMesh.matrixAutoUpdate = false;
        puddleMesh.updateMatrix();
        this.scene.add(puddleMesh);
      }
      this.chunks.set(k, { cx, cz, mesh, waterMesh, puddleMesh, puddles, colliders, truffles });
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
        if (c.puddleMesh) {
          this.scene.remove(c.puddleMesh);
          c.puddleMesh.geometry.dispose();
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
