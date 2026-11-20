import * as THREE from 'three';
import { terrainHeight } from './noise.js';

// A hole the pig digs, with real-looking depth, plus the loose earth it throws out.
//
// The ground can't be cut, so the pit is drawn "through" it with the stencil buffer:
//  1. `punch`: an invisible disc on the ground over the opening marks stencil = 1 wherever it
//     is seen (it is depth-tested, so the pig or a tree in front still hides it).
//  2. `pit`: the inside of a bowl sunk below the ground, drawn ignoring depth but only where
//     stencil = 1, so it shows through the opening as a dark pit.
// Both draw in the transparent pass (after all opaque things), punch before pit.
// Around it a raised rim of loose earth, and clods that appear where flung dirt lands.

const SEG = 22;
const MAX_CLODS = 48;
const RIM = [ // [radius × opening radius, height in metres at full size]
  [0.97, -0.01], [1.06, 0.045], [1.2, 0.075], [1.42, 0.055], [1.7, 0.02], [1.95, -0.01],
];
const PIT = [ // bowl profile: [radius, depth] as fractions of opening radius / pit depth
  [1, 0.05], [0.97, -0.3], [0.86, -0.62], [0.66, -0.86], [0.36, -0.98], [0, -1],
];

const DIRT_LIGHT = new THREE.Color('#8c6a54');
const DIRT_DARK = new THREE.Color('#5e4436');
const PIT_TOP = new THREE.Color('#5a4032');
const PIT_BOTTOM = new THREE.Color('#24170f');

const punchMat = new THREE.MeshBasicMaterial({
  colorWrite: false, depthWrite: false, transparent: true,
  polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  stencilWrite: true, stencilRef: 1,
  stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
});
const pitMat = new THREE.MeshLambertMaterial({
  vertexColors: true, transparent: true, // the lathe faces point inward: only the far wall and floor draw
  depthFunc: THREE.AlwaysDepth, depthWrite: false,
  stencilWrite: true, stencilRef: 1,
  stencilFunc: THREE.EqualStencilFunc, stencilZPass: THREE.KeepStencilOp,
});
const rimMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
const clodMat = new THREE.MeshLambertMaterial({ flatShading: true });

// The pit bowl: a lathe of the profile, coloured darker toward the bottom.
const pitGeo = (() => {
  const g = new THREE.LatheGeometry(PIT.map(([r, y]) => new THREE.Vector2(r, y)), SEG);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(PIT_TOP).lerp(PIT_BOTTOM, Math.min(1, -pos.getY(i) * 1.1));
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
})();

// Lumpy clod shape, shared by all clods.
const clodGeo = (() => {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) * 0.6);
  g.computeVertexNormals();
  return g;
})();

// A ring mesh (rings × SEG) whose vertex heights follow the terrain; positions filled by `fit`.
function ringGeo(rings) {
  const g = new THREE.BufferGeometry();
  const n = rings * (SEG + 1);
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const idx = [];
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = i * (SEG + 1) + j, b = a + 1, c = a + SEG + 1, d = c + 1;
      idx.push(a, b, c, b, d, c); // faces up
    }
  }
  g.setIndex(idx);
  return g;
}

export class DigSite {
  constructor(scene) {
    this.punch = new THREE.Mesh(ringGeo(3), punchMat);
    this.punch.renderOrder = 1;
    this.pit = new THREE.Mesh(pitGeo, pitMat);
    this.pit.renderOrder = 2;
    this.pit.receiveShadow = true;
    this.rimGeo = ringGeo(RIM.length);
    const rc = new Float32Array(RIM.length * (SEG + 1) * 3);
    this.rimGeo.setAttribute('color', new THREE.BufferAttribute(rc, 3));
    this.rim = new THREE.Mesh(this.rimGeo, rimMat);
    this.rim.receiveShadow = true;
    this.clods = new THREE.InstancedMesh(clodGeo, clodMat, MAX_CLODS);
    this.clods.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.clods.castShadow = true;
    this.clods.receiveShadow = true;
    this.clods.frustumCulled = false;
    this.clods.setColorAt(0, DIRT_LIGHT); // creates instanceColor
    this.clodData = [];
    for (const m of [this.punch, this.pit, this.rim, this.clods]) { m.visible = false; scene.add(m); }
    this.wob = new Float32Array(SEG + 1); // irregular outline, per site
  }

