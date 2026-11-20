import * as THREE from 'three';
import { terrainHeight } from './noise.js';
import { Particles } from './truffles.js';

// The witch's curse (the way she ends the game): green sparkles swirl round her wand tip while
// she casts and then stream at the pig; a quick flash of smoke hides the pig, and as the smoke
// thins there is a little green toad where the pig stood, facing the camera, which makes two
// hops. main.js hides the pig and shows the game-over screen.

const rand = (a, b) => a + Math.random() * (b - a);
const SPARK = [0.8, 1.0, 0.45];
const SMOKES = [[0.86, 0.82, 0.9], [0.74, 0.68, 0.82], [0.93, 0.9, 0.95], [0.66, 0.6, 0.72]];
const CROAK_AT = 0.4;          // first croak as the smoke clears
const HOP_AT = [0.95, 1.75];   // seconds after the curse when the toad hops
const HOP_LEN = 0.55;
const HOP_DIST = 0.6;
const HOP_HEIGHT = 0.8;

function createToad() {
  const skin = new THREE.MeshLambertMaterial({ color: '#7fbf5a', flatShading: true });
  const belly = new THREE.MeshLambertMaterial({ color: '#d9e8a6', flatShading: true });
  const spot = new THREE.MeshLambertMaterial({ color: '#5e9a45', flatShading: true });
  const eyeW = new THREE.MeshLambertMaterial({ color: '#f4f0d8' });
  const eyeB = new THREE.MeshBasicMaterial({ color: '#1e1a20' });
  const blush = new THREE.MeshLambertMaterial({ color: '#f2a7a7' });
  const ball = new THREE.IcosahedronGeometry(1, 2);
  const mk = (mat, p, s, r = [0, 0, 0]) => {
    const o = new THREE.Mesh(ball, mat);
    o.position.set(...p); o.scale.set(...s); o.rotation.set(...r);
    o.castShadow = true;
    return o;
  };
  // faces -Z like the pig
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const body = new THREE.Group();
  root.add(body);
  body.add(
    mk(skin, [0, 0.16, 0.02], [0.22, 0.15, 0.24]),          // squat body
    mk(belly, [0, 0.11, -0.06], [0.17, 0.09, 0.17]),        // pale belly and throat
    mk(skin, [0, 0.21, -0.13], [0.17, 0.11, 0.13]),         // head
    mk(spot, [0.09, 0.27, 0.06], [0.04, 0.02, 0.04]),       // warty spots
    mk(spot, [-0.07, 0.29, 0.12], [0.035, 0.02, 0.035]),
    mk(spot, [0.02, 0.3, -0.01], [0.03, 0.018, 0.03]),
  );
  for (const s of [-1, 1]) {
    body.add(
      mk(skin, [s * 0.09, 0.3, -0.16], [0.06, 0.06, 0.06]),     // bulging eyes on top
      mk(eyeW, [s * 0.1, 0.32, -0.19], [0.04, 0.04, 0.03]),
      mk(eyeB, [s * 0.1, 0.325, -0.215], [0.022, 0.026, 0.012]),
      mk(blush, [s * 0.12, 0.2, -0.21], [0.03, 0.018, 0.012]),  // pink cheeks (still a pig at heart)
      mk(skin, [s * 0.2, 0.1, 0.1], [0.08, 0.07, 0.13]),        // folded back legs
      mk(skin, [s * 0.24, 0.025, 0.04], [0.06, 0.025, 0.1]),    // back feet
      mk(skin, [s * 0.12, 0.06, -0.2], [0.035, 0.07, 0.035], [0.3, 0, 0]),   // front legs
      mk(skin, [s * 0.13, 0.015, -0.24], [0.05, 0.018, 0.05]),
    );
  }
  root.scale.setScalar(1.3);
  return { root, body };
}

export class Curse {
  constructor({ scene, audio }) {
    this.audio = audio;
    this.fx = new Particles(scene, 220);
    this.fx.points.renderOrder = 4;
    this.toad = createToad();
    scene.add(this.toad.root);
    this._tip = new THREE.Vector3();
    this.reset();
  }

  get active() { return this.t >= 0; }

