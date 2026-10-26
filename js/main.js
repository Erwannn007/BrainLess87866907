import { World, T, O, OBJ_INFO } from './world.js';
import { renderNomu, ANIMS, ORIGIN_X, ORIGIN_Y } from './nomu.js';
import * as SP from './sprites.js';
import { hash, makeBuffer } from './raster.js';
import { drawText, textWidth } from './font.js';

const SEED = 87866907;
const SAVE_KEY = 'brainless-save-v1';
const DAY_LENGTH = 360; // secondes pour un cycle jour/nuit complet

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
const loading = document.getElementById('loading');
const bar = document.getElementById('bar');

// ---------------------------------------------------------------- écran
let VW = 240, VH = 240, cssPerPx = 1;
const safe = { t: 0, r: 0, b: 0, l: 0 };

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const W = window.innerWidth, H = window.innerHeight;
  const px = Math.max(1, Math.round(Math.min(W, H) * dpr / 240)); // pixels écran par pixel de jeu
  VW = Math.ceil(W * dpr / px);
  VH = Math.ceil(H * dpr / px);
  canvas.width = VW;
  canvas.height = VH;
  cssPerPx = px / dpr;
  canvas.style.width = VW * cssPerPx + 'px';
  canvas.style.height = VH * cssPerPx + 'px';
  ctx.imageSmoothingEnabled = false;
  const cs = getComputedStyle(document.documentElement);
  for (const k of ['t', 'r', 'b', 'l']) safe[k] = Math.ceil((parseFloat(cs.getPropertyValue('--sa' + k)) || 0) / cssPerPx);
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
resize();

function toCanvas(buf) {
  const c = document.createElement('canvas');
  c.width = buf.w;
  c.height = buf.h;
  c.getContext('2d').putImageData(new ImageData(buf.data, buf.w, buf.h), 0, 0);
  c.ox = buf.ox;
  c.oy = buf.oy;
  return c;
}

// ---------------------------------------------------------------- assets
const nomu = {}; // nomu[anim][dir][frame]
let objSprites, waterImgs, foamImgs, rimImgs, shadows, ui;
const blockCache = new Map();

function block(type, h, v) {
  const key = type * 1000 + h * 10 + v;
  let c = blockCache.get(key);
  if (!c) { c = toCanvas(SP.blockBuffer(type, h, v)); blockCache.set(key, c); }
  return c;
}

const tick = () => new Promise(r => setTimeout(r, 0));

async function loadAssets() {
  const jobs = [];
  for (const anim in ANIMS) {
    nomu[anim] = [];
    for (let d = 0; d < 8; d++) {
      nomu[anim][d] = [];
      for (let f = 0; f < ANIMS[anim].frames; f++) jobs.push([anim, d, f]);
    }
  }
  const total = jobs.length + 4;
  let done = 0;
  const progress = () => { bar.style.width = (100 * done / total) + '%'; };
  for (let i = 0; i < jobs.length; i++) {
    const [anim, d, f] = jobs[i];
    nomu[anim][d][f] = toCanvas(renderNomu(anim, f / ANIMS[anim].frames, d));
    done++;
    if (i % 12 === 0) { progress(); await tick(); }
  }
  const raw = SP.buildObjectSprites();
  objSprites = {};
  for (const id in raw) objSprites[id] = raw[id].map(toCanvas);
  done++; progress(); await tick();

  waterImgs = [0, 1].map(deep => [0, 1, 2, 3].map(f => [0, 1, 2, 3].map(v => toCanvas(SP.waterBuffer(deep, f, v)))));
  foamImgs = [0, 1].map(e => [0, 1, 2, 3].map(f => toCanvas(SP.foamBuffer(e, f))));
  rimImgs = [
    toCanvas(SP.edgeBuffer(0, '#ffffff', 70)), toCanvas(SP.edgeBuffer(1, '#ffffff', 50)),
    toCanvas(SP.edgeBuffer(2, '#000000', 60)), toCanvas(SP.edgeBuffer(3, '#000000', 45)),
  ];
  shadows = { s: toCanvas(SP.shadowBuffer(6, 3)), m: toCanvas(SP.shadowBuffer(9, 4)), l: toCanvas(SP.shadowBuffer(13, 6)), p: toCanvas(SP.shadowBuffer(11, 5)) };
  ui = {
    ring: toCanvas(circleBuf(24, false, [255, 255, 255], 110)),
    knob: toCanvas(circleBuf(10, true, [255, 255, 255], 170)),
    a: toCanvas(circleBuf(16, true, [225, 70, 90], 200)),
    b: toCanvas(circleBuf(14, true, [120, 90, 220], 200)),
    j: toCanvas(circleBuf(12, true, [70, 170, 110], 200)),
    s: toCanvas(circleBuf(12, true, [230, 170, 50], 200)),
  };
  done += 3; progress();
}

function circleBuf(r, fill, col, alpha) {
  const s = r * 2 + 3;
  const b = makeBuffer(s, s);
  const c = s / 2;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
    if (d > r + 0.5) continue;
    if (d > r - 1.2) b.set(x, y, [20, 15, 30], alpha);
    else if (fill) {
      const hl = (x + 0.5 - c) + (y + 0.5 - c) < -r * 0.5;
      b.set(x, y, hl ? col.map(v => Math.min(255, v + 50)) : col, alpha);
    } else if (d > r - 3) b.set(x, y, col, alpha);
  }
  return Object.assign(b, { ox: s / 2, oy: s / 2 });
}

// ---------------------------------------------------------------- état du jeu
const world = new World(SEED);
const stats = { trees: 0, rocks: 0, smash: 0 };
let tod = 0.3;
let time = 0;
const player = { x: 0, y: 0, z: 0, dir: 2, anim: 'idle', t: 0, action: null, actionT: 0, hitDone: false, dustT: 0, stamina: 1, tired: false, sprinting: false,
  jz: 0, vz: 0, air: false, charging: false, charge: 0, slamPower: 0, runFrame: -1 };
