import * as THREE from 'three';
import { terrainHeight, smoothstep } from './noise.js';

// ---------- tuning ----------
const SCENT_RANGE = 75;   // the pig catches the scent (drifting clouds, rare squeals) this far out
const WISP_RANGE = 18;    // mist rising from the ground is only seen this close
const NEAR = 7;           // within this, mist rises strongly and steadily from the spot
const DIG_DIST = 0.95;    // pig centre this close to the spot starts digging
const DIG_TIME = 2.6;     // seconds of digging before the truffle pops out

const rand = (a, b) => a + Math.random() * (b - a);

const MIST = [1.0, 0.86, 0.3];   // warm yellow (sRGB)
const DIRT = [0.55, 0.42, 0.34];

// ---------- particles ----------
// One Points object for all mist puffs and dirt clods; soft round sprites sized in metres.
class Particles {
  constructor(scene, max = 260) {
    this.max = max;
    this.p = Array.from({ length: max }, () => ({ alive: false }));
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    const attr = (name, arr, n) => {
      const a = new THREE.BufferAttribute(arr, n);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
    };
    attr('position', this.pos, 3);
    attr('aSize', this.size, 1);
    attr('aAlpha', this.alpha, 1);
    attr('aColor', this.col, 3);
    this.geo = geo;
    this.uniforms = { uScale: { value: 800 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
        uniform float uScale;
        varying float vAlpha; varying vec3 vColor;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(0.1, -mv.z);
          vAlpha = aAlpha; vColor = aColor;
        }`,
      fragmentShader: `
        varying float vAlpha; varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.0, d);
          a = a * (0.55 + 0.45 * a);
          gl_FragColor = vec4(vColor, a * vAlpha);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
  }

  spawn(o) {
    const p = this.p[this.next];
    this.next = (this.next + 1) % this.max;
    Object.assign(p, { alive: true, age: 0, grav: 0, drag: 0.4, dirt: false, cloud: false, smelled: false }, o);
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (p.alive) {
        p.age += dt;
        if (p.age >= p.life) p.alive = false;
      }
      if (!p.alive) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      p.vy += p.grav * dt;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.dirt) {
        const g = terrainHeight(p.x, p.z) + 0.03;
        if (p.y < g) { p.y = g; p.vx *= 0.3; p.vz *= 0.3; p.vy = 0; }
      }
      const t = p.age / p.life;
      this.alpha[i] = p.dirt ? p.a * (1 - t * t * t) : p.a * Math.sin(Math.PI * t);
      this.size[i] = p.s0 + (p.s1 - p.s0) * t;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      const c = p.dirt ? DIRT : MIST;
      this.col[i * 3] = c[0]; this.col[i * 3 + 1] = c[1]; this.col[i * 3 + 2] = c[2];
    }
    for (const n of ['position', 'aSize', 'aAlpha', 'aColor']) this.geo.attributes[n].needsUpdate = true;
  }
}

