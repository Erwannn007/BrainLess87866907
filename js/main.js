import { World, T, O, OBJ_INFO } from './world.js';
import { buildVillageSprites } from './buildings.js';
import { renderPerson, PEOPLE, PEOPLE_ANIMS, CIVILIANS, PEOPLE_OX, PEOPLE_OY } from './people.js';
import { renderNomu, ANIMS, ORIGIN_X, ORIGIN_Y } from './nomu.js';
import * as SP from './sprites.js';
import { hash, makeBuffer } from './raster.js';
import { drawText, textWidth } from './font.js';
import { sfx, unlockAudio, toggleMute, isMuted, audioRunning, chargeStart, chargeUpdate, chargeStop, updateAmbience } from './audio.js';
import { pad, pollPad, rumble } from './pad.js';

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
let objSprites, objGlow, crackImgs, peopleImgs, waterImgs, foamImgs, rimImgs, shadows, ui;
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
      const list = nomu[anim][d] = [];
      for (let f = 0; f < ANIMS[anim].frames; f++) jobs.push(() => { list[f] = toCanvas(renderNomu(anim, f / ANIMS[anim].frames, d)); });
    }
  }
  // villageois et chevaliers : chaque anim x 8 directions
  peopleImgs = {};
  for (const type in PEOPLE) {
    const AN = PEOPLE_ANIMS[PEOPLE[type].kind];
    peopleImgs[type] = {};
    for (const anim in AN) {
      peopleImgs[type][anim] = [];
      for (let d = 0; d < 8; d++) {
        const list = peopleImgs[type][anim][d] = [];
        for (let f = 0; f < AN[anim].frames; f++) jobs.push(() => { list[f] = toCanvas(renderPerson(type, anim, f / AN[anim].frames, d)); });
      }
    }
  }
  const total = jobs.length + 5;
  let done = 0;
  const progress = () => { bar.style.width = (100 * done / total) + '%'; };
  for (let i = 0; i < jobs.length; i++) {
    jobs[i]();
    done++;
    if (i % 12 === 0) { progress(); await tick(); }
  }
  const raw = SP.buildObjectSprites();
  objSprites = {};
  for (const id in raw) objSprites[id] = raw[id].map(toCanvas);
  done++; progress(); await tick();
  // bâtiments et objets de village, avec leur couche de fenêtres allumées pour la nuit
  const vs = buildVillageSprites();
  objGlow = {};
  for (const id in vs) {
    objSprites[id] = vs[id].map((s) => toCanvas(s.img));
    if (vs[id][0].glow) objGlow[id] = toCanvas(vs[id][0].glow);
  }
  crackImgs = {};
  for (const m of ['earth', 'sand', 'stone', 'snow']) crackImgs[m] = [1, 2, 3].map((l) => [0, 1, 2, 3].map((v) => toCanvas(SP.crackBuffer(m, l, v))));
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
const stats = { trees: 0, rocks: 0, smash: 0, houses: 0, knights: 0, play: 0 };
let tod = 0.3;
let time = 0;
const player = { x: 0, y: 0, z: 0, dir: 2, anim: 'idle', t: 0, action: null, actionT: 0, hitDone: false, dustT: 0, stamina: 1, tired: false, sprinting: false,
  jz: 0, vz: 0, air: false, charging: false, charge: 0, slamPower: 0, runFrame: -1,
  slide: null, mv: null, idleT: 0, water: 0, rippleT: 0,
  chargeKind: null, punchHoldT: 0, punchPower: 0, combo: 0, lastPunch: -1, punchBuf: false,
  hp: 100, lastHurt: -99, invuln: 0, flash: 0, kb: null, dead: null, regen: false };
const npcs = []; // villageois et chevaliers autour de Brainless
const vstate = new Map(); // id du village -> { populated }
// Méchanceté : monte quand Brainless casse le village ou frappe ses habitants. Les étoiles
// font venir les chevaliers ; elle redescend quand il se fait oublier.
let heat = 0, lastCrime = -99, crimeVillage = null, starFlash = 0;
const STAR_AT = [1, 6, 14, 26, 40];
const stars = () => STAR_AT.filter((v) => heat >= v).length;
let msg = null; // bandeau au milieu de l'écran : { text, t }
function showMsg(text, dur = 2.5) { msg = { text, t: dur }; }
let windT = 0; // rafale après une frappe au sol : la végétation s'agite
const hits = new Map();
const particles = [];
const flyers = []; // papillons / lucioles
const fx = []; // anneaux de choc, arbres qui tombent
let shake = 0;
let lastShake = 0;
let hintT = 9;

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && typeof s.x === 'number') {
      world.mods = new Map(s.mods || []);
      world.terr = new Map(s.terr || []);
      world.wear = new Map(s.wear || []);
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
    localStorage.setItem(SAVE_KEY, JSON.stringify({ x: player.x, y: player.y, tod, stats, mods: [...world.mods], terr: [...world.terr], wear: [...world.wear] }));
  } catch (e) { /* stockage indisponible */ }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

// ---------------------------------------------------------------- contrôles
const input = { x: 0, y: 0, punch: false, jump: false };
// Mode de contrôle affiché : 'touch' (boutons à l'écran), 'keys' (clavier/souris), 'pad' (manette)
let inputMode = window.matchMedia && matchMedia('(pointer: coarse)').matches ? 'touch' : 'keys';
function setMode(m) { if (m !== inputMode) { inputMode = m; hintT = 7; } }
const mouse = { punch: false, charge: false };
const joy = { id: null, bx: 0, by: 0, kx: 0, ky: 0 };
const keys = new Set();
const buttons = {
  a: { x: 0, y: 0, r: 16, label: 'A', sub: 'COUP' },
  b: { x: 0, y: 0, r: 14, label: 'B', sub: 'CHARGE' },
  j: { x: 0, y: 0, r: 12, label: '^', sub: 'SAUT' },
  s: { x: 0, y: 0, r: 12, label: '>>', sub: 'SPRINT' },
};
// Doigts posés sur les boutons : on peut glisser d'un bouton à l'autre.
// Un doigt parti du SPRINT continue de sprinter même s'il glisse sur SAUT, COUP…
const btnTouches = new Map(); // id -> { origin, cur }

function layoutButtons() {
  const a = buttons.a;
  a.x = VW - 24 - safe.r; a.y = VH - 30 - safe.b;
  buttons.b.x = a.x - 38; buttons.b.y = a.y + 4;
  buttons.j.x = a.x - 2; buttons.j.y = a.y - 44;
  buttons.s.x = a.x - 40; buttons.s.y = a.y - 44;
}

function held(k) {
  for (const t of btnTouches.values()) if (t.cur === k || (k === 's' && t.origin === 's')) return true;
  return false;
}
const sprintHeld = () => held('s') || keys.has('ShiftLeft') || keys.has('ShiftRight') || pad.sprint;
const chargeHeld = () => held('b') || keys.has('KeyK') || keys.has('KeyE') || pad.charge || mouse.charge;
const punchHeld = () => held('a') || keys.has('KeyJ') || pad.punch || mouse.punch;

function buttonAt(x, y, slack) {
  let best = null, bd = 1e9;
  for (const k in buttons) {
    const b = buttons[k], d = Math.hypot(x - b.x, y - b.y);
    if (d < b.r + slack && d < bd) { bd = d; best = k; }
  }
  return best;
}

function pressButton(k) {
  if (k === 'a') input.punch = true;
  if (k === 'j') input.jump = true;
}

const toGame = (t) => [t.clientX / cssPerPx, t.clientY / cssPerPx];

const muteBtn = { x: 0, y: 0, r: 7 };

function onTouchStart(e) {
  e.preventDefault();
  unlockAudio();
  setMode('touch');
  for (const t of e.changedTouches) {
    const [x, y] = toGame(t);
    if (Math.hypot(x - muteBtn.x, y - muteBtn.y) < muteBtn.r + 6) { toggleMute(); sfx.ui(); continue; }
    const k = buttonAt(x, y, 6);
    if (k) {
      btnTouches.set(t.identifier, { origin: k, cur: k });
      pressButton(k);
    } else if (joy.id === null && x < VW * 0.6) {
      joy.id = t.identifier; joy.bx = joy.kx = x; joy.by = joy.ky = y;
    }
  }
}
function onTouchMove(e) {
  e.preventDefault();
  for (const t of e.changedTouches) {
    const [x, y] = toGame(t);
    const bt = btnTouches.get(t.identifier);
    if (bt) {
      // glisser sur un autre bouton le déclenche
      const k = buttonAt(x, y, 3);
      if (k !== bt.cur) {
        bt.cur = k;
        if (k) pressButton(k);
      }
      continue;
    }
    if (t.identifier !== joy.id) continue;
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
    btnTouches.delete(t.identifier);
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
  unlockAudio();
  setMode('keys');
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyF') toggleFullscreen();
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); // pas de défilement de page
  if (e.code === 'KeyJ') input.punch = true;
  if (e.code === 'Space') input.jump = true;
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); mouse.punch = mouse.charge = false; });

// Souris (PC) : clic gauche = coup (maintenir = coup chargé), clic droit = frappe au sol.
canvas.addEventListener('mousedown', (e) => {
  unlockAudio();
  setMode('keys');
  const x = e.clientX / cssPerPx, y = e.clientY / cssPerPx;
  if (Math.hypot(x - muteBtn.x, y - muteBtn.y) < muteBtn.r + 6) { toggleMute(); sfx.ui(); return; }
  if (e.button === 0) { mouse.punch = true; input.punch = true; }
  if (e.button === 2) mouse.charge = true;
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouse.punch = false;
  if (e.button === 2) mouse.charge = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function toggleFullscreen() {
  const d = document;
  try {
    if (!d.fullscreenElement && !d.webkitFullscreenElement) (d.documentElement.requestFullscreen || d.documentElement.webkitRequestFullscreen).call(d.documentElement);
    else (d.exitFullscreen || d.webkitExitFullscreen).call(d);
  } catch (e) { /* plein écran non disponible */ }
}

// Manette : lue à chaque image.
function readPad() {
  pollPad();
  if (!pad.connected) return null;
  if (pad.any) { setMode('pad'); unlockAudio(); }
  if (pad.jumpPressed) input.jump = true;
  if (pad.punchPressed) input.punch = true;
  if (pad.mutePressed) toggleMute();
  return pad.x || pad.y ? [pad.x, pad.y] : null;
}

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

// 0 : terre ferme, 1 : eau peu profonde (il patauge), 2 : eau profonde (il nage)
function waterDepth(x, y) {
  const t = world.typeAt(Math.floor(x), Math.floor(y));
  return t === T.DEEP ? 2 : t === T.WATER ? 1 : 0;
}
const WATER_LINE = -3; // hauteur de la surface de l'eau
const SINK = [0, 9, 10]; // de combien il s'enfonce sous la surface
const SINK_ANIM = { tread: 19, swim: 10, swimfast: 8 }; // en eau profonde, selon la nage

const boxHit = (x, y, ax, ay, r) => Math.abs(x - ax) < r && Math.abs(y - ay) < r;

// `e` = qui bouge (Brainless ou un habitant), `feet` = hauteur de ses pieds.
// Les habitants ne vont pas dans l'eau et ne sautent pas d'une marche de plus de 1.
function blockedFor(e, nx, ny, feet, npc) {
  const tx = Math.floor(nx), ty = Math.floor(ny);
  if (npc && !world.walkable(tx, ty)) return true;
  const cur = world.hAt(Math.floor(e.x), Math.floor(e.y));
  const h = world.hAt(tx, ty);
  if (h * 8 - feet > 8.5 || cur - h > (npc ? 1 : 2)) return true; // falaise
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const info = OBJ_INFO[world.objAt(tx + dx, ty + dy)];
      if (!info) continue;
      if (info.solid) {
        if (Math.hypot(nx - (tx + dx + 0.5), ny - (ty + dy + 0.5)) < info.solid + 0.2) return true;
        continue;
      }
      if (!info.part && !info.building) continue;
      // bâtiment : une boîte centrée sur le coin commun de ses 4 tuiles
      const a = world.anchorOf(tx + dx, ty + dy);
      const ai = OBJ_INFO[world.objAt(a[0], a[1])];
      if (!ai || !ai.box) continue;
      const r = ai.box + 0.2;
      if (boxHit(nx, ny, a[0], a[1], r) && !boxHit(e.x, e.y, a[0], a[1], r)) return true;
    }
  }
  return false;
}

