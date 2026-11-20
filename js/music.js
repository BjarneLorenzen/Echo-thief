// Echo Thief – adaptive music. A small step sequencer where every active echo adds one
// instrument layer. Melodic layers "sing" their echo's path: pitch follows the echo's height,
// stereo pan follows its horizontal position. Each genre has a base groove and a list of layers.

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];

// ---------------------------------------------------------------------------
// Synth presets. a/d/s/r = envelope; cutoff/fenv/q = lowpass with envelope;
// detune = two oscillators ± cents; harm = [ratio, level] extra sine partial; send = delay amount.
// ---------------------------------------------------------------------------
const SYNTHS = {
  softpad: { wave: 'triangle', detune: 9, a: 1.4, d: 1.5, s: 0.85, r: 2.4, cutoff: 1500, gain: 0.07, send: 0.45 },
  pad: { wave: 'sawtooth', detune: 12, a: 0.6, d: 1, s: 0.8, r: 1.4, cutoff: 1100, q: 0.6, gain: 0.045, send: 0.4 },
  sub: { wave: 'sine', a: 0.04, d: 0.6, s: 0.8, r: 0.5, gain: 0.2 },
  bell: { wave: 'sine', harm: [2.76, 0.35], a: 0.004, d: 1.4, s: 0, r: 1.2, gain: 0.11, send: 0.55 },
  glass: { wave: 'sine', harm: [4.07, 0.2], a: 0.003, d: 0.7, s: 0, r: 0.7, gain: 0.07, send: 0.6 },
  shimmer: { wave: 'sine', a: 0.03, d: 0.7, s: 0, r: 0.8, gain: 0.06, send: 0.7 },
  pluck: { wave: 'triangle', a: 0.003, d: 0.28, s: 0, r: 0.2, cutoff: 2600, fenv: 3, gain: 0.11, send: 0.3 },
  sawbass: { wave: 'sawtooth', a: 0.004, d: 0.18, s: 0.35, r: 0.08, cutoff: 420, fenv: 4, q: 5, gain: 0.12 },
  lead: { wave: 'square', detune: 7, a: 0.01, d: 0.25, s: 0.55, r: 0.25, cutoff: 2400, fenv: 2, gain: 0.05, send: 0.4 },
  synarp: { wave: 'sawtooth', a: 0.002, d: 0.12, s: 0, r: 0.08, cutoff: 3000, fenv: 2, gain: 0.04, send: 0.35 },
  ep: { wave: 'sine', harm: [2, 0.3], a: 0.006, d: 0.9, s: 0.25, r: 0.5, cutoff: 2200, gain: 0.1, send: 0.25 },
  lofibass: { wave: 'triangle', a: 0.01, d: 0.4, s: 0.5, r: 0.15, cutoff: 700, gain: 0.2 },
  chipsq: { wave: 'square', a: 0.001, d: 0.09, s: 0.45, r: 0.03, gain: 0.045 },
  chiplead: { wave: 'square', a: 0.002, d: 0.15, s: 0.6, r: 0.05, gain: 0.05, send: 0.25 },
  chiptri: { wave: 'triangle', a: 0.001, d: 0.1, s: 0.85, r: 0.02, gain: 0.16 },
  acid: { wave: 'sawtooth', a: 0.003, d: 0.14, s: 0.15, r: 0.05, cutoff: 320, fenv: 8, q: 13, gain: 0.07 },
  stab: { wave: 'sawtooth', detune: 11, a: 0.003, d: 0.16, s: 0, r: 0.12, cutoff: 1900, fenv: 2, gain: 0.04, send: 0.55 },
};

