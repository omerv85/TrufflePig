import * as THREE from 'three';

// Low-poly forest animals built from primitives: the wolf and bear (dangerous), and the deer,
// goat, squirrel and moose (docile). Each faces +Z with its feet at y = 0 and returns the parts
// the animation in animals.js moves: body (crouches, pitches), neck > head (> jaw), ears,
// legs (pivots at hip height `hip`), tail and hackles. Missing parts are empty groups.

const matCache = new Map();
function lam(color) {
  if (!matCache.has(color)) matCache.set(color, new THREE.MeshLambertMaterial({ color, flatShading: true }));
  return matCache.get(color);
}
// unlit eyes, still fogged so they don't give an animal away in the haze
const wolfEye = new THREE.MeshBasicMaterial({ color: '#ffd84a' });

const BALL = new THREE.IcosahedronGeometry(1, 1);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CONE = new THREE.ConeGeometry(1, 1, 4);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 6);

const BLACK = '#2a2630', MOUTH = '#7d2f3d', TOOTH = '#fbf6ea';

// Mesh at position p, scale s (number or [x, y, z]), rotation r.
function m(geo, mat, p, s = 1, r = [0, 0, 0]) {
  const o = new THREE.Mesh(geo, typeof mat === 'string' ? lam(mat) : mat);
  o.position.set(...p);
  if (typeof s === 'number') o.scale.setScalar(s); else o.scale.set(...s);
  o.rotation.set(...r);
  return o;
}
function grp(parent, p = [0, 0, 0], r = [0, 0, 0]) {
  const g = new THREE.Group();
  g.position.set(...p);
  g.rotation.set(...r);
  parent.add(g);
  return g;
}

function base() {
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  const body = grp(root);
  return { root, body, jaw: null, ears: [], hackles: grp(body), tail: null };
}

// Legs hang from pivots at hip height. spots: [x, z, front].
function addLegs(P, { hip, spots, r0, r1, mat, foot, footMat }) {
  const legGeo = new THREE.CylinderGeometry(r0, r1, hip, 6).translate(0, -hip / 2, 0);
  const footGeo = foot === 'hoof'
    ? new THREE.CylinderGeometry(r1 * 1.05, r1 * 1.3, hip * 0.09, 6).translate(0, -hip * 0.955, 0)
    : new THREE.SphereGeometry(r1 * 1.3, 6, 4).scale(1, 0.6, 1.4).translate(0, -hip, r1 * 0.5);
  P.legs = spots.map(([x, z, front]) => {
    const leg = grp(P.root, [x, hip, z]);
    leg.add(new THREE.Mesh(legGeo, lam(mat)), new THREE.Mesh(footGeo, lam(footMat)));
    leg.userData = { front, side: Math.sign(x) };
    return leg;
  });
  P.hip = hip;
}

// Snarling mouth: red lining and fangs on the upper jaw, a lower jaw that drops open.
function addJaw(head, { y, z, w, len, mat }) {
  head.add(m(BOX, MOUTH, [0, y, z + len * 0.45], [w * 0.75, 0.02, len * 0.8]));
  for (const s of [-1, 1]) head.add(m(CONE, TOOTH, [s * w * 0.3, y - 0.015, z + len * 0.85], [0.016, 0.06, 0.016], [Math.PI, 0, 0]));
  const jaw = grp(head, [0, y, z]);
  jaw.add(m(BOX, mat, [0, -0.025, len * 0.5], [w * 0.75, 0.045, len * 0.9]));
  for (const s of [-1, 1]) jaw.add(m(CONE, TOOTH, [s * w * 0.27, 0.01, len * 0.82], [0.013, 0.045, 0.013]));
  return jaw;
}

