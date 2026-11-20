// Echo Thief – core simulation.
// Pure, deterministic game logic with no DOM access, so it can be unit-tested in Node.
// World units: the arena is always CFG.ARENA_W units wide; its height follows the screen aspect.

export const CFG = Object.freeze({
  ARENA_W: 100,
  DT: 1 / 120,            // fixed simulation step (s). Every step is recorded.
  WINDOW: 10,             // length of the recording each echo replays (s)
  INTERVAL: 10,           // time between echo spawns (s)
  FAST_INTERVAL: 8,       // spawn interval once FAST_AFTER echoes exist
  FAST_AFTER: 6,
  WARN: 1,                // spawn warning shown this long before an echo appears (s)
  INVULN: 1,              // invulnerability at the start of a run (s)
  SAFE_RADIUS: 14,        // echo won't activate while the player is this close to its spawn point
  LOOP_GRACE: 0.35,       // harmless "reforming" pause when an echo restarts its loop (s)

  PLAYER_R: 2.4,
  ECHO_R: 2.4,
  HIT_FACTOR: 0.8,        // collision radius multiplier (<1 = slightly forgiving)
  ACCEL: 150,             // units/s² at full tilt
  FRICTION: 2.0,          // exponential velocity damping per second
  MAX_SPEED: 44,          // units/s

  SPARK_BONUS: 2,         // score bonus per spark (in seconds)
  SPARK_LIFE: 9,
  SPARK_MAX: 3,
  FADE_DURATION: 3,
  FADE_LIFE: 8,
});

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A recorded path: interleaved x,y samples taken every `dt` seconds. */
export class Path {
  constructor(data, dt) {
    this.data = data;
    this.dt = dt;
    this.n = data.length / 2;
    this.duration = (this.n - 1) * dt;
  }
  /** Position at time t (clamped to the path), linearly interpolated between samples. */
  sample(t, out = { x: 0, y: 0 }) {
    const d = this.data;
    let f = t / this.dt;
    if (f <= 0) f = 0;
    else if (f >= this.n - 1) f = this.n - 1;
    const i = Math.floor(f);
    const j = i + 1 < this.n ? i + 1 : i;
    const u = f - i;
    out.x = d[2 * i] + (d[2 * j] - d[2 * i]) * u;
    out.y = d[2 * i + 1] + (d[2 * j + 1] - d[2 * i + 1]) * u;
    return out;
  }
}