function blocked(nx, ny) {
  // dans l'eau, ses pieds sont au fond (niveau 0) : il peut remonter sur la berge
  // en sautant on peut monter sur une marche plus haute
  return blockedFor(player, nx, ny, (player.water ? 0 : player.z) + player.jz, false);
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
  if (info.part) return damage(tx + info.part[0], ty + info.part[1], dmg);
  if (info.building) return damageBuilding(tx, ty, dmg);
  const cx = tx + 0.5, cy = ty + 0.5, gz = world.hAt(tx, ty) * 8;
  const key = tx + ',' + ty;
  const st = hits.get(key) || { n: 0, shake: 0 };
  st.n += dmg; st.shake = 0.35;
  hits.set(key, st);
  if (info.tree) { burst(cx, cy, gz + 22, leafColsFor(o), 8, { leaf: true, up: 10, g: 25, drag: 2, life: 1.6, spread: 14 }); sfx.hitWood(); }
  else if (info.rock) { burst(cx, cy, gz + 4, ROCK_COLS, 6, { up: 50 }); sfx.hitRock(); }
  else if (info.wood) { burst(cx, cy, gz + 3, WOOD_COLS, 5); sfx.hitWood(); }
  else if (info.leafy) sfx.rustle();
  else if (info.prop) { burst(cx, cy, gz + 6, PROP_COLS[info.prop], 5, { up: 40 }); if (info.prop === 'stone') sfx.hitRock(); else sfx.hitWood(); }

  if (st.n < Math.max(1, info.hp)) return true;
  hits.delete(key);
  let next = O.NONE;
  if (info.tree) {
    next = O.STUMP;
    stats.trees++;
    const spr = objSprites[o][0];
    const side = isoX(cx, cy) >= isoX(player.x, player.y) ? 1 : -1; // tombe à l'opposé de Brainless
    fx.push({ kind: 'fall', img: spr, x: cx, y: cy, gz, t: 0, side, leaves: leafColsFor(o) });
    sfx.treeCreak();
  } else if (info.rock) {
    next = o === O.ROCK_L ? O.ROCK : O.PEBBLES;
    sfx.rockBreak();
    stats.rocks++;
    burst(cx, cy, gz + 4, ROCK_COLS, 22, { up: 70, speed: 2.5, big: 0.6 });
    shake = Math.max(shake, 2);
  } else if (info.leafy) {
    burst(cx, cy, gz + 6, LEAF_COLS, 18, { leaf: true, up: 30, g: 30, life: 1.4 });
    if (o === O.BERRY) burst(cx, cy, gz + 6, ['#d8283c', '#ff5a6e'], 8, { up: 50 });
  } else if (info.wood) {
    sfx.rockBreak();
    burst(cx, cy, gz + 3, WOOD_COLS, 14, { up: 60, speed: 2 });
  } else if (info.prop) {
    next = info.next || O.NONE;
    sfx.propBreak(info.prop);
    burst(cx, cy, gz + 6, PROP_COLS[info.prop], 16, { up: 55, speed: 2, big: 0.5 });
    if (info.prop === 'barrel') burst(cx, cy, gz + 4, ['#7a2232', '#5a1a26', '#a8433f'], 12, { up: 35, speed: 1.6 }); // du vin
    if (info.prop === 'stall') burst(cx, cy, gz + 8, ['#c8283a', '#e8862a', '#6fb04c', '#f2c230'], 10, { up: 60, speed: 2 }); // les fruits
    if (info.prop === 'lantern') burst(cx, cy, gz + 15, ['#ffd77a', '#fff0b8', '#ffffff'], 8, { up: 30, speed: 1.4, life: 0.5 });
    shake = Math.max(shake, 1.5);
  } else {
    sfx.pluck();
    const cols = o === O.FLOWER_R ? ['#e2453c'] : o === O.FLOWER_Y ? ['#f2c230'] : o === O.FLOWER_B ? ['#5a78e6'] : o === O.FLOWER_W ? ['#ffffff']
      : o === O.WHEAT ? ['#cfa94a', '#ead37a'] : o === O.CABBAGE ? ['#62a04c', '#93c86a'] : o === O.PLANKS ? WOOD_COLS : LEAF_COLS;
    burst(cx, cy, gz + 2, cols.concat(o === O.PLANKS ? [] : LEAF_COLS), 6, { leaf: o !== O.PLANKS, up: 25, g: 30 });
  }
  world.setObj(tx, ty, next);
  if (info.village) crime(info.crime || 0.2, cx, cy);
  return true;
}

const PLASTER_COLS = ['#e3d4ae', '#c2b08a', '#f6ecd0'];
const ROOF_COLS = {
  thatch: ['#cfa94a', '#ead37a', '#a3812f'], tile: ['#b84d32', '#d9744c', '#8f3423'],
  slate: ['#526079', '#7083a0', '#3a4558'], barn: ['#a3362a', '#c45a44', '#6b4226'], stone: ROCK_COLS,
};
const PROP_COLS = {
  stone: ROCK_COLS, stall: WOOD_COLS.concat(['#c83444', '#ece2c8']), wood: WOOD_COLS, barrel: WOOD_COLS.concat(['#5a606e']),
  hay: ['#cfa94a', '#ead37a', '#a3812f'], lantern: ['#3a3f4a', '#5a606e', '#ffd77a'],
};
const bumpT = new Map(); // un bâtiment percuté en sprint ne prend pas un coup par image

// Un bâtiment encaisse, tremble, s'abîme puis s'effondre. L'excédent d'un très gros coup
// passe d'un état au suivant : un coup chargé à bout portant le rase d'un coup.
function damageBuilding(ax, ay, dmg) {
  const key = ax + ',' + ay;
  let o = world.objAt(ax, ay), info = OBJ_INFO[o];
  const gz = world.hAt(ax, ay) * 8;
  const cols = ROOF_COLS[info.mat].concat(info.mat === 'stone' ? [] : PLASTER_COLS);
  const top = gz + (info.building === 'tower' ? 48 : 24);
  sfx.hitBuilding(info.mat);
  if (info.state === 2) { burst(ax, ay, gz + 4, cols.concat(DUST_COLS), 8, { up: 40, speed: 1.6 }); return true; } // ruine : de la poussière
  const st = hits.get(key) || { n: 0, shake: 0 };
  st.n += dmg; st.shake = 0.45;
  hits.set(key, st);
  burst(ax, ay, top, cols, 4 + Math.min(10, dmg * 2), { up: 30, speed: 1.4, spread: 10 });
  burst(ax, ay, gz + 2, DUST_COLS, 4, { up: 20, speed: 1.6, spread: 6 });
  crime(0.4, ax, ay);
  const before = o;
  while (info.next && st.n >= info.hp) {
    st.n -= info.hp;
    o = info.next; info = OBJ_INFO[o];
  }
  if (o === before) return true;
  world.setObj(ax, ay, o);
  if (info.state === 2) {
    hits.delete(key);
    stats.houses++;
    sfx.collapse();
    shake = Math.max(shake, 7);
    fx.push({ kind: 'collapse', img: objSprites[before][0], x: ax, y: ay, gz, t: 0 });
    burst(ax, ay, gz + 6, DUST_COLS.concat(cols), 60, { up: 60, speed: 3.5, g: 60, life: 1.6, spread: 18, big: 0.6 });
    burst(ax, ay, top, cols.concat(WOOD_COLS), 30, { up: 80, speed: 3, big: 0.7 });
    crime(4, ax, ay);
    releaseHome(ax, ay);
  } else {
    sfx.buildingCrack();
    shake = Math.max(shake, 3.5);
    burst(ax, ay, top, cols, 18, { up: 60, speed: 2.2, big: 0.5 });
    crime(1.5, ax, ay);
  }
  return true;
}

// Dégâts de zone : `test(rx, ry, d)` dit si la tuile est touchée, `dmgAt(d)` combien.
// Un bâtiment couvre 4 tuiles mais ne prend le coup qu'une fois (celui de sa tuile la plus proche).
function blast(R, test, dmgAt) {
  const blds = new Map();
  for (let ty = Math.floor(player.y - R); ty <= Math.floor(player.y + R); ty++) {
    for (let tx = Math.floor(player.x - R); tx <= Math.floor(player.x + R); tx++) {
      const rx = tx + 0.5 - player.x, ry = ty + 0.5 - player.y, d = Math.hypot(rx, ry);
      if (d > R || !world.objAt(tx, ty) || !test(rx, ry, d)) continue;
      const a = world.anchorOf(tx, ty);
      if (a) { const k = a[0] + ',' + a[1]; blds.set(k, Math.max(blds.get(k) || 0, dmgAt(d))); continue; }
      damage(tx, ty, dmgAt(d));
    }
  }
  for (const [k, dmg] of blds) { const [x, y] = k.split(',').map(Number); damage(x, y, dmg); }
}

// ---------------------------------------------------------------- sol abîmé
const crackMat = (t) => (t === T.SAND ? 'sand' : t === T.STONE || t === T.COBBLE ? 'stone' : t === T.SNOW ? 'snow' : 'earth');
const EARTH_COLS = ['#62402a', '#7a5233', '#4a2f1c', '#8e6440'];

function crackTile(x, y, add) {
  if (!world.walkable(x, y)) return;
  const l = world.wearAt(x, y);
  if (l < 3) world.setWear(x, y, Math.min(3, l + add), stats.play);
}