// ---------- dangerous ----------
function wolf() {
  const fur = '#77727f', dark = '#58535f', light = '#c3bcc4';
  const P = base();
  P.body.add(
    m(BALL, fur, [0, 0.84, 0], [0.27, 0.29, 0.62]),          // torso
    m(BALL, dark, [0, 0.98, -0.05], [0.2, 0.14, 0.55]),      // dark saddle along the back
    m(BALL, fur, [0, 0.9, 0.42], [0.37, 0.42, 0.36]),        // deep, broad chest
    m(BALL, light, [0, 0.8, 0.6], [0.29, 0.34, 0.22]),       // pale ruff
    m(BALL, fur, [0, 1.08, 0.5], [0.3, 0.2, 0.26]),          // thick mane over the shoulders
    m(BALL, fur, [0, 0.84, -0.46], [0.25, 0.27, 0.26]),      // haunches
  );
  // hackles: a ridge of fur spikes that bristles up when it snarls
  P.hackles.position.set(0, 1.04, 0.1);
  for (let i = 0; i < 6; i++) P.hackles.add(m(CONE, dark, [0, 0, 0.3 - i * 0.13], [0.05, 0.16, 0.05], [-0.5, 0, 0]));

  P.neck = grp(P.body, [0, 1.0, 0.6]);
  const head = P.head = grp(P.neck, [0, 0.1, 0.12]);
  head.scale.setScalar(1.2);
  head.add(
    m(BALL, fur, [0, 0.04, 0], [0.2, 0.18, 0.22]),                    // skull
    m(BALL, light, [0.14, -0.05, -0.02], [0.1, 0.13, 0.13]),          // big cheek ruffs
    m(BALL, light, [-0.14, -0.05, -0.02], [0.1, 0.13, 0.13]),
    m(BOX, fur, [0, 0, 0.25], [0.15, 0.12, 0.26]),                    // muzzle
    m(BOX, light, [0, -0.04, 0.27], [0.13, 0.06, 0.24]),
    m(BALL, BLACK, [0, 0.04, 0.39], [0.05, 0.04, 0.035]),            // nose
    m(BALL, wolfEye, [0.085, 0.09, 0.15], 0.032),
    m(BALL, wolfEye, [-0.085, 0.09, 0.15], 0.032),
    m(BOX, dark, [0.08, 0.13, 0.15], [0.08, 0.025, 0.05], [0, 0, -0.35]),   // stern brows
    m(BOX, dark, [-0.08, 0.13, 0.15], [0.08, 0.025, 0.05], [0, 0, 0.35]),
  );
  // shaggy pointed tufts flaring out and down from the cheeks
  for (const s of [-1, 1]) {
    for (const [y, z, tilt] of [[-0.02, -0.04, 0.35], [-0.11, -0.01, 0.75]]) {
      head.add(m(CONE, light, [s * 0.22, y, z], [0.07, 0.27, 0.07], [0, 0, -s * (Math.PI / 2 + tilt)]));
    }
    const ear = grp(head, [s * 0.1, 0.17, -0.03], [0, 0, -s * 0.2]);
    ear.add(m(CONE, dark, [0, 0.09, 0], [0.065, 0.2, 0.065]));
    P.ears.push(ear);
  }
  P.jaw = addJaw(head, { y: -0.07, z: 0.12, w: 0.14, len: 0.24, mat: light });

  P.tail = grp(P.body, [0, 0.95, -0.66]);
  P.tail.add(m(BALL, fur, [0, 0, -0.3], [0.1, 0.1, 0.36]), m(BALL, dark, [0, 0, -0.62], [0.07, 0.07, 0.12]));
  addLegs(P, { hip: 0.74, spots: [[-0.15, 0.45, 1], [0.15, 0.45, 1], [-0.15, -0.45, 0], [0.15, -0.45, 0]], r0: 0.075, r1: 0.055, mat: fur, foot: 'paw', footMat: dark });
  return P;
}