// ---------------------------------------------------------------------------
// Genres. Pattern chars: X = accent, x = hit, . = rest (16 steps per bar).
// notes: root | fifth | chord | arp | follow (pitch from the echo's height).
// ---------------------------------------------------------------------------
export const GENRES = {
  ambient: {
    name: 'Ambient', desc: 'Slow pads and bells drifting in the dark.',
    bpm: 70, root: 57, scale: MINOR, prog: [0, 5, 2, 6], penta: [0, 3, 5, 7, 10],
    base: [
      { synth: 'softpad', pattern: 'x...............', notes: 'chord', len: 16 },
      { synth: 'sub', pattern: 'x...............', notes: 'root', oct: -1, len: 16 },
    ],
    layers: [
      { synth: 'bell', pattern: 'x.......x.......', notes: 'follow', oct: 1 },
      { synth: 'pluck', pattern: 'x..x..x...x..x..', notes: 'arp' },
      { drum: 'kick', pattern: 'x.......x.......', gain: 0.55 },
      { synth: 'shimmer', pattern: '..x...x...x...x.', notes: 'follow', oct: 2 },
      { drum: 'shaker', pattern: '..x...x...x...x.', gain: 0.6 },
      { synth: 'glass', pattern: '...x.....x....x.', notes: 'follow', oct: 2 },
      { synth: 'pad', pattern: '........x.......', notes: 'chord', oct: 1, len: 8 },
      { synth: 'sub', pattern: 'x..x..x.x..x..x.', notes: 'root', oct: -1, len: 1 },
    ],
  },
  synthwave: {
    name: 'Synthwave', desc: 'Neon 80s drive: saw bass, gated drums, soaring leads.',
    bpm: 100, root: 52, scale: MINOR, prog: [0, 5, 3, 6], penta: [0, 3, 5, 7, 10],
    base: [
      { drum: 'kick', pattern: 'X...x...X...x...' },
      { synth: 'sawbass', pattern: 'x.x.x.x.x.x.x.x.', notes: 'root', oct: -1, octs: [0, 1] },
    ],
    layers: [
      { synth: 'lead', pattern: 'x..x..x...x.x...', notes: 'follow', oct: 1, len: 2 },
      { drum: 'snare', pattern: '....X.......X...' },
      { synth: 'synarp', pattern: 'xxxxxxxxxxxxxxxx', notes: 'arp', oct: 1 },
      { drum: 'hat', pattern: 'x.x.x.x.x.x.x.x.' },
      { synth: 'pad', pattern: 'x...............', notes: 'chord', len: 16 },
      { synth: 'bell', pattern: '......x.......x.', notes: 'follow', oct: 2 },
      { drum: 'tom', pattern: '............x.x.' },
      { synth: 'lead', pattern: '.x...x.....x..x.', notes: 'follow', oct: 2, len: 1 },
    ],
  },
  lofi: {
    name: 'Lo-fi', desc: 'Dusty, swung beats and mellow electric piano.',
    bpm: 76, swing: 0.22, gain: 1.5, root: 53, scale: MAJOR, prog: [1, 4, 0, 5], sevenths: true, penta: [0, 2, 4, 7, 9],
    base: [
      { synth: 'ep', pattern: 'x.........x.....', notes: 'chord', len: 6 },
      { drum: 'crackle', pattern: 'xxxxxxxxxxxxxxxx' },
    ],
    layers: [
      { drum: 'kick', pattern: 'x......x..x.....', gain: 0.8 },
      { synth: 'ep', pattern: 'x..x....x.x.....', notes: 'follow', oct: 1 },
      { drum: 'snare', pattern: '....x.......x...', gain: 0.7 },
      { synth: 'lofibass', pattern: 'x.....x.x.......', notes: 'root', oct: -1, len: 2 },
      { drum: 'hat', pattern: 'x.x.x.x.x.x.x.x.', gain: 0.6 },
      { synth: 'bell', pattern: '......x.......x.', notes: 'follow', oct: 2 },
      { drum: 'rim', pattern: '...x......x...x.' },
      { synth: 'pluck', pattern: '..x...x...x..x..', notes: 'follow', oct: 1 },
    ],
  },
  chiptune: {
    name: 'Chiptune', desc: 'Bleepy 8-bit arcade energy.',
    bpm: 140, root: 60, gain: 1.8, scale: MAJOR, prog: [0, 5, 3, 4], penta: [0, 2, 4, 7, 9],
    base: [
      { synth: 'chiptri', pattern: 'x.x.x.x.x.x.x.x.', notes: 'root', oct: -2, octs: [0, 1] },
    ],
    layers: [
      { synth: 'chiplead', pattern: 'x.x.x...x.x.x...', notes: 'follow', oct: 1 },
      { drum: 'chipkick', pattern: 'x.......x.......' },
      { synth: 'chipsq', pattern: 'xxxxxxxxxxxxxxxx', notes: 'arp' },
      { drum: 'chipsnare', pattern: '....x.......x...' },
      { drum: 'chiphat', pattern: 'x.x.x.x.x.x.x.x.' },
      { synth: 'chiplead', pattern: '.x.x...x.x.x....', notes: 'follow', oct: 2 },
      { synth: 'chipsq', pattern: 'x...x...x...x...', notes: 'fifth', oct: 0 },
      { synth: 'chipsq', pattern: '..x...x...x...x.', notes: 'follow', oct: 1 },
    ],
  },
  techno: {
    name: 'Techno', desc: 'Four-on-the-floor pulse with squelchy acid lines.',
    bpm: 124, root: 45, scale: PHRYGIAN, prog: [0, 0, 5, 1], penta: [0, 3, 5, 7, 10],
    base: [
      { drum: 'kick', pattern: 'X...X...X...X...' },
      { synth: 'sawbass', pattern: '..x...x...x...x.', notes: 'root', oct: -1 },
    ],
    layers: [
      { drum: 'openhat', pattern: '..x...x...x...x.' },
      { synth: 'acid', pattern: 'xx.x.xx.x.xxx.x.', notes: 'follow', oct: 0 },
      { drum: 'clap', pattern: '....x.......x...' },
      { drum: 'shaker', pattern: 'xxxxxxxxxxxxxxxx', gain: 0.8 },
      { synth: 'stab', pattern: '...x.....x......', notes: 'chord', oct: 1 },
      { drum: 'tom', pattern: '.......x......x.', gain: 0.7 },
      { synth: 'bell', pattern: 'x.......x.....x.', notes: 'follow', oct: 2 },
      { synth: 'acid', pattern: '.x..x..x.x..x...', notes: 'follow', oct: 1 },
    ],
  },
  off: {
    name: 'Off', desc: 'No music — just the sound effects.',
    bpm: 100, root: 57, scale: MINOR, prog: [0], penta: [0, 3, 5, 7, 10], base: [], layers: [],
  },
};
export const GENRE_IDS = Object.keys(GENRES);