let windT = 0; // rafale après une frappe au sol : la végétation s'agite
const hits = new Map();
const particles = [];
const flyers = []; // papillons / lucioles
const fx = []; // anneaux de choc, arbres qui tombent
let shake = 0;
let hintT = 9;

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && typeof s.x === 'number') {
      world.mods = new Map(s.mods || []);
      Object.assign(stats, s.stats || {});
      tod = s.tod ?? tod;
      player.x = s.x; player.y = s.y;
      if (world.walkable(Math.floor(player.x), Math.floor(player.y))) return;
    }
  } catch (e) { /* pas de sauvegarde lisible */ }
  const sp = world.findSpawn();
  player.x = sp.x; player.y = sp.y;
}

function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ x: player.x, y: player.y, tod, stats, mods: [...world.mods] }));
  } catch (e) { /* stockage indisponible */ }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

// ---------------------------------------------------------------- contrôles
const input = { x: 0, y: 0, punch: false, jump: false };
const joy = { id: null, bx: 0, by: 0, kx: 0, ky: 0 };
const keys = new Set();
const buttons = {
  a: { x: 0, y: 0, r: 16, id: null, label: 'A', sub: 'COUP' },
  b: { x: 0, y: 0, r: 14, id: null, label: 'B', sub: 'CHARGE' },
  j: { x: 0, y: 0, r: 12, id: null, label: '^', sub: 'SAUT' },
  s: { x: 0, y: 0, r: 12, id: null, label: '>>', sub: 'SPRINT' },
};

function layoutButtons() {
  const a = buttons.a;
  a.x = VW - 24 - safe.r; a.y = VH - 30 - safe.b;
  buttons.b.x = a.x - 38; buttons.b.y = a.y + 4;
  buttons.j.x = a.x - 2; buttons.j.y = a.y - 44;
  buttons.s.x = a.x - 40; buttons.s.y = a.y - 44;
}

const held = (k) => buttons[k].id !== null;
const sprintHeld = () => held('s') || keys.has('ShiftLeft') || keys.has('ShiftRight');
const chargeHeld = () => held('b') || keys.has('KeyK') || keys.has('KeyE');

const toGame = (t) => [t.clientX / cssPerPx, t.clientY / cssPerPx];

function onTouchStart(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const [x, y] = toGame(t);
    let used = false;
    for (const k in buttons) {
      const b = buttons[k];
      if (!used && Math.hypot(x - b.x, y - b.y) < b.r + 6) {
        b.id = t.identifier; used = true;
        if (k === 'a') input.punch = true;
        if (k === 'j') input.jump = true;
      }
    }
    if (!used && joy.id === null && x < VW * 0.6) {
      joy.id = t.identifier; joy.bx = joy.kx = x; joy.by = joy.ky = y;
    }
  }
}
function onTouchMove(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier !== joy.id) continue;
    const [x, y] = toGame(t);
    let dx = x - joy.bx, dy = y - joy.by;
    const d = Math.hypot(dx, dy), R = 24;
    if (d > R) { dx *= R / d; dy *= R / d; }
    joy.kx = joy.bx + dx; joy.ky = joy.by + dy;
    input.x = dx / R; input.y = dy / R;
  }
}
function onTouchEnd(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) { joy.id = null; input.x = input.y = 0; }
    for (const k in buttons) if (buttons[k].id === t.identifier) buttons[k].id = null;
  }
}
canvas.addEventListener('touchstart', onTouchStart, { passive: false });
canvas.addEventListener('touchmove', onTouchMove, { passive: false });
canvas.addEventListener('touchend', onTouchEnd, { passive: false });
canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyJ') input.punch = true;
  if (e.code === 'Space') input.jump = true;
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

function keyboardVector() {
  let x = 0, y = 0;
  if (keys.has('ArrowLeft') || keys.has('KeyA') || keys.has('KeyQ')) x -= 1;
  if (keys.has('ArrowRight') || keys.has('KeyD')) x += 1;
  if (keys.has('ArrowUp') || keys.has('KeyW') || keys.has('KeyZ')) y -= 1;
  if (keys.has('ArrowDown') || keys.has('KeyS')) y += 1;
  if (!x && !y) return null;
  const k = 1 / Math.hypot(x, y);
  return [x * k, y * k];
}

// ---------------------------------------------------------------- géométrie iso
// monde (x, y) -> écran : x va en bas à droite, y en bas à gauche.
const isoX = (x, y) => (x - y) * 16;
const isoY = (x, y) => (x + y) * 8;
// direction du sprite k -> vecteur monde
function dirWorld(k) {
  const a = k * Math.PI / 4, cx = Math.cos(a), ct = Math.sin(a);
  return [(cx + ct) / Math.SQRT2, (ct - cx) / Math.SQRT2];
}

function groundZ(x, y) {
  const tx = Math.floor(x), ty = Math.floor(y);
  return world.walkable(tx, ty) ? world.hAt(tx, ty) * 8 : -3;
}