function bear() {
  const fur = '#7b5a46', dark = '#5c4335', light = '#c9a687';
  const P = base();
  P.body.add(
    m(BALL, fur, [0, 0.95, 0], [0.46, 0.44, 0.78]),          // barrel body
    m(BALL, dark, [0, 1.24, 0.3], [0.36, 0.26, 0.36]),       // shoulder hump
    m(BALL, fur, [0, 0.98, 0.48], [0.44, 0.46, 0.38]),       // massive chest
    m(BALL, fur, [0, 0.98, -0.5], [0.43, 0.42, 0.4]),        // rump
  );
  P.hackles.position.set(0, 1.42, 0.25);
  for (let i = 0; i < 4; i++) P.hackles.add(m(CONE, dark, [0, 0, 0.2 - i * 0.14], [0.07, 0.14, 0.07], [-0.5, 0, 0]));

  P.neck = grp(P.body, [0, 1.06, 0.72]);
  const head = P.head = grp(P.neck, [0, 0.04, 0.14]);
  head.add(
    m(BALL, fur, [0, 0.04, 0], [0.27, 0.25, 0.26]),                    // broad skull
    m(BALL, fur, [0.17, -0.04, -0.03], [0.13, 0.15, 0.14]),           // heavy cheeks
    m(BALL, fur, [-0.17, -0.04, -0.03], [0.13, 0.15, 0.14]),
    m(BALL, light, [0, -0.03, 0.23], [0.14, 0.12, 0.17]),             // muzzle
    m(BALL, BLACK, [0, 0.03, 0.38], [0.065, 0.045, 0.04]),            // nose
    m(BALL, '#1c1719', [0.1, 0.11, 0.19], 0.03),                      // small dark eyes
    m(BALL, '#1c1719', [-0.1, 0.11, 0.19], 0.03),
    m(BOX, dark, [0.1, 0.15, 0.19], [0.1, 0.03, 0.05], [0, 0, -0.3]),   // heavy brows
    m(BOX, dark, [-0.1, 0.15, 0.19], [0.1, 0.03, 0.05], [0, 0, 0.3]),
  );
  for (const s of [-1, 1]) {
    const ear = grp(head, [s * 0.17, 0.21, -0.05], [0, 0, -s * 0.3]);
    ear.add(m(BALL, dark, [0, 0.03, 0], [0.08, 0.08, 0.04]), m(BALL, light, [0, 0.03, 0.02], [0.045, 0.045, 0.02]));
    P.ears.push(ear);
  }
  P.jaw = addJaw(head, { y: -0.09, z: 0.12, w: 0.17, len: 0.22, mat: light });

  P.tail = grp(P.body, [0, 1.05, -0.86]);
  P.tail.add(m(BALL, dark, [0, 0, -0.03], [0.08, 0.08, 0.07]));
  addLegs(P, { hip: 0.6, spots: [[-0.25, 0.45, 1], [0.25, 0.45, 1], [-0.25, -0.5, 0], [0.25, -0.5, 0]], r0: 0.14, r1: 0.12, mat: dark, foot: 'paw', footMat: dark });
  return P;
}

// ---------- docile ----------
function deer() {
  const fur = '#b98a5e', light = '#f3e6d2', dark = '#5e4434', antler = '#eadbc0';
  const P = base();
  P.body.add(
    m(BALL, fur, [0, 1.05, 0], [0.21, 0.25, 0.52]),
    m(BALL, light, [0, 0.93, 0.02], [0.16, 0.13, 0.4]),      // pale belly
    m(BALL, fur, [0, 1.08, 0.36], [0.2, 0.24, 0.2]),         // chest
  );
  P.neck = grp(P.body, [0, 1.15, 0.42]);
  P.neck.add(m(BALL, fur, [0, 0.2, 0.08], [0.09, 0.26, 0.1], [0.35, 0, 0]), m(BALL, light, [0, 0.12, 0.13], [0.06, 0.14, 0.05], [0.35, 0, 0]));
  const head = P.head = grp(P.neck, [0, 0.44, 0.16]);
  head.add(
    m(BALL, fur, [0, 0, 0], [0.1, 0.1, 0.13]),
    m(BALL, fur, [0, -0.04, 0.13], [0.065, 0.065, 0.11]),
    m(BALL, light, [0, -0.07, 0.15], [0.05, 0.03, 0.08]),
    m(BALL, BLACK, [0, -0.03, 0.24], 0.03),
    m(BALL, BLACK, [0.075, 0.03, 0.06], 0.022),
    m(BALL, BLACK, [-0.075, 0.03, 0.06], 0.022),
  );
  for (const s of [-1, 1]) {
    const ear = grp(head, [s * 0.07, 0.07, -0.04], [0, 0, -s * 0.5]);
    ear.add(m(BALL, fur, [s * 0.07, 0, 0], [0.09, 0.03, 0.05]), m(BALL, light, [s * 0.07, 0, 0.01], [0.06, 0.02, 0.03]));
    P.ears.push(ear);
    // branching antlers
    const a = grp(head, [s * 0.05, 0.08, -0.03], [0, 0, -s * 0.35]);
    a.add(
      m(CYL, antler, [0, 0.14, 0], [0.013, 0.28, 0.013]),
      m(CYL, antler, [0, 0.13, 0.05], [0.01, 0.12, 0.01], [0.7, 0, 0]),
      m(CYL, antler, [s * 0.04, 0.24, 0.03], [0.01, 0.12, 0.01], [0.6, 0, -s * 0.5]),
      m(CYL, antler, [-s * 0.02, 0.3, 0.01], [0.009, 0.1, 0.009], [0.3, 0, s * 0.4]),
    );
  }
  // short tail, white underneath: raised as a white flag when it flees
  P.tail = grp(P.body, [0, 1.13, -0.5]);
  P.tail.add(m(BALL, fur, [0, -0.06, -0.02], [0.045, 0.09, 0.035]), m(BALL, light, [0, -0.06, 0.0], [0.04, 0.08, 0.03]));
  addLegs(P, { hip: 0.82, spots: [[-0.1, 0.36, 1], [0.1, 0.36, 1], [-0.1, -0.38, 0], [0.1, -0.38, 0]], r0: 0.045, r1: 0.03, mat: fur, foot: 'hoof', footMat: dark });
  return P;
}

