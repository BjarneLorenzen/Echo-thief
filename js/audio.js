// Echo Thief – synthesized audio (no asset files). Ambient pad, spawn chime, shatter, pickups.

const CHORDS = [
  [110.0, 164.81, 261.63, 329.63], // Am(add9-ish)
  [87.31, 130.81, 220.0, 329.63],  // Fmaj7
  [98.0, 146.83, 246.94, 293.66],  // G
  [82.41, 123.47, 196.0, 293.66],  // Em7
];
const PENTA = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('echoThief.muted') === '1'; } catch { /* storage unavailable */ }
    this.pad = null;
  }

  /** Must be called from a user gesture (iOS). Safe to call repeatedly. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(ctx.destination);

      // Shared echo-y delay for chimes and pickups.
      this.fx = ctx.createGain();
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.32;
      const fb = ctx.createGain();
      fb.gain.value = 0.38;
      const wet = ctx.createGain();
      wet.gain.value = 0.45;
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 2600;
      this.fx.connect(delay);
      delay.connect(tone).connect(fb).connect(delay);
      tone.connect(wet).connect(this.master);
      this.fx.connect(this.master);

      // Play a silent buffer to fully unlock iOS audio.
      const b = ctx.createBuffer(1, 1, 22050);
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('echoThief.muted', m ? '1' : '0'); } catch { /* ignore */ }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  // ---------- Ambient music ----------
  startMusic() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (!this.pad) {
      const out = ctx.createGain();
      out.gain.value = 0;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 700;
      lp.Q.value = 0.7;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.06;
      const lfoAmt = ctx.createGain();
      lfoAmt.gain.value = 320;
      lfo.connect(lfoAmt).connect(lp.frequency);
      lfo.start();
      lp.connect(out).connect(this.master);

      const voices = CHORDS[0].map((f, i) => {
        const g = ctx.createGain();
        g.gain.value = i === 0 ? 0.32 : 0.2;
        const a = ctx.createOscillator();
        const b = ctx.createOscillator();
        a.type = 'triangle';
        b.type = 'sine';
        a.frequency.value = f;
        b.frequency.value = f;
        a.detune.value = -7;
        b.detune.value = 6;
        a.connect(g);
        b.connect(g);
        g.connect(lp);
        a.start();
        b.start();
        return [a, b];
      });
      this.pad = { out, voices, chord: 0, timer: null };
    }
    const pad = this.pad;
    pad.out.gain.cancelScheduledValues(ctx.currentTime);
    pad.out.gain.setTargetAtTime(0.16, ctx.currentTime, 1.2);
    if (!pad.timer) {
      pad.timer = setInterval(() => {
        pad.chord = (pad.chord + 1) % CHORDS.length;
        const t = this.ctx.currentTime;
        CHORDS[pad.chord].forEach((f, i) => {
          for (const o of pad.voices[i]) o.frequency.setTargetAtTime(f, t, 1.4);
        });
      }, 8000);
    }
  }

  /** Lower the music (e.g. on title / game over) or silence it. */
  duckMusic(level = 0.06) {
    if (!this.ctx || !this.pad) return;
    this.pad.out.gain.setTargetAtTime(level, this.ctx.currentTime, 0.6);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }
  resume() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  // ---------- Effects ----------
  _tone(freq, t0, dur, { type = 'sine', gain = 0.2, to = null, dest = null, attack = 0.005 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(dest || this.fx);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  /** Soft chime when an echo appears; pitch climbs with the echo count. */
  chime(n = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.01;
    const base = 523.25 * Math.pow(2, PENTA[n % PENTA.length] / 12);
    this._tone(base, t, 1.4, { gain: 0.09 });
    this._tone(base * 2.01, t, 0.9, { gain: 0.035 });
    this._tone(base * 1.5, t + 0.07, 1.1, { gain: 0.04 });
  }

  /** Very quiet tick for the spawn warning. */
  warn() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.01;
    this._tone(330, t, 0.25, { gain: 0.03, type: 'sine' });
  }

  spark(combo = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.01;
    const f = 880 * Math.pow(2, PENTA[combo % 6] / 12);
    this._tone(f, t, 0.18, { gain: 0.07, type: 'triangle', to: f * 1.5 });
    this._tone(f * 2, t + 0.05, 0.25, { gain: 0.03 });
  }

  fade() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    this._noise(t, 0.9, { from: 400, to: 4000, gain: 0.12, q: 2 });
    this._tone(220, t, 0.9, { gain: 0.06, to: 880, attack: 0.2 });
  }

  shatter() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.005;
    this._noise(t, 0.7, { from: 5000, to: 400, gain: 0.35, q: 0.8, dest: this.master });
    this._tone(110, t, 0.5, { type: 'sine', gain: 0.35, to: 38, dest: this.master });
    for (let i = 0; i < 7; i++) {
      const f = 1400 + Math.random() * 2600;
      this._tone(f, t + i * 0.025 + Math.random() * 0.02, 0.25 + Math.random() * 0.3, {
        type: 'triangle', gain: 0.05, to: f * 0.7,
      });
    }
  }

  _noise(t0, dur, { from, to, gain, q, dest = null }) {
    const ctx = this.ctx;
    if (!this._noiseBuf) {
      const len = ctx.sampleRate * 1;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._noiseBuf = buf;
    }
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(from, t0);
    bp.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp).connect(g).connect(dest || this.fx);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }
}