  // Start a new hole at (x, z): tiny at first, it grows with `setProgress`.
  start(x, z) {
    this.x = x; this.z = z;
    this.y = terrainHeight(x, z);
    for (let j = 0; j < SEG; j++) this.wob[j] = 1 + (Math.random() - 0.5) * 0.22;
    this.wob[SEG] = this.wob[0];
    // rim colours: darker loose earth on the lip, lighter where it thins out, a little speckle
    const col = this.rimGeo.attributes.color, c = new THREE.Color();
    for (let i = 0; i < RIM.length; i++) {
      for (let j = 0; j <= SEG; j++) {
        const k = i * (SEG + 1) + j;
        c.copy(DIRT_DARK).lerp(DIRT_LIGHT, i / (RIM.length - 1) * 0.8 + Math.random() * 0.2);
        col.setXYZ(k, c.r, c.g, c.b);
      }
    }
    col.needsUpdate = true;
    this.clodData.length = 0;
    this.clods.count = 0;
    this.setProgress(0);
    for (const m of [this.punch, this.pit, this.rim, this.clods]) m.visible = true;
  }

  hide() { for (const m of [this.punch, this.pit, this.rim, this.clods]) m.visible = false; }

  // k 0..1: how far the dig has got (the opening widens, the pit deepens, the rim builds up).
  setProgress(k) {
    const R = 0.12 + 0.22 * Math.min(1, k * 1.3);
    const depth = 0.04 + 0.26 * k;
    const lip = 0.25 + 0.75 * k;
    this.R = R;
    const fit = (geo, rings, rf, hf) => {
      const pos = geo.attributes.position;
      for (let i = 0; i < rings; i++) {
        for (let j = 0; j <= SEG; j++) {
          const a = (j / SEG) * Math.PI * 2, r = rf(i) * R * this.wob[j];
          const wx = this.x + Math.cos(a) * r, wz = this.z + Math.sin(a) * r;
          pos.setXYZ(i * (SEG + 1) + j, wx - this.x, terrainHeight(wx, wz) - this.y + hf(i), wz - this.z);
        }
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
    };
    fit(this.punch.geometry, 3, (i) => i / 2 * 0.99, () => 0.012);
    fit(this.rimGeo, RIM.length, (i) => RIM[i][0], (i) => RIM[i][1] * lip);
    for (const m of [this.punch, this.rim]) m.position.set(this.x, this.y, this.z);
    this.pit.position.set(this.x, this.y + 0.005, this.z);
    this.pit.scale.set(R * 1.12, depth, R * 1.12); // wider than the wobbly opening, so no gap shows
  }

  // A clod of earth lands at (x, z) and stays there.
  addClod(x, z, size) {
    if (this.clodData.length >= MAX_CLODS) return;
    // nothing lands inside the opening
    if (Math.hypot(x - this.x, z - this.z) < this.R * 1.1) return;
    const i = this.clodData.length;
    this.clodData.push({ x, z, y: terrainHeight(x, z), s: size, rot: Math.random() * Math.PI * 2, t: 0 });
    this.clods.setColorAt(i, new THREE.Color().copy(DIRT_DARK).lerp(DIRT_LIGHT, Math.random()));
    this.clods.instanceColor.needsUpdate = true;
    this.clods.count = i + 1;
  }

  // Clods pop in with a little squash as they land.
  update(dt) {
    if (!this.clods.visible) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let changed = false;
    this.clodData.forEach((c, i) => {
      if (c.t >= 1) return;
      c.t = Math.min(1, c.t + dt / 0.18);
      const pop = c.t < 1 ? 1 + Math.sin(c.t * Math.PI) * 0.35 : 1;
      q.setFromAxisAngle(up, c.rot);
      s.set(c.s * pop, c.s * (2 - pop) * c.t, c.s * pop);
      p.set(c.x, c.y + c.s * 0.25, c.z);
      this.clods.setMatrixAt(i, m.compose(p, q, s));
      changed = true;
    });
    if (changed) this.clods.instanceMatrix.needsUpdate = true;
  }
}
