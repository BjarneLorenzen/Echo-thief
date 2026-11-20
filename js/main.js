// Echo Thief – rendering, input, screens and the main loop.
import { CFG, Game } from './core.js';
import { Sound } from './audio.js';
import { GENRES, GENRE_IDS } from './music.js';
import { LANGS, LANG_IDS, setLang, t, fmt1, applyDom } from './i18n.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d', { alpha: false });
const frameEl = $('frame');
const sound = new Sound();

const ui = {
  hud: $('hud'), hudTime: $('hud-time'), hudEchoes: $('hud-echoes'),
  title: $('title'), pause: $('pause'), over: $('gameover'),
  start: $('btn-start'), resume: $('btn-resume'), quit: $('btn-quit'),
  retry: $('btn-retry'), menu: $('btn-menu'), pauseBtn: $('btn-pause'), recenter: $('btn-recenter'), mute: $('btn-mute'),
  titleBest: $('title-best'), hint: $('control-hint'), permNote: $('perm-note'),
  goTime: $('go-time'), goEchoes: $('go-echoes'), goSparks: $('go-sparks'),
  goScore: $('go-score'), goBest: $('go-best'), goNewBest: $('go-newbest'),
  haptic: $('haptic'),
  settings: $('settings'), settingsBtn: $('btn-settings'), pauseSettings: $('btn-pause-settings'),
  settingsDone: $('btn-settings-done'), genreList: $('genre-list'), genreDesc: $('genre-desc'),
  previewDots: $('preview-dots'), volMusic: $('vol-music'), volSfx: $('vol-sfx'), lang: $('lang-select'),
};