// ---------------------------------------------------------------------------
// Drums
// ---------------------------------------------------------------------------
function env(g, t, peak, decay) {
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
}

const DRUMS = {
  kick(m, t, v, out) {
    const o = m.ctx.createOscillator();
    const g = m.ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    env(g, t, 0.75 * v, 0.38);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.42);
  },
  snare(m, t, v, out) {
    m.noise(t, 0.18, out, { type: 'bandpass', freq: 1800, q: 0.8, gain: 0.32 * v });
    m.blip(t, 190, 0.09, out, 'triangle', 0.2 * v);
  },
  clap(m, t, v, out) {
    const g = m.ctx.createGain();
    for (const dt of [0, 0.011, 0.023]) m.noise(t + dt, 0.012, g, { type: 'bandpass', freq: 1100, q: 1.3, gain: 0.35 * v, hard: true });
    m.noise(t + 0.03, 0.17, g, { type: 'bandpass', freq: 1100, q: 1.3, gain: 0.3 * v });
    g.connect(out);
  },
  hat(m, t, v, out) { m.noise(t, 0.04, out, { type: 'highpass', freq: 7500, gain: 0.13 * v }); },
  openhat(m, t, v, out) { m.noise(t, 0.22, out, { type: 'highpass', freq: 7000, gain: 0.09 * v }); },
  shaker(m, t, v, out) { m.noise(t, 0.05, out, { type: 'bandpass', freq: 6500, q: 1.2, gain: 0.09 * v }); },
  rim(m, t, v, out) { m.blip(t, 1700, 0.03, out, 'triangle', 0.13 * v); },
  tom(m, t, v, out) {
    const o = m.ctx.createOscillator();
    const g = m.ctx.createGain();
    o.frequency.setValueAtTime(210, t);
    o.frequency.exponentialRampToValueAtTime(95, t + 0.25);
    env(g, t, 0.35 * v, 0.3);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.32);
  },
  crackle(m, t, v, out) {
    const n = Math.random() < 0.5 ? 1 : Math.random() < 0.3 ? 2 : 0;
    for (let i = 0; i < n; i++) {
      m.noise(t + Math.random() * 0.15, 0.004, out, { type: 'highpass', freq: 2500, gain: (0.02 + Math.random() * 0.05) * v, hard: true });
    }
  },
  chipkick(m, t, v, out) {
    const o = m.ctx.createOscillator();
    const g = m.ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(35, t + 0.08);
    env(g, t, 0.14 * v, 0.11);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.13);
  },
  chipsnare(m, t, v, out) { m.noise(t, 0.11, out, { type: 'lowpass', freq: 5000, gain: 0.18 * v }); },
  chiphat(m, t, v, out) { m.noise(t, 0.025, out, { type: 'highpass', freq: 9000, gain: 0.08 * v }); },
};