/** Growable buffer of every recorded player position, one per simulation tick. */
export class Recorder {
  constructor(capacity = 4096) {
    this.data = new Float32Array(capacity * 2);
    this.n = 0;
  }
  push(x, y) {
    if (this.n * 2 >= this.data.length) {
      const bigger = new Float32Array(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    this.data[this.n * 2] = x;
    this.data[this.n * 2 + 1] = y;
    this.n++;
  }
  get(i, out = { x: 0, y: 0 }) {
    out.x = this.data[i * 2];
    out.y = this.data[i * 2 + 1];
    return out;
  }
  /** Copy of samples [from, to] inclusive. */
  slice(from, to) {
    return this.data.slice(from * 2, (to + 1) * 2);
  }
}

const GOLDEN = 137.508;

export class Echo {
  constructor(index, startTick, captureTick, start) {
    this.index = index;
    this.hue = (275 + index * GOLDEN) % 360;
    this.startTick = startTick;     // first recorded tick of the window this echo replays
    this.captureTick = captureTick; // tick at which the window is complete and the echo may appear
    this.start = { x: start.x, y: start.y };
    this.path = null;
    this.state = 'warning';         // 'warning' -> 'active' <-> 'reforming'
    this.delayed = false;           // true while held back by the fairness rule
    this.age = 0;                   // replay time within the loop (s)
    this.stateTime = 0;             // time spent in the current state (s)
    this.loops = 0;
    this.x = start.x;
    this.y = start.y;
  }
  get harmful() {
    return this.state === 'active';
  }
}

const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

export class Game {
  constructor({ width = CFG.ARENA_W, height = 160, seed = (Math.random() * 2 ** 32) >>> 0, sparks = true, fade = true } = {}) {
    this.W = width;
    this.H = height;
    this.rng = mulberry32(seed);
    this.features = { sparks, fade };

    this.tick = 0;
    this.time = 0;
    this.over = false;
    this.events = [];

    this.player = { x: width / 2, y: height / 2, vx: 0, vy: 0, r: CFG.PLAYER_R };
    this.rec = new Recorder(Math.ceil(120 / CFG.DT));
    this.rec.push(this.player.x, this.player.y);

    this.windowTicks = Math.round(CFG.WINDOW / CFG.DT);
    this.warnTicks = Math.round(CFG.WARN / CFG.DT);
    this.nextSpawnTick = Math.round(CFG.INTERVAL / CFG.DT);
    this.echoes = [];
    this.created = 0;     // echoes announced (warning shown)
    this.spawned = 0;     // echoes that became active

    this.sparks = [];
    this.powerups = [];
    this.sparksCollected = 0;
    this.fadeUntil = -1;
    this.nextSpark = 3 + this.rng() * 3;
    this.nextFade = 24 + this.rng() * 8;
    this.death = null;
  }

  get score() {
    return this.time + this.sparksCollected * CFG.SPARK_BONUS;
  }
  get fading() {
    return this.time < this.fadeUntil;
  }
  get invulnerable() {
    return this.time < CFG.INVULN;
  }
  get activeEchoes() {
    let n = 0;
    for (const e of this.echoes) if (e.state !== 'warning') n++;
    return n;
  }
  intervalAfter(count) {
    return count >= CFG.FAST_AFTER ? CFG.FAST_INTERVAL : CFG.INTERVAL;
  }

  /** Advance exactly one fixed step. input: { ax, ay } in [-1, 1]. */
  step(input) {
    if (this.over) return;
    const dt = CFG.DT;
    this._movePlayer(input, dt);
    this.tick++;
    this.time = this.tick * dt;
    this.rec.push(this.player.x, this.player.y);

    this._schedule();
    this._updateEchoes(dt);
    if (this.features.sparks || this.features.fade) this._updatePickups(dt);
    this._collide();
  }

  _movePlayer(input, dt) {
    const p = this.player;
    let ax = input ? input.ax || 0 : 0;
    let ay = input ? input.ay || 0 : 0;
    const m = Math.hypot(ax, ay);
    if (m > 1) { ax /= m; ay /= m; }

    p.vx += ax * CFG.ACCEL * dt;
    p.vy += ay * CFG.ACCEL * dt;
    const damp = Math.exp(-CFG.FRICTION * dt);
    p.vx *= damp;
    p.vy *= damp;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > CFG.MAX_SPEED) {
      p.vx *= CFG.MAX_SPEED / sp;
      p.vy *= CFG.MAX_SPEED / sp;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // Solid walls: clamp and kill only the velocity component into the wall, so the ghost slides.
    const r = p.r;
    if (p.x < r) { p.x = r; if (p.vx < 0) p.vx = 0; }
    else if (p.x > this.W - r) { p.x = this.W - r; if (p.vx > 0) p.vx = 0; }
    if (p.y < r) { p.y = r; if (p.vy < 0) p.vy = 0; }
    else if (p.y > this.H - r) { p.y = this.H - r; if (p.vy > 0) p.vy = 0; }
  }

  _schedule() {
    // Announce the next echo WARN seconds early. Its start point is already known:
    // it's where the player was WINDOW seconds before the spawn mark.
    if (this.tick === this.nextSpawnTick - this.warnTicks) {
      const startTick = this.nextSpawnTick - this.windowTicks;
      const e = new Echo(this.created, startTick, this.nextSpawnTick, this.rec.get(startTick));
      this.echoes.push(e);
      this.created++;
      this.events.push({ type: 'warn', echo: e });
    }
    if (this.tick === this.nextSpawnTick) {
      for (const e of this.echoes) {
        if (!e.path && e.captureTick === this.tick) {
          e.path = new Path(this.rec.slice(e.startTick, e.captureTick), CFG.DT);
        }
      }
      this.nextSpawnTick += Math.round(this.intervalAfter(this.created) / CFG.DT);
    }
  }

  _playerClear(pt, radius) {
    const p = this.player;
    return dist2(p.x, p.y, pt.x, pt.y) > radius * radius;
  }

  _updateEchoes(dt) {
    for (const e of this.echoes) {
      e.stateTime += dt;
      if (e.state === 'warning') {
        if (!e.path) continue;
        // Fairness rule: hold the echo (still harmless) until the player is away from its spawn point.
        if (this._playerClear(e.start, CFG.SAFE_RADIUS)) {
          e.state = 'active';
          e.delayed = false;
          e.age = 0;
          e.stateTime = 0;
          this.spawned++;
          this.events.push({ type: 'spawn', echo: e });
        } else {
          e.delayed = true;
        }
      } else if (e.state === 'active') {
        e.age += dt;
        if (e.age >= e.path.duration - 1e-9) {
          // Loop: reappear at the start of the recording after a brief harmless reform.
          e.age = 0;
          e.state = 'reforming';
          e.stateTime = 0;
          e.loops++;
        }
        e.path.sample(e.age, e);
      } else if (e.state === 'reforming') {
        e.x = e.start.x;
        e.y = e.start.y;
        if (e.stateTime >= CFG.LOOP_GRACE && this._playerClear(e.start, CFG.SAFE_RADIUS * 0.6)) {
          e.state = 'active';
          e.stateTime = 0;
          e.age = 0;
        }
      }
    }
  }

  _randomSpot(margin, minFromPlayer) {
    const p = this.player;
    let best = null;
    for (let i = 0; i < 24; i++) {
      const x = margin + this.rng() * (this.W - 2 * margin);
      const y = margin + this.rng() * (this.H - 2 * margin);
      best = { x, y };
      if (!this._playerClear(best, minFromPlayer)) continue;
      let ok = true;
      for (const e of this.echoes) {
        if (e.state === 'active' && dist2(x, y, e.x, e.y) < 64) { ok = false; break; }
      }
      if (ok) return best;
    }
    return best;
  }

  _updatePickups(dt) {
    const p = this.player;
    if (this.features.sparks) {
      if (this.time >= this.nextSpark) {
        this.nextSpark = this.time + 3.5 + this.rng() * 3.5;
        if (this.sparks.length < CFG.SPARK_MAX) {
          const s = this._randomSpot(6, 18);
          this.sparks.push({ x: s.x, y: s.y, life: CFG.SPARK_LIFE, age: 0 });
        }
      }
      for (let i = this.sparks.length - 1; i >= 0; i--) {
        const s = this.sparks[i];
        s.life -= dt;
        s.age += dt;
        if (dist2(p.x, p.y, s.x, s.y) < (p.r + 2.4) ** 2) {
          this.sparks.splice(i, 1);
          this.sparksCollected++;
          this.events.push({ type: 'spark', x: s.x, y: s.y });
        } else if (s.life <= 0) {
          this.sparks.splice(i, 1);
        }
      }
    }
    if (this.features.fade) {
      if (this.time >= this.nextFade) {
        if (this.spawned >= 2 && this.powerups.length === 0 && !this.fading) {
          const s = this._randomSpot(8, 22);
          this.powerups.push({ x: s.x, y: s.y, life: CFG.FADE_LIFE, age: 0 });
          this.nextFade = this.time + 22 + this.rng() * 10;
        } else {
          this.nextFade = this.time + 2;
        }
      }
      for (let i = this.powerups.length - 1; i >= 0; i--) {
        const f = this.powerups[i];
        f.life -= dt;
        f.age += dt;
        if (dist2(p.x, p.y, f.x, f.y) < (p.r + 2.8) ** 2) {
          this.powerups.splice(i, 1);
          this.fadeUntil = this.time + CFG.FADE_DURATION;
          this.events.push({ type: 'fade', x: f.x, y: f.y });
        } else if (f.life <= 0) {
          this.powerups.splice(i, 1);
        }
      }
    }
  }

  _collide() {
    if (this.invulnerable || this.fading) return;
    const p = this.player;
    const rr = (p.r + CFG.ECHO_R) * CFG.HIT_FACTOR;
    for (const e of this.echoes) {
      if (!e.harmful) continue;
      if (dist2(p.x, p.y, e.x, e.y) < rr * rr) {
        this.over = true;
        this.death = { x: p.x, y: p.y, echo: e };
        this.events.push({ type: 'death', x: p.x, y: p.y, echo: e });
        return;
      }
    }
  }
}
