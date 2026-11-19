import * as THREE from 'three';
import { terrainHeight } from './noise.js';

// A small pastel barn whose doors face the spawn point (-Z).
export function createBarn(scene, forest, pos) {
  const W = 6, D = 7, H = 3.2, PEAK = 2.2;
  const m = (c) => new THREE.MeshLambertMaterial({ color: c });
  const wall = m('#ec9f98'), roof = m('#f6e7d3'), trim = m('#fffaf2'), door = m('#c97d78'), dark = m('#7a5150'), stone = m('#d6cfd8');

  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, rz = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.z = rz;
    g.add(mesh);
    return mesh;
  };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const front = -D / 2;

  // Foundation, walls, gables
  add(box(W + 0.3, 1.2, D + 0.3), stone, 0, -0.4, 0);
  add(box(W, H, D), wall, 0, H / 2, 0);
  const gableShape = new THREE.Shape([new THREE.Vector2(-W / 2, 0), new THREE.Vector2(W / 2, 0), new THREE.Vector2(0, PEAK)]);
  add(new THREE.ExtrudeGeometry(gableShape, { depth: D, bevelEnabled: false }).translate(0, 0, -D / 2), wall, 0, H, 0);

  // Roof panels
  const a = Math.atan2(PEAK, W / 2), len = Math.hypot(W / 2, PEAK) + 0.55;
  for (const s of [-1, 1]) {
    add(box(len, 0.2, D + 0.7), roof, s * (W / 4 + 0.18), H + PEAK / 2 + 0.02, 0, -s * a);
  }

  // Corner trim
  for (const x of [-W / 2, W / 2]) for (const z of [-D / 2, D / 2]) add(box(0.22, H, 0.22), trim, x, H / 2, z);

  // Big front doors with white X bracing
  const dw = 2.6, dh = 2.5, fz = front - 0.06;
  add(box(dw, dh, 0.1), door, 0, dh / 2, fz);
  const diag = Math.hypot(dw, dh), ang = Math.atan2(dh, dw);
  add(box(diag, 0.16, 0.06), trim, 0, dh / 2, fz - 0.08, ang);
  add(box(diag, 0.16, 0.06), trim, 0, dh / 2, fz - 0.08, -ang);
  add(box(dw + 0.3, 0.2, 0.08), trim, 0, dh + 0.1, fz - 0.06);
  for (const x of [-dw / 2 - 0.08, dw / 2 + 0.08]) add(box(0.18, dh + 0.2, 0.08), trim, x, dh / 2, fz - 0.06);

  // Hay-loft window in the gable
  add(box(1.0, 0.9, 0.1), trim, 0, H + 0.75, fz - 0.02);
  add(box(0.75, 0.65, 0.1), dark, 0, H + 0.75, fz - 0.07);

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  // Sit on the lowest corner so it never floats.
  let y = Infinity;
  for (const x of [-W / 2, W / 2]) for (const z of [-D / 2, D / 2]) y = Math.min(y, terrainHeight(pos.x + x, pos.z + z));
  g.position.set(pos.x, y, pos.z);
  scene.add(g);

  forest.addBox(pos.x - W / 2 - 0.1, pos.x + W / 2 + 0.1, pos.z - D / 2 - 0.1, pos.z + D / 2 + 0.1);
  return g;
}