// ---------- the hunt ----------
export class TruffleHunt {
  constructor({ scene, forest, audio, onFound, onSqueal }) {
    this.forest = forest;
    this.audio = audio;
    this.onFound = onFound;
    this.onSqueal = onSqueal;
    this.fx = new Particles(scene);

    this.excite = 0;         // 0..1, smoothed
    this.target = null;      // truffle being dug
    this.digT = -1;
    this.digPhase = 0;
    this.squealT = 1.5;
    this.oinkCooldown = 0;
    this.smell = 0;          // 0..1 pulse when the pig catches a whiff (drives a nose twitch)
    this.hadScent = false;
    this.cloudT = 0.5;
    this.strokeT = 0;

    // The truffle that pops out of the ground
    const g = new THREE.IcosahedronGeometry(0.17, 2);
    const pos = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = 1 + 0.18 * Math.sin(v.x * 40) * Math.sin(v.y * 37) * Math.sin(v.z * 43);
      v.multiplyScalar(n);
      pos.setXYZ(i, v.x, v.y * 0.9, v.z);
    }
    g.computeVertexNormals();
    this.prize = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: '#5a4038', flatShading: true }));
    this.prize.visible = false;
    this.prize.castShadow = true;
    scene.add(this.prize);
    this.prizeT = -1;

    // Little dug-up dirt patches left behind
    this.holes = [];
    const holeGeo = new THREE.CircleGeometry(0.42, 18).rotateX(-Math.PI / 2);
    const holeMat = new THREE.MeshLambertMaterial({ color: '#a8846c', polygonOffset: true, polygonOffsetFactor: -2 });
    for (let i = 0; i < 16; i++) {
      const h = new THREE.Mesh(holeGeo, holeMat);
      h.visible = false;
      h.receiveShadow = true;
      scene.add(h);
      this.holes.push(h);
    }
    this.nextHole = 0;
  }

  get digging() { return this.digT >= 0; }
  get digAmount() { return this.digging ? Math.min(1, this.digT / 0.25, (DIG_TIME + 0.2 - this.digT) / 0.3) : 0; }

  setPixelScale(v) { this.fx.uniforms.uScale.value = v; }

  update(dt, player) {
    const px = player.pos.x, pz = player.pos.z;
    let nearest = null, nd = Infinity;
    for (const t of this.forest.nearbyTruffles(px, pz, SCENT_RANGE)) {
      const d = Math.hypot(t.x - px, t.z - pz);
      if (d > SCENT_RANGE) continue;
      if (d < nd) { nd = d; nearest = t; }
      if (d < WISP_RANGE) this.emitWisps(t, d, dt);
    }

    // Excitement builds slowly from the edge of the scent and climbs steeply near the truffle.
    const closeness = nearest ? Math.min(1, Math.max(0, 1 - (nd - 1) / (SCENT_RANGE - 1))) : 0;
    const rawExcite = Math.pow(closeness, 1.6);
    this.excite += (rawExcite - this.excite) * (1 - Math.exp(-3 * dt));

    if (this.digging) this.updateDig(dt, player);
    else if (nearest) {
      if (nd < SCENT_RANGE && nd > 2.5) this.emitClouds(nearest, nd, player, dt);
      if (nd < DIG_DIST) this.startDig(nearest);
    }

    // Catching the scent: an oink when the pig first smells a truffle, and whenever
    // one of the drifting yellow clouds reaches its nose.
    this.oinkCooldown -= dt;
    this.smell = Math.max(0, this.smell - dt * 2.5);
    const hasScent = !!nearest && !this.digging;
    if (hasScent && !this.hadScent) this.whiff();
    this.hadScent = hasScent;
    if (hasScent) {
      const nx = px - Math.sin(player.heading) * 0.6, nz = pz - Math.cos(player.heading) * 0.6; // snout
      for (const p of this.fx.p) {
        if (!p.alive || !p.cloud || p.smelled) continue;
        if (Math.hypot(p.x - nx, p.z - nz) < 1.7) { p.smelled = true; this.whiff(); }
      }
    }

    // Close to the truffle the oinks turn into squeals: more often and louder the closer it is.
    if (this.excite > 0.6 && !this.digging) {
      this.squealT -= dt;
      if (this.squealT <= 0) {
        const len = this.audio.squeal(this.excite) || 0;
        if (this.excite > 0.55) this.onSqueal?.(this.excite);
        // never talk over itself: wait for the call to finish before the next one
        this.squealT = Math.max(len + rand(0.1, 0.25), (7 - 6.5 * Math.pow(this.excite, 1.2)) * rand(0.8, 1.2));
      }
    } else if (!this.digging) this.squealT = Math.max(this.squealT, 1);

    this.updatePrize(dt);
    this.fx.update(dt);
  }

  whiff() {
    if (this.oinkCooldown > 0) return;
    // up close the squeals take over, so only oink while still following the trail
    if (this.excite <= 0.6) this.audio.oink(this.excite);
    this.oinkCooldown = rand(1.1, 1.6);
    this.smell = 1;
  }

  // Mist rising from the ground: faint from afar, strong and steady up close.
  emitWisps(t, d, dt) {
    const near = 1 - smoothstep(2, NEAR, d);
    const rate = 0.6 + near * 10;
    let n = rate * dt;
    while (n > 0) {
      if (Math.random() < Math.min(1, n)) {
        const y = terrainHeight(t.x, t.z);
        this.fx.spawn({
          x: t.x + rand(-0.25, 0.25), y: y + 0.05, z: t.z + rand(-0.25, 0.25),
          vx: rand(-0.12, 0.12), vy: rand(0.25, 0.5) + near * 0.2, vz: rand(-0.12, 0.12),
          life: rand(2.2, 3.6), a: 0.2 + near * 0.45, s0: 0.35, s1: 1.1 + near * 0.6,
        });
      }
      n -= 1;
    }
  }

  // Scent clouds that drift toward the pig from the truffle's direction, then fade.
  emitClouds(t, d, player, dt) {
    this.cloudT -= dt * (0.4 + this.excite * 1.8);
    if (this.cloudT > 0) return;
    this.cloudT = rand(0.8, 1.2);
    const ux = (t.x - player.pos.x) / d, uz = (t.z - player.pos.z) / d;
    const along = Math.min(d - 0.5, rand(3.5, 7));
    const side = rand(-1.2, 1.2);
    const sx = player.pos.x + ux * along - uz * side, sz = player.pos.z + uz * along + ux * side;
    const sp = rand(1.1, 1.7);
    this.fx.spawn({
      cloud: true,
      x: sx, y: terrainHeight(sx, sz) + rand(0.5, 1.1), z: sz,
      vx: -ux * sp, vy: rand(-0.05, 0.08), vz: -uz * sp, drag: 0.15,
      // lives just long enough to reach the pig, fading out as it arrives
      life: (along / sp) * 1.15 + rand(0.3, 0.7), a: 0.2 + this.excite * 0.4, s0: 1.2, s1: 2.6,
    });
  }

  startDig(t) {
    this.target = t;
    this.digT = 0;
    this.strokeT = 0;
    const h = this.holes[this.nextHole];
    this.nextHole = (this.nextHole + 1) % this.holes.length;
    h.position.set(t.x, terrainHeight(t.x, t.z) + 0.02, t.z);
    h.scale.setScalar(0.01);
    h.visible = true;
    this.hole = h;
  }

  updateDig(dt, player) {
    const t = this.target;
    this.digT += dt;
    this.digPhase += dt * 16;
    this.hole.scale.setScalar(Math.min(1, 0.2 + this.digT / DIG_TIME));

    // Each paw stroke: a scratch and a spray of dirt flung back past the pig.
    this.strokeT -= dt;
    if (this.strokeT <= 0 && this.digT < DIG_TIME - 0.2) {
      this.strokeT = 0.17;
      this.audio.dig();
      const bx = Math.sin(player.heading), bz = Math.cos(player.heading); // backward
      const y = terrainHeight(t.x, t.z);
      for (let i = 0; i < 4; i++) {
        const sp = rand(0.8, 2.2), side = rand(-2.4, 2.4);
        this.fx.spawn({
          dirt: true, x: t.x + rand(-0.15, 0.15), y: y + 0.08, z: t.z + rand(-0.15, 0.15),
          vx: bx * sp + bz * side, vy: rand(2.6, 4.2), vz: bz * sp - bx * side,
          grav: -9, drag: 0.6, life: rand(0.8, 1.1), a: 0.95, s0: rand(0.12, 0.2), s1: 0.1,
        });
      }
      if (Math.random() < 0.5) this.emitWisps(t, 0, 0.3);
    }

    if (this.digT >= DIG_TIME) {
      this.forest.collect(t.id);
      this.audio.found();
      this.onFound?.();
      // happy burst of mist and the truffle popping up
      const y = terrainHeight(t.x, t.z);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        this.fx.spawn({ x: t.x, y: y + 0.3, z: t.z, vx: Math.cos(a) * 1.6, vy: rand(0.4, 1), vz: Math.sin(a) * 1.6, drag: 1.5, life: 1.2, a: 0.22, s0: 0.3, s1: 0.9 });
      }
      this.prize.position.set(t.x, y, t.z);
      this.prize.userData.y = y;
      this.prize.visible = true;
      this.prizeT = 0;
      this.target = null;
      this.digT = -1;
      this.excite = 0;
      this.squealT = 2.5;
    }
  }

  updatePrize(dt) {
    if (this.prizeT < 0) return;
    this.prizeT += dt;
    const t = this.prizeT, p = this.prize;
    const rise = Math.min(1, t / 0.5);
    // pops up high enough to be seen over the pig's head
    p.position.y = p.userData.y - 0.1 + (1 - (1 - rise) ** 3) * 1.55 + Math.sin(t * 5) * 0.04;
    p.rotation.y = t * 3;
    p.scale.setScalar(t < 1.4 ? 1 + Math.sin(Math.min(1, t / 0.5) * Math.PI) * 0.25 : Math.max(0, 1 - (t - 1.4) / 0.3));
    if (t > 1.7) { p.visible = false; this.prizeT = -1; }
  }
}