// Cratère : la tuile s'enfonce d'une marche et l'herbe saute (2 marches au plus sous le sol d'origine).
function craterTile(x, y) {
  if (!world.walkable(x, y)) return;
  const info = OBJ_INFO[world.objAt(x, y)];
  const h = world.hAt(x, y), t = world.typeAt(x, y);
  if ((info && !info.small) || h <= 0 || h <= world.genCell(x, y).h - 2) { crackTile(x, y, 2); return; }
  if (info) world.setObj(x, y, O.NONE);
  const grassy = t === T.GRASS || t === T.FOREST || t === T.MEADOW || t === T.PATH;
  world.setTile(x, y, grassy ? T.DIRT : t, h - 1, stats.play);
  world.setWear(x, y, 3, stats.play);
  const cols = t === T.SAND ? DUST_COLS : t === T.SNOW ? ['#ffffff', '#dfe8f0', '#b8c6d6'] : t === T.STONE || t === T.COBBLE ? ROCK_COLS : EARTH_COLS.concat(grassy ? ['#5fa843'] : []);
  burst(x + 0.5, y + 0.5, h * 8, cols, 10, { up: 70, speed: 1.8, big: 0.6 });
}

// L'herbe repousse et les fissures se referment doucement.
let healT = 0;
function healGround(dt) {
  healT -= dt;
  if (healT > 0) return;
  healT = 3;
  const now = stats.play;
  for (const [k, [l, at]] of world.wear) {
    if (now - at < 80) continue;
    const [x, y] = k.split(',').map(Number);
    world.setWear(x, y, l - 1, now);
  }
  for (const [k, [t, h, at]] of world.terr) {
    if (t !== T.DIRT || now - at < 150) continue;
    const [x, y] = k.split(',').map(Number);
    const base = world.genCell(x, y);
    if (base.t !== T.DIRT) world.setTile(x, y, base.t, h, now);
  }
}

// Enchaînement de boxeur : direct gauche, direct droit, crochet, et ça recommence.
const JABS = ['jabL', 'jabR', 'hook'];
const HIT_AT = { jabL: 0.44, jabR: 0.44, hook: 0.44, bigpunch: 0.22, slam: 0.44 };

function startJab() {
  if (!JABS.includes(player.action) && time - player.lastPunch > 0.45) player.combo = 0; // trop lent : on repart du direct gauche
  const a = JABS[player.combo % JABS.length];
  player.combo++;
  player.punchBuf = false;
  startAction(a);
}

function doPunchHit(strong) {
  const [dx, dy] = dirWorld(player.dir);
  const hx = player.x + dx * 0.85, hy = player.y + dy * 0.85;
  let who = null, wd = 0.85;
  for (const n of npcs) {
    if (n.inside) continue;
    const d = Math.hypot(n.x - hx, n.y - hy);
    if (d < wd) { wd = d; who = n; }
  }
  if (who) { hitNpc(who, strong ? 2 : 1, dx, dy, strong ? 0.35 : 0.15); shake = Math.max(shake, strong ? 2.5 : 1.5); return; }
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
  if (best) { damage(best[0], best[1], strong ? 2 : 1); shake = Math.max(shake, strong ? 2.5 : 1.5); }
  else { burst(hx, hy, gz + 18, ['#ffffff', '#d8e0f0'], 5, { up: 10, g: 0, life: 0.25, speed: 1.2 }); sfx.punchAir(); }
}

// En sprint, Brainless pulvérise tout ce qui se trouve devant lui.
function trample(vx, vy) {
  const fx0 = player.x + vx * 0.45, fy0 = player.y + vy * 0.45;
  for (let ty = Math.floor(fy0) - 1; ty <= Math.floor(fy0) + 1; ty++) {
    for (let tx = Math.floor(fx0) - 1; tx <= Math.floor(fx0) + 1; tx++) {
      const o = world.objAt(tx, ty);
      const info = OBJ_INFO[o];
      if (!info) continue;
      if (info.part || info.building) {
        // il percute une maison : elle encaisse, lui s'arrête net
        const a = world.anchorOf(tx, ty), ai = OBJ_INFO[world.objAt(a[0], a[1])], k = a[0] + ',' + a[1];
        if (ai && ai.box && boxHit(fx0, fy0, a[0], a[1], ai.box + 0.45) && time - (bumpT.get(k) ?? -9) > 0.6) {
          bumpT.set(k, time);
          damage(a[0], a[1], 3);
          shake = Math.max(shake, 4);
        }
        continue;
      }
      const d = Math.hypot(fx0 - (tx + 0.5), fy0 - (ty + 0.5));
      if (d > (info.solid || 0.2) + 0.4) continue;
      // détruit d'un coup, souche et cailloux compris
      while (world.objAt(tx, ty) !== O.NONE && damage(tx, ty, 99)) { /* casse jusqu'au bout */ }
      if (info.solid) shake = Math.max(shake, 3);
    }
  }
  for (const n of npcs) {
    if (n.inside || Math.hypot(n.x - fx0, n.y - fy0) > 0.7 || time - (n.tramT ?? -9) < 0.5) continue;
    n.tramT = time;
    hitNpc(n, 2, vx, vy, 0.45);
  }
}

// Gros coup chargé : une bourrasque part droit devant et rase tout dans un cône.
function doBigPunch(power) {
  const [dx, dy] = dirWorld(player.dir);
  const R = 2.2 + power * 4.5, half = 0.45 + power * 0.15;
  sfx.bigPunch(power);
  shake = Math.min(15, 5 + power * 9);
  windT = 1 + power * 1.5;
  fx.push({ kind: 'cone', x: player.x + dx * 0.5, y: player.y + dy * 0.5, z: player.z + 16, dx, dy, half, r: R, t: 0 });
  fx.push({ kind: 'cone', x: player.x + dx * 0.5, y: player.y + dy * 0.5, z: player.z + 16, dx, dy, half: half * 0.7, r: R * 0.8, t: -0.1 });
  const base = Math.atan2(dy, dx);
  for (let i = 0; i < 50 + power * 120; i++) {
    const a = base + (Math.random() * 2 - 1) * half, sp = 6 + Math.random() * (5 + power * 8);
    particles.push({
      x: player.x + dx * 0.6, y: player.y + dy * 0.6, z: player.z + 6 + Math.random() * 22,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: (Math.random() - 0.5) * 10, g: 0, drag: 1.4,
      life: 0.3 + Math.random() * 0.45, col: Math.random() < 0.75 ? '#ffffff' : '#d8ecff', size: Math.random() < 0.2 ? 2 : 1, streak: true,
    });
  }
  burst(player.x + dx * 0.4, player.y + dy * 0.4, player.z, DUST_COLS, 20 + power * 30, { up: 20, speed: 3 + power * 3, g: 70, life: 0.8, spread: 1 });
  // tout ce qui vole déjà est soufflé vers l'avant
  for (const p of particles) {
    const rx = p.x - player.x, ry = p.y - player.y, d = Math.hypot(rx, ry) || 1;
    if (d < R * 1.5 && (rx * dx + ry * dy) / d > Math.cos(half * 1.3)) { p.vx += dx * 7; p.vy += dy * 7; p.vz += 10; }
  }
  // tout près, ça rase tout ; plus loin, ça abîme sans détruire
  const dmgBase = 2 + power * 8;
  const inCone = (rx, ry, d) => d < 0.9 || (rx * dx + ry * dy) / d > Math.cos(half);
  const dmgAt = (d) => Math.max(1, Math.round(dmgBase * (1 - 0.75 * d / R)));
  blast(R, inCone, dmgAt);
  for (const n of npcs) {
    const rx = n.x - player.x, ry = n.y - player.y, d = Math.hypot(rx, ry) || 0.01;
    if (n.inside || d > R || !inCone(rx, ry, d)) continue;
    hitNpc(n, dmgAt(d), dx * 0.7 + rx / d * 0.3, dy * 0.7 + ry / d * 0.3, power * (1 - d / R) + 0.3);
  }
  // le sol se fend dans le cône, et se creuse juste devant à pleine puissance
  for (let ty = Math.floor(player.y - R); ty <= Math.floor(player.y + R); ty++) {
    for (let tx = Math.floor(player.x - R); tx <= Math.floor(player.x + R); tx++) {
      const rx = tx + 0.5 - player.x, ry = ty + 0.5 - player.y, d = Math.hypot(rx, ry);
      if (d > R * 0.7 || d < 0.4 || !inCone(rx, ry, d)) continue;
      if (power > 0.7 && d < 1.9) craterTile(tx, ty);
      else if (Math.random() < 0.9 - d / R) crackTile(tx, ty, d < R * 0.35 ? 2 : 1);
    }
  }
  if (power > 0.3) sfx.crunch();
  for (const f of flyers) if ((f.x - player.x) * dx + (f.y - player.y) * dy > 0) f.scared = 3;
}

// Frappe au sol après la charge : plus la charge est longue, plus c'est violent.
function doSlam(power) {
  stats.smash++;
  sfx.slam(power);
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
  const base = 2 + power * 8;
  const dmgAt = (d) => Math.max(1, Math.round(base * (1 - 0.75 * d / R)));
  blast(R, () => true, dmgAt);
  for (const n of npcs) {
    const rx = n.x - player.x, ry = n.y - player.y, d = Math.hypot(rx, ry) || 0.01;
    if (!n.inside && d <= R) hitNpc(n, dmgAt(d), rx / d, ry / d, power * (1 - d / R) + 0.25);
  }
  // cratère au centre, fissures tout autour
  for (let ty = Math.floor(player.y - R); ty <= Math.floor(player.y + R); ty++) {
    for (let tx = Math.floor(player.x - R); tx <= Math.floor(player.x + R); tx++) {
      const d = Math.hypot(tx + 0.5 - player.x, ty + 0.5 - player.y);
      if (d > R * 0.8) continue;
      if (power > 0.55 && d < Math.max(1.1, R * 0.28)) craterTile(tx, ty);
      else if (Math.random() < 0.95 - d / R * 0.8) crackTile(tx, ty, d < R * 0.45 ? 2 : 1);
    }
  }
  sfx.crunch();
  for (const f of flyers) f.scared = 3;
}

const CHARGE_COLS = [['#fff3b0', '#ffe28a'], ['#ffb347', '#ff9a3c'], ['#ff5a5a', '#ff2e63']];
function chargeCols() { return CHARGE_COLS[Math.min(2, Math.floor(player.charge * 3))]; }

function chargeEffects(dt, cx = player.x, cy = player.y, cz = player.z) {
  const c = player.charge;
  shake = Math.max(shake, 0.6 + c * 2);
  // énergie aspirée vers Brainless
  const n = (25 + c * 70) * dt;
  for (let i = 0; i < n + (Math.random() < n % 1 ? 1 : 0); i++) {
    const a = Math.random() * Math.PI * 2, d = 1.3 + Math.random() * 1.2, life = 0.35 + Math.random() * 0.2;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    particles.push({
      x, y, z: cz + Math.random() * 22 - (cz - player.z) * 0.5, vx: -Math.cos(a) * d / life, vy: -Math.sin(a) * d / life, vz: 8,
      g: 0, drag: 0, life, col: chargeCols()[(Math.random() * 2) | 0], size: Math.random() < 0.3 ? 2 : 1, streak: true,
    });
  }
  // poussière et cailloux qui se soulèvent
  if (Math.random() < dt * (6 + c * 20)) {
    const a = Math.random() * Math.PI * 2, d = 0.5 + Math.random() * 1.5;
    burst(player.x + Math.cos(a) * d, player.y + Math.sin(a) * d, player.z, DUST_COLS.concat(ROCK_COLS), 1, { up: 30 + c * 40, speed: 0.2, g: 60, life: 0.8, spread: 0 });
  }
}

