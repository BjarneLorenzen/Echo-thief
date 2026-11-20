// Echo Thief – synthesized audio (no asset files). Adaptive music (see music.js) plus sound effects.
import { Music } from './music.js';

const PENTA = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('echoThief.muted') === '1'; } catch { /* storage unavailable */ }
    this.music = null;
    this.prefs = { genre: 'ambient', musicVol: 0.8, sfxVol: 0.9 };
    this.voices = () => [];
  }

  /** Apply user settings; safe to call before audio is unlocked. */
  configure({ genre, musicVol, sfxVol }) {
    if (genre !== undefined) this.prefs.genre = genre;
    if (musicVol !== undefined) this.prefs.musicVol = musicVol;
    if (sfxVol !== undefined) this.prefs.sfxVol = sfxVol;
    if (!this.ctx) return;
    this.music.setGenre(this.prefs.genre);
    this.music.setVolume(this.prefs.musicVol);
    this.sfx.gain.setTargetAtTime(this.prefs.sfxVol, this.ctx.currentTime, 0.05);
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
      this.sfx = ctx.createGain();
      this.sfx.gain.value = this.prefs.sfxVol;
      this.sfx.connect(this.master);

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
      tone.connect(wet).connect(this.sfx);
      this.fx.connect(this.sfx);

      this.music = new Music(ctx, this.master);
      this.music.voices = () => this.voices();
      this.configure({});

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

  // ---------- Music ----------
  /** Music mood per game phase: 'title' | 'play' | 'dying' | 'over' | 'preview'. */
  musicPhase(phase) {
    const m = this.music;
    if (!m) return;
    m.play();
    switch (phase) {
      case 'play': case 'preview': m.muffle(null, 0.2); m.setLevel(1, 0.5); break;
      case 'title': m.muffle(null, 0.3); m.setLevel(0.6, 0.8); break;
      case 'dying': m.muffle(260, 0.12); m.setLevel(0.7, 0.3); break;
      case 'over': m.muffle(1400, 0.6); m.setLevel(0.5, 0.8); break;
    }
  }

  /** Brief "underwater" filter dip, used while echoes are faded out. */
  musicDip(seconds) {
    const m = this.music;
    if (!m) return;
    m.muffle(900, 0.15);
    clearTimeout(this._dipTimer);
    this._dipTimer = setTimeout(() => m.muffle(null, 0.4), seconds * 1000);
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
    const base = this.music ? this.music.chimeFreq(n) : 523.25 * Math.pow(2, PENTA[n % PENTA.length] / 12);
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
    this._noise(t, 0.7, { from: 5000, to: 400, gain: 0.35, q: 0.8, dest: this.sfx });
    this._tone(110, t, 0.5, { type: 'sine', gain: 0.35, to: 38, dest: this.sfx });
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
