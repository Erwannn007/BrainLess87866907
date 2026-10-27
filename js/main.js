import { World, T, O, OBJ_INFO, VG } from './world.js';
import { buildVillageSprites } from './buildings.js';
import { renderPerson, PEOPLE, PEOPLE_ANIMS, CIVILIANS, HEROES } from './people.js';
import { renderNomu, ANIMS } from './nomu.js';
import { renderBeast, BEASTS, BEAST_ANIMS, BEAST_MEAL } from './beasts.js';
import { valueNoise } from './noise.js';
import * as SP from './sprites.js';
import { hash, makeBuffer } from './raster.js';
import { drawText, textWidth } from './font.js';
import { sfx, unlockAudio, toggleMute, isMuted, audioRunning, chargeStart, chargeUpdate, chargeStop, updateAmbience } from './audio.js';
import { pad, pollPad, rumble } from './pad.js';
import { listWorlds, loadWorldData, saveWorldData, touchWorld, createWorld } from './saves.js';
import { initMenu, showMenu, hideMenu, menuVisible, menuPad } from './menu.js';

const SEED = 87866907; // monde de fond de l'écran d'accueil quand aucun monde n'existe
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

// Planches de sprites : chaque sprite est rogné au plus près de son dessin, puis rangé dans
// une grande planche de 2048x2048, rangée après rangée. Quelques grandes images en mémoire au
// lieu de milliers de petites, presque sans pixels vides.
const ATLAS = 2048;
const pages = [];
let page = null, packX = 0, packY = 0, rowH = 0;

function toSprite(buf) {
  const { w, h, data } = buf;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!data[(y * w + x) * 4 + 3]) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { page: null, sx: 0, sy: 0, w: 0, h: 0, width: 0, height: 0, ox: 0, oy: 0 };
  const sw = x1 - x0 + 1, sh = y1 - y0 + 1;
  if (page && packX + sw > ATLAS) { packX = 0; packY += rowH + 1; rowH = 0; } // rangée suivante
  if (!page || packY + sh > ATLAS) {
    page = document.createElement('canvas');
    page.width = page.height = ATLAS;
    page.c = page.getContext('2d');
    pages.push(page);
    packX = packY = rowH = 0;
  }
  const img = new ImageData(sw, sh);
  for (let y = 0; y < sh; y++) img.data.set(data.subarray(((y + y0) * w + x0) * 4, ((y + y0) * w + x1 + 1) * 4), y * sw * 4);
  page.c.putImageData(img, packX, packY);
  const spr = { page, sx: packX, sy: packY, w: sw, h: sh, width: sw, height: sh, ox: buf.ox - x0, oy: buf.oy - y0 };
  packX += sw + 1; // 1 px d'écart entre deux sprites
  rowH = Math.max(rowH, sh);
  return spr;
}

// Dessine un sprite de planche, son coin haut-gauche en (x, y).
function draw(s, x, y) {
  if (s.page) ctx.drawImage(s.page, s.sx, s.sy, s.w, s.h, x, y, s.w, s.h);
}

// ---------------------------------------------------------------- assets
const nomu = {}; // nomu[anim][dir][frame]
let objSprites, objGlow, crackImgs, peopleImgs, bloodImgs, fogImg, waterImgs, foamImgs, rimImgs, shadows, ui;
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
      for (let f = 0; f < ANIMS[anim].frames; f++) jobs.push(() => { list[f] = toSprite(renderNomu(anim, f / ANIMS[anim].frames, d)); });
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
        for (let f = 0; f < AN[anim].frames; f++) jobs.push(() => { list[f] = toSprite(renderPerson(type, anim, f / AN[anim].frames, d)); });
      }
    }
  }
  // animaux
  for (const type in BEASTS) {
    peopleImgs[type] = {};
    for (const anim in BEAST_ANIMS) {
      peopleImgs[type][anim] = [];
      for (let d = 0; d < 8; d++) {
        const list = peopleImgs[type][anim][d] = [];
        for (let f = 0; f < BEAST_ANIMS[anim].frames; f++) jobs.push(() => { list[f] = toSprite(renderBeast(type, anim, f / BEAST_ANIMS[anim].frames, d)); });
      }
    }
  }
  fogImg = toCanvas(fogBuffer());
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
  for (const id in raw) objSprites[id] = raw[id].map(toSprite);
  done++; progress(); await tick();
  // bâtiments et objets de village, avec leur couche de fenêtres allumées pour la nuit
  const vs = buildVillageSprites();
  objGlow = {};
  for (const id in vs) {
    objSprites[id] = vs[id].map((s) => toSprite(s.img));
    if (vs[id][0].glow) objGlow[id] = toSprite(vs[id][0].glow);
  }
  bloodImgs = [6, 9, 13].map((r, i) => toSprite(SP.bloodBuffer(r, i * 17 + 3)));
  crackImgs = {};
  for (const m of ['earth', 'sand', 'stone', 'snow']) crackImgs[m] = [1, 2, 3].map((l) => [0, 1, 2, 3].map((v) => toSprite(SP.crackBuffer(m, l, v))));
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
    n: toCanvas(circleBuf(10, true, [200, 90, 120], 200)),
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
let world = new World(SEED);
let current = null; // le monde joué (entrée de la liste des mondes)
let mode = 'menu'; // 'menu' : écran d'accueil, le monde défile en fond ; 'play' : on joue
const stats = { trees: 0, rocks: 0, smash: 0, houses: 0, knights: 0, victims: 0, play: 0 };
let tod = 0.3;
let time = 0;
const player = { x: 0, y: 0, z: 0, dir: 2, anim: 'idle', t: 0, action: null, actionT: 0, hitDone: false, dustT: 0, stamina: 1, tired: false, sprinting: false,
  jz: 0, vz: 0, air: false, charging: false, charge: 0, slamPower: 0, runFrame: -1,
  slide: null, mv: null, idleT: 0, water: 0, rippleT: 0,
  chargeKind: null, punchHoldT: 0, punchPower: 0, combo: 0, lastPunch: -1, punchBuf: false,
  aim: null, // pendant la charge du coup : direction visée (vecteur monde), plus fine que les 8 directions
  hp: 100, lastHurt: -99, invuln: 0, flash: 0, kb: null, dead: null, regen: false,
  // faim (100 = repu), évolution (points gagnés en dévorant), alters volés aux héros
  hunger: 100, xp: 0, level: 1, alters: [], eating: null, nearCorpse: null, bigJump: false, starveMsg: false };
const npcs = []; // villageois et chevaliers autour de Brainless
const vstate = new Map(); // id du village -> { populated, anger, alarm }
const bloods = []; // flaques de sang au sol
let scent = null; // après avoir flairé : { v, t } le village le plus proche
let msg = null; // bandeau au milieu de l'écran : { text, t }
function showMsg(text, dur = 2.5, sub = '') { msg = { text, sub, t: dur }; }
let windT = 0; // rafale après une frappe au sol : la végétation s'agite
const hits = new Map();
const particles = [];
const flyers = []; // papillons / lucioles
const fx = []; // anneaux de choc, arbres qui tombent
let shake = 0;
let lastShake = 0;
let hintT = 9;
const PLAYER0 = JSON.parse(JSON.stringify(player));

// Tout remettre à zéro avant de charger un autre monde.
function resetState() {
  Object.assign(player, JSON.parse(JSON.stringify(PLAYER0)));
  for (const k in stats) stats[k] = 0;
  npcs.length = particles.length = flyers.length = fx.length = decals.length = bloods.length = 0;
  hits.clear(); vstate.clear(); bumpT.clear();
  scent = null; msg = null; shake = 0; windT = 0; tod = 0.3; curVillage = null;
  Object.assign(weather, { kind: 'clear', left: 40, rain: 0, cloud: 0, fog: 0, storm: 0, flash: 0, boltT: 6 });
  weather.drops.length = weather.flakes.length = thunders.length = 0;
  input.punch = input.jump = input.sniff = false;
  chargeStop();
}

function startWorld(meta) {
  resetState();
  current = meta;
  world = new World(meta.seed, meta.params);
  load(loadWorldData(meta.id));
  touchWorld(meta.id);
  hideMenu();
  mode = 'play';
  hintT = 9;
  showMsg(meta.name, 2.5);
}

function quitToMenu() {
  save();
  mode = 'menu';
  resetState();
  showMenu('worlds');
}

function load(s) {
  try {
    if (s && typeof s.x === 'number') {
      world.mods = new Map(s.mods || []);
      world.terr = new Map(s.terr || []);
      world.wear = new Map(s.wear || []);
      world.deaths = new Map(s.deaths || []);
      Object.assign(stats, s.stats || {});
      tod = s.tod ?? tod;
      player.x = s.x; player.y = s.y;
      player.hunger = s.hunger ?? 100; player.xp = s.xp ?? 0; player.level = s.level ?? 1; player.alters = s.alters || [];
      player.hp = s.hp ?? maxHp();
      if (world.walkable(Math.floor(player.x), Math.floor(player.y))) return;
    }
  } catch (e) { /* pas de sauvegarde lisible */ }
  const sp = world.findSpawn();
  player.x = sp.x; player.y = sp.y;
}

function save() {
  if (mode !== 'play' || !current) return;
  saveWorldData(current.id, {
    x: player.x, y: player.y, hp: player.hp, hunger: player.hunger, xp: player.xp, level: player.level, alters: player.alters, tod, stats, mods: [...world.mods], terr: [...world.terr], wear: [...world.wear], deaths: [...world.deaths],
  });
}
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

// ---------------------------------------------------------------- contrôles
const input = { x: 0, y: 0, punch: false, jump: false, sniff: false };
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
  n: { x: 0, y: 0, r: 10, label: 'N', sub: 'FLAIR' },
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
  buttons.n.x = a.x - 72; buttons.n.y = a.y - 16;
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
  if (k === 'n') input.sniff = true;
}

const toGame = (t) => [t.clientX / cssPerPx, t.clientY / cssPerPx];

const muteBtn = { x: 0, y: 0, r: 7 };
const homeBtn = { x: 0, y: 0, r: 7 }; // retour à l'accueil

function onTouchStart(e) {
  e.preventDefault();
  unlockAudio();
  setMode('touch');
  for (const t of e.changedTouches) {
    const [x, y] = toGame(t);
    if (Math.hypot(x - muteBtn.x, y - muteBtn.y) < muteBtn.r + 6) { toggleMute(); sfx.ui(); continue; }
    if (mode === 'play' && Math.hypot(x - homeBtn.x, y - homeBtn.y) < homeBtn.r + 5) { sfx.ui(); quitToMenu(); return; }
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
  if (mode !== 'play') { keys.delete(e.code); return; } // le menu gère ses touches
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'Escape') { quitToMenu(); return; }
  if (e.code === 'KeyF') toggleFullscreen();
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); // pas de défilement de page
  if (e.code === 'KeyJ') input.punch = true;
  if (e.code === 'Space') input.jump = true;
  if (e.code === 'KeyR') input.sniff = true;
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => { keys.clear(); mouse.punch = mouse.charge = false; });

// Souris (PC) : clic gauche = coup (maintenir = coup chargé), clic droit = frappe au sol.
canvas.addEventListener('mousedown', (e) => {
  unlockAudio();
  setMode('keys');
  const x = e.clientX / cssPerPx, y = e.clientY / cssPerPx;
  if (Math.hypot(x - muteBtn.x, y - muteBtn.y) < muteBtn.r + 6) { toggleMute(); sfx.ui(); return; }
  if (mode === 'play' && Math.hypot(x - homeBtn.x, y - homeBtn.y) < homeBtn.r + 5) { sfx.ui(); quitToMenu(); return; }
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
  if (pad.startPressed && mode === 'play') quitToMenu();
  if (pad.sniffPressed) input.sniff = true;
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
  return obstacleAt(nx, ny, feet, e);
}

// Un obstacle (arbre, rocher, mur, maison…) occupe-t-il le point (nx, ny) pour des pieds à la
// hauteur `feet` ? En l'air (saut, projeté), on passe par-dessus ce qui est plus bas que les
// pieds (`tall`) ; au sol on ne le fait jamais (sa hauteur rattrape le relief avec un temps de retard).
// `from` = position actuelle : s'il est déjà dedans (poussé, apparu là, retombé dessus), on le
// laisse en sortir.
function obstacleAt(nx, ny, feet, from) {
  const tx = Math.floor(nx), ty = Math.floor(ny);
  const air = from && from.air;
  const clears = (feet, x, y, tall) => air && tall !== undefined && feet - world.hAt(x, y) * 8 >= tall;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const info = OBJ_INFO[world.objAt(tx + dx, ty + dy)];
      if (!info) continue;
      if (info.solid) {
        if (clears(feet, tx + dx, ty + dy, info.tall)) continue;
        const cx = tx + dx + 0.5, cy = ty + dy + 0.5, r = info.solid + 0.2;
        const dn = Math.hypot(nx - cx, ny - cy);
        const d0 = from ? Math.hypot(from.x - cx, from.y - cy) : 1e9;
        // déjà coincé dedans : on le laisse en sortir
        if (dn < r && !(d0 < r && dn >= d0)) return true;
        continue;
      }
      if (info.tilebox) {
        // rempart : toute la tuile est pleine
        if (clears(feet, tx + dx, ty + dy, info.tall)) continue;
        const bx = tx + dx + 0.5, by = ty + dy + 0.5;
        if (boxHit(nx, ny, bx, by, 0.7) && !(from && boxHit(from.x, from.y, bx, by, 0.7))) return true;
        continue;
      }
      if (!info.part && !info.building) continue;
      // bâtiment : une boîte centrée sur le coin commun de ses 4 tuiles
      const a = world.anchorOf(tx + dx, ty + dy);
      const ai = OBJ_INFO[world.objAt(a[0], a[1])];
      if (!ai || !ai.box || clears(feet, a[0], a[1], ai.tall)) continue;
      const r = ai.box + 0.2;
      if (boxHit(nx, ny, a[0], a[1], r) && !(from && boxHit(from.x, from.y, a[0], a[1], r))) return true;
    }
  }
  return false;
}

