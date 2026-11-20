import * as THREE from 'three';

// Low-poly forest animals built from primitives: the wolf, bear, witch and troll (dangerous), and the deer,
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

// The witch stands upright: a long robe that sways as she walks (`body`), boots that step out
// from under the hem (`legs`), a head with a tall crooked hat, and a right arm (`arm`) holding a
// wand whose tip glows (`tip`, its own material so it can brighten as she casts).
function witch() {
  const robe = '#6b4f8c', robeDark = '#4f3a6a', skin = '#b9d79a', skinDark = '#93b878';
  const hat = '#3a2f48', band = '#c86f9a', hair = '#e8a15a', boot = '#2e2636', wood = '#6b4a36';
  const P = base();
  const robeGeo = new THREE.CylinderGeometry(0.17, 0.42, 1.05, 8, 1, true);
  P.body.add(
    m(robeGeo, robe, [0, 0.62, 0]),                              // long flared robe
    m(CYL, robeDark, [0, 0.12, 0], [0.42, 0.06, 0.42]),          // hem
    m(BALL, robe, [0, 1.17, 0], [0.22, 0.17, 0.18]),             // shoulders
    m(CYL, band, [0, 0.96, 0], [0.19, 0.05, 0.19]),              // sash
  );
  // ragged cape down her back
  for (let i = 0; i < 5; i++) {
    const a = -0.8 + i * 0.4;
    P.body.add(m(CONE, robeDark, [Math.sin(a) * 0.2, 0.75, -0.12 - Math.cos(a) * 0.12], [0.12, 0.85, 0.05], [0.15, a, 0]));
  }
  P.neck = grp(P.body, [0, 1.28, 0.02]);
  const head = P.head = grp(P.neck, [0, 0.12, 0]);
  head.add(
    m(BALL, skin, [0, 0, 0], [0.15, 0.16, 0.15]),                 // face
    m(CONE, skinDark, [0, -0.01, 0.2], [0.035, 0.14, 0.035], [1.75, 0, 0]),   // long hooked nose
    m(BALL, skinDark, [0, -0.055, 0.265], 0.02),                  // wart on the tip
    m(BALL, skinDark, [0, -0.13, 0.09], [0.05, 0.05, 0.05]),      // pointed chin
    m(BOX, '#5a2f45', [0, -0.08, 0.135], [0.08, 0.015, 0.02]),    // thin smile
    m(BALL, wolfEye, [0.055, 0.035, 0.13], 0.022),                // glowing yellow eyes
    m(BALL, wolfEye, [-0.055, 0.035, 0.13], 0.022),
    m(BOX, hat, [0.055, 0.07, 0.135], [0.06, 0.015, 0.02], [0, 0, -0.35]),   // arched brows
    m(BOX, hat, [-0.055, 0.07, 0.135], [0.06, 0.015, 0.02], [0, 0, 0.35]),
  );
  // straggly hair falling to the shoulders
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * 0.55 + i * (Math.PI * 0.9 / 6);
    head.add(m(CONE, hair, [Math.sin(a) * 0.14, -0.12, Math.cos(a) * 0.12], [0.05, 0.3, 0.04], [Math.PI + Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3]));
  }
  // tall pointed hat with a wide brim and a bend near the tip
  const hatG = grp(head, [0, 0.1, -0.01], [-0.12, 0, 0]);
  hatG.add(
    m(CYL, hat, [0, 0, 0], [0.34, 0.025, 0.34]),
    m(CYL, band, [0, 0.05, 0], [0.155, 0.06, 0.155]),
    m(new THREE.CylinderGeometry(0.06, 0.16, 0.34, 8), hat, [0, 0.2, 0]),
  );
  const tipG = grp(hatG, [0, 0.36, 0], [-0.55, 0, 0]);
  tipG.add(m(CONE, hat, [0, 0.11, 0], [0.065, 0.24, 0.065]));
  // left arm hangs at her side; the right arm holds the wand and swings up to point it
  const armL = grp(P.body, [-0.25, 1.17, 0.03], [0, 0, 0.22]);
  armL.add(m(BALL, robe, [0, -0.2, 0], [0.065, 0.22, 0.065]), m(BALL, skin, [0, -0.43, 0], 0.05));
  const arm = P.arm = grp(P.body, [0.25, 1.17, 0.03], [0, 0, -0.22]);
  arm.add(m(BALL, robe, [0, -0.2, 0], [0.065, 0.22, 0.065]), m(BALL, skin, [0, -0.43, 0], 0.05));
  const wand = grp(arm, [0, -0.44, 0.02], [Math.PI / 2, 0, 0]);   // held pointing forward from the fist
  wand.add(m(CYL, wood, [0, 0.17, 0], [0.014, 0.36, 0.014]));
  P.tipMat = new THREE.MeshBasicMaterial({ color: '#b7ffa0' });
  P.tip = m(new THREE.IcosahedronGeometry(1, 1), P.tipMat, [0, 0.36, 0], 0.03);
  wand.add(P.tip);
  P.wand = wand;
  P.tail = grp(P.body);
  // boots poke out from under the hem and step as she walks
  P.legs = [-1, 1].map((s) => {
    const leg = grp(P.root, [s * 0.11, 0.2, 0]);
    leg.add(m(CYL, boot, [0, -0.1, 0], [0.05, 0.2, 0.05]), m(BALL, boot, [0, -0.17, 0.07], [0.06, 0.045, 0.11]));
    const toe = m(CONE, boot, [0, -0.15, 0.2], [0.03, 0.09, 0.03], [1.9, 0, 0]);   // curled pointy toe
    leg.add(toe);
    leg.userData = { front: true, side: s };
    return leg;
  });
  P.hip = 0.2;
  return P;
}