function goat() {
  const coat = '#ece6dc', grey = '#bfb5a9', horn = '#6c5f55', dark = '#4e4440';
  const P = base();
  P.body.add(
    m(BALL, coat, [0, 0.68, 0], [0.27, 0.29, 0.45]),         // stocky barrel
    m(BALL, grey, [0, 0.85, -0.02], [0.18, 0.11, 0.35]),     // grey saddle
    m(BALL, coat, [0, 0.7, 0.3], [0.24, 0.27, 0.22]),
  );
  P.neck = grp(P.body, [0, 0.8, 0.36]);
  P.neck.add(m(BALL, coat, [0, 0.06, 0.05], [0.1, 0.13, 0.11], [0.4, 0, 0]));
  const head = P.head = grp(P.neck, [0, 0.17, 0.1]);
  head.add(
    m(BALL, coat, [0, 0, 0], [0.1, 0.1, 0.12]),
    m(BOX, coat, [0, -0.05, 0.13], [0.09, 0.08, 0.17]),
    m(BALL, dark, [0, -0.05, 0.22], [0.035, 0.03, 0.02]),
    m(BALL, '#c99a3c', [0.07, 0.03, 0.06], 0.022),           // golden eyes
    m(BALL, '#c99a3c', [-0.07, 0.03, 0.06], 0.022),
    m(CONE, grey, [0, -0.15, 0.1], [0.03, 0.12, 0.03], [Math.PI, 0, 0]),   // beard
  );
  for (const s of [-1, 1]) {
    const ear = grp(head, [s * 0.09, 0.03, -0.02], [0, 0, s * 0.35]);
    ear.add(m(BALL, coat, [s * 0.06, 0, 0], [0.07, 0.025, 0.035]));
    P.ears.push(ear);
    // horns sweeping back
    head.add(
      m(CYL, horn, [s * 0.05, 0.15, -0.06], [0.032, 0.2, 0.032], [-0.6, 0, -s * 0.15]),
      m(CONE, horn, [s * 0.065, 0.25, -0.19], [0.03, 0.18, 0.03], [-1.5, 0, -s * 0.15]),
    );
  }
  P.tail = grp(P.body, [0, 0.88, -0.43]);
  P.tail.add(m(BALL, coat, [0, 0.05, -0.02], [0.04, 0.07, 0.035], [-0.4, 0, 0]));
  addLegs(P, { hip: 0.45, spots: [[-0.13, 0.3, 1], [0.13, 0.3, 1], [-0.13, -0.3, 0], [0.13, -0.3, 0]], r0: 0.06, r1: 0.045, mat: coat, foot: 'hoof', footMat: dark });
  return P;
}

