import * as THREE from 'three';

// A soft, rounded pink pig built from primitives. Faces -Z.
export function createPig() {
  const skin = new THREE.MeshLambertMaterial({ color: '#f6b8c6' });
  const skinDeep = new THREE.MeshLambertMaterial({ color: '#ee98ad' });
  const snoutMat = new THREE.MeshLambertMaterial({ color: '#f4a6b8' });
  const nostril = new THREE.MeshLambertMaterial({ color: '#b9637a' });
  const hoof = new THREE.MeshLambertMaterial({ color: '#b58a80' });

  const root = new THREE.Group();
  root.rotation.order = 'YXZ';

  // Body: an egg that extends back toward the camera.
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 28, 20), skin);
  body.scale.set(1.0, 0.82, 1.4);
  body.position.set(0, 0.52, 0.62);
  root.add(body);

  // Legs
  const legGeo = new THREE.CylinderGeometry(0.085, 0.075, 0.34, 10).translate(0, -0.17, 0);
  const hoofGeo = new THREE.CylinderGeometry(0.078, 0.08, 0.06, 10).translate(0, -0.34, 0);
  const legs = [];
  for (const [x, z, phase] of [[-0.26, 0.2, 0], [0.26, 0.2, Math.PI], [-0.26, 1.05, Math.PI], [0.26, 1.05, 0]]) {
    const leg = new THREE.Group();
    leg.position.set(x, 0.36, z);
    leg.add(new THREE.Mesh(legGeo, skin), new THREE.Mesh(hoofGeo, hoof));
    leg.userData.phase = phase;
    root.add(leg);
    legs.push(leg);
  }

  // Curly tail
  const tail = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.025, 8, 18, Math.PI * 1.7), skin);
  tail.position.set(0, 0.72, 1.36);
  tail.rotation.y = Math.PI / 2;
  root.add(tail);

  // Head pivots at the neck so it can lift its nose.
  const neck = new THREE.Group();
  neck.position.set(0, 0.74, 0.18);
  root.add(neck);

  const head = new THREE.Group();
  head.position.set(0, 0.08, -0.22);
  neck.add(head);

  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.42, 32, 24), skin);
  skull.scale.set(1.08, 0.88, 1.0);
  head.add(skull);

  const snout = new THREE.Group();
  snout.position.set(0, 0.0, -0.4);
  head.add(snout);
  const snoutCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.21, 0.2, 28).rotateX(Math.PI / 2), snoutMat);
  snout.add(snoutCyl);
  for (const x of [-0.07, 0.07]) {
    const n = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), nostril);
    n.scale.set(0.8, 1.2, 0.4);
    n.position.set(x, 0, -0.1);
    snout.add(n);
  }

  // Ears: flattened cones pointing up and out, with a deeper-pink inner.
  const earGeo = new THREE.ConeGeometry(0.19, 0.34, 16).translate(0, 0.17, 0);
  const innerGeo = new THREE.ConeGeometry(0.13, 0.24, 16).translate(0, 0.14, 0);
  const ears = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.28, 0.24, 0.02);
    const ear = new THREE.Mesh(earGeo, skin);
    ear.scale.set(1, 1, 0.32);
    const inner = new THREE.Mesh(innerGeo, skinDeep);
    inner.scale.set(1, 1, 0.2);
    inner.position.set(0, 0.03, -0.035);
    pivot.add(ear, inner);
    pivot.userData.side = side;
    head.add(pivot);
    ears.push(pivot);
  }

  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  let breath = 0;
  let twitchT = 0, twitchSide = 0;

  // speedNorm 0..1, gait phase, turn velocity, snort 0..1 (head lift), sniff 0..1 (nose wiggle),
  // excite 0..1 (truffle nearby), dig 0..1 with digPhase (pawing at the ground)
  function animate(dt, { speedNorm, gait, turn, snort, sniff, excite = 0, dig = 0, digPhase = 0 }) {
    breath += dt;
    const bob = Math.abs(Math.sin(gait)) * 0.035 * speedNorm;
    const breathe = Math.sin(breath * 2.2) * 0.008;

    body.scale.y = 0.82 + breathe;
    body.position.y = 0.52 + bob * 0.6;
    root.rotation.z = Math.sin(gait) * 0.025 * speedNorm - turn * 0.04;

    for (const leg of legs) leg.rotation.x = Math.sin(gait + leg.userData.phase) * 0.55 * speedNorm;
    // front trotters scrape the ground while digging
    legs[0].rotation.x += dig * (-0.5 + Math.sin(digPhase) * 0.7);
    legs[1].rotation.x += dig * (-0.5 + Math.sin(digPhase + Math.PI) * 0.7);
    // tail wiggles faster with excitement
    tail.rotation.z = Math.sin(breath * (3 + excite * 16) + gait) * (0.25 + excite * 0.3);

    // Head: bob with steps, lift on snort.
    neck.position.y = 0.74 + bob + breathe;
    neck.rotation.x = snort * 0.55 + Math.sin(gait * 2) * 0.02 * speedNorm
      + excite * 0.12 + Math.sin(breath * 9) * excite * 0.05      // nose up, sniffing the air
      - dig * 0.8 + Math.sin(digPhase * 2) * 0.1 * dig;            // head down into the dirt
    neck.rotation.y = -turn * 0.12 + Math.sin(breath * 2.3) * excite * 0.12 * (1 - dig);

    const wiggle = excite * 0.8 * (0.5 + 0.5 * Math.sin(breath * 24));
    const nose = Math.max(sniff, wiggle, dig * (0.5 + 0.5 * Math.sin(digPhase * 1.5)));
    snout.scale.setScalar(1 + nose * 0.12);
    snout.position.y = nose * 0.015;

    // Ears flop with the trot, perk up while sniffing, twitch sometimes.
    twitchT -= dt;
    if (twitchT < -3 - Math.random() * 4) { twitchT = 0.25; twitchSide = Math.random() < 0.5 ? -1 : 1; }
    for (const ear of ears) {
      const s = ear.userData.side;
      const flop = Math.sin(gait * 2 + s) * 0.12 * speedNorm;
      const twitch = twitchT > 0 && s === twitchSide ? Math.sin(twitchT * 40) * 0.15 : 0;
      ear.rotation.z = -s * (0.55 - snort * 0.25) + flop + turn * 0.08 + twitch;
      // negative = tips flop forward like a pig's; trotting pushes them back a little
      ear.rotation.x = -0.45 + speedNorm * 0.25 + snort * 0.3 + excite * 0.3 + Math.sin(breath * 11 + s) * excite * 0.08;
    }
  }

  return { root, head, snout, animate };
}