// Retombé d'un saut au milieu d'un obstacle : on le pose de l'autre côté s'il allait par là
// (il l'a presque franchi, on lui donne), sinon au point libre le plus proche.
function escapeObstacle() {
  const feet = player.water ? 0 : player.z;
  if (!obstacleAt(player.x, player.y, feet)) return;
  const [fx0, fy0] = player.mv || dirWorld(player.dir);
  const a0 = Math.atan2(fy0, fx0);
  const cur = world.hAt(Math.floor(player.x), Math.floor(player.y));
  const tryAt = (a, r) => {
    const x = player.x + Math.cos(a) * r, y = player.y + Math.sin(a) * r;
    const tx = Math.floor(x), ty = Math.floor(y);
    if (Math.abs(world.hAt(tx, ty) - cur) > 1 || obstacleAt(x, y, world.hAt(tx, ty) * 8)) return false;
    player.x = x; player.y = y;
    return true;
  };
  if (player.moving) for (let r = 0.2; r <= 1.4; r += 0.1) for (const da of [0, 0.3, -0.3]) if (tryAt(a0 + da, r)) return;
  for (let r = 0.2; r <= 1.8; r += 0.2) {
    for (let i = 0; i < 16; i++) if (tryAt(a0 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * Math.PI / 8, r)) return;
  }
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
// Enchaînement : 3 frappes en diagonale (gauche, droite, montante), puis si on continue de
// spammer, la rafale (`rush`) en boucle tant que les coups arrivent.
const JABS = ['jabL', 'jabR', 'hook', 'rush'];
const HIT_AT = { jabL: 0.44, jabR: 0.44, hook: 0.44, rush: 0.5, bigpunch: 0.22, slam: 0.44, sniff: 0.6, eat: 9, hurt: 9 };
let hitstop = 0; // arrêt sur image après un gros impact
const CHOMPS = [0.22, 0.35, 0.48, 0.61, 0.74]; // bouchées pendant qu'il dévore

function startJab() {
  if (!JABS.includes(player.action) && time - player.lastPunch > 0.45) player.combo = 0; // trop lent : on repart du direct gauche
  // la rafale ne part que si on spamme vraiment : appui pendant le coup précédent ou juste après
  if (player.combo >= 3 && !JABS.includes(player.action) && time - player.lastPunch > 0.15) player.combo = 0;
  const a = JABS[Math.min(player.combo, 3)];
  player.combo++;
  player.punchBuf = false;
  startAction(a);
}

function doPunchHit(strong) {
  const [dx, dy] = dirWorld(player.dir);
  const hx = player.x + dx * 0.85, hy = player.y + dy * 0.85;
  let who = null, wd = 0.85;
  for (const n of npcs) {
    if (n.inside || !alive(n)) continue;
    const d = Math.hypot(n.x - hx, n.y - hy);
    if (d < wd) { wd = d; who = n; }
  }
  if (who) { hitNpc(who, (strong ? 2 : 1) * strength(), dx, dy, strong ? 0.35 : 0.15); shake = Math.max(shake, strong ? 2.5 : 1.5); return; }
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
  if (best) { damage(best[0], best[1], Math.round((strong ? 2 : 1) * strength())); shake = Math.max(shake, strong ? 2.5 : 1.5); }
  else { burst(hx, hy, gz + 18, ['#ffffff', '#d8e0f0'], 5, { up: 10, g: 0, life: 0.25, speed: 1.2 }); sfx.punchAir(); }
}

// Rafale : chaque salve balaie un très large éventail (±110°, 1.7 tuile : les bras vont jusque
// sur les côtés, et il avance à chaque salve) et touche tout ce qui s'y trouve, gens comme décor.
// Des traînées blanches partent en éventail.
const RUSH_R = 1.7, RUSH_COS = -0.34;
function doRushHit() {
  const [dx, dy] = dirWorld(player.dir);
  const inFan = (x, y) => {
    const rx = x - player.x, ry = y - player.y, d = Math.hypot(rx, ry);
    return d < RUSH_R && (d < 0.4 || (rx * dx + ry * dy) / d > RUSH_COS);
  };
  let hit = false;
  for (const n of npcs) {
    if (n.inside || !alive(n) || !inFan(n.x, n.y)) continue;
    const rx = n.x - player.x, ry = n.y - player.y, d = Math.hypot(rx, ry) || 1;
    hitNpc(n, strength(), rx / d, ry / d, 0.12);
    hit = true;
  }
  for (let ty = Math.floor(player.y) - 2; ty <= Math.floor(player.y) + 2; ty++) {
    for (let tx = Math.floor(player.x) - 2; tx <= Math.floor(player.x) + 2; tx++) {
      const info = OBJ_INFO[world.objAt(tx, ty)];
      if (!info || info.part || info.building || !inFan(tx + 0.5, ty + 0.5)) continue;
      damage(tx, ty, info.small ? 1 : Math.max(1, Math.round(strength())));
      if (!info.small) hit = true;
    }
  }
  shake = Math.max(shake, hit ? 2.2 : 1.2);
  const base = Math.atan2(dy, dx);
  for (let i = 0; i < 14; i++) {
    const a = base + (Math.random() * 2 - 1) * 1.2, sp = 5 + Math.random() * 4;
    particles.push({
      x: player.x + Math.cos(a) * 0.4, y: player.y + Math.sin(a) * 0.4, z: player.z + 14 + Math.random() * 14,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: (Math.random() - 0.5) * 8, g: 0, drag: 2,
      life: 0.15 + Math.random() * 0.15, col: Math.random() < 0.7 ? '#ffffff' : '#d8ecff', size: 1, streak: true,
    });
  }
  if (!hit) sfx.punchAir();
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
      if (info.tilebox) {
        // un rempart ne cède pas à la course : il encaisse et Brainless s'arrête
        const k = tx + ',' + ty;
        if (boxHit(fx0, fy0, tx + 0.5, ty + 0.5, 0.95) && time - (bumpT.get(k) ?? -9) > 0.6) { bumpT.set(k, time); damage(tx, ty, 3); shake = Math.max(shake, 4); }
        continue;
      }
      if (d > (info.solid || 0.2) + 0.4) continue;
      // détruit d'un coup, souche et cailloux compris
      while (world.objAt(tx, ty) !== O.NONE && damage(tx, ty, 99)) { /* casse jusqu'au bout */ }
      if (info.solid) shake = Math.max(shake, 3);
    }
  }
  for (const n of npcs) {
    if (n.inside || !alive(n) || Math.hypot(n.x - fx0, n.y - fy0) > 0.7 || time - (n.tramT ?? -9) < 0.5) continue;
    n.tramT = time;
    hitNpc(n, 2, vx, vy, 0.45);
  }
}

// Gros coup chargé : une bourrasque part droit devant et rase tout dans un cône.
const aimDir = () => player.aim || dirWorld(player.dir);