function surfaceAt(x, y) {
  const t = world.typeAt(Math.floor(x), Math.floor(y));
  return t === T.SAND ? 'sand' : t === T.SNOW ? 'snow' : t === T.STONE || t === T.COBBLE ? 'stone' : 'grass';
}

function land() {
  if (waterDepth(player.x, player.y)) { player.air = false; player.jz = 0; player.vz = 0; splash(1); return; }
  sfx.land(player.sprinting);
  player.air = false;
  player.jz = 0;
  player.vz = 0;
  const hard = player.sprinting;
  shake = Math.max(shake, hard ? 4 : 2.5);
  burst(player.x, player.y, player.z, DUST_COLS, hard ? 18 : 10, { up: 20, speed: 2.2, g: 60, life: 0.6, spread: 1 });
  if (hard) crackTile(Math.floor(player.x), Math.floor(player.y), 1);
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
  stats.play += dt;
  starFlash = Math.max(0, starFlash - dt);
  if (msg && (msg.t -= dt) <= 0) msg = null;
  tod = (tod + dt / DAY_LENGTH) % 1;
  hintT -= dt;
  windT = Math.max(0, windT - dt);
  if (shake > lastShake + 0.8) rumble(shake / 12, 60 + shake * 20); // la manette vibre avec l'écran
  shake = Math.max(0, shake - dt * 20);
  lastShake = shake;

  let ix = input.x, iy = input.y;
  const kb = keyboardVector();
  if (kb) [ix, iy] = kb;
  const pv = readPad();
  if (pv) [ix, iy] = pv;
  const mag = Math.min(1, Math.hypot(ix, iy));
  const wasSprinting = player.sprinting && !player.air;
  const prevMv = player.mv;

  if (player.dead) {
    updateDead(dt);
    input.punch = input.jump = false;
  } else {
    // --- saut
    if (input.jump && !player.air && !player.action && !player.charging && !player.slide && player.water < 2) {
      player.air = true;
      player.vz = JUMP_V * (player.sprinting ? 1.1 : 1);
      sfx.jump();
      burst(player.x, player.y, player.z, DUST_COLS, 6, { up: 15, speed: 1.2, g: 60, life: 0.5, spread: 1 });
    }
    if (player.air) {
      player.vz -= GRAVITY * dt;
      player.jz += player.vz * dt;
      if (player.jz <= 0 && player.vz < 0) land();
    }

    // --- charge (maintenir B) puis frappe au sol au relâchement
    if (!player.action && !player.air && !player.slide && player.water < 2) {
      if (chargeHeld() && player.chargeKind !== 'punch') {
        if (!player.charging) { player.charging = true; player.chargeKind = 'slam'; player.charge = 0; player.sprinting = false; setAnim('charge'); chargeStart(); }
        player.charge = Math.min(1, player.charge + dt / 1.6);
        chargeEffects(dt);
        chargeUpdate(player.charge);
      } else if (player.charging && player.chargeKind === 'slam') {
        player.charging = false;
        player.chargeKind = null;
        chargeStop();
        sfx.roar(player.charge);
        player.slamPower = player.charge;
        startAction('slam');
      }
    }

    // --- coups : tapoter = enchaînement, maintenir = il arme un gros coup
    const canPunch = !player.air && !player.slide && player.water < 2 && player.chargeKind !== 'slam';
    player.punchHoldT = punchHeld() ? player.punchHoldT + dt : 0;
    if (canPunch) {
      if (player.charging && player.chargeKind === 'punch') {
        if (punchHeld()) {
          player.charge = Math.min(1, player.charge + dt / 1.3);
          const [dx, dy] = dirWorld(player.dir), [rx, ry] = dirWorld((player.dir + 2) % 8);
          chargeEffects(dt, player.x - dx * 0.35 + rx * 0.3, player.y - dy * 0.35 + ry * 0.3, player.z + 18);
          chargeUpdate(player.charge);
        } else {
          player.charging = false;
          player.chargeKind = null;
          chargeStop();
          sfx.roar(player.charge * 0.6);
          player.punchPower = player.charge;
          startAction('bigpunch');
        }
      } else if (player.punchHoldT > 0.25 && !player.charging &&
        (!player.action || (JABS.includes(player.action) && player.actionT > 0.5))) {
        player.action = null;
        player.charging = true;
        player.chargeKind = 'punch';
        player.charge = 0;
        player.sprinting = false;
        setAnim('pcharge');
        chargeStart();
      } else if (input.punch && !player.charging) {
        if (!player.action) startJab();
        else if (JABS.includes(player.action)) player.punchBuf = true; // le coup suivant part dès que possible
      }
    }
    input.punch = input.jump = false;

    if (player.slide) {
      updateSlide(dt);
    } else if (player.action) {
      const A = ANIMS[player.action];
      const dur = A.frames / A.fps;
      const prev = player.actionT;
      player.actionT += dt / dur;
      const act = player.action;
      const hitAt = HIT_AT[act] ?? 0.4;
      if (prev < hitAt && player.actionT >= hitAt) {
        if (JABS.includes(act)) doPunchHit(act === 'hook');
        else if (act === 'bigpunch') doBigPunch(player.punchPower);
        else doSlam(player.slamPower);
      }
      // petit pas en avant à chaque coup, grosse fente pour le coup chargé
      const [dx, dy] = dirWorld(player.dir);
      if (JABS.includes(act) && player.actionT > 0.1 && player.actionT < hitAt) tryMove(dx * dt * 1.6, dy * dt * 1.6);
      if (act === 'bigpunch' && player.actionT < 0.3) tryMove(dx * dt * 4.5, dy * dt * 4.5);
      if (JABS.includes(act) && player.punchBuf && player.actionT >= 0.6) startJab();
      else if (player.actionT >= 1) {
        if (JABS.includes(act)) player.lastPunch = time;
        player.action = null;
        player.t = 0;
      }
      player.sprinting = false;
    } else if (!player.charging) {
      // Sprint à quatre pattes (bouton SPRINT) : vide la barre ; vide, il faut qu'elle remonte à 35 %.
      if (player.stamina <= 0 && !player.tired) { player.tired = true; sfx.tired(); }
      if (player.tired && player.stamina >= 0.35) player.tired = false;
      // Petite tolérance : un joystick qui repasse par le centre pendant un demi-tour ne coupe pas le sprint.
      player.idleT = mag > 0.15 ? 0 : player.idleT + dt;
      const coasting = wasSprinting && player.mv && player.idleT < 0.12 && sprintHeld();
      const run = sprintHeld() && !player.tired && (mag > 0.15 || coasting);
      if (!player.air) player.sprinting = run;
      if (mag > 0.15) {
        const cx = ix / mag, ct = iy / mag;
        const vx = (cx + ct) / Math.SQRT2, vy = (ct - cx) / Math.SQRT2;
        const newDir = ((Math.round(Math.atan2(ct, cx) / (Math.PI / 4)) % 8) + 8) % 8;
        if (player.sprinting && !player.air && !player.water && player.mv && vx * player.mv[0] + vy * player.mv[1] < -0.35) {
          startSlide('skid', newDir); // demi-tour violent
        } else {
          const speed = player.water === 2 ? (player.sprinting ? 4.6 : 1.9) : (player.sprinting ? 5.8 : 2.2) * (player.water ? 0.62 : 1);
          if (player.sprinting && !player.air) trample(vx, vy);
          tryMove(vx * speed * dt, vy * speed * dt);
          player.dir = newDir;
          player.mv = player.sprinting ? [vx, vy] : null;
          setAnim(player.water === 2 ? (player.sprinting ? 'swimfast' : 'swim') : player.sprinting ? 'run' : 'walk');
          if (player.water === 2) swimStrokes(vx, vy);
          else if (!player.sprinting && !player.air) walkSteps();
          if (player.sprinting && !player.air && player.water !== 2) sprintImpacts(vx, vy);
        }
      } else if (coasting && run) {
        tryMove(player.mv[0] * 5.8 * dt, player.mv[1] * 5.8 * dt);
      } else {
        setAnim(player.water === 2 ? 'tread' : 'idle');
        if (player.water === 2) swimStrokes(0, 0);
        if (!player.air) player.sprinting = false;
      }
      // il lâche le sprint en pleine course : il freine
      if (wasSprinting && !player.sprinting && !player.slide && !player.air && !player.water && prevMv) {
        player.mv = prevMv;
        startSlide('brake', player.dir);
      }
      if (!player.sprinting && !player.slide) player.mv = null;
    }
    if (player.sprinting && !player.air) player.stamina = Math.max(0, player.stamina - dt / 4.5);
    else if (!player.sprinting) player.stamina = Math.min(1, player.stamina + dt / (player.tired ? 3 : 5));
    const A = ANIMS[player.anim];
    player.t += dt * A.fps * (player.charging ? 1 + player.charge * 1.8 : 1);
  }

  const depth = waterDepth(player.x, player.y);
  if (depth && !player.water && !player.air) splash(depth === 2 || wasSprinting ? 1 : 0.5);
  player.water = player.air ? 0 : depth;
  const sink = depth === 2 ? (SINK_ANIM[player.anim] ?? SINK[2]) : SINK[depth];
  const gz = depth ? WATER_LINE - sink : groundZ(player.x, player.y);
  player.z += (gz - player.z) * Math.min(1, dt * (depth ? 8 : 14));
  if (depth && (mag > 0.15 || Math.random() < dt * 2)) {
    player.rippleT = (player.rippleT || 0) - dt;
    if (player.rippleT <= 0) {
      player.rippleT = mag > 0.15 ? 0.35 : 1.2;
      fx.push({ kind: 'ripple', x: player.x, y: player.y, t: 0 });
    }
  }

  for (const [k, st] of hits) { st.shake = Math.max(0, st.shake - dt); }
  updateHealth(dt);
  updateVillages(dt);
  updateKnights(dt);
  updateNpcs(dt);
  updateHeat(dt);
  healGround(dt);

  updateParticles(dt);
  for (let i = decals.length - 1; i >= 0; i--) if ((decals[i].age += dt) > 9) decals.splice(i, 1);
  updateAmbience(dt, { night: darkness() > 0.5, water: waterNearby(), height: world.hAt(Math.floor(player.x), Math.floor(player.y)) });
  updateFlyers(dt);
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.t += dt;
    if (f.kind === 'fall' && f.t > 0.75 && !f.done) {
      f.done = true;
      sfx.treeCrash();
      const ex = f.x + f.side * 1.2, ey = f.y - f.side * 1.2;
      burst(ex, ey, f.gz + 6, f.leaves, 26, { leaf: true, up: 25, g: 30, life: 1.6, spread: 10 });
      burst(ex, ey, f.gz, DUST_COLS, 14, { up: 25, speed: 2 });
      shake = Math.max(shake, 3);
    }
    if ((f.kind === 'collapse' && f.t > 0.7) || (f.kind === 'ring' && f.t > 0.6) || (f.kind === 'fall' && f.t > 0.95) || (f.kind === 'ripple' && f.t > 1.1) || (f.kind === 'cone' && f.t > 0.5)) fx.splice(i, 1);
  }
}

