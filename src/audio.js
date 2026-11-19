// Procedural forest ambience: breeze, rustling leaves, humming insects, distant
// cicadas and bird calls, plus the pig's snorts, sniffs and footsteps.
// Everything is synthesized with Web Audio, so there are no sound files.

const rand = (a, b) => a + Math.random() * (b - a);

export class Ambience {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.paused = false;
    this.volume = 0.9;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this.master.gain.linearRampToValueAtTime(this.muted ? 0 : this.volume, ctx.currentTime + 3);

    this.pink = this.noiseBuffer(6, 'pink');
    this.brown = this.noiseBuffer(6, 'brown');
    this.white = this.noiseBuffer(2, 'white');

    // Shared airy reverb for birds.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.4;
    this.reverb.connect(wet).connect(this.master);
    this.birdBus = ctx.createGain();
    this.birdBus.connect(this.master);
    this.birdBus.connect(this.reverb);

    this.wind();
    this.brook();
    this.leaves();
    this.insects();
    this.cicadas();
    this.scheduleBird(1.2);
    this.loadSamples();

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) ctx.suspend(); else if (!this.paused) ctx.resume();
    });
  }

  // Pausing silences everything (the whole audio clock stops) until resumed.
  setPaused(paused) {
    this.paused = paused;
    if (!this.ctx) return;
    if (paused) this.ctx.suspend(); else if (!document.hidden) this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) {
      const g = this.master.gain, t = this.ctx.currentTime;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(this.muted ? 0 : this.volume, t + 0.4);
    }
    return this.muted;
  }

  // ---------- building blocks ----------
  noiseBuffer(seconds, type) {
    const ctx = this.ctx, len = Math.floor(seconds * ctx.sampleRate);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (type === 'pink') {
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        } else if (type === 'brown') {
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.5;
        } else d[i] = w;
      }
    }
    return buf;
  }

  impulse(seconds) {
    const ctx = this.ctx, len = Math.floor(seconds * ctx.sampleRate);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  loop(buf) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start(0, Math.random() * buf.duration);
    return s;
  }

  lfo(freq, depth, target, type = 'sine') {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(target);
    o.start();
    return o;
  }

  // ---------- ambience layers ----------
  wind() {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 480;
    lp.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0.28;
    this.loop(this.brown).connect(lp).connect(g).connect(this.master);
    this.lfo(0.055, 260, lp.frequency);
    this.lfo(0.083, 0.12, g.gain);
  }

  // Babbling water: a few resonant bands whose pitches jump around like bubbles.
  brook() {
    const ctx = this.ctx;
    this.brookGain = ctx.createGain();
    this.brookGain.gain.value = 0;
    this.brookGain.connect(this.master);
    const src = this.loop(this.pink);
    const bands = [];
    for (let i = 0; i < 4; i++) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 6;
      bp.frequency.value = 600 + i * 400;
      const g = ctx.createGain();
      g.gain.value = 0.9;
      src.connect(bp).connect(g).connect(this.brookGain);
      bands.push(bp);
    }
    const hiss = ctx.createBiquadFilter();
    hiss.type = 'highpass';
    hiss.frequency.value = 2500;
    const hg = ctx.createGain();
    hg.gain.value = 0.25;
    src.connect(hiss).connect(hg).connect(this.brookGain);
    setInterval(() => {
      if (ctx.state !== 'running' || this.brookLevel < 0.01) return;
      const t = ctx.currentTime;
      for (const bp of bands) bp.frequency.setTargetAtTime(rand(450, 2200), t, 0.03);
    }, 70);
    this.brookLevel = 0;
  }

  setWater(level) {
    if (!this.ctx || Math.abs(level - this.brookLevel) < 0.01) return;
    this.brookLevel = level;
    this.brookGain.gain.setTargetAtTime(level * 0.35, this.ctx.currentTime, 0.3);
  }

  leaves() {
    const ctx = this.ctx;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6500;
    const g = ctx.createGain();
    g.gain.value = 0.006;
    const pan = ctx.createStereoPanner();
    this.loop(this.pink).connect(hp).connect(lp).connect(g).connect(pan).connect(this.master);
    const gust = () => {
      const t = ctx.currentTime, peak = rand(0.025, 0.07), up = rand(1, 2.2), down = rand(2, 4);
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(peak, t + up);
      g.gain.linearRampToValueAtTime(0.006, t + up + down);
      pan.pan.setValueAtTime(rand(-0.6, 0.6), t);
      setTimeout(gust, (up + down + rand(2, 8)) * 1000);
    };
    setTimeout(gust, 2000);
  }

  insects() {
    // A lazy bumblebee-ish drone drifting left and right.
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 650;
    const g = ctx.createGain();
    g.gain.value = 0.012;
    const pan = ctx.createStereoPanner();
    for (const f of [196, 199.3, 392.5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start();
      this.lfo(rand(3, 6), rand(1.5, 3), o.frequency);
    }
    lp.connect(g).connect(pan).connect(this.master);
    this.lfo(0.11, 0.01, g.gain);
    this.lfo(0.045, 0.7, pan.pan);
  }

  cicadas() {
    // Distant buzzing that swells and fades.
    const ctx = this.ctx;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 4700;
    bp.Q.value = 7;
    const am = ctx.createGain();
    am.gain.value = 0.5;
    this.lfo(38, 0.5, am.gain);
    const swell = ctx.createGain();
    swell.gain.value = 0;
    const pan = ctx.createStereoPanner();
    this.loop(this.white).connect(bp).connect(am).connect(swell).connect(pan).connect(this.master);
    const cycle = () => {
      const t = ctx.currentTime, peak = rand(0.04, 0.09), up = rand(2, 4), hold = rand(2, 5), down = rand(3, 5);
      pan.pan.setValueAtTime(rand(-0.8, 0.8), t);
      swell.gain.setValueAtTime(0, t);
      swell.gain.linearRampToValueAtTime(peak, t + up);
      swell.gain.setValueAtTime(peak, t + up + hold);
      swell.gain.linearRampToValueAtTime(0, t + up + hold + down);
      setTimeout(cycle, (up + hold + down + rand(4, 14)) * 1000);
    };
    setTimeout(cycle, 4000);
  }

  // ---------- birds ----------
  scheduleBird(delay) {
    setTimeout(() => {
      if (this.ctx.state === 'running') {
        this.bird();
        if (Math.random() < 0.35) setTimeout(() => this.bird(this.lastKind, this.lastPan), rand(700, 1500));
      }
      this.scheduleBird(rand(1.2, 5));
    }, delay * 1000);
  }

  bird(kind = Math.floor(Math.random() * 4), panV = rand(-0.9, 0.9)) {
    const ctx = this.ctx, t0 = ctx.currentTime + 0.05;
    this.lastKind = kind;
    this.lastPan = panV;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const g = ctx.createGain();
    g.gain.value = 0;
    const pan = ctx.createStereoPanner();
    pan.pan.value = panV;
    osc.connect(g).connect(pan).connect(this.birdBus);
    const vol = rand(0.025, 0.09);
    const f = osc.frequency;
    let t = t0;

    const note = (from, to, dur) => {
      f.setValueAtTime(from, t);
      f.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + Math.min(0.015, dur * 0.25));
      g.gain.linearRampToValueAtTime(0, t + dur);
    };

    if (kind === 0) {           // quick tweets
      const n = 3 + Math.floor(Math.random() * 4), base = rand(2800, 3800);
      for (let i = 0; i < n; i++) { note(base, base * 1.35, 0.07); t += rand(0.1, 0.15); }
    } else if (kind === 1) {    // two-note whistle
      const base = rand(2300, 3100);
      note(base, base * 0.96, 0.28); t += 0.38;
      note(base * 0.8, base * 0.78, 0.34); t += 0.4;
    } else if (kind === 2) {    // trill
      f.setValueAtTime(rand(3200, 4200), t);
      const l = ctx.createOscillator();
      l.frequency.value = rand(18, 30);
      const lg = ctx.createGain();
      lg.gain.value = rand(200, 450);
      l.connect(lg).connect(f);
      l.start(t);
      l.stop(t + 0.9);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol * 0.8, t + 0.08);
      g.gain.linearRampToValueAtTime(0, t + 0.8);
      t += 0.85;
    } else {                    // descending warble
      let fr = rand(3800, 4500);
      const n = 5 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) { note(fr * 0.95, fr, 0.06); t += 0.075; fr *= 0.93; }
    }
    osc.start(t0);
    osc.stop(t + 0.1);
    osc.onended = () => { g.disconnect(); pan.disconnect(); };
  }

  // ---------- pig sounds ----------
  // Recorded pig calls (assets/sounds). Peak levels differ, so each gets a normalizing gain.
  async loadSamples() {
    const files = {
      grunt: ['assets/sounds/pig-grunt.mp3', 2.1],
      oink: ['assets/sounds/pig-oink.mp3', 1.0],
      porco: ['assets/sounds/pig-porco.mp3', 1.7],
      excited: ['assets/sounds/pig-grunting-excitedly.mp3', 0.75],
    };
    this.samples = {};
    await Promise.all(Object.entries(files).map(async ([name, [url, gain]]) => {
      try {
        const data = await (await fetch(url)).arrayBuffer();
        const buffer = await new Promise((ok, fail) => this.ctx.decodeAudioData(data, ok, fail));
        this.samples[name] = { buffer, gain };
      } catch (e) {
        console.warn('Could not load', url, e);
      }
    }));
  }

  // fade (seconds) softens the edges when playing a slice out of a longer recording.
  playSample(name, { when = 0, rate = 1, vol = 1, pan = 0, offset = 0, duration, fade = 0 } = {}) {
    const s = this.samples?.[name];
    if (!s) return false;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = s.buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    const level = vol * s.gain;
    if (fade > 0 && duration) {
      const len = duration / rate;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + fade);
      g.gain.setValueAtTime(level, t + len - fade);
      g.gain.linearRampToValueAtTime(0, t + len);
    } else g.gain.value = level;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(g).connect(p).connect(this.master);
    src.start(t, offset, duration);
    return true;
  }

  // Catching a whiff of truffle on the breeze.
  oink(excite = 0) {
    if (!this.ctx) return;
    if (!this.playSample('oink', { rate: 1 + excite * 0.3 + rand(-0.04, 0.04), vol: 0.45 + excite * 0.5, pan: rand(-0.1, 0.1) })) this.synthSqueal(excite);
  }

  // The pig lifts its nose with a grunt.
  snort() {
    if (!this.ctx) return;
    if (!this.playSample('grunt', { rate: rand(0.9, 1.08), vol: rand(0.75, 0.95) })) this.synthSnort();
  }

  // Reaction to a truffle's scent. Far off: oinks that get faster, higher and louder.
  // Close (excite > 0.6): squeals cut from the "porco" recording, longer the closer it gets.
  squeal(excite) {
    if (!this.ctx) return;
    if (excite > 0.6 && this.samples?.porco) {
      const phrases = [[0.36, 2.34], [2.8, 4.76]];  // voiced parts of the recording
      const [a, b] = phrases[Math.floor(Math.random() * phrases.length)];
      const whole = excite > 0.88 && Math.random() < 0.25;
      const len = whole ? b - a : Math.min(b - a, 0.45 + (excite - 0.6) * 1.6 + rand(0, 0.2));
      const offset = whole ? a : a + Math.random() * (b - a - len);
      const rate = rand(0.97, 1.06);
      this.playSample('porco', { offset, duration: len, fade: 0.04, rate, vol: 0.55 + (excite - 0.6) * 1.0, pan: rand(-0.1, 0.1) });
      return len / rate; // seconds of sound, so the next call can wait for it
    }
    const rate = 1 + excite * 0.45 + rand(-0.04, 0.04);
    const vol = 0.3 + excite * 0.6;
    if (!this.playSample('oink', { rate, vol, pan: rand(-0.1, 0.1) })) { this.synthSqueal(excite); return 0.4; }
    if (excite > 0.5 && Math.random() < excite * 0.8) {
      // a quicker, clipped second oink right after the first
      this.playSample('oink', { when: rand(0.6, 0.68) / rate, rate: rate * rand(1.03, 1.1), vol: vol * 0.85, offset: 0.05, duration: 0.42 });
      return 1.1 / rate;
    }
    return 0.7 / rate;
  }
  noiseHit(buf, dur, { type = 'bandpass', freq = 1000, q = 1, vol = 0.3, attack = 0.01, pan = 0 } = {}) {
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = freq;
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    s.connect(flt).connect(g).connect(p).connect(this.master);
    s.start(t, Math.random() * (buf.duration - dur - 0.1));
    s.stop(t + dur + 0.05);
    return { t, flt, g };
  }

  // Synthesized fallback, used until the recorded grunt has loaded.
  synthSnort() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    // Raspy grunt: band-passed noise chopped by a fast square wave.
    const { t, g } = this.noiseHit(this.pink, 0.34, { freq: 650, q: 1.6, vol: 0.9, attack: 0.03 });
    const chop = ctx.createGain();
    chop.gain.value = 0.5;
    g.disconnect();
    g.connect(chop).connect(this.master);
    const sq = ctx.createOscillator();
    sq.type = 'square';
    sq.frequency.value = 34;
    const sqg = ctx.createGain();
    sqg.gain.value = 0.5;
    sq.connect(sqg).connect(chop.gain);
    sq.start(t);
    sq.stop(t + 0.4);
    // A little throaty body under it.
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(85, t + 0.3);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.12, t + 0.03);
    og.gain.linearRampToValueAtTime(0, t + 0.32);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.35);
  }

  sniff() {
    if (!this.ctx) return;
    // Short inhale: rising airy noise that cuts off.
    const { t, flt } = this.noiseHit(this.white, 0.13, { type: 'bandpass', freq: 2200, q: 0.9, vol: 0.18, attack: 0.1 });
    flt.frequency.setValueAtTime(1800, t);
    flt.frequency.linearRampToValueAtTime(3200, t + 0.11);
  }

  // Synthesized fallback, used until the recorded oink has loaded.
  synthSqueal(excite) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const one = (t, pitch, dur, vol) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(pitch * 0.75, t);
      o.frequency.exponentialRampToValueAtTime(pitch * 1.45, t + dur * 0.35);
      o.frequency.exponentialRampToValueAtTime(pitch * 1.05, t + dur);
      const vib = ctx.createOscillator();
      vib.frequency.value = rand(24, 32);
      const vg = ctx.createGain();
      vg.gain.value = pitch * 0.04;
      vib.connect(vg).connect(o.frequency);
      const formant = ctx.createBiquadFilter();
      formant.type = 'bandpass';
      formant.frequency.value = 1900 + excite * 600;
      formant.Q.value = 1.6;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 4200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.025);
      g.gain.setValueAtTime(vol, t + dur * 0.6);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(formant).connect(lp).connect(g).connect(this.master);
      o.start(t); vib.start(t);
      o.stop(t + dur + 0.02); vib.stop(t + dur + 0.02);
    };
    const t = ctx.currentTime;
    const pitch = 620 + excite * 380 + rand(-50, 50);
    const vol = 0.07 + excite * 0.22;
    one(t, pitch, rand(0.18, 0.3), vol);
    if (excite > 0.5 && Math.random() < excite * 0.8) one(t + rand(0.28, 0.36), pitch * rand(1.02, 1.12), rand(0.15, 0.24), vol * 0.85);
  }

  // Paw scratching dirt.
  dig() {
    if (!this.ctx) return;
    this.noiseHit(this.white, rand(0.07, 0.11), { type: 'bandpass', freq: rand(900, 1600), q: 0.7, vol: rand(0.12, 0.18), attack: 0.005, pan: rand(-0.15, 0.15) });
    this.noiseHit(this.brown, 0.09, { type: 'lowpass', freq: 400, q: 0.7, vol: 0.25, attack: 0.005 });
  }

  // Truffle found: the pig grunts excitedly over the chime.
  found() {
    if (!this.ctx) return;
    this.chime();
    this.playSample('excited', { offset: 0.2, duration: 1.55, fade: 0.03, vol: 0.9 });
  }

  // Happy rising bell arpeggio when a truffle is found.
  chime() {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime + 0.02;
    [1046.5, 1318.5, 1568.0, 2093.0, 2637.0].forEach((f, i) => {
      const t = t0 + i * 0.085;
      for (const [mult, v] of [[1, 0.16], [2.01, 0.05], [3.02, 0.02]]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * mult;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(v, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0005, t + 1.1);
        o.connect(g);
        g.connect(this.master);
        g.connect(this.reverb);
        o.start(t);
        o.stop(t + 1.15);
      }
    });
  }

  splash(intensity) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const { t } = this.noiseHit(this.white, 0.2, { type: 'bandpass', freq: rand(1100, 1700), q: 0.8, vol: 0.12 + intensity * 0.1, attack: 0.008, pan: rand(-0.2, 0.2) });
    // a little "bloop"
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(rand(350, 500), t);
    o.frequency.exponentialRampToValueAtTime(rand(900, 1300), t + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.01);
    g.gain.linearRampToValueAtTime(0, t + 0.09);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.1);
  }

  step(intensity) {
    if (!this.ctx) return;
    this.noiseHit(this.pink, 0.07, { type: 'lowpass', freq: rand(700, 1100), q: 0.7, vol: 0.05 + intensity * 0.05, attack: 0.005, pan: rand(-0.2, 0.2) });
  }
}
