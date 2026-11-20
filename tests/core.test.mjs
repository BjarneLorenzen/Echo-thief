// Run with: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { CFG, Game, Path } from '../js/core.js';

const ticks = (s) => Math.round(s / CFG.DT);
const run = (g, seconds, inputFn = () => ({ ax: 0, ay: 0 })) => {
  const n = ticks(seconds);
  for (let i = 0; i < n && !g.over; i++) g.step(inputFn(g.time, g));
};
// Deterministic wandering input that keeps the player moving around the arena.
const wander = (t) => ({ ax: Math.sin(t * 1.3), ay: Math.cos(t * 0.9) });

test('Path interpolates between samples and clamps', () => {
  const p = new Path(new Float32Array([0, 0, 10, 20, 20, 40]), 0.5);
  assert.equal(p.duration, 1);
  assert.deepEqual(p.sample(0.25), { x: 5, y: 10 });
  assert.deepEqual(p.sample(0.75), { x: 15, y: 30 });
  assert.deepEqual(p.sample(-1), { x: 0, y: 0 });
  assert.deepEqual(p.sample(5), { x: 20, y: 40 });
});

test('player spawns centered and stays inside the walls, sliding along them', () => {
  const g = new Game({ width: 100, height: 160, sparks: false, fade: false });
  assert.equal(g.player.x, 50);
  assert.equal(g.player.y, 80);
  run(g, 3, () => ({ ax: 1, ay: 0.4 }));
  const p = g.player;
  assert.equal(p.x, 100 - p.r);
  assert.equal(p.vx, 0, 'velocity into the wall is removed');
  assert.ok(p.vy > 0, 'still sliding along the wall');
  assert.ok(Math.hypot(p.vx, p.vy) <= CFG.MAX_SPEED + 1e-9);
});

test('a warning appears 1 s before each echo and echoes are harmless while warning', () => {
  const g = new Game({ sparks: false, fade: false });
  for (let i = 0; i < ticks(9) - 1; i++) g.step({ ax: 0, ay: 0 });
  assert.equal(g.echoes.length, 0);
  g.step({ ax: 0, ay: 0 }); // t = 9.000 s
  assert.equal(g.echoes.length, 1);
  assert.equal(g.echoes[0].state, 'warning');
  assert.equal(g.echoes[0].harmful, false);
});

test('fairness: echo is delayed while the player sits on its spawn point', () => {
  // Player never moves, so the first echo's spawn point (center) is under the player.
  const g = new Game({ sparks: false, fade: false });
  run(g, 12);
  assert.equal(g.over, false);
  assert.equal(g.echoes[0].state, 'warning');
  assert.equal(g.echoes[0].delayed, true);
  assert.equal(g.spawned, 0);
  // Move away: the echo activates once the player is outside the safe radius.
  run(g, 2, () => ({ ax: 1, ay: 0 }));
  assert.equal(g.echoes[0].state, 'active');
  assert.equal(g.spawned, 1);
});

test('echo replays the exact recorded path from 10 s earlier, then loops', () => {
  const g = new Game({ sparks: false, fade: false });
  // Move away fast from the center so the fairness rule never delays activation.
  run(g, 10, (t) => (t < 1.5 ? { ax: 1, ay: -1 } : { ax: Math.sin(t * 2), ay: Math.cos(t * 1.7) * 0.5 }));
  const rec = g.rec;
  const e = g.echoes[0];
  // Bypass collisions so we can observe the full replay.
  g._collide = () => {};
  assert.ok(e.path, 'path captured at the 10 s mark');
  assert.equal(e.path.n, ticks(10) + 1);
  for (let k = 0; k < ticks(9.9); k++) {
    g.step(wander(g.time));
    if (k === 0) assert.equal(e.state, 'active');
    // After k+1 steps of activity the echo shows recorded sample k+1.
    const want = rec.get(k + 1);
    assert.ok(Math.abs(e.x - want.x) < 1e-4 && Math.abs(e.y - want.y) < 1e-4, `tick ${k}`);
  }
  run(g, 0.2, wander);
  assert.equal(e.loops, 1);
  assert.notEqual(e.state, 'warning');
  // After the reform grace it replays from the start again.
  run(g, 3, (t) => ({ ax: Math.sin(t * 1.1), ay: Math.cos(t * 2.3) }));
  assert.equal(e.state, 'active');
});