// Chaque fois que les mains puis les pattes frappent le sol pendant le galop : secousse + poussière.
// Bruits de pas quand il marche : au moment où chaque pied touche le sol.
function walkSteps() {
  const fi = Math.floor(player.t) % ANIMS.walk.frames;
  if (fi === player.runFrame) return;
  player.runFrame = fi;
  if (fi === 2 || fi === 6) {
    if (player.water) { sfx.splash(0.3); burst(player.x, player.y, WATER_LINE, WATER_COLS, 4, { up: 30, speed: 0.6, g: 120, life: 0.4, spread: 0 }); }
    else sfx.step(surfaceAt(player.x, player.y));
  }
}

function swimStrokes(vx, vy) {
  const anim = player.anim;
  const fi = Math.floor(player.t) % ANIMS[anim].frames;
  if (fi === player.runFrame) return;
  player.runFrame = fi;
  const [dx, dy] = dirWorld(player.dir);
  if (anim === 'swimfast') {
    // les deux bras s'abattent ensemble : grosse gerbe, sillage, secousse
    if (fi === 3) {
      sfx.splash(0.8);
      sfx.gallop(true, 'water');
      shake = Math.max(shake, 2.5);
      burst(player.x + dx * 0.55, player.y + dy * 0.55, WATER_LINE, WATER_COLS, 22, { up: 75, speed: 2.2, g: 150, life: 0.7, spread: 2, big: 0.6 });
      fx.push({ kind: 'ripple', x: player.x + dx * 0.5, y: player.y + dy * 0.5, t: 0, big: true });
    }
    if (fi % 2 === 0) {
      // sillage en V derrière lui
      const px = -vy, py = vx;
      for (const side of [-1, 1]) {
        burst(player.x - vx * 0.5 + px * side * 0.35, player.y - vy * 0.5 + py * side * 0.35, WATER_LINE, WATER_COLS, 3, { up: 25, speed: 0.6, g: 120, life: 0.5, spread: 0 });
      }
      fx.push({ kind: 'ripple', x: player.x - vx * 0.3, y: player.y - vy * 0.3, t: 0 });
    }
  } else if (anim === 'swim') {
    if (fi === 1 || fi === 5) {
      sfx.stroke();
      burst(player.x + dx * 0.4, player.y + dy * 0.4, WATER_LINE, WATER_COLS, 5, { up: 35, speed: 0.8, g: 130, life: 0.45, spread: 0 });
    }
  } else if (fi === 0 || fi === 4) {
    // sur place : petits remous de chaque côté
    sfx.stroke();
    const px = -dy, py = dx, side = fi === 0 ? 1 : -1;
    burst(player.x + px * side * 0.4, player.y + py * side * 0.4, WATER_LINE, WATER_COLS, 3, { up: 20, speed: 0.5, g: 120, life: 0.35, spread: 0 });
  }
}

const WATER_COLS = ['#ffffff', '#d8eefb', '#8cc6ee'];
function splash(power) {
  sfx.splash(power);
  burst(player.x, player.y, WATER_LINE, WATER_COLS, Math.round(10 + power * 20), { up: 50 + power * 40, speed: 1.2 + power, g: 140, life: 0.6, spread: 0, big: 0.5 });
  fx.push({ kind: 'ripple', x: player.x, y: player.y, t: 0, big: true });
}

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
  sfx.gallop(front, surfaceAt(player.x, player.y));
  if (front && Math.random() < 0.35) sfx.breath();
}

// Proportion d'eau autour de Brainless (pour le clapotis).
let waterCache = { t: -1, v: 0 };
function waterNearby() {
  if (time - waterCache.t < 0.5) return waterCache.v;
  let n = 0;
  const px = Math.floor(player.x), py = Math.floor(player.y);
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (!world.walkable(px + dx, py + dy)) n++;
  waterCache = { t: time, v: Math.min(1, n / 25) };
  return waterCache.v;
}

// ---------------------------------------------------------------- vie de Brainless
function hurtPlayer(dmg, fx0, fy0) {
  if (player.dead || player.invuln > 0) return;
  player.hp -= dmg;
  player.lastHurt = time;
  player.invuln = 0.3;
  player.flash = 0.18;
  player.regen = false;
  const dx = player.x - fx0, dy = player.y - fy0, l = Math.hypot(dx, dy) || 1;
  player.kb = [dx / l * 3, dy / l * 3];
  shake = Math.max(shake, 3);
  sfx.playerHit();
  rumble(0.5, 120);
  burst(player.x, player.y, player.z + 22, ['#fff3b0', '#ffffff', '#8086c4'], 6, { up: 30, speed: 1.5, life: 0.35 });
  if (player.hp <= 0) playerDown();
}

function playerDown() {
  player.hp = 0;
  player.dead = { t: 0, moved: false };
  player.action = null; player.charging = false; player.chargeKind = null;
  chargeStop();
  player.slide = null; player.sprinting = false; player.air = false; player.jz = 0; player.vz = 0; player.mv = null; player.kb = null;
  sfx.down();
  shake = Math.max(shake, 5);
}

// Il s'effondre, l'écran tombe au noir, il se réveille au point de départ, régénéré.
function updateDead(dt) {
  const D = player.dead;
  D.t += dt;
  if (D.t > 3.4 && !D.moved) {
    D.moved = true;
    const sp = world.findSpawn();
    player.x = sp.x; player.y = sp.y; player.z = groundZ(sp.x, sp.y);
    player.hp = 100;
    heat = 0; crimeVillage = null;
    for (let i = npcs.length - 1; i >= 0; i--) {
      const n = npcs[i];
      if (n.kind === 'knight' && !n.guard) npcs.splice(i, 1);
      else if (n.guard) { n.state = 'guard'; n.wait = 1; }
      else if (n.state === 'flee') { n.state = 'wander'; n.wait = 1; }
    }
    showMsg('SUPER REGENERATION', 3);
    sfx.regen();
  }
  if (D.t > 4.2) { player.dead = null; player.anim = 'idle'; player.t = 0; }
}

function updateHealth(dt) {
  player.invuln -= dt;
  player.flash -= dt;
  if (player.kb) {
    tryMove(player.kb[0] * dt, player.kb[1] * dt);
    player.kb[0] *= Math.exp(-8 * dt); player.kb[1] *= Math.exp(-8 * dt);
    if (Math.hypot(player.kb[0], player.kb[1]) < 0.1) player.kb = null;
  }
  // Super régénération : quelques secondes sans coup, et ses blessures se referment.
  if (!player.dead && player.hp < 100 && time - player.lastHurt > 3) {
    if (!player.regen) { player.regen = true; sfx.regen(); }
    player.hp = Math.min(100, player.hp + 22 * dt);
    if (Math.random() < dt * 10) {
      burst(player.x + (Math.random() - 0.5) * 0.6, player.y + (Math.random() - 0.5) * 0.6, player.z + 6 + Math.random() * 20,
        ['#8f9cff', '#c9d0ff', '#ff8a9a'], 1, { up: 18, g: -10, speed: 0.1, life: 0.8, spread: 0 });
    }
  } else if (player.hp >= 100) player.regen = false;
}

// ---------------------------------------------------------------- villageois et chevaliers
function vstateOf(v) {
  let st = vstate.get(v.id);
  if (!st) vstate.set(v.id, st = { populated: false });
  return st;
}

function villageAt(x, y, margin = 6) {
  for (const v of world.villagesNear(x, y)) if (Math.hypot(x - v.cx, y - v.cy) < v.R + margin) return v;
  return null;
}

// Un méfait près d'un village : la méchanceté monte, les villageois proches s'enfuient.
function crime(amount, x, y) {
  const v = villageAt(x, y, 8);
  if (!v) return;
  const before = stars();
  heat = Math.min(50, heat + amount);
  lastCrime = time;
  crimeVillage = v;
  for (const n of npcs) if (n.kind === 'civ' && !n.inside && Math.hypot(n.x - x, n.y - y) < 14) startFlee(n);
  if (stars() > before) { sfx.bell(); starFlash = 1.5; }
}

function updateHeat(dt) {
  if (heat <= 0) return;
  // tant qu'un chevalier le talonne, on ne l'oublie pas
  const chased = npcs.some((n) => n.kind === 'knight' && (n.state === 'chase' || n.state === 'attack') && Math.hypot(n.x - player.x, n.y - player.y) < 9);
  if (time - lastCrime > 8 && !chased) heat = Math.max(0, heat - dt * 1.5);
  if (heat === 0) crimeVillage = null;
}

function freeSpot(x, y) {
  const tx = Math.floor(x), ty = Math.floor(y), info = OBJ_INFO[world.objAt(tx, ty)];
  return world.walkable(tx, ty) && !(info && (info.solid || info.part || info.building));
}

function spawnNpc(type, x, y, v, home) {
  const D = PEOPLE[type];
  const n = {
    type, kind: D.kind, x, y, z: groundZ(x, y), jz: 0, vz: 0, vx: 0, vy: 0, air: false,
    dir: (Math.random() * 8) | 0, anim: 'idle', t: Math.random() * 4, state: D.kind === 'knight' ? 'chase' : 'wander',
    v: v.id, home, tx: x, ty: y, wait: Math.random() * 3, koT: 0, hp: D.kind === 'knight' ? 4 : 1,
    alertT: 0, atkT: 0, cd: 0, hurtT: 0, flash: 0, waveT: 0, waveCd: 3 + Math.random() * 8, inside: false, stuck: 0,
    speedK: type === 'child' ? 1.1 : type === 'elder' ? 0.55 : 1, fj: 0,
  };
  npcs.push(n);
  return n;
}

function populate(v) {
  const homes = v.houses.filter((h) => h.type !== 'tower' && h.type !== 'barn');
  const count = Math.min(12, 2 + v.houses.length);
  for (let i = 0; i < count; i++) {
    const home = homes.length ? homes[i % homes.length] : null;
    const type = CIVILIANS[(Math.random() * CIVILIANS.length) | 0];
    for (let k = 0; k < 20; k++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * v.R * 0.8;
      const x = v.cx + 0.5 + Math.cos(a) * d, y = v.cy + 0.5 + Math.sin(a) * d;
      if (freeSpot(x, y)) { spawnNpc(type, x, y, v, home); break; }
    }
  }
  // un garde patrouille dans les villages qui ont une tour
  if (v.tower) {
    const [x, y] = v.tower.door;
    if (freeSpot(x, y)) { const g = spawnNpc('knight', x, y, v, null); g.state = 'guard'; g.guard = true; }
  }
}

