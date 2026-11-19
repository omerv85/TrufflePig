// Deterministic hashing / noise helpers so the forest is the same every visit.

export function hash2(x, z, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function vnoise(x, z, seed) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi, seed), b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed), d = hash2(xi + 1, zi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x, z, seed = 0, octaves = 3) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x * freq, z * freq, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Gentle rolling meadow / forest floor, before streams are carved in.
export function baseHeight(x, z) {
  return (fbm(x * 0.018, z * 0.018, 1, 3) - 0.5) * 5 + (fbm(x * 0.08, z * 0.08, 7, 2) - 0.5) * 0.6;
}

// ---------- streams ----------
// Streams follow the 0.5 contour of a low-frequency noise field, so they meander
// and stay continuous across chunks. streamDist ≈ metres from the stream's centre.
export const STREAM_HALF = 1.5;  // water half-width (roughly)
const BANK = 1.4;                // sloped bank beyond the water
const CARVE = 0.75;              // channel depth below the meadow
const WATER_DROP = 0.38;         // water surface below the meadow
// Offsets picked so the first stream is ~35 m from the barn and none crosses the meadow.
const SF = 0.007, SOX = 630.3, SOZ = 50.9, EPS = 0.6;

export function streamDist(x, z) {
  const n = fbm(x * SF + SOX, z * SF + SOZ, 41, 3);
  const gx = fbm((x + EPS) * SF + SOX, z * SF + SOZ, 41, 3) - n;
  const gz = fbm(x * SF + SOX, (z + EPS) * SF + SOZ, 41, 3) - n;
  const grad = Math.hypot(gx, gz) / EPS;
  return Math.abs(n - 0.5) / Math.max(grad, 0.0035);
}

function carve(d) {
  return d >= STREAM_HALF + BANK ? 0 : CARVE * smoothstep(STREAM_HALF + BANK, STREAM_HALF * 0.4, d);
}

export function terrainHeight(x, z) {
  return baseHeight(x, z) - carve(streamDist(x, z));
}

export function waterLevel(x, z) {
  return baseHeight(x, z) - WATER_DROP;
}

// Water depth at a point (<= 0 means dry ground).
export function waterDepth(x, z) {
  return carve(streamDist(x, z)) - WATER_DROP;
}