function doBigPunch(power) {
  const [dx, dy] = aimDir();
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
  const dmgBase = (2 + power * 8) * strength();
  const inCone = (rx, ry, d) => d < 0.9 || (rx * dx + ry * dy) / d > Math.cos(half);
  const dmgAt = (d) => Math.max(1, Math.round(dmgBase * (1 - 0.75 * d / R)));
  blast(R, inCone, dmgAt);
  for (const n of npcs) {
    const rx = n.x - player.x, ry = n.y - player.y, d = Math.hypot(rx, ry) || 0.01;
    if (n.inside || !alive(n) || d > R || !inCone(rx, ry, d)) continue;
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
  if (has('storm')) lightningChain(power);
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
  const base = (2 + power * 8) * strength();
  const dmgAt = (d) => Math.max(1, Math.round(base * (1 - 0.75 * d / R)));
  blast(R, () => true, dmgAt);
  if (has('storm')) lightningChain(power);
  // au centre, ceux qui sont sous lui sont écrasés ; plus loin ils sont projetés
  const crushR = Math.max(1.3, R * 0.5);
  for (const n of npcs) {
    const rx = n.x - player.x, ry = n.y - player.y, d = Math.hypot(rx, ry) || 0.01;
    if (n.inside || !alive(n) || d > R) continue;
    // un héros résiste à l'écrasement tant qu'il n'est pas affaibli
    if (d <= crushR && power >= 0.2 && !(n.kind === 'hero' && n.hp > n.maxHp * 0.4)) killNpc(n, true);
    else if (d <= crushR && n.kind === 'hero') hitNpc(n, dmgAt(d) * 1.5, rx / d, ry / d, power);
    else hitNpc(n, dmgAt(d), rx / d, ry / d, power * (1 - d / R) + 0.25);
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
  escapeObstacle();
  if (waterDepth(player.x, player.y)) { player.air = false; player.jz = 0; player.vz = 0; splash(1); return; }
  sfx.land(player.sprinting);
  player.air = false;
  player.jz = 0;
  player.vz = 0;
  const hard = player.sprinting || player.bigJump;
  shake = Math.max(shake, hard ? 4 : 2.5);
  if (player.bigJump) { player.bigJump = false; landingShock(); }
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
  if (msg && (msg.t -= dt) <= 0) msg = null;
  for (let i = bloods.length - 1; i >= 0; i--) if ((bloods[i].age += dt) > 180) bloods.splice(i, 1);
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
    input.punch = input.jump = input.sniff = false;
  } else {
    // --- saut
    if (input.jump && !player.air && !player.action && !player.charging && !player.slide && player.water < 2) {
      player.air = true;
      player.vz = JUMP_V * (player.sprinting ? 1.1 : 1) * (has('leap') ? 1.6 : 1);
      player.bigJump = has('leap');
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
          // il reste planté mais pivote pour viser : le stick oriente le coup sans le faire avancer
          if (mag > 0.3) {
            const cx = ix / mag, ct = iy / mag;
            player.aim = [(cx + ct) / Math.SQRT2, (ct - cx) / Math.SQRT2];
            player.dir = ((Math.round(Math.atan2(ct, cx) / (Math.PI / 4)) % 8) + 8) % 8;
          }
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
        player.aim = dirWorld(player.dir);
        player.sprinting = false;
        setAnim('pcharge');
        chargeStart();
      } else if (input.punch && !player.charging) {
        if (!player.action) startJab();
        else if (JABS.includes(player.action)) player.punchBuf = true; // le coup suivant part dès que possible
      }
    }
    // flairer : il s'arrête, lève la tête et renifle l'air
    player.nearCorpse = player.action ? null : corpseNear();
    if (input.sniff && !player.action && !player.charging && !player.air && !player.slide && player.water < 2) {
      player.sprinting = false;
      if (player.nearCorpse) startEat(player.nearCorpse);
      else { startAction('sniff'); sfx.sniff(); }
    }
    input.punch = input.jump = input.sniff = false;

    if (player.slide) {
      updateSlide(dt);
    } else if (player.action) {
      const A = ANIMS[player.action];
      const dur = A.frames / A.fps;
      const prev = player.actionT;
      player.actionT += dt / dur;
      const act = player.action;
      const hitAt = HIT_AT[act] ?? 0.4;
      if (act === 'eat') for (const c of CHOMPS) if (prev < c && player.actionT >= c) chomp();
      if (prev < hitAt && player.actionT >= hitAt) {
        if (act === 'rush') doRushHit();
        else if (JABS.includes(act)) doPunchHit(act === 'hook');
        else if (act === 'sniff') doSniff();
        else if (act === 'eat' || act === 'hurt') { /* rien à frapper */ }
        else if (act === 'bigpunch') doBigPunch(player.punchPower);
        else doSlam(player.slamPower);
      }
      // petit pas en avant à chaque coup, grosse fente pour le coup chargé
      const [dx, dy] = dirWorld(player.dir);
      if (JABS.includes(act) && player.actionT > 0.1 && player.actionT < hitAt) tryMove(dx * dt * 1.6, dy * dt * 1.6);
      if (act === 'bigpunch' && player.actionT < 0.3) { const [ax, ay] = aimDir(); tryMove(ax * dt * 4.5, ay * dt * 4.5); }
      if (JABS.includes(act) && player.punchBuf && player.actionT >= 0.6) startJab();
      else if (player.actionT >= 1) {
        if (JABS.includes(act)) player.lastPunch = time;
        if (act === 'bigpunch') player.aim = null;
        if (act === 'eat') finishEat();
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
      player.moving = mag > 0.15;
      if (mag > 0.15) {
        const cx = ix / mag, ct = iy / mag;
        const vx = (cx + ct) / Math.SQRT2, vy = (ct - cx) / Math.SQRT2;
        const newDir = ((Math.round(Math.atan2(ct, cx) / (Math.PI / 4)) % 8) + 8) % 8;
        if (player.sprinting && !player.air && !player.water && player.mv && vx * player.mv[0] + vy * player.mv[1] < -0.35) {
          startSlide('skid', newDir); // demi-tour violent
        } else {
          const speed = player.water === 2 ? (player.sprinting ? 4.6 : 1.9) : (player.sprinting ? 5.8 * (has('engine') ? 1.35 : 1) : 2.2) * (player.water ? 0.62 : 1);
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
    if (player.sprinting && !player.air) player.stamina = Math.max(0, player.stamina - dt / 4.5 / (1 + 0.08 * (player.level - 1)) * (has('engine') ? 0.6 : 1));
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
  updateNpcs(dt);
  updateWildlife(dt);
  updateWeather(dt);
  updateScent(dt);
  healGround(dt);

  updateParticles(dt);
  for (let i = decals.length - 1; i >= 0; i--) if ((decals[i].age += dt) > 9) decals.splice(i, 1);
  updateAmbience(dt, { night: darkness() > 0.5, water: waterNearby(), height: world.hAt(Math.floor(player.x), Math.floor(player.y)),
    rain: weather.snow ? 0 : weather.rain, storm: weather.storm });
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
    if ((f.kind === 'collapse' && f.t > 0.7) || (f.kind === 'bolt' && f.t > 0.3) || (f.kind === 'mark' && f.t > 8) || (f.kind === 'ring' && f.t > 0.6) || (f.kind === 'fall' && f.t > 0.95) || (f.kind === 'ripple' && f.t > 1.1) || (f.kind === 'cone' && f.t > 0.5)) fx.splice(i, 1);
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
  if (has('engine')) burst(player.x - vx * 0.6, player.y - vy * 0.6, player.z + 10, ['#c9d0e0', '#8a91a0', '#ffb347'], 4, { up: 8, speed: 0.6, g: -20, life: 0.5 });
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
// opts : { kb : force du recul, lift : il décolle du sol }
function hurtPlayer(dmg, fx0, fy0, opts = {}) {
  if (player.dead || player.invuln > 0) return;
  dmg *= [0.6, 1, 1.5][world.p.difficulty] * (has('absorb') ? 0.5 : 1);
  if (has('absorb')) burst(player.x, player.y, player.z + 20, ['#ffe28a', '#ffffff'], 6, { up: 20, speed: 2, life: 0.3 }); // le coup rebondit
  player.hp -= dmg;
  player.lastHurt = time;
  player.invuln = 0.3;
  player.flash = 0.18;
  player.regen = false;
  const dx = player.x - fx0, dy = player.y - fy0, l = Math.hypot(dx, dy) || 1;
  const kb = (opts.kb ?? 3) * (has('absorb') ? 0.6 : 1);
  player.kb = [dx / l * kb, dy / l * kb];
  shake = Math.max(shake, 3 + kb * 0.5);
  if (kb >= 6) {
    // gros coup : il est projeté en arrière (et parfois soulevé), la charge est perdue
    hitstop = 0.08;
    if (player.charging) { player.charging = false; player.chargeKind = null; player.aim = null; chargeStop(); }
    player.slide = null; player.sprinting = false; player.mv = null;
    if (opts.lift && !player.air && !player.water) { player.air = true; player.vz = opts.lift; player.jz = 0.1; player.bigJump = false; }
    if (player.action === 'eat' && player.eating) { player.eating.eaten = false; player.eating = null; } // repas interrompu
    startAction('hurt');
    sfx.bodyHit(false, true);
  }
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
    player.hp = maxHp();
    player.hunger = Math.max(player.hunger, 50);
    // il est loin : les villages se calment, les chevaliers retournent patrouiller
    for (const st of vstate.values()) { st.anger = 0; st.alarm = -99; }
    for (const n of npcs) {
      if (fighter(n) && alive(n) && n.state !== 'ko') { n.state = 'guard'; n.wait = 1; }
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
  // La faim : elle descend toujours, plus vite en sprint. Le ventre vide, il dépérit.
  if (!player.dead) {
    player.hunger = Math.max(0, player.hunger - dt * 100 / 420 * [0.7, 1, 1.3][world.p.difficulty] * (player.sprinting ? 1.8 : 1));
    if (player.hunger <= 0) {
      player.hp -= dt * 1.5;
      if (!player.starveMsg) { player.starveMsg = true; showMsg('IL A FAIM...', 3, 'DEVORE QUELQUE CHOSE'); }
      if (player.hp <= 0) playerDown();
    } else if (player.hunger > 20) player.starveMsg = false;
  }
  // Super régénération : quelques secondes sans coup, et ses blessures se referment (pas le ventre vide).
  if (!player.dead && player.hp < maxHp() && time - player.lastHurt > 3 && player.hunger > 15) {
    if (!player.regen) { player.regen = true; sfx.regen(); }
    player.hp = Math.min(maxHp(), player.hp + 22 * dt);
    if (Math.random() < dt * 10) {
      burst(player.x + (Math.random() - 0.5) * 0.6, player.y + (Math.random() - 0.5) * 0.6, player.z + 6 + Math.random() * 20,
        ['#8f9cff', '#c9d0ff', '#ff8a9a'], 1, { up: 18, g: -10, speed: 0.1, life: 0.8, spread: 0 });
    }
  } else player.regen = false;
}

// ---------------------------------------------------------------- faim, évolution, alters
const LEVEL_AT = [0, 3, 8, 15, 25, 40, 60, 85, 115, 150, 200];
const ALTERS = {
  absorb: { name: 'ABSORPTION', desc: 'LES COUPS LUI FONT DEUX FOIS MOINS MAL' },
  leap: { name: 'BOND', desc: 'SAUTS GEANTS, ONDE DE CHOC A LA RECEPTION' },
  engine: { name: 'MOTEUR', desc: 'SPRINT PLUS RAPIDE ET QUI DURE PLUS LONGTEMPS' },
  iron: { name: 'FER', desc: 'SES COUPS FONT 50% DE DEGATS EN PLUS' },
  storm: { name: 'FOUDRE', desc: 'SES COUPS CHARGES FONT TOMBER LA FOUDRE' },
};
const has = (a) => player.alters.includes(a);
const maxHp = () => 100 + 15 * (player.level - 1);
const strength = () => (1 + 0.12 * (player.level - 1)) * (has('iron') ? 1.5 : 1);
const fighter = (n) => n.kind === 'knight' || n.kind === 'hero';

// Ce que rapporte une proie : de quoi manger, et des points d'évolution.
function mealOf(n) {
  if (n.kind === 'hero') return { food: 60, evo: 8 };
  if (n.kind === 'knight') return { food: 40, evo: 2 };
  if (n.kind === 'beast') return BEAST_MEAL[n.type];
  return { food: 30, evo: 1 };
}

function corpseNear() {
  let best = null, bd = 1.3;
  for (const n of npcs) {
    if (alive(n) || n.eaten) continue;
    const d = Math.hypot(n.x - player.x, n.y - player.y);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

function startEat(n) {
  player.eating = n;
  n.eaten = true;
  player.dir = faceDir(n.x - player.x, n.y - player.y);
  startAction('eat');
  sfx.growl();
}

function chomp() {
  const n = player.eating;
  if (!n || !npcs.includes(n)) return;
  player.hunger = Math.min(100, player.hunger + mealOf(n).food / CHOMPS.length);
  burst(n.x, n.y, n.z + 3, BLOOD_COLS, 8, { up: 40, speed: 1.2, life: 0.6 });
  sfx.crunch();
  if (Math.random() < 0.5) sfx.splat();
  shake = Math.max(shake, 1.2);
}

function finishEat() {
  const n = player.eating;
  player.eating = null;
  const i = npcs.indexOf(n);
  if (i < 0) return;
  npcs.splice(i, 1);
  bloods.push({ x: n.x, y: n.y, h: world.hAt(Math.floor(n.x), Math.floor(n.y)), img: bloodImgs[0], age: 0 });
  gainEvo(mealOf(n).evo);
  const alter = PEOPLE[n.type] && PEOPLE[n.type].alter;
  if (alter && !has(alter)) {
    player.alters.push(alter);
    showMsg('ALTER DEVORE : ' + ALTERS[alter].name, 4, ALTERS[alter].desc);
    sfx.roar(1);
    burst(player.x, player.y, player.z + 20, ['#c9a0ff', '#ffffff', '#8f9cff'], 40, { up: 60, speed: 2.5, life: 1 });
    fx.push({ kind: 'ring', x: player.x, y: player.y, z: player.z, t: 0, r: 3 });
  }
}

function gainEvo(x) {
  player.xp += x;
  while (player.level < LEVEL_AT.length && player.xp >= LEVEL_AT[player.level]) {
    player.level++;
    player.hp = maxHp();
    showMsg('EVOLUTION ! NIVEAU ' + player.level, 3.5, 'PLUS DE VIE, DES COUPS PLUS FORTS');
    sfx.roar(1);
    shake = Math.max(shake, 6);
    fx.push({ kind: 'ring', x: player.x, y: player.y, z: player.z, t: 0, r: 2.5 });
    burst(player.x, player.y, player.z + 20, ['#c9a0ff', '#ff6b7a', '#ffffff'], 50, { up: 70, speed: 2.5, life: 1.2 });
  }
}

// BOND : à la réception d'un saut géant, une onde de choc autour de lui.
function landingShock() {
  const R = 2.4;
  sfx.slam(0.35);
  shake = Math.max(shake, 7);
  fx.push({ kind: 'ring', x: player.x, y: player.y, z: player.z, t: 0, r: R });
  burst(player.x, player.y, player.z, DUST_COLS, 30, { up: 40, speed: 3, g: 80, life: 0.9, spread: 2 });
  const dmgAt = (d) => Math.max(1, Math.round(4 * strength() * (1 - 0.6 * d / R)));
  blast(R, () => true, dmgAt);
  for (const n of npcs) {
    const rx = n.x - player.x, ry = n.y - player.y, d = Math.hypot(rx, ry) || 0.01;
    if (!n.inside && alive(n) && d < R) hitNpc(n, dmgAt(d), rx / d, ry / d, 0.4);
  }
  for (let ty = Math.floor(player.y - 1); ty <= Math.floor(player.y + 1); ty++) for (let tx = Math.floor(player.x - 1); tx <= Math.floor(player.x + 1); tx++) crackTile(tx, ty, 1);
}

// FOUDRE : ses gros coups font tomber des éclairs sur les ennemis proches.
function lightningChain(power) {
  const targets = npcs.filter((n) => alive(n) && !n.inside && Math.hypot(n.x - player.x, n.y - player.y) < 7)
    .sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y)).slice(0, 2 + Math.round(power * 2));
  for (const n of targets) {
    fx.push({ kind: 'bolt', x: n.x, y: n.y, z: n.z, t: 0, seed: Math.random() * 1000 });
    const d = Math.hypot(n.x - player.x, n.y - player.y) || 1;
    hitNpc(n, 3 * strength(), (n.x - player.x) / d, (n.y - player.y) / d, 0.3);
    burst(n.x, n.y, n.z + 10, ['#fff7a8', '#8fd8ff', '#ffffff'], 10, { up: 40, speed: 2, life: 0.4 });
  }
  if (targets.length) sfx.thunder(0.4);
}

// ---------------------------------------------------------------- villageois et chevaliers
function vstateOf(v) {
  let st = vstate.get(v.id);
  if (!st) vstate.set(v.id, st = { populated: false, anger: 0, alarm: -99 });
  return st;
}
const alarmed = (id) => { const st = vstate.get(id); return !!st && time - st.alarm < 25; };

function villageAt(x, y, margin = 6) {
  for (const v of world.villagesNear(x, y)) if (Math.hypot(x - v.cx, y - v.cy) < v.R + margin) return v;
  return null;
}

// Un méfait près d'un village. Pas de messager, pas de renforts : seuls les gens de CE
// village qui sont assez près pour voir ou entendre réagissent. Un épi piétiné ne suffit
// pas, il faut que la colère du village dépasse 1.
function crime(amount, x, y) {
  const v = villageAt(x, y, 8);
  if (!v) return;
  const st = vstateOf(v);
  st.anger = Math.min(20, st.anger + amount);
  if (st.anger < 1) return;
  if (time - st.alarm > 25) sfx.bell(); // la cloche sonne
  st.alarm = time;
  for (const n of npcs) {
    if (n.v !== v.id || n.inside || !alive(n)) continue;
    const dn = Math.hypot(n.x - x, n.y - y), dp = Math.hypot(n.x - player.x, n.y - player.y);
    if (n.kind === 'civ' && dn < 14) startFlee(n);
    if (fighter(n) && n.state === 'guard' && (dn < 16 || dp < 10)) { n.state = 'chase'; n.alertT = 1.2; }
  }
}

// Un endroit où quelqu'un peut se tenir : sol praticable, et à bonne distance des troncs et rochers voisins.
function freeSpot(x, y) {
  const tx = Math.floor(x), ty = Math.floor(y), info = OBJ_INFO[world.objAt(tx, ty)];
  if (!world.walkable(tx, ty) || (info && (info.part || info.building || info.tilebox))) return false;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const o = OBJ_INFO[world.objAt(tx + dx, ty + dy)];
    if (o && o.solid && Math.hypot(x - (tx + dx + 0.5), y - (ty + dy + 0.5)) < o.solid + 0.35) return false;
    if (o && (o.part || o.building || o.tilebox) && (dx || dy) && Math.hypot(x - (tx + dx + 0.5), y - (ty + dy + 0.5)) < 0.9) return false;
  }
  return true;
}

function spawnNpc(type, x, y, v, home) {
  // Brainless est assez près pour voir : il sort d'une maison plutôt que d'apparaître au milieu de la rue
  if (home && Math.hypot(x - player.x, y - player.y) < 16 && freeSpot(home.door[0], home.door[1])) { [x, y] = home.door; }
  const D = PEOPLE[type];
  const n = {
    type, kind: D.kind, x, y, z: groundZ(x, y), jz: 0, vz: 0, vx: 0, vy: 0, air: false,
    dir: (Math.random() * 8) | 0, anim: 'idle', t: Math.random() * 4, state: D.kind === 'knight' ? 'chase' : 'wander',
    v: v.id, home, tx: x, ty: y, wait: Math.random() * 3, koT: 0, hp: D.kind === 'hero' ? D.hp : D.kind === 'knight' ? 4 : 1, maxHp: D.hp || 4,
    alertT: 0, atkT: 0, cd: 0, hurtT: 0, flash: 0, waveT: 0, waveCd: 3 + Math.random() * 8, inside: false, stuck: 0,
    speedK: type === 'child' ? 1.1 : type === 'elder' ? 0.55 : 1, fj: 0, fade: 0,
  };
  npcs.push(n);
  return n;
}

function populate(v) {
  const homes = v.houses.filter((h) => h.type !== 'tower' && h.type !== 'barn');
  const dead = deathsOf(v.id);
  const count = v.folk - dead.civ;
  for (let i = 0; i < count; i++) {
    const home = homes.length ? homes[i % homes.length] : null;
    const type = CIVILIANS[(Math.random() * CIVILIANS.length) | 0];
    for (let k = 0; k < 20; k++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * v.R * 0.8;
      const x = v.cx + 0.5 + Math.cos(a) * d, y = v.cy + 0.5 + Math.sin(a) * d;
      if (freeSpot(x, y)) { spawnNpc(type, x, y, v, home); break; }
    }
  }
  // la garnison : ceux qui sont encore en vie patrouillent dans le village
  const doors = (v.tower ? [v.tower] : []).concat(v.houses);
  for (let i = 0; i < v.garrison - dead.knight; i++) {
    for (let k = 0; k < 10; k++) {
      const [x, y] = doors[(i + k) % doors.length].door;
      const jx = x + (Math.random() - 0.5) * 1.5, jy = y + Math.random();
      if (freeSpot(jx, jy)) { const g = spawnNpc('knight', jx, jy, v, null); g.state = 'guard'; g.wait = Math.random() * 3; break; }
    }
  }
  // les héros du village (ceux qui n'ont pas encore été dévorés)
  (v.heroes || []).slice(dead.hero || 0).forEach((h) => {
    for (let k = 0; k < 20; k++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * v.R * 0.5;
      const x = v.cx + 0.5 + Math.cos(a) * r, y = v.cy + 0.5 + Math.sin(a) * r;
      if (freeSpot(x, y)) { const n = spawnNpc(HEROES[h], x, y, v, null); n.state = 'guard'; break; }
    }
  });
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
    st.anger *= 0.9; // la colère retombe doucement
    if (v && Math.hypot(player.x - v.cx, player.y - v.cy) < v.R + 40) continue;
    st.populated = false;
    for (let i = npcs.length - 1; i >= 0; i--) if (npcs[i].v === id) npcs.splice(i, 1);
  }
  const inside = near.find((v) => Math.hypot(player.x - v.cx, player.y - v.cy) < v.R + 3);
  if (inside && inside !== curVillage && !player.dead) showMsg(inside.name, 2.5);
  if (inside) curVillage = inside;
  else if (curVillage && Math.hypot(player.x - curVillage.cx, player.y - curVillage.cy) > curVillage.R + 10) curVillage = null;
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

const BLOOD_COLS = ['#6e0e18', '#a01824', '#d02c36', '#3e060c'];
const deathsOf = (id) => { let d = world.deaths.get(id); if (!d) world.deaths.set(id, d = { civ: 0, knight: 0, hero: 0 }); d.hero = d.hero || 0; return d; };
const alive = (n) => n.state !== 'dead';
const animsOf = (n) => (n.kind === 'beast' ? BEAST_ANIMS : PEOPLE_ANIMS[n.kind]);

// `power` > 0.85 (gros coup chargé tout près) : il meurt en retombant.
function hitNpc(n, dmg, kx, ky, power) {
  if (n.inside || !alive(n)) return;
  n.flash = 0.15;
  const knight = fighter(n);
  if (n.type === 'rempart') dmg *= 0.6; // il absorbe une partie des coups
  // impact lourd ; les os craquent parfois (toujours quand le coup est très violent)
  sfx.bodyHit(knight, Math.random() < 0.35 || power > 0.6);
  if (knight) burst(n.x, n.y, n.z + n.jz + 16, ['#fff3b0', '#ffffff', '#dfe5ee'], 6, { up: 40, speed: 1.6, life: 0.4 });
  burst(n.x, n.y, n.z + n.jz + 12, BLOOD_COLS, knight ? 3 : 5, { up: 35, speed: 1.4, life: 0.6 });
  if (n.state === 'block') {
    // en garde : il encaisse sans broncher, sauf un coup chargé à fond qui lui brise la garde
    sfx.clank();
    burst(n.x, n.y, n.z + 16, ['#fff3b0', '#ffffff', '#ffe28a'], 8, { up: 40, speed: 2, life: 0.35 });
    if (power > 0.75) { n.state = 'hurt'; n.hurtT = 0.9; n.hp -= dmg * 0.5; n.vx = kx * 5; n.vy = ky * 5; hitstop = 0.06; showMsg('GARDE BRISEE', 1.2); }
    else { n.hp -= dmg * 0.25; n.vx = kx * 1.5; n.vy = ky * 1.5; }
    if (n.hp <= 0) { n.state = 'ko'; n.koT = 2.5; n.air = true; n.vz = 60; n.jz = 0.5; }
    return;
  }
  if (n.kind === 'beast') {
    // un animal : il détale, ou le sanglier s'énerve ; à 0 il meurt en retombant
    n.hp -= dmg;
    n.angry = true;
    n.vx = kx * 3; n.vy = ky * 3;
    if (n.hp <= 0) { n.air = true; n.dying = true; n.vz = 40 + power * 80; n.jz = 0.5; n.vx = kx * (2 + power * 5); n.vy = ky * (2 + power * 5); }
    else if (BEASTS[n.type].flee) { n.state = 'flee'; n.fleeT = 4; }
    return;
  }
  crime(knight ? 1 : 2.5, n.x, n.y);
  if (n.state === 'ko') {
    // on achève celui qui est à terre
    if (!n.air) { killNpc(n, false); return; }
    n.vx += kx * 2; n.vy += ky * 2;
    return;
  }
  n.hp -= dmg;
  if (n.hp > 0) {
    // un héros encaisse sans broncher la plupart du temps
    if (n.kind === 'hero' && (n.state === 'special' || Math.random() < 0.7)) { n.vx = kx * 1.5; n.vy = ky * 1.5; return; }
    n.state = 'hurt'; n.hurtT = 0.35; n.vx = kx * 3; n.vy = ky * 3; return;
  }
  // KO : il vole et retombe sur le dos, des étoiles plein la tête
  n.state = 'ko';
  n.koT = n.kind === 'hero' ? 2.5 : 4 + power * 4;
  n.air = true;
  n.dying = power > 0.85;
  n.vx = kx * (2.5 + power * 7); n.vy = ky * (2.5 + power * 7);
  n.vz = 50 + power * 110; n.jz = Math.max(n.jz, 0.5);
  if (!knight) sfx.scream(PEOPLE[n.type].voice * 1.15);
  shake = Math.max(shake, 2 + power * 3);
}

// Mort pour de bon : le cadavre reste un moment dans une flaque de sang, et le village
// a un habitant (ou un chevalier) de moins, pour toujours.
function killNpc(n, crushed) {
  if (!alive(n)) return;
  n.state = 'dead'; n.anim = crushed ? 'crushed' : 'dead'; n.t = 0;
  n.deadT = 0; n.air = false; n.jz = 0; n.vx = n.vy = 0; n.alertT = 0;
  if (n.v) deathsOf(n.v)[n.kind]++;
  if (n.kind === 'knight' || n.kind === 'hero') stats.knights++; else if (n.kind === 'beast') stats.prey = (stats.prey || 0) + 1; else stats.victims++;
  const h = world.hAt(Math.floor(n.x), Math.floor(n.y));
  bloods.push({ x: n.x, y: n.y, h, img: bloodImgs[crushed ? 2 : 1], age: 0 });
  if (bloods.length > 80) bloods.shift();
  burst(n.x, n.y, n.z + 4, BLOOD_COLS, crushed ? 30 : 16, { up: crushed ? 70 : 45, speed: crushed ? 2.6 : 1.6, big: 0.5 });
  sfx.bodyHit(n.kind === 'knight', true);
  sfx.splat();
  shake = Math.max(shake, crushed ? 4 : 2.5);
  if (n.kind !== 'beast') crime(4, n.x, n.y);
}

// Chaque héros a son attaque spéciale, liée à son alter.
function heroSpecial(n, d) {
  const style = PEOPLE[n.type].style;
  const tx = player.x, ty = player.y;
  if (style === 'leap' && d > 2.5 && d < 9) n.sp = { kind: 'leap', t: 0, dur: 0.75, fx: n.x, fy: n.y, tx, ty };
  else if (style === 'dash' && d > 2 && d < 9) n.sp = { kind: 'dash', t: 0, dur: 0.45, ux: (tx - n.x) / d, uy: (ty - n.y) / d, hit: false };
  else if (style === 'ranged' && d > 2.2 && d < 10) n.sp = { kind: 'bolt', t: 0, dur: 0.75, tx, ty };
  else if (style === 'melee' && d < 1.4) n.sp = { kind: 'smash', t: 0, dur: 0.7, hit: false };
  else return false;
  n.state = 'special';
  n.alertT = 0.6;
  n.dir = faceDir(tx - n.x, ty - n.y);
  sfx.swordSwing();
  return true;
}

// Renvoie true quand l'attaque spéciale est finie.
function updateSpecial(n, dt) {
  const S = n.sp;
  S.t += dt / S.dur;
  const u = Math.min(1, S.t);
  if (S.kind === 'leap') {
    // RESSORT bondit et retombe sur Brainless
    n.x = S.fx + (S.tx - S.fx) * u; n.y = S.fy + (S.ty - S.fy) * u;
    n.jz = Math.sin(Math.PI * u) * 42;
    if (u >= 1) {
      n.jz = 0;
      fx.push({ kind: 'ring', x: n.x, y: n.y, z: n.z, t: 0, r: 1.6 });
      burst(n.x, n.y, n.z, DUST_COLS, 20, { up: 40, speed: 2.5, life: 0.7 });
      crackTile(Math.floor(n.x), Math.floor(n.y), 2);
      sfx.slam(0.25); shake = Math.max(shake, 4);
      if (Math.hypot(player.x - n.x, player.y - n.y) < 1.5) hurtPlayer(16, n.x, n.y, { kb: 8, lift: 70 });
      n.cd = 2.6;
    }
  } else if (S.kind === 'dash') {
    // TURBO fonce en ligne droite, moteurs à fond
    npcMove(n, S.ux * 11 * dt, S.uy * 11 * dt);
    burst(n.x - S.ux * 0.5, n.y - S.uy * 0.5, n.z + 6, ['#ffb347', '#c9d0e0', '#8a91a0'], 3, { up: 10, speed: 0.4, g: -10, life: 0.4 });
    if (!S.hit && Math.hypot(player.x - n.x, player.y - n.y) < 0.9) { S.hit = true; hurtPlayer(14, n.x - S.ux, n.y - S.uy, { kb: 9 }); }
    if (u >= 1) { n.cd = 2.8; n.state = 'hurt'; n.hurtT = 0.6; return false; } // essoufflé après la charge
  } else if (S.kind === 'bolt') {
    // ECLAIR vise, puis la foudre tombe là où était Brainless
    if (u < 0.45) { S.tx = player.x; S.ty = player.y; }
    if (Math.random() < 0.4) burst(n.x, n.y, n.z + 18, ['#fff7a8', '#8fd8ff'], 1, { up: 20, speed: 0.6, life: 0.3 });
    if (!S.mark) { S.mark = { kind: 'mark', x: S.tx, y: S.ty, t: 0, owner: S }; fx.push(S.mark); }
    S.mark.x = S.tx; S.mark.y = S.ty;
    if (u >= 1) {
      S.mark.t = 9;
      fx.push({ kind: 'bolt', x: S.tx, y: S.ty, z: groundZ(S.tx, S.ty), t: 0, seed: Math.random() * 1000 });
      sfx.thunder(0.6); shake = Math.max(shake, 4);
      burst(S.tx, S.ty, groundZ(S.tx, S.ty), ['#fff7a8', '#8fd8ff', '#ffffff'], 16, { up: 50, speed: 2, life: 0.5 });
      crackTile(Math.floor(S.tx), Math.floor(S.ty), 2);
      if (Math.hypot(player.x - S.tx, player.y - S.ty) < 1.1) hurtPlayer(15, S.tx, S.ty, { kb: 6, lift: 50 });
      n.cd = 2.4;
    }
  } else if (S.kind === 'smash') {
    // REMPART / ACIER : les deux poings abattus devant lui
    if (!S.hit && u >= 0.65) {
      S.hit = true;
      fx.push({ kind: 'ring', x: n.x, y: n.y, z: n.z, t: 0, r: 1.4 });
      sfx.slam(0.2); shake = Math.max(shake, 4);
      crackTile(Math.floor(n.x), Math.floor(n.y), 1);
      if (Math.hypot(player.x - n.x, player.y - n.y) < 1.6) hurtPlayer(n.type === 'acier' ? 18 : 15, n.x, n.y, { kb: 9, lift: 60 });
    }
    if (u >= 1) n.cd = 1.8;
  }
  return u >= 1;
}

// Les coups des héros. kb = recul infligé à Brainless, lift = il décolle, lunge = le héros avance en frappant.
const MOVES = {
  jab: { anim: 'jab', dur: 0.33, hit: 0.45, range: 1.35, dmg: 6, kb: 2, lunge: 1.2 },
  cross: { anim: 'cross', dur: 0.36, hit: 0.5, range: 1.4, dmg: 9, kb: 3.5, lunge: 2 },
  upper: { anim: 'upper', dur: 0.5, hit: 0.55, range: 1.4, dmg: 13, kb: 7, lift: 85, lunge: 1.5 },
  kick: { anim: 'kick', dur: 0.5, hit: 0.55, range: 1.7, dmg: 12, kb: 7.5, lunge: 1 },
  smash: { anim: 'special', dur: 0.7, hit: 0.65, range: 1.7, dmg: 16, kb: 9, lift: 60, lunge: 0.5, ring: true },
  zap: { anim: 'cross', dur: 0.36, hit: 0.5, range: 1.4, dmg: 8, kb: 6, lunge: 1.2, spark: true },
};
const COMBOS = {
  rempart: ['jab', 'cross', 'smash'], acier: ['jab', 'cross', 'upper'],
  ressort: ['kick', 'jab', 'kick'], turbo: ['jab', 'kick', 'kick'], eclair: ['jab', 'zap'],
};
const GUARDS = { rempart: true, acier: true }; // ceux qui savent se mettre en garde

function startCombo(n) {
  n.state = 'combo';
  n.combo = { list: COMBOS[n.type], i: 0, t: 0, hit: false };
  n.dir = faceDir(player.x - n.x, player.y - n.y);
  sfx.swordSwing();
}

// Joue l'enchaînement coup par coup ; renvoie l'animation du coup en cours.
function updateCombo(n, dt) {
  const C = n.combo, M = MOVES[C.list[C.i]];
  C.t += dt / M.dur;
  const dx = player.x - n.x, dy = player.y - n.y, d = Math.hypot(dx, dy) || 1;
  if (C.t < M.hit) { n.dir = faceDir(dx, dy); if (d > 0.8) npcMove(n, dx / d * M.lunge * dt / M.dur, dy / d * M.lunge * dt / M.dur); }
  if (!C.hit && C.t >= M.hit) {
    C.hit = true;
    if (M.ring) { fx.push({ kind: 'ring', x: n.x + dx / d * 0.6, y: n.y + dy / d * 0.6, z: n.z, t: 0, r: 1.3 }); sfx.slam(0.2); crackTile(Math.floor(n.x + dx / d), Math.floor(n.y + dy / d), 1); }
    if (M.spark) burst(n.x + dx / d * 0.8, n.y + dy / d * 0.8, n.z + 16, ['#fff7a8', '#8fd8ff'], 10, { up: 30, speed: 2, life: 0.35 });
    if (d < M.range) {
      hurtPlayer(M.dmg, n.x, n.y, { kb: M.kb, lift: M.lift });
      if (M.kb >= 6) { hitstop = Math.max(hitstop, 0.07); shake = Math.max(shake, 6); }
    } else sfx.punchAir();
  }
  if (C.t >= 1) {
    // coup suivant si Brainless est encore à portée, sinon il souffle un peu
    if (C.i < C.list.length - 1 && d < MOVES[C.list[C.i + 1]].range + 0.6) { C.i++; C.t = 0; C.hit = false; sfx.swordSwing(); }
    else { n.state = 'chase'; n.cd = 0.8 + Math.random() * 0.6; }
  }
  return M.anim;
}

// Est-il pris dans un obstacle (tronc, rocher, mur, maison) ?
function overlapping(x, y) {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (!world.walkable(tx, ty)) return true;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const info = OBJ_INFO[world.objAt(tx + dx, ty + dy)];
    if (!info) continue;
    if (info.solid && Math.hypot(x - (tx + dx + 0.5), y - (ty + dy + 0.5)) < info.solid + 0.15) return true;
    if (info.tilebox && boxHit(x, y, tx + dx + 0.5, ty + dy + 0.5, 0.6)) return true;
    if (info.part || info.building) {
      const a = world.anchorOf(tx + dx, ty + dy), ai = a && OBJ_INFO[world.objAt(a[0], a[1])];
      if (ai && ai.box && boxHit(x, y, a[0], a[1], ai.box + 0.1)) return true;
    }
  }
  return false;
}

// Coincé dans un obstacle : on le fait glisser vers l'endroit libre le plus proche.
function unstick(n, dt) {
  for (const r of [0.3, 0.55, 0.8, 1.1, 1.5]) {
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2, x = n.x + Math.cos(a) * r, y = n.y + Math.sin(a) * r;
      if (overlapping(x, y)) continue;
      const step = Math.min(r, 3 * dt);
      n.x += Math.cos(a) * step; n.y += Math.sin(a) * step;
      return;
    }
  }
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

// Avance vers (tx, ty). Si le chemin direct est bouché, il regarde 16 directions un peu devant
// lui et prend la plus proche de son but qui est libre, en gardant de préférence sa direction
// précédente (sinon il tremblote entre deux choix).
function steer(n, tx, ty, speed, dt) {
  let dx = tx - n.x, dy = ty - n.y;
  const d = Math.hypot(dx, dy) || 1;
  dx /= d; dy /= d;
  const step = Math.min(d, speed * dt), feet = n.z + n.jz;
  const clear = (ux, uy) => !blockedFor(n, n.x + ux * 0.25, n.y + uy * 0.25, feet, true) && !blockedFor(n, n.x + ux * 0.6, n.y + uy * 0.6, feet, true);
  let best = clear(dx, dy) ? [dx, dy] : null, bs = 1;
  if (!best) {
    bs = -9;
    for (let k = 0; k < 16; k++) {
      const a = k * Math.PI / 8, ux = Math.cos(a), uy = Math.sin(a);
      let sc = ux * dx + uy * dy;
      if (n.lastDir) sc += 0.35 * (ux * n.lastDir[0] + uy * n.lastDir[1]);
      if (sc > bs && clear(ux, uy)) { bs = sc; best = [ux, uy]; }
    }
  }
  if (!best || !npcMove(n, best[0] * step, best[1] * step)) { n.stuck += dt; n.lastDir = null; return false; }
  n.lastDir = best;
  n.dir = faceDir(best[0], best[1]);
  n.stuck = bs < 0.2 ? n.stuck + dt : 0; // il s'éloigne de son but : ça compte comme être coincé
  return true;
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
    if (!alive(n)) {
      // le cadavre finit par disparaître (le sang reste un peu plus)
      if ((n.deadT += dt) > 150) npcs.splice(i, 1);
      continue;
    }
    n.alertT = Math.max(0, n.alertT - dt); n.flash = Math.max(0, n.flash - dt);
    n.cd -= dt; n.waveCd -= dt;
    if (n.inside) {
      // la nuit, ils dorment chez eux ; ils ressortent au matin
      if (!night && weather.rain < 0.4) { n.inside = false; n.fade = 0; n.state = 'wander'; n.wait = 1 + Math.random() * 3; }
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
        if (n.dying) { killNpc(n, false); continue; }
      }
    } else if (Math.abs(n.vx) + Math.abs(n.vy) > 0.05) {
      npcMove(n, n.vx * dt, n.vy * dt);
      const k = Math.exp(-8 * dt);
      n.vx *= k; n.vy *= k;
    }
    if (!n.air && overlapping(n.x, n.y)) unstick(n, dt);
    n.z += (groundZ(n.x, n.y) - n.z) * Math.min(1, dt * 12);
    const d = Math.hypot(player.x - n.x, player.y - n.y);
    let anim = 'idle';
    if (n.kind === 'beast') anim = updateBeast(n, dt, d);
    else switch (n.state) {
      case 'ko':
        anim = 'ko';
        if (!n.air && (n.koT -= dt) <= 0) {
          if (fighter(n)) { n.state = alarmed(n.v) ? 'chase' : 'guard'; if (n.kind === 'hero') n.hp = Math.max(n.hp, n.maxHp * 0.35); } else startFlee(n);
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
        if ((n.fleeT -= dt) <= 0 && d > 11 && !alarmed(n.v)) { n.state = 'wander'; n.wait = 2; }
        break;
      }
      case 'wander':
      case 'guard':
        if (n.state === 'wander' && (night || weather.rain > 0.6) && homeIntact(n.home)) {
          anim = 'walk';
          const [hx, hy] = n.home.door;
          steer(n, hx, hy, 1.1 * n.speedK, dt);
          if (Math.hypot(hx - n.x, hy - n.y) < 0.4 || n.stuck > 3) n.inside = true;
          break;
        }
        if (n.kind === 'civ' && alarmed(n.v) && d < 7) { startFlee(n); break; }
        // un garde qui voit Brainless dans un village en alerte lui fonce dessus
        if (fighter(n) && alarmed(n.v) && d < 8 && !player.dead) { n.state = 'chase'; n.alertT = 1.2; break; }
        if (n.wait > 0) {
          n.wait -= dt;
          // au calme, ils saluent le monstre qui passe
          if (n.kind === 'civ' && !alarmed(n.v) && d < 4.5 && n.waveCd <= 0 && !player.dead) {
            n.waveT = 2; n.waveCd = 14 + Math.random() * 10;
            sfx.hello(PEOPLE[n.type].voice);
          }
          if (n.waveT > 0) { n.waveT -= dt; anim = 'wave'; n.dir = faceDir(player.x - n.x, player.y - n.y); }
        } else {
          anim = 'walk';
          steer(n, n.tx, n.ty, (fighter(n) ? 1.4 : 1.1) * n.speedK, dt);
          if (n.stuck > 0.8 || Math.hypot(n.tx - n.x, n.ty - n.y) < 0.15) {
            n.wait = 1.5 + Math.random() * 4; n.stuck = 0;
            pickTarget(n);
          }
        }
        break;
      case 'chase': {
        // il abandonne si le village s'est calmé, ou si Brainless est sorti de son territoire
        const v = world.villages.get(n.v);
        if ((!alarmed(n.v) && d > 6) || (v && Math.hypot(player.x - v.cx, player.y - v.cy) > v.R + 25)) { n.state = 'guard'; n.wait = 0; pickTarget(n); break; }
        if (player.dead) break;
        if (n.kind === 'hero' && GUARDS[n.type] && d < 3 && (player.charging || JABS.includes(player.action)) && Math.random() < dt * 4) {
          n.state = 'block'; n.blockT = 0.5 + Math.random() * 0.6; n.dir = faceDir(player.x - n.x, player.y - n.y); break;
        }
        if (n.kind === 'hero' && n.cd <= 0 && heroSpecial(n, d)) break;
        if (n.kind === 'hero' && d < 1.3 && n.cd <= 0) { startCombo(n); break; }
        if (n.kind === 'hero' && PEOPLE[n.type].style === 'ranged' && d < 3.5) {
          // ECLAIR garde ses distances
          anim = 'walk';
          steer(n, n.x - (player.x - n.x), n.y - (player.y - n.y), 2.2, dt);
          n.dir = faceDir(player.x - n.x, player.y - n.y);
          break;
        }
        if (d > 0.95) {
          anim = d > 3 ? 'run' : 'walk';
          steer(n, player.x, player.y, (d > 3 ? 3 : 2) * (n.kind === 'hero' ? 1.15 : 1), dt);
        } else {
          n.dir = faceDir(player.x - n.x, player.y - n.y);
          if (n.cd <= 0) { n.state = 'attack'; n.atkT = 0; n.hitDone = false; sfx.swordSwing(); }
        }
        break;
      }
      case 'attack':
        anim = 'attack';
        n.atkT += dt / 0.5;
        if (!n.hitDone && n.atkT >= 0.55) {
          n.hitDone = true;
          if (Math.hypot(player.x - n.x, player.y - n.y) < 1.35) hurtPlayer(n.kind === 'hero' ? 10 : 7, n.x, n.y);
        }
        if (n.atkT >= 1) { n.state = 'chase'; n.cd = (n.kind === 'hero' ? 0.6 : 0.8) + Math.random() * 0.6; }
        break;
      case 'special':
        anim = 'special';
        if (updateSpecial(n, dt)) { n.state = 'chase'; }
        break;
      case 'combo':
        anim = updateCombo(n, dt);
        break;
      case 'block':
        // il garde les bras croisés tant que Brainless arme son coup
        anim = 'block';
        n.dir = faceDir(player.x - n.x, player.y - n.y);
        if ((n.blockT -= dt) <= 0 && !player.charging) n.state = 'chase';
        break;
    }
    if (n.anim !== anim) { n.anim = anim; n.t = 0; }
    n.t += dt * animsOf(n)[anim].fps;
  }
  // ils ne se marchent pas dessus, et s'écartent du chemin de Brainless
  for (let i = 0; i < npcs.length; i++) {
    const a = npcs[i];
    if (a.inside || a.air || !alive(a)) continue;
    for (let j = i + 1; j < npcs.length; j++) {
      const b = npcs[j];
      if (b.inside || b.air || !alive(b)) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d > 0.45 || d === 0) continue;
      const k = (0.45 - d) / d * 0.5;
      npcMove(a, -dx * k, -dy * k); npcMove(b, dx * k, dy * k);
    }
    const dx = a.x - player.x, dy = a.y - player.y, d = Math.hypot(dx, dy);
    if (d < 0.6 && d > 0 && !player.dead) npcMove(a, dx / d * (0.6 - d), dy / d * (0.6 - d));
  }
}

// Après avoir flairé : des filets d'odeur arrivent de la direction du village jusqu'à son nez.
function updateScent(dt) {
  if (!scent) return;
  if ((scent.t -= dt) <= 0) { scent = null; return; }
  const dx = scent.v.cx + 0.5 - player.x, dy = scent.v.cy + 0.5 - player.y, d = Math.hypot(dx, dy) || 1;
  if (d < scent.v.R) return; // il y est
  if (Math.random() < dt * 14 * Math.min(1, scent.t / 2)) {
    const ux = dx / d, uy = dy / d, side = (Math.random() - 0.5) * 2.5, far = 3 + Math.random() * 3, life = 0.9 + Math.random() * 0.5;
    const x = player.x + ux * far - uy * side, y = player.y + uy * far + ux * side;
    particles.push({
      x, y, z: player.z + 20 + Math.random() * 10, vx: (player.x - x) / life, vy: (player.y - y) / life, vz: 6,
      g: 0, drag: 0, life, col: ['#ff6b7a', '#ff9aa8', '#c83444'][(Math.random() * 3) | 0], size: 1, streak: true,
    });
  }
}

// ---------------------------------------------------------------- faune sauvage
const BIOME = { [T.GRASS]: 'grass', [T.MEADOW]: 'meadow', [T.FOREST]: 'forest', [T.SNOW]: 'snow', [T.STONE]: 'stone' };
let wildT = 0;

// Des animaux apparaissent hors de l'écran autour de Brainless, selon le biome et l'heure.
function updateWildlife(dt) {
  wildT -= dt;
  if (wildT > 0) return;
  wildT = 1.5;
  const night = darkness() > 0.5;
  let count = 0;
  for (let i = npcs.length - 1; i >= 0; i--) {
    const n = npcs[i];
    if (n.kind !== 'beast' || !alive(n)) continue;
    const d = Math.hypot(n.x - player.x, n.y - player.y);
    if (d > 34 || (BEASTS[n.type].night && !night && d > 16)) { npcs.splice(i, 1); continue; } // trop loin, ou le loup repart au matin
    count++;
  }
  const want = [4, 8, 14][world.p.wildlife];
  if (count >= want || player.dead) return;
  for (let k = 0; k < 6; k++) {
    const a = Math.random() * Math.PI * 2, r = 14 + Math.random() * 8;
    const x = player.x + Math.cos(a) * r, y = player.y + Math.sin(a) * r;
    const tx = Math.floor(x), ty = Math.floor(y), biome = BIOME[world.typeAt(tx, ty)];
    if (!biome || !freeSpot(x, y) || villageAt(x, y, 6)) continue;
    const types = Object.keys(BEASTS).filter((t) => BEASTS[t].biome.includes(biome) && (!BEASTS[t].night || night));
    if (!types.length) continue;
    const type = types[(Math.random() * types.length) | 0];
    const n = BEASTS[type].pack ? 3 : type === 'rabbit' ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const bx = x + (Math.random() - 0.5) * 2, by = y + (Math.random() - 0.5) * 2;
      if (freeSpot(bx, by)) spawnBeast(type, bx, by);
    }
    return;
  }
}

function spawnBeast(type, x, y) {
  const B = BEASTS[type];
  npcs.push({
    type, kind: 'beast', x, y, z: groundZ(x, y), jz: 0, vz: 0, vx: 0, vy: 0, air: false, dir: (Math.random() * 8) | 0,
    anim: 'idle', t: Math.random() * 4, state: 'graze', v: null, hp: B.hp, maxHp: B.hp, tx: x, ty: y, wait: Math.random() * 3,
    alertT: 0, atkT: 0, cd: 0, flash: 0, stuck: 0, inside: false, fj: 0, fleeT: 0, angry: false, speedK: 1, fade: 0,
  });
}

// Renvoie l'animation à jouer.
function updateBeast(n, dt, d) {
  const B = BEASTS[n.type];
  if (n.air) return 'run';
  const hostile = !player.dead && ((B.aggro && (d < B.aggro || (n.angry && d < 14))) || (B.hunt && d < B.hunt));
  if (B.pack && n.hp <= 1) { n.state = 'flee'; n.fleeT = 5; } // le loup blessé s'enfuit
  else if (hostile && n.state !== 'battack') n.state = 'charge';
  else if (B.flee && d < B.flee * (player.sprinting ? 2 : 1) && n.state !== 'flee') { n.state = 'flee'; n.fleeT = 3 + Math.random() * 2; n.fj = (Math.random() - 0.5) * 1.5; }
  if (n.state === 'flee') {
    const ax = n.x - player.x, ay = n.y - player.y, l = Math.hypot(ax, ay) || 1;
    // le lapin zigzague
    const zz = n.type === 'rabbit' ? Math.sin(time * 9 + n.x) * 0.9 : 0, c = Math.cos(n.fj + zz), sn = Math.sin(n.fj + zz);
    steer(n, n.x + (ax * c - ay * sn) / l * 2, n.y + (ax * sn + ay * c) / l * 2, B.speed, dt);
    if (n.stuck > 0.5) { n.fj = (Math.random() - 0.5) * 3; n.stuck = 0; }
    if ((n.fleeT -= dt) <= 0 && d > (B.flee || 6) * 1.6) n.state = 'graze';
    return 'run';
  }
  if (n.state === 'charge') {
    if (!hostile) { n.state = 'graze'; n.angry = false; return 'idle'; }
    if (d > 0.9) { steer(n, player.x, player.y, B.speed, dt); return 'run'; }
    n.dir = faceDir(player.x - n.x, player.y - n.y);
    if (n.cd <= 0) { n.state = 'battack'; n.atkT = 0; n.hitDone = false; sfx.growl(); }
    return 'idle';
  }
  if (n.state === 'battack') {
    n.atkT += dt / 0.4;
    if (!n.hitDone && n.atkT >= 0.5) { n.hitDone = true; if (d < 1.3) hurtPlayer(B.dmg, n.x, n.y); }
    if (n.atkT >= 1) { n.state = 'charge'; n.cd = 1.1; }
    return 'attack';
  }
  // il broute et se promène tranquillement
  if (n.wait > 0) { n.wait -= dt; return 'idle'; }
  steer(n, n.tx, n.ty, B.speed * 0.25, dt);
  if (n.stuck > 0.6 || Math.hypot(n.tx - n.x, n.ty - n.y) < 0.2) {
    n.wait = 2 + Math.random() * 5; n.stuck = 0;
    const a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 3;
    if (freeSpot(n.x + Math.cos(a) * r, n.y + Math.sin(a) * r)) { n.tx = n.x + Math.cos(a) * r; n.ty = n.y + Math.sin(a) * r; }
  }
  return 'walk';
}

// ---------------------------------------------------------------- météo
// Probabilités de chaque temps selon le réglage du monde (calme, variable, orageuse).
const WEATHER_ODDS = [
  { clear: 0.65, cloudy: 0.2, fog: 0.1, rain: 0.05, storm: 0 },
  { clear: 0.4, cloudy: 0.2, fog: 0.12, rain: 0.2, storm: 0.08 },
  { clear: 0.2, cloudy: 0.15, fog: 0.05, rain: 0.3, storm: 0.3 },
];
const weather = { kind: 'clear', left: 40, rain: 0, cloud: 0, fog: 0, storm: 0, flash: 0, boltT: 6, snow: false, drops: [], flakes: [] };
const thunders = []; // grondements à venir (le son arrive après l'éclair)

function updateWeather(dt) {
  const W = weather;
  if ((W.left -= dt) <= 0) {
    const odds = WEATHER_ODDS[world.p.weather];
    let r = Math.random();
    W.kind = Object.keys(odds).find((k) => (r -= odds[k]) < 0) || 'clear';
    W.left = 60 + Math.random() * 100;
  }
  const k = W.kind;
  const ease = (v, t, sp) => v + (t - v) * Math.min(1, dt * sp);
  W.cloud = ease(W.cloud, { clear: 0, cloudy: 0.6, fog: 0.35, rain: 0.8, storm: 1 }[k], 0.15);
  W.rain = ease(W.rain, { rain: 0.7, storm: 1 }[k] || 0, 0.2);
  W.fog = ease(W.fog, { fog: 1, rain: 0.15, storm: 0.1 }[k] || 0, 0.12);
  W.storm = ease(W.storm, k === 'storm' ? 1 : 0, 0.2);
  // en montagne et sur la neige, il neige au lieu de pleuvoir
  const tt = world.typeAt(Math.floor(player.x), Math.floor(player.y));
  W.snow = tt === T.SNOW || world.hAt(Math.floor(player.x), Math.floor(player.y)) >= 5;
  W.flash = Math.max(0, W.flash - dt * 3);
  if (W.storm > 0.5) {
    windT = Math.max(windT, W.storm * 0.6);
    if ((W.boltT -= dt) <= 0) { W.boltT = 3 + Math.random() * 7; strike(); }
  }
  for (let i = thunders.length - 1; i >= 0; i--) if ((thunders[i].t -= dt) <= 0) { sfx.thunder(thunders[i].p, 0); thunders.splice(i, 1); }
}

// La foudre tombe quelque part à l'écran : un arbre peut y passer… ou Brainless.
function strike() {
  let x = player.x + (Math.random() - 0.5) * 18, y = player.y + (Math.random() - 0.5) * 18;
  // elle préfère ce qui dépasse : un arbre proche du point tiré au hasard
  for (let k = 0; k < 12; k++) {
    const tx = Math.floor(x + (Math.random() - 0.5) * 4), ty = Math.floor(y + (Math.random() - 0.5) * 4);
    const info = OBJ_INFO[world.objAt(tx, ty)];
    if (info && info.tree) { x = tx + 0.5; y = ty + 0.5; break; }
  }
  const z = groundZ(x, y), d = Math.hypot(x - player.x, y - player.y);
  fx.push({ kind: 'bolt', x, y, z, t: 0, seed: Math.random() * 1000 });
  weather.flash = 1;
  thunders.push({ t: d * 0.09, p: Math.max(0.4, 1 - d / 25) });
  burst(x, y, z + 4, ['#fff7a8', '#8fd8ff', '#ffffff', '#ffb347'], 20, { up: 60, speed: 2.2, life: 0.6 });
  const tx = Math.floor(x), ty = Math.floor(y), info = OBJ_INFO[world.objAt(tx, ty)];
  if (info && info.tree) damage(tx, ty, 99);
  crackTile(tx, ty, 2);
  for (const n of npcs) if (alive(n) && !n.inside && Math.hypot(n.x - x, n.y - y) < 1.3) hitNpc(n, 5, 0, 0, 0.5);
  if (d < 1.4) {
    if (has('storm')) { player.hp = Math.min(maxHp(), player.hp + 30); showMsg('FOUDRE ABSORBEE', 2); } // il se nourrit de l'orage
    else hurtPlayer(12, x, y);
  }
}

// Texture de brouillard : des nappes tramées qui dérivent (tuilée à l'écran).
function fogBuffer() {
  const w = 160, h = 120, b = makeBuffer(w, h);
  // bruit raccordable : on mélange 4 copies décalées pour que les bords se rejoignent
  const tile = (x, y, sx, sy, seed) => {
    const n = (a, c) => valueNoise(a / sx, c / sy, seed);
    return (n(x, y) * (w - x) * (h - y) + n(x - w, y) * x * (h - y) + n(x, y - h) * (w - x) * y + n(x - w, y - h) * x * y) / (w * h);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = (tile(x, y, 26, 16, 7) * 0.65 + tile(x, y, 9, 6, 8) * 0.35 - 0.5) * 1.6 + 0.5;
    const bay = ((x & 1) ^ (y & 1)) ? 0.04 : -0.04;
    if (v + bay > 0.62) b.set(x, y, [226, 232, 240], 150);
    else if (v + bay > 0.5 && (x + y) % 2 === 0) b.set(x, y, [214, 222, 232], 110);
  }
  return Object.assign(b, { ox: 0, oy: 0 });
}

function drawWeather(dt) {
  const W = weather;
  // pluie (ou neige) en espace écran
  const want = Math.round((W.snow ? 150 : 230) * W.rain);
  const list = W.snow ? W.flakes : W.drops;
  (W.snow ? W.drops : W.flakes).length = 0;
  while (list.length < want) list.push({ x: Math.random() * VW, y: Math.random() * VH, sp: 0.7 + Math.random() * 0.6, gy: VH * (0.3 + Math.random() * 0.75), ph: Math.random() * 6 });
  if (list.length > want) list.length = want;
  const wind = 0.35 + W.storm * 0.5;
  for (const p of list) {
    if (W.snow) {
      p.y += dt * 22 * p.sp; p.x += Math.sin(time * 1.5 + p.ph) * dt * 10 + dt * 8 * wind;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.sp > 0.95 ? 2 : 1, p.sp > 0.95 ? 2 : 1);
    } else {
      p.y += dt * 260 * p.sp; p.x += dt * 260 * p.sp * wind * 0.35;
      ctx.fillStyle = p.sp > 1 ? 'rgba(214,230,255,0.8)' : 'rgba(170,198,236,0.65)';
      for (let i = 0; i < 6; i++) ctx.fillRect(Math.round(p.x - i * wind * 0.4), Math.round(p.y - i), 1, 1);
      if (p.y > p.gy) {
        // éclaboussure au sol
        ctx.fillStyle = 'rgba(220,236,255,0.7)';
        ctx.fillRect(Math.round(p.x) - 1, Math.round(p.gy), 1, 1); ctx.fillRect(Math.round(p.x) + 1, Math.round(p.gy), 1, 1);
      }
    }
    if (p.y > (W.snow ? VH : p.gy) || p.x > VW + 4) { p.y = -4 - Math.random() * 20; p.x = Math.random() * (VW + 40) - 40; p.gy = VH * (0.3 + Math.random() * 0.75); }
  }
  // brouillard qui dérive
  if (W.fog > 0.02) {
    ctx.globalAlpha = Math.min(0.85, W.fog * 0.8);
    const fx0 = -Math.floor((time * 4) % fogImg.width), fy0 = -Math.floor((time * 1.5) % fogImg.height);
    for (let y = fy0; y < VH; y += fogImg.height) for (let x = fx0; x < VW; x += fogImg.width) ctx.drawImage(fogImg, x, y);
    ctx.globalAlpha = 1;
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

// Le village le plus proche qui a encore des habitants vivants (jusqu'à ~3 régions).
function nearestPrey() {
  const rx = Math.floor(player.x / VG), ry = Math.floor(player.y / VG);
  let best = null;
  for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++) {
    const v = world.villageIn(rx + i, ry + j);
    if (!v) continue;
    const dd = world.deaths.get(v.id) || { civ: 0, knight: 0, hero: 0 };
    const left = v.folk - dd.civ + v.garrison - dd.knight + (v.heroes || []).length - (dd.hero || 0);
    const d = Math.hypot(v.cx + 0.5 - player.x, v.cy + 0.5 - player.y);
    if (left > 0 && (!best || d < best.d)) best = { v, d, left };
  }
  return best;
}

function doSniff() {
  const p = nearestPrey();
  if (!p) { showMsg('RIEN A FLAIRER...', 2.5); return; }
  scent = { v: p.v, t: 12 };
  sfx.growl();
}

function startAction(a) {
  if (a === 'rush') sfx.rush();
  else if (JABS.includes(a)) sfx.jab(a === 'hook');
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
  for (const m of bloods) {
    const r = Math.floor(m.x) + Math.floor(m.y);
    let l = decalRows.get(r);
    if (!l) decalRows.set(r, l = []);
    l.push(m);
  }
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
        if (w) { const c = crackImgs[crackMat(t)][w - 1][(x * 7 + y * 13) & 3]; draw(c, sx - c.ox, top - c.oy); }
      }
      const o = world.objAt(x, y);
      // un bâtiment passe avant tout ce qui est sur sa rangée (c'est devant lui)
      if (o && (o < O.PART_W || o > O.PART_NW)) rowEnts.push({ o, x, y, sx, sy, depth: OBJ_INFO[o] && OBJ_INFO[o].building ? d - 0.5 : x + y + 1, bld: !!(OBJ_INFO[o] && OBJ_INFO[o].building) });
    }
    const marks = decalRows.get(d);
    if (marks) {
      for (const m of marks) {
        if (m.img) {
          ctx.globalAlpha = Math.min(1, (180 - m.age) / 20);
          draw(m.img, Math.round(ox + isoX(m.x, m.y) - m.img.ox), Math.round(oy + isoY(m.x, m.y) - m.h * 8 - m.img.oy));
          continue;
        }
        ctx.globalAlpha = Math.min(0.85, (9 - m.age) / 4);
        ctx.fillStyle = m.col;
        ctx.fillRect(Math.round(ox + isoX(m.x, m.y)) - 1, Math.round(oy + isoY(m.x, m.y) - m.h * 8), 3, 1);
      }
      ctx.globalAlpha = 1;
    }
    if (d === pRow && mode === 'play') rowEnts.push({ player: true, mx: player.x, my: player.y, depth: player.x + player.y });
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
  if (player.charging && player.chargeKind === 'punch') drawAim(ox, oy);
  // Brainless visible en transparence derrière les arbres
  if (mode === 'play') {
    ctx.globalAlpha = 0.28;
    drawPlayer(ox, oy, 0);
    ctx.globalAlpha = 1;
  }

  drawFlyers(ox, oy, false);
  drawWeather(Math.min(0.05, time - lastRender)); lastRender = time;
  drawSky();
  drawGlows();
  if (weather.flash > 0) {
    ctx.fillStyle = `rgba(235,240,255,${weather.flash * 0.45})`;
    ctx.fillRect(0, 0, VW, VH);
  }
  drawFlyers(ox, oy, true);
  if (mode !== 'play') return;
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
    draw(g.img, g.x, g.y);
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
  if (!alive(n)) {
    ctx.globalAlpha = Math.min(1, (150 - n.deadT) / 10);
    const im = peopleImgs[n.type][n.anim][n.dir][0];
    draw(im, sx - im.ox, sy - im.oy);
    ctx.globalAlpha = 1;
    if (n === player.nearCorpse) {
      const l = { touch: 'N', keys: 'R', pad: 'L1' }[inputMode] + ': DEVORER';
      drawText(ctx, l, Math.round(sx - textWidth(l) / 2), sy - 18, '#ff9aa8');
    }
    return;
  }
  ctx.drawImage(shadows.s, sx - shadows.s.ox, sy - shadows.s.oy);
  const A = animsOf(n)[n.anim];
  const f = n.anim === 'attack' ? Math.min(A.frames - 1, Math.floor(Math.max(0, n.atkT) * A.frames))
    : n.state === 'combo' ? Math.min(A.frames - 1, Math.floor(Math.min(0.999, n.combo.t) * A.frames))
    : n.anim === 'special' && n.sp ? Math.min(A.frames - 1, Math.floor(Math.min(1, n.sp.t) * A.frames)) : Math.floor(n.t) % A.frames;
  const img = peopleImgs[n.type][n.anim][n.dir][f];
  n.fade = Math.min(1, (n.fade ?? 1) + 1 / 30);
  ctx.globalAlpha = n.fade;
  draw(img, sx - img.ox, sy - jz - img.oy);
  ctx.globalAlpha = 1;
  if (n.flash > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.7;
    draw(img, sx - img.ox, sy - jz - img.oy);
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
  if (n.kind === 'hero' && (n.state !== 'guard' || Math.hypot(n.x - player.x, n.y - player.y) < 6)) {
    // nom et barre de vie du héros
    const name = PEOPLE[n.type].name, w = 22, y = sy - jz - 44;
    drawText(ctx, name, Math.round(sx - textWidth(name) / 2), y - 7, '#ffe28a');
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(sx - w / 2 - 1, y - 1, w + 2, 4);
    ctx.fillStyle = '#e8465e'; ctx.fillRect(sx - w / 2, y, Math.round(w * Math.max(0, n.hp) / n.maxHp), 2);
  } else if (n.alertT > 0) {
    const h = fighter(n) ? 37 : n.type === 'child' ? 24 : 32;
    drawText(ctx, '!', sx - 1, sy - jz - h, fighter(n) ? '#ff5a5e' : '#ffe28a');
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
  draw(img, gx - img.ox, gy - img.oy);
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
    const f = Math.min(A.frames - 1, Math.floor(player.actionT * A.frames));
    img = nomu[player.action][player.dir][f];
    if (player.action === 'rush' && withShadow && !player.water) {
      // image rémanente : la frame d'en face, en transparence, double la nuée de poings
      const ghost = nomu.rush[player.dir][(f + 3) % A.frames];
      ctx.globalAlpha = 0.35;
      draw(ghost, sx - ghost.ox, sy - gz - jz - ghost.oy);
      ctx.globalAlpha = 1;
    }
  } else {
    const A = ANIMS[player.anim];
    img = nomu[player.anim][player.dir][Math.floor(player.t) % A.frames];
  }
  const px = sx - img.ox, py = sy - gz - jz - img.oy;
  if (player.water) {
    // seule la partie au-dessus de la surface est nette ; dessous, on le devine à travers l'eau
    const wl = sy - WATER_LINE;
    const a = ctx.globalAlpha;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, VW, wl); ctx.clip();
    draw(img, px, py);
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.rect(0, wl, VW, VH); ctx.clip();
    ctx.globalAlpha = a * 0.22;
    draw(img, px, py);
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
  draw(img, px, py);
  if (player.flash > 0 && withShadow) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.6;
    draw(img, px, py);
    ctx.restore();
  }
  if (player.charging && withShadow) {
    // il "chauffe" : son corps s'illumine par pulsations
    const pulse = (Math.sin(time * (8 + player.charge * 14)) + 1) / 2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (0.08 + player.charge * 0.3) * pulse;
    draw(img, px, py);
    ctx.restore();
  }
}