let villageT = 0, curVillage = null;
function updateVillages(dt) {
  villageT -= dt;
  if (villageT > 0) return;
  villageT = 1;
  const near = world.villagesNear(player.x, player.y);
  for (const v of near) {
    if (Math.hypot(player.x - v.cx, player.y - v.cy) < v.R + 28 && !vstateOf(v).populated) { vstateOf(v).populated = true; populate(v); }
  }
  // on oublie les villages lointains (ils se repeupleront au retour)
  for (const [id, st] of vstate) {
    if (!st.populated) continue;
    const v = world.villages.get(id);
    if (v && Math.hypot(player.x - v.cx, player.y - v.cy) < v.R + 40) continue;
    st.populated = false;
    for (let i = npcs.length - 1; i >= 0; i--) if (npcs[i].v === id && (npcs[i].kind === 'civ' || npcs[i].guard)) npcs.splice(i, 1);
  }
  const inside = near.find((v) => Math.hypot(player.x - v.cx, player.y - v.cy) < v.R + 3);
  if (inside && inside !== curVillage && !player.dead) showMsg(inside.name, 2.5);
  if (inside) curVillage = inside;
  else if (curVillage && Math.hypot(player.x - curVillage.cx, player.y - curVillage.cy) > curVillage.R + 10) curVillage = null;
}

// Les chevaliers arrivent par la tour (ou les portes du village) selon le nombre d'étoiles.
let knightT = 0;
function updateKnights(dt) {
  knightT -= dt;
  const want = [0, 1, 2, 3, 5, 7][stars()];
  const active = npcs.filter((n) => n.kind === 'knight' && !n.beaten && n.state !== 'guard' && n.state !== 'leave').length;
  if (want <= active || knightT > 0 || !crimeVillage || player.dead) return;
  knightT = 2.2;
  const g = npcs.find((n) => n.state === 'guard');
  if (g) { g.state = 'chase'; g.alertT = 1.2; return; }
  const v = crimeVillage;
  let spot = null;
  for (const h of (v.tower ? [v.tower] : []).concat(v.houses)) {
    const [x, y] = h.door;
    if (Math.hypot(x - player.x, y - player.y) < 22 && freeSpot(x, y) && homeIntact(h)) { spot = [x, y]; break; }
  }
  for (let k = 0; k < 20 && !spot; k++) {
    const a = Math.random() * Math.PI * 2, x = player.x + Math.cos(a) * 12, y = player.y + Math.sin(a) * 12;
    if (freeSpot(x, y)) spot = [x, y];
  }
  if (!spot) return;
  spawnNpc('knight', spot[0], spot[1], v, null).alertT = 1.2;
}

function startFlee(n) {
  if (n.kind !== 'civ' || (n.state === 'ko')) return;
  if (n.state !== 'flee') {
    n.alertT = 1.2;
    n.fj = (Math.random() - 0.5) * 1.2;
    sfx.scream(PEOPLE[n.type].voice * (0.9 + Math.random() * 0.2));
  }
  n.state = 'flee';
  n.fleeT = 4 + Math.random() * 3;
}

const homeIntact = (h) => h && OBJ_INFO[world.objAt(h.ax, h.ay)] && OBJ_INFO[world.objAt(h.ax, h.ay)].state < 2;

// Une maison s'effondre : ceux qui dormaient dedans sortent en courant.
function releaseHome(ax, ay) {
  for (const n of npcs) {
    if (!n.home || n.home.ax !== ax || n.home.ay !== ay) continue;
    if (n.inside) { n.inside = false; n.x = n.home.door[0]; n.y = n.home.door[1]; n.z = groundZ(n.x, n.y); }
    startFlee(n);
  }
}

function hitNpc(n, dmg, kx, ky, power) {
  if (n.inside) return;
  n.flash = 0.15;
  if (n.kind === 'knight') {
    sfx.clank();
    burst(n.x, n.y, n.z + n.jz + 16, ['#fff3b0', '#ffffff', '#dfe5ee'], 6, { up: 40, speed: 1.6, life: 0.4 });
    crime(0.4, n.x, n.y);
  } else {
    sfx.land(false);
    crime(2.5, n.x, n.y);
  }
  if (n.state === 'ko') {
    n.vx += kx * 2; n.vy += ky * 2;
    if (!n.air) { n.air = true; n.vz = 40; n.jz = 0.5; }
    return;
  }
  n.hp -= dmg;
  if (n.hp > 0) { n.state = 'hurt'; n.hurtT = 0.35; n.vx = kx * 3; n.vy = ky * 3; return; }
  // KO : il vole et retombe sur le dos, des étoiles plein la tête
  n.state = 'ko';
  n.koT = 4 + power * 4;
  n.air = true;
  n.vx = kx * (2.5 + power * 7); n.vy = ky * (2.5 + power * 7);
  n.vz = 50 + power * 110; n.jz = Math.max(n.jz, 0.5);
  if (n.kind === 'knight') { stats.knights++; n.beaten = true; } else sfx.scream(PEOPLE[n.type].voice * 1.15);
  shake = Math.max(shake, 2 + power * 3);
}

function npcMove(n, dx, dy) {
  const feet = n.z + n.jz;
  let moved = false;
  if (!blockedFor(n, n.x + dx, n.y, feet, true)) { n.x += dx; moved = true; }
  if (!blockedFor(n, n.x, n.y + dy, feet, true)) { n.y += dy; moved = true; }
  return moved;
}

// direction monde -> une des 8 directions du sprite (l'inverse de dirWorld)
function faceDir(dx, dy) {
  return ((Math.round(Math.atan2(dx + dy, dx - dy) / (Math.PI / 4)) % 8) + 8) % 8;
}

// Avance vers (tx, ty) ; s'il est bloqué, il tente de contourner par le côté.
function steer(n, tx, ty, speed, dt) {
  let dx = tx - n.x, dy = ty - n.y;
  const d = Math.hypot(dx, dy) || 1;
  dx /= d; dy /= d;
  const step = Math.min(d, speed * dt);
  for (const a of [0, 0.7, -0.7, 1.5, -1.5]) {
    const c = Math.cos(a), sn = Math.sin(a), rx = dx * c - dy * sn, ry = dx * sn + dy * c;
    if (npcMove(n, rx * step, ry * step)) { n.dir = faceDir(rx, ry); if (a) n.stuck += dt; else n.stuck = 0; return true; }
  }
  n.stuck += dt;
  return false;
}

function pickTarget(n) {
  const v = world.villages.get(n.v);
  if (!v) return;
  for (let k = 0; k < 10; k++) {
    const a = Math.random() * Math.PI * 2, d = Math.random() * v.R * 0.85;
    const x = v.cx + 0.5 + Math.cos(a) * d, y = v.cy + 0.5 + Math.sin(a) * d;
    if (freeSpot(x, y)) { n.tx = x; n.ty = y; return; }
  }
}

function updateNpcs(dt) {
  const night = darkness() > 0.6;
  for (let i = npcs.length - 1; i >= 0; i--) {
    const n = npcs[i];
    n.alertT = Math.max(0, n.alertT - dt); n.flash = Math.max(0, n.flash - dt);
    n.cd -= dt; n.waveCd -= dt;
    if (n.inside) {
      // la nuit, ils dorment chez eux ; ils ressortent au matin
      if (!night) { n.inside = false; n.state = 'wander'; n.wait = 1 + Math.random() * 3; }
      continue;
    }
    if (n.air) {
      n.vz -= 300 * dt;
      n.jz += n.vz * dt;
      if (!npcMove(n, n.vx * dt, n.vy * dt)) { n.vx *= -0.3; n.vy *= -0.3; }
      if (n.jz <= 0 && n.vz < 0) {
        n.jz = 0; n.air = false; n.vx *= 0.25; n.vy *= 0.25;
        burst(n.x, n.y, n.z, DUST_COLS, 6, { up: 20, speed: 1.2, g: 60, life: 0.5, spread: 1 });
        if (n.kind === 'knight') sfx.knightDown(); else sfx.step('grass', 0.6);
      }
    } else if (Math.abs(n.vx) + Math.abs(n.vy) > 0.05) {
      npcMove(n, n.vx * dt, n.vy * dt);
      const k = Math.exp(-8 * dt);
      n.vx *= k; n.vy *= k;
    }
    n.z += (groundZ(n.x, n.y) - n.z) * Math.min(1, dt * 12);
    const d = Math.hypot(player.x - n.x, player.y - n.y);
    let anim = 'idle';
    switch (n.state) {
      case 'ko':
        anim = 'ko';
        if (!n.air && (n.koT -= dt) <= 0) {
          if (n.kind === 'knight') n.state = 'leave'; else startFlee(n);
        }
        break;
      case 'hurt':
        anim = 'hurt';
        if ((n.hurtT -= dt) <= 0) n.state = 'chase';
        break;
      case 'flee': {
        anim = 'flee';
        const ax = n.x - player.x, ay = n.y - player.y, l = Math.hypot(ax, ay) || 1;
        const c = Math.cos(n.fj), sn = Math.sin(n.fj);
        steer(n, n.x + (ax * c - ay * sn) / l * 2, n.y + (ax * sn + ay * c) / l * 2, 3.2 * n.speedK, dt);
        if (n.stuck > 0.6) { n.fj = (Math.random() - 0.5) * 3; n.stuck = 0; }
        if ((n.fleeT -= dt) <= 0 && d > 11 && time - lastCrime > 6) { n.state = 'wander'; n.wait = 2; }
        break;
      }
      case 'wander':
      case 'guard':
        if (n.state === 'wander' && night && homeIntact(n.home)) {
          anim = 'walk';
          const [hx, hy] = n.home.door;
          steer(n, hx, hy, 1.1 * n.speedK, dt);
          if (Math.hypot(hx - n.x, hy - n.y) < 0.4 || n.stuck > 3) n.inside = true;
          break;
        }
        if (n.kind === 'civ' && heat >= 1 && d < 7) { startFlee(n); break; }
        if (n.wait > 0) {
          n.wait -= dt;
          // au calme, ils saluent le monstre qui passe
          if (n.kind === 'civ' && heat < 1 && d < 4.5 && n.waveCd <= 0 && !player.dead) {
            n.waveT = 2; n.waveCd = 14 + Math.random() * 10;
            sfx.hello(PEOPLE[n.type].voice);
          }
          if (n.waveT > 0) { n.waveT -= dt; anim = 'wave'; n.dir = faceDir(player.x - n.x, player.y - n.y); }
        } else {
          anim = 'walk';
          steer(n, n.tx, n.ty, (n.kind === 'knight' ? 1.4 : 1.1) * n.speedK, dt);
          if (n.stuck > 0.8 || Math.hypot(n.tx - n.x, n.ty - n.y) < 0.15) {
            n.wait = 1.5 + Math.random() * 4; n.stuck = 0;
            pickTarget(n);
          }
        }
        break;
      case 'chase':
        if (heat <= 0) { n.state = n.guard ? 'guard' : 'leave'; break; }
        if (player.dead) break;
        if (d > 0.95) {
          anim = d > 3 ? 'run' : 'walk';
          steer(n, player.x, player.y, d > 3 ? 3 : 2, dt);
        } else {
          n.dir = faceDir(player.x - n.x, player.y - n.y);
          if (n.cd <= 0) { n.state = 'attack'; n.atkT = 0; n.hitDone = false; sfx.swordSwing(); }
        }
        break;
      case 'attack':
        anim = 'attack';
        n.atkT += dt / 0.5;
        if (!n.hitDone && n.atkT >= 0.55) {
          n.hitDone = true;
          if (Math.hypot(player.x - n.x, player.y - n.y) < 1.35) hurtPlayer(7, n.x, n.y);
        }
        if (n.atkT >= 1) { n.state = 'chase'; n.cd = 0.8 + Math.random() * 0.6; }
        break;
      case 'leave': {
        anim = 'walk';
        if (!n.beaten && heat >= 1) { n.state = 'chase'; break; }
        const ax = n.x - player.x, ay = n.y - player.y, l = Math.hypot(ax, ay) || 1;
        steer(n, n.x + ax / l * 2, n.y + ay / l * 2, 1.6, dt);
        if (d > 18) { npcs.splice(i, 1); continue; }
        break;
      }
    }
    if (n.anim !== anim) { n.anim = anim; n.t = 0; }
    n.t += dt * PEOPLE_ANIMS[n.kind][anim].fps;
  }
  // ils ne se marchent pas dessus, et s'écartent du chemin de Brainless
  for (let i = 0; i < npcs.length; i++) {
    const a = npcs[i];
    if (a.inside || a.air) continue;
    for (let j = i + 1; j < npcs.length; j++) {
      const b = npcs[j];
      if (b.inside || b.air) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d > 0.45 || d === 0) continue;
      const k = (0.45 - d) / d * 0.5;
      npcMove(a, -dx * k, -dy * k); npcMove(b, dx * k, dy * k);
    }
    const dx = a.x - player.x, dy = a.y - player.y, d = Math.hypot(dx, dy);
    if (d < 0.6 && d > 0 && !player.dead) npcMove(a, dx / d * (0.6 - d), dy / d * (0.6 - d));
  }
}