const PLAYER_HUE = 186;
const ECHO_HUE = (i) => (275 + i * 137.508) % 360; // same hue sequence as core.js echoes
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
const BEST_KEY = 'echoThief.best';
function loadBest() {
  try { return parseFloat(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; }
}
function saveBest(v) {
  try { localStorage.setItem(BEST_KEY, v.toFixed(2)); } catch { /* private mode etc. */ }
}
let best = loadBest();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let state = 'title'; // title | playing | paused | dying | over
let game = null;
let dyingT = 0;
let shake = 0;
let flash = { t: 0, hue: 0 };
let clock = 0;
const particles = [];
const floaters = [];
const trail = [];
let sparkCombo = 0;
let lastSparkTime = -10;
let renderAlpha = 1;
let hudTimeText = '';
let hudEchoText = '';

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
let dpr = 1;
let arena = { left: 0, top: 0, width: 1, height: 1 };
const view = { ox: 0, oy: 0, s: 1 };
let worldW = CFG.ARENA_W;
let worldH = 160;
const bg = document.createElement('canvas');

function arenaAspectHeight() {
  return (CFG.ARENA_W * arena.height) / arena.width;
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const r = frameEl.getBoundingClientRect();
  if (r.width > 10 && r.height > 10) arena = { left: r.left, top: r.top, width: r.width, height: r.height };
  if (!game) worldH = arenaAspectHeight();
  computeView();
  buildBackground();
}

function computeView() {
  const s = Math.min(arena.width / worldW, arena.height / worldH);
  view.s = s;
  view.ox = arena.left + (arena.width - worldW * s) / 2;
  view.oy = arena.top + (arena.height - worldH * s) / 2;
}

function buildBackground() {
  bg.width = canvas.width;
  bg.height = canvas.height;
  const b = bg.getContext('2d');
  b.fillStyle = '#05060d';
  b.fillRect(0, 0, bg.width, bg.height);

  // Soft nebula blobs.
  const blobs = [
    [0.2, 0.25, 0.7, 'rgba(90, 40, 160, 0.16)'],
    [0.85, 0.7, 0.8, 'rgba(20, 110, 150, 0.14)'],
    [0.5, 1.0, 0.6, 'rgba(160, 40, 120, 0.08)'],
  ];
  for (const [fx, fy, fr, col] of blobs) {
    const cx = fx * bg.width, cy = fy * bg.height, rr = fr * Math.max(bg.width, bg.height);
    const g = b.createRadialGradient(cx, cy, 0, cx, cy, rr);
    g.addColorStop(0, col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    b.fillStyle = g;
    b.fillRect(0, 0, bg.width, bg.height);
  }

  const x = view.ox * dpr, y = view.oy * dpr, w = worldW * view.s * dpr, h = worldH * view.s * dpr;
  b.fillStyle = 'rgba(8, 12, 26, 0.75)';
  b.fillRect(x, y, w, h);

  // Grid.
  b.save();
  b.beginPath();
  b.rect(x, y, w, h);
  b.clip();
  b.strokeStyle = 'rgba(111, 243, 255, 0.05)';
  b.lineWidth = 1;
  const step = 10 * view.s * dpr;
  for (let gx = x + step; gx < x + w - 1; gx += step) { b.beginPath(); b.moveTo(gx, y); b.lineTo(gx, y + h); b.stroke(); }
  for (let gy = y + step; gy < y + h - 1; gy += step) { b.beginPath(); b.moveTo(x, gy); b.lineTo(x + w, gy); b.stroke(); }
  b.restore();

  // Neon walls.
  b.save();
  b.strokeStyle = 'rgba(111, 243, 255, 0.55)';
  b.shadowColor = 'rgba(111, 243, 255, 0.9)';
  b.lineWidth = 1.5 * dpr;
  for (const blur of [18, 6]) {
    b.shadowBlur = blur * dpr;
    b.beginPath();
    if (b.roundRect) b.roundRect(x, y, w, h, 4 * dpr); else b.rect(x, y, w, h);
    b.stroke();
  }
  b.restore();
}

// ---------------------------------------------------------------------------
// Sprites (pre-rendered glows are much cheaper than shadowBlur per frame)
// ---------------------------------------------------------------------------
const glowCache = new Map();
function glowSprite(hue, sat = 100, light = 65) {
  const key = `${Math.round(hue)}|${sat}|${light}`;
  let c = glowCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `hsla(${hue}, ${sat}%, ${light}%, 1)`);
  grad.addColorStop(0.22, `hsla(${hue}, ${sat}%, ${light}%, 0.45)`);
  grad.addColorStop(0.55, `hsla(${hue}, ${sat}%, ${light}%, 0.1)`);
  grad.addColorStop(1, `hsla(${hue}, ${sat}%, ${light}%, 0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowCache.set(key, c);
  return c;
}
function drawGlow(sprite, x, y, R, a) {
  if (a <= 0.003) return;
  ctx.globalAlpha = Math.min(1, a);
  ctx.drawImage(sprite, x - R, y - R, R * 2, R * 2);
}

// ---------------------------------------------------------------------------
// Input: tilt (primary), drag joystick and keyboard (fallbacks)
// ---------------------------------------------------------------------------
const input = { ax: 0, ay: 0 };
const tilt = { beta: null, gamma: null, b0: 0, g0: 0, sx: 0, sy: 0, enabled: false };
const TILT_RANGE = 20; // degrees for full acceleration
const TILT_DEAD = 1.5;
let motionStatus = 'unknown'; // unknown | granted | denied | unsupported

window.addEventListener('deviceorientation', (e) => {
  if (e.beta == null || e.gamma == null) return;
  tilt.beta = e.beta;
  tilt.gamma = e.gamma;
});

function requestMotionPermission() {
  // Must be invoked synchronously inside the user's tap on iOS.
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) return Promise.resolve('unsupported');
  if (typeof DOE.requestPermission === 'function') {
    return DOE.requestPermission()
      .then((r) => (r === 'granted' ? 'granted' : 'denied'))
      .catch(() => 'denied');
  }
  return Promise.resolve('granted');
}

function waitForTilt(ms) {
  return new Promise((resolve) => {
    if (tilt.beta != null) return resolve(true);
    const t0 = performance.now();
    const poll = () => {
      if (tilt.beta != null) resolve(true);
      else if (performance.now() - t0 > ms) resolve(false);
      else setTimeout(poll, 30);
    };
    poll();
  });
}

function calibrate() {
  if (tilt.beta == null) return;
  tilt.b0 = tilt.beta;
  tilt.g0 = tilt.gamma;
  tilt.sx = tilt.sy = 0;
}

/** HUD button: make the phone's current angle the new "still" position. */
function recenterTilt() {
  calibrate();
  if (game && state === 'playing') {
    const p = game.player;
    floaters.push({ x: p.x, y: p.y - 5, text: t('tiltReset'), life: 1, hue: PLAYER_HUE });
    burst(p.x, p.y, PLAYER_HUE, 10, 14, 0.4);
  }
  ui.recenter.animate?.([{ transform: 'rotate(0deg) scale(1.2)' }, { transform: 'rotate(180deg) scale(1)' }], { duration: 350 });
  haptic(15);
}

function tiltAxis(deg) {
  const a = Math.abs(deg);
  if (a < TILT_DEAD) return 0;
  return Math.sign(deg) * Math.min(1, (a - TILT_DEAD) / (TILT_RANGE - TILT_DEAD));
}

const stick = { id: null, x0: 0, y0: 0, x: 0, y: 0 };
const STICK_R = 56;
canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'playing' || stick.id !== null) return;
  stick.id = e.pointerId;
  stick.x0 = stick.x = e.clientX;
  stick.y0 = stick.y = e.clientY;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== stick.id) return;
  stick.x = e.clientX;
  stick.y = e.clientY;
  // Floating joystick: drag the origin along when the finger goes past the rim.
  const dx = stick.x - stick.x0, dy = stick.y - stick.y0;
  const d = Math.hypot(dx, dy);
  if (d > STICK_R) {
    stick.x0 = stick.x - (dx / d) * STICK_R;
    stick.y0 = stick.y - (dy / d) * STICK_R;
  }
});
const endStick = (e) => { if (e.pointerId === stick.id) stick.id = null; };
canvas.addEventListener('pointerup', endStick);
canvas.addEventListener('pointercancel', endStick);
document.addEventListener('touchmove', (e) => {
  if (!(e.target instanceof Element && e.target.closest('input[type=range], #settings'))) e.preventDefault();
}, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());

const keys = new Set();
const KEYMAP = {
  ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r',
  ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd',
};
window.addEventListener('keydown', (e) => {
  if (KEYMAP[e.code]) { keys.add(KEYMAP[e.code]); e.preventDefault(); }
  if (e.code === 'KeyC' && state === 'playing') recenterTilt();
  if (settingsFrom) {
    if (e.code === 'Escape') closeSettings();
    return;
  }
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (state === 'playing') pauseGame();
    else if (state === 'paused') resumeGame();
  }
  if ((e.code === 'Enter' || e.code === 'Space') && !e.repeat &&
      (state === 'title' || (state === 'over' && !ui.retry.disabled))) {
    e.preventDefault();
    onStart();
  }
});
window.addEventListener('keyup', (e) => { if (KEYMAP[e.code]) keys.delete(KEYMAP[e.code]); });

function updateInput(dt) {
  if (stick.id !== null) {
    input.ax = clamp((stick.x - stick.x0) / STICK_R, -1, 1);
    input.ay = clamp((stick.y - stick.y0) / STICK_R, -1, 1);
    return;
  }
  if (keys.size) {
    input.ax = (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0);
    input.ay = (keys.has('d') ? 1 : 0) - (keys.has('u') ? 1 : 0);
    return;
  }
  if (tilt.enabled && tilt.beta != null) {
    // Portrait: gamma = left/right tilt, beta = toward/away. Tilting the top away rolls the ghost up.
    const tx = tiltAxis(tilt.gamma - tilt.g0);
    const ty = tiltAxis(tilt.beta - tilt.b0);
    const k = 1 - Math.exp(-dt * 25); // light smoothing of sensor jitter
    tilt.sx += (tx - tilt.sx) * k;
    tilt.sy += (ty - tilt.sy) * k;
    input.ax = tilt.sx;
    input.ay = tilt.sy;
    return;
  }
  input.ax = input.ay = 0;
}

// ---------------------------------------------------------------------------
// Haptics
// ---------------------------------------------------------------------------
function haptic(pattern = 40) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* ignore */ }
  try { ui.haptic.click(); } catch { /* ignore */ } // iOS 18+ switch trick
}

// ---------------------------------------------------------------------------
// Screens / flow
// ---------------------------------------------------------------------------
function show(el, on) { el.classList.toggle('hidden', !on); }
const fmt = fmt1; // one decimal, in the current language's number format

function refreshTitle() {
  ui.titleBest.textContent = best > 0 ? fmt(best) : '–';
  const fine = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
  ui.hint.innerHTML = t(fine && !('ontouchstart' in window) ? 'hintDesktop' : 'hintTilt');
  ui.permNote.textContent = t('permDenied');
  ui.mute.innerHTML = sound.muted
    ? '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>'
    : '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
}

let starting = false;
async function onStart() {
  if (starting) return;
  starting = true;
  sound.unlock();
  const permission = motionStatus === 'unknown' ? requestMotionPermission() : Promise.resolve(motionStatus);
  ui.start.disabled = ui.retry.disabled = true;
  motionStatus = await permission;
  const gotTilt = motionStatus === 'granted' ? await waitForTilt(600) : false;
  tilt.enabled = gotTilt;
  if (motionStatus === 'denied') {
    show(ui.permNote, true);
  }
  ui.start.disabled = ui.retry.disabled = false;
  starting = false;
  beginRun();
}

function beginRun() {
  resize();
  worldH = arenaAspectHeight();
  game = new Game({ width: CFG.ARENA_W, height: worldH });
  computeView();
  buildBackground();
  calibrate();
  show(ui.recenter, tilt.enabled);
  particles.length = floaters.length = trail.length = 0;
  sparkCombo = 0;
  lastSparkTime = -10;
  shake = 0;
  stick.id = null;
  acc = 0;
  state = 'playing';
  show(ui.title, false);
  show(ui.over, false);
  show(ui.pause, false);
  show(ui.hud, true);
  sound.musicPhase('play');
  burst(game.player.x, game.player.y, PLAYER_HUE, 24, 26, 0.7);
}

function pauseGame() {
  if (state !== 'playing') return;
  state = 'paused';
  stick.id = null;
  show(ui.pause, true);
  sound.suspend();
}

function resumeGame() {
  if (state !== 'paused') return;
  sound.unlock();
  calibrate();
  state = 'playing';
  acc = 0;
  show(ui.pause, false);
}

function toMenu() {
  state = 'title';
  game = null;
  worldH = arenaAspectHeight();
  computeView();
  buildBackground();
  particles.length = 0;
  show(ui.pause, false);
  show(ui.over, false);
  show(ui.hud, false);
  show(ui.title, true);
  refreshTitle();
  sound.resume();
  sound.musicPhase('title');
}

function showGameOver() {
  state = 'over';
  const score = game.score;
  const newBest = score > best + 1e-6;
  if (newBest) { best = score; saveBest(best); }
  ui.goTime.textContent = fmt(game.time) + t('unit');
  ui.goEchoes.textContent = String(game.spawned);
  ui.goSparks.textContent = String(game.sparksCollected);
  ui.goScore.textContent = fmt(score);
  ui.goBest.textContent = fmt(best);
  show(ui.goNewBest, newBest);
  show(ui.hud, false);
  show(ui.over, true);
  // Avoid an accidental instant retry from a tap that was mid-flight.
  ui.retry.disabled = ui.menu.disabled = true;
  setTimeout(() => { ui.retry.disabled = ui.menu.disabled = false; }, 600);
  sound.musicPhase('over');
}

ui.start.addEventListener('click', onStart);
ui.retry.addEventListener('click', onStart);
ui.menu.addEventListener('click', toMenu);
ui.quit.addEventListener('click', toMenu);
ui.pauseBtn.addEventListener('click', pauseGame);
ui.recenter.addEventListener('click', recenterTilt);
ui.resume.addEventListener('click', resumeGame);
ui.mute.addEventListener('click', () => {
  sound.unlock();
  sound.setMuted(!sound.muted);
  refreshTitle();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (state === 'playing') pauseGame();
    sound.suspend();
  } else if (state !== 'paused' || settingsFrom) {
    sound.resume();
  }
});
window.addEventListener('pagehide', () => { if (state === 'playing') pauseGame(); });
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 250));

// ---------------------------------------------------------------------------
// Settings: music style + volumes (persisted)
// ---------------------------------------------------------------------------
const SETTINGS_KEY = 'echoThief.settings';
const settings = { genre: 'ambient', musicVol: 0.8, sfxVol: 0.9, lang: 'auto' };
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch { /* ignore */ }
if (!GENRES[settings.genre]) settings.genre = 'ambient';
if (settings.lang !== 'auto' && !LANGS[settings.lang]) settings.lang = 'auto';
sound.configure(settings);

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}

let settingsFrom = null; // 'title' | 'pause' while the settings screen is open
let previewStart = 0;
const PREVIEW_MAX = 8;
const PREVIEW_STEP = 2.6; // seconds between preview echoes joining in

/** Number of demo echoes in the preview; builds up, then starts over. */
function previewCount() {
  // 0, 1, … PREVIEW_MAX, hold for a few beats, then start over.
  const k = Math.floor((clock - previewStart) / PREVIEW_STEP) % (PREVIEW_MAX + 3);
  return Math.min(PREVIEW_MAX, k);
}

/** What the music engine hears: one voice per echo on the field (or demo ghosts in the preview). */
function musicVoices() {
  if (settingsFrom) {
    const n = previewCount();
    const out = [];
    const p = { x: 0, y: 0 };
    for (let i = 0; i < n; i++) {
      attractPos(i, clock, p);
      out.push({ id: i, x: p.x / worldW, y: p.y / worldH });
    }
    return out;
  }
  if (!game || state !== 'playing') return [];
  const out = [];
  for (const e of game.echoes) {
    if (e.state === 'warning') continue;
    out.push({ id: e.index, x: e.x / game.W, y: e.y / game.H, mute: e.state !== 'active' || game.fading });
  }
  return out;
}
sound.voices = musicVoices;

function buildSettingsUI() {
  ui.genreList.innerHTML = '';
  for (const id of GENRE_IDS) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.dataset.genre = id;
    b.addEventListener('click', () => {
      settings.genre = id;
      sound.configure({ genre: id });
      previewStart = clock; // restart the build-up so the new style can be heard from scratch
      saveSettings();
      refreshSettingsUI();
    });
    ui.genreList.appendChild(b);
  }
  ui.previewDots.innerHTML = '';
  for (let i = 0; i < PREVIEW_MAX; i++) {
    const d = document.createElement('i');
    d.style.color = `hsl(${ECHO_HUE(i)}, 95%, 68%)`;
    ui.previewDots.appendChild(d);
  }
  ui.volMusic.addEventListener('input', () => {
    settings.musicVol = ui.volMusic.value / 100;
    sound.configure({ musicVol: settings.musicVol });
  });
  ui.volSfx.addEventListener('input', () => {
    settings.sfxVol = ui.volSfx.value / 100;
    sound.configure({ sfxVol: settings.sfxVol });
  });
  ui.volSfx.addEventListener('change', () => { sound.chime(2); saveSettings(); });
  ui.volMusic.addEventListener('change', saveSettings);

  for (const id of ['auto', ...LANG_IDS]) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = id === 'auto' ? '' : LANGS[id].name; // language names stay in their own language
    ui.lang.appendChild(o);
  }
  ui.lang.addEventListener('change', () => {
    settings.lang = ui.lang.value;
    saveSettings();
    applyLanguage();
  });
}

/** Shrink headings that are too wide for the screen in the current language (e.g. "EINSTELLUNGEN"). */
function fitHeadings() {
  for (const el of document.querySelectorAll('h2')) {
    el.style.fontSize = '';
    const hidden = el.closest('.overlay.hidden');
    if (hidden) hidden.style.display = 'flex'; // measure even while its screen is hidden
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth + 1 && size > 16) el.style.fontSize = `${--size}px`;
    if (hidden) hidden.style.display = '';
  }
}
window.addEventListener('resize', () => fitHeadings());

/** Re-translate every visible string for the chosen language. */
function applyLanguage() {
  setLang(settings.lang);
  applyDom();
  fitHeadings();
  ui.lang.options[0].textContent = t('auto');
  hudTimeText = '';
  refreshTitle();
  refreshSettingsUI();
}

function refreshSettingsUI() {
  for (const b of ui.genreList.children) {
    b.textContent = b.dataset.genre === 'off' ? t('genre.off') : GENRES[b.dataset.genre].name;
    b.setAttribute('aria-checked', String(b.dataset.genre === settings.genre));
  }
  ui.genreDesc.textContent = t('desc.' + settings.genre);
  ui.lang.value = settings.lang;
  ui.volMusic.value = Math.round(settings.musicVol * 100);
  ui.volSfx.value = Math.round(settings.sfxVol * 100);
}

let lastDots = -1;
function updatePreviewDots() {
  const n = settingsFrom && settings.genre !== 'off' ? previewCount() : 0;
  if (n === lastDots) return;
  lastDots = n;
  [...ui.previewDots.children].forEach((d, i) => d.classList.toggle('on', i < n));
}

function openSettings() {
  settingsFrom = state === 'paused' ? 'pause' : 'title';
  sound.unlock();
  sound.resume();
  previewStart = clock;
  refreshSettingsUI();
  show(settingsFrom === 'pause' ? ui.pause : ui.title, false);
  show(ui.settings, true);
  sound.musicPhase('preview');
}

function closeSettings() {
  const from = settingsFrom;
  settingsFrom = null;
  lastDots = -1;
  saveSettings();
  show(ui.settings, false);
  if (from === 'pause') {
    show(ui.pause, true);
    sound.suspend();
  } else {
    show(ui.title, true);
    sound.musicPhase('title');
  }
}

buildSettingsUI();
applyLanguage();
ui.settingsBtn.addEventListener('click', openSettings);
ui.pauseSettings.addEventListener('click', openSettings);
ui.settingsDone.addEventListener('click', closeSettings);

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------
function burst(x, y, hue, n, speed, life, light = 65) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU;
    const v = speed * (0.25 + Math.random() * 0.75);
    particles.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: life * (0.6 + Math.random() * 0.4), max: life, hue, light,
      size: 1.2 + Math.random() * 1.8,
    });
  }
}

function handleEvents() {
  const evs = game.events;
  for (let i = 0; i < evs.length; i++) {
    const ev = evs[i];
    switch (ev.type) {
      case 'warn':
        sound.warn();
        break;
      case 'spawn':
        sound.chime(ev.echo.index);
        flash = { t: 0.5, hue: ev.echo.hue };
        burst(ev.echo.start.x, ev.echo.start.y, ev.echo.hue, 18, 22, 0.6);
        ui.hudEchoes.animate?.([{ transform: 'scale(1.5)' }, { transform: 'scale(1)' }], { duration: 300 });
        break;
      case 'spark':
        sparkCombo = game.time - lastSparkTime < 4 ? sparkCombo + 1 : 0;
        lastSparkTime = game.time;
        sound.spark(sparkCombo);
        burst(ev.x, ev.y, 50, 14, 20, 0.5, 70);
        floaters.push({ x: ev.x, y: ev.y, text: `+${CFG.SPARK_BONUS}`, life: 0.9, hue: 50 });
        break;
      case 'fade':
        sound.fade();
        sound.musicDip(CFG.FADE_DURATION);
        flash = { t: 0.6, hue: 190 };
        burst(ev.x, ev.y, 190, 30, 35, 0.8);
        floaters.push({ x: ev.x, y: ev.y, text: t('fade'), life: 1.1, hue: 190 });
        break;
      case 'death':
        sound.shatter();
        sound.musicPhase('dying');
        haptic([60, 40, 90]);
        shake = 1;
        burst(ev.x, ev.y, PLAYER_HUE, 46, 60, 1.2, 75);
        burst(ev.x, ev.y, ev.echo.hue, 26, 40, 1.0);
        state = 'dying';
        dyingT = 0;
        stick.id = null;
        break;
    }
  }
  evs.length = 0;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
const tmp = { x: 0, y: 0 };
const tmp2 = { x: 0, y: 0 };

function drawEyes(x, y, r, dx, dy, color, alpha) {
  const d = Math.hypot(dx, dy);
  const lx = d > 1e-4 ? dx / d : 0;
  const ly = d > 1e-4 ? dy / d : 0.3;
  const off = r * 0.32;
  const er = r * 0.17;
  const ex = x + lx * r * 0.3;
  const ey = y + ly * r * 0.3 - r * 0.1;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(ex - off, ey, er, er * 1.35, 0, 0, TAU);
  ctx.ellipse(ex + off, ey, er, er * 1.35, 0, 0, TAU);
  ctx.fill();
}

function drawPlayer(x, y, vx, vy, alpha) {
  const r = CFG.PLAYER_R;
  // Trail
  ctx.globalCompositeOperation = 'lighter';
  const spr = glowSprite(PLAYER_HUE, 100, 70);
  for (let i = 0; i < trail.length; i++) {
    const t = (i + 1) / trail.length;
    drawGlow(spr, trail[i].x, trail[i].y, r * (1.2 + 1.6 * t), 0.22 * t * alpha);
  }
  drawGlow(spr, x, y, r * 4.2, 0.55 * alpha);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#e9feff';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  drawEyes(x, y, r, vx, vy, '#0b1530', alpha * 0.9);
}

function drawEcho(e, alpha) {
  const r = CFG.ECHO_R;
  const hue = e.hue;
  if (e.state === 'warning') {
    // Faint pulsing outline at the spawn point; harmless.
    const prog = clamp(e.stateTime / CFG.WARN, 0, 1);
    const pulse = 0.5 + 0.5 * Math.sin(clock * 10);
    ctx.globalAlpha = (0.25 + 0.35 * pulse) * alpha;
    ctx.strokeStyle = `hsl(${hue}, 90%, 70%)`;
    ctx.lineWidth = 0.35;
    ctx.setLineDash([1.2, 1]);
    ctx.beginPath();
    ctx.arc(e.start.x, e.start.y, r * (1.25 + 0.25 * pulse), 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.7 * alpha;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.arc(e.start.x, e.start.y, r * 2, -Math.PI / 2, -Math.PI / 2 + prog * TAU);
    ctx.stroke();
    if (e.delayed) {
      // Held back by the fairness rule: show the zone the player must leave.
      ctx.globalAlpha = (0.12 + 0.1 * pulse) * alpha;
      ctx.strokeStyle = '#ffb36b';
      ctx.lineWidth = 0.3;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.arc(e.start.x, e.start.y, CFG.SAFE_RADIUS, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    return;
  }

  if (e.state === 'reforming') {
    const p = clamp(e.stateTime / CFG.LOOP_GRACE, 0, 1);
    ctx.globalAlpha = (0.25 + 0.4 * p) * alpha;
    ctx.strokeStyle = `hsl(${hue}, 90%, 70%)`;
    ctx.lineWidth = 0.35;
    ctx.beginPath();
    ctx.arc(e.start.x, e.start.y, r * (2 - p), 0, TAU);
    ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    drawGlow(glowSprite(hue, 90, 55), e.start.x, e.start.y, r * 3, 0.25 * p * alpha);
    ctx.globalCompositeOperation = 'source-over';
    return;
  }

  // Active: exact replay, interpolated between recorded frames for smooth rendering.
  const age = Math.max(0, e.age - (1 - renderAlpha) * CFG.DT);
  e.path.sample(age, tmp);
  e.path.sample(Math.max(0, age - 0.06), tmp2);
  const x = tmp.x, y = tmp.y;

  const remaining = e.path.duration - age;
  if (remaining < 0.7) {
    // Telegraph where the echo will reappear when its loop restarts.
    ctx.globalAlpha = (0.7 - remaining) * 0.6 * alpha;
    ctx.strokeStyle = `hsl(${hue}, 90%, 70%)`;
    ctx.lineWidth = 0.3;
    ctx.setLineDash([1.2, 1]);
    ctx.beginPath();
    ctx.arc(e.start.x, e.start.y, r * 1.5, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const spr = glowSprite(hue, 85, 50);
  ctx.globalCompositeOperation = 'lighter';
  for (let k = 5; k >= 1; k--) {
    const ta = age - k * 0.045;
    if (ta < 0) continue;
    e.path.sample(ta, tmp2);
    drawGlow(spr, tmp2.x, tmp2.y, r * (2.6 - k * 0.25), 0.1 * (1 - k / 6) * alpha);
  }
  drawGlow(spr, x, y, r * 3.6, 0.42 * alpha);
  ctx.globalCompositeOperation = 'source-over';

  ctx.globalAlpha = 0.78 * alpha;
  ctx.fillStyle = `hsl(${hue}, 55%, 28%)`;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 0.9 * alpha;
  ctx.strokeStyle = `hsl(${hue}, 95%, 68%)`;
  ctx.lineWidth = 0.35;
  ctx.stroke();
  e.path.sample(Math.max(0, age - 0.06), tmp2);
  drawEyes(x, y, r, x - tmp2.x, y - tmp2.y, `hsl(${hue}, 100%, 82%)`, 0.85 * alpha);
}

function drawSpark(s) {
  const pulse = 1 + 0.15 * Math.sin(s.age * 8);
  let a = Math.min(1, s.age * 4);
  if (s.life < 2) a *= Math.sin(s.age * 22) > 0 ? 1 : 0.3;
  ctx.globalCompositeOperation = 'lighter';
  drawGlow(glowSprite(48, 100, 62), s.x, s.y, 6 * pulse, 0.75 * a);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = a;
  ctx.fillStyle = '#fff6c2';
  const R = 1.7 * pulse, rr = 0.45;
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.age * 1.5);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * TAU;
    const rad = i % 2 === 0 ? R : rr;
    ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawFadePowerup(f) {
  let a = Math.min(1, f.age * 3);
  if (f.life < 2) a *= Math.sin(f.age * 22) > 0 ? 1 : 0.3;
  ctx.globalCompositeOperation = 'lighter';
  drawGlow(glowSprite(190, 100, 65), f.x, f.y, 8, 0.6 * a);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = a;
  ctx.strokeStyle = '#d8fbff';
  ctx.lineWidth = 0.45;
  ctx.beginPath();
  ctx.arc(f.x, f.y, 2.6, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([0.9, 0.9]);
  ctx.lineDashOffset = -f.age * 3;
  ctx.beginPath();
  ctx.arc(f.x, f.y, 1.5, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

function echoAlpha() {
  if (!game.fading) return 1;
  const rem = game.fadeUntil - game.time;
  if (rem > 0.8) return 0.07;
  // Fade back in (blinking) during the last 0.8 s so the player can react.
  const t = 1 - rem / 0.8;
  return 0.07 + 0.93 * t * (Math.sin(clock * 30) > -0.3 ? 1 : 0.5);
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    const d = Math.exp(-3 * dt);
    p.vx *= d; p.vy *= d;
    p.x += p.vx * dt; p.y += p.vy * dt;
  }
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    f.life -= dt;
    f.y -= dt * 6;
    if (f.life <= 0) floaters.splice(i, 1);
  }
}

function drawParticles() {
  ctx.globalCompositeOperation = 'lighter';
  for (const p of particles) {
    drawGlow(glowSprite(p.hue, 100, p.light), p.x, p.y, p.size * 1.6, p.life / p.max);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const f of floaters) {
    ctx.globalAlpha = Math.min(1, f.life * 2);
    ctx.fillStyle = `hsl(${f.hue}, 100%, 75%)`;
    ctx.font = '700 4px ui-rounded, -apple-system, system-ui, sans-serif';
    ctx.fillText(f.text, f.x, f.y);
  }
}

// Title-screen ambience: ghosts drifting on Lissajous curves. In the settings preview the
// number of ghosts grows with the music, and ghost i is the echo driving music layer i.
function attractPos(i, t, out) {
  const fx = 0.19 + ((i * 0.37) % 0.17);
  const fy = 0.17 + ((i * 0.53) % 0.15);
  const ph = i * 2.1;
  const ax = 0.3 + ((i * 0.29) % 0.09);
  const ay = 0.26 + ((i * 0.41) % 0.11);
  out.x = worldW / 2 + Math.sin(t * fx + ph) * worldW * ax;
  out.y = worldH / 2 + Math.sin(t * fy * 1.3 + ph * 1.7) * worldH * ay;
  return out;
}
const TITLE_GHOSTS = 3;
function attractCount() {
  return settingsFrom === 'title' ? previewCount() : TITLE_GHOSTS;
}

function drawAttract() {
  const t = clock;
  const n = attractCount();
  const p = { x: 0, y: 0 }, q = { x: 0, y: 0 }, k2 = { x: 0, y: 0 };
  for (let i = 0; i < n; i++) {
    const hue = ECHO_HUE(i);
    attractPos(i, t, p);
    attractPos(i, t - 0.05, q);
    const spr = glowSprite(hue, 85, 50);
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 6; k >= 1; k--) {
      attractPos(i, t - k * 0.12, k2);
      drawGlow(spr, k2.x, k2.y, CFG.ECHO_R * (2.6 - k * 0.25), 0.08 * (1 - k / 7));
    }
    drawGlow(spr, p.x, p.y, CFG.ECHO_R * 3.6, 0.35);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = `hsl(${hue}, 55%, 28%)`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, CFG.ECHO_R, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `hsl(${hue}, 95%, 68%)`;
    ctx.lineWidth = 0.35;
    ctx.stroke();
    drawEyes(p.x, p.y, CFG.ECHO_R, p.x - q.x, p.y - q.y, `hsl(${hue}, 100%, 82%)`, 0.6);
  }
}


function render(dt) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(bg, 0, 0);

  let sx = 0, sy = 0;
  if (shake > 0) {
    const m = shake * shake * 9;
    sx = (Math.random() * 2 - 1) * m;
    sy = (Math.random() * 2 - 1) * m;
    shake = Math.max(0, shake - dt * 1.8);
  }
  const s = view.s;
  ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (view.ox + sx), dpr * (view.oy + sy));

  updateParticles(dt);

  if (state === 'title' || !game) {
    drawAttract();
  } else {
    if (flash.t > 0) {
      ctx.globalAlpha = flash.t * 0.18;
      ctx.fillStyle = `hsl(${flash.hue}, 90%, 60%)`;
      ctx.fillRect(0, 0, worldW, worldH);
      flash.t = Math.max(0, flash.t - dt);
    }
    if (game.fading) {
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = 'hsl(190, 90%, 60%)';
      ctx.fillRect(0, 0, worldW, worldH);
    }

    for (const sp of game.sparks) drawSpark(sp);
    for (const f of game.powerups) drawFadePowerup(f);

    const ea = echoAlpha();
    for (const e of game.echoes) drawEcho(e, e.state === 'active' ? ea : 1);

    if (state !== 'dying' && state !== 'over') {
      const p = game.player;
      const a = state === 'playing' ? renderAlpha : 1;
      const x = lerp(p.px ?? p.x, p.x, a);
      const y = lerp(p.py ?? p.y, p.y, a);
      if (state === 'playing') {
        trail.push({ x, y });
        if (trail.length > 16) trail.shift();
      }
      let alpha = 1;
      if (game.invulnerable) alpha = Math.sin(clock * 30) > 0 ? 1 : 0.35;
      drawPlayer(x, y, p.vx, p.vy, alpha);
    }
  }

  drawParticles();

  // Joystick indicator (screen space).
  if (stick.id !== null && state === 'playing') {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = '#6ff3ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(stick.x0, stick.y0, STICK_R, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#6ff3ff';
    ctx.beginPath();
    ctx.arc(stick.x, stick.y, 18, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (game && (state === 'playing' || state === 'paused')) {
    const t = fmt(game.score);
    if (t !== hudTimeText) { hudTimeText = t; ui.hudTime.textContent = t; }
    const n = String(game.activeEchoes);
    if (n !== hudEchoText) { hudEchoText = n; ui.hudEchoes.textContent = n; }
  }
}

// ---------------------------------------------------------------------------
// Main loop: fixed-step simulation, interpolated rendering
// ---------------------------------------------------------------------------
let acc = 0;
let last = performance.now();

function frame(now) {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  clock += dt;

  if (state === 'playing') {
    updateInput(dt);
    acc += dt;
    let steps = 0;
    while (acc >= CFG.DT && steps < 24) {
      const p = game.player;
      p.px = p.x;
      p.py = p.y;
      game.step(input);
      acc -= CFG.DT;
      steps++;
      if (game.events.length) handleEvents();
      if (state !== 'playing') { acc = 0; break; }
    }
    renderAlpha = state === 'playing' ? acc / CFG.DT : 1;
  } else if (state === 'dying') {
    dyingT += dt;
    if (dyingT > 1.1) showGameOver();
  }

  render(dt);
  updatePreviewDots();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
resize();
refreshTitle();
requestAnimationFrame((t) => { last = t; frame(t); });

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
  });
}

// Debug / test hook.
window.echoThief = {
  get state() { return state; },
  get game() { return game; },
  get best() { return best; },
  input,
  tilt,
  sound,
  start: beginRun,
};
