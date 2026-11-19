// Floating "click and drag" joystick: press anywhere, drag away from the press point.
export class Joystick {
  constructor(surface) {
    this.surface = surface;
    this.base = document.createElement('div');
    this.base.className = 'joy-base';
    this.knob = document.createElement('div');
    this.knob.className = 'joy-knob';
    document.body.append(this.base, this.knob);

    this.id = null;
    this.ox = 0; this.oy = 0;
    this.x = 0; this.y = 0;   // -1..1, y positive = down on screen
    this.enabled = false;

    surface.addEventListener('pointerdown', (e) => this.down(e));
    surface.addEventListener('pointermove', (e) => this.move(e));
    surface.addEventListener('pointerup', (e) => this.up(e));
    surface.addEventListener('pointercancel', (e) => this.up(e));
    surface.addEventListener('lostpointercapture', (e) => this.up(e));
  }

  get maxR() { return Math.max(48, Math.min(innerWidth, innerHeight) * 0.16); }

  down(e) {
    if (!this.enabled || this.id !== null) return;
    e.preventDefault();
    this.id = e.pointerId;
    try { this.surface.setPointerCapture(e.pointerId); } catch {}
    this.ox = e.clientX; this.oy = e.clientY;
    this.x = this.y = 0;
    const d = this.maxR * 2;
    this.base.style.width = this.base.style.height = d + 'px';
    this.base.style.transform = `translate(${this.ox - d / 2}px, ${this.oy - d / 2}px)`;
    this.placeKnob(0, 0);
    this.base.classList.add('joy-on');
    this.knob.classList.add('joy-on');
  }

  move(e) {
    if (e.pointerId !== this.id) return;
    e.preventDefault();
    let dx = e.clientX - this.ox, dy = e.clientY - this.oy;
    const len = Math.hypot(dx, dy), R = this.maxR;
    if (len > R) { dx *= R / len; dy *= R / len; }
    this.x = dx / R; this.y = dy / R;
    this.placeKnob(dx, dy);
  }

  up(e) {
    if (e.pointerId !== this.id) return;
    this.id = null;
    this.x = this.y = 0;
    this.base.classList.remove('joy-on');
    this.knob.classList.remove('joy-on');
  }

  // Drop any drag in progress (e.g. when the game pauses).
  cancel() {
    this.id = null;
    this.x = this.y = 0;
    this.base.classList.remove('joy-on');
    this.knob.classList.remove('joy-on');
  }

  placeKnob(dx, dy) {
    this.knob.style.transform = `translate(${this.ox + dx - 29}px, ${this.oy + dy - 29}px)`;
  }

  read() {
    return { x: this.x, y: this.y, mag: Math.min(1, Math.hypot(this.x, this.y)) };
  }
}