// ---------------------------------------------------------------- dérapages
const SLIDE = { skid: { dur: 0.62, v0: 6.2 }, brake: { dur: 0.5, v0: 5.8 } };
const decals = []; // traces au sol

function startSlide(kind, newDir) {
  const [vx, vy] = player.mv;
  player.slide = { kind, t: 0, vx, vy, dustT: 0, newDir, lx: player.x, ly: player.y, ...SLIDE[kind] };
  player.sprinting = false;
  player.mv = null;
  if (kind === 'skid') player.dir = newDir; // il est déjà retourné, il glisse à reculons
  setAnim(kind);
  sfx.skid(SLIDE[kind].dur, kind === 'skid');
  shake = Math.max(shake, kind === 'skid' ? 3 : 2);
}

function updateSlide(dt) {
  const s = player.slide;
  s.t += dt;
  const u = Math.min(1, s.t / s.dur);
  const sp = s.v0 * (1 - u) * (1 - u * 0.3);
  tryMove(s.vx * sp * dt, s.vy * sp * dt);
  if (sp > 2.5) trample(s.vx, s.vy);
  shake = Math.max(shake, (s.kind === 'skid' ? 1.6 : 1) * (1 - u));
  // traces continues entre la position précédente et l'actuelle, même si les images sautent
  const dist = Math.hypot(player.x - s.lx, player.y - s.ly);
  const n = Math.ceil(dist / 0.05);
  for (let i = 1; i <= n; i++) addSkidMarks(s, s.lx + (player.x - s.lx) * i / n, s.ly + (player.y - s.ly) * i / n);
  s.lx = player.x; s.ly = player.y;
  s.dustT -= dt;
  if (s.dustT <= 0) {
    s.dustT = 0.04;
    const t = world.typeAt(Math.floor(player.x), Math.floor(player.y));
    const cols = t === T.SNOW ? ['#ffffff', '#dfe8f0'] : t === T.SAND ? DUST_COLS : ['#c9b58f', '#a8946e', '#6b4a2e', '#5fa843'];
    burst(player.x - s.vx * 0.2, player.y - s.vy * 0.2, player.z, cols, 3, { up: 30 * (1 - u) + 8, speed: 1.5, g: 70, life: 0.5, spread: 1 });
  }
  if (u >= 1) {
    player.slide = null;
    player.t = 0;
    // demi-tour fini et sprint toujours tenu : il repart aussitôt dans l'autre sens
    if (s.kind === 'skid') player.dir = s.newDir;
  }
}

const MARK_COLS = { [T.SAND]: '#a88b52', [T.SNOW]: '#9fb3c8', [T.STONE]: '#4f535c', [T.COBBLE]: '#4f535c', [T.PATH]: '#5e4128' };
function addSkidMarks(s, cx, cy) {
  const px = -s.vy, py = s.vx; // perpendiculaire à la glissade
  const offs = s.kind === 'skid' ? [[-0.16, 0], [0.16, 0], [-0.34, 0.25], [0.34, 0.25]] : [[-0.14, 0.1], [0.14, 0.1]];
  for (const [o, f] of offs) {
    const x = cx + px * o + s.vx * f, y = cy + py * o + s.vy * f;
    const tx = Math.floor(x), ty = Math.floor(y);
    if (!world.walkable(tx, ty)) continue;
    decals.push({ x, y, h: world.hAt(tx, ty), age: 0, col: MARK_COLS[world.typeAt(tx, ty)] || '#3d2b1a' });
  }
  if (decals.length > 1500) decals.splice(0, decals.length - 1500);
}

function startAction(a) {
  if (JABS.includes(a)) sfx.jab(a === 'hook');
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
const glows = []; // fenêtres et lanternes à rallumer après la teinte de nuit
let playerBox = null, playerDrawn = false;

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
  const psx = ox + isoX(player.x, player.y), psy = oy + isoY(player.x, player.y) - player.z;
  playerBox = [psx - 12, psy - 46, psx + 12, psy];
  playerDrawn = false;
  glows.length = 0;
  // habitants rangés par rangée, comme Brainless
  const npcRows = new Map();
  for (const n of npcs) {
    if (n.inside) continue;
    const r = Math.floor(n.x + 0.35) + Math.floor(n.y + 0.35);
    let l = npcRows.get(r);
    if (!l) npcRows.set(r, l = []);
    l.push(n);
  }
  // traces de dérapage rangées par rangée pour être dessinées sur le sol, sous les objets
  const decalRows = new Map();
  for (const m of decals) {
    const r = Math.floor(m.x) + Math.floor(m.y);
    let l = decalRows.get(r);
    if (!l) decalRows.set(r, l = []);
    l.push(m);
  }

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
        const w = world.wearAt(x, y);
        if (w) ctx.drawImage(crackImgs[crackMat(t)][w - 1][(x * 7 + y * 13) & 3], sx - 16, top);
      }
      const o = world.objAt(x, y);
      // un bâtiment passe avant tout ce qui est sur sa rangée (c'est devant lui)
      if (o && (o < O.PART_W || o > O.PART_NW)) rowEnts.push({ o, x, y, sx, sy, depth: OBJ_INFO[o] && OBJ_INFO[o].building ? d - 0.5 : x + y + 1, bld: !!(OBJ_INFO[o] && OBJ_INFO[o].building) });
    }
    const marks = decalRows.get(d);
    if (marks) {
      for (const m of marks) {
        ctx.globalAlpha = Math.min(0.85, (9 - m.age) / 4);
        ctx.fillStyle = m.col;
        ctx.fillRect(Math.round(ox + isoX(m.x, m.y)) - 1, Math.round(oy + isoY(m.x, m.y) - m.h * 8), 3, 1);
      }
      ctx.globalAlpha = 1;
    }
    if (d === pRow) rowEnts.push({ player: true, mx: player.x, my: player.y, depth: player.x + player.y });
    const rn = npcRows.get(d);
    if (rn) for (const n of rn) rowEnts.push({ npc: n, mx: n.x, my: n.y, depth: n.x + n.y });
    if (rowEnts.length) {
      // devant ou derrière un bâtiment de la même rangée ?
      for (const b of rowEnts) {
        if (!b.bld) continue;
        for (const m of rowEnts) {
          if (m.mx === undefined) continue;
          m.depth = m.mx > b.x + 0.5 || m.my > b.y + 0.5 ? Math.max(m.depth, b.depth + 0.1) : Math.min(m.depth, b.depth - 0.1);
        }
      }
      rowEnts.sort((a, b) => a.depth - b.depth);
      for (const e of rowEnts) {
        if (e.player) { drawPlayer(ox, oy, 1); playerDrawn = true; } else if (e.npc) drawNpc(e.npc, ox, oy);
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
  drawGlows();
  drawFlyers(ox, oy, true);
  drawFade();
  drawHUD();
}

// La nuit, les fenêtres et les lanternes restent allumées par-dessus la teinte bleue.
function drawGlows() {
  const dk = darkness();
  if (dk < 0.15) return;
  const [px0, py0, px1, py1] = playerBox;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const g of glows) {
    // Brainless passe devant : on ne rallume pas ce qui est caché derrière lui
    if (g.behind && g.x < px1 && g.x + g.img.width > px0 && g.y < py1 && g.y + g.img.height > py0) continue;
    ctx.globalAlpha = dk * 0.85;
    ctx.drawImage(g.img, g.x, g.y);
    if (g.halo) {
      ctx.fillStyle = '#ffcf6a';
      ctx.globalAlpha = dk * 0.2;
      ctx.fillRect(g.hx - 4, g.hy - 2, 9, 5); ctx.fillRect(g.hx - 2, g.hy - 4, 5, 9);
      ctx.globalAlpha = dk * 0.1;
      ctx.fillRect(g.hx - 8, g.hy - 1, 17, 3); ctx.fillRect(g.hx - 1, g.hy - 7, 3, 15);
    }
  }
  ctx.restore();
}

// Fondu au noir quand Brainless s'effondre.
function drawFade() {
  if (!player.dead) return;
  const t = player.dead.t;
  const a = t < 2.4 ? 0 : t < 3.4 ? (t - 2.4) : Math.max(0, 1 - (t - 3.4) / 0.8);
  if (a <= 0) return;
  ctx.fillStyle = `rgba(6,6,16,${Math.min(1, a)})`;
  ctx.fillRect(0, 0, VW, VH);
}