function blocked(nx, ny) {
  const tx = Math.floor(nx), ty = Math.floor(ny);
  if (!world.walkable(tx, ty)) return true;
  const cur = world.hAt(Math.floor(player.x), Math.floor(player.y));
  const h = world.hAt(tx, ty);
  const feet = player.z + player.jz; // en sautant on peut monter sur une marche plus haute
  if (h * 8 - feet > 8.5 || cur - h > 2) return true; // falaise
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const info = OBJ_INFO[world.objAt(tx + dx, ty + dy)];
      if (!info || !info.solid) continue;
      if (Math.hypot(nx - (tx + dx + 0.5), ny - (ty + dy + 0.5)) < info.solid + 0.2) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- particules & effets
function burst(x, y, z, colors, n, opt = {}) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = (opt.speed ?? 1.5) * (0.4 + Math.random());
    particles.push({
      x, y, z: z + Math.random() * (opt.spread ?? 6),
      vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: (opt.up ?? 40) * (0.5 + Math.random()),
      g: opt.g ?? 120, drag: opt.drag ?? 1.5, life: (opt.life ?? 1) * (0.6 + Math.random() * 0.6),
      col: colors[(Math.random() * colors.length) | 0], size: Math.random() < (opt.big ?? 0.3) ? 2 : 1, leaf: !!opt.leaf,
    });
  }
}

const LEAF_COLS = ['#2d6a33', '#4a923d', '#7dc257', '#1d4728'];
const CHERRY_COLS = ['#ec8fb2', '#ffc8dc', '#c55c88'];
const PINE_COLS = ['#1c4c35', '#2a6843', '#448a52'];
const ROCK_COLS = ['#5a5f6b', '#838894', '#b1b6bf', '#34373f'];
const WOOD_COLS = ['#7a5233', '#9a6d45', '#c9a06a'];
const DUST_COLS = ['#c9b58f', '#a8946e', '#e2d3b0'];

function leafColsFor(o) {
  if (o === O.CHERRY) return CHERRY_COLS;
  if (o === O.PINE || o === O.PINE_L || o === O.SNOW_PINE) return PINE_COLS;
  return LEAF_COLS;
}

function damage(tx, ty, dmg) {
  const o = world.objAt(tx, ty);
  const info = OBJ_INFO[o];
  if (!info) return false;
  const cx = tx + 0.5, cy = ty + 0.5, gz = world.hAt(tx, ty) * 8;
  const key = tx + ',' + ty;
  const st = hits.get(key) || { n: 0, shake: 0 };
  st.n += dmg; st.shake = 0.35;
  hits.set(key, st);
  if (info.tree) burst(cx, cy, gz + 22, leafColsFor(o), 8, { leaf: true, up: 10, g: 25, drag: 2, life: 1.6, spread: 14 });
  else if (info.rock) burst(cx, cy, gz + 4, ROCK_COLS, 6, { up: 50 });
  else if (info.wood) burst(cx, cy, gz + 3, WOOD_COLS, 5);

  if (st.n < Math.max(1, info.hp)) return true;
  hits.delete(key);
  let next = O.NONE;
  if (info.tree) {
    next = O.STUMP;
    stats.trees++;
    const spr = objSprites[o][0];
    const side = isoX(cx, cy) >= isoX(player.x, player.y) ? 1 : -1; // tombe à l'opposé de Brainless
    fx.push({ kind: 'fall', img: spr, x: cx, y: cy, gz, t: 0, side, leaves: leafColsFor(o) });
  } else if (info.rock) {
    next = o === O.ROCK_L ? O.ROCK : O.PEBBLES;
    stats.rocks++;
    burst(cx, cy, gz + 4, ROCK_COLS, 22, { up: 70, speed: 2.5, big: 0.6 });
    shake = Math.max(shake, 2);
  } else if (info.leafy) {
    burst(cx, cy, gz + 6, LEAF_COLS, 18, { leaf: true, up: 30, g: 30, life: 1.4 });
    if (o === O.BERRY) burst(cx, cy, gz + 6, ['#d8283c', '#ff5a6e'], 8, { up: 50 });
  } else if (info.wood) {
    burst(cx, cy, gz + 3, WOOD_COLS, 14, { up: 60, speed: 2 });
  } else {
    const cols = o === O.FLOWER_R ? ['#e2453c'] : o === O.FLOWER_Y ? ['#f2c230'] : o === O.FLOWER_B ? ['#5a78e6'] : o === O.FLOWER_W ? ['#ffffff'] : LEAF_COLS;
    burst(cx, cy, gz + 2, cols.concat(LEAF_COLS), 6, { leaf: true, up: 25, g: 30 });
  }
  world.setObj(tx, ty, next);
  return true;
}

function doPunchHit() {
  const [dx, dy] = dirWorld(player.dir);
  const hx = player.x + dx * 0.85, hy = player.y + dy * 0.85;
  let best = null, bestD = 0.8;
  for (let ty = Math.floor(hy) - 1; ty <= Math.floor(hy) + 1; ty++) {
    for (let tx = Math.floor(hx) - 1; tx <= Math.floor(hx) + 1; tx++) {
      const info = OBJ_INFO[world.objAt(tx, ty)];
      if (!info) continue;
      const d = Math.hypot(hx - (tx + 0.5), hy - (ty + 0.5));
      if (info.small) { if (d < 0.7) damage(tx, ty, 1); continue; }
      if (d < bestD) { bestD = d; best = [tx, ty]; }
    }
  }
  const gz = player.z;
  if (best) { damage(best[0], best[1], 1); shake = Math.max(shake, 1.5); }
  else burst(hx, hy, gz + 18, ['#ffffff', '#d8e0f0'], 5, { up: 10, g: 0, life: 0.25, speed: 1.2 });
}

// En sprint, Brainless pulvérise tout ce qui se trouve devant lui.
function trample(vx, vy) {
  const fx0 = player.x + vx * 0.45, fy0 = player.y + vy * 0.45;
  for (let ty = Math.floor(fy0) - 1; ty <= Math.floor(fy0) + 1; ty++) {
    for (let tx = Math.floor(fx0) - 1; tx <= Math.floor(fx0) + 1; tx++) {
      const o = world.objAt(tx, ty);
      const info = OBJ_INFO[o];
      if (!info) continue;
      const d = Math.hypot(fx0 - (tx + 0.5), fy0 - (ty + 0.5));
      if (d > (info.solid || 0.2) + 0.4) continue;
      // détruit d'un coup, souche et cailloux compris
      while (world.objAt(tx, ty) !== O.NONE && damage(tx, ty, 99)) { /* casse jusqu'au bout */ }
      if (info.solid) shake = Math.max(shake, 3);
    }
  }
}