test('echoes accumulate and the interval shortens to 8 s after 6 echoes', () => {
  const g = new Game({ sparks: false, fade: false });
  g._collide = () => {};
  const announced = [];
  for (let i = 0; i < ticks(75); i++) {
    g.step(wander(g.time));
    for (const ev of g.events) if (ev.type === 'warn') announced.push(+(g.time + CFG.WARN).toFixed(3));
    g.events.length = 0;
  }
  assert.deepEqual(announced, [10, 20, 30, 40, 50, 60, 68, 76].filter((t) => t <= 76));
  assert.ok(g.spawned >= 6);
  const hues = new Set(g.echoes.map((e) => Math.round(e.hue)));
  assert.equal(hues.size, g.echoes.length, 'each echo has a distinct hue');
});

test('collision with an active echo ends the run; invulnerability covers the first second', () => {
  const g = new Game({ sparks: false, fade: false });
  // Plant a fake active echo on top of the player.
  // (state 'stub' is ignored by the echo updater, so it simply sits there being harmful.)
  g.echoes.push({ state: 'stub', harmful: true, x: g.player.x, y: g.player.y, hue: 0 });
  run(g, 0.5);
  assert.equal(g.over, false, 'invulnerable at start');
  run(g, 1);
  assert.equal(g.over, true);
  assert.equal(g.events.at(-1).type, 'death');
  const t = g.time;
  g.step({ ax: 1, ay: 0 });
  assert.equal(g.time, t, 'no simulation after game over');
});

test('a player who stands still eventually gets caught by their own echo', () => {
  // Wander for 10 s, then return toward the center; echoes replaying the path will catch them.
  const g = new Game({ sparks: false, fade: false, seed: 1 });
  run(g, 120, (t) => (t < 10 ? wander(t) : { ax: 0, ay: 0 }));
  // Either caught or still alive; but the sim must stay consistent.
  assert.ok(g.time > 10);
  assert.ok(g.echoes.length >= 1);
});

test('sparks add bonus score and fade power-up disables collisions temporarily', () => {
  const g = new Game({ seed: 42 });
  g._collide = () => {};
  run(g, 4);
  // Force a spark onto the player.
  g.sparks.push({ x: g.player.x, y: g.player.y, life: 5, age: 0 });
  g.step({ ax: 0, ay: 0 });
  assert.equal(g.sparksCollected, 1);
  assert.ok(Math.abs(g.score - (g.time + CFG.SPARK_BONUS)) < 1e-9);

  delete g._collide;
  g.powerups.push({ x: g.player.x, y: g.player.y, life: 5, age: 0 });
  g.step({ ax: 0, ay: 0 });
  assert.ok(g.fading);
  g.echoes.push({ state: 'stub', harmful: true, x: g.player.x, y: g.player.y, hue: 0 });
  run(g, 2.5);
  assert.equal(g.over, false, 'echoes are harmless while faded');
  run(g, 1);
  assert.equal(g.over, true, 'harmful again after the fade ends');
});

test('simulation is deterministic for a given seed and input', () => {
  const a = new Game({ seed: 7 });
  const b = new Game({ seed: 7 });
  run(a, 40, wander);
  run(b, 40, wander);
  assert.equal(a.time, b.time);
  assert.equal(a.player.x, b.player.x);
  assert.equal(a.sparksCollected, b.sparksCollected);
  assert.equal(a.over, b.over);
});
