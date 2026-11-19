// Top-of-screen HUD: heading-up minimap (top left) and truffle counter (top right).

import { streamDist, STREAM_HALF } from './noise.js';

export const MAP_RANGE = 70; // metres from the pig to the map rim (reaches past where the haze hides a wolf)

// Streams are expensive to sample, so they're painted into a cached world-aligned
// layer that is only rebuilt after the pig has moved a fair way.
const WATER_PX = 128, WATER_M = 1.6;          // layer covers 205 m square
const WATER_REBUILD = 20;

export class Hud {
  constructor() {
    this.canvas = document.getElementById('minimap');
    this.ctx = this.canvas.getContext('2d');
    this.countEl = document.getElementById('truffle-count');
    this.counterEl = document.getElementById('counter');
    this.truffles = 0;
    this.size = 0;
    this.water = document.createElement('canvas');
    this.water.width = this.water.height = WATER_PX;
    this.waterCenter = null;
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const css = this.canvas.clientWidth || 112;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = this.canvas.height = Math.round(css * dpr);
    this.size = css;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setTruffles(n) {
    if (n === this.truffles) return;
    this.truffles = n;
    this.countEl.textContent = n;
    this.counterEl.classList.remove('bump');
    void this.counterEl.offsetWidth;
    this.counterEl.classList.add('bump');
  }

  buildWater(cx, cz) {
    const wctx = this.water.getContext('2d');
    const img = wctx.createImageData(WATER_PX, WATER_PX);
    const half = (WATER_PX / 2) * WATER_M;
    for (let py = 0; py < WATER_PX; py++) {
      for (let px = 0; px < WATER_PX; px++) {
        const d = streamDist(cx - half + (px + 0.5) * WATER_M, cz - half + (py + 0.5) * WATER_M);
        const a = Math.min(1, Math.max(0, (STREAM_HALF + 0.6 - d) / 0.9));
        if (a <= 0) continue;
        const i = (py * WATER_PX + px) * 4;
        img.data[i] = 130; img.data[i + 1] = 196; img.data[i + 2] = 226; img.data[i + 3] = a * 255;
      }
    }
    wctx.putImageData(img, 0, 0);
    this.waterCenter = { x: cx, z: cz };
  }

  // Draws the map rotated so the pig always faces up.
  // icons: dangerous animals, [{ x, z, kind: 'wolf' | 'bear', angry }].
  drawMap(player, barn, forest, icons = []) {
    // Padding around the map circle leaves room for the barn icon sitting on the rim.
    const PAD = 11;
    const g = this.ctx, S = this.size, c = S / 2, R = c - PAD;
    const scale = (R - 6) / MAP_RANGE;
    const h = player.heading;
    const fx = -Math.sin(h), fz = -Math.cos(h); // forward
    const rx = Math.cos(h), rz = -Math.sin(h);  // right
    const toMap = (x, z) => {
      const dx = x - player.pos.x, dz = z - player.pos.z;
      return [c + (dx * rx + dz * rz) * scale, c - (dx * fx + dz * fz) * scale];
    };

    g.clearRect(0, 0, S, S);

    // soft drop shadow under the map
    g.save();
    g.shadowColor = 'rgba(150, 100, 80, 0.35)';
    g.shadowBlur = 8;
    g.shadowOffsetY = 3;
    g.fillStyle = '#b8e0a0';
    g.beginPath();
    g.arc(c, c, R - 1, 0, Math.PI * 2);
    g.fill();
    g.restore();

    g.save();
    g.beginPath();
    g.arc(c, c, R - 2, 0, Math.PI * 2);
    g.clip();

    // meadow
    const bg = g.createRadialGradient(c, c, 0, c, c, R);
    bg.addColorStop(0, '#d7efb8');
    bg.addColorStop(1, '#b8e0a0');
    g.fillStyle = bg;
    g.fillRect(0, 0, S, S);

    // streams
    const wc = this.waterCenter;
    if (!wc || Math.hypot(player.pos.x - wc.x, player.pos.z - wc.z) > WATER_REBUILD) {
      this.buildWater(Math.round(player.pos.x), Math.round(player.pos.z));
    }
    {
      const half = (WATER_PX / 2) * WATER_M;
      g.save();
      // world (dx, dz) relative to the pig -> map pixels
      g.transform(rx * scale, -fx * scale, rz * scale, -fz * scale, c, c);
      g.imageSmoothingEnabled = true;
      g.drawImage(this.water, this.waterCenter.x - player.pos.x - half, this.waterCenter.z - player.pos.z - half, half * 2, half * 2);
      g.restore();
    }

    // trees
    g.fillStyle = 'rgba(120, 180, 125, 0.6)';
    for (const t of forest.nearbyColliders(player.pos.x, player.pos.z, MAP_RANGE)) {
      const [x, y] = toMap(t.x, t.z);
      if ((x - c) ** 2 + (y - c) ** 2 > R * R) continue;
      g.beginPath();
      g.arc(x, y, Math.max(2, (t.r + 1.4) * scale), 0, Math.PI * 2);
      g.fill();
    }

    // view cone
    g.fillStyle = 'rgba(255, 252, 240, 0.35)';
    g.beginPath();
    g.moveTo(c, c);
    g.arc(c, c, R * 0.55, -Math.PI / 2 - 0.45, -Math.PI / 2 + 0.45);
    g.closePath();
    g.fill();
    g.restore();

    // rim
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(255, 250, 242, 0.95)';
    g.beginPath();
    g.arc(c, c, R - 2, 0, Math.PI * 2);
    g.stroke();

    // barn: inside the map when in range, otherwise sitting on the rim line itself
    let [bx, by] = toMap(barn.x, barn.z);
    const ddx = bx - c, ddy = by - c, dd = Math.hypot(ddx, ddy);
    const onRim = dd > R - 10;
    if (onRim) { bx = c + (ddx / dd) * (R - 2); by = c + (ddy / dd) * (R - 2); }

    // Distance only when the barn is on the rim: just inside it, below/above the icon,
    // slid sideways if needed to stay inside the circle.
    if (onRim) {
      const dist = Math.hypot(barn.x - player.pos.x, barn.z - player.pos.z);
      drawDistance(g, bx, by + (by <= c ? 17 : -17), c, R - 4, Math.round(dist) + ' m');
    }

    drawBarn(g, bx, by, onRim ? 0.9 : 1);

    // wolves and bears, only once they're inside the map
    for (const a of icons) {
      let [wx, wy] = toMap(a.x, a.z);
      const wd = Math.hypot(wx - c, wy - c);
      if (wd < R - 4) {
        // near the edge, keep the whole head inside the circle
        const maxD = R - 13;
        if (wd > maxD) { wx = c + ((wx - c) / wd) * maxD; wy = c + ((wy - c) / wd) * maxD; }
        const pulse = a.angry ? 1 + 0.15 * Math.sin(performance.now() / 90) : 1;
        (a.kind === 'bear' ? drawBear : drawWolf)(g, wx, wy, pulse, a.angry);
      }
    }

    // pig nose at the centre
    drawNose(g, c, c);
  }
}

function drawDistance(g, x, y, c, rimR, text) {
  g.save();
  g.font = '700 14px Caveat, "Comic Sans MS", cursive';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const w = g.measureText(text).width + 10, h = 16;
  // keep the pill's outer corners inside the map circle
  const dy = Math.abs(y - c) + h / 2;
  const maxDx = Math.sqrt(Math.max(0, rimR * rimR - dy * dy)) - w / 2;
  x = c + Math.max(-maxDx, Math.min(maxDx, x - c));
  g.fillStyle = 'rgba(255, 249, 240, 0.92)';
  g.beginPath();
  g.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
  g.fill();
  g.fillStyle = '#6b4b52';
  g.fillText(text, x, y + 1);
  g.restore();
}

function drawNose(g, x, y) {
  g.save();
  g.translate(x, y);
  g.shadowColor = 'rgba(120, 60, 70, 0.35)';
  g.shadowBlur = 4;
  g.fillStyle = '#f4a6b8';
  g.strokeStyle = '#fffaf2';
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(0, 0, 10, 7.5, 0, 0, Math.PI * 2);
  g.fill();
  g.shadowBlur = 0;
  g.stroke();
  g.fillStyle = '#b9637a';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(s * 3.6, 0, 1.8, 3, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

// Grey wolf head: pointy ears, pale muzzle, yellow eyes. Red glow when it's growling.
function drawWolf(g, x, y, k, angry) {
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  if (angry) {
    g.fillStyle = 'rgba(230, 70, 80, 0.35)';
    g.beginPath();
    g.arc(0, 0, 13, 0, Math.PI * 2);
    g.fill();
  }
  g.shadowColor = 'rgba(40, 30, 50, 0.45)';
  g.shadowBlur = 4;
  g.fillStyle = '#6f6a78';
  g.strokeStyle = '#fffaf2';
  g.lineWidth = 1.6;
  g.lineJoin = 'round';
  // head outline: ears up top, cheeks, narrowing to the chin
  g.beginPath();
  g.moveTo(-8.5, -10);   // left ear tip
  g.lineTo(-3, -5);
  g.lineTo(3, -5);
  g.lineTo(8.5, -10);    // right ear tip
  g.lineTo(8, -1);
  g.lineTo(9.5, 3);      // right cheek tuft
  g.lineTo(3.5, 5);
  g.lineTo(0, 9);        // chin
  g.lineTo(-3.5, 5);
  g.lineTo(-9.5, 3);
  g.lineTo(-8, -1);
  g.closePath();
  g.fill();
  g.shadowBlur = 0;
  g.stroke();
  // pale muzzle and dark nose
  g.fillStyle = '#d4ced6';
  g.beginPath();
  g.moveTo(-3.5, 1); g.lineTo(3.5, 1); g.lineTo(2.2, 7); g.lineTo(0, 8.5); g.lineTo(-2.2, 7);
  g.closePath();
  g.fill();
  g.fillStyle = '#2a2630';
  g.beginPath();
  g.ellipse(0, 3.2, 1.9, 1.3, 0, 0, Math.PI * 2);
  g.fill();
  // slanted yellow eyes
  g.fillStyle = '#ffd84a';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(s * 4, -1.5, 1.8, 1.1, s * 0.4, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

// Brown bear head: round ears, broad face, pale muzzle, small dark eyes. Red glow when it's growling.
function drawBear(g, x, y, k, angry) {
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  if (angry) {
    g.fillStyle = 'rgba(230, 70, 80, 0.35)';
    g.beginPath();
    g.arc(0, 0, 13, 0, Math.PI * 2);
    g.fill();
  }
  g.shadowColor = 'rgba(40, 30, 50, 0.45)';
  g.shadowBlur = 4;
  g.strokeStyle = '#fffaf2';
  g.lineWidth = 1.6;
  g.fillStyle = '#7b5a46';
  // ears behind the face
  for (const s of [-1, 1]) {
    g.beginPath();
    g.arc(s * 6.5, -6.5, 3.6, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  g.beginPath();
  g.ellipse(0, 0.5, 9, 8.2, 0, 0, Math.PI * 2);
  g.fill();
  g.shadowBlur = 0;
  g.stroke();
  // inner ears
  g.fillStyle = '#c9a687';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.arc(s * 6.5, -6.5, 1.6, 0, Math.PI * 2);
    g.fill();
  }
  // muzzle and nose
  g.beginPath();
  g.ellipse(0, 3.6, 4.3, 3.4, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#2a2630';
  g.beginPath();
  g.ellipse(0, 2.4, 2, 1.4, 0, 0, Math.PI * 2);
  g.fill();
  // small dark eyes
  for (const s of [-1, 1]) {
    g.beginPath();
    g.arc(s * 3.6, -1.6, 1.25, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

function drawBarn(g, x, y, k) {
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  g.shadowColor = 'rgba(120, 60, 70, 0.35)';
  g.shadowBlur = 4;
  // body + roof
  g.fillStyle = '#e88f88';
  g.strokeStyle = '#fffaf2';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(-8, 7);
  g.lineTo(-8, -2);
  g.lineTo(0, -9);
  g.lineTo(8, -2);
  g.lineTo(8, 7);
  g.closePath();
  g.fill();
  g.shadowBlur = 0;
  g.stroke();
  // door with X
  g.fillStyle = '#c56f6a';
  g.fillRect(-3.5, 0.5, 7, 6.5);
  g.beginPath();
  g.moveTo(-3.5, 0.5); g.lineTo(3.5, 7);
  g.moveTo(3.5, 0.5); g.lineTo(-3.5, 7);
  g.lineWidth = 1.2;
  g.stroke();
  g.strokeRect(-3.5, 0.5, 7, 6.5);
  g.restore();
}