// Frappe au sol après la charge : plus la charge est longue, plus c'est violent.
function doSlam(power) {
  stats.smash++;
  const R = 1.8 + power * 3.7;
  shake = Math.min(16, 6 + power * 10);
  windT = 1.2 + power * 1.8;
  const z = player.z;
  fx.push({ kind: 'ring', x: player.x, y: player.y, z, t: 0, r: R });
  fx.push({ kind: 'ring', x: player.x, y: player.y, z, t: -0.12, r: R * 0.7 });
  burst(player.x, player.y, z, DUST_COLS, 30 + power * 50, { up: 45, speed: 3 + power * 4, g: 90, life: 1, spread: 2, big: 0.5 });
  // bourrasque : traînées de vent qui partent dans toutes les directions
  const n = 40 + power * 90;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * (4 + power * 6);
    particles.push({
      x: player.x + Math.cos(a) * 0.4, y: player.y + Math.sin(a) * 0.4, z: z + 2 + Math.random() * 20,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 0, g: 0, drag: 1.6,
      life: 0.35 + Math.random() * 0.4, col: Math.random() < 0.7 ? '#ffffff' : '#d8ecff', size: 1, streak: true,
    });
  }
  // les particules déjà présentes sont soufflées
  for (const p of particles) {
    const dx = p.x - player.x, dy = p.y - player.y, d = Math.hypot(dx, dy) || 1;
    if (d < R * 2) { p.vx += dx / d * 6; p.vy += dy / d * 6; p.vz += 20; }
  }
  const dmg = 2 + Math.round(power * 8);
  for (let ty = Math.floor(player.y - R); ty <= Math.floor(player.y + R); ty++) {
    for (let tx = Math.floor(player.x - R); tx <= Math.floor(player.x + R); tx++) {
      if (Math.hypot(tx + 0.5 - player.x, ty + 0.5 - player.y) > R) continue;
      if (world.objAt(tx, ty)) damage(tx, ty, dmg);
    }
  }
  for (const f of flyers) f.scared = 3;
}

const CHARGE_COLS = [['#fff3b0', '#ffe28a'], ['#ffb347', '#ff9a3c'], ['#ff5a5a', '#ff2e63']];
function chargeCols() { return CHARGE_COLS[Math.min(2, Math.floor(player.charge * 3))]; }

function chargeEffects(dt) {
  const c = player.charge;
  shake = Math.max(shake, 0.6 + c * 2);
  // énergie aspirée vers Brainless
  const n = (25 + c * 70) * dt;
  for (let i = 0; i < n + (Math.random() < n % 1 ? 1 : 0); i++) {
    const a = Math.random() * Math.PI * 2, d = 1.3 + Math.random() * 1.2, life = 0.35 + Math.random() * 0.2;
    const x = player.x + Math.cos(a) * d, y = player.y + Math.sin(a) * d;
    particles.push({
      x, y, z: player.z + Math.random() * 22, vx: -Math.cos(a) * d / life, vy: -Math.sin(a) * d / life, vz: 8,
      g: 0, drag: 0, life, col: chargeCols()[(Math.random() * 2) | 0], size: Math.random() < 0.3 ? 2 : 1, streak: true,
    });
  }
  // poussière et cailloux qui se soulèvent
  if (Math.random() < dt * (6 + c * 20)) {
    const a = Math.random() * Math.PI * 2, d = 0.5 + Math.random() * 1.5;
    burst(player.x + Math.cos(a) * d, player.y + Math.sin(a) * d, player.z, DUST_COLS.concat(ROCK_COLS), 1, { up: 30 + c * 40, speed: 0.2, g: 60, life: 0.8, spread: 0 });
  }
}

function land() {
  player.air = false;
  player.jz = 0;
  player.vz = 0;
  const hard = player.sprinting;
  shake = Math.max(shake, hard ? 4 : 2.5);
  burst(player.x, player.y, player.z, DUST_COLS, hard ? 18 : 10, { up: 20, speed: 2.2, g: 60, life: 0.6, spread: 1 });
  // l'herbe et les fleurs sous lui sont écrasées
  for (let ty = Math.floor(player.y) - 1; ty <= Math.floor(player.y) + 1; ty++) {
    for (let tx = Math.floor(player.x) - 1; tx <= Math.floor(player.x) + 1; tx++) {
      const info = OBJ_INFO[world.objAt(tx, ty)];
      if (info && info.small && Math.hypot(tx + 0.5 - player.x, ty + 0.5 - player.y) < 0.9) damage(tx, ty, 1);
    }
  }
}

const JUMP_V = 140, GRAVITY = 420;