// Visée du gros coup : le cône qui sera balayé, en pointillés au sol, qui grandit avec la charge.
function drawAim(ox, oy) {
  const [dx, dy] = aimDir();
  const c = player.charge, R = 2.2 + c * 4.5, half = 0.45 + c * 0.15;
  const base = Math.atan2(dy, dx), z = player.z;
  const pts = [];
  const march = (time * 2) % 0.35;
  for (const side of [-1, 1]) {
    const a = base + side * half, ux = Math.cos(a), uy = Math.sin(a);
    for (let r = 0.8 + march; r < R; r += 0.35) for (const k of [0, 0.1]) pts.push([player.x + ux * (r + k), player.y + uy * (r + k), 0]);
  }
  const n = Math.ceil(half * R * 12);
  for (let i = 0; i <= n; i++) {
    const a = base + (i / n * 2 - 1) * half;
    pts.push([player.x + Math.cos(a) * R, player.y + Math.sin(a) * R, 0]);
  }
  for (let r = 1 + march; r < R * 0.7; r += 0.35) pts.push([player.x + dx * r, player.y + dy * r, 1]); // l'axe du coup
  // ombre sombre dessous, puis pointillés clairs teintés par la charge
  const pulse = 0.85 + Math.sin(time * 10) * 0.15;
  for (const pass of [0, 1]) {
    ctx.globalAlpha = pass ? pulse : 0.75;
    for (const [x, y, axis] of pts) {
      ctx.fillStyle = pass ? (axis ? chargeCols()[1] : '#ffe28a') : '#1a0e08';
      ctx.fillRect(Math.round(ox + isoX(x, y)) - 1 + pass * 0, Math.round(oy + isoY(x, y) - z) + (pass ? 0 : 1), 2, 1);
    }
  }
  ctx.globalAlpha = 1;
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
  } else if (f.kind === 'bolt') {
    // éclair : un zigzag qui tombe du ciel
    if (f.t > 0.3) return;
    const sx = Math.round(ox + isoX(f.x, f.y)), sy = Math.round(oy + isoY(f.x, f.y) - f.z);
    ctx.globalAlpha = 1 - f.t / 0.3;
    let x = sx + Math.round((hash(f.seed | 0, 1, 3) - 0.5) * 30), y = sy - 140;
    for (let i = 0; y < sy; i++) {
      const ny = Math.min(sy, y + 6 + ((hash(f.seed | 0, i, 5) * 8) | 0));
      const nx = sx + Math.round((x - sx) * 0.75 + (hash(f.seed | 0, i, 7) - 0.5) * 10 * (1 - y / sy));
      for (let k = 0; k <= 8; k++) {
        const px = Math.round(x + (nx - x) * k / 8), py = Math.round(y + (ny - y) * k / 8);
        ctx.fillStyle = '#8fd8ff'; ctx.fillRect(px - 1, py, 3, 1);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(px, py, 1, 1);
      }
      x = nx; y = ny;
    }
    ctx.globalAlpha = 1;
  } else if (f.kind === 'mark') {
    // la cible d'ECLAIR au sol, qui clignote
    const sx = ox + isoX(f.x, f.y), sy = oy + isoY(f.x, f.y) - groundZ(f.x, f.y);
    ctx.fillStyle = Math.floor(time * 12) % 2 ? '#fff7a8' : '#8fd8ff';
    for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; ctx.fillRect(Math.round(sx + Math.cos(a) * 12), Math.round(sy + Math.sin(a) * 6), 1, 1); }
  } else if (f.kind === 'collapse') {
    // la maison intacte s'enfonce dans la poussière et laisse voir la ruine
    const sx = ox + isoX(f.x, f.y), sy = oy + isoY(f.x, f.y) - f.gz;
    const u = Math.min(1, f.t / 0.7);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, VW, sy + 14); ctx.clip();
    ctx.globalAlpha = 1 - u;
    draw(f.img, Math.round(sx - f.img.ox + (Math.random() - 0.5) * 3 * (1 - u)), Math.round(sy - f.img.oy + u * u * 20));
    ctx.restore();
  } else if (f.kind === 'fall') {
    const sx = ox + isoX(f.x, f.y), sy = oy + isoY(f.x, f.y) - f.gz;
    const u = Math.min(1, f.t / 0.75);
    const ang = f.side * u * u * Math.PI / 2;
    ctx.save();
    ctx.globalAlpha = f.t > 0.75 ? Math.max(0, 1 - (f.t - 0.75) / 0.2) : 1;
    ctx.translate(Math.round(sx), Math.round(sy));
    ctx.rotate(ang);
    draw(f.img, -f.img.ox, -f.img.oy);
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

let lastRender = 0;
function drawSky() {
  let c = SKY[0][1];
  for (let i = 0; i < SKY.length - 1; i++) {
    if (tod >= SKY[i][0] && tod <= SKY[i + 1][0]) {
      const u = (tod - SKY[i][0]) / (SKY[i + 1][0] - SKY[i][0]);
      c = SKY[i][1].map((v, j) => Math.round(v + (SKY[i + 1][1][j] - v) * u));
      break;
    }
  }
  // ciel couvert : un peu plus sombre et plus bleu
  const k = weather.cloud;
  if (k > 0.01) c = [c[0] * (1 - k * 0.3), c[1] * (1 - k * 0.26), c[2] * (1 - k * 0.18)].map(Math.round);
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
  const w = 52, fill = Math.max(0, Math.min(w - 2, Math.round((w - 2) * player.hp / maxHp())));
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

function drawHungerBar(x, y) {
  const w = 52, fill = Math.round((w - 2) * player.hunger / 100);
  const low = player.hunger < 20 && Math.floor(time * 4) % 2;
  drawText(ctx, 'FAIM', x, y, player.hunger < 20 ? '#ff7a7a' : '#ffb870');
  const bx = x + 26;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(bx, y - 1, w, 7);
  ctx.fillStyle = '#20243a';
  ctx.fillRect(bx + 1, y, w - 2, 5);
  ctx.fillStyle = low ? '#ff4d5e' : '#d9822b';
  ctx.fillRect(bx + 1, y, fill, 5);
  // évolution : un fil violet sous la barre
  const lv = player.level, a = LEVEL_AT[lv - 1], b = LEVEL_AT[lv];
  const evo = b === undefined ? 1 : (player.xp - a) / (b - a);
  ctx.fillStyle = '#c9a0ff';
  ctx.fillRect(bx + 1, y + 5, Math.round((w - 2) * Math.max(0, Math.min(1, evo))), 1);
}

// Le flair : une flèche autour de Brainless pointe vers la viande fraîche, avec la distance.
function drawScent() {
  if (!scent) return;
  const v = scent.v, dx = v.cx + 0.5 - player.x, dy = v.cy + 0.5 - player.y, d = Math.hypot(dx, dy);
  ctx.globalAlpha = Math.min(1, scent.t / 1.5);
  const here = d < v.R;
  const l1 = 'VIANDE FRAICHE', l2 = here ? v.name + ' - ICI' : v.name + '  ' + Math.round(d) + ' PAS';
  const y = Math.round(VH * 0.18);
  drawText(ctx, l1, Math.round(VW / 2 - textWidth(l1) / 2), y, '#ff6b7a');
  drawText(ctx, l2, Math.round(VW / 2 - textWidth(l2) / 2), y + 8, '#ffd0d6');
  if (!here) {
    // direction à l'écran
    let sdx = (dx - dy) * 16, sdy = (dx + dy) * 8;
    const l = Math.hypot(sdx, sdy) || 1;
    sdx /= l; sdy /= l;
    const cx = VW / 2 + sdx * (26 + Math.sin(time * 6) * 2), cy = VH / 2 + sdy * 26 - 6;
    const px = -sdy, py = sdx;
    for (let yy = -8; yy <= 8; yy++) for (let xx = -8; xx <= 8; xx++) {
      // triangle : pointe devant, base derrière
      const a = xx * sdx + yy * sdy, b = xx * px + yy * py;
      if (a < -3 || a > 5 || Math.abs(b) > (5 - a) * 0.55) continue;
      const edge = a < -2 || a > 4 || Math.abs(b) > (5 - a) * 0.55 - 1;
      ctx.fillStyle = edge ? '#4e0c18' : '#ff5a5e';
      ctx.fillRect(Math.round(cx + xx), Math.round(cy + yy), 1, 1);
    }
  }
  ctx.globalAlpha = 1;
}

function drawHomeButton() {
  homeBtn.x = VW - 32 - safe.r;
  homeBtn.y = 11 + safe.t;
  const x = homeBtn.x - 5, y = homeBtn.y - 4;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x - 3, y - 3, 17, 14);
  // petite maison pixel
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 5; i++) ctx.fillRect(x + 5 - i, y + i, 1 + i * 2, 1);
  ctx.fillRect(x + 1, y + 5, 9, 4);
  ctx.fillStyle = '#20243a';
  ctx.fillRect(x + 4, y + 6, 3, 3);
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
  touch: ['MAINTIENS B POUR CHARGER', 'SPRINT: MAINTIENS >> EN MARCHANT', 'N: FLAIRER LA VIANDE FRAICHE'],
  keys: ['ZQSD: BOUGER  MAJ: SPRINT  ESPACE: SAUT', 'J/CLIC: COUP (MAINTENIR = CHARGE)', 'K/CLIC DROIT: FRAPPE AU SOL  R: FLAIRER', 'F: PLEIN ECRAN'],
  pad: ['STICK: BOUGER  B/R2: SPRINT  A: SAUT', 'X: COUP (MAINTENIR = CHARGE)', 'Y: FRAPPE AU SOL  L1: FLAIRER', 'SELECT: SON'],
};