  // While the witch casts (k 0..1): sparkles swirl round her wand tip, then stream at the pig.
  casting(witch, k, player, dt) {
    if (!this.spellPlayed) { this.audio.spell?.(); this.spellPlayed = true; }
    witch.m.tip.getWorldPosition(this._tip);
    const tip = this._tip;
    this.sparkT -= dt;
    if (this.sparkT > 0) return;
    this.sparkT = 0.02;
    this.fx.spawn({ x: tip.x, y: tip.y, z: tip.z, vx: rand(-0.6, 0.6), vy: rand(-0.2, 0.8), vz: rand(-0.6, 0.6), drag: 2, life: rand(0.45, 0.8), a: 1, s0: 0.3, s1: 0.05, c: SPARK, puff: true });
    if (k > 0.62) {
      const px = player.pos.x, py = player.pos.y + 0.7, pz = player.pos.z, tt = 0.22;
      for (let i = 0; i < 2; i++) {
        this.fx.spawn({ x: tip.x, y: tip.y, z: tip.z, vx: (px - tip.x) / tt + rand(-1, 1), vy: (py - tip.y) / tt + rand(-1, 1), vz: (pz - tip.z) / tt + rand(-1, 1), drag: 0, life: tt, a: 1, s0: 0.32, s1: 0.2, c: SPARK, puff: true });
      }
    }
  }

  // The curse hits: a smoke flash over the pig, and the toad underneath it.
  start(player) {
    this.t = 0;
    this.audio.poof?.();
    const { x, y, z } = player.pos;
    // a bright flash at the heart of it
    for (let i = 0; i < 6; i++) {
      this.fx.spawn({ x: x + rand(-0.3, 0.3), y: y + rand(0.4, 1), z: z + rand(-0.3, 0.3), vx: 0, vy: 0, vz: 0, life: rand(0.25, 0.4), a: 1, s0: 1.2, s1: 2.6, c: [1, 1, 0.92], puff: true });
    }
    // billowing smoke that drifts up and thins out
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2, r = rand(0.1, 0.7), sp = rand(0.8, 2.6);
      this.fx.spawn({
        x: x + Math.cos(a) * r, y: y + rand(0.1, 1.2), z: z + Math.sin(a) * r,
        vx: Math.cos(a) * sp, vy: rand(0.3, 1.4), vz: Math.sin(a) * sp, drag: 2.2,
        life: rand(1.2, 2.2), a: rand(0.75, 0.95), s0: rand(0.6, 1.0), s1: rand(1.6, 2.6), c: SMOKES[i % 4], puff: true,
      });
    }
    // green sparkles left glittering in it
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      this.fx.spawn({ x, y: y + rand(0.3, 1.2), z, vx: Math.cos(a) * rand(1, 3), vy: rand(0.5, 2), vz: Math.sin(a) * rand(1, 3), drag: 1.5, life: rand(0.8, 1.4), a: 1, s0: 0.25, s1: 0.05, c: SPARK, puff: true });
    }
    this.heading = player.heading + Math.PI;   // turned round to face the camera
    this.tx = x; this.tz = z;
    this.toad.root.visible = true;
    this.toad.root.rotation.y = this.heading;
    this.hops = 0;
  }

  update(dt) {
    this.fx.update(dt);
    if (this.t < 0) return;
    if (this.t < CROAK_AT && this.t + dt >= CROAK_AT) this.audio.croak?.(0);
    this.t += dt;
    const T = this.toad;
    // two hops, turning a little each time
    let lift = 0, squash = 1;
    for (let i = 0; i < HOP_AT.length; i++) {
      const u = (this.t - HOP_AT[i]) / HOP_LEN;
      if (u < -0.4 || u > 1.3) continue;
      if (u < 0) { squash = 1 - 0.25 * (u + 0.4) / 0.4; continue; }   // crouch before the hop
      if (this.hops === i) {
        this.hops++;
        this.audio.croak?.(i + 1);
        this.hopFrom = [this.tx, this.tz];
        this.heading += i === 0 ? 1.25 : -2.1;   // off to one side, then back the other way
      }
      if (u <= 1) {
        const d = HOP_DIST * u;
        this.tx = this.hopFrom[0] - Math.sin(this.heading) * d;
        this.tz = this.hopFrom[1] - Math.cos(this.heading) * d;
        lift = Math.sin(Math.PI * u) * HOP_HEIGHT;
        squash = 1.15;
      } else squash = 1 - 0.2 * Math.sin(Math.PI * (u - 1) / 0.3);   // landing squish
    }
    T.root.position.set(this.tx, terrainHeight(this.tx, this.tz) + lift, this.tz);
    T.root.rotation.y += (this.heading - T.root.rotation.y) * (1 - Math.exp(-14 * dt));
    T.body.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
  }

  reset() {
    this.t = -1;
    this.sparkT = 0;
    this.spellPlayed = false;
    this.toad.root.visible = false;
    for (const p of this.fx.p) p.alive = false;
  }
}