// ---------------------------------------------------------------- mise à jour
function update(dt) {
  time += dt;
  tod = (tod + dt / DAY_LENGTH) % 1;
  hintT -= dt;
  windT = Math.max(0, windT - dt);
  shake = Math.max(0, shake - dt * 20);

  let ix = input.x, iy = input.y;
  const kb = keyboardVector();
  if (kb) [ix, iy] = kb;
  const mag = Math.min(1, Math.hypot(ix, iy));

  // --- saut
  if (input.jump && !player.air && !player.action && !player.charging) {
    player.air = true;
    player.vz = JUMP_V * (player.sprinting ? 1.1 : 1);
    burst(player.x, player.y, player.z, DUST_COLS, 6, { up: 15, speed: 1.2, g: 60, life: 0.5, spread: 1 });
  }
  if (player.air) {
    player.vz -= GRAVITY * dt;
    player.jz += player.vz * dt;
    if (player.jz <= 0 && player.vz < 0) land();
  }

  // --- charge (maintenir B) puis frappe au sol au relâchement
  if (!player.action && !player.air) {
    if (chargeHeld()) {
      if (!player.charging) { player.charging = true; player.charge = 0; player.sprinting = false; setAnim('charge'); }
      player.charge = Math.min(1, player.charge + dt / 1.6);
      chargeEffects(dt);
    } else if (player.charging) {
      player.charging = false;
      player.slamPower = player.charge;
      startAction('slam');
    }
  }
  if (input.punch && !player.action && !player.charging && !player.air) startAction('punch');
  input.punch = input.jump = false;

  if (player.action) {
    const A = ANIMS[player.action];
    const dur = A.frames / A.fps;
    const prev = player.actionT;
    player.actionT += dt / dur;
    const hitAt = player.action === 'punch' ? 0.4 : 0.44;
    if (prev < hitAt && player.actionT >= hitAt) {
      if (player.action === 'punch') doPunchHit(); else doSlam(player.slamPower);
    }
    if (player.action === 'punch' && player.actionT > 0.3 && player.actionT < 0.45) {
      const [dx, dy] = dirWorld(player.dir);
      tryMove(dx * dt * 2.5, dy * dt * 2.5);
    }
    if (player.actionT >= 1) { player.action = null; player.t = 0; }
    player.sprinting = false;
  } else if (!player.charging) {
    // Sprint à quatre pattes (bouton SPRINT) : vide la barre ; vide, il faut qu'elle remonte à 35 %.
    if (player.stamina <= 0) player.tired = true;
    if (player.tired && player.stamina >= 0.35) player.tired = false;
    const run = sprintHeld() && !player.tired && mag > 0.15;
    if (!player.air) player.sprinting = run;
    if (mag > 0.15) {
      const speed = player.sprinting ? 5.8 : 2.2;
      const cx = ix / mag, ct = iy / mag;
      const vx = (cx + ct) / Math.SQRT2, vy = (ct - cx) / Math.SQRT2;
      if (player.sprinting && !player.air) trample(vx, vy);
      tryMove(vx * speed * dt, vy * speed * dt);
      player.dir = ((Math.round(Math.atan2(ct, cx) / (Math.PI / 4)) % 8) + 8) % 8;
      setAnim(player.sprinting ? 'run' : 'walk');
      if (player.sprinting && !player.air) sprintImpacts(vx, vy);
    } else {
      setAnim('idle');
      if (!player.air) player.sprinting = false;
    }
  }
  if (player.sprinting && !player.air) player.stamina = Math.max(0, player.stamina - dt / 4.5);
  else if (!player.sprinting) player.stamina = Math.min(1, player.stamina + dt / (player.tired ? 3 : 5));
  const A = ANIMS[player.anim];
  player.t += dt * A.fps * (player.charging ? 1 + player.charge * 1.8 : 1);

  const gz = groundZ(player.x, player.y);
  player.z += (gz - player.z) * Math.min(1, dt * 14);

  for (const [k, st] of hits) { st.shake = Math.max(0, st.shake - dt); }

  updateParticles(dt);
  updateFlyers(dt);
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.t += dt;
    if (f.kind === 'fall' && f.t > 0.75 && !f.done) {
      f.done = true;
      const ex = f.x + f.side * 1.2, ey = f.y - f.side * 1.2;
      burst(ex, ey, f.gz + 6, f.leaves, 26, { leaf: true, up: 25, g: 30, life: 1.6, spread: 10 });
      burst(ex, ey, f.gz, DUST_COLS, 14, { up: 25, speed: 2 });
      shake = Math.max(shake, 3);
    }
    if ((f.kind === 'ring' && f.t > 0.6) || (f.kind === 'fall' && f.t > 0.95)) fx.splice(i, 1);
  }
}

// Chaque fois que les mains puis les pattes frappent le sol pendant le galop : secousse + poussière.
function sprintImpacts(vx, vy) {
  const fi = Math.floor(player.t) % ANIMS.run.frames;
  if (fi === player.runFrame) return;
  player.runFrame = fi;
  if (fi !== 3 && fi !== 8) return;
  const front = fi === 3;
  shake = Math.max(shake, front ? 2.6 : 1.6);
  const d = front ? 0.55 : -0.3;
  const t = world.typeAt(Math.floor(player.x), Math.floor(player.y));
  const cols = t === T.SNOW ? ['#ffffff', '#dfe8f0'] : t === T.SAND ? DUST_COLS : ['#c9b58f', '#8fb86a', '#6b4a2e'];
  burst(player.x + vx * d, player.y + vy * d, player.z, cols, front ? 7 : 4, { up: 25, speed: 1.2, g: 70, life: 0.5, spread: 1 });
}

function startAction(a) {
  player.action = a;
  player.actionT = 0;
  player.anim = a;
}

function setAnim(a) {
  if (player.anim !== a) { player.anim = a; player.t = 0; }
}

function tryMove(dx, dy) {
  if (!blocked(player.x + dx, player.y)) player.x += dx;
  if (!blocked(player.x, player.y + dy)) player.y += dy;
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    const k = Math.exp(-p.drag * dt);
    p.vx *= k; p.vy *= k;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vz -= p.g * dt;
    if (p.leaf) p.vz = Math.max(p.vz, -14);
    p.z += p.vz * dt;
    const gz = groundZ(p.x, p.y);
    if (p.z < gz && !p.streak) { p.z = gz; p.vz *= -0.3; p.vx *= 0.5; p.vy *= 0.5; }
  }
  if (particles.length > 400) particles.splice(0, particles.length - 400);
}

function darkness() {
  // 0 en plein jour, 1 en pleine nuit
  const d = Math.cos((tod - 0.5) * Math.PI * 2); // 1 à midi, -1 à minuit
  return Math.max(0, Math.min(1, (0.25 - d) / 0.6));
}