function drawHUD() {
  layoutButtons();
  const x0 = 6 + safe.l, y0 = 6 + safe.t;
  drawText(ctx, 'BRAINLESS', x0, y0, '#f6a6bd');
  drawText(ctx, 'NIV ' + player.level, x0 + 40, y0, '#c9a0ff');
  buttons.n.sub = player.nearCorpse ? 'DEVORER' : 'FLAIR';
  const night = darkness() > 0.5;
  drawText(ctx, (night ? 'NUIT' : 'JOUR') + '  ARBRES ' + stats.trees + '  MAISONS ' + stats.houses + '  VICTIMES ' + (stats.victims + stats.knights), x0, y0 + 8, '#e8f0ff');
  drawSprintBar(x0, y0 + 17);
  drawHpBar(x0, y0 + 26);
  drawHungerBar(x0, y0 + 35);
  if (player.alters.length) drawText(ctx, 'ALTERS: ' + player.alters.map((a) => ALTERS[a].name).join(' '), x0, y0 + 44, '#c9a0ff');
  drawScent();
  drawMuteButton();
  drawHomeButton();
  if (msg) {
    ctx.globalAlpha = Math.min(1, msg.t / 0.6);
    drawText(ctx, msg.text, Math.round(VW / 2 - textWidth(msg.text) / 2), Math.round(VH * 0.3), '#ffe28a');
    if (msg.sub) drawText(ctx, msg.sub, Math.round(VW / 2 - textWidth(msg.sub) / 2), Math.round(VH * 0.3) + 8, '#ffffff');
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
  for (const k of ['a', 'b', 'j', 's', 'n']) {
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
  if (mode === 'play') { if (hitstop > 0) hitstop -= dt; else update(dt); }
  else updateMenu(dt);
  render();
  saveT += dt;
  if (saveT > 4) { saveT = 0; save(); }
  requestAnimationFrame(frame);
}

// Écran d'accueil : la caméra survole lentement le monde.
function updateMenu(dt) {
  time += dt;
  tod = (tod + dt / DAY_LENGTH) % 1;
  pollPad();
  menuPad(pad, dt);
  player.x += dt * 0.9; player.y -= dt * 0.35;
  player.z += (groundZ(player.x, player.y) - player.z) * Math.min(1, dt * 2);
  updateParticles(dt);
  updateFlyers(dt);
  for (let i = fx.length - 1; i >= 0; i--) if ((fx[i].t += dt) > 1.2) fx.splice(i, 1);
}

(async function start() {
  // fond de l'accueil : le dernier monde joué
  const recent = listWorlds()[0];
  if (recent) {
    world = new World(recent.seed, recent.params);
    const s = loadWorldData(recent.id);
    if (s && typeof s.x === 'number') { player.x = s.x; player.y = s.y; tod = s.tod ?? tod; }
  }
  if (!recent || !player.x) { const sp = world.findSpawn(); player.x = sp.x; player.y = sp.y; }
  initMenu({ onPlay: startWorld });
  document.addEventListener('pointerdown', unlockAudio);
  if (location.hash === '#debug') {
    window.BRAINLESS = { get world() { return world; }, player, startWorld, createWorld, listWorlds, quitToMenu, get mode() { return mode; }, stats, O, T, decals, particles, npcs, damage, hurtPlayer,
      vstate, crime, killNpc, hitNpc, nearestPrey, get scent() { return scent; },
      get tod() { return tod; }, set tod(v) { tod = v; }, weather, spawnBeast, gainEvo, has, pages, blockedFor, freeSpot, OBJ_INFO, overlapping, crackTile, craterTile, doSlam, doBigPunch, doRushHit };
  }
  await loadAssets();
  loading.style.display = 'none';
  showMenu('title');
  requestAnimationFrame((t) => { last = t; frame(t); });
})();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