// ---------------------------------------------------------------------------
// Sequencer
// ---------------------------------------------------------------------------
export class Music {
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.bus = ctx.createGain();       // per-genre loudness trim
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 18000;
    this.filter.Q.value = 0.8;
    this.level = ctx.createGain();      // game-state level (title / playing / game over)
    this.level.gain.value = 0;
    this.volume = ctx.createGain();     // user setting
    this.bus.connect(this.filter).connect(this.level).connect(this.volume).connect(dest);

    // Tempo-synced delay for a sense of space.
    this.send = ctx.createGain();
    this.delay = ctx.createDelay(2);
    const fb = ctx.createGain();
    fb.gain.value = 0.33;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2400;
    this.send.connect(this.delay);
    this.delay.connect(tone).connect(fb).connect(this.delay);
    tone.connect(this.filter);

    this.stereo = typeof ctx.createStereoPanner === 'function';
    this.genre = GENRES.ambient;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.arpCount = new Map();
    /** Returns the active echo voices: [{ id, x, y, mute }], x/y normalised to 0..1. */
    this.voices = () => [];
    this.setGenre('ambient');
  }

  setGenre(id) {
    this.genre = GENRES[id] || GENRES.ambient;
    this.genreId = GENRES[id] ? id : 'ambient';
    this.delay.delayTime.setValueAtTime((60 / this.genre.bpm) * 0.75, this.ctx.currentTime);
    this.bus.gain.setTargetAtTime(this.genre.gain || 1, this.ctx.currentTime, 0.05);
  }

  setVolume(v) {
    this.volume.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Fade the overall music level (0..1). */
  setLevel(v, time = 0.4) {
    this.level.gain.cancelScheduledValues(this.ctx.currentTime);
    this.level.gain.setTargetAtTime(v, this.ctx.currentTime, time);
  }

  /** Low-pass the whole mix (e.g. "underwater" on death); pass null to open it again. */
  muffle(cutoff, time = 0.3) {
    this.filter.frequency.cancelScheduledValues(this.ctx.currentTime);
    this.filter.frequency.setTargetAtTime(cutoff || 18000, this.ctx.currentTime, time);
  }

  play() {
    if (this.timer) return;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.step = 0;
    this.timer = setInterval(() => this._tick(), 25);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  /** A frequency from the genre's pentatonic scale, for in-key sound effects. */
  chimeFreq(n) {
    const p = this.genre.penta;
    return mtof(this.genre.root + 24 + p[n % p.length] + 12 * Math.floor((n % (p.length * 2)) / p.length));
  }

  get stepDur() {
    return 60 / this.genre.bpm / 4;
  }

  _tick() {
    const now = this.ctx.currentTime;
    if (this.nextTime < now - 0.2) this.nextTime = now + 0.05; // recover after a suspend / hiccup
    while (this.nextTime < now + 0.12) {
      this._scheduleStep(this.step, this.nextTime);
      this.nextTime += this.stepDur;
      this.step++;
    }
  }

  _scheduleStep(step, t) {
    const g = this.genre;
    if (step % 2 === 1 && g.swing) t += this.stepDur * g.swing;
    const s16 = step % 16;
    const bar = Math.floor(step / 16);
    g.base.forEach((L, i) => this._layer(L, s16, bar, t, null, 'b' + i, 0));
    if (!g.layers.length) return;
    let voices;
    try { voices = this.voices() || []; } catch { voices = []; }
    for (const v of voices) {
      if (v.mute) continue;
      const n = g.layers.length;
      // Echoes beyond the layer count reuse layers, shifted and an octave up for variety.
      this._layer(g.layers[v.id % n], s16, bar, t, v, 'v' + v.id, Math.floor(v.id / n));
    }
  }

  _layer(L, s16, bar, t, voice, key, extra) {
    const ch = L.pattern[(s16 + 16 - ((extra * 2) % 16)) % 16];
    if (ch === '.' || ch === undefined) return;
    let vel = (ch === 'X' ? 1 : 0.75) * (0.9 + Math.random() * 0.2) * (L.gain ?? 1);
    // Echo layers sit a little forward of the base groove so each new echo is clearly heard.
    vel *= voice ? (extra ? 0.9 : 1.3) : 0.85;
    const out = this._output(voice ? clamp((voice.x * 2 - 1) * 0.8, -0.9, 0.9) : 0, L.synth ? SYNTHS[L.synth].send : 0);
    if (L.drum) {
      DRUMS[L.drum](this, t, vel, out);
      return;
    }
    const preset = SYNTHS[L.synth];
    const dur = (L.len || 1) * this.stepDur;
    for (const m of this._notes(L, bar, s16, voice, key, extra)) this._synth(t, m, dur, preset, vel, out);
  }

  _deg(d, oct) {
    const sc = this.genre.scale;
    const n = sc.length;
    const o = Math.floor(d / n);
    return this.genre.root + 12 * (oct + o) + sc[((d % n) + n) % n];
  }

  _notes(L, bar, s16, voice, key, extra) {
    const g = this.genre;
    const c = g.prog[bar % g.prog.length];
    const tones = g.sevenths ? [c, c + 2, c + 4, c + 6] : [c, c + 2, c + 4];
    const oct = (L.oct || 0) + Math.min(extra, 1);
    switch (L.notes) {
      case 'root': {
        const n = this._count(key);
        const shift = L.octs ? L.octs[n % L.octs.length] : 0;
        return [this._deg(c, oct + shift)];
      }
      case 'fifth':
        return [this._deg(c + 4, oct)];
      case 'chord':
        return tones.map((d) => this._deg(d, oct));
      case 'arp':
        return [this._deg(tones[this._count(key) % tones.length], oct)];
      case 'follow': {
        // Higher on screen = higher pitch. Snap to chord tones on the beat so it stays musical.
        const y = voice ? voice.y : 0.5 + 0.4 * Math.sin(bar + s16 / 3);
        let d = Math.round((1 - clamp(y, 0, 1)) * 9);
        if (s16 % 4 === 0) {
          let best = d, bestDist = 99;
          for (const tdeg of tones) for (const k of [-7, 0, 7]) {
            const cand = tdeg + k;
            if (Math.abs(cand - d) < bestDist) { bestDist = Math.abs(cand - d); best = cand; }
          }
          d = best;
        }
        return [this._deg(d, oct)];
      }
      default:
        return [this._deg(c, oct)];
    }
  }

  _count(key) {
    const n = this.arpCount.get(key) || 0;
    this.arpCount.set(key, n + 1);
    return n;
  }

  /** Per-note output: optional stereo pan + delay send, into the music bus. */
  _output(pan, send) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    if (this.stereo && pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(this.bus);
    } else {
      g.connect(this.bus);
    }
    if (send) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s).connect(this.send);
    }
    return g;
  }

  _synth(t, midi, dur, S, vel, out) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const g = ctx.createGain();
    let target = g;
    const end = t + Math.max(dur, S.a + 0.01);
    const stopAt = end + S.r + 0.1;
    if (S.cutoff) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = S.q || 0.7;
      lp.frequency.setValueAtTime(S.cutoff * (S.fenv || 1), t);
      lp.frequency.setTargetAtTime(S.cutoff, t + S.a, S.d / 3);
      lp.connect(g);
      target = lp;
    }
    const detunes = S.detune ? [-S.detune, S.detune] : [0];
    for (const dc of detunes) {
      const o = ctx.createOscillator();
      o.type = S.wave;
      o.frequency.value = f;
      o.detune.value = dc;
      o.connect(target);
      o.start(t);
      o.stop(stopAt);
    }
    if (S.harm) {
      const o = ctx.createOscillator();
      const hg = ctx.createGain();
      o.frequency.value = f * S.harm[0];
      hg.gain.setValueAtTime(S.harm[1], t);
      hg.gain.exponentialRampToValueAtTime(0.001, t + S.d);
      o.connect(hg).connect(target);
      o.start(t);
      o.stop(stopAt);
    }
    const peak = S.gain * vel / detunes.length ** 0.5;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + S.a);
    g.gain.setTargetAtTime(peak * S.s + 0.0001, t + S.a, S.d / 3);
    g.gain.setTargetAtTime(0.0001, end, S.r / 3);
    g.connect(out);
  }

  // Helpers used by the drum kit.
  noise(t, dur, out, { type, freq, q = 0.7, gain, hard = false }) {
    const ctx = this.ctx;
    if (!this._noiseBuf) {
      const len = ctx.sampleRate;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._noiseBuf = buf;
    }
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    if (hard) {
      g.gain.setValueAtTime(gain, t);
      g.gain.setValueAtTime(0, t + dur);
    } else {
      env(g, t, gain, dur);
    }
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  blip(t, freq, dur, out, type, gain) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    env(g, t, gain, dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
}