function updateFlyers(dt) {
  const night = darkness() > 0.5;
  const want = night ? 16 : 6;
  // on retire ceux qui sont loin ou du mauvais type
  for (let i = flyers.length - 1; i >= 0; i--) {
    const f = flyers[i];
    if (Math.hypot(f.x - player.x, f.y - player.y) > 14 || f.night !== night) flyers.splice(i, 1);
  }
  while (flyers.length < want) {
    const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 8;
    const x = player.x + Math.cos(a) * r, y = player.y + Math.sin(a) * r;
    if (!world.walkable(Math.floor(x), Math.floor(y)) && !night) break;
    flyers.push({
      x, y, h: 10 + Math.random() * 14, t: Math.random() * 10, night, scared: 0,
      ang: Math.random() * 6.28, col: ['#ffd23f', '#ff7ab8', '#7ad3ff', '#ffffff', '#ff9a3c'][(Math.random() * 5) | 0],
    });
  }
  for (const f of flyers) {
    f.t += dt;
    f.scared = Math.max(0, f.scared - dt);
    f.ang += (Math.sin(f.t * 1.7 + f.x) * 2.2) * dt;
    let sp = f.night ? 0.5 : 1.1;
    if (f.scared > 0) {
      const a = Math.atan2(f.y - player.y, f.x - player.x);
      f.ang = a; sp = 4;
    }
    f.x += Math.cos(f.ang) * sp * dt;
    f.y += Math.sin(f.ang) * sp * dt;
    f.h += Math.sin(f.t * 3) * dt * 6;
  }
}

// ---------------------------------------------------------------- rendu
const rowEnts = [];