function moose() {
  const fur = '#5a4234', leg = '#7d6858', dark = '#3a2b23', antler = '#cdb68c';
  const P = base();
  P.body.add(
    m(BALL, fur, [0, 1.42, -0.05], [0.4, 0.48, 0.88]),       // big deep body
    m(BALL, fur, [0, 1.75, 0.35], [0.33, 0.27, 0.38]),       // shoulder hump
    m(BALL, fur, [0, 1.42, 0.5], [0.37, 0.48, 0.36]),
  );
  P.neck = grp(P.body, [0, 1.62, 0.75]);
  P.neck.add(m(BALL, fur, [0, 0.0, 0.12], [0.16, 0.2, 0.22], [0.6, 0, 0]));
  const head = P.head = grp(P.neck, [0, -0.02, 0.32]);
  head.add(
    m(BALL, fur, [0, 0.02, 0], [0.14, 0.15, 0.17]),
    m(BALL, fur, [0, -0.08, 0.26], [0.12, 0.13, 0.25]),      // long drooping muzzle
    m(BALL, dark, [0, -0.11, 0.45], [0.1, 0.09, 0.08]),      // overhanging nose
    m(BALL, BLACK, [0.11, 0.06, 0.08], 0.025),
    m(BALL, BLACK, [-0.11, 0.06, 0.08], 0.025),
    m(CONE, fur, [0, -0.3, 0.06], [0.05, 0.24, 0.06], [Math.PI, 0, 0]),   // dewlap
  );
  for (const s of [-1, 1]) {
    const ear = grp(head, [s * 0.12, 0.12, -0.08], [0, 0, -s * 0.25]);
    ear.add(m(BALL, fur, [s * 0.07, 0, 0], [0.09, 0.035, 0.045]));
    P.ears.push(ear);
    // wide palmate antlers: a short beam out to a broad upright palm with tines along its top
    head.add(m(CYL, antler, [s * 0.18, 0.16, -0.05], [0.04, 0.2, 0.04], [0, 0, s * 1.15]));
    const palm = grp(head, [s * 0.4, 0.3, -0.06], [-0.25, 0, -s * 0.5]);
    palm.add(m(BALL, antler, [0, 0, 0], [0.3, 0.17, 0.05]));
    for (let i = 0; i < 5; i++) {
      const u = -0.22 + i * 0.12;
      palm.add(m(CONE, antler, [s * u, 0.17 - Math.abs(u) * 0.3, 0], [0.032, 0.16, 0.032], [0, 0, -s * u * 0.8]));
    }
  }
  P.tail = grp(P.body, [0, 1.6, -0.88]);
  P.tail.add(m(BALL, fur, [0, -0.04, 0], [0.05, 0.07, 0.04]));
  addLegs(P, { hip: 1.08, spots: [[-0.17, 0.5, 1], [0.17, 0.5, 1], [-0.17, -0.55, 0], [0.17, -0.55, 0]], r0: 0.1, r1: 0.065, mat: leg, foot: 'hoof', footMat: dark });
  return P;
}

function squirrel() {
  const fur = '#c06a3a', light = '#f2dcc0', dark = '#4a2e22';
  const P = base();
  P.body.add(
    m(BALL, fur, [0, 0.17, 0], [0.08, 0.09, 0.13]),
    m(BALL, light, [0, 0.15, 0.04], [0.06, 0.07, 0.09]),
  );
  P.neck = grp(P.body, [0, 0.22, 0.1]);
  const head = P.head = grp(P.neck, [0, 0.03, 0.03]);
  head.add(
    m(BALL, fur, [0, 0, 0], [0.065, 0.06, 0.07]),
    m(BALL, light, [0, -0.02, 0.04], [0.045, 0.035, 0.04]),
    m(BALL, dark, [0, -0.005, 0.072], 0.012),
    m(BALL, BLACK, [0.04, 0.02, 0.04], 0.014),
    m(BALL, BLACK, [-0.04, 0.02, 0.04], 0.014),
  );
  for (const s of [-1, 1]) {
    const ear = grp(head, [s * 0.035, 0.05, -0.01], [0, 0, -s * 0.2]);
    ear.add(m(CONE, fur, [0, 0.025, 0], [0.016, 0.055, 0.013]));
    P.ears.push(ear);
  }
  // big bushy tail curled up over the back
  P.tail = grp(P.body, [0, 0.17, -0.12]);
  P.tail.add(
    m(BALL, fur, [0, 0.08, -0.06], [0.06, 0.11, 0.06], [-0.4, 0, 0]),
    m(BALL, fur, [0, 0.24, -0.07], [0.065, 0.1, 0.06], [0.3, 0, 0]),
    m(BALL, light, [0, 0.33, -0.01], [0.04, 0.05, 0.04]),
  );
  addLegs(P, { hip: 0.11, spots: [[-0.05, 0.07, 1], [0.05, 0.07, 1], [-0.05, -0.07, 0], [0.05, -0.07, 0]], r0: 0.02, r1: 0.015, mat: fur, foot: 'paw', footMat: dark });
  return P;
}

export const MODELS = { wolf, bear, deer, goat, moose, squirrel };

export function createCreature(kind, size) {
  const P = MODELS[kind]();
  P.root.traverse((o) => { if (o.isMesh && o.material !== wolfEye) o.castShadow = true; });
  P.root.scale.setScalar(size);
  return P;
}