function drawNpc(n, ox, oy) {
  const sx = ox + Math.round(isoX(n.x, n.y)), sy = oy + Math.round(isoY(n.x, n.y)) - Math.round(n.z);
  const jz = Math.round(n.jz);
  ctx.drawImage(shadows.s, sx - shadows.s.ox, sy - shadows.s.oy);
  const A = PEOPLE_ANIMS[n.kind][n.anim];
  const f = n.anim === 'attack' ? Math.min(A.frames - 1, Math.floor(Math.max(0, n.atkT) * A.frames)) : Math.floor(n.t) % A.frames;
  const img = peopleImgs[n.type][n.anim][n.dir][f];
  ctx.drawImage(img, sx - PEOPLE_OX, sy - jz - PEOPLE_OY);
  if (n.flash > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.7;
    ctx.drawImage(img, sx - PEOPLE_OX, sy - jz - PEOPLE_OY);
    ctx.restore();
  }
  if (n.state === 'ko' && !n.air) {
    // des étoiles qui tournent au-dessus de sa tête
    ctx.fillStyle = '#ffe28a';
    for (let i = 0; i < 3; i++) {
      const a = time * 5 + i * 2.1;
      ctx.fillRect(Math.round(sx + Math.cos(a) * 6), Math.round(sy - 9 + Math.sin(a) * 2), 1, 1);
    }
  }
  if (n.alertT > 0) {
    const h = n.kind === 'knight' ? 37 : n.type === 'child' ? 24 : 32;
    drawText(ctx, '!', sx - 1, sy - jz - h, n.kind === 'knight' ? '#ff5a5e' : '#ffe28a');
  }
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
  // un bâtiment est centré sur le coin commun de ses 4 tuiles, les autres objets au centre de leur tuile
  let gx = e.sx, gy = e.sy + (info.building ? 0 : 8) - h * 8;
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
  const gl = objGlow[e.o];
  if (gl && darkness() > 0.15) glows.push({ img: gl, x: gx - gl.ox, y: gy - gl.oy, behind: !playerDrawn, halo: e.o === O.LANTERN, hx: gx + 3, hy: gy - 15 });
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
  if (withShadow && !player.water) {
    const sh = player.jz > 12 ? shadows.m : shadows.p;
    ctx.drawImage(sh, sx - sh.ox, sy - gz - sh.oy);
  }
  let img;
  if (player.dead) {
    img = nomu.down[player.dir][Math.min(ANIMS.down.frames - 1, Math.floor(player.dead.t * ANIMS.down.fps))];
  } else if (player.air) {
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
  const px = sx - ORIGIN_X, py = sy - gz - jz - ORIGIN_Y;
  if (player.water) {
    // seule la partie au-dessus de la surface est nette ; dessous, on le devine à travers l'eau
    const wl = sy - WATER_LINE;
    const a = ctx.globalAlpha;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, VW, wl); ctx.clip();
    ctx.drawImage(img, px, py);
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.rect(0, wl, VW, VH); ctx.clip();
    ctx.globalAlpha = a * 0.22;
    ctx.drawImage(img, px, py);
    ctx.restore();
    if (withShadow) {
      // écume autour du corps, qui ondule
      ctx.fillStyle = '#eaf7ff';
      const r = player.water === 2 ? 11 : 8;
      for (let i = 0; i < 28; i++) {
        const ang = i / 28 * Math.PI * 2;
        if (Math.sin(ang * 3 + time * 6) < -0.2) continue;
        ctx.fillRect(Math.round(sx + Math.cos(ang) * r), Math.round(wl + Math.sin(ang) * r * 0.45), 1, 1);
      }
    }
    return;
  }
  ctx.drawImage(img, px, py);
  if (player.flash > 0 && withShadow) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.6;
    ctx.drawImage(img, px, py);
    ctx.restore();
  }
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
  if (f.kind === 'ripple') {
    // ronds dans l'eau qui s'élargissent
    const sx = ox + isoX(f.x, f.y), sy = oy + isoY(f.x, f.y) - WATER_LINE;
    const r = 5 + f.t * (f.big ? 22 : 12);
    ctx.globalAlpha = Math.max(0, 0.7 * (1 - f.t / 1.1));
    ctx.fillStyle = '#e8f6ff';
    const n = Math.round(r * 3);
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      ctx.fillRect(Math.round(sx + Math.cos(a) * r), Math.round(sy + Math.sin(a) * r * 0.5), 1, 1);
    }
    ctx.globalAlpha = 1;
    return;
  }
  if (f.kind === 'cone') {
    // arcs de choc qui filent vers l'avant
    if (f.t < 0) return;
    const sx = ox + isoX(f.x, f.y), sy = oy + isoY(f.x, f.y) - f.z;
    const r = 4 + (f.t / 0.5) * f.r * 22;
    const sdx = (f.dx - f.dy) * 16, sdy = (f.dx + f.dy) * 8, base = Math.atan2(sdy * 2, sdx);
    ctx.globalAlpha = Math.max(0, 1 - f.t / 0.5);
    ctx.fillStyle = '#fff6d8';
    const n = Math.round(r * f.half * 2);
    for (let i = 0; i <= n; i++) {
      const a = base + (i / n * 2 - 1) * f.half;
      ctx.fillRect(Math.round(sx + Math.cos(a) * r), Math.round(sy + Math.sin(a) * r * 0.5), 2, 1);
    }
    ctx.globalAlpha = 1;
    return;
  }
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
  } else if (f.kind === 'collapse') {
    // la maison intacte s'enfonce dans la poussière et laisse voir la ruine
    const sx = ox + isoX(f.x, f.y), sy = oy + isoY(f.x, f.y) - f.gz;
    const u = Math.min(1, f.t / 0.7);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, VW, sy + 14); ctx.clip();
    ctx.globalAlpha = 1 - u;
    ctx.drawImage(f.img, Math.round(sx - f.img.ox + (Math.random() - 0.5) * 3 * (1 - u)), Math.round(sy - f.img.oy + u * u * 20));
    ctx.restore();
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

function drawHpBar(x, y) {
  const w = 52, fill = Math.round((w - 2) * player.hp / 100);
  const low = player.hp < 30 && Math.floor(time * 5) % 2;
  drawText(ctx, 'VIE', x, y, player.regen ? '#c9d0ff' : '#ff9aa8');
  const bx = x + 26;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(bx, y - 1, w, 7);
  ctx.fillStyle = '#20243a';
  ctx.fillRect(bx + 1, y, w - 2, 5);
  ctx.fillStyle = player.regen ? '#8f9cff' : low ? '#ff8a9a' : '#e8465e';
  ctx.fillRect(bx + 1, y, fill, 5);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(bx + 1, y, fill, 1);
}

// Étoiles de recherche : plus il y en a, plus il vient de chevaliers.
const STAR = ['..#..', '.###.', '#####', '.###.', '.#.#.'];
function drawStars(x, y) {
  drawText(ctx, 'RECHERCHE', x, y, '#ffe28a');
  const n = stars();
  for (let i = 0; i < 5; i++) {
    const on = i < n;
    const col = on ? (starFlash > 0 && Math.floor(time * 10) % 2 ? '#ffffff' : '#ffd23f') : '#3a3550';
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
      if (STAR[r][c] !== '#') continue;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x + 40 + i * 7 + c + 1, y + r + 1, 1, 1);
      ctx.fillStyle = col;
      ctx.fillRect(x + 40 + i * 7 + c, y + r, 1, 1);
    }
  }
}

function drawMuteButton() {
  muteBtn.x = VW - 12 - safe.r;
  muteBtn.y = 11 + safe.t;
  const x = muteBtn.x - 5, y = muteBtn.y - 4;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x - 3, y - 3, 17, 14);
  ctx.fillStyle = '#ffffff';
  // haut-parleur pixel
  ctx.fillRect(x, y + 2, 2, 4); ctx.fillRect(x + 2, y + 1, 1, 6); ctx.fillRect(x + 3, y, 1, 8);
  if (isMuted()) {
    ctx.fillStyle = '#ff5a5e';
    for (let i = 0; i < 5; i++) { ctx.fillRect(x + 6 + i, y + 1 + i, 1, 1); ctx.fillRect(x + 10 - i, y + 1 + i, 1, 1); }
  } else {
    ctx.fillRect(x + 5, y + 2, 1, 4); ctx.fillRect(x + 7, y + 1, 1, 6); ctx.fillRect(x + 9, y, 1, 8);
  }
}

const HINTS = {
  touch: ['MAINTIENS B POUR CHARGER', 'SPRINT: MAINTIENS >> EN MARCHANT'],
  keys: ['ZQSD: BOUGER  MAJ: SPRINT  ESPACE: SAUT', 'J/CLIC: COUP (MAINTENIR = CHARGE)', 'K/CLIC DROIT: FRAPPE AU SOL  F: PLEIN ECRAN'],
  pad: ['STICK: BOUGER  B/R2: SPRINT  A: SAUT', 'X: COUP (MAINTENIR = CHARGE)', 'Y: FRAPPE AU SOL  SELECT: SON'],
};

function drawHUD() {
  layoutButtons();
  const x0 = 6 + safe.l, y0 = 6 + safe.t;
  drawText(ctx, 'BRAINLESS', x0, y0, '#f6a6bd');
  const night = darkness() > 0.5;
  drawText(ctx, (night ? 'NUIT' : 'JOUR') + '  ARBRES ' + stats.trees + '  ROCHERS ' + stats.rocks + '  MAISONS ' + stats.houses, x0, y0 + 8, '#e8f0ff');
  drawSprintBar(x0, y0 + 17);
  drawHpBar(x0, y0 + 26);
  if (heat > 0) drawStars(x0, y0 + 35);
  drawMuteButton();
  if (msg) {
    ctx.globalAlpha = Math.min(1, msg.t / 0.6);
    drawText(ctx, msg.text, Math.round(VW / 2 - textWidth(msg.text) / 2), Math.round(VH * 0.3), '#ffe28a');
    ctx.globalAlpha = 1;
  }

  if (hintT > 0) {
    ctx.globalAlpha = Math.min(1, hintT / 1.5);
    const lines = HINTS[inputMode];
    lines.forEach((l, i) => drawText(ctx, l, Math.round(VW / 2 - textWidth(l) / 2), Math.round(VH * 0.22) + i * 8, i ? '#ffe28a' : '#ffffff'));
    ctx.globalAlpha = 1;
  }
  if (inputMode === 'pad' && !audioRunning() && !isMuted()) {
    const l = 'SON: TOUCHE L\'ECRAN UNE FOIS';
    drawText(ctx, l, Math.round(VW / 2 - textWidth(l) / 2), VH - 14 - safe.b, '#ffffff');
  }
  if (inputMode !== 'touch') return; // boutons tactiles seulement en jeu tactile

  if (joy.id !== null) {
    ctx.drawImage(ui.ring, Math.round(joy.bx - ui.ring.ox), Math.round(joy.by - ui.ring.oy));
    ctx.drawImage(ui.knob, Math.round(joy.kx - ui.knob.ox), Math.round(joy.ky - ui.knob.oy));
  }
  for (const k of ['a', 'b', 'j', 's']) {
    const b = buttons[k];
    const img = ui[k];
    const press = held(k) ? 1 : 0;
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
  if (location.hash === '#debug') {
    window.BRAINLESS = { world, player, stats, O, T, decals, particles, npcs, damage, hurtPlayer,
      get heat() { return heat; }, set heat(v) { heat = v; lastCrime = time; crimeVillage = villageAt(player.x, player.y, 30); },
      get tod() { return tod; }, set tod(v) { tod = v; }, crackTile, craterTile, doSlam, doBigPunch };
  }
  await loadAssets();
  loading.style.display = 'none';
  requestAnimationFrame((t) => { last = t; frame(t); });
})();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