function render() {
  const sk = shake > 0 ? [(Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake] : [0, 0];
  const camX = isoX(player.x, player.y), camY = isoY(player.x, player.y) - player.z - 14;
  const ox = Math.round(VW / 2 - camX + sk[0]), oy = Math.round(VH / 2 - camY + sk[1]);

  ctx.fillStyle = '#163a6a';
  ctx.fillRect(0, 0, VW, VH);

  // bornes visibles en coordonnées "diagonale" d = x+y, k = x-y
  const dMin = Math.floor((-oy) / 8) - 3, dMax = Math.ceil((VH - oy) / 8) + 11;
  const kMin = Math.floor((-ox - 16) / 16) - 1, kMax = Math.ceil((VW - ox + 16) / 16) + 1;
  const wf = (time * 3) | 0;
  const pRow = Math.floor(player.x + 0.35) + Math.floor(player.y + 0.35);

  for (let d = dMin; d <= dMax; d++) {
    rowEnts.length = 0;
    for (let k = kMin; k <= kMax; k++) {
      if ((d + k) & 1) continue;
      const x = (d + k) >> 1, y = (d - k) >> 1;
      const sx = ox + k * 16, sy = oy + d * 8;
      const t = world.typeAt(x, y);
      const v = world.varAt(x, y);
      if (t === T.WATER || t === T.DEEP) {
        ctx.drawImage(waterImgs[t === T.DEEP ? 1 : 0][(wf + v) & 3][v], sx - 16, sy + 3);
        if (world.walkable(x - 1, y)) ctx.drawImage(foamImgs[0][(wf + x) & 3], sx - 16, sy + 3);
        if (world.walkable(x, y - 1)) ctx.drawImage(foamImgs[1][(wf + y) & 3], sx - 16, sy + 3);
      } else {
        const h = world.hAt(x, y);
        const top = sy - h * 8;
        ctx.drawImage(block(t, h, v), sx - 16, top);
        if (lowerAt(x - 1, y, h)) ctx.drawImage(rimImgs[0], sx - 16, top);
        if (lowerAt(x, y - 1, h)) ctx.drawImage(rimImgs[1], sx - 16, top);
        if (lowerAt(x + 1, y, h)) ctx.drawImage(rimImgs[2], sx - 16, top);
        if (lowerAt(x, y + 1, h)) ctx.drawImage(rimImgs[3], sx - 16, top);
      }
      const o = world.objAt(x, y);
      if (o) rowEnts.push({ o, x, y, sx, sy, depth: x + y + 1 });
    }
    if (d === pRow) rowEnts.push({ player: true, depth: player.x + player.y });
    if (rowEnts.length) {
      rowEnts.sort((a, b) => a.depth - b.depth);
      for (const e of rowEnts) {
        if (e.player) drawPlayer(ox, oy, 1);
        else drawObject(e);
      }
    }
  }

  // effets en l'air
  for (const f of fx) drawFx(f, ox, oy);
  for (const p of particles) {
    const sx = ox + isoX(p.x, p.y), sy = oy + isoY(p.x, p.y) - p.z;
    ctx.globalAlpha = Math.min(1, p.life * 3);
    ctx.fillStyle = p.col;
    if (p.streak) {
      // traînée : quelques pixels le long de la vitesse projetée à l'écran
      const dx = (p.vx - p.vy) * 16, dy = (p.vx + p.vy) * 8 - p.vz;
      const len = Math.min(7, Math.hypot(dx, dy) * 0.035);
      const n = Math.max(1, Math.round(len));
      const ux = dx / (Math.hypot(dx, dy) || 1), uy = dy / (Math.hypot(dx, dy) || 1);
      for (let i = 0; i < n; i++) ctx.fillRect(Math.round(sx - ux * i), Math.round(sy - uy * i), p.size, 1);
    } else ctx.fillRect(Math.round(sx), Math.round(sy), p.size, p.size);
  }
  ctx.globalAlpha = 1;
  if (player.charging) drawChargeAura(ox, oy);
  // Brainless visible en transparence derrière les arbres
  ctx.globalAlpha = 0.28;
  drawPlayer(ox, oy, 0);
  ctx.globalAlpha = 1;

  drawFlyers(ox, oy, false);
  drawSky();
  drawFlyers(ox, oy, true);
  drawHUD();
}

function lowerAt(x, y, h) {
  if (!world.walkable(x, y)) return true;
  return world.hAt(x, y) < h;
}

function drawObject(e) {
  const frames = objSprites[e.o];
  if (!frames) return;
  const info = OBJ_INFO[e.o] || {};
  const h = e.o === O.LILY ? -3 / 8 : world.hAt(e.x, e.y);
  let gx = e.sx, gy = e.sy + 8 - h * 8;
  const st = hits.get(e.x + ',' + e.y);
  if (st && st.shake > 0) gx += Math.round(Math.sin(time * 70) * 2 * st.shake / 0.35);
  if (info.tree) ctx.drawImage(shadows.l, gx - shadows.l.ox, gy - shadows.l.oy);
  else if (info.solid) ctx.drawImage(shadows.m, gx - shadows.m.ox, gy - shadows.m.oy);
  let f = 0;
  if (frames.length > 1) {
    const ph = hash(e.x, e.y, 1) * 10;
    const wind = Math.sin(time * 0.7 + e.x * 0.15 + e.y * 0.1); // rafales qui traversent le monde
    const gust = 1 + Math.max(0, wind) + windT * 3; // la bourrasque d'une frappe affole tout
    f = Math.floor(time * (info.tree ? 2 : 2.5) * gust + ph) % frames.length;
  }
  const img = frames[f];
  ctx.drawImage(img, gx - img.ox, gy - img.oy);
  // pétales qui tombent des cerisiers
  if (e.o === O.CHERRY && Math.random() < 0.03 && particles.length < 300) {
    burst(e.x + 0.5, e.y + 0.5, h * 8 + 26, CHERRY_COLS, 1, { leaf: true, up: 0, g: 10, life: 3, spread: 10, speed: 0.6, drag: 0.3 });
  }
}

function drawPlayer(ox, oy, withShadow) {
  const sx = ox + Math.round(isoX(player.x, player.y));
  const sy = oy + Math.round(isoY(player.x, player.y));
  const gz = Math.round(player.z);
  const jz = Math.round(player.jz);
  if (withShadow) {
    const sh = player.jz > 12 ? shadows.m : shadows.p;
    ctx.drawImage(sh, sx - sh.ox, sy - gz - sh.oy);
  }
  let img;
  if (player.air) {
    // image du saut choisie selon la vitesse verticale : décollage -> sommet -> réception
    const u = Math.max(0, Math.min(0.999, (1 - player.vz / JUMP_V) / 2));
    img = nomu.jump[player.dir][Math.floor(u * ANIMS.jump.frames)];
  } else if (player.action) {
    const A = ANIMS[player.action];
    img = nomu[player.action][player.dir][Math.min(A.frames - 1, Math.floor(player.actionT * A.frames))];
  } else {
    const A = ANIMS[player.anim];
    img = nomu[player.anim][player.dir][Math.floor(player.t) % A.frames];
  }
  ctx.drawImage(img, sx - ORIGIN_X, sy - gz - jz - ORIGIN_Y);
  if (player.charging && withShadow) {
    // il "chauffe" : son corps s'illumine par pulsations
    const pulse = (Math.sin(time * (8 + player.charge * 14)) + 1) / 2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (0.08 + player.charge * 0.3) * pulse;
    ctx.drawImage(img, sx - ORIGIN_X, sy - gz - jz - ORIGIN_Y);
    ctx.restore();
  }
}

function drawChargeAura(ox, oy) {
  const sx = ox + Math.round(isoX(player.x, player.y));
  const sy = oy + Math.round(isoY(player.x, player.y)) - Math.round(player.z);
  const c = player.charge;
  const cols = chargeCols();
  const pulse = Math.sin(time * (6 + c * 12));
  // anneau au sol qui pulse et grossit avec la charge
  const r = 10 + c * 14 + pulse * 2;
  ctx.globalAlpha = 0.5 + c * 0.4;
  ctx.fillStyle = cols[0];
  const n = Math.round(24 + r * 2);
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2 + time * (1 + c * 4);
    if (i % 3 === 0) continue;
    ctx.fillRect(Math.round(sx + Math.cos(a) * r), Math.round(sy + Math.sin(a) * r * 0.5), 1, 1);
  }
  // jauge de charge au-dessus de la tête
  const w = 22, bx = sx - w / 2, by = sy - 38;
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(bx - 1, by - 1, w + 2, 5);
  ctx.fillStyle = c >= 1 && Math.floor(time * 10) % 2 ? '#ffffff' : cols[1];
  ctx.fillRect(bx, by, Math.round(w * c), 3);
}

function drawFx(f, ox, oy) {
  if (f.kind === 'ring') {
    const sx = ox + isoX(f.x, f.y), sy = oy + isoY(f.x, f.y) - f.z;
    if (f.t < 0) return;
    const r = 6 + (f.t / 0.6) * (f.r || 2.7) * 23;
    ctx.globalAlpha = Math.max(0, 1 - f.t / 0.6);
    ctx.fillStyle = '#fff6d8';
    for (let i = 0; i < 64; i++) {
      const a = i / 64 * Math.PI * 2;
      ctx.fillRect(Math.round(sx + Math.cos(a) * r), Math.round(sy + Math.sin(a) * r * 0.5), 2, 1);
    }
    ctx.globalAlpha = 1;
  } else if (f.kind === 'fall') {
    const sx = ox + isoX(f.x, f.y), sy = oy + isoY(f.x, f.y) - f.gz;
    const u = Math.min(1, f.t / 0.75);
    const ang = f.side * u * u * Math.PI / 2;
    ctx.save();
    ctx.globalAlpha = f.t > 0.75 ? Math.max(0, 1 - (f.t - 0.75) / 0.2) : 1;
    ctx.translate(Math.round(sx), Math.round(sy));
    ctx.rotate(ang);
    ctx.drawImage(f.img, -f.img.ox, -f.img.oy);
    ctx.restore();
  }
}