// Forest troll: the biggest thing in the forest (about 3 m tall), hunched and mossy, with a glowing
// lantern in its left hand (seen from far off at night) and a great club in its right, dragged
// along the ground behind it. arm/club: the club arm (animals.js keeps the club's end on the ground),
// armL/lantern: the lantern arm and the lantern, which hangs straight down from the fist.
function troll() {
  const skin = '#8fa486', skinDark = '#71866a', belly = '#b4c29f', moss = '#6f9a5a', mossLight = '#8db36f';
  const cloth = '#8a6a4f', clothDark = '#6d523d', wood = '#8a6446', woodDark = '#6a4b35', metal = '#4a4250';
  const P = base();
  P.body.add(
    m(BALL, skin, [0, 1.62, -0.05], [0.68, 0.78, 0.58]),            // huge pear-shaped torso
    m(BALL, belly, [0, 1.42, 0.28], [0.52, 0.55, 0.38]),             // round belly
    m(BALL, skin, [0, 2.18, 0.05], [0.82, 0.38, 0.5]),               // hulking shoulders
    m(BALL, skinDark, [0, 2.15, -0.28], [0.6, 0.42, 0.3]),           // hunched back
    m(CYL, cloth, [0, 1.0, 0], [0.62, 0.32, 0.5]),                   // loincloth
    m(CONE, clothDark, [0.22, 0.75, 0.38], [0.16, 0.3, 0.05], [Math.PI, 0, 0.1]),   // ragged hem
    m(CONE, clothDark, [-0.2, 0.74, 0.4], [0.14, 0.28, 0.05], [Math.PI, 0, -0.12]),
    m(CONE, clothDark, [0, 0.72, -0.42], [0.2, 0.32, 0.05], [Math.PI, 0, 0]),
    m(CYL, woodDark, [0, 1.2, 0], [0.64, 0.06, 0.52]),               // rope belt
  );
  // moss growing on the shoulders and back
  for (const [x, y, z, r] of [[-0.55, 2.42, -0.05, 0.22], [0.5, 2.44, 0, 0.2], [0.1, 2.48, -0.22, 0.26], [-0.2, 2.3, -0.45, 0.2], [0.35, 2.1, -0.5, 0.17]]) {
    P.body.add(m(BALL, (x + z) > 0 ? moss : mossLight, [x, y, z], [r, r * 0.55, r]));
  }
  P.neck = grp(P.body, [0, 2.35, 0.38]);
  const head = P.head = grp(P.neck, [0, 0.12, 0.12]);
  head.add(
    m(BALL, skin, [0, 0, 0], [0.4, 0.36, 0.38]),                     // big lumpy head
    m(BALL, skinDark, [0, 0.14, 0.24], [0.36, 0.1, 0.18]),           // heavy brow
    m(BALL, skin, [0, -0.06, 0.4], [0.13, 0.15, 0.15]),              // bulbous nose
    m(BALL, skinDark, [0.1, -0.12, 0.42], 0.05), m(BALL, skinDark, [-0.1, -0.12, 0.42], 0.05),  // nostrils
    m(BALL, skinDark, [0.08, 0.08, 0.44], 0.035),                    // a wart
    m(BALL, wolfEye, [0.15, 0.05, 0.33], 0.05),                      // small glowing yellow eyes
    m(BALL, wolfEye, [-0.15, 0.05, 0.33], 0.05),
    m(BALL, moss, [0, 0.3, -0.06], [0.3, 0.13, 0.3]),                // mossy tuft of hair
    m(BALL, mossLight, [0.12, 0.34, 0.06], [0.14, 0.1, 0.14]),
  );
  for (const sd of [-1, 1]) {                                        // long drooping pointed ears
    const ear = grp(head, [sd * 0.36, 0.06, 0], [0, 0, sd * -1.25]);
    ear.add(m(CONE, skin, [0, 0.2, 0], [0.11, 0.42, 0.06]));
    P.ears.push(ear);
  }
  // underbite jaw with two tusks pointing up
  const jaw = P.jaw = grp(head, [0, -0.2, 0.08]);
  jaw.add(m(BALL, skin, [0, -0.04, 0.16], [0.3, 0.12, 0.2]));
  for (const sd of [-1, 1]) jaw.add(m(CONE, TOOTH, [sd * 0.16, 0.1, 0.3], [0.045, 0.16, 0.045], [-0.15, 0, sd * 0.15]));
  head.add(m(BOX, MOUTH, [0, -0.2, 0.3], [0.32, 0.04, 0.12]));

  // long arms hanging from the shoulders
  const armGeo = (g) => { g.add(m(BALL, skin, [0, -0.32, 0], [0.19, 0.4, 0.19]), m(BALL, skin, [0, -0.82, 0], [0.15, 0.36, 0.15]), m(BALL, skinDark, [0, -1.15, 0], 0.17)); };
  // right: the club arm
  const arm = P.arm = grp(P.body, [-0.82, 2.2, 0.05], [0, 0, 0.12]);
  armGeo(arm);
  const club = P.club = grp(arm, [0, -1.15, 0]);                    // swings about the fist
  club.add(
    m(new THREE.CylinderGeometry(0.2, 0.065, 1.7, 7).translate(0, 0.85, 0), wood, [0, -0.1, 0]),
    m(BALL, wood, [0, 1.6, 0], [0.21, 0.18, 0.21]),                 // rounded heavy end
  );
  for (const [y, a] of [[1.25, 0], [1.45, 2.1], [1.1, 4.2], [1.55, 5.4]]) {   // knots and stubs
    club.add(m(CONE, woodDark, [Math.sin(a) * 0.19, y, Math.cos(a) * 0.19], [0.05, 0.14, 0.05], [Math.cos(a) * 1.4, 0, -Math.sin(a) * 1.4]));
  }
  P.clubLen = 1.65;
  // left: holds the lantern out in front
  const armL = P.armL = grp(P.body, [0.82, 2.2, 0.05], [0, 0, -0.12]);
  armGeo(armL);
  const lantern = P.lantern = grp(armL, [0, -1.2, 0]);             // hangs from the fist
  P.lanternMat = new THREE.MeshBasicMaterial({ color: '#ffd27a', fog: false });
  lantern.add(
    m(new THREE.TorusGeometry(0.09, 0.015, 4, 8), metal, [0, -0.02, 0], 1, [0, Math.PI / 2, 0]),   // handle
    m(new THREE.ConeGeometry(0.17, 0.13, 6), metal, [0, -0.15, 0]),          // roof
    m(CYL, metal, [0, -0.5, 0], [0.16, 0.04, 0.16]),                         // base
  );
  for (const a of [0, 1, 2, 3, 4, 5]) {                                       // frame posts
    lantern.add(m(CYL, metal, [Math.cos(a * 1.047) * 0.14, -0.35, Math.sin(a * 1.047) * 0.14], [0.012, 0.3, 0.012]));
  }
  P.lanternCore = m(new THREE.CylinderGeometry(0.12, 0.12, 0.28, 6), P.lanternMat, [0, -0.35, 0]);
  lantern.add(P.lanternCore);
  // a soft warm halo around it, drawn through the night haze so the lantern shows from afar
  const halo = P.halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTexture(), color: '#ffc46a', transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, opacity: 0.8,
  }));
  halo.scale.setScalar(1.6);
  halo.position.set(0, -0.35, 0);
  lantern.add(halo);
  P.tail = grp(P.body);
  // short thick legs with big flat feet
  P.legs = [-1, 1].map((sd) => {
    const leg = grp(P.root, [sd * 0.34, 0.95, 0]);
    leg.add(
      m(BALL, skin, [0, -0.25, 0], [0.25, 0.36, 0.25]),            // thick thigh
      m(BALL, skin, [0, -0.6, 0.02], [0.2, 0.32, 0.2]),             // shin, down into the foot
      m(BALL, skinDark, [0, -0.86, 0.12], [0.25, 0.12, 0.35]),      // big flat foot
      m(BALL, skinDark, [0, -0.8, 0.0], [0.19, 0.14, 0.19]),        // ankle
    );
    leg.userData = { front: true, side: sd };
    return leg;
  });
  P.hip = 0.95;
  return P;
}

let _halo = null;
function haloTexture() {
  if (_halo) return _halo;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  _halo = new THREE.CanvasTexture(c);
  return _halo;
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
  // big back haunches, so the hind legs come out of the body
  for (const sd of [-1, 1]) P.body.add(m(BALL, fur, [sd * 0.055, 0.13, -0.06], [0.045, 0.06, 0.07]));
  addLegs(P, { hip: 0.13, spots: [[-0.045, 0.075, 1], [0.045, 0.075, 1], [-0.06, -0.06, 0], [0.06, -0.06, 0]], r0: 0.024, r1: 0.016, mat: fur, foot: 'paw', footMat: dark });
  // the front legs belong to the body: when it sits up they lift with it, paws held up at its chest
  for (const leg of P.legs) if (leg.userData.front) P.body.add(leg);
  return P;
}

export const MODELS = { wolf, bear, witch, troll, deer, goat, moose, squirrel };

export function createCreature(kind, size) {
  const P = MODELS[kind]();
  P.root.traverse((o) => { if (o.isMesh && o.material !== wolfEye && o.material !== P.tipMat && o.material !== P.lanternMat) o.castShadow = true; });
  P.root.scale.setScalar(size);
  return P;
}