function drawFlyers(ox, oy, glowPass) {
  for (const f of flyers) {
    if (f.night !== glowPass) continue;
    const gz = groundZ(f.x, f.y);
    const sx = Math.round(ox + isoX(f.x, f.y)), sy = Math.round(oy + isoY(f.x, f.y) - gz - f.h);
    if (f.night) {
      const blink = (Math.sin(f.t * 3 + f.x * 5) + 1) / 2;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.25 * blink;
      ctx.fillStyle = '#d8ff6a';
      ctx.fillRect(sx - 2, sy - 1, 5, 3); ctx.fillRect(sx - 1, sy - 2, 3, 5);
      ctx.globalAlpha = 0.6 + blink * 0.4;
      ctx.fillRect(sx, sy, 1, 1);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    } else {
      const open = Math.floor(f.t * 12) % 2;
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(sx, sy + Math.round(f.h), 2, 1);
      ctx.fillStyle = f.col;
      if (open) { ctx.fillRect(sx - 2, sy - 1, 2, 2); ctx.fillRect(sx + 1, sy - 1, 2, 2); }
      else { ctx.fillRect(sx - 1, sy - 2, 1, 2); ctx.fillRect(sx + 1, sy - 2, 1, 2); }
      ctx.fillStyle = '#2a1f1a';
      ctx.fillRect(sx, sy - 1, 1, 2);
    }
  }
}

const SKY = [
  [0, [70, 80, 150]], [0.2, [70, 80, 150]], [0.27, [255, 185, 140]], [0.34, [255, 255, 255]],
  [0.68, [255, 255, 255]], [0.76, [255, 160, 110]], [0.83, [70, 80, 150]], [1, [70, 80, 150]],
];

function drawSky() {
  let c = SKY[0][1];
  for (let i = 0; i < SKY.length - 1; i++) {
    if (tod >= SKY[i][0] && tod <= SKY[i + 1][0]) {
      const u = (tod - SKY[i][0]) / (SKY[i + 1][0] - SKY[i][0]);
      c = SKY[i][1].map((v, j) => Math.round(v + (SKY[i + 1][1][j] - v) * u));
      break;
    }
  }
  if (c[0] === 255 && c[1] === 255 && c[2] === 255) return;
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
  ctx.fillRect(0, 0, VW, VH);
  ctx.globalCompositeOperation = 'source-over';
}

function drawSprintBar(x, y) {
  const w = 52, fill = Math.round((w - 2) * player.stamina);
  const blink = player.tired && Math.floor(time * 6) % 2;
  drawText(ctx, 'SPRINT', x, y, player.tired ? '#ff7a7a' : '#ffe28a');
  const bx = x + 26;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(bx, y - 1, w, 7);
  ctx.fillStyle = '#20243a';
  ctx.fillRect(bx + 1, y, w - 2, 5);
  ctx.fillStyle = player.tired ? (blink ? '#ff4d5e' : '#a8304a') : player.sprinting ? '#ffd23f' : '#f2a93b';
  ctx.fillRect(bx + 1, y, fill, 5);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(bx + 1, y, fill, 1);
}

function drawHUD() {
  layoutButtons();
  const x0 = 6 + safe.l, y0 = 6 + safe.t;
  drawText(ctx, 'BRAINLESS', x0, y0, '#f6a6bd');
  const night = darkness() > 0.5;
  drawText(ctx, (night ? 'NUIT' : 'JOUR') + '  ARBRES ' + stats.trees + '  ROCHERS ' + stats.rocks, x0, y0 + 8, '#e8f0ff');
  drawSprintBar(x0, y0 + 17);

  if (hintT > 0) {
    ctx.globalAlpha = Math.min(1, hintT / 1.5);
    const l1 = 'MAINTIENS B POUR CHARGER';
    const l2 = 'SPRINT: MAINTIENS >> EN MARCHANT';
    drawText(ctx, l1, Math.round(VW / 2 - textWidth(l1) / 2), Math.round(VH * 0.25), '#ffffff');
    drawText(ctx, l2, Math.round(VW / 2 - textWidth(l2) / 2), Math.round(VH * 0.25) + 8, '#ffe28a');
    ctx.globalAlpha = 1;
  }

  if (joy.id !== null) {
    ctx.drawImage(ui.ring, Math.round(joy.bx - ui.ring.ox), Math.round(joy.by - ui.ring.oy));
    ctx.drawImage(ui.knob, Math.round(joy.kx - ui.knob.ox), Math.round(joy.ky - ui.knob.oy));
  }
  for (const k of ['a', 'b', 'j', 's']) {
    const b = buttons[k];
    const img = ui[k];
    const press = b.id !== null ? 1 : 0;
    ctx.drawImage(img, b.x - img.ox, b.y - img.oy + press);
    drawText(ctx, b.label, Math.round(b.x - textWidth(b.label) / 2), b.y - 2 + press, '#ffffff');
    drawText(ctx, b.sub, Math.round(b.x - textWidth(b.sub) / 2), b.y + b.r + 3, '#ffffff');
  }
}

// ---------------------------------------------------------------- boucle
let last = 0, saveT = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  update(dt);
  render();
  saveT += dt;
  if (saveT > 4) { saveT = 0; save(); }
  requestAnimationFrame(frame);
}

(async function start() {
  load();
  if (location.hash === '#debug') window.BRAINLESS = { world, player, stats, O };
  await loadAssets();
  loading.style.display = 'none';
  requestAnimationFrame((t) => { last = t; frame(t); });
})();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
