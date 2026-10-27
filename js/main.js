import { World, Den, Room, T, O, OBJ_INFO, VG, ENTERABLE, ROOM_NAMES, DIG, BUILDINGS } from './world.js';
import { buildVillageSprites, buildRotSprites } from './buildings.js';
import { renderPerson, PEOPLE, PEOPLE_ANIMS, CIVILIANS, HEROES } from './people.js';
import { renderNomu, ANIMS, holdPoint, sizeOf } from './nomu.js';
import { MUTATIONS, BRANCHES, draw3, looks } from './mutations.js';
import { ITEMS, RECIPES, DROPS, STACK, TOOLS, buildIcons, buildMutIcons } from './items.js';
import { renderBeast, BEASTS, BEAST_ANIMS, BEAST_MEAL } from './beasts.js';
import * as SP from './sprites.js';
import { hash, makeBuffer } from './raster.js';
import { drawText, textWidth } from './font.js';
import { sfx, unlockAudio, toggleMute, isMuted, audioRunning, chargeStart, chargeUpdate, chargeStop, updateAmbience, updateMusic, musicMode, cycleMusic } from './audio.js';
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
// Deux jeux de planches : celles de Brainless sont réutilisées (vidées puis remplies à nouveau)
// chaque fois que ses mutations changent, le reste est cuit une fois pour toutes.
const ATLAS = 2048;
const atlasMain = { pages: [], used: 0, page: null, x: 0, y: 0, rowH: 0 };
const atlasNomu = { pages: [], used: 0, page: null, x: 0, y: 0, rowH: 0 };
function resetAtlas(A) { A.used = 0; A.page = null; A.x = A.y = A.rowH = 0; }

function toSprite(buf, A = atlasMain) {
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
  if (A.page && A.x + sw > ATLAS) { A.x = 0; A.y += A.rowH + 1; A.rowH = 0; } // rangée suivante
  if (!A.page || A.y + sh > ATLAS) {
    // planche suivante : on reprend une planche déjà créée (vidée) avant d'en créer une neuve
    let pg = A.pages[A.used];
    if (!pg) { pg = document.createElement('canvas'); pg.width = pg.height = ATLAS; pg.c = pg.getContext('2d'); A.pages.push(pg); }
    else pg.c.clearRect(0, 0, ATLAS, ATLAS);
    A.used++;
    A.page = pg;
    A.x = A.y = A.rowH = 0;
  }
  const page = A.page, packX = A.x, packY = A.y;
  const img = new ImageData(sw, sh);
  for (let y = 0; y < sh; y++) img.data.set(data.subarray(((y + y0) * w + x0) * 4, ((y + y0) * w + x1 + 1) * 4), y * sw * 4);
  page.c.putImageData(img, packX, packY);
  const spr = { page, sx: packX, sy: packY, w: sw, h: sh, width: sw, height: sh, ox: buf.ox - x0, oy: buf.oy - y0 };
  A.x += sw + 1; // 1 px d'écart entre deux sprites
  A.rowH = Math.max(A.rowH, sh);
  return spr;
}

// Dessine un sprite de planche, son coin haut-gauche en (x, y).
function draw(s, x, y) {
  if (s.page) ctx.drawImage(s.page, s.sx, s.sy, s.w, s.h, x, y, s.w, s.h);
}

// Le centre du dessin en (cx, cy), tourné de `rot` quarts de tour : des rotations exactes, les
// pixels restent nets (ce qu'il porte en travers, ce qui tournoie en vol).
function drawCentered(s, cx, cy, rot = 0) {
  if (!s.page) return;
  ctx.save();
  ctx.translate(Math.round(cx), Math.round(cy));
  ctx.rotate((rot & 3) * Math.PI / 2);
  draw(s, -(s.w >> 1), -(s.h >> 1));
  ctx.restore();
}
// Comme `draw` par le point d'ancrage (ax, ay), mais tourné autour du centre du dessin.
function drawTurned(s, ax, ay, rot) {
  if (!(rot & 3)) draw(s, ax - s.ox, ay - s.oy);
  else drawCentered(s, ax - s.ox + (s.w >> 1), ay - s.oy + (s.h >> 1), rot);
}

// ---------------------------------------------------------------- assets
const nomu = {}; // nomu[anim][dir][frame]
// point entre ses mains pour chaque image des anims où il porte quelque chose : holdPts[anim][dir][frame]
const HOLD_ANIMS = ['grab', 'carry', 'carryWalk', 'carryJump', 'throwAim', 'throw', 'heave'];
// à une main (la droite) ; dérapage et freinage en sprint : la prise traîne sous sa main
const HOLD1_ANIMS = ['grab1', 'carry1', 'carryWalk1', 'carryJump1', 'run1', 'drop1', 'rise1', 'throwAim1', 'throw1', 'skid', 'brake'];
const holdPts = {};
let objSprites, objGlow, objRot, seasonImgs, icons, crackImgs, peopleImgs, bloodImgs, ashImgs, flameImgs, waterImgs, foamImgs, rimImgs, shadows, ui;
const blockCache = new Map();

function block(type, h, v) {
  const sn = type === T.GRASS || type === T.FOREST || type === T.MEADOW ? season : 1; // l'herbe change avec les saisons
  const key = type * 1000 + h * 10 + v + sn * 100000;
  let c = blockCache.get(key);
  if (!c) { c = toCanvas(SP.blockBuffer(type, h, v, sn)); blockCache.set(key, c); }
  return c;
}

const tick = () => new Promise(r => setTimeout(r, 0));

// Cuisson de Brainless avec ses mutations visibles `M` (toutes les anims x 8 directions).
let nomuKey = null; // les mutations visibles des sprites cuits
let baking = null; // { p } : recuisson en cours après une mutation (le jeu attend)
function nomuJobs(M) {
  const jobs = [];
  for (const anim in ANIMS) {
    nomu[anim] = [];
    for (let d = 0; d < 8; d++) {
      const list = nomu[anim][d] = [];
      for (let f = 0; f < ANIMS[anim].frames; f++) jobs.push(() => { list[f] = toSprite(renderNomu(anim, f / ANIMS[anim].frames, d, { muts: M }), atlasNomu); });
    }
  }
  return jobs;
}
function bakeHoldPts(M) {
  for (const anim of HOLD_ANIMS.concat(HOLD1_ANIMS)) {
    const one = HOLD1_ANIMS.includes(anim);
    holdPts[anim] = [];
    for (let d = 0; d < 8; d++) holdPts[anim][d] = Array.from({ length: ANIMS[anim].frames }, (_, f) => holdPoint(anim, f / ANIMS[anim].frames, d, one, sizeOf(M)));
  }
}
const lookKey = (M) => Object.keys(M).sort().join(',');
// Après une mutation visible (ou au chargement d'un monde) : on recuit Brainless, par petits bouts.
async function rebakeNomu() {
  const M = shownMuts(), key = lookKey(M);
  if (key === nomuKey || baking) return;
  baking = { p: 0 };
  resetAtlas(atlasNomu);
  const jobs = nomuJobs(M);
  for (let i = 0; i < jobs.length; i++) {
    jobs[i]();
    if (i % 24 === 0) { baking.p = i / jobs.length; await tick(); }
  }
  bakeHoldPts(M);
  nomuKey = key;
  baking = null;
  if (lookKey(shownMuts()) !== key) rebakeNomu(); // muté encore pendant la cuisson
}

async function loadAssets() {
  const jobs = nomuJobs({});
  nomuKey = '';
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
  bakeHoldPts({});
  icons = {};
  const ic = Object.assign(buildIcons(), buildMutIcons());
  for (const id in ic) icons[id] = toCanvas(ic[id]);
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
  for (const id in raw) objSprites[id] = raw[id].map((b) => toSprite(b));
  // les arbres de chaque saison
  const ss = SP.buildSeasonSprites();
  seasonImgs = {};
  for (const sn in ss) { seasonImgs[sn] = {}; for (const id in ss[sn]) seasonImgs[sn][id] = ss[sn][id].map((b) => toSprite(b)); }
  done++; progress(); await tick();
  // bâtiments et objets de village, avec leur couche de fenêtres allumées pour la nuit
  const vs = buildVillageSprites();
  objGlow = {};
  for (const id in vs) {
    objSprites[id] = vs[id].map((s) => toSprite(s.img));
    if (vs[id][0].glow) objGlow[id] = toSprite(vs[id][0].glow);
  }
  // ses abris et ses meubles, sur 4 directions
  const rs = buildRotSprites();
  objRot = {};
  for (const id in rs) {
    objRot[id] = rs[id].map((s) => ({ img: toSprite(s.img), glow: s.glow ? toSprite(s.glow) : null }));
    if (!objSprites[id]) { objSprites[id] = [objRot[id][0].img]; if (objRot[id][0].glow) objGlow[id] = objRot[id][0].glow; }
  }
  bloodImgs = [6, 9, 13].map((r, i) => toSprite(SP.bloodBuffer(r, i * 17 + 3)));
  ashImgs = [8, 10].map((r, i) => toSprite(SP.ashBuffer(r, i * 7 + 2)));
  flameImgs = [0, 1, 2].map((sz) => [0, 1, 2, 3].map((f) => toCanvas(SP.flameBuffer(sz, f))));
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
    g: toCanvas(circleBuf(11, true, [60, 165, 190], 200)),
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
const stats = { trees: 0, rocks: 0, smash: 0, houses: 0, knights: 0, victims: 0, play: 0,
  eaten: 0, heroes: 0, dug: 0, built: 0, caged: 0, expWon: 0, champions: 0, fossils: 0 };
let tod = 0.3;
let time = 0;
const player = { x: 0, y: 0, z: 0, dir: 2, anim: 'idle', t: 0, spd: 0, phase: 0, quad: false, trans: null, lastV: null, action: null, actionT: 0, hitDone: false, dustT: 0, stamina: 1, tired: false, sprinting: false,
  jz: 0, vz: 0, air: false, charging: false, charge: 0, slamPower: 0, runFrame: -1,
  slide: null, mv: null, idleT: 0, water: 0, rippleT: 0,
  chargeKind: null, punchHoldT: 0, punchPower: 0, combo: 0, lastPunch: -1, punchBuf: false,
  aim: null, // pendant la charge du coup : direction visée (vecteur monde), plus fine que les 8 directions
  hp: 100, lastHurt: -99, invuln: 0, flash: 0, kb: null, dead: null, regen: false,
  // faim (100 = repu), évolution (points gagnés en dévorant), alters volés aux héros
  hunger: 100, xp: 0, level: 1, alters: [], eating: null, nearCorpse: null, bigJump: false, starveMsg: false,
  // attraper / lancer : ce qu'il porte ({ o } objet du décor ou { n } habitant/animal, w = poids),
  // visée du lancer (bouton maintenu) et force
  burnT: 0, // en feu
  // mutations choisies, alters (niveau, équipés : 3 emplacements), choix de mutation en attente,
  // inventaire (36 cases, les 9 premières = la barre), case choisie, nid où il se réveille
  muts: [], mutOff: [], lookOff: [], alterLv: {}, equip: [], pendingLv: 0, inv: Array(36).fill(null), sel: 0, spawn: null, meatAcc: 0, sleep: null, spikeT: 0,
  held: null, grabTarget: null, grabArm: false, grabHoldT: 0, aiming: false, throwPow: 0, throwPower: 0,
  achieved: [], trophies: 0, infamy: 0 }; // succès débloqués, trophées exposés, infamie (le royaume le traque)
const npcs = []; // villageois et chevaliers autour de Brainless
const vstate = new Map(); // id du village -> { populated, anger, alarm }
const bloods = []; // flaques de sang au sol
let scent = null; // après avoir flairé : { v, t } le village le plus proche
let msg = null; // bandeau au milieu de l'écran : { text, t }
function showMsg(text, dur = 2.5, sub = '') { msg = { text, sub, t: dur }; }
// ---------------------------------------------------------------- saisons
// 3 jours de jeu chacune : printemps (chênes en fleurs, cerisiers roses), été, automne (feuilles
// rousses qui tombent, herbe jaunie), hiver (arbres nus, sapins et sol enneigés, il neige au lieu de pleuvoir).
const SEASON_LEN = DAY_LENGTH * 3;
const SEASONS = ['PRINTEMPS', 'ETE', 'AUTOMNE', 'HIVER'];
const SEASON_MSG = [['LE PRINTEMPS', 'LES ARBRES FLEURISSENT'], ["L'ETE", ''], ["L'AUTOMNE", 'LES FEUILLES TOMBENT'], ["L'HIVER", 'LA NEIGE RECOUVRE TOUT']];
let season = 0;
const seasonOf = () => Math.floor(stats.play / SEASON_LEN) % 4;
function updateSeason() {
  const sn = seasonOf();
  if (sn === season) return;
  season = sn;
  blockCache.clear();
  if (mode === 'play') { showMsg(SEASON_MSG[sn][0], 3.5, SEASON_MSG[sn][1]); sfx.regen(); }
}
// les images d'un objet pour la saison en cours
const objFrames = (o) => (seasonImgs && seasonImgs[season] && seasonImgs[season][o]) || objSprites[o];
const AUTUMN_COLS = ['#d0682a', '#f0a840', '#9a3a12', '#c99a2a'];
let windT = 0; // rafale après une frappe au sol : la végétation s'agite
// Horloge du balancement de la végétation : le vent la fait avancer plus vite, sans jamais la
// faire sauter (multiplier `time` par la rafale faisait clignoter les arbres après quelques minutes).
let swayT = 0;
const advanceSway = (dt) => { swayT += dt * (1 + Math.min(1.5, windT) * 1.2); };
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
  npcs.length = particles.length = flyers.length = fx.length = decals.length = bloods.length = thrown.length = 0;
  hits.clear(); vstate.clear(); bumpT.clear(); fires.clear();
  drops.length = 0; mutChoice = null; invUI = null; toast = null; build = null; placedFx.clear();
  if (realm) world = surface;
  realm = null; realmWorlds.clear(); realmData = new Map(); realmFade = 0;
  scent = null; msg = null; shake = 0; windT = 0; birds.length = 0; explored.clear(); expedition = null; expCd = 90; tod = 0.3; curVillage = null;
  Object.assign(weather, { kind: 'clear', left: 40, rain: 0, cloud: 0, storm: 0, flash: 0, boltT: 6 });
  weather.drops.length = weather.flakes.length = thunders.length = 0;
  input.punch = input.jump = input.sniff = input.grab = false;
  chargeStop();
}

function startWorld(meta) {
  resetState();
  current = meta;
  world = surface = new World(meta.seed, meta.params);
  load(loadWorldData(meta.id));
  touchWorld(meta.id);
  hideMenu();
  mode = 'play';
  hintT = 9;
  showMsg(meta.name, 2.5);
  season = seasonOf(); blockCache.clear();
  rebakeNomu(); // ses mutations visibles (rien à faire s'il n'en a pas)
}

function quitToMenu() {
  closeBuild();
  save();
  mode = 'menu';
  resetState();
  showMenu('worlds');
}

function load(s) {
  try {
    if (s && typeof s.x === 'number') {
      realmData = new Map(s.realms || []);
      world.rots = new Map(s.rots || []);
      world.racks = new Map(s.racks || []);
      world.ruins = new Map(s.ruins || []);
      world.mods = new Map(s.mods || []);
      world.terr = new Map(s.terr || []);
      world.wear = new Map(s.wear || []);
      world.deaths = new Map(s.deaths || []);
      Object.assign(stats, s.stats || {});
      tod = s.tod ?? tod;
      player.x = s.x; player.y = s.y;
      player.hunger = s.hunger ?? 100; player.xp = s.xp ?? 0; player.level = s.level ?? 1; player.alters = s.alters || [];
      player.muts = s.muts || []; player.mutOff = s.mutOff || []; player.lookOff = s.lookOff || []; player.alterLv = s.alterLv || {}; player.equip = s.equip || player.alters.slice(0, 3);
      player.pendingLv = s.pendingLv || 0; player.spawn = s.spawn || null; player.meatAcc = s.meatAcc || 0;
      player.achieved = s.achieved || []; player.trophies = s.trophies || 0; player.infamy = s.infamy || 0;
      explored.clear(); for (const k of s.explored || []) explored.add(k);
      for (const c of s.captives || []) npcs.push(makeCaptive(c.type, c.x, c.y, c.cage));
      if (Array.isArray(s.inv)) player.inv = Array.from({ length: INV }, (_, i) => (s.inv[i] && ITEMS[s.inv[i].id] ? s.inv[i] : null));
      world.chests = new Map(s.chests || []);
      player.hp = s.hp ?? maxHp();
      if (world.walkable(Math.floor(player.x), Math.floor(player.y))) return;
    }
  } catch (e) { /* pas de sauvegarde lisible */ }
  const sp = world.findSpawn();
  player.x = sp.x; player.y = sp.y;
}

function save() {
  if (mode !== 'play' || !current) return;
  const W = surface, [px, py] = realm ? realm.out : [player.x, player.y]; // dedans : on le sauve devant la porte
  saveWorldData(current.id, {
    captives: (realm ? realm.stash.npcs : npcs).filter((n) => n.captive && alive(n) && !n.held).map((n) => ({ type: n.type, x: n.x, y: n.y, cage: n.caged ? n.cage : null })),
    x: px, y: py, realms: realmSave(), rots: [...W.rots], racks: [...W.racks], ruins: [...W.ruins], explored: [...explored], achieved: player.achieved, trophies: player.trophies, infamy: player.infamy, hp: player.hp, hunger: player.hunger, xp: player.xp, level: player.level, alters: player.alters, tod,
    muts: player.muts, mutOff: player.mutOff, lookOff: player.lookOff, alterLv: player.alterLv, equip: player.equip, pendingLv: player.pendingLv, spawn: player.spawn, meatAcc: player.meatAcc,
    inv: player.inv, chests: [...W.chests], stats, mods: [...W.mods], terr: [...W.terr], wear: [...W.wear], deaths: [...W.deaths],
  });
}
document.addEventListener('visibilitychange', () => { if (document.hidden) { if (build && build.lift) buildDrop(null, false); save(); } });

// ---------------------------------------------------------------- contrôles
const input = { x: 0, y: 0, punch: false, jump: false, sniff: false, grab: false };
// Mode de contrôle affiché : 'touch' (boutons à l'écran), 'keys' (clavier/souris), 'pad' (manette)
let inputMode = window.matchMedia && matchMedia('(pointer: coarse)').matches ? 'touch' : 'keys';
function setMode(m) { if (m !== inputMode) { inputMode = m; hintT = 7; } }
const mouse = { punch: false, charge: false, grab: false };
const joy = { id: null, bx: 0, by: 0, kx: 0, ky: 0 };
const keys = new Set();
const buttons = {
  a: { x: 0, y: 0, r: 16, label: 'A', sub: 'COUP' },
  b: { x: 0, y: 0, r: 14, label: 'B', sub: 'CHARGE' },
  j: { x: 0, y: 0, r: 12, label: '^', sub: 'SAUT' },
  s: { x: 0, y: 0, r: 12, label: '>>', sub: 'SPRINT' },
  n: { x: 0, y: 0, r: 10, label: 'N', sub: 'FLAIR' },
  g: { x: 0, y: 0, r: 11, label: 'P', sub: 'PRENDRE' },
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
  buttons.n.x = a.x - 70; buttons.n.y = a.y - 22;
  buttons.g.x = a.x - 76; buttons.g.y = a.y + 8;
}

function held(k) {
  for (const t of btnTouches.values()) if (t.cur === k || (k === 's' && t.origin === 's')) return true;
  return false;
}
const sprintHeld = () => held('s') || keys.has('ShiftLeft') || keys.has('ShiftRight') || pad.sprint;
const chargeHeld = () => held('b') || keys.has('KeyK') || keys.has('KeyE') || pad.charge || mouse.charge;
const punchHeld = () => held('a') || keys.has('KeyJ') || pad.punch || mouse.punch;
const grabHeld = () => held('g') || keys.has('KeyL') || keys.has('KeyG') || pad.grab || mouse.grab;

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
  if (k === 'g') input.grab = true;
}

const toGame = (t) => [t.clientX / cssPerPx, t.clientY / cssPerPx];

const muteBtn = { x: 0, y: 0, r: 7 };
const musicBtn = { x: 0, y: 0, r: 7 }; // musique du jeu / ma musique (Spotify…) / aucune
const homeBtn = { x: 0, y: 0, r: 7 }; // retour à l'accueil

function onTouchStart(e) {
  e.preventDefault();
  unlockAudio();
  setMode('touch');
  if (mode === 'play' && build) {
    // mode BÂTIR : un doigt glisse, pose, déplace, creuse ; deux doigts promènent la caméra
    for (const t of e.changedTouches) build.touches.set(t.identifier, toGame(t));
    if (build.touches.size >= 2) { buildPan2(build.touches); uiTouch = null; return; }
    const t = e.changedTouches[0];
    if (uiTouch === null && !build.pan2) { uiTouch = t.identifier; buildDown(...toGame(t)); }
    return;
  }
  if (mode === 'play' && overlayOpen()) {
    // un seul doigt pilote l'écran (prendre, glisser, poser)
    const t = e.changedTouches[0];
    if (uiTouch === null) { uiTouch = t.identifier; overlayDown(...toGame(t)); }
    return;
  }
  for (const t of e.changedTouches) {
    const [x, y] = toGame(t);
    if (Math.hypot(x - muteBtn.x, y - muteBtn.y) < muteBtn.r + 6) { toggleMute(); sfx.ui(); continue; }
    if (mode === 'play' && Math.hypot(x - bagBtn.x, y - bagBtn.y) < bagBtn.r + 4) { openInv(); return; }
    if (mode === 'play' && Math.hypot(x - buildBtn.x, y - buildBtn.y) < buildBtn.r + 4) { openBuild(); return; }
    if (mode === 'play' && Math.hypot(x - mapBtn.x, y - mapBtn.y) < mapBtn.r + 4) { openInv(3); return; }
    if (mode === 'play' && hotbarTap(x, y)) continue;
    if (mode === 'play' && Math.hypot(x - musicBtn.x, y - musicBtn.y) < musicBtn.r + 4) { switchMusic(); continue; }
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
let uiTouch = null; // le doigt qui manipule le sac
function onTouchMove(e) {
  e.preventDefault();
  if (mode === 'play' && build) {
    for (const t of e.changedTouches) { if (build.touches.has(t.identifier)) build.touches.set(t.identifier, toGame(t)); }
    if (build.pan2 && build.touches.size >= 2) { buildPan2(build.touches); return; }
    for (const t of e.changedTouches) if (t.identifier === uiTouch) buildMove(...toGame(t));
    return;
  }
  if (mode === 'play' && overlayOpen()) {
    for (const t of e.changedTouches) if (t.identifier === uiTouch) overlayMove(...toGame(t));
    return;
  }
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
  if (build) {
    for (const t of e.changedTouches) build.touches.delete(t.identifier);
    if (build.pan2 && build.touches.size < 2) { build.pan2 = null; if (!build.touches.size) uiTouch = null; }
  }
  for (const t of e.changedTouches) if (t.identifier === uiTouch) { uiTouch = null; if (build) buildUp(...toGame(t)); else if (overlayOpen()) overlayUp(...toGame(t)); }
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
  if (build) { e.preventDefault(); buildKey(e); return; } // ZQSD restent dans `keys` : ils promènent la caméra
  if (overlayOpen()) { keys.delete(e.code); e.preventDefault(); overlayKey(e); return; } // sac ou choix de mutation
  if (e.code === 'KeyI' || e.code === 'Tab') { e.preventDefault(); openInv(); return; }
  if (e.code === 'KeyB') { openBuild(); return; }
  if (e.code === 'KeyV') { openInv(3); return; } // V : la carte
  if (/^Digit[1-9]$/.test(e.code)) player.sel = +e.code[5] - 1;
  if (e.code === 'KeyT') useItem();
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'Escape') { quitToMenu(); return; }
  if (e.code === 'KeyF') toggleFullscreen();
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); // pas de défilement de page
  if (e.code === 'KeyJ') input.punch = true;
  if (e.code === 'Space') input.jump = true;
  if (e.code === 'KeyR') input.sniff = true;
  if (e.code === 'KeyL' || e.code === 'KeyG') input.grab = true;
  if (e.code === 'KeyN') switchMusic();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
// molette : change de case dans la barre
canvas.addEventListener('wheel', (e) => { if (mode === 'play' && build) buildCycle(e.deltaY > 0 ? 1 : -1); else if (mode === 'play' && !overlayOpen()) player.sel = (player.sel + (e.deltaY > 0 ? 1 : 8)) % 9; }, { passive: true });
window.addEventListener('blur', () => { keys.clear(); mouse.punch = mouse.charge = mouse.grab = false; });

// Souris (PC) : clic gauche = coup (maintenir = coup chargé), clic droit = frappe au sol.
canvas.addEventListener('mousedown', (e) => {
  unlockAudio();
  setMode('keys');
  const x = e.clientX / cssPerPx, y = e.clientY / cssPerPx;
  if (mode === 'play' && build) { if (e.button !== 1) buildDown(x, y, e.button === 2); return; }
  if (mode === 'play' && overlayOpen()) { overlayDown(x, y, e.button === 2, e.shiftKey); return; }
  if (Math.hypot(x - muteBtn.x, y - muteBtn.y) < muteBtn.r + 6) { toggleMute(); sfx.ui(); return; }
  if (mode === 'play' && Math.hypot(x - bagBtn.x, y - bagBtn.y) < bagBtn.r + 4) { openInv(); return; }
  if (mode === 'play' && Math.hypot(x - buildBtn.x, y - buildBtn.y) < buildBtn.r + 4) { openBuild(); return; }
  if (mode === 'play' && Math.hypot(x - mapBtn.x, y - mapBtn.y) < mapBtn.r + 4) { openInv(3); return; }
  if (mode === 'play' && hotbarTap(x, y)) return;
  if (mode === 'play' && Math.hypot(x - musicBtn.x, y - musicBtn.y) < musicBtn.r + 4) { switchMusic(); return; }
  if (mode === 'play' && Math.hypot(x - homeBtn.x, y - homeBtn.y) < homeBtn.r + 5) { sfx.ui(); quitToMenu(); return; }
  if (e.button === 0) { mouse.punch = true; input.punch = true; }
  if (e.button === 1) { e.preventDefault(); mouse.grab = true; input.grab = true; }
  if (e.button === 2) mouse.charge = true;
});
canvas.addEventListener('mousemove', (e) => { if (mode === 'play' && build) buildMove(e.clientX / cssPerPx, e.clientY / cssPerPx); else if (mode === 'play' && invUI) overlayMove(e.clientX / cssPerPx, e.clientY / cssPerPx); });
window.addEventListener('mouseup', (e) => {
  if (mode === 'play' && build && e.button !== 1) buildUp(e.clientX / cssPerPx, e.clientY / cssPerPx);
  if (mode === 'play' && invUI && e.button === 0) overlayUp(e.clientX / cssPerPx, e.clientY / cssPerPx);
  if (e.button === 0) mouse.punch = false;
  if (e.button === 1) mouse.grab = false;
  if (e.button === 2) mouse.charge = false;
});

// Musique : celle du jeu, la mienne (Spotify, Apple Music… continue de jouer par-dessus le jeu), ou aucune.
const MUSIC_MSG = { game: ['MUSIQUE DU JEU', ''], mine: ['MA MUSIQUE', 'LANCE TA MUSIQUE : LE JEU NE LA COUPE PLUS'], off: ['SANS MUSIQUE', ''] };
function switchMusic() {
  unlockAudio();
  const m = cycleMusic();
  sfx.ui();
  showMsg(MUSIC_MSG[m][0], 3, MUSIC_MSG[m][1]);
}
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
  if (pad.grabPressed) input.grab = true;
  // croix : gauche/droite = case de la barre, haut = utiliser, bas = sac
  const P = pad.pressed || [];
  if (P[14]) player.sel = (player.sel + 8) % 9;
  if (P[15]) player.sel = (player.sel + 1) % 9;
  if (P[12]) useItem();
  if (P[13]) openInv();
  if (P[11]) openBuild(); // R3
  return pad.sx || pad.sy ? [pad.sx, pad.sy] : null;
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
  if (world.solid && world.solid(tx, ty)) return true; // paroi de la tanière, mur d'un intérieur
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
  if (season === 3 && (o === O.OAK_S || o === O.OAK_M || o === O.OAK_L || o === O.CHERRY)) return WOOD_COLS; // nus en hiver
  if (season === 2 && o !== O.PINE && o !== O.PINE_L && o !== O.SNOW_PINE) return AUTUMN_COLS;
  if (o === O.CHERRY) return season === 0 ? CHERRY_COLS : LEAF_COLS;
  if (o === O.PINE || o === O.PINE_L || o === O.SNOW_PINE) return PINE_COLS;
  return LEAF_COLS;
}

function damage(tx, ty, dmg) {
  const o = world.objAt(tx, ty);
  const info = OBJ_INFO[o];
  if (!info || info.exit) return false; // la porte d'un intérieur, l'échelle de la tanière : incassables
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
    const spr = objFrames(o)[0];
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
  if (DROPS[o]) spawnDrops(cx, cy, DROPS[o]); // ses matériaux
  if (o === O.CHEST && world.chests.has(key)) { spawnDrops(cx, cy, world.chests.get(key).filter(Boolean).map((s) => [s.id, s.n])); world.chests.delete(key); }
  if (o === O.RACK && world.racks.has(key)) { const T0 = world.racks.get(key); spawnDrops(cx, cy, T0.map((id) => [id, 1])); player.trophies = Math.max(0, player.trophies - T0.reduce((a, id) => a + trophyWorth(id), 0)); world.racks.delete(key); }
  if (info.prop === 'lantern') oilSplash(tx, ty); // l'huile de la lanterne s'enflamme
  if (info.village) crime(info.crime || 0.2, cx, cy);
  return true;
}

const PLASTER_COLS = ['#e3d4ae', '#c2b08a', '#f6ecd0'];
const ROOF_COLS = {
  thatch: ['#cfa94a', '#ead37a', '#a3812f'], tile: ['#b84d32', '#d9744c', '#8f3423'],
  slate: ['#526079', '#7083a0', '#3a4558'], barn: ['#a3362a', '#c45a44', '#6b4226'], stone: ROCK_COLS,
  hide: ['#c97249', '#22276b', '#d22838'], // son repaire : cerveau, peau, rayures
};
const PROP_COLS = {
  stone: ROCK_COLS, stall: WOOD_COLS.concat(['#c83444', '#ece2c8']), wood: WOOD_COLS, barrel: WOOD_COLS.concat(['#5a606e']),
  hay: ['#cfa94a', '#ead37a', '#a3812f'], lantern: ['#3a3f4a', '#5a606e', '#ffd77a'],
};
const bumpT = new Map(); // un bâtiment percuté en sprint ne prend pas un coup par image

// Un bâtiment encaisse, tremble, s'abîme puis s'effondre. L'excédent d'un très gros coup
// passe d'un état au suivant : un coup chargé à bout portant le rase d'un coup.
function damageBuilding(ax, ay, dmg, quiet) { // quiet : le feu (pas un méfait de Brainless, le village ne s'en prend pas à lui)
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
  if (!quiet) crime(0.4, ax, ay);
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
    if (!info.built) world.ruins.set(key, stats.play); // les villageois la rebâtiront quand il sera loin
    if (!quiet && !info.built) player.infamy += 3;
    sfx.collapse();
    shake = Math.max(shake, 7);
    fx.push({ kind: 'collapse', img: objSprites[before][0], x: ax, y: ay, gz, t: 0 });
    burst(ax, ay, gz + 6, DUST_COLS.concat(cols), 60, { up: 60, speed: 3.5, g: 60, life: 1.6, spread: 18, big: 0.6 });
    burst(ax, ay, top, cols.concat(WOOD_COLS), 30, { up: 80, speed: 3, big: 0.7 });
    if (!quiet) crime(4, ax, ay);
    if (!quiet) spawnDrops(ax, ay, RUIN_DROPS[info.mat] || []); // ce qu'on récupère dans les décombres
    releaseHome(ax, ay);
  } else {
    sfx.buildingCrack();
    shake = Math.max(shake, 3.5);
    burst(ax, ay, top, cols, 18, { up: 60, speed: 2.2, big: 0.5 });
    if (!quiet) crime(1.5, ax, ay);
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
const HIT_AT = { jabL: 0.44, jabR: 0.44, hook: 0.44, rush: 0.5, bigpunch: 0.22, slam: 0.44, sniff: 0.6, eat: 9, hurt: 9, grab: 0.4, throw: 0.4, heave: 0.45, grab1: 0.4, throw1: 0.4 };
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
    if (n.inside || n.held || !alive(n)) continue;
    const d = Math.hypot(n.x - hx, n.y - hy);
    if (d < wd) { wd = d; who = n; }
  }
  if (strong && mut('tail')) tailSweep(); // QUEUE : le 3e coup balaie tout autour
  if (mut('fists')) fistShock(hx, hy); // POINGS-MASSES : onde de choc au point d'impact
  if (who) {
    hitNpc(who, (strong ? 2 : 1) * strength(), dx, dy, strong ? 0.35 : 0.15);
    if (mut('claws') && alive(who)) who.bleedT = 3; // GRIFFES D'ACIER : il saigne
    shake = Math.max(shake, strong ? 2.5 : 1.5);
    return;
  }
  // sous terre : il creuse la paroi devant lui
  if (world.solid && world.solid(Math.floor(hx), Math.floor(hy))) {
    digTile(Math.floor(hx), Math.floor(hy), Math.round((strong ? 2 : 1) * strength()));
    shake = Math.max(shake, strong ? 2.5 : 1.5);
    return;
  }
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
    if (n.inside || n.held || !alive(n) || !inFan(n.x, n.y)) continue;
    const rx = n.x - player.x, ry = n.y - player.y, d = Math.hypot(rx, ry) || 1;
    hitNpc(n, strength(), rx / d, ry / d, 0.12);
    if (mut('claws') && alive(n)) n.bleedT = 3;
    hit = true;
  }
  const houses = new Set(); // un bâtiment couvre 4 tuiles : un seul coup par salve
  for (let ty = Math.floor(player.y) - 2; ty <= Math.floor(player.y) + 2; ty++) {
    for (let tx = Math.floor(player.x) - 2; tx <= Math.floor(player.x) + 2; tx++) {
      const info = OBJ_INFO[world.objAt(tx, ty)];
      if (!info) continue;
      if (info.part || info.building) {
        const a = world.anchorOf(tx, ty), k = a[0] + ',' + a[1], ai = OBJ_INFO[world.objAt(a[0], a[1])];
        if (houses.has(k) || !ai || !ai.box) continue;
        // on vise le point du mur le plus proche de lui
        const px = Math.max(a[0] - ai.box, Math.min(a[0] + ai.box, player.x)), py = Math.max(a[1] - ai.box, Math.min(a[1] + ai.box, player.y));
        if (!inFan(px, py)) continue;
        houses.add(k);
        damage(a[0], a[1], Math.max(1, Math.round(strength())));
        hit = true;
        continue;
      }
      if (!inFan(tx + 0.5, ty + 0.5)) continue;
      damage(tx, ty, info.small ? 1 : Math.max(1, Math.round(strength())));
      if (!info.small) hit = true;
    }
  }
  shake = Math.max(shake, hit ? 2.2 : 1.2);
  // puissance et vitesse, sans abîmer le sol : arcs de choc en éventail, éclairs d'impact au bout
  // des poings, poussière soufflée au ras du sol, l'herbe et les arbres plient sous le vent
  fx.push({ kind: 'cone', x: player.x + dx * 0.4, y: player.y + dy * 0.4, z: player.z + 20, dx, dy, half: 1.5, r: 0.9, t: 0 });
  for (let i = 0; i < 3; i++) {
    const a = Math.atan2(dy, dx) + (Math.random() * 2 - 1) * 1.4, d = 0.7 + Math.random() * 0.7;
    fx.push({ kind: 'spark', x: player.x + Math.cos(a) * d, y: player.y + Math.sin(a) * d, z: player.z + 18 + Math.random() * 12, t: -i * 0.04 });
  }
  burst(player.x + dx * 0.6, player.y + dy * 0.6, player.z, DUST_COLS, 6, { up: 8, speed: 2.6, g: 60, life: 0.5, spread: 1 });
  windT = Math.max(windT, 0.5);
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
    if (n.inside || n.held || !alive(n) || Math.hypot(n.x - fx0, n.y - fy0) > 0.7 || time - (n.tramT ?? -9) < 0.5) continue;
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
  blowFires(R, inCone, 0.9);
  for (const n of npcs) {
    const rx = n.x - player.x, ry = n.y - player.y, d = Math.hypot(rx, ry) || 0.01;
    if (n.inside || n.held || !alive(n) || d > R || !inCone(rx, ry, d)) continue;
    hitNpc(n, dmgAt(d), dx * 0.7 + rx / d * 0.3, dy * 0.7 + ry / d * 0.3, power * (1 - d / R) + 0.3);
  }
  // le sol se fend dans le cône, et se creuse juste devant à pleine puissance
  for (let ty = Math.floor(player.y - R); ty <= Math.floor(player.y + R); ty++) {
    for (let tx = Math.floor(player.x - R); tx <= Math.floor(player.x + R); tx++) {
      const rx = tx + 0.5 - player.x, ry = ty + 0.5 - player.y, d = Math.hypot(rx, ry);
      if (d > R * 0.7 || d < 0.4 || !inCone(rx, ry, d)) continue;
      if (world.solid && world.solid(tx, ty)) { if (d < R * 0.55) digTile(tx, ty, dmgAt(d)); continue; } // il défonce la paroi
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
  blowFires(R, () => true, 2); // le souffle éteint les flammes
  if (has('storm')) lightningChain(power);
  // au centre, ceux qui sont sous lui sont écrasés ; plus loin ils sont projetés
  const crushR = Math.max(1.3, R * 0.5);
  for (const n of npcs) {
    const rx = n.x - player.x, ry = n.y - player.y, d = Math.hypot(rx, ry) || 0.01;
    if (n.inside || n.held || !alive(n) || d > R) continue;
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
      if (world.solid && world.solid(tx, ty)) { if (d < R * 0.6) digTile(tx, ty, dmgAt(d)); continue; }
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

// Allures debout : la vitesse suit l'inclinaison du joystick (un peu = marche lente, à moitié =
// marche, à fond = course debout). La vitesse réelle rattrape la vitesse voulue en douceur, et
// l'animation est choisie d'après la vitesse réelle : il accélère et ralentit en changeant d'allure.
const WALK_V = 2.2, JOG_V = 4, SPRINT_V = 5.8;
const GAITS = ['walk', 'stride', 'jog'];
function stickSpeed(mag) {
  if (mag < 0.15) return 0;
  if (mag < 0.8) return 0.8 + (mag - 0.15) / 0.65 * (WALK_V - 0.8);
  return WALK_V + Math.min(1, (mag - 0.8) / 0.15) * (JOG_V - WALK_V);
}
// Fait avancer le cycle de pas au rythme de la vitesse (les pieds ne glissent pas) et choisit l'allure.
function gaitStep(dt) {
  const g = Math.max(0, Math.min(1, (player.spd - 2) / 1.4)); // 0 = marche, 1 = course
  player.phase = (player.phase + dt * Math.max(0.7, player.spd / (1.6 + g * 0.9))) % 1;
  player.anim = player.held ? (oneHand() ? 'carryWalk1' : 'carryWalk') : GAITS[g < 0.3 ? 0 : g < 0.7 ? 1 : 2];
  player.t = player.phase * ANIMS.walk.frames;
}
const TRANS_DUR = ANIMS.drop.frames / ANIMS.drop.fps;

// ---------------------------------------------------------------- mise à jour
function update(dt) {
  time += dt;
  stats.play += dt;
  updateSeason();
  if (msg && (msg.t -= dt) <= 0) msg = null;
  for (let i = bloods.length - 1; i >= 0; i--) if ((bloods[i].age += dt) > 180) bloods.splice(i, 1);
  tod = (tod + dt / DAY_LENGTH) % 1;
  hintT -= dt;
  advanceSway(dt);
  windT = Math.max(0, windT - dt);
  if (shake > lastShake + 0.8) rumble(shake / 12, 60 + shake * 20); // la manette vibre avec l'écran
  shake = Math.max(0, shake - dt * 20);
  lastShake = shake;

  let ix = input.x, iy = input.y;
  const kb = keyboardVector();
  if (kb) [ix, iy] = kb.map((v) => (keys.has('KeyC') ? v * 0.6 : v)); // C maintenu : il marche au lieu de courir
  const pv = readPad();
  if (pv) [ix, iy] = pv;
  const mag = Math.min(1, Math.hypot(ix, iy));
  const wasSprinting = player.sprinting && !player.air;
  const prevMv = player.mv;

  if (player.dead) {
    updateDead(dt);
    input.punch = input.jump = input.sniff = input.grab = false;
  } else if (player.sleep) {
    updateSleep(dt);
    input.punch = input.jump = input.sniff = input.grab = false;
    setAnim('idle');
  } else {
    // --- saut
    if (input.jump && !player.air && !player.action && !player.charging && !player.aiming && !player.slide && player.water < 2) {
      player.air = true;
      player.vz = JUMP_V * (player.sprinting ? 1.1 : 1) * (has('leap') ? 1.4 + 0.2 * alterLv('leap') : 1) * (mut('hams') ? 1.35 : 1);
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
    if (!player.action && !player.air && !player.slide && player.water < 2 && !player.held) {
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
      } else if (player.punchHoldT > 0.25 && !player.charging && !player.held &&
        (!player.action || (JABS.includes(player.action) && player.actionT > 0.5))) {
        player.action = null;
        player.charging = true;
        player.chargeKind = 'punch';
        player.charge = 0;
        player.aim = dirWorld(player.dir);
        player.sprinting = false;
        setAnim('pcharge');
        chargeStart();
      } else if (input.punch && !player.charging && player.held) {
        if (!player.action && !player.aiming) { player.grabArm = false; startAction('heave'); sfx.growl(); } // il fracasse sa charge au sol
      } else if (input.punch && !player.charging) {
        if (!player.action) startJab();
        else if (JABS.includes(player.action)) player.punchBuf = true; // le coup suivant part dès que possible
      }
    }
    // --- attraper / lancer (bouton PRENDRE) : un appui = il empoigne ce qui est devant lui.
    // Chargé : appui bref = il lance droit devant (visée aidée), maintenir = il vise au stick et
    // dose la force, relâcher = il lance.
    const canGrab = !player.air && !player.slide && player.water < 2 && !player.charging;
    if (player.held) {
      if (input.grab && !player.action && canGrab) { player.grabArm = true; player.grabHoldT = 0; }
      if (player.grabArm && !player.action) {
        if (grabHeld()) {
          player.grabHoldT += dt;
          if (player.grabHoldT > 0.18 && !player.aiming) {
            player.aiming = true; player.throwPow = 0; player.aim = dirWorld(player.dir); player.spd = 0;
            setAnim(oneHand() ? 'throwAim1' : 'throwAim'); sfx.growl();
          }
          if (player.aiming) {
            player.throwPow = Math.min(1, player.throwPow + dt / 0.9);
            if (mag > 0.3) {
              const cx = ix / mag, ct = iy / mag;
              player.aim = [(cx + ct) / Math.SQRT2, (ct - cx) / Math.SQRT2];
              player.dir = ((Math.round(Math.atan2(ct, cx) / (Math.PI / 4)) % 8) + 8) % 8;
            }
            shake = Math.max(shake, 0.3 + player.throwPow * player.held.w * 0.4);
          }
        } else {
          const aimed = player.aiming;
          player.grabArm = false;
          player.aiming = false;
          if (!aimed) player.aim = tapAim(ix, iy, mag);
          startThrow(aimed ? 0.3 + 0.7 * player.throwPow : 0.45, aimed);
        }
      }
    } else if (input.grab && !player.action && canGrab) startGrab();

    // flairer : il s'arrête, lève la tête et renifle l'air
    player.nearCorpse = player.action || player.held ? null : corpseNear();
    // les mains prises, il peut encore passer une porte (avec un prisonnier dans les bras)
    const near0 = player.action || player.nearCorpse ? null : builtNear();
    player.interact = player.held ? (near0 && (near0.enter || near0.exit) ? near0 : null) : near0;
    if (input.sniff && player.held && player.interact && !player.air) { interact(player.interact); input.sniff = false; }
    if (input.sniff && !player.action && !player.charging && !player.held && !player.air && !player.slide && player.water < 2) {
      player.sprinting = false;
      if (player.nearCorpse) startEat(player.nearCorpse);
      else if (player.interact) interact(player.interact);
      else { startAction('sniff'); sfx.sniff(); }
    }
    input.punch = input.jump = input.sniff = input.grab = false;

    if (player.slide) {
      updateSlide(dt);
    } else if (player.action) {
      const A = ANIMS[player.action];
      const dur = A.frames / A.fps;
      const prev = player.actionT;
      const act = player.action;
      player.actionT += dt / dur * (act === 'eat' && mut('jaw') ? 2 : 1); // MACHOIRE BEANTE : il dévore deux fois plus vite
      const hitAt = HIT_AT[act] ?? 0.4;
      if (act === 'eat') for (const c of CHOMPS) if (prev < c && player.actionT >= c) chomp();
      if (prev < hitAt && player.actionT >= hitAt) {
        if (act === 'rush') doRushHit();
        else if (act === 'grab' || act === 'grab1') seize();
        else if (act === 'throw' || act === 'throw1') doThrow();
        else if (act === 'heave') doHeave();
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
      // il fond sur sa prise ; il prend appui en lançant
      if ((act === 'grab' || act === 'grab1') && player.actionT < hitAt && player.grabTarget) {
        const g = player.grabTarget, gx = g.n ? g.n.x : g.tx + 0.5, gy = g.n ? g.n.y : g.ty + 0.5, d = Math.hypot(gx - player.x, gy - player.y);
        if (d > 0.7) tryMove((gx - player.x) / d * dt * 3.5, (gy - player.y) / d * dt * 3.5);
      }
      if ((act === 'throw' || act === 'throw1') && player.actionT < hitAt) { const [ax, ay] = aimDir(); tryMove(ax * dt * 1.5, ay * dt * 1.5); }
      if (JABS.includes(act) && player.punchBuf && player.actionT >= 0.6) startJab();
      else if (player.actionT >= 1) {
        if (JABS.includes(act)) player.lastPunch = time;
        if (act === 'bigpunch' || act === 'throw' || act === 'throw1') player.aim = null;
        if (act === 'eat') finishEat();
        player.action = null;
        player.t = 0;
      }
      player.sprinting = false;
    } else if (!player.charging && !player.aiming) {
      // Sprint à quatre pattes (bouton SPRINT) : vide la barre ; vide, il faut qu'elle remonte à 35 %.
      if (player.stamina <= 0 && !player.tired) { player.tired = true; sfx.tired(); }
      if (player.tired && player.stamina >= 0.35) player.tired = false;
      // Petite tolérance : un joystick qui repasse par le centre pendant un demi-tour ne coupe pas le sprint.
      player.idleT = mag > 0.15 ? 0 : player.idleT + dt;
      const coasting = wasSprinting && player.mv && player.idleT < 0.12 && sprintHeld();
      const run = sprintHeld() && !player.tired && (mag > 0.15 || coasting) && (!player.held || oneHand()); // à deux mains : pas de galop
      if (!player.air) player.sprinting = run;
      player.moving = mag > 0.15;
      // vitesse réelle : rattrape en douceur la vitesse voulue (sprint, ou selon le joystick)
      const target = player.water === 2 ? 0 : player.sprinting ? SPRINT_V * (has('engine') ? 1.2 + 0.15 * alterLv('engine') : 1) * (mut('legs') ? 1.25 : 1)
        : stickSpeed(mag) * (player.water ? 0.62 : 1) * (player.held ? 1.1 - 0.15 * player.held.w : 1); // plus c'est lourd, plus il est lent
      player.spd += Math.max(-dt * 9, Math.min(dt * (player.sprinting ? 12 : 6), target - player.spd));
      // passage debout <-> quatre pattes : il plonge sur les mains, ou se redresse en courant
      if (player.sprinting && !player.quad && !player.air && !player.water) { player.quad = true; player.trans = { a: oneHand() ? 'drop1' : 'drop', t: 0 }; }
      if (!player.sprinting && player.quad && !player.air) {
        player.quad = false;
        player.trans = mag > 0.15 && !player.water ? { a: oneHand() ? 'rise1' : 'rise', t: 0 } : null;
      }
      if (player.trans && (player.trans.t += dt) >= TRANS_DUR) player.trans = null;
      if (mag > 0.15) {
        const cx = ix / mag, ct = iy / mag;
        const vx = (cx + ct) / Math.SQRT2, vy = (ct - cx) / Math.SQRT2;
        const newDir = ((Math.round(Math.atan2(ct, cx) / (Math.PI / 4)) % 8) + 8) % 8;
        if (player.sprinting && !player.air && !player.water && player.mv && vx * player.mv[0] + vy * player.mv[1] < -0.35) {
          startSlide('skid', newDir); // demi-tour violent
        } else {
          const speed = player.water === 2 ? (player.sprinting ? 4.6 : 1.9) : player.spd;
          if (player.sprinting && !player.air && !player.trans) trample(vx, vy);
          tryMove(vx * speed * dt, vy * speed * dt);
          player.dir = newDir;
          player.lastV = [vx, vy];
          player.mv = player.sprinting ? [vx, vy] : null;
          if (player.water === 2) { setAnim(player.sprinting ? 'swimfast' : 'swim'); swimStrokes(vx, vy); }
          else if (player.trans) { player.anim = player.trans.a; player.t = player.trans.t / TRANS_DUR * ANIMS.drop.frames; }
          else if (player.sprinting) { setAnim(oneHand() ? 'run1' : 'run'); if (!player.air) sprintImpacts(vx, vy); }
          else { gaitStep(dt); if (!player.air) walkSteps(); }
        }
      } else if (coasting && run) {
        tryMove(player.mv[0] * 5.8 * dt, player.mv[1] * 5.8 * dt);
      } else if (player.spd > 0.4 && player.lastV && player.water !== 2 && !player.sprinting && !wasSprinting) {
        // joystick lâché : il ralentit sur quelques pas au lieu de s'arrêter net
        tryMove(player.lastV[0] * player.spd * dt, player.lastV[1] * player.spd * dt);
        gaitStep(dt);
        if (!player.air) walkSteps();
      } else {
        player.spd = 0;
        setAnim(player.water === 2 ? 'tread' : player.held ? (oneHand() ? 'carry1' : 'carry') : 'idle');
        if (player.water === 2) swimStrokes(0, 0);
        if (!player.air) player.sprinting = false;
      }
      // il lâche le sprint en pleine course : il freine
      if (wasSprinting && !player.sprinting && !player.slide && !player.air && !player.water && prevMv && mag <= 0.15) {
        player.mv = prevMv;
        player.spd = 0;
        startSlide('brake', player.dir);
      }
      if (!player.sprinting && !player.slide) player.mv = null;
    }
    // un coup, une charge ou un freinage interrompt le galop : pas de « redressement » après coup
    if (player.action || player.charging || player.aiming || (player.slide && player.slide.kind === 'brake')) { player.quad = false; player.trans = null; }
    if (player.sprinting && !player.air) player.stamina = Math.max(0, player.stamina - dt / 4.5 / (1 + 0.08 * (player.level - 1)) * (has('engine') ? 0.7 - 0.1 * alterLv('engine') : 1) / (mut('lungs') ? 1.5 : 1));
    else if (!player.sprinting) player.stamina = Math.min(1, player.stamina + dt / (player.tired ? 3 : 5));
    const A = ANIMS[player.anim];
    // les allures et les transitions règlent elles-mêmes leur image
    if (!GAITS.includes(player.anim) && !player.anim.startsWith('carryWalk') && !player.trans) player.t += dt * A.fps * (player.charging ? 1 + player.charge * 1.8 : 1);
  }

  const depth = waterDepth(player.x, player.y);
  if (depth && !player.water && !player.air) splash(depth === 2 || wasSprinting ? 1 : 0.5);
  player.water = player.air ? 0 : depth;
  if (player.water === 2 && player.held) dropHeld(); // il nage : la charge tombe à l'eau
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
  if (!realm) updateVillages(dt);
  updateNpcs(dt);
  updateFires(dt);
  if (!realm) { updateWildlife(dt); updateWeather(dt); updateScent(dt); }
  healGround(dt);
  realmDoors(mag);
  realmFade = Math.max(0, realmFade - dt * 2.2);

  updateThrown(dt);
  updateDrops(dt);
  updateParticles(dt);
  // un niveau gagné : le choix de mutation s'ouvre dès qu'il a les mains libres de toute action
  if (player.pendingLv > 0 && !mutChoice && !baking && !player.dead && !player.action && !player.air && !player.sleep) openMutChoice();
  for (let i = decals.length - 1; i >= 0; i--) if ((decals[i].age += dt) > 9) decals.splice(i, 1);
  updateMusic(dt, { night: darkness(), danger: dangerLevel(), rain: weather.rain });
  updateAmbience(dt, { night: darkness() > 0.5, water: waterNearby(), height: world.hAt(Math.floor(player.x), Math.floor(player.y)),
    rain: realm || weather.snow ? 0 : weather.rain, storm: realm ? 0 : weather.storm, fire: fireNear });
  if (!realm) updateFlyers(dt);
  updateBirds(dt);
  updateExplore(dt);
  updateAchievements(dt);
  updateExpedition(dt);
  updateRebuild(dt);
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
    if ((f.kind === 'collapse' && f.t > 0.7) || (f.kind === 'bolt' && f.t > 0.3) || (f.kind === 'mark' && f.t > 8) || (f.kind === 'ring' && f.t > 0.6) || (f.kind === 'fall' && f.t > 0.95) || (f.kind === 'ripple' && f.t > 1.1) || (f.kind === 'cone' && f.t > 0.5) || (f.kind === 'spark' && f.t > 0.14)) fx.splice(i, 1);
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
    else {
      sfx.step(surfaceAt(player.x, player.y), player.held ? 1 + player.held.w * 0.25 : 1);
      if (mut('mass')) shake = Math.max(shake, 1); // MASSE : le sol tremble sous ses pas
      if (player.held && player.held.w >= 2.5) {
        // sous un arbre ou un gros rocher, chaque pas fait trembler le sol
        shake = Math.max(shake, 1.2);
        burst(player.x, player.y, player.z, DUST_COLS, 3, { up: 12, speed: 1, g: 60, life: 0.4, spread: 0 });
      }
    }
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
// Ce que vaut un coup de héros : deux fois un coup ordinaire, un peu plus à chaque niveau de Brainless
// (ils restent une menace même quand il a beaucoup grandi) ; un champion frappe encore moitié plus fort.
const heroMul = (n) => (n && n.kind === 'hero' ? (2 + 0.12 * (player.level - 1)) * (n.boss ? 1.5 : 1) : 1);
function hurtPlayer(dmg, fx0, fy0, opts = {}) {
  if (player.dead || player.invuln > 0) return;
  dmg *= [0.6, 1, 1.5][world.p.difficulty] * (has('absorb') ? 0.6 - 0.1 * alterLv('absorb') : 1) * (mut('carapace') ? 0.75 : 1);
  if (mut('spikes')) {
    // dos d'épines : celui qui le frappe au corps à corps s'y empale
    const n = npcs.find((m) => alive(m) && !m.held && Math.hypot(m.x - fx0, m.y - fy0) < 0.6);
    if (n) { const d = Math.hypot(n.x - player.x, n.y - player.y) || 1; hitNpc(n, 2 * strength(), (n.x - player.x) / d, (n.y - player.y) / d, 0.3); }
  }
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
    if (!mut('grip')) dropHeld(); // le choc lui fait lâcher ce qu'il portait (sauf POIGNE)
    startAction('hurt');
    sfx.bodyHit(false, true);
  }
  sfx.playerHit();
  rumble(0.5, 120);
  burst(player.x, player.y, player.z + 22, ['#fff3b0', '#ffffff', '#8086c4'], 6, { up: 30, speed: 1.5, life: 0.35 });
  if (player.hp <= 0) playerDown();
}

function playerDown() {
  dropHeld();
  player.hp = 0;
  player.dead = { t: 0, moved: false };
  player.action = null; player.charging = false; player.chargeKind = null;
  chargeStop();
  player.slide = null; player.sprinting = false; player.air = false; player.jz = 0; player.vz = 0; player.mv = null; player.kb = null;
  player.spd = 0; player.quad = false; player.trans = null;
  sfx.down();
  shake = Math.max(shake, 5);
}

// Il s'effondre, l'écran tombe au noir, il se réveille au point de départ, régénéré.
function updateDead(dt) {
  const D = player.dead;
  D.t += dt;
  if (D.t > 3.4 && !D.moved) {
    D.moved = true;
    if (realm) exitRealm(true);
    // il se réveille dans son nid s'il en a un (devant chez lui si le nid est dedans), sinon au point de départ
    const P = player.spawn;
    const nest = P && P[2] ? { x: P[0], y: P[1] } : P && world.objAt(P[0], P[1]) === O.NEST ? { x: P[0] + 0.5, y: P[1] + 1.5 } : null;
    const sp = nest && world.walkable(Math.floor(nest.x), Math.floor(nest.y)) ? nest : world.findSpawn();
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
    player.hunger = Math.max(0, player.hunger - dt * 100 / 420 * [0.7, 1, 1.3][world.p.difficulty] * (player.sprinting ? 1.8 : 1) * (mut('stomach') ? 0.6 : 1));
    if (player.hunger <= 0) {
      player.hp -= dt * 1.5;
      if (!player.starveMsg) { player.starveMsg = true; showMsg('IL A FAIM...', 3, 'DEVORE QUELQUE CHOSE'); }
      if (player.hp <= 0) playerDown();
    } else if (player.hunger > 20) player.starveMsg = false;
  }
  // Super régénération : quelques secondes sans coup, et ses blessures se referment (pas le ventre vide).
  if (!player.dead && player.hp < maxHp() && time - player.lastHurt > (mut('brain') ? 2.5 : 4) && player.hunger > 15) {
    if (!player.regen) { player.regen = true; sfx.regen(); }
    player.hp = Math.min(maxHp(), player.hp + 12 * (mut('brain') ? 1.8 : 1) * dt);
    if (Math.random() < dt * 10) {
      burst(player.x + (Math.random() - 0.5) * 0.6, player.y + (Math.random() - 0.5) * 0.6, player.z + 6 + Math.random() * 20,
        ['#8f9cff', '#c9d0ff', '#ff8a9a'], 1, { up: 18, g: -10, speed: 0.1, life: 0.8, spread: 0 });
    }
  } else player.regen = false;
}

// ---------------------------------------------------------------- faim, évolution, alters
const LEVEL_AT = [0, 3, 8, 15, 25, 40, 60, 85, 115, 150, 200, 260, 330, 410, 500, 600, 720, 850, 1000];
const ALTERS = {
  absorb: { name: 'ABSORPTION', desc: 'LES COUPS LUI FONT DEUX FOIS MOINS MAL' },
  leap: { name: 'BOND', desc: 'SAUTS GEANTS, ONDE DE CHOC A LA RECEPTION' },
  engine: { name: 'MOTEUR', desc: 'SPRINT PLUS RAPIDE ET QUI DURE PLUS LONGTEMPS' },
  iron: { name: 'FER', desc: 'SES COUPS FONT 50% DE DEGATS EN PLUS' },
  storm: { name: 'FOUDRE', desc: 'SES COUPS CHARGES FONT TOMBER LA FOUDRE' },
};
// un alter compte s'il est équipé (3 emplacements) ; dévorer un autre héros du même type le monte (niveau 1 à 3)
const has = (a) => player.equip.includes(a);
const alterLv = (a) => (has(a) ? player.alterLv[a] || 1 : 0);
// une mutation acquise peut être désactivée (mutOff) ; active, son apparence peut être cachée (lookOff)
const mut = (id) => player.muts.includes(id) && !player.mutOff.includes(id);
const shownMuts = () => looks(player.muts.filter((id) => mut(id) && !player.lookOff.includes(id)));
const maxHp = () => 100 + 15 * (player.level - 1) + (mut('mass') ? 40 : 0);
// trophées exposés : +3 % de force chacun (une couronne en vaut 3, un emblème 2), 45 % au plus
const trophyBonus = () => 1 + 0.03 * Math.min(15, player.trophies);
const strength = () => trophyBonus() * (1 + 0.12 * (player.level - 1)) * (has('iron') ? 1.3 + 0.2 * alterLv('iron') : 1) * (mut('arms') ? 1.25 : 1) * (mut('claws') ? 1.15 : 1);
const fighter = (n) => n.kind === 'knight' || n.kind === 'hero';

// Ce que rapporte une proie : de quoi manger, et des points d'évolution.
function mealOf(n) {
  if (n.boss) return { food: 100, evo: 30 };
  if (n.kind === 'hero') return { food: 60, evo: 8 };
  if (n.kind === 'knight') return { food: 40, evo: 2 };
  if (n.kind === 'beast') return BEAST_MEAL[n.type];
  return { food: 30, evo: 1 };
}

function corpseNear() {
  let best = null, bd = 1.3;
  for (const n of npcs) {
    if (alive(n) || n.eaten || n.held || n.thrown) continue;
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
  const food = mealOf(n).food / CHOMPS.length;
  // repu : le reste se garde en viande crue dans l'inventaire
  player.meatAcc += Math.max(0, player.hunger + food - 100);
  player.hunger = Math.min(100, player.hunger + food);
  while (player.meatAcc >= 18) { player.meatAcc -= 18; giveOrDrop('meat', 1); toastItem('meat', 1); }
  if (mut('jaw')) player.hp = Math.min(maxHp(), player.hp + 6);
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
  stats.eaten++;
  if (n.kind === 'hero') stats.heroes++;
  if (n.boss) { player.pendingLv++; showMsg('LA FORCE DU CHAMPION', 4, 'UNE MUTATION DE PLUS'); }
  gainEvo(mealOf(n).evo);
  const alter = PEOPLE[n.type] && PEOPLE[n.type].alter;
  if (alter && player.alters.includes(alter) && (player.alterLv[alter] || 1) < 3) {
    // le même alter une deuxième (troisième) fois : il monte de niveau
    player.alterLv[alter] = (player.alterLv[alter] || 1) + 1;
    showMsg(ALTERS[alter].name + ' NIVEAU ' + player.alterLv[alter], 3.5, 'ALTER PLUS PUISSANT');
    sfx.mutate();
  } else if (alter && !player.alters.includes(alter)) {
    player.alters.push(alter);
    player.alterLv[alter] = 1;
    const slot = player.equip.filter(Boolean).length < 3;
    if (slot) { const i = player.equip.indexOf(null); if (i >= 0) player.equip[i] = alter; else player.equip.push(alter); }
    showMsg('ALTER DEVORE : ' + ALTERS[alter].name, 4, slot ? ALTERS[alter].desc : 'EQUIPE-LE DANS LE SAC (ONGLET ALTERS)');
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
    player.pendingLv++; // une mutation à choisir
    showMsg('EVOLUTION ! NIVEAU ' + player.level, 3.5, 'UNE MUTATION APPARAIT...');
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
    .sort((a, b) => Math.hypot(a.x - player.x, a.y - player.y) - Math.hypot(b.x - player.x, b.y - player.y)).slice(0, 1 + alterLv('storm') + Math.round(power * 2));
  for (const n of targets) {
    fx.push({ kind: 'bolt', x: n.x, y: n.y, z: n.z, t: 0, seed: Math.random() * 1000 });
    ignite(Math.floor(n.x), Math.floor(n.y), 2);
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
const alarmed = (id) => { if (id === 'exp') return true; const st = vstate.get(id); return !!st && time - st.alarm < 25; }; // une expédition est toujours sur le pied de guerre

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
    if (n.v !== v.id || n.inside || n.held || !alive(n)) continue;
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
  // le champion d'une ville fortifiée, au milieu de la grand-place
  if (v.champion !== undefined && !dead.champion) {
    for (let k = 0; k < 20; k++) {
      const x = v.cx + 0.5 + (Math.random() - 0.5) * 6, y = v.cy + 2.5 + (Math.random() - 0.5) * 6;
      if (!freeSpot(x, y)) continue;
      const n = spawnNpc(HEROES[v.champion], x, y, v, null);
      n.boss = true; n.state = 'guard'; n.hp = n.maxHp = PEOPLE[n.type].hp * 4;
      break;
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
    for (let i = npcs.length - 1; i >= 0; i--) if (npcs[i].v === id && !npcs[i].held) npcs.splice(i, 1);
  }
  const inside = near.find((v) => Math.hypot(player.x - v.cx, player.y - v.cy) < v.R + 3);
  if (inside && inside !== curVillage && !player.dead) { const st = vstateOf(inside); showMsg(inside.name, 2.5, st.rebuilt ? 'LE VILLAGE A ETE RECONSTRUIT' : ''); st.rebuilt = false; }
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
  if (n.inside || n.held || !alive(n)) return;
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
  if (n.v) { if (n.boss) deathsOf(n.v).champion = 1; else deathsOf(n.v)[n.kind]++; }
  if (n.boss) { stats.champions++; showMsg('LE CHAMPION EST TOMBE', 4, 'SA COURONNE EST A TOI'); }
  if (n.inRoom && realm) realm.harm = true; // tué chez lui : le village le saura
  if (n.v && n.v !== 'exp') player.infamy += n.kind === 'hero' ? 4 : n.kind === 'knight' ? 2 : n.kind === 'civ' ? 1 : 0;
  spawnDrops(n.x, n.y, lootOf(n)); // fer, casque, bouclier, emblème
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
      if (Math.hypot(player.x - n.x, player.y - n.y) < 1.5) hurtPlayer(16 * heroMul(n), n.x, n.y, { kb: 8, lift: 70 });
      n.cd = 2.6;
    }
  } else if (S.kind === 'dash') {
    // TURBO fonce en ligne droite, moteurs à fond
    npcMove(n, S.ux * 11 * dt, S.uy * 11 * dt);
    burst(n.x - S.ux * 0.5, n.y - S.uy * 0.5, n.z + 6, ['#ffb347', '#c9d0e0', '#8a91a0'], 3, { up: 10, speed: 0.4, g: -10, life: 0.4 });
    if (!S.hit && Math.hypot(player.x - n.x, player.y - n.y) < 0.9) { S.hit = true; hurtPlayer(14 * heroMul(n), n.x - S.ux, n.y - S.uy, { kb: 9 }); }
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
      if (Math.hypot(player.x - S.tx, player.y - S.ty) < 1.1) hurtPlayer(15 * heroMul(n), S.tx, S.ty, { kb: 6, lift: 50 });
      n.cd = 2.4;
    }
  } else if (S.kind === 'smash') {
    // REMPART / ACIER : les deux poings abattus devant lui
    if (!S.hit && u >= 0.65) {
      S.hit = true;
      fx.push({ kind: 'ring', x: n.x, y: n.y, z: n.z, t: 0, r: 1.4 });
      sfx.slam(0.2); shake = Math.max(shake, 4);
      crackTile(Math.floor(n.x), Math.floor(n.y), 1);
      if (Math.hypot(player.x - n.x, player.y - n.y) < 1.6) hurtPlayer((n.type === 'acier' ? 18 : 15) * heroMul(n), n.x, n.y, { kb: 9, lift: 60 });
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
      hurtPlayer(M.dmg * heroMul(n), n.x, n.y, { kb: M.kb, lift: M.lift });
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
    if (n.held) { updateHeldNpc(n, dt); continue; }
    if (n.thrown) {
      const r = flyNpc(n, dt);
      if (r === 'gone') { npcs.splice(i, 1); continue; }
      if (r === 'fly') continue;
    }
    if (!alive(n)) {
      // le cadavre finit par disparaître (le sang reste un peu plus)
      if ((n.deadT += dt) > 150) npcs.splice(i, 1);
      continue;
    }
    if (n.burnT > 0 && burnNpc(n, dt)) continue;
    if (n.bleedT > 0) {
      // il saigne (GRIFFES D'ACIER)
      n.bleedT -= dt; n.hp -= dt * 0.3;
      if (Math.random() < dt * 8) burst(n.x, n.y, n.z + 8, BLOOD_COLS, 1, { up: 5, speed: 0.2, life: 0.5, spread: 6 });
      if (n.hp <= 0) { n.bleedT = 0; killNpc(n, false); continue; }
    }
    if (!n.air && world.objAt(Math.floor(n.x), Math.floor(n.y)) === O.SPIKES && time - (n.spikeT ?? -9) > 1) {
      // il marche sur un piège à piques
      n.spikeT = time;
      hitNpc(n, 2 * strength(), 0, 0, 0.2);
      if (n.kind === 'beast' && alive(n)) { n.state = 'flee'; n.fleeT = 3; }
    }
    n.alertT = Math.max(0, n.alertT - dt); n.flash = Math.max(0, n.flash - dt);
    n.cd -= dt; n.waveCd -= dt;
    if (n.inside) {
      // la nuit, ils dorment chez eux ; ils ressortent au matin
      if (!night && weather.rain < 0.4) { n.inside = false; n.fade = 0; n.state = 'wander'; n.wait = 1 + Math.random() * 3; }
      // « au feu ! » : ils sortent en courant
      else if (n.kind === 'civ' && fires.size && villageFire(n)) { n.inside = false; n.fade = 0; n.state = 'bucket'; n.bucket = false; n.fillT = 0; n.stuck = 0; }
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
    const expA = n.exp && n.state === 'chase' ? updateExpMember(n, dt, d) : null;
    if ((n.captive || n.escapee) && n.state !== 'ko' && n.state !== 'hurt') {
      anim = n.captive ? updateCaptive(n, dt, d) : updateEscapee(n, dt, d);
      if (anim === 'escaped') { npcs.splice(i, 1); continue; }
    } else if (n.inRoom && n.state !== 'ko' && n.state !== 'hurt') anim = updateResident(n, dt, d);
    else if (expA) anim = expA;
    else if (n.kind === 'beast') anim = updateBeast(n, dt, d);
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
        anim = n.kind === 'civ' ? 'flee' : 'run'; // un chevalier en feu court, il n'a pas l'anim de fuite
        const ax = n.x - player.x, ay = n.y - player.y, l = Math.hypot(ax, ay) || 1;
        const c = Math.cos(n.fj), sn = Math.sin(n.fj);
        steer(n, n.x + (ax * c - ay * sn) / l * 2, n.y + (ax * sn + ay * c) / l * 2, 3.2 * n.speedK, dt);
        if (n.stuck > 0.6) { n.fj = (Math.random() - 0.5) * 3; n.stuck = 0; }
        if ((n.fleeT -= dt) <= 0 && d > 11 && !alarmed(n.v)) { n.state = 'wander'; n.wait = 2; }
        // assez loin du monstre, on retourne éteindre le feu
        if (n.kind === 'civ' && !(n.burnT > 0) && n.fleeT < 2 && d > 10 && fires.size && villageFire(n)) { n.state = 'bucket'; n.bucket = false; n.fillT = 0; n.stuck = 0; }
        break;
      }
      case 'bucket': {
        // la chaîne des seaux : remplir au puits, courir au feu, jeter l'eau, recommencer
        const fi = villageFire(n), v = world.villages.get(n.v);
        if (!fi || !v || (alarmed(n.v) && d < 6)) {
          n.state = 'wander'; n.wait = 1; n.bucket = false;
          if (v && alarmed(n.v) && d < 6) startFlee(n);
          break;
        }
        if (!n.bucket) {
          const wx = v.cx + 0.5, wy = v.cy + 1.5; // à côté du puits
          if (Math.hypot(wx - n.x, wy - n.y) > 0.5 && n.stuck < 2) { anim = 'walk'; steer(n, wx, wy, 2.6 * n.speedK, dt); }
          else if ((n.fillT += dt) > 0.7) { n.bucket = true; n.fillT = 0; n.stuck = 0; }
        } else {
          const [fx0, fy0] = fireCenter(fi);
          if (Math.hypot(fx0 - n.x, fy0 - n.y) > (fi.bld ? 2.1 : 1.2) && n.stuck < 2) { anim = 'walk'; steer(n, fx0, fy0, 2.2 * n.speedK, dt); }
          else {
            anim = 'wave';
            n.dir = faceDir(fx0 - n.x, fy0 - n.y);
            if ((n.fillT += dt) > 0.45) { douse(fi, n); n.bucket = false; n.fillT = 0; n.stuck = 0; }
          }
        }
        break;
      }
      case 'wander':
      case 'guard':
        // le feu au village : ils courent chercher de l'eau au puits, même en pleine nuit
        if (n.kind === 'civ' && fires.size && !(alarmed(n.v) && d < 7) && villageFire(n)) { n.state = 'bucket'; n.bucket = false; n.fillT = 0; n.stuck = 0; break; }
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
          if (Math.hypot(player.x - n.x, player.y - n.y) < 1.35) hurtPlayer((n.kind === 'hero' ? 10 : 7) * heroMul(n), n.x, n.y);
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
    if (!animsOf(n)[anim]) anim = animsOf(n).run ? 'run' : 'walk'; // une anim qu'il n'a pas : on ne plante pas
    if (n.anim !== anim) { n.anim = anim; n.t = 0; }
    n.t += dt * animsOf(n)[anim].fps;
  }
  // ils ne se marchent pas dessus, et s'écartent du chemin de Brainless
  for (let i = 0; i < npcs.length; i++) {
    const a = npcs[i];
    if (a.inside || a.air || a.held || !alive(a)) continue;
    for (let j = i + 1; j < npcs.length; j++) {
      const b = npcs[j];
      if (b.inside || b.air || b.held || !alive(b)) continue;
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
  { clear: 0.72, cloudy: 0.23, rain: 0.05, storm: 0 },
  { clear: 0.47, cloudy: 0.25, rain: 0.2, storm: 0.08 },
  { clear: 0.23, cloudy: 0.17, rain: 0.3, storm: 0.3 },
];
const weather = { kind: 'clear', left: 40, rain: 0, cloud: 0, storm: 0, flash: 0, boltT: 6, snow: false, drops: [], flakes: [] };
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
  W.cloud = ease(W.cloud, { clear: 0, cloudy: 0.6, rain: 0.8, storm: 1 }[k] || 0, 0.15);
  W.rain = ease(W.rain, { rain: 0.7, storm: 1 }[k] || 0, 0.2);
  W.storm = ease(W.storm, k === 'storm' ? 1 : 0, 0.2);
  // en montagne et sur la neige, il neige au lieu de pleuvoir
  const tt = world.typeAt(Math.floor(player.x), Math.floor(player.y));
  W.snow = season === 3 || tt === T.SNOW || world.hAt(Math.floor(player.x), Math.floor(player.y)) >= 5;
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
  ignite(tx, ty, 6, info && info.tree); // la foudre met le feu (la pluie finit souvent par l'éteindre)
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) ignite(tx + dx, ty + dy, 1.5);
  for (const n of npcs) if (alive(n) && !n.inside && Math.hypot(n.x - x, n.y - y) < 1.3) hitNpc(n, 5, 0, 0, 0.5);
  if (d < 1.4) {
    if (has('storm')) { player.hp = Math.min(maxHp(), player.hp + 30); showMsg('FOUDRE ABSORBEE', 2); } // il se nourrit de l'orage
    else hurtPlayer(12, x, y);
  }
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
}

// ---------------------------------------------------------------- mutations : effets de combat
// QUEUE : le 3e coup de l'enchaînement fouette tout autour de lui.
function tailSweep() {
  const R = 1.7;
  fx.push({ kind: 'ring', x: player.x, y: player.y, z: player.z + 6, t: 0, r: R });
  burst(player.x, player.y, player.z, DUST_COLS, 14, { up: 15, speed: 3, g: 60, life: 0.5, spread: 1 });
  for (const n of npcs) {
    const rx = n.x - player.x, ry = n.y - player.y, d = Math.hypot(rx, ry);
    if (n.inside || n.held || !alive(n) || d > R || d < 0.01) continue;
    hitNpc(n, 1.5 * strength(), rx / d, ry / d, 0.4);
  }
  for (let ty = Math.floor(player.y) - 2; ty <= Math.floor(player.y) + 2; ty++) for (let tx = Math.floor(player.x) - 2; tx <= Math.floor(player.x) + 2; tx++) {
    const info = OBJ_INFO[world.objAt(tx, ty)];
    if (info && info.small && Math.hypot(tx + 0.5 - player.x, ty + 0.5 - player.y) < R) damage(tx, ty, 1);
  }
  sfx.whoosh();
}

// POINGS-MASSES : une petite onde de choc là où le poing frappe.
function fistShock(x, y) {
  fx.push({ kind: 'ring', x, y, z: player.z + 2, t: 0, r: 1.1 });
  burst(x, y, player.z, DUST_COLS.concat(ROCK_COLS), 8, { up: 30, speed: 2, life: 0.5 });
  for (const n of npcs) {
    const d = Math.hypot(n.x - x, n.y - y);
    if (n.inside || n.held || !alive(n) || d > 1.1 || d < 0.3) continue;
    hitNpc(n, strength(), (n.x - x) / d, (n.y - y) / d, 0.25);
  }
  crackTile(Math.floor(x), Math.floor(y), 1);
}

// ---------------------------------------------------------------- inventaire
const INV = 36, CHEST_N = 18;
const drops = []; // objets tombés au sol, qui volent jusqu'à lui
let toast = null; // « +2 BOIS » au-dessus de la barre

// Range `n` objets dans `slots` (piles de 64). Renvoie ce qui n'a pas trouvé de place.
function addItem(id, n, slots = player.inv) {
  for (let i = 0; i < slots.length && n > 0; i++) {
    const s = slots[i];
    if (s && s.id === id && s.n < STACK) { const k = Math.min(n, STACK - s.n); s.n += k; n -= k; }
  }
  for (let i = 0; i < slots.length && n > 0; i++) if (!slots[i]) { const k = Math.min(n, STACK); slots[i] = { id, n: k }; n -= k; }
  return n;
}
const countItem = (id) => player.inv.reduce((t, s) => t + (s && s.id === id ? s.n : 0), 0);
function takeItem(id, n) {
  if (countItem(id) < n) return false;
  for (let i = INV - 1; i >= 0 && n > 0; i--) {
    const s = player.inv[i];
    if (!s || s.id !== id) continue;
    const k = Math.min(n, s.n);
    s.n -= k; n -= k;
    if (!s.n) player.inv[i] = null;
  }
  return true;
}
function giveOrDrop(id, n) {
  const left = addItem(id, n);
  if (left) spawnDrops(player.x, player.y, [[id, left]]);
}
function toastItem(id, n) {
  toast = toast && toast.id === id && toast.t > 0.5 ? { id, n: toast.n + n, t: 2 } : { id, n, t: 2 };
}

// Ce que rapporte ce qui est cassé : des objets qui sautent du point d'impact.
function spawnDrops(x, y, list) {
  for (const [id, n] of list) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 1.2;
      drops.push({ id, x, y, z: groundZ(x, y) + 6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: 50 + Math.random() * 40, t: 0 });
    }
  }
  if (drops.length > 160) drops.splice(0, drops.length - 160);
}

function updateDrops(dt) {
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    d.t += dt;
    const dist = Math.hypot(player.x - d.x, player.y - d.y);
    if (d.t > 0.6 && dist < 2.6 && !player.dead) {
      // aimanté : il file vers Brainless
      const k = Math.min(1, dt * 9 / Math.max(0.2, dist));
      d.x += (player.x - d.x) * k; d.y += (player.y - d.y) * k; d.z += (player.z + 12 - d.z) * k;
      if (dist < 0.45 && addItem(d.id, 1) === 0) { drops.splice(i, 1); sfx.pickup(); toastItem(d.id, 1); }
      continue;
    }
    d.vz -= 260 * dt;
    d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
    const gz = groundZ(d.x, d.y);
    if (d.z < gz) { d.z = gz; d.vz = Math.abs(d.vz) > 30 ? -d.vz * 0.35 : 0; d.vx *= 0.5; d.vy *= 0.5; }
    if (d.t > 150) drops.splice(i, 1);
  }
  if (toast && (toast.t -= dt) <= 0) toast = null;
}

function drawDrop(d, ox, oy) {
  const sx = ox + Math.round(isoX(d.x, d.y)), sy = oy + Math.round(isoY(d.x, d.y));
  const gz = Math.round(groundZ(d.x, d.y)), bob = d.t > 0.6 ? Math.round(Math.sin(time * 4 + d.x * 3) * 1.5) : 0;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fillRect(sx - 3, sy - gz, 7, 2);
  const ic = icons[d.id];
  ctx.drawImage(ic, sx - 6, sy - Math.round(d.z) - 10 + bob);
}

// Ce qu'il casse lâche ses matériaux (un bâtiment effondré : selon ce qu'il était).
const RUIN_DROPS = { thatch: [['straw', 4], ['wood', 3]], tile: [['wood', 4], ['stone', 2]], slate: [['wood', 3], ['stone', 3]], barn: [['wood', 6]], stone: [['stone', 6]], hide: [['wood', 5], ['straw', 3], ['stone', 2]] };

// Une proie qui meurt peut laisser du fer et des trophées.
function lootOf(n) {
  if (n.kind === 'knight') return [['iron', 1 + (Math.random() < 0.5 ? 1 : 0)]].concat(Math.random() < 0.3 ? [['helmet', 1]] : [], Math.random() < 0.2 ? [['shield', 1]] : []);
  if (n.boss) return [['crown', 1], ['emblem', 1], ['iron', 4]];
  if (n.kind === 'hero') return [['emblem', 1], ['iron', 2]];
  return [];
}

// Manger ou poser ce qui est dans la case choisie de la barre.
function useItem() {
  const s = player.inv[player.sel];
  if (!s) { showMsg('CASE VIDE', 1); return; }
  const it = ITEMS[s.id];
  if (it.kind === 'food') {
    if (player.hunger >= 99 && player.hp >= maxHp()) { showMsg("IL N'A PAS FAIM", 1.2); return; }
    player.hunger = Math.min(100, player.hunger + it.food);
    player.hp = Math.min(maxHp(), player.hp + it.hp);
    s.n--; if (!s.n) player.inv[player.sel] = null;
    sfx.crunch();
    burst(player.x, player.y, player.z + 24, s.id === 'berries' ? ['#a8162a', '#e8283c', '#4a923d'] : BLOOD_COLS, 6, { up: 25, speed: 0.8, life: 0.5 });
    return;
  }
  if (it.kind === 'place') { tryPlace(s); return; }
  showMsg(it.name, 1.2, it.kind === 'trophy' ? 'UN TROPHEE DE CHASSE' : 'SERT A FABRIQUER (SAC)');
}

// La tuile devant lui où poser une construction, et si c'est possible.
function placeTarget(o) {
  const [dx, dy] = dirWorld(player.dir);
  // ce qui s'oriente est posé face à lui (la porte d'un abri, le devant d'un meuble)
  let k = 0;
  if (OBJ_INFO[o] && OBJ_INFO[o].rot) {
    const base = big(o) ? [Math.SQRT1_2, Math.SQRT1_2] : [0, 1];
    let best = -9;
    for (let i = 0; i < 4; i++) { const [u, v] = rotUV(base[0], base[1], i), d = -u * dx - v * dy; if (d > best) { best = d; k = i; } }
  }
  if (big(o)) {
    // un abri (2x2) : son centre deux tuiles devant lui
    const tx = Math.round(player.x + dx * 2.2), ty = Math.round(player.y + dy * 2.2);
    const why = player.air ? 'PAS EN SAUTANT' : buildBlock(o, tx, ty);
    return { tx, ty, ok: !why, why, k };
  }
  let tx = Math.floor(player.x + dx * 1.05), ty = Math.floor(player.y + dy * 1.05);
  if (tx === Math.floor(player.x) && ty === Math.floor(player.y)) { tx = Math.floor(player.x + dx * 1.6); ty = Math.floor(player.y + dy * 1.6); }
  const info = OBJ_INFO[world.objAt(tx, ty)];
  let ok = world.walkable(tx, ty) && !(world.solid && world.solid(tx, ty)) && (!info || (info.small && !info.part)) && Math.abs(world.hAt(tx, ty) * 8 - player.z) < 9 && !player.air;
  if (ok && Math.hypot(tx + 0.5 - player.x, ty + 0.5 - player.y) < 0.6) ok = false;
  if (ok) for (const n of npcs) if (!n.inside && !n.held && Math.hypot(n.x - tx - 0.5, n.y - ty - 0.5) < 0.6) { ok = false; break; }
  return { tx, ty, ok, k };
}
// l'objet posé pour un objet du sac (la palissade se met en travers de son regard)
function placeObj(id) {
  const obj = ITEMS[id].obj;
  if (obj !== O.FENCE_X) return obj;
  const [dx, dy] = dirWorld(player.dir);
  return Math.abs(dx) > Math.abs(dy) ? O.FENCE_Y : O.FENCE_X;
}
function tryPlace(s) {
  const obj = placeObj(s.id), t = placeTarget(obj);
  if (!t.ok) { showMsg(t.why || 'PAS ICI', 1.2); sfx.ui(); return; }
  setBuilt(t.tx, t.ty, obj, t.k, null);
  stats.built++;
  s.n--; if (!s.n) player.inv[player.sel] = null;
}

// Aperçu de la construction choisie, posée devant lui : verte si c'est possible, rouge sinon.
function drawPlaceGhost(ox, oy) {
  const s = player.inv[player.sel];
  if (!s || ITEMS[s.id].kind !== 'place' || player.held || player.dead) return;
  const obj = placeObj(s.id), t = placeTarget(obj);
  const img = spriteOf(obj, t.k);
  ctx.globalAlpha = 0.8 + Math.sin(time * 8) * 0.2;
  for (const [x, y] of footprint(obj, t.tx, t.ty)) tileOutline(ox + isoX(x, y), oy + isoY(x, y) - world.hAt(x, y) * 8, t.ok ? '#7ee08a' : '#ff5a5e', true);
  const gx = ox + isoX(t.tx, t.ty), gy = oy + isoY(t.tx, t.ty) - world.hAt(t.tx, t.ty) * 8 + (big(obj) ? 0 : 8);
  ctx.globalAlpha = 0.55;
  draw(img, gx - img.ox, gy - img.oy);
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- mode BÂTIR
// Le monde se fige et la caméra se détache de Brainless : on la promène au doigt (deux doigts quand
// un outil est choisi, ZQSD, stick), et on glisse les constructions du tiroir sur les tuiles autour
// de lui. Le tiroir a des onglets ; dans la tanière, CREUSER / REMBLAYER se peignent au doigt sur
// les parois. Ce qui manque au sac mais qu'il sait fabriquer est fabriqué à la pose. Toucher une
// construction posée la choisit (TOURNER la tourne sur place) ; la maintenir la soulève : on la
// déplace, ou on la range en la lâchant sur le tiroir. Ses abris (2x2) ne se posent que dehors.
const BUILD_TABS = [
  { name: 'CREUSER', ids: ['dig', 'fill'], den: true },
  { name: 'FEU', ids: ['torch', 'campfire', 'totem'] },
  { name: 'ABRIS', ids: ['nest', 'chest', 'cage'] },
  { name: 'MEUBLES', ids: ['table', 'shelf', 'bed', 'rug', 'bones', 'rack'] },
];
const BUILD_LIST = RECIPES.map((r) => r.out);
const TRAY_N = 6; // cases du tiroir (l'onglet le plus garni)
// la charte de l'écran : sa peau indigo, ses rayures rouges, son bec doré, son cerveau
const BUI = { ink: '#090a20', dark: '#151848', base: '#22276b', hi: '#343b8e', dim: '#5a5f9a', red: '#9c1628', redHi: '#d22838', gold: '#e0b23a', goldHi: '#ffe07a', goldLo: '#6b4a10', brain: '#c97249' };
const TOUCH_LIFT = 14; // au doigt, ce qu'on glisse vise la tuile un peu au-dessus du doigt, pour rester visible
let build = null;
const placedFx = new Map(); // "x,y" -> rt() de la pose : la construction tombe en place
const buildTabs = () => BUILD_TABS.filter((t) => !t.den || world.den);
const buildR = () => (world.den ? 12 : realm ? 10 : 9); // portée, en tuiles autour de lui
const isTool = (id) => !!TOOLS[id];
const nameOf = (id) => (TOOLS[id] || ITEMS[id]).name;
const itemOfObj = (o) => (o === O.FENCE_Y ? 'fence' : Object.keys(ITEMS).find((id) => ITEMS[id].kind === 'place' && ITEMS[id].obj === o));
const recipeOf = (id) => RECIPES.find((r) => r.out === id);
const costText = (r) => Object.keys(r.need).map((k) => r.need[k] + ' ' + ITEMS[k].name).join(' + ');
const big = (o) => !!(OBJ_INFO[o] && OBJ_INFO[o].building);
const canRot = (o) => o === O.FENCE_X || o === O.FENCE_Y || !!(OBJ_INFO[o] && OBJ_INFO[o].rot);
const spriteOf = (o, k = 0) => (k && objRot[o] ? objRot[o][k].img : objSprites[o][0]);
// un abri : l'ancre (devant) et ses 3 morceaux qui renvoient vers elle
const PARTS = [[0, 0, 0], [-1, 0, O.PART_W], [0, -1, O.PART_N], [-1, -1, O.PART_NW]];
const footprint = (o, tx, ty) => (big(o) ? PARTS.map(([dx, dy]) => [tx + dx, ty + dy]) : [[tx, ty]]);
// l'objet posé pour une construction, avec son quart de tour (la palissade change d'objet)
function objFor(id) {
  const o = ITEMS[id].obj;
  if (o === O.FENCE_X) return [build.rot & 1 ? O.FENCE_Y : O.FENCE_X, 0];
  return [o, OBJ_INFO[o].rot ? build.rot : 0];
}

function openBuild() {
  if (build || overlayOpen()) return;
  if (!world.den) { showMsg('SEULEMENT DANS TA TANIERE', 2, 'DEHORS, POSE TES ABRIS DEPUIS LA BARRE'); sfx.ui(); return; }
  if (player.dead || player.sleep || player.air || player.action || player.held || player.slide || player.water >= 2) { showMsg('PAS MAINTENANT', 1); sfx.ui(); return; }
  if (dangerLevel() > 0.2) { showMsg('PAS PENDANT UN COMBAT', 1.5); sfx.ui(); return; }
  releaseInputs();
  player.sprinting = false; player.spd = 0;
  setAnim('idle');
  const s = player.inv[player.sel], sel = s && buildTabs().some((t) => t.ids.includes(s.id)) ? s.id : null;
  const tab = sel ? Math.max(0, buildTabs().findIndex((t) => t.ids.includes(sel))) : 0;
  build = { cx: player.x, cy: player.y, cz: player.z, vx: 0, vy: 0, tab, sel, rot: 0, ptr: null, lift: null, pick: null, hover: null,
    undo: [], t: 0, ox: 0, oy: 0, btns: [], touches: new Map(), pan2: null, pend: null, pendBox: null };
  uiTouch = null;
  sfx.ui();
}
function closeBuild() {
  if (!build) return;
  if (build.lift) buildDrop(null, false); // ce qu'il tenait retourne à sa place
  build = null;
  uiTouch = null;
  keys.clear();
  sfx.ui();
}

// --- géométrie
// La tuile visible sous un point de l'écran : la plus en avant dont la colonne (dessus ou flanc) le couvre.
function tileAtScreen(px, py) {
  const A = (px - build.ox) / 16;
  let best = null;
  for (let h = 0; h < 16; h++) {
    const Bd = (py - build.oy + h * 8) / 8;
    const tx = Math.floor((A + Bd) / 2), ty = Math.floor((Bd - A) / 2);
    const th = world.walkable(tx, ty) ? world.hAt(tx, ty) : 0;
    if (th >= h && (!best || tx + ty > best.tx + best.ty)) best = { tx, ty };
  }
  return best;
}
// Où se dessine une construction (point d'ancrage à l'écran) : au centre de sa tuile, ou au coin
// commun des 4 tuiles pour un abri.
const anchorScreen = (o, tx, ty) => [build.ox + isoX(tx, ty), build.oy + isoY(tx, ty) - world.hAt(tx, ty) * 8 + (big(o) ? 0 : 8)];
// La construction dont le dessin est sous le doigt (un mur, un abri dépassent de leur tuile).
// On regarde les pixels du dessin (pas son cadre) : une étagère devant ne vole pas le doigt.
const opaqueAt = (img, lx, ly) => !!img.page && img.page.c.getImageData(img.sx + lx, img.sy + ly, 1, 1).data[3] > 0;
function builtAtScreen(px, py) {
  const t0 = tileAtScreen(px, py);
  if (!t0) return null;
  let best = null;
  for (let dy = 0; dy <= 3; dy++) for (let dx = 0; dx <= 3; dx++) {
    const a = world.anchorOf(t0.tx + dx, t0.ty + dy) || [t0.tx + dx, t0.ty + dy];
    const [tx, ty] = a, o = world.objAt(tx, ty);
    if (!OBJ_INFO[o] || !OBJ_INFO[o].built || (best && tx + ty <= best.tx + best.ty)) continue;
    const img = spriteOf(o, world.rotAt(tx, ty)), [ax, ay] = anchorScreen(o, tx, ty), lx = Math.floor(px - ax + img.ox), ly = Math.floor(py - ay + img.oy);
    if (lx >= 0 && lx < img.w && ly >= 0 && ly < img.h && opaqueAt(img, lx, ly)) best = { tx, ty };
  }
  if (best) return best;
  // un tapis, un piège : on peut aussi toucher sa tuile
  const a = world.anchorOf(t0.tx, t0.ty) || [t0.tx, t0.ty], o = world.objAt(a[0], a[1]);
  return OBJ_INFO[o] && OBJ_INFO[o].built ? { tx: a[0], ty: a[1] } : null;
}
const buildAim = (x, y) => tileAtScreen(x, y - (inputMode === 'touch' ? TOUCH_LIFT : 0));
const centerTile = () => tileAtScreen(VW / 2, VH / 2 + 14);
// Glisser l'écran de (dx, dy) pixels : le monde suit le doigt. La caméra reste près de Brainless.
function panBy(dx, dy) {
  const B = build;
  B.cx -= (dx / 16 + dy / 8) / 2;
  B.cy -= (dy / 8 - dx / 16) / 2;
  const ex = B.cx - player.x, ey = B.cy - player.y, d = Math.hypot(ex, ey), M = buildR() + 3;
  if (d > M) { B.cx = player.x + ex * M / d; B.cy = player.y + ey * M / d; }
}

// Pourquoi on ne peut rien poser sur cette tuile (null : c'est possible).
function tileBlock(tx, ty) {
  if (Math.hypot(tx + 0.5 - player.x, ty + 0.5 - player.y) > buildR()) return 'TROP LOIN DE LUI';
  if (world.solid && world.solid(tx, ty)) return world.den ? "CREUSE D'ABORD" : "C'EST UN MUR";
  if (!world.walkable(tx, ty)) return "PAS SUR L'EAU";
  const info = OBJ_INFO[world.objAt(tx, ty)];
  if (info && !(info.small && !info.part)) return 'LA PLACE EST PRISE';
  if (fires.has(tx + ',' + ty)) return 'CA BRULE';
  if ((Math.floor(player.x) === tx && Math.floor(player.y) === ty) || Math.hypot(tx + 0.5 - player.x, ty + 0.5 - player.y) < 0.75) return 'IL EST DESSUS';
  for (const n of npcs) if (!n.inside && !n.held && Math.hypot(n.x - tx - 0.5, n.y - ty - 0.5) < 0.6) return "QUELQU'UN EST DESSUS";
  return null;
}
// Et pour une construction entière (un abri prend 4 tuiles de même hauteur, dehors seulement).
function buildBlock(o, tx, ty) {
  if (!big(o)) return tileBlock(tx, ty);
  if (realm) return 'SEULEMENT DEHORS';
  const h = world.hAt(tx, ty);
  for (const [x, y] of footprint(o, tx, ty)) {
    const why = tileBlock(x, y);
    if (why) return why;
    if (world.hAt(x, y) !== h) return "LE SOL N'EST PAS PLAT";
  }
  if (Math.abs(player.x - tx) < 1.25 && Math.abs(player.y - ty) < 1.25) return 'IL EST DESSUS';
  return null;
}

// En stock, ou fabricable avec ce qu'il a ?
function buildStock(id) {
  if (isTool(id)) return { n: 0, craft: false, tool: true };
  const n = countItem(id);
  return { n, craft: !n && canCraft(recipeOf(id)) };
}
// Prend une construction dans le sac, ou la fabrique sur place.
function takeForBuild(id) {
  if (countItem(id)) { takeItem(id, 1); return true; }
  const r = recipeOf(id);
  if (!canCraft(r)) {
    const miss = Object.keys(r.need).filter((k) => countItem(k) < r.need[k]).map((k) => r.need[k] - countItem(k) + ' ' + ITEMS[k].name).join(' + ');
    showMsg('IL MANQUE ' + miss, 1.8, 'CASSE LE DECOR POUR EN TROUVER');
    sfx.ui();
    return false;
  }
  for (const k in r.need) takeItem(k, r.need[k]);
  if (r.n > 1) giveOrDrop(id, r.n - 1);
  sfx.craft();
  return true;
}

function setBuilt(tx, ty, o, k, chest) {
  const key = tx + ',' + ty;
  for (const [dx, dy, part] of big(o) ? PARTS : []) if (dx || dy) world.setObj(tx + dx, ty + dy, part);
  world.setObj(tx, ty, o);
  world.setRot(tx, ty, k);
  hits.delete(key);
  if (o === O.CHEST) world.chests.set(key, chest || Array(CHEST_N).fill(null));
  placedFx.set(key, rt());
  sfx.place();
  shake = Math.max(shake, big(o) ? 3 : 1.5);
  burst(tx + (big(o) ? 0 : 0.5), ty + (big(o) ? 0 : 0.5), world.hAt(tx, ty) * 8, DUST_COLS, big(o) ? 26 : 10, { up: 25, speed: 1.4, g: 60, life: 0.5, spread: big(o) ? 10 : 2 });
}
// Retire une construction (et les morceaux d'un abri) : { o, k, chest }.
function clearBuilt(tx, ty) {
  const o = world.objAt(tx, ty), key = tx + ',' + ty, k = world.rotAt(tx, ty), chest = world.chests.get(key) || null;
  world.chests.delete(key);
  const T0 = world.racks.get(key);
  if (T0) { for (const id of T0) giveOrDrop(id, 1); player.trophies = Math.max(0, player.trophies - T0.reduce((a, id) => a + trophyWorth(id), 0)); world.racks.delete(key); } // ses trophées lui reviennent
  for (const [x, y] of footprint(o, tx, ty)) world.setObj(x, y, O.NONE);
  hits.delete(key);
  return { o, k, chest };
}
const spill = (chest) => { if (chest) for (const s of chest) if (s) giveOrDrop(s.id, s.n); };
function pushUndo(u) { build.undo.push(u); if (build.undo.length > 60) build.undo.shift(); }

function buildPlace(id, tx, ty) {
  const [o, k] = objFor(id);
  const why = buildBlock(o, tx, ty);
  if (why) { showMsg(why, 1); sfx.ui(); return false; }
  if (!takeForBuild(id)) return false;
  const prev = big(o) ? O.NONE : world.objAt(tx, ty);
  setBuilt(tx, ty, o, k, null);
  stats.built++;
  pushUndo({ kind: 'place', tx, ty, o, prev, id });
  build.pick = null;
  return true;
}

// Soulever une construction posée (elle quitte le monde le temps qu'on la promène).
function buildLift(tx, ty) {
  const o = world.objAt(tx, ty), info = OBJ_INFO[o];
  if (!info || !info.built) return false;
  if (info.building && info.state > 0) {
    // un abri abîmé ou en ruine : on le range (et on le reposera tout neuf)
    clearBuilt(tx, ty);
    giveOrDrop(itemOfObj(BUILDINGS[info.building].ids[0]), 1);
    showMsg('ABRI RECUPERE', 2, 'REPOSE-LE : IL SERA COMME NEUF');
    sfx.pickup();
    return false;
  }
  if (footprint(o, tx, ty).some(([x, y]) => fires.has(x + ',' + y))) { showMsg('CA BRULE', 1); sfx.ui(); return false; }
  if (Math.hypot(tx + 0.5 - player.x, ty + 0.5 - player.y) > buildR() + (big(o) ? 1 : 0)) { showMsg('TROP LOIN DE LUI', 1); sfx.ui(); return false; }
  const c = clearBuilt(tx, ty);
  build.lift = { o: c.o, k: c.k, tx, ty, chest: c.chest, spawn: !!(player.spawn && !player.spawn[2] && player.spawn[0] === tx && player.spawn[1] === ty) };
  build.pick = null;
  sfx.grabReach();
  burst(tx + 0.5, ty + 0.5, world.hAt(tx, ty) * 8, DUST_COLS, 6, { up: 20, speed: 1, g: 60, life: 0.4, spread: 1.5 });
  return true;
}
// Lâcher ce qu'on tient : sur une tuile (déplacée), sur le tiroir (rangée), sinon retour à sa place.
function buildDrop(t, store) {
  const L = build.lift;
  if (!L) return;
  build.lift = null;
  const id = itemOfObj(L.o);
  if (store) {
    spill(L.chest);
    giveOrDrop(id, 1);
    toastItem(id, 1);
    sfx.pickup();
    if (L.spawn) player.spawn = null;
    pushUndo({ kind: 'store', tx: L.tx, ty: L.ty, o: L.o, k: L.k, id });
    return;
  }
  const why = t && buildBlock(L.o, t.tx, t.ty);
  if (t && !why && (t.tx !== L.tx || t.ty !== L.ty)) {
    setBuilt(t.tx, t.ty, L.o, L.k, L.chest);
    if (L.spawn) player.spawn = [t.tx, t.ty];
    if (big(L.o)) moveRealm([L.tx, L.ty], [t.tx, t.ty]);
    pushUndo({ kind: 'move', from: [L.tx, L.ty], to: [t.tx, t.ty], o: L.o });
    return;
  }
  if (why) showMsg(why, 1);
  setBuilt(L.tx, L.ty, L.o, L.k, L.chest);
}

// Les outils de la tanière : creuser une paroi qui touche une salle, ou en remettre (1 TERRE).
const NEIGH4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function buildDig(tx, ty) {
  if (!world.den || !world.solid(tx, ty)) return false;
  const t = world.typeAt(tx, ty), D = DIG[t];
  if (!D) { showMsg('ROCHE TROP DURE', 0.8); return false; }
  if (Math.hypot(tx + 0.5 - player.x, ty + 0.5 - player.y) > buildR()) { showMsg('TROP LOIN DE LUI', 0.8); return false; }
  if (!NEIGH4.some(([dx, dy]) => !world.solid(tx + dx, ty + dy))) { showMsg("CREUSE A PARTIR D'UNE SALLE", 1); return false; }
  openTile(tx, ty);
  stats.dug++;
  for (const [id, n] of D.drops) { giveOrDrop(id, n); toastItem(id, n); }
  pushUndo({ kind: 'dig', tx, ty, t, drops: D.drops });
  burst(tx + 0.5, ty + 0.5, 6, (t === T.EARTH_STONE ? ROCK_COLS : t === T.EARTH_IRON ? IRON_COLS : EARTH_COLS).concat(DUST_COLS), 14, { up: 40, speed: 1.8, life: 0.7, spread: 2 });
  sfx.dig(t !== T.EARTH);
  shake = Math.max(shake, 1.2);
  return true;
}
function buildFill(tx, ty) {
  if (!world.den || world.solid(tx, ty)) return false;
  const why = tileBlock(tx, ty);
  if (why) { showMsg(why, 0.8); return false; }
  if (!countItem('dirt')) { showMsg('IL FAUT DE LA TERRE', 1.2, 'CREUSE POUR EN AVOIR'); sfx.ui(); return false; }
  takeItem('dirt', 1);
  if (world.objAt(tx, ty)) world.setObj(tx, ty, O.NONE);
  world.setTile(tx, ty, T.EARTH, 2, stats.play);
  pushUndo({ kind: 'fill', tx, ty });
  burst(tx + 0.5, ty + 0.5, 16, EARTH_COLS, 10, { up: 20, speed: 1.2, life: 0.5, spread: 2 });
  sfx.dig(false);
  return true;
}
function buildTool(id, t) { if (t) return id === 'dig' ? buildDig(t.tx, t.ty) : buildFill(t.tx, t.ty); return false; }

function buildUndo() {
  const u = build.undo.pop();
  if (!u) { showMsg('RIEN A ANNULER', 1); sfx.ui(); return; }
  let ok = true;
  if (u.kind === 'place' && world.objAt(u.tx, u.ty) === u.o) {
    spill(clearBuilt(u.tx, u.ty).chest);
    if (!big(u.o)) world.setObj(u.tx, u.ty, u.prev);
    giveOrDrop(u.id, 1);
  } else if (u.kind === 'move' && world.objAt(u.to[0], u.to[1]) === u.o) {
    const c = clearBuilt(u.to[0], u.to[1]);
    if (buildBlock(u.o, u.from[0], u.from[1])) { setBuilt(u.to[0], u.to[1], u.o, c.k, c.chest); ok = false; } else {
      setBuilt(u.from[0], u.from[1], u.o, c.k, c.chest);
      if (big(u.o)) moveRealm(u.to, u.from);
      if (player.spawn && !player.spawn[2] && player.spawn[0] === u.to[0] && player.spawn[1] === u.to[1]) player.spawn = [...u.from];
    }
  } else if (u.kind === 'store' && countItem(u.id) && !buildBlock(u.o, u.tx, u.ty)) {
    takeItem(u.id, 1);
    setBuilt(u.tx, u.ty, u.o, u.k, null);
  } else if (u.kind === 'dig' && world.typeAt(u.tx, u.ty) === T.DEN && !tileBlock(u.tx, u.ty)) {
    world.setTile(u.tx, u.ty, u.t, 2, stats.play);
    for (const [id, n] of u.drops) takeItem(id, Math.min(n, countItem(id)));
  } else if (u.kind === 'fill' && world.typeAt(u.tx, u.ty) === T.EARTH) {
    openTile(u.tx, u.ty);
    giveOrDrop('dirt', 1);
  } else ok = false;
  if (!ok) showMsg('IMPOSSIBLE A ANNULER', 1);
  sfx.ui();
}

// TOURNER : ce qu'il tient, sinon la construction choisie (sur place), sinon la prochaine posée.
function buildRotate(dir = 1) {
  const B = build, turn = (o, k) => (o === O.FENCE_X ? [O.FENCE_Y, 0] : o === O.FENCE_Y ? [O.FENCE_X, 0] : [o, (k + dir + 4) & 3]);
  if (B.lift) { if (canRot(B.lift.o)) [B.lift.o, B.lift.k] = turn(B.lift.o, B.lift.k); }
  else if (B.pick) {
    const { tx, ty } = B.pick, o = world.objAt(tx, ty);
    if (!canRot(o)) return;
    const [no, nk] = turn(o, world.rotAt(tx, ty));
    if (no !== o) world.setObj(tx, ty, no);
    world.setRot(tx, ty, nk);
    placedFx.set(tx + ',' + ty, rt() - 0.12);
    burst(tx + 0.5, ty + 0.5, world.hAt(tx, ty) * 8, DUST_COLS, 5, { up: 15, speed: 1, life: 0.4, spread: 1 });
  } else B.rot = (B.rot + dir + 4) & 3;
  sfx.ui();
}
function buildCycle(k) {
  const ids = buildTabs()[build.tab].ids, i = ids.indexOf(build.sel);
  build.sel = ids[i < 0 ? (k > 0 ? 0 : ids.length - 1) : (i + k + ids.length) % ids.length];
  build.pick = null; build.pend = null;
  sfx.ui();
}
function buildTab(i) {
  const n = buildTabs().length;
  build.tab = ((i % n) + n) % n;
  if (!buildTabs()[build.tab].ids.includes(build.sel)) { build.sel = null; build.pend = null; }
  sfx.ui();
}
function buildCenter() { build.cx = player.x; build.cy = player.y; build.vx = build.vy = 0; sfx.ui(); }

// --- tiroir (bas de l'écran) : une rangée d'onglets, une rangée de cases
function buildLayout() {
  const tabs = buildTabs(), tab = Math.min(build.tab, tabs.length - 1), ids = tabs[tab].ids, gap = 2;
  const cw = Math.max(20, Math.min(30, Math.floor((VW - 18 - safe.l - safe.r - gap * (TRAY_N - 1)) / TRAY_N))), ch = cw + 4;
  const tabW = tabs.map((t) => textWidth(t.name) + 7), tw = tabW.reduce((a, b) => a + b + 2, -2);
  const w = Math.max(TRAY_N * cw + (TRAY_N - 1) * gap, tw), x = Math.round(VW / 2 - w / 2), y = VH - safe.b - ch - 5;
  let tx = x;
  const tabR = tabs.map((t, i) => { const r = { x: tx, y: y - 13, w: tabW[i], h: 11, i }; tx += tabW[i] + 2; return r; });
  return { ids, n: ids.length, cw, ch, gap, x, y, tabs: tabR, tray: { x: x - 5, y: y - 17, w: w + 10, h: ch + 22 } };
}
const inRect = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
function cardAt(L, x, y) {
  if (y < L.y || y >= L.y + L.ch) return -1;
  const i = Math.floor((x - L.x) / (L.cw + L.gap));
  return i >= 0 && i < L.n && x - L.x - i * (L.cw + L.gap) < L.cw ? i : -1;
}

// --- doigt et souris
function buildDown(x, y, right = false) {
  const B = build;
  if (B.ptr) return;
  for (const h of B.btns) if (inRect(h, x, y)) { h.fn(); return; }
  const L = buildLayout();
  const tb = L.tabs.find((r) => inRect(r, x, y));
  if (tb) { buildTab(tb.i); return; }
  const ci = cardAt(L, x, y);
  if (ci >= 0) { B.ptr = { kind: 'card', id: L.ids[ci], x0: x, y0: y, x, y, moved: false }; return; }
  if (inRect(L.tray, x, y)) return;
  const t = tileAtScreen(x, y);
  B.vx = B.vy = 0;
  if (!t) return;
  const bt = builtAtScreen(x, y);
  if (right) { if (bt && buildLift(bt.tx, bt.ty)) B.ptr = { kind: 'lift', x, y }; return; }
  if (isTool(B.sel) && !bt) { // un outil : on peint les parois au doigt
    const a = buildAim(x, y);
    B.ptr = { kind: 'paint', x, y, last: a && a.tx + ',' + a.ty };
    buildTool(B.sel, a);
    return;
  }
  B.ptr = { kind: 'map', x0: x, y0: y, x, y, t0: rt(), tm: rt(), built: bt, moved: false };
}
function buildMove(x, y) {
  const B = build, P = B.ptr;
  B.hover = { x, y };
  if (!P) return;
  const dx = x - P.x, dy = y - P.y;
  P.x = x; P.y = y;
  if (P.kind === 'paint') {
    // le trait est suivi pas à pas : un glissé rapide ne saute aucune tuile
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 4));
    for (let i = 1; i <= n; i++) {
      const a = buildAim(x - dx + dx * i / n, y - dy + dy * i / n), k = a && a.tx + ',' + a.ty;
      if (k && k !== P.last) { P.last = k; buildTool(B.sel, a); }
    }
    return;
  }
  if (!P.moved && P.kind !== 'lift' && Math.hypot(x - P.x0, y - P.y0) > 5) {
    P.moved = true;
    // on tire une construction du tiroir (un outil, lui, se choisit simplement)
    if (P.kind === 'card' && !isTool(P.id)) { P.kind = 'drag'; B.sel = P.id; B.pick = null; B.pend = null; sfx.grabReach(); }
  }
  if (P.kind === 'map' && P.moved) {
    panBy(dx, dy);
    const now = rt(), k = Math.max(0.008, now - P.tm);
    B.vx = B.vx * 0.4 + dx / k * 0.6; B.vy = B.vy * 0.4 + dy / k * 0.6;
    P.tm = now;
  }
}
function buildUp(x, y) {
  const B = build, P = B.ptr;
  if (!P) return;
  B.ptr = null;
  const L = buildLayout(), overTray = inRect(L.tray, x, y);
  if (P.kind === 'card') { B.sel = B.sel === P.id ? null : P.id; B.pick = null; B.pend = null; sfx.ui(); return; } // un toucher : choisir / reposer
  if (P.kind === 'drag') { const t = !overTray && buildAim(x, y); if (t) buildPlace(P.id, t.tx, t.ty); return; }
  if (P.kind === 'lift') { buildDrop(overTray ? null : buildAim(x, y), overTray); return; }
  if (P.kind === 'paint') return;
  if (P.moved) { if (rt() - P.tm > 0.08) B.vx = B.vy = 0; return; } // fin d'un glissé : l'élan continue
  // toucher l'aperçu en attente : on le pose
  if (B.pend && B.pendBox && inRect(B.pendBox, x, y)) { buildConfirm(); return; }
  const t = tileAtScreen(x, y);
  if (!t) return;
  const bt = builtAtScreen(x, y);
  // toucher une construction posée la choisit (ses flèches la tournent, la maintenir la déplace)
  if (bt) {
    B.pick = B.pick && B.pick.tx === bt.tx && B.pick.ty === bt.ty ? null : bt;
    B.pend = null;
    sfx.ui();
    return;
  }
  B.pick = null;
  if (!B.sel || isTool(B.sel)) return;
  // au doigt, ce qui s'oriente passe d'abord par un aperçu avec ses flèches et POSER
  if (inputMode === 'touch' && canRot(ITEMS[B.sel].obj)) {
    if (B.pend && B.pend.tx === t.tx && B.pend.ty === t.ty) buildConfirm();
    else { B.pend = { tx: t.tx, ty: t.ty }; sfx.ui(); }
    return;
  }
  buildPlace(B.sel, t.tx, t.ty);
}
function buildConfirm() {
  const B = build;
  if (B.pend && B.sel && buildPlace(B.sel, B.pend.tx, B.pend.ty)) B.pend = null;
}
// Deux doigts : la caméra glisse, quoi que fasse le premier doigt.
function buildPan2(touches) {
  const B = build;
  let cx = 0, cy = 0;
  for (const [x, y] of touches.values()) { cx += x; cy += y; }
  cx /= touches.size; cy /= touches.size;
  if (B.pan2) panBy(cx - B.pan2[0], cy - B.pan2[1]);
  else if (B.ptr) { if (B.ptr.kind === 'lift') buildDrop(null, false); B.ptr = null; }
  B.pan2 = [cx, cy];
}

function buildKey(e) {
  const c = e.code;
  if (c === 'Escape' || c === 'KeyB' || c === 'Enter') { closeBuild(); return; }
  if (c === 'Tab') { buildTab(build.tab + (e.shiftKey ? -1 : 1)); return; }
  if (/^Digit[1-9]$/.test(c)) {
    const id = buildTabs()[build.tab].ids[+c[5] - 1];
    if (id) { build.sel = build.sel === id ? null : id; build.pick = null; sfx.ui(); }
    return;
  }
  if (c === 'KeyR') buildRotate();
  if (c === 'KeyU' || c === 'Backspace' || (c === 'KeyZ' && (e.ctrlKey || e.metaKey))) { keys.delete(c); buildUndo(); }
  if (c === 'Space' || c === 'KeyC') buildCenter();
  if (c === 'KeyM') toggleMute();
  if (c === 'KeyF') toggleFullscreen();
}

function updateBuild(dt) {
  const B = build;
  time += dt; B.t += dt;
  advanceSway(dt);
  if (msg && (msg.t -= dt) <= 0) msg = null;
  if (toast && (toast.t -= dt) <= 0) toast = null;
  shake = Math.max(0, shake - dt * 20);
  realmFade = Math.max(0, realmFade - dt * 2.2);
  if (player.anim === 'idle') player.t += dt * ANIMS.idle.fps; // il respire en attendant
  updateParticles(dt);
  if (!realm) updateFlyers(dt);
  updateMusic(dt, { night: darkness(), danger: 0, rain: realm ? 0 : weather.rain });
  const P = B.ptr;
  // appui long sur une construction : il la soulève
  if (P && P.kind === 'map' && !P.moved && !P.noLift && rt() - P.t0 > 0.35 && P.built) {
    if (buildLift(P.built.tx, P.built.ty)) P.kind = 'lift'; else P.noLift = true;
  }
  // ce qu'on promène au bord de l'écran fait défiler le monde
  if (P && (P.kind === 'drag' || P.kind === 'lift' || P.kind === 'paint')) {
    const m = 22, L = buildLayout();
    const ex = P.x < m ? 1 : P.x > VW - m ? -1 : 0, ey = P.y < 18 + safe.t + m ? 1 : P.y > L.tray.y - 4 && P.y < L.tray.y + 6 ? -1 : 0;
    if (ex || ey) panBy(ex * 110 * dt, ey * 110 * dt);
  }
  // élan après un glissé
  if (!P && !B.pan2 && Math.hypot(B.vx, B.vy) > 4) { panBy(B.vx * dt, B.vy * dt); const k = Math.exp(-6 * dt); B.vx *= k; B.vy *= k; }
  const kb = keyboardVector();
  if (kb) panBy(-kb[0] * 170 * dt, -kb[1] * 170 * dt);
  // manette : le stick promène le viseur (le centre de l'écran)
  pollPad();
  if (!pad.connected) return;
  if (pad.any) { setMode('pad'); unlockAudio(); }
  if (pad.sx || pad.sy) panBy(-pad.sx * 170 * dt, -pad.sy * 170 * dt);
  const Pp = pad.pressed || [];
  if (Pp[1] || Pp[9] || Pp[11]) { closeBuild(); return; }
  if (Pp[4] || Pp[14]) buildCycle(-1);
  if (Pp[5] || Pp[15]) buildCycle(1);
  if (Pp[12]) buildTab(B.tab + 1);
  if (Pp[3]) buildRotate();
  if (Pp[8]) toggleMute();
  const t = centerTile();
  if (Pp[13]) { if (B.lift) buildDrop(null, true); else buildUndo(); }
  if (Pp[0]) {
    if (B.lift) buildDrop(t, false);
    else if (isTool(B.sel)) buildTool(B.sel, t);
    else if (B.sel && t) buildPlace(B.sel, t.tx, t.ty);
  }
  // A maintenu avec un outil : il continue de creuser en promenant le viseur
  if (pad.a && isTool(B.sel) && t) {
    const k = t.tx + ',' + t.ty;
    if (k !== B.padLast) { B.padLast = k; buildTool(B.sel, t); }
  } else B.padLast = null;
  if (Pp[2]) {
    if (B.lift) buildDrop(t, false);
    else { const bt = t && (world.anchorOf(t.tx, t.ty) || [t.tx, t.ty]); if (!bt || !buildLift(bt[0], bt[1])) sfx.ui(); }
  }
}

// --- dessin
// Le losange d'une tuile (ligne r : de 14-2r à 17+2r), plein ou en pointillés.
function tileOutline(sx, top, col, dashed) {
  ctx.fillStyle = col;
  for (let r = 0; r < 8; r++) {
    if (dashed && (r & 1)) continue;
    ctx.fillRect(sx - 2 - 2 * r, top + r, 2, 1); ctx.fillRect(sx + 2 * r, top + r, 2, 1);
    ctx.fillRect(sx - 2 - 2 * r, top + 15 - r, 2, 1); ctx.fillRect(sx + 2 * r, top + 15 - r, 2, 1);
  }
}
const outlineAt = (tx, ty, col, dashed) => tileOutline(build.ox + isoX(tx, ty), build.oy + isoY(tx, ty) - world.hAt(tx, ty) * 8, col, dashed);
// La grille des tuiles libres à sa portée ; le bord de la portée en pointillés dorés.
// Avec un outil, les parois qu'on peut creuser (celles qui touchent une salle) sont marquées.
function buildCell(x, y, sx, top) {
  const d = Math.hypot(x + 0.5 - player.x, y + 0.5 - player.y), R = buildR();
  if (d > R) return;
  if (world.solid && world.solid(x, y)) {
    if (build.sel === 'dig' && DIG[world.typeAt(x, y)] && NEIGH4.some(([dx, dy]) => !world.solid(x + dx, y + dy))) {
      ctx.globalAlpha = 0.85;
      tileOutline(sx, top, '#ffb36a', true);
      ctx.globalAlpha = 1;
    }
    return;
  }
  const info = OBJ_INFO[world.objAt(x, y)];
  if (info && !(info.small && !info.part)) return;
  const edge = d > R - 1;
  ctx.globalAlpha = edge ? 0.55 : 0.22;
  tileOutline(sx, top, edge ? BUI.goldHi : '#ffffff', true);
  ctx.globalAlpha = 1;
}

// Ce qui va être posé (ou ce qu'on déplace) sur la tuile visée : vert si c'est possible, rouge sinon.
// Petit bouton posé dans le monde (flèches pour tourner, POSER) : indigo en relief, ou doré.
function worldButton(x, y, w, gold, draw0, fn) {
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = BUI.ink; ctx.fillRect(x, y, w, 12);
  ctx.fillStyle = gold ? BUI.gold : BUI.base; ctx.fillRect(x + 1, y + 1, w - 2, 10);
  ctx.fillStyle = gold ? BUI.goldHi : BUI.hi; ctx.fillRect(x + 1, y + 1, w - 2, 1);
  ctx.fillStyle = gold ? BUI.goldLo : BUI.ink; ctx.fillRect(x + 1, y + 10, w - 2, 1);
  draw0(x, y);
  build.btns.push({ x: x - 4, y: y - 4, w: w + 8, h: 20, fn }); // plus large que le dessin, pour le doigt
}
function arrowGlyph(x, y, dir, col) {
  ctx.fillStyle = col;
  for (let i = 0; i < 4; i++) ctx.fillRect(dir < 0 ? x + 2 + i : x + 8 - i, y + 6 - i, 1, 1 + 2 * i); // la pointe
  ctx.fillRect(dir < 0 ? x + 6 : x + 3, y + 5, 2, 3); // la queue
}
// Les flèches de part et d'autre d'une construction (ou de son aperçu), et POSER dessous.
function rotControls(o, k, tx, ty, ok) {
  const img = spriteOf(o, k), [ax, ay] = anchorScreen(o, tx, ty);
  const gx = ax - img.ox, gy = ay - img.oy, my = gy + Math.max(0, img.h / 2 - 6);
  const left = Math.min(gx - 14, ax - 26), right = Math.max(gx + img.w + 3, ax + 15);
  worldButton(left, my, 11, false, (x, y) => arrowGlyph(x, y, -1, '#ffffff'), () => buildRotate(-1));
  worldButton(right, my, 11, false, (x, y) => arrowGlyph(x, y, 1, '#ffffff'), () => buildRotate(1));
  if (ok !== undefined) {
    const w = textWidth('POSER') + 9;
    worldButton(ax - w / 2, ay + 9, w, ok, (x, y) => drawText(ctx, 'POSER', x + 5, y + 3, ok ? BUI.ink : BUI.dim, null), buildConfirm);
  }
}

function drawBuildGhost(ox, oy) {
  const B = build, P = B.ptr, L = buildLayout();
  B.btns.length = 0;
  B.pendBox = null;
  // il est là (caché pendant qu'on bâtit) : sa tuile en pointillés rouges
  ctx.globalAlpha = 0.7;
  outlineAt(Math.floor(player.x), Math.floor(player.y), BUI.redHi, true);
  ctx.globalAlpha = 1;
  // la construction choisie sur place : son contour doré qui pulse, ses flèches
  if (B.pick) {
    const o = world.objAt(B.pick.tx, B.pick.ty);
    if (!OBJ_INFO[o] || !OBJ_INFO[o].built) B.pick = null;
    else {
      ctx.globalAlpha = 0.6 + Math.sin(rt() * 7) * 0.35;
      for (const [x, y] of footprint(o, B.pick.tx, B.pick.ty)) outlineAt(x, y, BUI.goldHi, false);
      ctx.globalAlpha = 1;
      if (canRot(o) && !B.lift) rotControls(o, world.rotAt(B.pick.tx, B.pick.ty), B.pick.tx, B.pick.ty);
    }
  }
  // l'aperçu en attente (au doigt) : posé en transparence, flèches pour l'orienter, POSER
  if (B.pend && B.sel && !isTool(B.sel) && !(P && (P.kind === 'drag' || P.kind === 'lift'))) {
    const [o, k] = objFor(B.sel), ok = !buildBlock(o, B.pend.tx, B.pend.ty) && (buildStock(B.sel).n || buildStock(B.sel).craft);
    ctx.globalAlpha = 0.85;
    for (const [x, y] of footprint(o, B.pend.tx, B.pend.ty)) outlineAt(x, y, ok ? '#7ee08a' : '#ff5a5e', false);
    const img = spriteOf(o, k), [ax, ay] = anchorScreen(o, B.pend.tx, B.pend.ty);
    ctx.globalAlpha = ok ? 0.8 : 0.45;
    draw(img, ax - img.ox, ay - img.oy);
    ctx.globalAlpha = 1;
    B.pendBox = { x: ax - img.ox, y: ay - img.oy, w: img.w, h: img.h };
    rotControls(o, k, B.pend.tx, B.pend.ty, !!ok);
    return;
  }
  let t = null, o = 0, k = 0, id = null;
  if (P && (P.kind === 'drag' || P.kind === 'lift' || P.kind === 'paint')) {
    if (inRect(L.tray, P.x, P.y)) return; // au-dessus du tiroir : on range / on annule
    t = buildAim(P.x, P.y);
    if (P.kind === 'drag') { id = P.id; [o, k] = objFor(id); } else if (P.kind === 'lift') ({ o, k } = B.lift); else id = B.sel;
  } else if (inputMode === 'pad') {
    t = centerTile();
    if (B.lift) ({ o, k } = B.lift); else if (B.sel) { id = B.sel; if (!isTool(id)) [o, k] = objFor(id); }
  } else if (inputMode === 'keys' && B.hover && B.sel && !inRect(L.tray, B.hover.x, B.hover.y) && B.hover.y > 18 + safe.t) {
    t = tileAtScreen(B.hover.x, B.hover.y);
    id = B.sel;
    if (!isTool(id)) [o, k] = objFor(id);
  }
  if (!t) return;
  if (!o) { // le viseur (manette, outil)
    ctx.globalAlpha = 0.85;
    outlineAt(t.tx, t.ty, id === 'dig' ? BUI.brain : id === 'fill' ? '#8e6440' : BUI.goldHi, false);
    ctx.globalAlpha = 1;
    return;
  }
  const ok = !buildBlock(o, t.tx, t.ty) && (!id || buildStock(id).n || buildStock(id).craft);
  ctx.globalAlpha = 0.85;
  for (const [x, y] of footprint(o, t.tx, t.ty)) outlineAt(x, y, ok ? '#7ee08a' : '#ff5a5e', false);
  const img = spriteOf(o, k), [ax, ay] = anchorScreen(o, t.tx, t.ty), bob = Math.round(Math.sin(rt() * 6) * 1.5) - 3;
  ctx.globalAlpha = ok ? 0.75 : 0.45;
  draw(img, ax - img.ox, ay + bob - img.oy);
  ctx.globalAlpha = 1;
}

// Petit bouton du bandeau : indigo en relief, ou doré (le bec) pour sortir.
function buiButton(x, y, label, on, gold, fn) {
  const w = textWidth(label) + 9, h = 11;
  ctx.fillStyle = BUI.ink; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = gold ? BUI.gold : on ? BUI.base : BUI.dark; ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillStyle = gold ? BUI.goldHi : on ? BUI.hi : BUI.base; ctx.fillRect(x + 1, y + 1, w - 2, 1);
  ctx.fillStyle = gold ? BUI.goldLo : BUI.ink; ctx.fillRect(x + 1, y + h - 2, w - 2, 1);
  drawText(ctx, label, x + 5, y + 3, gold ? BUI.ink : on ? '#ffffff' : BUI.dim, null);
  build.btns.push({ x: x - 1, y: y - 3, w: w + 2, h: h + 6, fn: on ? fn : () => sfx.ui() });
  return w;
}
// Trois griffures rouges, comme ses rayures.
function drawClaws(x, y) {
  for (let k = 0; k < 3; k++) for (let i = 0; i < 9; i++) {
    const px = x + k * 4 + Math.floor((8 - i) / 2);
    ctx.fillStyle = i < 2 || i > 6 ? BUI.red : BUI.redHi;
    ctx.fillRect(px, y + i, 2, 1);
  }
}

const BUILD_HINTS = {
  touch: 'CHOISIS UN OBJET PUIS TOUCHE UNE TUILE (OU GLISSE-LE) - LES FLECHES L\'ORIENTENT - MAINTIENS UNE CONSTRUCTION POUR LA DEPLACER',
  keys: 'ZQSD: BOUGER  CLIC: POSER  CLIC DROIT: DEPLACER  R: TOURNER  TAB: ONGLET  U: ANNULER',
  pad: 'STICK: VISER  A: POSER  X: DEPLACER  L1/R1: OBJET  HAUT: ONGLET  Y: TOURNER  B: SORTIR',
};
const DIG_HINT = { touch: 'GLISSE SUR LES PAROIS - 2 DOIGTS POUR BOUGER', keys: 'CLIQUE-GLISSE SUR LES PAROIS', pad: 'A MAINTENU SUR LES PAROIS' };

function drawBuildUI() {
  const B = build, P = B.ptr, y0 = safe.t;
  // bandeau du haut
  ctx.fillStyle = BUI.ink; ctx.fillRect(0, 0, VW, y0 + 18);
  ctx.fillStyle = BUI.dark; ctx.fillRect(0, 0, VW, y0 + 15);
  ctx.fillStyle = BUI.red; ctx.fillRect(0, y0 + 15, VW, 2);
  ctx.fillStyle = BUI.redHi; ctx.fillRect(0, y0 + 15, VW, 1);
  const x0 = 6 + safe.l;
  drawClaws(x0, y0 + 3);
  drawText(ctx, 'BATIR', x0 + 18, y0 + 5, BUI.goldHi, BUI.goldLo);
  let bx = VW - 4 - safe.r;
  const right = (label, on, gold, fn) => { const w = textWidth(label) + 9; bx -= w; buiButton(bx, y0 + 2, label, on, gold, fn); bx -= 3; };
  right('OK', true, true, closeBuild);
  right('CENTRER', true, false, buildCenter);
  const rotOn = B.lift ? canRot(B.lift.o) : B.pick ? canRot(world.objAt(B.pick.tx, B.pick.ty)) : B.sel && !isTool(B.sel) && canRot(ITEMS[B.sel].obj);
  right('TOURNER', rotOn, false, buildRotate);
  right('ANNULER', B.undo.length > 0, false, buildUndo);
  // ses matériaux, dans la place qui reste entre le titre et les boutons
  let mx = x0 + 44;
  for (const id of ['wood', 'stone', 'straw', 'iron', 'dirt']) {
    const n = countItem(id), s = String(n), w = 14 + textWidth(s) + 5;
    if (!n || mx + w > bx) continue;
    ctx.drawImage(icons[id], mx, y0 + 2);
    drawText(ctx, s, mx + 13, y0 + 6, '#ffffff', BUI.ink);
    mx += w;
  }
  // l'aide, quelques secondes
  if (B.t < 7) {
    ctx.globalAlpha = Math.min(1, (7 - B.t) / 1.5);
    wrap(BUILD_HINTS[inputMode], VW - 12).forEach((l, i) => textC(l, VW / 2, y0 + 22 + i * 8, '#ffffff', '#000000'));
    ctx.globalAlpha = 1;
  }

  // tiroir : onglets puis cases
  const L = buildLayout(), T0 = L.tray, tabs = buildTabs();
  const hot = P && P.kind === 'lift' && inRect(T0, P.x, P.y);
  ctx.fillStyle = BUI.ink; ctx.fillRect(T0.x - 1, T0.y, T0.w + 2, T0.h + 6);
  ctx.fillStyle = hot ? BUI.base : BUI.dark; ctx.fillRect(T0.x, T0.y + 1, T0.w, T0.h + 6);
  ctx.fillStyle = BUI.hi; ctx.fillRect(T0.x, T0.y + 1, T0.w, 1);
  ctx.fillStyle = BUI.red; ctx.fillRect(T0.x, T0.y + 2, T0.w, 2);
  ctx.fillStyle = BUI.redHi; ctx.fillRect(T0.x, T0.y + 2, T0.w, 1);
  // le bec doré en V au milieu
  const cx = Math.round(VW / 2);
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = BUI.goldLo; ctx.fillRect(cx - 6 + i, T0.y + 1 + i, 12 - 2 * i, 1);
    ctx.fillStyle = i < 2 ? BUI.goldHi : BUI.gold; ctx.fillRect(cx - 5 + i, T0.y + 1 + i, 10 - 2 * i, 1);
  }
  if (B.lift) { // il tient une construction : tout le tiroir devient « RANGER ICI »
    const l = 'RANGER ICI', blink = hot || Math.floor(rt() * 3) % 2;
    drawText(ctx, l, Math.round(cx - textWidth(l) / 2), T0.y + 8, blink ? BUI.goldHi : BUI.gold, BUI.ink);
  } else L.tabs.forEach((r) => {
    const on = r.i === Math.min(B.tab, tabs.length - 1);
    ctx.fillStyle = on ? BUI.goldLo : BUI.ink; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = on ? BUI.base : BUI.dark; ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, r.h - 1);
    if (on) { ctx.fillStyle = BUI.gold; ctx.fillRect(r.x + 1, r.y + 1, r.w - 2, 1); }
    drawText(ctx, tabs[r.i].name, r.x + 4, r.y + 3, on ? BUI.goldHi : BUI.dim, null);
  });
  for (let i = 0; i < L.n; i++) {
    const id = L.ids[i], st = buildStock(id), x = L.x + i * (L.cw + L.gap);
    const on = B.sel === id || (P && P.kind === 'drag' && P.id === id), y = L.y - (on ? 2 : 0);
    const outside = !st.tool && realm && big(ITEMS[id].obj), have = (st.tool || st.n > 0 || st.craft) && !outside;
    ctx.fillStyle = on ? BUI.goldLo : BUI.ink; ctx.fillRect(x, y, L.cw, L.ch);
    ctx.fillStyle = on ? BUI.gold : have ? BUI.hi : BUI.dark; ctx.fillRect(x + 1, y + 1, L.cw - 2, L.ch - 2);
    ctx.fillStyle = have || on ? BUI.base : BUI.ink; ctx.fillRect(x + 2, y + 2, L.cw - 4, L.ch - 4);
    if (on) { ctx.fillStyle = BUI.goldHi; ctx.fillRect(x + 1, y + 1, L.cw - 2, 1); }
    const k = L.cw >= 26 ? 2 : 1, s = 12 * k;
    ctx.globalAlpha = have ? 1 : 0.35;
    ctx.drawImage(icons[id], x + Math.round((L.cw - s) / 2), y + 2 + Math.round((L.ch - 8 - s) / 2), s, s);
    ctx.globalAlpha = 1;
    if (st.n) { const c = String(st.n); drawText(ctx, c, x + L.cw - 2 - textWidth(c), y + L.ch - 7, '#ffffff', BUI.ink); }
    else if (st.craft && !outside) { ctx.fillStyle = BUI.brain; ctx.fillRect(x + L.cw - 6, y + L.ch - 5, 3, 1); ctx.fillRect(x + L.cw - 5, y + L.ch - 6, 1, 3); } // « + » : fabriqué à la pose
    if (inputMode === 'keys') drawText(ctx, String(i + 1), x + 3, y + 3, BUI.dim, null);
  }
  // la ligne d'info au-dessus du tiroir
  let info = null, col = '#ffffff';
  if (B.lift) { info = 'DEPLACER : ' + ITEMS[itemOfObj(B.lift.o)].name; col = BUI.goldHi; }
  else if (B.pick) {
    const o = world.objAt(B.pick.tx, B.pick.ty), id = itemOfObj(o);
    info = (id ? ITEMS[id].name : '') + (canRot(o) ? ' - FLECHES : TOURNER, MAINTIENS : DEPLACER' : ' - MAINTIENS POUR DEPLACER'); col = BUI.goldHi;
  } else {
    const id = P && P.kind === 'drag' ? P.id : B.sel;
    if (id === 'dig') { info = 'CREUSER - ' + DIG_HINT[inputMode]; col = '#ffd0a8'; }
    else if (id === 'fill') { info = 'REMBLAYER - ' + countItem('dirt') + ' TERRE'; col = countItem('dirt') ? '#ffffff' : '#ff8a8e'; }
    else if (id) {
      const st = buildStock(id), r = recipeOf(id);
      info = nameOf(id) + ' - ' + (realm && big(ITEMS[id].obj) ? 'SEULEMENT DEHORS' : st.n ? st.n + ' EN STOCK' : st.craft ? 'FABRIQUE A LA POSE : ' + costText(r) : 'IL FAUT ' + costText(r));
      col = realm && big(ITEMS[id].obj) ? '#ff8a8e' : st.n ? '#ffffff' : st.craft ? '#ffd0a8' : '#ff8a8e';
    }
  }
  if (toast) { info = '+' + toast.n + ' ' + ITEMS[toast.id].name; col = '#7ee08a'; ctx.globalAlpha = Math.min(1, toast.t); }
  if (info) {
    const lines = wrap(info, VW - 16), iy = T0.y - 2 - lines.length * 8;
    lines.forEach((l, i) => {
      const w = textWidth(l) + 8, ix = Math.round(VW / 2 - w / 2);
      ctx.fillStyle = 'rgba(9,10,32,0.8)'; ctx.fillRect(ix, iy + i * 8, w, 9);
      drawText(ctx, l, ix + 4, iy + i * 8 + 2, col, null);
    });
    ctx.globalAlpha = 1;
  }
  if (msg) {
    ctx.globalAlpha = Math.min(1, msg.t / 0.6);
    textC(msg.text, VW / 2, Math.round(VH * 0.3), '#ffe28a');
    if (msg.sub) textC(msg.sub, VW / 2, Math.round(VH * 0.3) + 8, '#ffffff');
    ctx.globalAlpha = 1;
  }
}

// Icône carte (en haut à droite) : le sac ouvert sur la carte.
const mapBtn = { x: 0, y: 0, r: 7 };
function drawMapButton() {
  mapBtn.x = VW - (world.den ? 112 : 92) - safe.r; // prend la place du marteau hors de la tanière
  mapBtn.y = 11 + safe.t;
  const x = mapBtn.x - 5, y = mapBtn.y - 4;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x - 3, y - 3, 17, 14);
  // un parchemin plié, une croix rouge
  ctx.fillStyle = '#e8d8b0'; ctx.fillRect(x, y, 11, 8);
  ctx.fillStyle = '#c4ac78'; ctx.fillRect(x + 3, y, 1, 8); ctx.fillRect(x + 7, y, 1, 8);
  ctx.fillStyle = '#4a923d'; ctx.fillRect(x + 1, y + 1, 2, 2); ctx.fillRect(x + 8, y + 5, 2, 2);
  ctx.fillStyle = '#d22838'; ctx.fillRect(x + 5, y + 3, 1, 1); ctx.fillRect(x + 4, y + 2, 1, 1); ctx.fillRect(x + 6, y + 4, 1, 1); ctx.fillRect(x + 6, y + 2, 1, 1); ctx.fillRect(x + 4, y + 4, 1, 1);
}

// Icône marteau (en haut à droite) : passe en mode BÂTIR.
const buildBtn = { x: 0, y: 0, r: 7 };
function drawBuildButton() {
  if (!world.den) { buildBtn.x = -99; return; } // le marteau n'existe que dans sa tanière
  buildBtn.x = VW - 92 - safe.r;
  buildBtn.y = 11 + safe.t;
  const x = buildBtn.x - 5, y = buildBtn.y - 4;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x - 3, y - 3, 17, 14);
  // manche de bois en biais, tête de fer
  ctx.fillStyle = '#a87a52';
  for (let i = 0; i < 6; i++) ctx.fillRect(x + 2 + i, y + 7 - i, 2, 1);
  ctx.fillStyle = '#5e3d22'; ctx.fillRect(x + 1, y + 8, 2, 1);
  ctx.fillStyle = '#9aa2b2'; ctx.fillRect(x + 5, y, 6, 3);
  ctx.fillStyle = '#dfe5ee'; ctx.fillRect(x + 5, y, 6, 1);
  ctx.fillStyle = '#5a606e'; ctx.fillRect(x + 10, y + 1, 1, 2);
}

// ---------------------------------------------------------------- dedans : tanière et intérieurs
// Entrer dans une maison ou descendre dans la tanière remplace `world` par un petit monde à part
// (`Den`, `Room`) : tout le moteur (rendu, collisions, BÂTIR) marche pareil. Ce qui vit dehors
// (habitants, objets au sol, feux…) est mis de côté et retrouvé en sortant. Une seule tanière par
// monde (toutes ses entrées y mènent) ; un intérieur par maison, rangé sous la clé "room:x,y".
let surface = world; // le monde du dehors
let realm = null; // { key, kind, out: [x, y] (devant la porte), stash } tant qu'il est dedans
const realmWorlds = new Map(); // clé -> monde chargé
let realmData = new Map(); // clé -> ce qui a changé dedans (sauvé avec le monde)
let realmFade = 0; // fondu au noir au passage d'une porte
let doorLock = false; // juste ressorti : il ne rentre pas tant qu'il pousse encore vers la porte
const rotUV = (u, v, k) => (k === 0 ? [u, v] : k === 1 ? [-v, u] : k === 2 ? [-u, -v] : [v, -u]);
const hashKey = (k) => { let h = 7; for (const c of k) h = (h * 31 + c.charCodeAt(0)) | 0; return h >>> 0; };

function realmOf(key, kind) {
  let w = realmWorlds.get(key);
  if (w) return w;
  w = kind === 'den' ? new Den(surface.seed) : new Room((surface.seed ^ hashKey(key)) >>> 0, kind);
  const d = realmData.get(key);
  if (d) {
    w.mods = new Map(d.mods || []); w.terr = new Map(d.terr || []); w.wear = new Map(d.wear || []);
    w.chests = new Map(d.chests || []); w.rots = new Map(d.rots || []); w.racks = new Map(d.racks || []);
    if (w.found) w.found = new Set(d.found || []);
    w.captives = (d.captives || []).map((c) => makeCaptive(c.type, c.x, c.y, c.cage));
    // une sortie cassée par une ancienne version : elle revient
    const ex = w.exitKey;
    if (ex) { w.mods.delete(ex); w.terr.delete(ex); }
  }
  realmWorlds.set(key, w);
  return w;
}
function realmSave() {
  for (const [k, w] of realmWorlds) {
    const caps = (w === world ? npcs : w.captives).filter((n) => n.captive && alive(n) && !n.held).map((n) => ({ type: n.type, x: n.x, y: n.y, cage: n.caged ? n.cage : null }));
    realmData.set(k, { kind: w.kind || 'den', mods: [...w.mods], terr: [...w.terr], wear: [...w.wear], chests: [...w.chests], rots: [...w.rots], racks: [...w.racks],
      found: w.found ? [...w.found] : undefined, captives: caps });
  }
  return [...realmData];
}
// Une maison déplacée au mode BÂTIR emporte son intérieur.
function moveRealm(from, to) {
  const a = 'room:' + from[0] + ',' + from[1], b = 'room:' + to[0] + ',' + to[1];
  if (realmWorlds.has(a)) { realmWorlds.set(b, realmWorlds.get(a)); realmWorlds.delete(a); }
  if (realmData.has(a)) { realmData.set(b, realmData.get(a)); realmData.delete(a); }
}

// Le côté de la porte d'un bâtiment (vecteur unitaire dans le monde) : +y pour une maison de village,
// face à la caméra pour ses abris, tourné avec eux.
function doorOf(tx, ty, info) {
  const base = info.built ? [Math.SQRT1_2, Math.SQRT1_2] : [0, 1];
  return rotUV(base[0], base[1], info.built ? world.rotAt(tx, ty) : 0);
}

// ---------------------------------------------------------------- expéditions
// Ses méfaits font monter son infamie (`player.infamy` : villageois, chevaliers, héros tués ou
// enlevés, maisons rasées), qui retombe doucement. Assez haut, le royaume envoie une expédition :
// des chevaliers (et des héros si l'infamie est grande) qui le traquent. S'il a un abri, ils
// marchent dessus et l'assiègent ; s'il n'est pas là (ou caché dedans), ils libèrent ses
// prisonniers. Tous tués : l'expédition est repoussée.
const EXP_AT = 12; // infamie qui déclenche une expédition
let expedition = null; // { members, base: [ax, ay, o] | null, siegeT, freed, t }
let expCd = 90; // délai avant la prochaine
const expAlive = () => (expedition ? expedition.members.filter((n) => alive(n) && npcs.includes(n) || (realm && realm.stash.npcs.includes(n) && alive(n))) : []);
// son abri le plus proche (repaire ou entrée de tanière, dehors)
function nearestBase() {
  let best = null, bd = 70;
  for (const [k, o] of surface.mods) {
    if (o !== O.HUT && o !== O.LAIR) continue;
    const [x, y] = k.split(',').map(Number), d = Math.hypot(x - (realm ? realm.out[0] : player.x), y - (realm ? realm.out[1] : player.y));
    if (d < bd && OBJ_INFO[surface.objAt(x, y)].state < 2) { bd = d; best = [x, y, o]; }
  }
  return best;
}
const realmKeyOf = (base) => (base[2] === O.LAIR ? 'den' : 'room:' + base[0] + ',' + base[1]);
function launchExpedition() {
  const base = nearestBase(), fx = player.x, fy = player.y;
  const knights = Math.min(8, 3 + Math.floor((player.infamy - EXP_AT) / 8)), heroes = player.infamy > 40 ? 2 : player.infamy > 22 ? 1 : 0;
  const ang = Math.random() * Math.PI * 2, members = [];
  const types = Array(knights).fill('knight').concat(Array(heroes).fill(0).map(() => HEROES[(Math.random() * HEROES.length) | 0]));
  for (const type of types) {
    for (let k = 0; k < 30; k++) {
      const a = ang + (Math.random() - 0.5) * 0.8, r = 18 + Math.random() * 5, x = fx + Math.cos(a) * r, y = fy + Math.sin(a) * r;
      if (!freeSpot(x, y)) continue;
      const n = spawnNpc(type, x, y, { id: 'exp' }, null);
      n.exp = true; n.state = 'chase'; n.fade = 0;
      members.push(n);
      break;
    }
  }
  if (!members.length) return;
  expedition = { members, base, siegeT: 0, freed: false, t: 0 };
  showMsg('UNE EXPEDITION TE TRAQUE !', 4.5, members.length + ' GUERRIERS' + (base ? ' MARCHENT SUR TON ABRI' : ' SONT SUR TA PISTE'));
  sfx.bell(); sfx.roar(0.4);
}
// Ils libèrent les prisonniers de l'abri assiégé (il n'était pas là pour les défendre).
function freeCaptives(base) {
  const key = realmKeyOf(base);
  let n = 0;
  if (realm && realm.key === key) { for (let i = npcs.length - 1; i >= 0; i--) if (npcs[i].captive && alive(npcs[i])) { npcs.splice(i, 1); n++; } }
  const w = realmWorlds.get(key);
  if (w) { n += w.captives.length; w.captives = []; }
  const d = realmData.get(key);
  if (d && d.captives) { if (!w) n += d.captives.length; d.captives = []; }
  if (n) showMsg("L'EXPEDITION A LIBERE TES PRISONNIERS", 4, n + ' ONT FUI');
}
function updateExpedition(dt) {
  player.infamy = Math.max(0, player.infamy - dt * 0.015);
  if (!expedition) {
    if ((expCd -= dt) <= 0 && player.infamy >= EXP_AT && !realm && !player.dead && mode === 'play') launchExpedition();
    return;
  }
  const E = expedition, left = expAlive();
  E.t += dt;
  if (!left.length) {
    // tous tombés : repoussée
    if (E.t > 3) { stats.expWon++; showMsg('EXPEDITION REPOUSSEE !', 4, 'LE ROYAUME TREMBLE'); sfx.roar(1); player.infamy *= 0.5; }
    expedition = null; expCd = 240;
    return;
  }
  // caché dans son abri pendant qu'ils l'assiègent : ils cognent sur l'entrée
  if (realm && E.base && E.atBase) {
    E.siegeT += dt;
    if (E.siegeT > 8) {
      E.siegeT = 0;
      const w = world;
      world = surface;
      damageBuilding(E.base[0], E.base[1], 2, true);
      const st = OBJ_INFO[surface.objAt(E.base[0], E.base[1])].state;
      world = w;
      shake = Math.max(shake, 3); sfx.hitBuilding('stone');
      showMsg("ILS ATTAQUENT L'ENTREE !", 2, st >= 2 ? 'ILS ENTRENT !' : 'SORS LES REPOUSSER');
      if (st >= 2 && !E.freed) { E.freed = true; freeCaptives(E.base); }
    }
  }
  // trop loin trop longtemps : ils abandonnent
  if (!realm && left.every((n) => Math.hypot(n.x - player.x, n.y - player.y) > 60)) { for (const n of left) npcs.splice(npcs.indexOf(n), 1); expedition = null; expCd = 120; }
}
// L'IA d'un membre d'expédition, avant celle d'un chevalier ordinaire : rejoindre l'abri, l'assiéger.
function updateExpMember(n, dt, d) {
  const E = expedition;
  if (!E || !E.base || d < 12) return null; // il voit le monstre : combat normal
  const [bx, by] = E.base, db = Math.hypot(bx - n.x, by - n.y);
  if (db > 2.3) { steer(n, bx, by, 2.4, dt); return 'run'; }
  E.atBase = true;
  n.dir = faceDir(bx - n.x, by - n.y);
  // ils frappent l'abri ; personne pour défendre les prisonniers : ils les libèrent
  n.atkT = Math.min(0.99, 1 - Math.max(0, n.cd) / 2.5); // le geste de frappe, en boucle
  if ((n.cd -= dt) <= 0) {
    n.cd = 2.5 + Math.random() * 1.5;
    if (OBJ_INFO[world.objAt(bx, by)] && OBJ_INFO[world.objAt(bx, by)].state < 2) damageBuilding(bx, by, 1, true);
    if (!E.freed && (E.siegeT += 1.5) > 30) { E.freed = true; freeCaptives(E.base); }
  }
  return 'attack';
}
// ressorti pendant le siège : ils l'attendent devant la porte
function expAtDoor() {
  const E = expedition;
  if (!E || !E.atBase || !realm) return;
  for (const n of expAlive()) {
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 2, x = realm.out[0] + Math.cos(a) * r, y = realm.out[1] + Math.sin(a) * r;
      if (freeSpot(x, y)) { n.x = x; n.y = y; n.state = 'chase'; break; }
    }
  }
}
// L'indicateur de l'expédition au bord de l'écran, quand elle n'est pas encore là.
function drawExpedition() {
  if (!expedition || realm) return;
  let best = null, bd = 1e9;
  for (const n of expAlive()) { const d = Math.hypot(n.x - player.x, n.y - player.y); if (d < bd) { bd = d; best = n; } }
  if (!best || bd < 10) return;
  const dx = best.x - player.x, dy = best.y - player.y;
  let sdx = (dx - dy) * 16, sdy = (dx + dy) * 8;
  const l = Math.hypot(sdx, sdy) || 1;
  sdx /= l; sdy /= l;
  const cx = Math.round(VW / 2 + sdx * (VW / 2 - 24)), cy = Math.round(VH / 2 + sdy * (VH / 2 - 30));
  const t = 'EXPEDITION ' + Math.round(bd);
  ctx.fillStyle = Math.floor(rt() * 4) % 2 ? '#ff2e3e' : '#9c1628';
  for (let i = 0; i < 4; i++) ctx.fillRect(Math.round(cx + sdx * (4 - i) - 3 + i), Math.round(cy + sdy * (4 - i) - 3 + i), 7 - 2 * i, 7 - 2 * i);
  drawText(ctx, t, Math.max(4, Math.min(VW - 4 - textWidth(t), cx - Math.round(textWidth(t) / 2))), cy + 6, '#ff9aa8');
}

// ---------------------------------------------------------------- villages qui se reconstruisent
// Une maison rasée est rebâtie au bout de 10 minutes de jeu, s'il n'est pas dans les parages.
let rebuildT = 0;
function updateRebuild(dt) {
  if (realm || (rebuildT -= dt) > 0) return;
  rebuildT = 5;
  for (const [k, t] of world.ruins) {
    if (stats.play - t < 600) continue;
    const [ax, ay] = k.split(',').map(Number);
    if (Math.hypot(ax - player.x, ay - player.y) < 28) continue;
    const info = OBJ_INFO[world.objAt(ax, ay)];
    world.ruins.delete(k);
    if (!info || !info.building || info.state < 2) continue;
    world.setObj(ax, ay, BUILDINGS[info.building].ids[0]);
    const v = villageAt(ax, ay, 8);
    if (v) vstateOf(v).rebuilt = true;
  }
}

// ---------------------------------------------------------------- villageois chez eux
// En entrant dans une maison de village, ceux qui y sont rentrés (la nuit, sous la pluie) sont là :
// endormis dans leur lit, ils se réveillent en sursaut ; terrorisés, ils fuient dans les coins.
function bringResidents(stash, ax, ay) {
  const beds = [];
  for (let y = 0; y < world.h; y++) for (let x = 0; x < world.w; x++) if (world.objAt(x, y) === O.BED) beds.push([x, y]);
  let i = 0;
  for (let k = stash.npcs.length - 1; k >= 0; k--) {
    const n = stash.npcs[k];
    if (!n.inside || !alive(n) || !n.home || n.home.ax !== ax || n.home.ay !== ay) continue;
    stash.npcs.splice(k, 1);
    const bed = beds[i++];
    let x = bed ? bed[0] + 0.5 : 0.5 + Math.random() * (world.w - 1), y = bed ? bed[1] + 0.5 : 0.5 + Math.random() * (world.h - 2);
    Object.assign(n, { x, y, z: groundZ(x, y), inside: false, inRoom: true, asleep: !!bed && outsideDark() > 0.5, bed, state: 'wander', vx: 0, vy: 0 });
    npcs.push(n);
  }
}
function updateResident(n, dt, d) {
  if (n.asleep) {
    // il dort... jusqu'à ce que le monstre approche ou fasse du bruit
    if (d < 2.5 || shake > 2) { n.asleep = false; sfx.scream(PEOPLE[n.type].voice * 1.2); n.alertT = 1.5; }
    else { n.x = n.bed[0] + 0.5; n.y = n.bed[1] + 0.5; return 'ko'; } // il reste couché dans son lit
  }
  if (d < 3) {
    const ax = n.x - player.x, ay = n.y - player.y, l = Math.hypot(ax, ay) || 1;
    steer(n, n.x + ax / l * 2, n.y + ay / l * 2, 2.6 * n.speedK, dt);
    if ((n.waveCd -= dt) <= 0) { n.waveCd = 2 + Math.random() * 3; sfx.scream(PEOPLE[n.type].voice); }
    return 'flee';
  }
  n.dir = faceDir(player.x - n.x, player.y - n.y); // il ne le quitte pas des yeux
  return n.kind === 'civ' ? 'wave' : 'idle';
}

// ---------------------------------------------------------------- prisonniers
// Un habitant qu'il porte en entrant dans sa tanière (ou un abri) devient prisonnier : pour son
// village il a disparu. Lâché près d'une cage, il y est enfermé ; libre, il cherche la sortie et
// s'échappe s'il l'atteint. On peut le reprendre, le tuer et le dévorer : une réserve de viande.
function makeCaptive(type, x, y, cage) {
  const D = PEOPLE[type];
  return { type, kind: D.kind, x, y, z: 0, jz: 0, vz: 0, vx: 0, vy: 0, air: false, dir: 2, anim: 'idle', t: 0, state: 'wander', v: null, home: null,
    tx: x, ty: y, wait: 0, koT: 0, hp: D.kind === 'hero' ? D.hp : D.kind === 'knight' ? 4 : 1, maxHp: D.hp || 4, alertT: 0, atkT: 0, cd: 0, hurtT: 0, flash: 0,
    waveT: 0, waveCd: 9, inside: false, stuck: 0, speedK: 1, fj: 0, fade: 1, captive: true, caged: !!cage, cage };
}
// Pour son village, un prisonnier est perdu (il ne reviendra pas peupler les rues).
function kidnap(n) {
  if (n.v && n.v !== 'exp') { if (n.boss) deathsOf(n.v).champion = 1; else deathsOf(n.v)[n.kind]++; player.infamy += 2; }
  n.v = null; n.home = null; n.exp = false; n.captive = true; n.escapee = false;
}
// une cage libre tout près de (x, y)
function cageNear(x, y) {
  for (let ty = Math.floor(y) - 1; ty <= Math.floor(y) + 1; ty++) for (let tx = Math.floor(x) - 1; tx <= Math.floor(x) + 1; tx++) {
    if (world.objAt(tx, ty) !== O.CAGE || Math.hypot(tx + 0.5 - x, ty + 0.5 - y) > 1.3) continue;
    if (!npcs.some((n) => n.caged && n.cage[0] === tx && n.cage[1] === ty && alive(n))) return [tx, ty];
  }
  return null;
}
function updateCaptive(n, dt, d) {
  if (n.caged) {
    if (world.objAt(n.cage[0], n.cage[1]) !== O.CAGE) { n.caged = false; return 'idle'; } // la cage est cassée
    n.x = n.cage[0] + 0.5; n.y = n.cage[1] + 0.5; n.vx = n.vy = 0;
    n.dir = faceDir(player.x - n.x, player.y - n.y);
    // il secoue les barreaux quand le monstre approche
    if (d < 3 && n.kind === 'civ' && (n.waveCd -= dt) <= 0) { n.waveCd = 3 + Math.random() * 4; sfx.scream(PEOPLE[n.type].voice); }
    return d < 3 ? (n.kind === 'civ' ? 'flee' : 'walk') : 'idle';
  }
  // libre : il cherche la sortie, et se fige de terreur si le monstre est tout près
  if (d < 2.2) { n.dir = faceDir(player.x - n.x, player.y - n.y); return 'idle'; }
  const [ex, ey] = (world.exitKey || '0,0').split(',').map(Number);
  steer(n, ex + 0.5, ey + 0.5, 1.3, dt);
  if (Math.hypot(ex + 0.5 - n.x, ey + 0.5 - n.y) < 0.7) { showMsg("UN PRISONNIER S'EST ECHAPPE !", 2.5); return 'escaped'; }
  return 'walk';
}
// Ressorti avec lui, ou libéré dehors : il s'enfuit loin et disparaît.
function updateEscapee(n, dt, d) {
  if (d > 16) return 'escaped';
  const ax = n.x - player.x, ay = n.y - player.y, l = Math.hypot(ax, ay) || 1;
  steer(n, n.x + ax / l * 2, n.y + ay / l * 2, 3 * n.speedK, dt);
  return n.kind === 'civ' ? 'flee' : 'run';
}

function enterBuilding(b) {
  const info = OBJ_INFO[b.o], [nx, ny] = b.door;
  let out = [b.tx + nx * 1.5, b.ty + ny * 1.5];
  if (!freeSpot(out[0], out[1])) out = [player.x, player.y];
  if (info.den) enterRealm('den', 'den', out, 'SA TANIERE', 'CREUSE A COUPS DE POING, OU AVEC BATIR');
  else enterRealm('room:' + b.tx + ',' + b.ty, info.building, out, ROOM_NAMES[info.building], info.built ? 'BATIR : MEUBLE-LE' : '');
}

function enterRealm(key, kind, out, name, sub = '') {
  if (realm || player.dead) return;
  // un habitant porté entre avec lui : il devient prisonnier
  const cap = player.held && player.held.n && alive(player.held.n) && player.held.n.kind !== 'beast' ? player.held.n : null;
  if (player.held && !cap) dropHeld();
  if (player.charging) { player.charging = false; player.chargeKind = null; player.aim = null; chargeStop(); }
  player.aiming = false; player.action = null; player.slide = null; player.sprinting = false; player.spd = 0;
  const stash = { npcs: npcs.splice(0), drops: drops.splice(0), thrown: thrown.splice(0), decals: decals.splice(0), bloods: bloods.splice(0),
    fx: fx.splice(0), flyers: flyers.splice(0), fires: new Map(fires), hits: new Map(hits) };
  fires.clear(); hits.clear(); particles.length = 0;
  if (cap) stash.npcs.splice(stash.npcs.indexOf(cap), 1);
  realm = { key, kind, out, stash };
  world = realmOf(key, kind);
  const sp = world.findSpawn();
  player.x = sp.x; player.y = sp.y; player.z = groundZ(sp.x, sp.y);
  npcs.push(...world.captives); world.captives = []; // ceux qu'il a laissés là
  if (key.startsWith('room:') && world.village) { const [ax, ay] = key.slice(5).split(',').map(Number); bringResidents(stash, ax, ay); }
  for (const n of npcs) n.z = groundZ(n.x, n.y);
  if (cap) { kidnap(cap); npcs.push(cap); sub = 'UN PRISONNIER ! LACHE-LE PRES D\'UNE CAGE'; }
  player.air = false; player.jz = 0; player.vz = 0; player.water = 0;
  player.dir = kind === 'den' ? 2 : 6;
  setAnim('idle');
  scent = null; curVillage = null;
  realmFade = 1;
  sfx.door(kind === 'den');
  showMsg(name, 2.5, sub);
}
function exitRealm(quiet) {
  if (!realm) return;
  for (const d of drops) addItem(d.id, 1); // ce qui traîne par terre dedans lui revient
  const S = realm.stash, out = realm.out, carried = player.held && player.held.n;
  world.captives = npcs.filter((n) => n !== carried && n.captive && alive(n)); // les prisonniers restent dedans
  const residents = npcs.filter((n) => n.inRoom && alive(n) && n !== carried), harm = realm.harm;
  world = surface;
  for (const k of ['npcs', 'drops', 'thrown', 'decals', 'bloods', 'fx', 'flyers']) { const a = { npcs, drops, thrown, decals, bloods, fx, flyers }[k]; a.length = 0; a.push(...S[k]); }
  // ceux de la maison restent chez eux
  for (const n of residents) { Object.assign(n, { inRoom: false, asleep: false, inside: true, state: 'wander', x: n.home.door[0], y: n.home.door[1] }); npcs.push(n); }
  if (carried) {
    npcs.push(carried);
    if (carried.inRoom) { carried.inRoom = false; carried.asleep = false; } // un villageois arraché de chez lui
    else { carried.captive = false; carried.caged = false; carried.escapee = true; } // il ressort avec lui
  }
  if (harm) crime(6, out[0], out[1]); // on a entendu les cris : le village est en alerte
  fires.clear(); for (const [k, v] of S.fires) fires.set(k, v);
  hits.clear(); for (const [k, v] of S.hits) hits.set(k, v);
  particles.length = 0;
  expAtDoor(); // assiégé : ils l'attendent devant la porte
  realm = null;
  player.x = out[0]; player.y = out[1]; player.z = groundZ(out[0], out[1]);
  player.air = false; player.jz = 0; player.vz = 0;
  player.dir = 2;
  realmFade = 1;
  doorLock = true;
  if (!quiet) sfx.door(false);
}

// Les portes : dedans, marcher sur la sortie fait sortir ; dehors, pousser contre la porte d'un
// bâtiment fait entrer (le bouton N dit ENTRER / SORTIR à côté).
function realmDoors(mag) {
  if (realmFade > 0.4 || player.air || player.dead || player.sleep) return;
  if (realm) {
    const o = world.objAt(Math.floor(player.x), Math.floor(player.y));
    if (OBJ_INFO[o] && OBJ_INFO[o].exit) exitRealm();
    return;
  }
  const b = player.interact;
  if (doorLock) { if (!b || mag < 0.2) doorLock = false; return; }
  if (!b || !b.enter || mag < 0.3 || player.action) return;
  const [nx, ny] = b.door, rx = player.x - b.tx, ry = player.y - b.ty;
  const along = rx * nx + ry * ny, side = Math.abs(rx * ny - ry * nx), [fx0, fy0] = dirWorld(player.dir);
  if (along > 0.4 && along < 1.6 && side < 0.75 && fx0 * nx + fy0 * ny < -0.6) enterBuilding(b);
}

// Creuser une paroi de la tanière : quelques coups (plus pour un filon), puis elle s'effondre et
// laisse de la terre, de la pierre ou du fer. Les murs d'une maison et la roche dure résistent.
const IRON_COLS = ['#c9732e', '#9a4a1c', '#7a5233'];
function digTile(tx, ty, dmg) {
  const t = world.typeAt(tx, ty), D = world.den && DIG[t], h = world.hAt(tx, ty) * 8;
  if (!D) { burst(tx + 0.5, ty + 0.5, h, ROCK_COLS, 4, { up: 20, speed: 1, life: 0.4 }); sfx.hitRock(); return false; }
  const key = 'dig:' + tx + ',' + ty, st = hits.get(key) || { n: 0, shake: 0 };
  st.n += Math.max(1, dmg);
  const cols = t === T.EARTH_STONE ? ROCK_COLS : t === T.EARTH_IRON ? IRON_COLS : EARTH_COLS;
  burst(tx + 0.5, ty + 0.5, h, cols, 6, { up: 30, speed: 1.4, life: 0.6 });
  if (st.n < D.hp) {
    hits.set(key, st);
    world.setWear(tx, ty, Math.min(3, 1 + Math.floor(st.n / D.hp * 3)), stats.play);
    sfx.crunch();
    return true;
  }
  hits.delete(key);
  openTile(tx, ty);
  stats.dug++;
  spawnDrops(tx + 0.5, ty + 0.5, D.drops);
  burst(tx + 0.5, ty + 0.5, 4, cols.concat(DUST_COLS), 18, { up: 50, speed: 2.2, life: 0.9, big: 0.5, spread: 3 });
  sfx.dig(t !== T.EARTH);
  shake = Math.max(shake, 2.5);
  return true;
}
function openTile(tx, ty) {
  world.setTile(tx, ty, T.DEN, 0, stats.play);
  world.setWear(tx, ty, 0, stats.play);
  // parfois, la paroi cachait quelque chose (une seule fois par tuile)
  const key = tx + ',' + ty, sec = world.secretAt && !world.found.has(key) && world.secretAt(tx, ty);
  if (!sec) return;
  world.found.add(key);
  if (sec === 'chest') {
    world.setObj(tx, ty, O.CHEST);
    const c = Array(CHEST_N).fill(null);
    world.loot(key).forEach((it, i) => { c[i] = it; });
    world.chests.set(key, c);
    showMsg('UN COFFRE ENFOUI !', 3, 'N : OUVRIR');
  } else if (sec === 'bones') {
    world.setObj(tx, ty, O.BONES);
    spawnDrops(tx + 0.5, ty + 0.5, [['meat', 2]]);
    showMsg('DES OSSEMENTS', 2.5, "LES RESTES D'UN FESTIN");
  } else if (sec === 'fossil') {
    world.setObj(tx, ty, O.FOSSIL);
    showMsg('UN ANCIEN NOMU !', 3.5, 'N : EXAMINER');
  } else {
    world.setTile(tx, ty, T.WATER, 0, stats.play);
    burst(tx + 0.5, ty + 0.5, 0, WATER_COLS, 20, { up: 60, speed: 1.4, life: 0.8 });
    sfx.splash(0.8);
    showMsg('UNE SOURCE !', 3, "DE L'EAU SOUS LA TERRE");
  }
  sfx.mutate();
}

// ---------------------------------------------------------------- interactions (bouton N)
// Près d'un coffre, d'un nid ou d'un feu de camp, le bouton N fait la bonne chose.
function builtNear() {
  let best = null, bd = 1.5;
  if (realm) {
    // dedans : la porte ou l'échelle
    for (let ty = Math.floor(player.y) - 1; ty <= Math.floor(player.y) + 1; ty++) for (let tx = Math.floor(player.x) - 1; tx <= Math.floor(player.x) + 1; tx++) {
      const o = world.objAt(tx, ty), d = Math.hypot(tx + 0.5 - player.x, ty + 0.5 - player.y);
      if (OBJ_INFO[o] && OBJ_INFO[o].exit && d < bd) { bd = d; best = { o, tx, ty, exit: true }; }
    }
    if (best) return best;
    bd = 1.5;
  } else {
    // dehors : une maison, son repaire ou sa tanière (on y entre)
    for (let ty = Math.floor(player.y) - 2; ty <= Math.floor(player.y) + 2; ty++) for (let tx = Math.floor(player.x) - 2; tx <= Math.floor(player.x) + 2; tx++) {
      const o = world.objAt(tx, ty), info = OBJ_INFO[o];
      if (!info || !info.building || info.state > 1 || !ENTERABLE[info.building]) continue;
      // on juge la distance à sa porte : deux abris collés, c'est celui dont on touche l'entrée
      const door = doorOf(tx, ty, info), d = Math.hypot(tx + door[0] * 1.15 - player.x, ty + door[1] * 1.15 - player.y);
      if (d < 1.3 && (!best || d < best.d)) best = { o, tx, ty, d, enter: true, door };
    }
  }
  for (let ty = Math.floor(player.y) - 1; ty <= Math.floor(player.y) + 1; ty++) for (let tx = Math.floor(player.x) - 1; tx <= Math.floor(player.x) + 1; tx++) {
    const o = world.objAt(tx, ty);
    if (o !== O.CHEST && o !== O.NEST && o !== O.CAMPFIRE && o !== O.RACK && o !== O.FOSSIL) continue;
    const d = Math.hypot(tx + 0.5 - player.x, ty + 0.5 - player.y);
    if (d < bd) { bd = d; best = { o, tx, ty }; }
  }
  return best;
}
const INTERACT_LABEL = { [O.CHEST]: 'OUVRIR', [O.NEST]: 'DORMIR', [O.CAMPFIRE]: 'CUIRE', [O.RACK]: 'EXPOSER', [O.FOSSIL]: 'EXAMINER' };
const TROPHIES = ['crown', 'emblem', 'helmet', 'shield']; // dans l'ordre où il les expose
const trophyWorth = (id) => (id === 'crown' ? 3 : id === 'emblem' ? 2 : 1);
const interactLabel = (b) => (b.enter ? 'ENTRER' : b.exit ? 'SORTIR' : INTERACT_LABEL[b.o]);

function interact(b) {
  if (b.enter) { enterBuilding(b); return; }
  if (b.exit) { exitRealm(); return; }
  if (b.o === O.RACK) {
    // un trophée de chasse accroché : il en tire de la force (voir strength)
    const k = b.tx + ',' + b.ty, list = world.racks.get(k) || [], id = TROPHIES.find((t) => countItem(t));
    if (list.length >= 4) { showMsg('LE PRESENTOIR EST PLEIN', 1.5, 'CONSTRUIS-EN UN AUTRE'); return; }
    if (!id) { showMsg('AUCUN TROPHEE', 1.8, 'CASQUES, BOUCLIERS, EMBLEMES, COURONNES'); return; }
    takeItem(id, 1);
    list.push(id); world.racks.set(k, list);
    player.trophies += trophyWorth(id);
    showMsg(ITEMS[id].name + ' EXPOSE', 2.5, 'FORCE +' + Math.round(trophyBonus() * 100 - 100) + '%');
    sfx.place();
    return;
  }
  if (b.o === O.FOSSIL) {
    // un ancien Nomu : il le flaire, le dévore des yeux, apprend de lui
    stats.fossils++;
    world.setObj(b.tx, b.ty, O.BONES);
    showMsg('UN ANCIEN NOMU', 3.5, 'IL APPREND DE SES OS : +15 EVOLUTION');
    sfx.growl();
    burst(b.tx + 0.5, b.ty + 0.5, 6, ['#d4c8b0', '#a89c88', '#c97249'], 20, { up: 40, speed: 1.4, life: 0.9 });
    gainEvo(15);
    return;
  }
  if (b.o === O.CHEST) {
    const k = b.tx + ',' + b.ty;
    if (!world.chests.has(k)) {
      // le coffre d'un villageois : il est déjà rempli
      const loot = world.loot ? world.loot(k) : null, c = Array(CHEST_N).fill(null);
      if (loot) loot.forEach((it, i) => { c[i] = it; });
      world.chests.set(k, c);
    }
    openInv(0, k);
  } else if (b.o === O.NEST) {
    player.sleep = { t: 0, tx: b.tx, ty: b.ty, done: false };
    sfx.growl();
  } else {
    const n = countItem('meat');
    if (!n) { showMsg('PAS DE VIANDE CRUE', 1.5, 'DEVORE UNE PROIE EN ETANT REPU'); return; }
    takeItem('meat', n);
    giveOrDrop('steak', n);
    toastItem('steak', n);
    sfx.cook();
    burst(b.tx + 0.5, b.ty + 0.5, world.hAt(b.tx, b.ty) * 8 + 8, SMOKE_COLS.concat(['#c98a4a']), 12, { up: 30, g: -6, speed: 0.6, life: 1.4, spread: 4 });
  }
}

// Dans le nid : l'écran s'assombrit, il dort jusqu'au matin, régénéré ; il se réveillera ici.
function updateSleep(dt) {
  const S = player.sleep;
  S.t += dt;
  if (S.t > 1.3 && !S.done) {
    S.done = true;
    if (darkness() > 0.2) tod = 0.27;
    player.hp = maxHp();
    player.spawn = realm ? [realm.out[0], realm.out[1], 1] : [S.tx, S.ty]; // dedans : il se réveillera devant sa porte
    save();
    showMsg('LE NID EST TON REFUGE', 3, 'TU TE REVEILLERAS ICI');
    sfx.regen();
  }
  if (S.t > 2.6) player.sleep = null;
}

// ---------------------------------------------------------------- écrans (choix de mutation, sac)
// Style Minecraft : panneau gris en relief, cases creusées, infobulles sombres à liseré violet.
// Les objets se prennent et se posent comme dans Minecraft : toucher/clic = prendre la pile, toucher
// ailleurs = la poser (fusionner ou échanger) ; glisser-déposer ; appui long ou clic droit = la
// moitié (ou poser un seul objet) ; double-toucher ou Maj+clic = l'envoyer de l'autre côté ;
// lâché hors du panneau, l'objet tombe par terre.
let mutChoice = null; // { opts, sel } : 3 mutations au choix
let invUI = null; // le sac ouvert (voir openInv)
const uiHits = []; // boutons de l'écran affiché : { x, y, w, h, fn }
const uiItems = []; // ce qu'on peut viser au clavier ou à la manette : cases et boutons { x, y, w, h, slot?, fn? }
const overlayOpen = () => !!(mutChoice || invUI || baking);
const MC = { bg: '#c6c6c6', hi: '#ffffff', lo: '#555555', ink: '#3f3f3f', slot: '#8b8b8b', slotLo: '#373737', slotHi: '#ffffff' };
const PW = 176, PH = 166; // le panneau, comme celui de Minecraft
// l'horloge de l'interface : le jeu (et son `time`) est en pause tant qu'un écran est ouvert
const rt = () => performance.now() / 1000;

function openMutChoice() {
  const opts = draw3(player.muts);
  if (!opts.length) { player.pendingLv = 0; return; } // tout est déjà pris
  mutChoice = { opts, sel: Math.min(1, opts.length - 1), t: 0 };
  releaseInputs();
  sfx.mutate();
}

function chooseMutation(i) {
  const id = mutChoice.opts[i], M = MUTATIONS[id];
  mutChoice = null;
  player.pendingLv = Math.max(0, player.pendingLv - 1);
  player.muts.push(id);
  if (id === 'mass') player.hp = Math.min(maxHp(), player.hp + 40);
  showMsg('MUTATION : ' + M.name, 3.5, M.desc.join(' - '));
  sfx.roar(1);
  shake = Math.max(shake, 6);
  fx.push({ kind: 'ring', x: player.x, y: player.y, z: player.z, t: 0, r: 2.5 });
  burst(player.x, player.y, player.z + 20, [BRANCHES[M.branch].col, '#ffffff', '#c9a0ff'], 50, { up: 70, speed: 2.5, life: 1.2 });
  if (M.look) rebakeNomu();
}

// tab : 0 sac (ou coffre), 1 mutations, 2 fabriquer
function openInv(tab = 0, chest = null) {
  invUI = { tab, chest, cursor: null, press: null, drag: false, px: VW / 2, py: VH / 2, pointer: false, sel: 0, recipe: 0, mut: 'arms', tip: null, tipT: 0, lastTap: null };
  releaseInputs();
  sfx.ui();
}
function closeInv() {
  // ce qui reste en main retourne dans le sac (ou tombe s'il est plein)
  const c = invUI && invUI.cursor;
  if (c && c.id) giveOrDrop(c.id, c.n);
  invUI = null;
  sfx.ui();
}

function releaseInputs() {
  input.punch = input.jump = input.sniff = input.grab = false;
  input.x = input.y = 0; joy.id = null;
  btnTouches.clear(); keys.clear(); mouse.punch = mouse.charge = mouse.grab = false;
  if (player.charging) { player.charging = false; player.chargeKind = null; player.aim = null; chargeStop(); }
  player.aiming = false; player.grabArm = false;
}

// --- dessin
function hit(x, y, w, h, fn) { uiHits.push({ x, y, w, h, fn }); uiItems.push({ x, y, w, h, fn }); }
function textC(t, cx, y, col, sh) { drawText(ctx, t, Math.round(cx - textWidth(t) / 2), y, col, sh); }
const ink = (t, x, y, col = MC.ink) => drawText(ctx, t, x, y, col, null); // texte sombre sans ombre, sur le gris
function wrap(str, w) {
  const out = [];
  let line = '';
  for (const word of str.split(' ')) {
    const t = line ? line + ' ' + word : word;
    if (textWidth(t) > w && line) { out.push(line); line = word; } else line = t;
  }
  if (line) out.push(line);
  return out;
}
// Panneau Minecraft : contour noir aux coins arrondis, biseau clair en haut à gauche, sombre en bas à droite.
function mcPanel(x, y, w, h, bg = MC.bg) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(x + 1, y, w - 2, h); ctx.fillRect(x, y + 1, w, h - 2);
  ctx.fillStyle = bg; ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  ctx.fillStyle = MC.hi; ctx.fillRect(x + 1, y + 1, w - 3, 2); ctx.fillRect(x + 1, y + 1, 2, h - 3);
  ctx.fillStyle = MC.lo; ctx.fillRect(x + 2, y + h - 3, w - 3, 2); ctx.fillRect(x + w - 3, y + 2, 2, h - 3);
  ctx.fillStyle = bg; ctx.fillRect(x + 1, y + h - 3, 1, 2); ctx.fillRect(x + w - 3, y + 1, 2, 1);
}
// Case creusée (18x18) : ombre en haut à gauche, lumière en bas à droite.
function mcSlot(x, y, s = 18, bg = MC.slot) {
  ctx.fillStyle = bg; ctx.fillRect(x, y, s, s);
  ctx.fillStyle = MC.slotLo; ctx.fillRect(x, y, s - 1, 1); ctx.fillRect(x, y, 1, s - 1);
  ctx.fillStyle = MC.slotHi; ctx.fillRect(x + 1, y + s - 1, s - 1, 1); ctx.fillRect(x + s - 1, y + 1, 1, s - 1);
}
// Bouton Minecraft : gris en relief, texte blanc ; grisé s'il est inactif.
function mcButton(x, y, w, h, label, on, fn) {
  ctx.fillStyle = '#000000'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = on ? '#6f6f6f' : '#2c2c2c'; ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  if (on) { ctx.fillStyle = '#a8a8a8'; ctx.fillRect(x + 1, y + 1, w - 2, 1); ctx.fillRect(x + 1, y + 1, 1, h - 2); ctx.fillStyle = '#4a4a4a'; ctx.fillRect(x + 1, y + h - 2, w - 2, 1); ctx.fillRect(x + w - 2, y + 1, 1, h - 2); }
  textC(label, x + w / 2, y + Math.round(h / 2) - 2, on ? '#ffffff' : '#7a7a7a', on ? '#3f3f3f' : null);
  hit(x, y, w, h, on ? fn : () => sfx.ui());
}
// Un objet dans une case : son icône, et le nombre en bas à droite (blanc, ombre grise).
function drawStack(s, x, y) {
  if (!s) return;
  ctx.drawImage(icons[s.alter ? 'a:' + s.alter : s.id], x + 3, y + 3);
  if (s.n > 1) { const t = String(s.n); drawText(ctx, t, x + 18 - textWidth(t), y + 12, '#ffffff', '#3f3f3f'); }
  if (s.alter && player.alterLv[s.alter] > 1) drawText(ctx, String(player.alterLv[s.alter]), x + 14, y + 12, '#ffe28a', '#3f3f3f');
}

function drawOverlay() {
  uiHits.length = 0;
  uiItems.length = 0;
  if (baking) drawBaking();
  else if (mutChoice) drawMutChoice();
  else if (invUI) drawInv();
}

function drawBaking() {
  ctx.fillStyle = 'rgba(16,8,24,0.8)';
  ctx.fillRect(0, 0, VW, VH);
  const w = 100, x = Math.round(VW / 2 - w / 2), y = Math.round(VH / 2);
  textC('MUTATION...', VW / 2, y - 14, '#c9a0ff');
  mcSlot(x - 2, y - 2, w + 4, '#2a2a2a');
  ctx.fillStyle = '#5a2a8a'; ctx.fillRect(x, y, w, 6);
  ctx.fillStyle = '#c9a0ff'; ctx.fillRect(x, y, Math.round(w * baking.p), 6);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, Math.round(w * baking.p), 1);
}

// Choix de mutation : 3 cartes en relief, l'icône en grand, la branche en couleur.
function drawMutChoice() {
  const C = mutChoice;
  ctx.fillStyle = 'rgba(16,8,24,0.78)';
  ctx.fillRect(0, 0, VW, VH);
  const top = 6 + safe.t;
  textC('MUTATION !', VW / 2, top, '#ff6b7a');
  textC('NIVEAU ' + player.level + ' - CHOISIS UN POUVOIR', VW / 2, top + 8, '#e8f0ff');
  const n = C.opts.length, gap = 6;
  const cw = Math.min(84, Math.floor((VW - 12 - safe.l - safe.r - gap * (n - 1)) / n)), ch = Math.min(104, VH - top - 50);
  const x0 = Math.round(VW / 2 - (cw * n + gap * (n - 1)) / 2), y0 = top + 19;
  ctx.imageSmoothingEnabled = false;
  C.opts.forEach((id, i) => {
    const M = MUTATIONS[id], B = BRANCHES[M.branch], sel = i === C.sel;
    const x = x0 + i * (cw + gap), y = y0 - (sel ? 2 + Math.round(Math.sin(rt() * 6)) : 0);
    mcPanel(x, y, cw, ch);
    if (sel) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 1, y - 1, cw + 2, 1); ctx.fillRect(x - 1, y + ch, cw + 2, 1); ctx.fillRect(x - 1, y, 1, ch); ctx.fillRect(x + cw, y, 1, ch); }
    ctx.fillStyle = B.dark; ctx.fillRect(x + 3, y + 3, cw - 6, 9);
    textC(B.name, x + cw / 2, y + 5, B.col);
    mcSlot(Math.round(x + cw / 2 - 15), y + 15, 30);
    ctx.drawImage(icons['m:' + id], Math.round(x + cw / 2 - 12), y + 18, 24, 24);
    let ty = y + 50;
    for (const l of wrap(M.name, cw - 8)) { textC(l, x + cw / 2, ty, MC.ink, null); ty += 7; }
    ty += 2;
    for (const d of M.desc) for (const l of wrap(d, cw - 8)) { textC(l, x + cw / 2, ty, '#5a5a5a', null); ty += 6; }
    textC(M.look ? 'SE VOIT SUR LUI' : 'INVISIBLE', x + cw / 2, y + ch - 10, M.look ? '#7a3ab0' : '#7a7a7a', null);
    hit(x, y, cw, ch, () => { if (C.sel === i) chooseMutation(i); else { C.sel = i; sfx.ui(); } });
  });
  const bw = 70, by = y0 + ch + 5;
  mcButton(Math.round(VW / 2 - bw / 2), by, bw, 14, 'MUTER', true, () => chooseMutation(C.sel));
  if (player.pendingLv > 1) textC('ENCORE ' + (player.pendingLv - 1) + ' APRES', VW / 2, by + 17, '#8a93b8');
}

// --- le sac : conteneurs
// 'inv' (36 cases : 0-8 la barre, 9-35 le sac), 'chest' (18), 'eq' (3 alters équipés), 'bank' (alters volés)
const bankList = () => player.alters.filter((a) => !player.equip.includes(a) && !(invUI && invUI.cursor && invUI.cursor.alter === a));
function cget(c, k) {
  if (c === 'inv') return player.inv[k];
  if (c === 'chest') return world.chests.get(invUI.chest)[k];
  if (c === 'eq') return player.equip[k] ? { alter: player.equip[k] } : null;
  if (c === 'bank') { const a = bankList()[k]; return a ? { alter: a } : null; }
  return null;
}
function cset(c, k, v) {
  if (c === 'inv') player.inv[k] = v;
  else if (c === 'chest') world.chests.get(invUI.chest)[k] = v;
}

// Un clic de Minecraft sur une case (right : clic droit / appui long).
function slotClick(ref, right = false) {
  const U = invUI, { c, k } = ref;
  if (c === 'eq' || c === 'bank') { alterClick(ref); return; }
  const s = cget(c, k), cur = U.cursor;
  if (cur && cur.alter) return; // un alter ne va pas dans le sac
  if (!cur) {
    if (!s) return;
    if (right && s.n > 1) { const h = Math.ceil(s.n / 2); U.cursor = { id: s.id, n: h }; s.n -= h; }
    else { U.cursor = s; cset(c, k, null); }
    sfx.ui();
  } else if (!s) {
    if (right) { cset(c, k, { id: cur.id, n: 1 }); cur.n--; } else { cset(c, k, cur); U.cursor = null; }
    sfx.pickup();
  } else if (s.id === cur.id) {
    const m = Math.min(right ? 1 : cur.n, STACK - s.n);
    s.n += m; cur.n -= m;
    sfx.pickup();
  } else if (!right) { cset(c, k, cur); U.cursor = s; sfx.pickup(); }
  if (U.cursor && U.cursor.n <= 0) U.cursor = null;
}
// Les alters : on les prend dans la réserve et on les pose sur les 3 emplacements (comme une armure).
function alterClick({ c, k }) {
  const U = invUI, cur = U.cursor && U.cursor.alter ? U.cursor.alter : null;
  if (U.cursor && !cur) return; // un objet ne va pas sur un emplacement d'alter
  if (c === 'eq') {
    const old = player.equip[k] || null;
    if (!cur && !old) return;
    while (player.equip.length < 3) player.equip.push(null);
    player.equip[k] = cur;
    U.cursor = old ? { alter: old } : null;
  } else if (cur) U.cursor = null; // reposé dans la réserve
  else { const a = bankList()[k]; if (a) U.cursor = { alter: a }; }
  player.equip = player.equip.slice(0, 3);
  sfx.ui();
}
// Double-toucher / Maj+clic : la pile part de l'autre côté (barre <-> sac, ou sac <-> coffre).
function quickMove(ref) {
  const { c, k } = ref, s = cget(c, k);
  if (!s || s.alter) return;
  let dest;
  if (invUI.chest) dest = c === 'chest' ? player.inv : world.chests.get(invUI.chest);
  else dest = k < 9 ? player.inv.slice(9) : player.inv.slice(0, 9);
  const before = s.n, left = addItem(s.id, s.n, dest);
  if (!invUI.chest) {
    // addItem a rempli une copie : on la recopie à sa place
    if (k < 9) for (let i = 0; i < 27; i++) player.inv[9 + i] = dest[i]; else for (let i = 0; i < 9; i++) player.inv[i] = dest[i];
  }
  if (left === before) return;
  if (left) s.n = left; else cset(c, k, null);
  sfx.pickup();
}
// Lâché hors du panneau : l'objet tombe devant Brainless (et ne revient pas tout de suite).
function dropCursor() {
  const c = invUI.cursor;
  if (!c || c.alter) { invUI.cursor = null; return; }
  const [dx, dy] = dirWorld(player.dir);
  for (let i = 0; i < c.n; i++) drops.push({ id: c.id, x: player.x + dx * 0.6, y: player.y + dy * 0.6, z: player.z + 20, vx: dx * 2 + (Math.random() - 0.5), vy: dy * 2 + (Math.random() - 0.5), vz: 40, t: -2 });
  invUI.cursor = null;
  sfx.whoosh();
}

// Une case du sac à l'écran (pour toucher, viser, survoler).
const uiSlots = [];
function slotUI(c, k, x, y) {
  mcSlot(x, y);
  const s = cget(c, k);
  drawStack(s, x, y);
  const ref = { c, k, x, y };
  uiSlots.push(ref);
  uiItems.push({ x, y, w: 18, h: 18, slot: ref });
  const U = invUI, cur = !U.pointer && uiItems.length - 1 === U.sel;
  const hov = U.pointer && U.px >= x && U.px < x + 18 && U.py >= y && U.py < y + 18;
  if (hov || cur) { ctx.globalAlpha = 0.45; ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 1, y + 1, 16, 16); ctx.globalAlpha = 1; }
  if (cur) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 1, y - 1, 20, 1); ctx.fillRect(x - 1, y + 18, 20, 1); ctx.fillRect(x - 1, y, 1, 18); ctx.fillRect(x + 18, y, 1, 18); }
  if ((hov || cur) && s && !U.cursor) U.tip = { s, x: x + 18, y };
  // l'objet choisi d'un toucher : cadre blanc (son nom est affiché)
  if (U.pick && U.pick.c === c && U.pick.k === k && s) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 1, y - 1, 20, 1); ctx.fillRect(x - 1, y + 18, 20, 1); ctx.fillRect(x - 1, y, 1, 18); ctx.fillRect(x + 18, y, 1, 18); }
}
const slotAtPoint = (x, y) => uiSlots.find((r) => x >= r.x && x < r.x + 18 && y >= r.y && y < r.y + 18);

// L'inventaire du joueur en bas du panneau (sac 9x3 + barre), comme dans Minecraft.
function drawPlayerInv(px, py, y) {
  ink('INVENTAIRE', px + 8, y);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) slotUI('inv', 9 + r * 9 + c, px + 7 + c * 18, y + 9 + r * 18);
  for (let c = 0; c < 9; c++) slotUI('inv', c, px + 7 + c * 18, y + 67);
}

function drawInv() {
  const U = invUI;
  uiSlots.length = 0;
  U.tip = null;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, VW, VH);
  const px = Math.round(VW / 2 - PW / 2), py = Math.round(VH / 2 - PH / 2 + 7);
  // onglets au-dessus du panneau (l'actif se raccorde au panneau)
  const tabs = U.chest ? ['COFFRE', 'MUTATIONS', 'ATELIER'] : ['SAC', 'MUTATIONS', 'ATELIER', 'CARTE', 'SUCCES'];
  let tx = px;
  tabs.forEach((t, i) => {
    const w = textWidth(t) + 8, on = U.tab === i;
    mcPanel(tx, py - 13, w, on ? 17 : 14, on ? MC.bg : '#a0a0a0');
    ink(t, tx + 4, py - 8, on ? MC.ink : '#5a5a5a');
    hit(tx, py - 13, w, 13, () => { U.tab = i; U.sel = 0; U.tipT = 0; U.pick = null; sfx.ui(); });
    tx += w + 1;
  });
  if (player.pendingLv > 0 && Math.floor(rt() * 3) % 2) { ctx.fillStyle = '#ff6b7a'; ctx.fillRect(px + textWidth(tabs[0]) + 9 + textWidth('MUTATIONS') + 4, py - 12, 3, 3); }
  // fermer (pour le tactile ; Échap / I / B ailleurs)
  mcPanel(px + PW - 15, py - 13, 15, 14, '#a0a0a0');
  ink('X', px + PW - 9, py - 8, '#8b1a1a');
  hit(px + PW - 15, py - 13, 15, 13, closeInv);
  mcPanel(px, py, PW, PH);
  if (U.tab === 0) { if (U.chest) drawChestTab(px, py); else drawBagTab(px, py); }
  else if (U.tab === 1) drawTreeTab(px, py);
  else if (U.tab === 2) drawCraftTab(px, py);
  else if (U.tab === 3) drawMapTab(px, py);
  else drawAchTab(px, py);
  // ce qu'on tient : sous le doigt / la souris, ou sur la case visée au clavier
  if (U.cursor) {
    let cx = U.px - 9, cy = U.py - 9;
    if (!U.pointer) { const it = uiItems[U.sel]; if (it) { cx = it.x + 4; cy = it.y + 4; } }
    drawStack(U.cursor, Math.round(cx), Math.round(cy));
  }
  // après un toucher, l'infobulle de la case reste un instant (seulement si cette case est à l'écran)
  if ((U.tipT -= 1 / 60) > 0 && U.tipRef && !U.cursor && uiSlots.some((r) => r.c === U.tipRef.c && r.k === U.tipRef.k)) {
    const s = cget(U.tipRef.c, U.tipRef.k);
    if (s) U.tip = { s, x: U.tipRef.x + 18, y: U.tipRef.y, pick: !!U.pick };
  }
  if (U.tip) drawTip(U.tip.s, U.tip.x, U.tip.y, U.tip.pick);
  if (U.sel >= uiItems.length) U.sel = Math.max(0, uiItems.length - 1);
}

// Infobulle Minecraft : fond presque noir, liseré violet, nom en blanc et détails en gris.
function tipLines(s) {
  if (s.alter) return [ALTERS[s.alter].name + ' - NIVEAU ' + (player.alterLv[s.alter] || 1), ...wrap(ALTERS[s.alter].desc, 110)];
  const it = ITEMS[s.id];
  const info = it.kind === 'food' ? ['+' + it.food + ' FAIM' + (it.hp ? ', +' + it.hp + ' VIE' : ''), 'DANS LA BARRE : MANGER']
    : it.kind === 'place' ? ['CONSTRUCTION', 'DANS LA BARRE : LA POSER DEVANT LUI', 'DANS LA TANIERE : MODE BATIR']
    : it.kind === 'trophy' ? ['TROPHEE DE CHASSE'] : ['MATERIAU', 'SERT A FABRIQUER'];
  return [it.name, ...info];
}
function drawTip(s, x, y, pick) {
  const lines = tipLines(s).concat(pick ? [{ touch: 'RETOUCHE : PRENDRE', keys: 'RECLIQUE : PRENDRE', pad: 'A : PRENDRE' }[inputMode]] : []), w = Math.max(...lines.map((l) => textWidth(l))) + 8, h = lines.length * 8 + 4;
  if (x + w > VW - 2) x = Math.max(2, x - w - 20);
  if (y + h > VH - 2) y = VH - 2 - h;
  ctx.fillStyle = 'rgba(16,0,16,0.94)'; ctx.fillRect(x + 1, y, w - 2, h); ctx.fillRect(x, y + 1, w, h - 2);
  ctx.fillStyle = '#5000ff'; ctx.fillRect(x + 1, y + 1, w - 2, 1); ctx.fillRect(x + 1, y + 1, 1, h - 2); ctx.fillRect(x + w - 2, y + 1, 1, h - 2);
  ctx.fillStyle = '#28007f'; ctx.fillRect(x + 1, y + h - 2, w - 2, 1);
  lines.forEach((l, i) => drawText(ctx, l, x + 4, y + 3 + i * 8, i ? '#aaaaaa' : '#ffffff', '#3f3f3f'));
}

// Onglet SAC : Brainless dans son cadre, ses alters équipés comme une armure, sa réserve d'alters.
function drawBagTab(px, py) {
  for (let i = 0; i < 3; i++) slotUI('eq', i, px + 7, py + 7 + i * 18);
  // Brainless qui tourne sur lui-même
  ctx.fillStyle = '#000000'; ctx.fillRect(px + 26, py + 7, 50, 64);
  ctx.fillStyle = '#1a1a24'; ctx.fillRect(px + 27, py + 8, 48, 62);
  const A = ANIMS.idle, dir = Math.floor(rt() / 1.1) % 8, img = nomu.idle && nomu.idle[dir] && nomu.idle[dir][Math.floor(rt() * A.fps) % A.frames];
  if (img && img.page) {
    ctx.save(); ctx.beginPath(); ctx.rect(px + 27, py + 8, 48, 62); ctx.clip();
    draw(img, px + 51 - img.ox, py + 64 - img.oy);
    ctx.restore();
  }
  // ce qu'il vaut
  const x = px + 82;
  ink('BRAINLESS', x, py + 8, '#7a2a3a');
  ink('NIVEAU ' + player.level, x, py + 16);
  ink('VIE ' + Math.round(player.hp) + '/' + maxHp(), x, py + 23);
  ink('FORCE X' + strength().toFixed(1), x, py + 30);
  ink('MUTATIONS ' + player.muts.filter((id) => mut(id)).length + '/' + Object.keys(MUTATIONS).length, x, py + 37);
  ink('ALTERS VOLES', x, py + 47);
  for (let i = 0; i < 5; i++) slotUI('bank', i, x + i * 17 - 1, py + 54);
  drawPlayerInv(px, py, py + 75);
}

// Onglet COFFRE : les 18 cases du coffre au-dessus du sac.
function drawChestTab(px, py) {
  ink('COFFRE', px + 8, py + 6);
  for (let i = 0; i < CHEST_N; i++) slotUI('chest', i, px + 7 + (i % 9) * 18, py + 15 + Math.floor(i / 9) * 18);
  drawPlayerInv(px, py, py + 55);
  ink('DOUBLE-TOUCHE : VERS L\'AUTRE COTE', px + 8, py + PH - 13, '#6a6a6a');
}

// Onglet FABRIQUER : le livre de recettes (cases), le détail de celle choisie, et le sac dessous.
function canCraft(r) { return Object.keys(r.need).every((id) => countItem(id) >= r.need[id]); }
function craft(r, all = false) {
  let n = 0;
  while (canCraft(r) && (all || n === 0) && n < 64) {
    for (const id in r.need) takeItem(id, r.need[id]);
    giveOrDrop(r.out, r.n);
    n++;
  }
  if (!n) { sfx.ui(); return; }
  toastItem(r.out, r.n * n);
  sfx.craft();
}
function drawCraftTab(px, py) {
  const U = invUI;
  ink('RECETTES', px + 8, py + 6);
  RECIPES.forEach((r, i) => {
    // 5 par ligne, cases de 15 : toutes les recettes tiennent au-dessus du sac
    const x = px + 6 + (i % 5) * 15, y = py + 14 + Math.floor(i / 5) * 15, ok = canCraft(r), sel = U.recipe === i;
    mcSlot(x, y, 15, sel ? '#b8b8b8' : ok ? MC.slot : '#7a5050');
    ctx.drawImage(icons[r.out], x + 2, y + 2);
    if (sel) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 1, y - 1, 17, 1); ctx.fillRect(x - 1, y + 15, 17, 1); ctx.fillRect(x - 1, y, 1, 15); ctx.fillRect(x + 15, y, 1, 15); }
    hit(x, y, 15, 15, () => { U.recipe = i; sfx.ui(); });
  });
  // le détail : ingrédients -> résultat
  const r = RECIPES[U.recipe], ok = canCraft(r), x0 = px + 84;
  ink(ITEMS[r.out].name, x0, py + 6, '#2a2a2a');
  const ids = Object.keys(r.need);
  ids.forEach((id, i) => {
    const x = x0 + i * 20, y = py + 16;
    mcSlot(x, y);
    ctx.drawImage(icons[id], x + 3, y + 3);
    const t = countItem(id) + '/' + r.need[id];
    drawText(ctx, t, x + 9 - Math.round(textWidth(t) / 2), y + 20, countItem(id) >= r.need[id] ? '#2f6a2f' : '#a01818', null);
  });
  // flèche puis la case du résultat (plus grande, comme Minecraft)
  const ax = x0 + ids.length * 20 + 2;
  ctx.fillStyle = ok ? '#ffffff' : '#8b8b8b';
  for (let i = 0; i < 4; i++) ctx.fillRect(ax + i, py + 25 - 3 + i, 1, 7 - 2 * i);
  ctx.fillRect(ax - 6, py + 24, 6, 1);
  const rx = px + PW - 33;
  mcSlot(rx, py + 12, 26);
  ctx.drawImage(icons[r.out], rx + 7, py + 19);
  if (r.n > 1) drawText(ctx, String(r.n), rx + 21, py + 29, '#ffffff', '#3f3f3f');
  ink(r.desc.length > 22 ? r.desc.slice(0, 22) : r.desc, x0, py + 43, '#5a5a5a');
  mcButton(x0, py + 51, 40, 14, 'FABRIQUER', ok, () => craft(r));
  mcButton(x0 + 43, py + 51, 42, 14, 'TOUT', ok, () => craft(r, true));
  drawPlayerInv(px, py, py + 75);
}

// Onglet MUTATIONS : comme l'écran des progrès de Minecraft, des cases reliées entre elles.
function mutState(id) {
  if (player.muts.includes(id)) return player.mutOff.includes(id) ? 'off' : 'own';
  const r = MUTATIONS[id].req;
  return !r || r.some((q) => player.muts.includes(q)) ? 'open' : 'lock'; // désactivée, elle compte quand même pour l'arbre
}
// Activer / désactiver une mutation acquise, ou montrer / cacher son apparence.
function toggleMut(id, look) {
  const L = look ? player.lookOff : player.mutOff, i = L.indexOf(id);
  if (i >= 0) L.splice(i, 1); else L.push(id);
  player.hp = Math.min(player.hp, maxHp()); // MASSE retirée : moins de vie
  sfx.mutate();
  if (MUTATIONS[id].look) rebakeNomu();
}
function mutPos(px, py) {
  const pos = {}, cw = (PW - 10) / 3;
  Object.keys(BRANCHES).forEach((b, c) => {
    for (let row = 0; row < 3; row++) {
      const list = Object.keys(MUTATIONS).filter((id) => MUTATIONS[id].branch === b && MUTATIONS[id].row === row);
      list.forEach((id, i) => { pos[id] = [Math.round(px + 5 + cw * c + cw / 2 + (i - (list.length - 1) / 2) * 24 - 9), py + 16 + row * 28]; });
    }
  });
  return pos;
}
function drawTreeTab(px, py) {
  const U = invUI, pos = mutPos(px, py), cw = (PW - 10) / 3;
  Object.keys(BRANCHES).forEach((b, c) => { const B = BRANCHES[b]; textC(B.name, px + 5 + cw * c + cw / 2, py + 6, B.dark, null); });
  // les liens : de chaque prérequis vers la mutation qu'il débloque
  for (const id in MUTATIONS) for (const q of MUTATIONS[id].req || []) {
    const [x1, y1] = pos[q], [x2, y2] = pos[id], on = player.muts.includes(q);
    ctx.fillStyle = on ? BRANCHES[MUTATIONS[id].branch].dark : '#8b8b8b';
    const my = y1 + 22;
    ctx.fillRect(x1 + 9, y1 + 18, 1, my - y1 - 18);
    ctx.fillRect(Math.min(x1, x2) + 9, my, Math.abs(x2 - x1) + 1, 1);
    ctx.fillRect(x2 + 9, my, 1, y2 - my);
  }
  ctx.imageSmoothingEnabled = false;
  for (const id in MUTATIONS) {
    const [x, y] = pos[id], st = mutState(id), B = BRANCHES[MUTATIONS[id].branch], sel = U.mut === id;
    mcSlot(x, y, 18, st === 'own' ? B.col : st === 'off' ? B.dark : st === 'open' ? '#b8b8b8' : '#6a6a6a');
    ctx.globalAlpha = st === 'lock' ? 0.35 : st === 'off' ? 0.55 : 1;
    ctx.drawImage(icons['m:' + id], x + 3, y + 3);
    ctx.globalAlpha = 1;
    if (st === 'off') { ctx.fillStyle = '#ff5a5e'; for (let i = 0; i < 5; i++) { ctx.fillRect(x + 12 + i, y + 2 + i, 1, 1); ctx.fillRect(x + 16 - i, y + 2 + i, 1, 1); } } // désactivée
    else if (st === 'own' && MUTATIONS[id].look && player.lookOff.includes(id)) { ctx.fillStyle = '#3f3f3f'; ctx.fillRect(x + 12, y + 3, 4, 1); ctx.fillRect(x + 13, y + 2, 2, 3); } // apparence cachée
    if (sel) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 1, y - 1, 20, 1); ctx.fillRect(x - 1, y + 18, 20, 1); ctx.fillRect(x - 1, y, 1, 18); ctx.fillRect(x + 18, y, 1, 18); }
    hit(x, y, 18, 18, () => { U.mut = id; sfx.ui(); });
  }
  // la mutation choisie
  const M = MUTATIONS[U.mut], st = mutState(U.mut), y = py + 100;
  ctx.fillStyle = '#000000'; ctx.fillRect(px + 6, y - 2, PW - 12, PH - (y - py) - 4);
  ctx.fillStyle = '#1a1a24'; ctx.fillRect(px + 7, y - 1, PW - 14, PH - (y - py) - 6);
  drawText(ctx, M.name, px + 10, y + 2, BRANCHES[M.branch].col);
  drawText(ctx, st === 'own' ? 'ACQUISE' : st === 'off' ? 'ACQUISE - DESACTIVEE' : st === 'open' ? 'DISPONIBLE' : 'DEMANDE ' + M.req.map((q) => MUTATIONS[q].name).join(' OU '), px + 10, y + 10, st === 'own' ? '#7ee08a' : st === 'off' ? '#ffb347' : st === 'open' ? '#8fb4ff' : '#ff7a7a');
  M.desc.forEach((d, i) => drawText(ctx, d, px + 10, y + 18 + i * 7, '#aaaaaa'));
  if (player.pendingLv > 0) mcButton(px + PW - 76, y + 18, 68, 13, 'CHOISIR (' + player.pendingLv + ')', true, () => { invUI = null; openMutChoice(); });
  if (st === 'own' || st === 'off') {
    // activer / désactiver ; et, active et visible, montrer ou cacher son apparence
    const on = st === 'own', id = U.mut;
    mcButton(px + 8, y + 40, 66, 14, on ? 'ACTIVE : OUI' : 'ACTIVE : NON', true, () => toggleMut(id, false));
    if (M.look) mcButton(px + 77, y + 40, 91, 14, player.lookOff.includes(id) ? 'APPARENCE : NON' : 'APPARENCE : OUI', on, () => toggleMut(id, true));
    else drawText(ctx, 'INVISIBLE', px + 80, y + 44, '#6a6a6a');
  } else drawText(ctx, M.look ? 'SE VOIT SUR LUI' : 'INVISIBLE', px + 10, y + 44, M.look ? '#c9a0ff' : '#6a6a6a');
}

// --- commandes des écrans
function overlayTap(x, y) {
  for (let i = uiHits.length - 1; i >= 0; i--) {
    const h = uiHits[i];
    if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) { h.fn(); return true; }
  }
  return false;
}
// Doigt ou souris posé. `right` : clic droit, `shift` : Maj enfoncée.
function overlayDown(x, y, right = false, shift = false) {
  const U = invUI;
  if (!U) { overlayTap(x, y); return; }
  U.pointer = true; U.px = x; U.py = y;
  const px0 = Math.round(VW / 2 - PW / 2), py0 = Math.round(VH / 2 - PH / 2 + 7);
  if (U.tab === 3 && U.map && x >= px0 + 6 && x < px0 + 6 + U.map.w && y >= py0 + 14 && y < py0 + 14 + U.map.h) { U.mapDrag = { x, y, cx: U.map.cx, cy: U.map.cy }; return; }
  const ref = slotAtPoint(x, y);
  if (!ref) {
    if (overlayTap(x, y)) return;
    const px = Math.round(VW / 2 - PW / 2), py = Math.round(VH / 2 - PH / 2 + 7);
    if (U.cursor && (x < px || x > px + PW || y < py - 14 || y > py + PH)) dropCursor(); // hors du panneau : il tombe
    return;
  }
  if (right) { slotClick(ref, true); return; }
  if (shift) { quickMove(ref); return; }
  U.press = { ref, x, y, t: rt(), moved: false };
}
function overlayMove(x, y) {
  const U = invUI;
  if (!U) return;
  U.pointer = true; U.px = x; U.py = y;
  if (U.mapDrag) {
    // le monde suit le doigt (losanges : un pixel de la carte = z tuiles)
    const D = U.mapDrag, ix = -(x - D.x) * U.map.z, iy = -(y - D.y) * U.map.z;
    U.map.cx = D.cx + (ix + 2 * iy) / 2; U.map.cy = D.cy + (2 * iy - ix) / 2;
    return;
  }
  const P = U.press;
  if (P && !P.moved && Math.hypot(x - P.x, y - P.y) > 4) {
    // ça glisse : il prend la pile (s'il n'a rien en main) et la promène sous le doigt
    P.moved = true;
    if (!U.cursor && cget(P.ref.c, P.ref.k)) { slotClick(P.ref); U.drag = P.ref; }
  }
}
function overlayUp(x, y) {
  const U = invUI;
  if (U && U.mapDrag) { U.mapDrag = null; return; }
  if (!U || !U.press) return;
  const P = U.press;
  U.press = null;
  if (U.drag) {
    const from = U.drag;
    U.drag = false;
    const ref = slotAtPoint(x, y);
    const px = Math.round(VW / 2 - PW / 2), py = Math.round(VH / 2 - PH / 2 + 7);
    if (ref) {
      slotClick(ref);
      if (U.cursor && !cget(from.c, from.k)) slotClick(from); // échange : l'autre objet prend sa place
    } else if (x < px || x > px + PW || y < py - 14 || y > py + PH) dropCursor();
    else slotClick(from); // relâché à côté : il retourne à sa place
    return;
  }
  if (P.moved) return;
  // un simple toucher : main vide, il choisit l'objet et affiche son nom ; le retoucher le prend,
  // le retoucher vite l'envoie de l'autre côté ; appui long = la moitié ; main pleine = poser
  const same = (a, b) => a && b && a.c === b.c && a.k === b.k, long = rt() - P.t > 0.45, s = cget(P.ref.c, P.ref.k);
  if (!U.cursor && s && !long && !same(U.pick, P.ref)) { U.pick = P.ref; U.tipRef = P.ref; U.tipT = 1e9; U.lastTap = { ref: P.ref, t: rt() }; sfx.ui(); return; }
  const L = U.lastTap, dbl = L && same(L.ref, P.ref) && rt() - L.t < 0.35;
  U.pick = null; U.tipT = 0; U.lastTap = null;
  if (!U.cursor && s && dbl) { quickMove(P.ref); return; }
  slotClick(P.ref, long);
}
// Clavier / manette : direction (vise la case voisine la plus proche), valider, retour, onglet,
// `alt` (clic droit), `move` (vers l'autre côté).
function overlayNav(dx, dy, ok, back, tab, alt = false, move = false) {
  if (baking) return;
  if (mutChoice) {
    const n = mutChoice.opts.length;
    if (dx) { mutChoice.sel = (mutChoice.sel + dx + n) % n; sfx.ui(); }
    if (ok) chooseMutation(mutChoice.sel);
    return;
  }
  const U = invUI;
  if (!U) return;
  if (dx || dy || ok || alt || move) U.pointer = false;
  if (back) { closeInv(); return; }
  const nt = U.chest ? 3 : 5;
  if (tab) { U.tab = (U.tab + tab + nt) % nt; U.sel = 0; U.tipT = 0; sfx.ui(); return; }
  // sur la carte, la direction la fait glisser
  if (U.tab === 3 && U.map && (dx || dy)) { const ix = dx * 12 * U.map.z, iy = dy * 12 * U.map.z; U.map.cx += (ix + 2 * iy) / 2; U.map.cy += (2 * iy - ix) / 2; return; }
  if (dx || dy) {
    const cur = uiItems[U.sel];
    if (!cur) { U.sel = 0; return; }
    const cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2;
    let best = -1, bd = 1e9;
    uiItems.forEach((it, i) => {
      const ix = it.x + it.w / 2 - cx, iy = it.y + it.h / 2 - cy;
      const along = ix * dx + iy * dy, side = Math.abs(ix * dy - iy * dx);
      if (along <= 2) return;
      const d = along + side * 2.5;
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0) U.sel = best;
    return;
  }
  const it = uiItems[U.sel];
  if (!it) return;
  if (it.slot) { if (move) quickMove(it.slot); else if (ok || alt) slotClick(it.slot, alt); }
  else if (ok) it.fn();
}
function overlayKey(e) {
  const c = e.code;
  const dx = c === 'ArrowLeft' || c === 'KeyA' || c === 'KeyQ' ? -1 : c === 'ArrowRight' || c === 'KeyD' ? 1 : 0;
  const dy = c === 'ArrowUp' || c === 'KeyW' || c === 'KeyZ' ? -1 : c === 'ArrowDown' || c === 'KeyS' ? 1 : 0;
  const ok = (c === 'Enter' || c === 'Space' || c === 'KeyJ') && !e.shiftKey;
  const move = (c === 'Enter' || c === 'Space') && e.shiftKey;
  const alt = c === 'KeyX' || c === 'KeyK';
  const back = c === 'Escape' || c === 'KeyI';
  const tab = c === 'Tab' ? (e.shiftKey ? -1 : 1) : 0;
  if (mutChoice && /^Digit[1-3]$/.test(c) && +c[5] <= mutChoice.opts.length) { chooseMutation(+c[5] - 1); return; }
  if (invUI && /^Digit[1-5]$/.test(c) && +c[5] <= (invUI.chest ? 3 : 5)) { invUI.tab = +c[5] - 1; invUI.sel = 0; sfx.ui(); return; }
  overlayNav(dx, dy, ok, back, tab, alt, move);
}
let padRepeat = 0;
function overlayPad(dt) {
  pollPad();
  if (!pad.connected) return;
  padRepeat -= dt;
  const dx = Math.abs(pad.x) > 0.5 ? Math.sign(pad.x) : 0, dy = Math.abs(pad.y) > 0.5 ? Math.sign(pad.y) : 0;
  let mx = 0, my = 0;
  if ((dx || dy) && padRepeat <= 0) { mx = Math.abs(pad.x) > Math.abs(pad.y) ? dx : 0; my = mx ? 0 : dy; padRepeat = 0.18; }
  if (!dx && !dy) padRepeat = 0;
  const P = pad.pressed;
  // A valider, B fermer, X la moitié / un seul, Y vers l'autre côté, L1/R1 onglets
  overlayNav(mx, my, P[0], P[1] || P[9], P[4] ? -1 : P[5] ? 1 : 0, P[2], P[3]);
}

// --- barre d'objets façon Minecraft (en bas au milieu, en haut en portrait)
const HB = 18; // pas d'une case
let hbName = { sel: -1, t: 0 }; // le nom de l'objet choisi s'affiche un instant au-dessus de la barre
const hotbarBox = () => {
  const w = 9 * HB + 4, x = Math.round(VW / 2 - w / 2);
  return { x, y: VW < VH ? 54 + safe.t : VH - HB - 6 - safe.b, w };
};
function drawHotbar() {
  const { x, y, w } = hotbarBox();
  ctx.fillStyle = '#000000'; ctx.fillRect(x, y, w, HB + 4);
  ctx.fillStyle = 'rgba(40,40,40,0.85)'; ctx.fillRect(x + 1, y + 1, w - 2, HB + 2);
  for (let i = 0; i < 9; i++) {
    const sx = x + 2 + i * HB;
    ctx.fillStyle = '#5a5a5a'; ctx.fillRect(sx, y + 2, HB, 1); ctx.fillRect(sx, y + 2, 1, HB);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(sx + 1, y + 3, HB - 1, HB - 1);
    drawStack(player.inv[i], sx, y + 2);
  }
  // le cadre de la case choisie, épais et blanc
  const sx = x + 2 + player.sel * HB - 2;
  ctx.fillStyle = '#000000'; ctx.fillRect(sx - 1, y - 1, HB + 6, HB + 6);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(sx, y, HB + 4, HB + 4);
  ctx.fillStyle = '#9a9a9a'; ctx.fillRect(sx + 1, y + 1, HB + 2, HB + 2);
  ctx.fillStyle = 'rgba(40,40,40,0.95)'; ctx.fillRect(sx + 2, y + 2, HB, HB);
  drawStack(player.inv[player.sel], sx + 2, y + 2);
  if (hbName.sel !== player.sel) hbName = { sel: player.sel, t: 2.2 };
  hbName.t -= 1 / 60;
  const s = player.inv[player.sel], ty = VW < VH ? y + HB + 8 : y - 9;
  if (toast) {
    ctx.globalAlpha = Math.min(1, toast.t);
    textC('+' + toast.n + ' ' + ITEMS[toast.id].name, VW / 2, ty, '#7ee08a');
    ctx.globalAlpha = 1;
  } else if (s && hbName.t > 0) {
    ctx.globalAlpha = Math.min(1, hbName.t);
    textC(ITEMS[s.id].name + (ITEMS[s.id].kind === 'place' ? ' - POSER : ' + useKey() : ITEMS[s.id].kind === 'food' ? ' - MANGER : ' + useKey() : ''), VW / 2, ty, '#ffffff');
    ctx.globalAlpha = 1;
  }
}
const useKey = () => ({ touch: 'RETOUCHE', keys: 'T', pad: 'CROIX HAUT' }[inputMode]);
// Toucher la barre : une case = la choisir, la case déjà choisie = l'utiliser.
function hotbarTap(x, y) {
  const b = hotbarBox();
  if (y < b.y - 2 || y > b.y + HB + 6 || x < b.x || x > b.x + b.w) return false;
  const i = Math.max(0, Math.min(8, Math.floor((x - b.x - 2) / HB)));
  if (i === player.sel) useItem(); else { player.sel = i; sfx.ui(); }
  return true;
}

// Icône sac (en haut à droite) : ouvre l'inventaire.
const bagBtn = { x: 0, y: 0, r: 7 };
function drawBagButton() {
  bagBtn.x = VW - 72 - safe.r;
  bagBtn.y = 11 + safe.t;
  const x = bagBtn.x - 5, y = bagBtn.y - 4;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x - 3, y - 3, 17, 14);
  ctx.fillStyle = '#a87a52'; ctx.fillRect(x + 1, y + 2, 9, 6);
  ctx.fillStyle = '#5e3d22'; ctx.fillRect(x + 3, y, 5, 2); ctx.fillRect(x + 1, y + 4, 9, 1);
  ctx.fillStyle = '#e0b23a'; ctx.fillRect(x + 5, y + 4, 1, 2);
  if (player.pendingLv > 0 && Math.floor(time * 3) % 2) { ctx.fillStyle = '#ff6b7a'; ctx.fillRect(x + 9, y - 2, 3, 3); } // une mutation attend
}

// ---------------------------------------------------------------- feu
// Une tuile qui brûle : ses flammes montent, consument son combustible (`fuel` dans OBJ_INFO, ou le
// toit d'un bâtiment) puis retombent. Bien chaude, elle allume ses voisines selon leur
// inflammabilité (foin, chaume, blé, buissons, arbres… l'herbe rase à peine). La pluie l'étouffe,
// une frappe au sol la souffle, les villageois font la chaîne avec des seaux depuis le puits.
// Consumé : l'arbre reste calciné, l'objet part en cendres, l'herbe noircit, la maison s'effondre.
const fires = new Map(); // "x,y" -> { x, y, o, t, fuel, heat, bld, tree, tick }
const MAX_FIRES = 70;
const BURN_MAT = { thatch: 1, barn: 0.75, tile: 0.3, slate: 0.12, stone: 0, hide: 0.25 }; // inflammabilité des toits
const BURN_FUEL = { thatch: 14, barn: 12, tile: 10, slate: 8, stone: 0, hide: 10 };
const SMOKE_COLS = ['#34343a', '#4a4a50', '#62626a'];
const EMBER_COLS = ['#ffd23f', '#ffb347', '#ff5a2a'];
const STEAM_COLS = ['#e8eef4', '#c9d3dc', '#ffffff'];
let fireNear = 0; // pour le crépitement : à quel point il y a du feu autour de Brainless
const fireGlows = []; // flammes à raviver après la teinte de nuit

const grassy = (t) => t === T.GRASS || t === T.MEADOW || t === T.FOREST;

function flammability(tx, ty) {
  if (!world.walkable(tx, ty)) return 0;
  const info = OBJ_INFO[world.objAt(tx, ty)];
  if (info && info.building) return info.state < 2 ? BURN_MAT[info.mat] : 0;
  if (info && info.fuel) return info.prop === 'hay' ? 1 : info.tree ? 0.45 : info.small ? (info.crop ? 0.6 : 0.25) : 0.7;
  return grassy(world.typeAt(tx, ty)) ? 0.06 : 0;
}

// Met le feu à une tuile (un bâtiment : à son ancre). `chance` multiplie son inflammabilité ;
// `force` : de l'huile renversée, ça prend même sur l'herbe rase.
function ignite(tx, ty, chance = 1, force = false) {
  const a = world.anchorOf(tx, ty);
  if (a) [tx, ty] = a;
  const k = tx + ',' + ty;
  if (fires.has(k) || fires.size >= MAX_FIRES || !world.walkable(tx, ty)) return false;
  const fl = Math.max(flammability(tx, ty), force ? 0.06 : 0);
  if (!fl || (!force && Math.random() >= fl * chance)) return false;
  const o = world.objAt(tx, ty), info = OBJ_INFO[o], bld = !!(info && info.building);
  fires.set(k, { x: tx, y: ty, o, t: 0, heat: force ? 0.6 : 0.25, tick: Math.random() * 0.5, bld, tree: !!(info && info.tree),
    fuel: bld ? BURN_FUEL[info.mat] : (info && info.fuel) || 1.5 });
  if (Math.hypot(tx + 0.5 - player.x, ty + 0.5 - player.y) < 14) sfx.ignite(bld || (info && info.tree) ? 1 : 0.4);
  return true;
}

// Une lanterne qui se brise, une charge en feu qui retombe : l'huile s'enflamme tout autour.
function oilSplash(tx, ty) {
  ignite(tx, ty, 9, true);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) ignite(tx + dx, ty + dy, 3);
}

// Centre d'un feu au sol (un bâtiment : le coin commun de ses 4 tuiles).
const fireCenter = (f) => (f.bld ? [f.x, f.y] : [f.x + 0.5, f.y + 0.5]);

function setOnFire(n) {
  if (n.burnT > 0.5) return;
  n.burnT = n.kind === 'hero' ? 1.5 : n.kind === 'beast' ? 3 : 4;
  n.bucket = false;
  if (n.kind === 'hero' || n.state === 'ko') return;
  // il court dans tous les sens en hurlant
  n.state = 'flee'; n.fleeT = 4; n.fj = (Math.random() - 0.5) * 2.5;
  if (n.kind !== 'beast') sfx.scream(PEOPLE[n.type].voice * 1.3);
}

function updateFires(dt) {
  const rain = weather.rain * (weather.snow ? 0.6 : 1);
  let near = 0;
  for (const [k, f] of fires) {
    const [cx, cy] = fireCenter(f), d = Math.hypot(cx - player.x, cy - player.y);
    if (d > 30) { fires.delete(k); continue; } // trop loin : on l'oublie
    const o = world.objAt(f.x, f.y);
    if (o !== f.o) {
      // l'objet a été cassé, arraché ou s'est effondré : il ne reste presque rien à brûler
      const info = OBJ_INFO[o];
      f.o = o; f.tree = !!(info && info.tree);
      if (!(info && info.building && info.state < 2)) f.fuel = Math.min(f.fuel, f.t + 1.5);
    }
    f.t += dt;
    f.heat = Math.min(1, f.heat + (f.t < f.fuel ? 0.9 : -0.5) * dt) - rain * 0.3 * dt;
    if (f.heat <= 0) { burnOut(f); fires.delete(k); continue; }
    near += f.heat * Math.max(0, 1 - d / 12) * (f.bld || f.tree ? 1 : 0.4);
    if ((f.tick -= dt) <= 0) {
      f.tick = 0.5;
      if (f.heat > 0.4) {
        // il gagne les voisins (un bâtiment : tout autour de ses 4 tuiles)
        const [x0, x1, y0, y1] = f.bld ? [f.x - 3, f.x + 1, f.y - 3, f.y + 1] : [f.x - 1, f.x + 1, f.y - 1, f.y + 1];
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x !== f.x || y !== f.y) ignite(x, y, f.heat * 0.22 * (1 - rain));
      }
      if (f.bld && (f.dmgT = (f.dmgT || 0) + 0.5) >= 1.5) {
        // la charpente brûle : la maison s'abîme puis s'effondre
        f.dmgT = 0;
        damageBuilding(f.x, f.y, 1, true);
        const info = OBJ_INFO[world.objAt(f.x, f.y)];
        if (info && info.state === 2) f.fuel = Math.min(f.fuel, f.t + 3);
      }
    }
    // ceux qui sont dans les flammes prennent feu
    if (f.heat > 0.3) {
      const r = f.bld ? 1.3 : 0.55;
      for (const n of npcs) if (alive(n) && !n.inside && !n.held && !n.thrown && Math.hypot(n.x - cx, n.y - cy) < r) setOnFire(n);
      if (!player.dead && !player.water && player.jz < 12 && !mut('fireproof') && Math.hypot(player.x - cx, player.y - cy) < r) player.burnT = Math.max(player.burnT, 1.2);
    }
    // fumée et braises qui montent
    if (particles.length < 330) {
      const gz = world.hAt(f.x, f.y) * 8, top = gz + (f.bld ? 30 : f.tree ? 28 : 6), k2 = f.bld || f.tree ? 1 : 0.3;
      if (Math.random() < dt * f.heat * 6 * k2 + dt * 0.6) {
        particles.push({ x: cx + (Math.random() - 0.5) * (f.bld ? 1.4 : 0.4), y: cy + (Math.random() - 0.5) * 0.4, z: top, vx: 0.3 + Math.random() * 0.2, vy: -0.25, vz: 9 + Math.random() * 8,
          g: -5, drag: 0.5, life: 1.8 + Math.random() * 1.4, col: SMOKE_COLS[(Math.random() * 3) | 0], size: Math.random() < 0.6 ? 2 : 1 });
      }
      if (Math.random() < dt * f.heat * 6 * k2 + dt * 0.8) {
        particles.push({ x: cx + (Math.random() - 0.5) * 0.6, y: cy + (Math.random() - 0.5) * 0.6, z: top - 4, vx: (Math.random() - 0.5) * 0.8, vy: (Math.random() - 0.5) * 0.8, vz: 25 + Math.random() * 25,
          g: -4, drag: 1, life: 0.6 + Math.random() * 0.7, col: EMBER_COLS[(Math.random() * 3) | 0], size: 1 });
      }
    }
  }
  fireNear = Math.min(1, near);

  // Brainless en feu : ça brûle un peu (l'eau l'éteint aussitôt)
  if (player.burnT > 0) {
    player.burnT -= dt * (player.water ? 20 : 1 + rain * 2);
    if (!player.dead) {
      player.hp -= dt * 4 * [0.6, 1, 1.5][world.p.difficulty] * (has('absorb') ? 0.5 : 1);
      player.lastHurt = time;
      if (player.hp <= 0) playerDown();
    }
    if (Math.random() < dt * 8) burst(player.x, player.y, player.z + 10 + Math.random() * 20, EMBER_COLS, 1, { up: 30, g: -4, speed: 0.4, life: 0.6, spread: 0 });
  }
}

// Habitant ou animal en feu (appelé chaque image tant qu'il brûle). Renvoie true s'il en meurt.
function burnNpc(n, dt) {
  n.burnT -= dt * (1 + weather.rain * 2);
  n.hp -= dt * (n.kind === 'hero' ? 0.6 : 0.35);
  if (Math.random() < dt * 0.6) ignite(Math.floor(n.x), Math.floor(n.y), 1); // il propage le feu en courant
  if (Math.random() < dt * 6 && particles.length < 340) burst(n.x, n.y, n.z + 10, Math.random() < 0.5 ? EMBER_COLS : SMOKE_COLS, 1, { up: 25, g: -4, speed: 0.3, life: 0.8, spread: 6 });
  if (n.kind !== 'beast' && n.kind !== 'hero' && Math.random() < dt * 0.7) sfx.scream(PEOPLE[n.type].voice * 1.3);
  if (n.hp > 0) return false;
  n.burnT = 0;
  killNpc(n, false);
  return true;
}

// Fin d'un feu. Assez brûlé (60 % du combustible), il laisse sa marque ; éteint à temps, l'objet est sauvé.
function burnOut(f) {
  if (f.t < f.fuel * 0.6) return;
  const o = world.objAt(f.x, f.y), info = OBJ_INFO[o];
  if (info && info.building) { if (info.state < 2) damageBuilding(f.x, f.y, 99, true); return; }
  if (info && info.tree) { world.setObj(f.x, f.y, O.BURNT); stats.trees++; }
  else if (info && info.fuel) world.setObj(f.x, f.y, O.NONE);
  const t = world.typeAt(f.x, f.y), h = world.hAt(f.x, f.y);
  if (grassy(t)) world.setTile(f.x, f.y, T.DIRT, h, stats.play); // l'herbe noircie repoussera
  bloods.push({ x: f.x + 0.5, y: f.y + 0.5, h, img: ashImgs[(f.x + f.y) & 1], age: 0 });
  if (bloods.length > 80) bloods.shift();
}

// Le feu de son village le plus proche de lui (pour la chaîne des seaux).
function villageFire(n) {
  const v = world.villages.get(n.v);
  if (!v || !fires.size) return null;
  let best = null, bd = 1e9;
  for (const f of fires.values()) {
    const [cx, cy] = fireCenter(f);
    if (Math.hypot(cx - v.cx - 0.5, cy - v.cy - 0.5) > v.R + 3) continue;
    const d = Math.hypot(cx - n.x, cy - n.y);
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}

// Un seau d'eau jeté sur le feu : vapeur, sifflement, les flammes baissent.
function douse(f, from) {
  f.heat -= 0.5;
  const [cx, cy] = fireCenter(f), gz = world.hAt(f.x, f.y) * 8;
  const dx = cx - from.x, dy = cy - from.y, l = Math.hypot(dx, dy) || 1;
  for (let i = 0; i < 10; i++) {
    particles.push({ x: from.x + dx / l * 0.3, y: from.y + dy / l * 0.3, z: from.z + 14, vx: dx / l * (2 + Math.random() * 1.5), vy: dy / l * (2 + Math.random() * 1.5), vz: 30 + Math.random() * 20,
      g: 160, drag: 0.5, life: 0.6, col: WATER_COLS[(Math.random() * 3) | 0], size: 1 });
  }
  burst(cx, cy, gz + 8, STEAM_COLS, 8, { up: 25, g: -10, speed: 0.6, life: 1.2, spread: 8 });
  if (Math.hypot(cx - player.x, cy - player.y) < 14) sfx.extinguish();
}

// Souffle d'une frappe : les flammes dans la zone sont soufflées (`test(rx, ry, d)` comme `blast`).
function blowFires(R, test, k) {
  for (const f of fires.values()) {
    const [cx, cy] = fireCenter(f), rx = cx - player.x, ry = cy - player.y, d = Math.hypot(rx, ry);
    if (d > R || !test(rx, ry, d)) continue;
    f.heat -= k;
    burst(cx, cy, world.hAt(f.x, f.y) * 8 + 6, SMOKE_COLS, 4, { up: 20, g: -5, speed: 1.5, life: 1, spread: 6 });
  }
}

// Flammes d'une tuile en feu : où et de quelle taille, selon ce qui brûle (stables d'une image à l'autre).
function flamesOf(f) {
  const big = f.heat > 0.45 ? 1 : 0, j = (i) => hash(f.x, f.y, i) - 0.5;
  if (f.bld) {
    const info = OBJ_INFO[f.o] || {}, top = info.state === 2 ? 10 : info.building === 'tower' ? 40 : 22;
    return [[-12 + j(1) * 4, top * 0.55, 1 + big], [11 + j(2) * 4, top * 0.6, 1 + big], [j(3) * 6, top, 1 + big], [-5 + j(4) * 4, top * 0.85, 1], [6 + j(5) * 4, top * 0.3, 1]];
  }
  if (f.tree) return [[j(1) * 3, 30, 1 + big], [-7 + j(2) * 2, 22, 1], [7 + j(3) * 2, 24, 1], [j(4) * 4, 4, 0]];
  const info = OBJ_INFO[f.o];
  if (info && !info.small) return [[j(1) * 2, 7, big], [-4 + j(2) * 2, 2, 0], [4 + j(3) * 2, 3, 0]];
  return [[j(1) * 8, 1, big * 0], [j(2) * 8, 3, 0]].slice(0, f.heat > 0.6 ? 2 : 1);
}

function drawFire(f, ox, oy) {
  const [cx, cy] = fireCenter(f), h = world.hAt(f.x, f.y);
  const sx = ox + Math.round(isoX(cx, cy)), sy = oy + Math.round(isoY(cx, cy)) - h * 8;
  flamesOf(f).forEach(([dx, up, size], i) => drawFlame(size, sx + Math.round(dx), sy - Math.round(up), i + f.x * 3 + f.y, f.heat));
}

// Une flamme posée en (x, y) (son pied). Gardée aussi pour la passe lumineuse de nuit.
function drawFlame(size, x, y, seed, heat = 1) {
  const img = flameImgs[size][(Math.floor(time * 10) + seed) & 3];
  const px = x - img.ox, py = y - img.oy;
  ctx.globalAlpha = Math.min(1, heat * 2);
  ctx.drawImage(img, px, py);
  ctx.globalAlpha = 1;
  fireGlows.push([img, px, py, size, heat]);
}

// Après la teinte de nuit : les flammes brillent et éclairent autour d'elles.
function drawFireGlow() {
  if (!fireGlows.length) return;
  const dk = darkness();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const [img, px, py, size, heat] of fireGlows) {
    ctx.globalAlpha = (0.12 + dk * 0.6) * Math.min(1, heat * 2);
    ctx.drawImage(img, px, py);
    if (size < 1 || dk < 0.1) continue;
    const hx = px + (img.width >> 1), hy = py + img.height - 4, r = 6 + size * 6;
    ctx.fillStyle = '#ff8a3c';
    ctx.globalAlpha = dk * 0.07 * heat;
    ctx.fillRect(hx - r * 2, hy - r * 0.6, r * 4, r * 1.2); ctx.fillRect(hx - r, hy - r * 1.2, r * 2, r * 2.4);
    ctx.globalAlpha = dk * 0.06 * heat;
    ctx.fillRect(hx - r * 1.4, hy - r, r * 2.8, r * 2);
  }
  ctx.restore();
  fireGlows.length = 0;
}

// ---------------------------------------------------------------- attraper et lancer
// Brainless empoigne ce qui est devant lui (tonneau, caisse, rocher, arbre qu'il déracine,
// habitant, animal, cadavre), le porte au-dessus de sa tête, puis le lance (maintenir = viser et
// doser) ou le fracasse au sol (COUP). Ce qu'il porte est dessiné entre ses mains (`holdPts`).
// En vol, tout fauche ce qu'il croise : gens, arbres, maisons. Ce qui est lourd (arbre, gros
// rocher) traverse la foule et écrase en retombant ; ce qui est léger éclate au premier choc.
const THROW_G = 330; // gravité des projectiles (px/s²)
const HOLD_Z = 36; // hauteur de ses mains au-dessus de ses pieds, charge levée (px)
const thrown = []; // objets du décor en vol
const npcWeight = (n) => (n.kind === 'beast' ? { rabbit: 0.6, deer: 1.5, boar: 1.6 }[n.type] || 1 : n.kind === 'knight' ? 1.3 : 1);
// un héros en forme se dégage vite ; un chevalier se débat ; les autres ne s'en sortent pas
const breakTime = (n) => (n.kind === 'hero' ? (n.hp > n.maxHp * 0.4 ? 1.3 : 3) : n.kind === 'knight' ? 3.5 : 1e9);
const throwDmg = (th) => Math.max(1, Math.round((1 + th.w * 1.5) * (0.5 + th.power) * strength() * (mut('thrower') ? 1.4 : 1)));
const tough = (n) => n.kind === 'hero' && n.hp > n.maxHp * 0.4; // un héros encore en forme
// léger (habitant, petit animal, caisse, tonneau…) : il le tient d'une main et peut galoper avec
const lightLoad = (w, big) => !big && w <= 1.5;
const oneHand = () => !!(player.held && player.held.one);

// Vitesse de lancer : la force du bras, freinée par le poids.
function throwSpeed(power, w) {
  const k = mut('thrower') ? 1.25 : 1; // LANCEUR
  return { v: (3.5 + power * 8.5) / (0.75 + 0.25 * w) * k, vz: (70 + power * 60) * (mut('thrower') ? 1.1 : 1) };
}

// Ce qu'il peut empoigner devant lui : une proie passe avant le décor.
function grabTarget() {
  const [dx, dy] = dirWorld(player.dir);
  let best = null, bs = -1e9;
  const score = (x, y, max) => {
    const rx = x - player.x, ry = y - player.y, d = Math.hypot(rx, ry);
    if (d > max) return null;
    const dot = d < 0.35 ? 1 : (rx * dx + ry * dy) / d;
    return dot < 0.3 ? null : dot * 1.2 - d;
  };
  for (const n of npcs) {
    if (n.inside || n.held || n.thrown || n.air || n.eaten) continue;
    const sc = score(n.x, n.y, 1.5);
    if (sc !== null && sc + 0.4 > bs) { bs = sc + 0.4; best = { n }; }
  }
  const cx = Math.floor(player.x + dx * 0.7), cy = Math.floor(player.y + dy * 0.7);
  for (let ty = cy - 1; ty <= cy + 1; ty++) for (let tx = cx - 1; tx <= cx + 1; tx++) {
    const info = OBJ_INFO[world.objAt(tx, ty)];
    if (!info || !info.lift) continue;
    const sc = score(tx + 0.5, ty + 0.5, 1.6);
    if (sc !== null && sc > bs) { bs = sc; best = { tx, ty }; }
  }
  return best;
}

function startGrab() {
  const tg = grabTarget();
  player.grabTarget = tg;
  if (tg) player.dir = faceDir((tg.n ? tg.n.x : tg.tx + 0.5) - player.x, (tg.n ? tg.n.y : tg.ty + 0.5) - player.y);
  const info = tg && !tg.n && OBJ_INFO[world.objAt(tg.tx, tg.ty)];
  const one = !tg || (tg.n ? lightLoad(npcWeight(tg.n)) : lightLoad(info.lift, info.tree || info.burnt));
  player.sprinting = false;
  player.spd = 0;
  startAction(one ? 'grab1' : 'grab');
  sfx.grabReach();
}

// Les griffes se referment (milieu de l'anim `grab`).
function seize() {
  const tg = player.grabTarget;
  player.grabTarget = null;
  if (tg && tg.n) {
    const n = tg.n;
    if (!npcs.includes(n) || n.held || n.inside || n.air || n.thrown || Math.hypot(n.x - player.x, n.y - player.y) > 1.7) { sfx.punchAir(); return; }
    n.held = true; n.vx = n.vy = 0; n.jz = 0; n.flash = 0.1; n.caged = false;
    if (alive(n) && n.state !== 'ko') {
      if (n.kind !== 'beast') n.state = 'held';
      n.breakT = breakTime(n);
      n.screamT = 0.6;
      if (n.kind === 'beast') n.angry = true;
      else { sfx.scream(PEOPLE[n.type].voice * 1.2); crime(n.kind === 'civ' ? 2.5 : 1, n.x, n.y); }
    }
    player.held = { n, w: npcWeight(n), one: lightLoad(npcWeight(n)) };
    sfx.grab(player.held.w);
    burst(n.x, n.y, n.z + 2, DUST_COLS, 6, { up: 20, speed: 1.2, g: 60, life: 0.5, spread: 1 });
    shake = Math.max(shake, 1.5);
    return;
  }
  const o = tg ? world.objAt(tg.tx, tg.ty) : 0, info = OBJ_INFO[o];
  if (!info || !info.lift) { sfx.punchAir(); return; }
  const cx = tg.tx + 0.5, cy = tg.ty + 0.5, gz = world.hAt(tg.tx, tg.ty) * 8;
  const fire = fires.get(tg.tx + ',' + tg.ty), burning = !!(fire && fire.heat > 0.3); // il l'arrache en feu
  fires.delete(tg.tx + ',' + tg.ty);
  world.setObj(tg.tx, tg.ty, O.NONE);
  hits.delete(tg.tx + ',' + tg.ty);
  if (info.tree) {
    // il arrache l'arbre avec ses racines : la terre saute, les feuilles volent
    stats.trees++;
    sfx.uproot();
    shake = Math.max(shake, 5);
    windT = Math.max(windT, 0.6);
    crackTile(tg.tx, tg.ty, 2);
    burst(cx, cy, gz, EARTH_COLS, 26, { up: 70, speed: 2.2, big: 0.6 });
    burst(cx, cy, gz + 26, leafColsFor(o), 16, { leaf: true, up: 20, g: 25, drag: 2, life: 1.6, spread: 14 });
  } else {
    sfx.grab(info.lift);
    shake = Math.max(shake, 1 + info.lift);
    burst(cx, cy, gz, info.rock ? EARTH_COLS.concat(ROCK_COLS) : DUST_COLS, 10, { up: 35, speed: 1.4, life: 0.6 });
    if (info.rock) crackTile(tg.tx, tg.ty, 1);
  }
  if (info.village) crime(info.crime || 0.2, cx, cy);
  player.held = { o, w: info.lift, tree: !!(info.tree || info.burnt), burning, one: lightLoad(info.lift, info.tree || info.burnt) };
}

// Un appui bref : droit devant, ou vers le stick ; visée aidée sur la proie la plus proche du tir.
function tapAim(ix, iy, mag) {
  let [ux, uy] = mag > 0.3 ? [((ix + iy) / mag) / Math.SQRT2, ((iy - ix) / mag) / Math.SQRT2] : dirWorld(player.dir);
  let best = null, bd = 0.32;
  for (const n of npcs) {
    if (n.inside || n.held || !alive(n)) continue;
    const rx = n.x - player.x, ry = n.y - player.y, d = Math.hypot(rx, ry);
    if (d < 1.5 || d > 12) continue;
    const a = Math.acos(Math.max(-1, Math.min(1, (rx * ux + ry * uy) / d)));
    if (a < bd) { bd = a; best = [rx / d, ry / d]; }
  }
  if (best) [ux, uy] = best;
  return [ux, uy];
}

function startThrow(power, aimed) {
  player.throwPower = power;
  player.dir = faceDir(player.aim[0], player.aim[1]);
  startAction(oneHand() ? 'throw1' : 'throw');
  if (aimed) player.actionT = 0.22; // déjà armé : il part directement
  sfx.heave();
}

// La charge quitte ses mains (milieu de l'anim `throw`).
function doThrow() {
  if (!player.held) return;
  const [ux, uy] = aimDir(), p = player.throwPower, w = player.held.w;
  releaseHeld(ux, uy, p, false);
  sfx.throwIt(p, w);
  shake = Math.max(shake, 2 + p * 2 + w);
  rumble(0.3 + p * 0.4, 100);
  // le bras fend l'air : traînées de vent vers l'avant
  for (let i = 0; i < 10 + p * 16; i++) {
    const a = Math.atan2(uy, ux) + (Math.random() * 2 - 1) * 0.5, sp = 5 + Math.random() * 5;
    particles.push({
      x: player.x + ux * 0.4, y: player.y + uy * 0.4, z: player.z + 20 + Math.random() * 18,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, vz: (Math.random() - 0.5) * 8, g: 0, drag: 2,
      life: 0.15 + Math.random() * 0.2, col: Math.random() < 0.7 ? '#ffffff' : '#d8ecff', size: 1, streak: true,
    });
  }
}

// Il lâche ce qu'il porte : lancé (`power`), ou simplement tombé (`gentle` : coup encaissé, il nage, il meurt).
function releaseHeld(ux, uy, power, gentle) {
  const h = player.held;
  if (!h) return;
  player.held = null; player.aiming = false; player.grabArm = false;
  const { v, vz } = gentle ? { v: 1.2, vz: 25 } : throwSpeed(power, h.w);
  const x = player.x + ux * 0.35, y = player.y + uy * 0.35, fz = player.z + HOLD_Z;
  const th = { power: gentle ? 0 : power, w: h.w, hit: new Set(), t: 0 };
  if (h.n) {
    const n = h.n;
    n.held = false;
    const cg = alive(n) && n.kind !== 'beast' && (gentle || power < 0.35) && cageNear(x, y);
    if (cg) {
      kidnap(n);
      Object.assign(n, { x: cg[0] + 0.5, y: cg[1] + 0.5, z: groundZ(cg[0] + 0.5, cg[1] + 0.5), jz: 0, vx: 0, vy: 0, vz: 0, air: false, thrown: null, dying: false, state: 'wander', caged: true, cage: cg });
      stats.caged++;
      showMsg('PRISONNIER ENCAGE', 2.5, 'TUE-LE QUAND TU AURAS FAIM');
      sfx.clank();
      return;
    }
    n.thrown = th;
    Object.assign(n, { x, y, fz, vx: ux * v, vy: uy * v, vz, air: true, rot: 0 });
    if (alive(n)) {
      if (n.kind === 'beast') { n.state = 'flee'; n.fleeT = 4; }
      else { n.state = 'ko'; n.koT = n.kind === 'hero' ? 2 : 3 + power * 3; n.anim = 'ko'; }
      // lancé fort, il ne s'en relève pas (sauf un héros encore en forme)
      n.dying = !gentle && power > 0.6 && !tough(n);
      if (n.kind !== 'beast' && !gentle) sfx.scream(PEOPLE[n.type].voice * 1.3);
    }
  } else thrown.push({ o: h.o, tree: h.tree, burning: h.burning, x, y, fz, vx: ux * v, vy: uy * v, vz, spin: 0, ...th });
}

function dropHeld() {
  if (!player.held) return;
  const [dx, dy] = dirWorld(player.dir);
  releaseHeld(dx, dy, 0, true);
}

// Porté : il suit les mains de Brainless, se débat, crie ; un chevalier ou un héros finit par se dégager.
function updateHeldNpc(n, dt) {
  if (player.held?.n !== n) { n.held = false; return; }
  const [dx, dy] = dirWorld(player.dir);
  n.x = player.x + dx * 0.2; n.y = player.y + dy * 0.2; n.z = player.z; n.jz = 0; n.dir = player.dir;
  n.flash = Math.max(0, n.flash - dt);
  const living = alive(n) && n.state !== 'ko';
  if (!living) return;
  const A = animsOf(n)[n.kind === 'beast' ? 'run' : 'held'];
  n.t += dt * A.fps;
  if ((n.screamT -= dt) <= 0) {
    n.screamT = 0.9 + Math.random() * 1.2;
    if (n.kind === 'beast') sfx.growl(); else if (n.kind === 'civ') sfx.scream(PEOPLE[n.type].voice * 1.25);
  }
  if ((n.breakT -= dt) > 0) return;
  // il se dégage d'un coup de pied et repart à l'attaque
  player.held = null; player.aiming = false; player.grabArm = false;
  if (['grab', 'throw', 'heave', 'grab1', 'throw1'].includes(player.action)) { player.action = null; player.t = 0; }
  n.held = false;
  Object.assign(n, { x: player.x + dx * 0.7, y: player.y + dy * 0.7, z: groundZ(player.x, player.y), air: true, jz: 18, vz: 60, vx: dx * 2.5, vy: dy * 2.5, state: 'hurt', hurtT: 0.6 });
  if (n.kind === 'hero') showMsg(PEOPLE[n.type].name + ' SE DEGAGE', 1.5);
  sfx.clank();
  hurtPlayer((n.kind === 'hero' ? 9 : 5) * heroMul(n), n.x, n.y, { kb: n.kind === 'hero' ? 6 : 3 });
}

// Trajectoire d'un projectile (objet ou habitant lancé) sur une image, découpée en petits pas
// pour ne rien traverser. Renvoie null tant qu'il vole, sinon ce qui l'a arrêté.
function flight(e, th, dt) {
  th.t += dt;
  e.vz -= THROW_G * dt;
  const steps = Math.max(1, Math.ceil(Math.hypot(e.vx, e.vy) * dt / 0.15)), h = dt / steps;
  for (let k = 0; k < steps; k++) {
    const nx = e.x + e.vx * h, ny = e.y + e.vy * h, nz = e.fz + e.vz * h;
    // il fauche ceux qu'il croise
    for (const o of npcs) {
      if (o === e || o.held || o.inside || o.thrown || !alive(o) || th.hit.has(o)) continue;
      if (Math.hypot(o.x - nx, o.y - ny) > 0.5 || nz - o.z - o.jz > 26 || nz < o.z - 4) continue;
      th.hit.add(o);
      const sp = Math.hypot(e.vx, e.vy) || 1;
      hitNpc(o, throwDmg(th), e.vx / sp, e.vy / sp, Math.min(1, th.power * 0.8 + th.w * 0.12));
      shake = Math.max(shake, 2 + th.w);
      if (th.w < 2.5) return { npc: o };
      e.vx *= 0.8; e.vy *= 0.8; // un arbre, un gros rocher : il continue sur sa lancée
    }
    const tx = Math.floor(nx), ty = Math.floor(ny), water = !world.walkable(tx, ty);
    const gz = water ? WATER_LINE : world.hAt(tx, ty) * 8;
    if (nz <= gz) {
      if (!water && gz - e.fz > 4) return { wall: true, x: nx, y: ny }; // le flanc d'une marche
      e.x = nx; e.y = ny; e.fz = gz;
      return { land: true, water };
    }
    if (world.solid && world.solid(tx, ty)) return { wall: true, x: nx, y: ny }; // une paroi, un mur d'intérieur
    if (obstacleAt(nx, ny, nz, { x: e.x, y: e.y, air: true })) return { wall: true, x: nx, y: ny };
    e.x = nx; e.y = ny; e.fz = nz;
  }
  return null;
}

// Ce qu'un projectile percute (arbre, rocher, mur, maison…) encaisse le coup.
function hitObstacleAt(x, y, dmg) {
  let best = null, bd = 1.3;
  for (let ty = Math.floor(y) - 1; ty <= Math.floor(y) + 1; ty++) for (let tx = Math.floor(x) - 1; tx <= Math.floor(x) + 1; tx++) {
    const info = OBJ_INFO[world.objAt(tx, ty)];
    if (!info || info.small) continue;
    let px = tx + 0.5, py = ty + 0.5;
    const a = world.anchorOf(tx, ty);
    if (a) {
      // un bâtiment : le point de son mur le plus proche
      const ai = OBJ_INFO[world.objAt(a[0], a[1])];
      if (!ai || !ai.box) continue;
      px = Math.max(a[0] - ai.box, Math.min(a[0] + ai.box, x)); py = Math.max(a[1] - ai.box, Math.min(a[1] + ai.box, y));
    }
    const d = Math.hypot(x - px, y - py);
    if (d < bd) { bd = d; best = [tx, ty]; }
  }
  if (best) damage(best[0], best[1], dmg);
  return !!best;
}

function updateThrown(dt) {
  for (let i = thrown.length - 1; i >= 0; i--) {
    const p = thrown[i];
    const ev = flight(p, p, dt);
    p.spin = Math.floor(p.t * 11 / p.w); // il tournoie, d'autant plus lentement qu'il est lourd
    if (p.burning && Math.random() < dt * 25) burst(p.x, p.y, p.fz + 8, EMBER_COLS.concat(SMOKE_COLS), 1, { up: 10, g: -4, speed: 0.3, life: 0.7, spread: 4 });
    if (Math.random() < dt * 30 && p.power > 0.2) {
      particles.push({ x: p.x, y: p.y, z: p.fz + 6, vx: -p.vx * 0.3, vy: -p.vy * 0.3, vz: 0, g: 0, drag: 3, life: 0.2, col: '#ffffff', size: 1, streak: true });
    }
    if (!ev) continue;
    thrown.splice(i, 1);
    if (ev.wall) hitObstacleAt(ev.x, ev.y, throwDmg(p));
    shatter(p, ev);
  }
}

// Fin de course d'un objet lancé (ou fracassé au sol) : il éclate, ou reste là où il tombe.
function shatter(p, ev) {
  const tx = Math.floor(p.x), ty = Math.floor(p.y), info = OBJ_INFO[p.o];
  shake = Math.max(shake, 1.5 + p.w * 1.5);
  if (ev.water) {
    fx.push({ kind: 'ripple', x: p.x, y: p.y, t: 0 }, { kind: 'ripple', x: p.x, y: p.y, t: -0.2 });
    burst(p.x, p.y, WATER_LINE, WATER_COLS, 10 + p.w * 8, { up: 60 + p.w * 15, speed: 1.2, g: 160, life: 0.7, spread: 0 });
    sfx.splash(Math.min(1, 0.4 + p.w * 0.25));
    return;
  }
  const z = ev.land ? world.hAt(tx, ty) * 8 : p.fz;
  if (ev.land) {
    // ce qui est dessous prend tout : un arbre ou un gros rocher écrase
    for (const n of npcs) {
      if (n.inside || n.held || n.thrown || !alive(n) || p.hit.has(n)) continue;
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d > 0.45 + p.w * 0.15) continue;
      if (p.w >= 2.5 && !tough(n)) killNpc(n, true);
      else hitNpc(n, throwDmg(p), (n.x - p.x) / (d || 1), (n.y - p.y) / (d || 1), 0.5);
    }
    crackTile(tx, ty, p.w >= 2.5 ? 2 : 1);
    burst(p.x, p.y, z, DUST_COLS, 6 + p.w * 6, { up: 25, speed: 1.6 + p.w * 0.5, g: 60, life: 0.6, spread: 1 });
    if (OBJ_INFO[world.objAt(tx, ty)]?.small) damage(tx, ty, 1); // l'herbe, les fleurs écrasées
  }
  const free = ev.land && world.objAt(tx, ty) === O.NONE;
  if (p.burning || p.o === O.LANTERN) oilSplash(tx, ty); // ce qui brûlait (ou l'huile) met le feu là où ça tombe
  if (info.burnt) {
    sfx.rockBreak();
    burst(p.x, p.y, z + 6, ['#2a201c', '#45362e', '#120d0c'].concat(SMOKE_COLS), 20, { up: 50, speed: 2 });
    if (free) world.setObj(tx, ty, O.BURNT);
  } else if (p.tree) {
    sfx.treeCrash();
    windT = Math.max(windT, 1);
    burst(p.x, p.y, z + 8, leafColsFor(p.o), 30, { leaf: true, up: 30, g: 30, life: 1.6, spread: 12 });
    if (free) world.setObj(tx, ty, O.LOG); // il ne reste que le tronc
  } else if (info.rock) {
    sfx.rockBreak();
    burst(p.x, p.y, z + 4, ROCK_COLS, 18 + p.w * 6, { up: 60, speed: 2.2, big: 0.6 });
    if (free) world.setObj(tx, ty, p.o === O.ROCK_L ? O.ROCK : O.PEBBLES); // il se fend en retombant
  } else if (info.wood) {
    if (free) { world.setObj(tx, ty, p.o); sfx.land(true); } else { sfx.rockBreak(); burst(p.x, p.y, z + 3, WOOD_COLS, 14, { up: 60, speed: 2 }); }
  } else {
    // tonneau, caisse, foin, lanterne : ça éclate
    sfx.propBreak(info.prop);
    burst(p.x, p.y, z + 6, PROP_COLS[info.prop], 18, { up: 55, speed: 2.2, big: 0.5 });
    if (info.prop === 'barrel') burst(p.x, p.y, z + 4, ['#7a2232', '#5a1a26', '#a8433f'], 14, { up: 35, speed: 1.8 });
    if (info.prop === 'lantern') burst(p.x, p.y, z + 8, ['#ffd77a', '#fff0b8', '#ffffff'], 10, { up: 30, speed: 1.4, life: 0.5 });
    if (free && info.next) world.setObj(tx, ty, info.next);
    if (DROPS[p.o]) spawnDrops(p.x, p.y, DROPS[p.o]);
  }
}

// Habitant ou animal lancé. Renvoie 'fly' tant qu'il vole, 'land' à l'atterrissage, 'gone' s'il coule.
function flyNpc(n, dt) {
  const th = n.thrown;
  const ev = flight(n, th, dt);
  n.z = groundZ(n.x, n.y);
  n.jz = Math.max(0, n.fz - n.z);
  n.rot = Math.floor(th.t * 10 / th.w); // il vole cul par-dessus tête
  if (!ev) return 'fly';
  const dmg = throwDmg(th);
  if (ev.npc || ev.wall) {
    // il percute quelqu'un ou quelque chose et retombe là
    if (ev.wall && !th.walled) { th.walled = true; hitObstacleAt(ev.x, ev.y, dmg); }
    sfx.bodyHit(n.kind === 'knight', th.power > 0.5);
    burst(n.x, n.y, n.fz, BLOOD_COLS, 5, { up: 30, speed: 1.2, life: 0.5 });
    if (alive(n) && !tough(n) && th.power > 0.3) n.dying = true;
    n.vx *= ev.wall ? -0.25 : 0.35; n.vy *= ev.wall ? -0.25 : 0.35;
    return 'fly';
  }
  n.thrown = null; n.rot = 0; n.air = false; n.jz = 0; n.vz = 0; n.vx *= 0.2; n.vy *= 0.2;
  if (ev.water) {
    // à l'eau : il coule
    fx.push({ kind: 'ripple', x: n.x, y: n.y, t: 0 });
    burst(n.x, n.y, WATER_LINE, WATER_COLS, 14, { up: 70, speed: 1.2, g: 160, life: 0.7, spread: 0 });
    sfx.splash(0.8);
    if (alive(n)) { killNpc(n, false); bloods.pop(); } // pas de flaque sur l'eau
    if (player.eating === n) player.eating = null;
    return 'gone';
  }
  shake = Math.max(shake, 2 + th.power * 3);
  burst(n.x, n.y, n.z, DUST_COLS, 10, { up: 25, speed: 1.8, g: 60, life: 0.6, spread: 1 });
  if (n.kind === 'knight') sfx.knightDown(); else sfx.bodyHit(false, th.power > 0.5);
  // il retombe sur quelqu'un : les deux encaissent
  for (const o of npcs) {
    if (o === n || o.inside || o.held || o.thrown || !alive(o) || th.hit.has(o) || Math.hypot(o.x - n.x, o.y - n.y) > 0.55) continue;
    hitNpc(o, Math.ceil(dmg * 0.6), o.x - n.x, o.y - n.y, 0.35);
  }
  if (!alive(n)) burst(n.x, n.y, n.z + 2, BLOOD_COLS, 10, { up: 30, speed: 1.4 });
  else if (n.dying) killNpc(n, false);
  if (n.burnT > 0) ignite(Math.floor(n.x), Math.floor(n.y), 4); // une torche vivante qui retombe
  return 'land';
}

// Il soulève sa charge encore plus haut et la fracasse au sol juste devant lui.
function doHeave() {
  const h = player.held;
  if (!h) return;
  const [dx, dy] = dirWorld(player.dir);
  let x = player.x + dx * 0.8, y = player.y + dy * 0.8;
  if (overlapping(x, y)) { x = player.x + dx * 0.3; y = player.y + dy * 0.3; }
  const gz = groundZ(x, y);
  player.held = null;
  sfx.slam(0.2 + h.w * 0.1);
  shake = Math.max(shake, 4 + h.w * 2);
  rumble(0.6, 150);
  fx.push({ kind: 'ring', x, y, z: gz, t: 0, r: 1.1 + h.w * 0.3 });
  burst(x, y, gz, DUST_COLS, 16 + h.w * 6, { up: 35, speed: 2.4, g: 70, life: 0.8, spread: 1 });
  crackTile(Math.floor(x), Math.floor(y), 2);
  if (h.n) {
    const n = h.n;
    Object.assign(n, { held: false, x, y, z: gz, jz: 0, air: false, rot: 0, vx: 0, vy: 0 });
    if (alive(n)) {
      if (tough(n)) { n.state = 'hurt'; hitNpc(n, 6 * strength(), dx, dy, 0.6); } // un héros en forme encaisse
      else killNpc(n, false);
    } else {
      burst(x, y, gz + 2, BLOOD_COLS, 14, { up: 40, speed: 1.6 });
      sfx.splat();
    }
  } else shatter({ o: h.o, tree: h.tree, burning: h.burning, w: h.w, x, y, fz: gz, power: 0.6, hit: new Set() }, { land: true, water: !world.walkable(Math.floor(x), Math.floor(y)) });
  // l'onde bouscule ceux qui sont tout près
  for (const n of npcs) {
    const rx = n.x - x, ry = n.y - y, d = Math.hypot(rx, ry);
    if (n === h.n || n.inside || n.held || !alive(n) || d > 1.3) continue;
    hitNpc(n, 2 * strength(), rx / (d || 1), ry / (d || 1), 0.4);
  }
}

// ---------------------------------------------------------------- dérapages
const SLIDE = { skid: { dur: 0.62, v0: 6.2 }, brake: { dur: 0.5, v0: 5.8 } };
const decals = []; // traces au sol

function startSlide(kind, newDir) {
  const [vx, vy] = player.mv;
  player.spd = kind === 'skid' ? 2 : 0;
  player.trans = null;
  player.quad = kind === 'skid'; // demi-tour : il reste à quatre pattes
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
  const R = mut('eyes') ? 5 : 3; // YEUX DE CHASSEUR : il flaire plus loin
  for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
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
  if (realm) { showMsg('AUCUNE ODEUR ICI', 2, 'SORS POUR FLAIRER DES PROIES'); return; }
  const p = nearestPrey();
  if (!p) { showMsg('RIEN A FLAIRER...', 2.5); return; }
  scent = { v: p.v, t: mut('eyes') ? 25 : 12 };
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

// Tension pour la musique : des chevaliers ou des héros à ses trousses, un village en alerte.
function dangerLevel() {
  let d = 0;
  for (const n of npcs) {
    if (!alive(n) || n.inside || Math.hypot(n.x - player.x, n.y - player.y) > 12) continue;
    if (n.kind === 'hero' && n.state !== 'guard' && n.state !== 'wander') d += 0.6;
    else if (n.kind === 'knight' && ['chase', 'attack', 'hurt'].includes(n.state)) d += 0.3;
    else if (n.kind === 'beast' && n.state === 'charge') d += 0.25;
  }
  if (curVillage && alarmed(curVillage.id)) d += 0.35;
  return Math.min(1, d);
}

function darkness() {
  if (realm) return realm.kind === 'den' ? 0.7 : 0.3; // sous terre il fait noir, dedans pénombre
  return outsideDark();
}
// la nuit dehors (même quand il est dedans) : 0 en plein jour, 1 en pleine nuit
function outsideDark() {
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
  const camX = build ? isoX(build.cx, build.cy) : isoX(player.x, player.y), camY = (build ? isoY(build.cx, build.cy) - build.cz : isoY(player.x, player.y) - player.z) - 14;
  const ox = Math.round(VW / 2 - camX + sk[0]), oy = Math.round(VH / 2 - camY + sk[1]);
  if (build) { build.ox = ox; build.oy = oy; }

  ctx.fillStyle = realm ? '#06050b' : '#163a6a'; // dedans, le noir autour
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
    if (n.inside || n.held) continue;
    const r = Math.floor(n.x + 0.35) + Math.floor(n.y + 0.35);
    let l = npcRows.get(r);
    if (!l) npcRows.set(r, l = []);
    l.push(n);
  }
  for (const d of drops) {
    const r = Math.floor(d.x + 0.35) + Math.floor(d.y + 0.35);
    let l = npcRows.get(r);
    if (!l) npcRows.set(r, l = []);
    l.push({ drop: d, x: d.x, y: d.y });
  }
  for (const b of birds) {
    if (b.h > 4) continue;
    const r = Math.floor(b.x + 0.35) + Math.floor(b.y + 0.35);
    let l = npcRows.get(r);
    if (!l) npcRows.set(r, l = []);
    l.push({ bird: b, x: b.x, y: b.y });
  }
  for (const p of thrown) {
    const r = Math.floor(p.x + 0.35) + Math.floor(p.y + 0.35);
    let l = npcRows.get(r);
    if (!l) npcRows.set(r, l = []);
    l.push(p);
  }
  const fireRows = new Map();
  for (const f of fires.values()) {
    const r = f.x + f.y;
    let l = fireRows.get(r);
    if (!l) fireRows.set(r, l = []);
    l.push(f);
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
      } else if (t !== T.VOID) {
        const h = world.hAt(x, y);
        const top = sy - h * 8;
        ctx.drawImage(block(t, h, v), sx - 16, top);
        if (lowerAt(x - 1, y, h)) ctx.drawImage(rimImgs[0], sx - 16, top);
        if (lowerAt(x, y - 1, h)) ctx.drawImage(rimImgs[1], sx - 16, top);
        if (lowerAt(x + 1, y, h)) ctx.drawImage(rimImgs[2], sx - 16, top);
        if (lowerAt(x, y + 1, h)) ctx.drawImage(rimImgs[3], sx - 16, top);
        const w = world.wearAt(x, y);
        if (w) { const c = crackImgs[crackMat(t)][w - 1][(x * 7 + y * 13) & 3]; draw(c, sx - c.ox, top - c.oy); }
        if (build) buildCell(x, y, sx, top);
      }
      const o = world.objAt(x, y);
      // un bâtiment passe avant tout ce qui est sur sa rangée (c'est devant lui)
      if (o && (o < O.PART_W || o > O.PART_NW)) {
        rowEnts.push({ o, x, y, sx, sy, depth: OBJ_INFO[o] && OBJ_INFO[o].building ? d - 0.5 : x + y + 1 - (o === O.CAGE ? 0.3 : 0), bld: !!(OBJ_INFO[o] && OBJ_INFO[o].building) });
        if (o === O.CAGE) rowEnts.push({ o: 'cageFront', x, y, sx, sy, depth: x + y + 1.06, bld: false }); // les barreaux de devant, par-dessus le prisonnier
      }
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
    if (d === pRow && mode === 'play' && !build) rowEnts.push({ player: true, mx: player.x, my: player.y, depth: player.x + player.y });
    const rn = npcRows.get(d);
    const rf = fireRows.get(d);
    if (rf) for (const f of rf) rowEnts.push({ fire: f, depth: f.bld ? d - 0.45 : d + 1.05 }); // juste devant ce qui brûle
    if (rn) for (const n of rn) rowEnts.push(n.bird ? { bird: n.bird, mx: n.x, my: n.y, depth: n.x + n.y } : n.drop ? { drop: n.drop, mx: n.x, my: n.y, depth: n.x + n.y } : n.o ? { thrown: n, mx: n.x, my: n.y, depth: n.x + n.y } : { npc: n, mx: n.x, my: n.y, depth: n.x + n.y });
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
        else if (e.thrown) drawThrown(e.thrown, ox, oy);
        else if (e.fire) drawFire(e.fire, ox, oy);
        else if (e.drop) drawDrop(e.drop, ox, oy);
        else if (e.bird) drawBird(e.bird, ox, oy);
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
  if (player.aiming && player.held) drawThrowAim(ox, oy);
  if (mode === 'play' && !overlayOpen() && !build) drawPlaceGhost(ox, oy);
  // Brainless visible en transparence derrière les arbres
  if (mode === 'play' && !build) {
    ctx.globalAlpha = 0.28;
    drawPlayer(ox, oy, 0);
    ctx.globalAlpha = 1;
  }

  drawFlyers(ox, oy, false);
  for (const b of birds) if (b.h > 4) drawBird(b, ox, oy);
  if (!realm) drawWeather(Math.min(0.05, time - lastRender));
  lastRender = time;
  drawSky();
  drawGlows();
  drawFireGlow();
  if (weather.flash > 0) {
    ctx.fillStyle = `rgba(235,240,255,${weather.flash * 0.45})`;
    ctx.fillRect(0, 0, VW, VH);
  }
  drawFlyers(ox, oy, true);
  if (mode !== 'play') return;
  drawFade();
  if (realmFade > 0) { ctx.fillStyle = `rgba(6,5,11,${Math.min(1, realmFade * 1.4)})`; ctx.fillRect(0, 0, VW, VH); }
  if (build) {
    // le fantôme par-dessus tout, puis l'écran BÂTIR à la place du HUD
    drawBuildGhost(ox, oy);
    drawBuildUI();
    return;
  }
  drawHUD();
  drawOverlay();
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
  if (!player.dead && !player.sleep) return;
  const t = player.dead ? player.dead.t : player.sleep.t + 1.6; // dans le nid : il s'endort puis se réveille
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
    if (jz > 2) ctx.drawImage(shadows.s, sx - shadows.s.ox, sy - shadows.s.oy); // cadavre lancé
    drawTurned(im, sx, sy - jz, n.rot || 0);
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
  drawTurned(img, sx, sy - jz, n.rot || 0);
  ctx.globalAlpha = 1;
  if (n.flash > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.7;
    drawTurned(img, sx, sy - jz, n.rot || 0);
    ctx.restore();
  }
  if (n.burnT > 0) drawFlame(1, sx + 1, sy - jz - 4, n.x * 7 | 0, Math.min(1, n.burnT));
  if (n.bucket && n.state === 'bucket') {
    // son seau d'eau, au bout du bras
    const bx = sx + 3, by = sy - jz - 10;
    ctx.fillStyle = '#3a2a1c'; ctx.fillRect(bx - 1, by - 1, 5, 5);
    ctx.fillStyle = '#7a5a3a'; ctx.fillRect(bx, by, 3, 3);
    ctx.fillStyle = '#5fa8e0'; ctx.fillRect(bx, by, 3, 1);
  }
  if (n.state === 'ko' && !n.air) {
    // des étoiles qui tournent au-dessus de sa tête
    ctx.fillStyle = '#ffe28a';
    for (let i = 0; i < 3; i++) {
      const a = time * 5 + i * 2.1;
      ctx.fillRect(Math.round(sx + Math.cos(a) * 6), Math.round(sy - 9 + Math.sin(a) * 2), 1, 1);
    }
  }
  if (n.kind === 'hero' && (n.state !== 'guard' || Math.hypot(n.x - player.x, n.y - player.y) < (n.boss ? 10 : 6))) {
    // nom et barre de vie du héros (le champion : en or, couronné, barre plus longue)
    const name = (n.boss ? 'CHAMPION ' : '') + PEOPLE[n.type].name, w = n.boss ? 34 : 22, y = sy - jz - 44;
    drawText(ctx, name, Math.round(sx - textWidth(name) / 2), y - 7, n.boss ? '#ffd23f' : '#ffe28a');
    if (n.boss) {
      ctx.fillStyle = '#e0b23a'; ctx.fillRect(sx - 4, y - 12, 9, 3);
      ctx.fillStyle = '#ffe07a'; ctx.fillRect(sx - 4, y - 14, 1, 2); ctx.fillRect(sx, y - 15, 1, 3); ctx.fillRect(sx + 4, y - 14, 1, 2);
    }
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
  const frames = objFrames(e.o);
  if (!frames) return;
  if (season === 3 && e.o >= O.FLOWER_R && e.o <= O.FLOWER_W) return; // pas de fleurs sous la neige
  const info = OBJ_INFO[e.o] || {};
  const rk = info.rot && objRot[e.o] ? world.rotAt(e.x, e.y) : 0; // quart de tour d'une construction
  const h = e.o === O.LILY ? -3 / 8 : world.hAt(e.x, e.y);
  // un bâtiment est centré sur le coin commun de ses 4 tuiles, les autres objets au centre de leur tuile
  let gx = e.sx, gy = e.sy + (info.building ? 0 : 8) - h * 8;
  const st = hits.get(e.x + ',' + e.y);
  if (placedFx.size && info.built) {
    const p0 = placedFx.get(e.x + ',' + e.y);
    if (p0 !== undefined) { const u = (rt() - p0) / 0.25; if (u >= 1) placedFx.delete(e.x + ',' + e.y); else gy -= Math.round((1 - u) * (1 - u) * 14); }
  }
  if (st && st.shake > 0) gx += Math.round(Math.sin(time * 70) * 2 * st.shake / 0.35);
  if (info.tree) ctx.drawImage(shadows.l, gx - shadows.l.ox, gy - shadows.l.oy);
  else if (info.solid) ctx.drawImage(shadows.m, gx - shadows.m.ox, gy - shadows.m.oy);
  let f = 0;
  if (frames.length > 1) {
    const ph = hash(e.x, e.y, 1) * 10;
    const wave = Math.max(0, Math.sin(time * 0.5 + e.x * 0.15 + e.y * 0.1)) * 0.9; // une rafale qui traverse le monde
    f = Math.floor(swayT * (info.tree ? 1.3 : 1.8) + ph + wave) % frames.length;
  }
  const img = rk ? objRot[e.o][rk].img : frames[f];
  draw(img, gx - img.ox, gy - img.oy);
  if (e.o === O.RACK) { const T0 = world.racks.get(e.x + ',' + e.y); if (T0) T0.forEach((id, i) => ctx.drawImage(icons[id], gx - 13 + (i & 1) * 13, gy - 24 + (i >> 1) * 10)); }
  const gl = rk ? objRot[e.o][rk].glow : objGlow[e.o];
  if (gl && darkness() > 0.15) glows.push({ img: gl, x: gx - gl.ox, y: gy - gl.oy, behind: !playerDrawn, halo: e.o === O.LANTERN, hx: gx + 3, hy: gy - 15 });
  // feu de camp et torche : une vraie flamme qui danse
  if (e.o === O.CAMPFIRE) { drawFlame(1, gx, gy - 1, e.x + e.y); drawFlame(0, gx - 3, gy + 1, e.x * 3); }
  else if (e.o === O.TORCH) drawFlame(0, gx, gy - 16, e.x + e.y, 0.9);
  // à l'automne, des feuilles rousses tombent des chênes
  if (season === 2 && info.tree && e.o !== O.PINE && e.o !== O.PINE_L && e.o !== O.SNOW_PINE && Math.random() < 0.012 && particles.length < 300) {
    burst(e.x + 0.5, e.y + 0.5, h * 8 + 24, AUTUMN_COLS, 1, { leaf: true, up: 0, g: 10, life: 3, spread: 10, speed: 0.6, drag: 0.3 });
  }
  // pétales qui tombent des cerisiers (au printemps)
  if (e.o === O.CHERRY && season === 0 && Math.random() < 0.03 && particles.length < 300) {
    burst(e.x + 0.5, e.y + 0.5, h * 8 + 26, CHERRY_COLS, 1, { leaf: true, up: 0, g: 10, life: 3, spread: 10, speed: 0.6, drag: 0.3 });
  }
}

function drawPlayer(ox, oy, withShadow) {
  if (baking) return; // ses sprites sont en train d'être recuits
  const sx = ox + Math.round(isoX(player.x, player.y));
  const sy = oy + Math.round(isoY(player.x, player.y));
  const gz = Math.round(player.z);
  const jz = Math.round(player.jz);
  if (withShadow && !player.water) {
    const sh = player.jz > 12 ? shadows.m : shadows.p;
    ctx.drawImage(sh, sx - sh.ox, sy - gz - sh.oy);
  }
  let img, an, fi;
  if (player.dead) {
    img = nomu.down[player.dir][Math.min(ANIMS.down.frames - 1, Math.floor(player.dead.t * ANIMS.down.fps))];
  } else if (player.air) {
    // image du saut choisie selon la vitesse verticale : décollage -> sommet -> réception
    const u = Math.max(0, Math.min(0.999, (1 - player.vz / JUMP_V) / 2));
    an = player.held ? (oneHand() ? 'carryJump1' : 'carryJump') : 'jump';
    fi = Math.floor(u * ANIMS[an].frames);
    img = nomu[an][player.dir][fi];
  } else if (player.action) {
    const A = ANIMS[player.action];
    const f = Math.min(A.frames - 1, Math.floor(player.actionT * A.frames));
    an = player.action; fi = f;
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
    an = player.anim; fi = Math.floor(player.t) % A.frames;
    img = nomu[player.anim][player.dir][fi];
  }
  const px = sx - img.ox, py = sy - gz - jz - img.oy;
  // ce qu'il porte : derrière lui si ses mains sont basses et dans son dos, devant sinon
  let hp = null;
  if (player.held) {
    // la table de l'anim jouée, sinon la pose de port (heave : à deux mains, même pour une prise légère)
    let key = an, f = fi;
    if (!holdPts[key] || (key !== 'heave' && HOLD1_ANIMS.includes(key) !== oneHand())) { key = oneHand() ? 'carry1' : 'carry'; f = 0; }
    hp = { ...holdPts[key][player.dir][f], one: HOLD1_ANIMS.includes(key), run: ['run1', 'drop1', 'rise1', 'skid', 'brake'].includes(key), gy: sy - gz };
    if (hp.depth < -1.5 && hp.z < 44) { drawHeld(sx + hp.x, sy - gz - jz + hp.y, hp); hp = null; }
  }
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
    if (hp) drawHeld(sx + hp.x, sy - gz - jz + hp.y, hp);
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
  if (hp) drawHeld(sx + hp.x, sy - gz - jz + hp.y, hp);
  if (player.flash > 0 && withShadow) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.6;
    draw(img, px, py);
    ctx.restore();
  }
  if (player.burnT > 0 && withShadow) {
    drawFlame(1, sx - 4, sy - gz - jz - 8, 1);
    drawFlame(1, sx + 4, sy - gz - jz - 16, 3);
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

// Ce qu'il porte, dessiné au point (hx, hy) entre ses mains. `g` : 0 = mains basses (il vient de
// l'empoigner, il le tient par le milieu), 1 = au-dessus de sa tête (posé sur ses paumes).
// Un arbre, ou un habitant qui se débat, passe en travers au-dessus de sa tête.
function drawHeld(hx, hy, hp) {
  const h = player.held, g = Math.max(0, Math.min(1, (hp.z - 26) / 20));
  const side = Math.cos(player.dir * Math.PI / 4) >= -0.01 ? 1 : 3; // la tête (ou la cime) du côté où il regarde
  let img, rot = 0, grip = 0.4;
  if (h.n) {
    const n = h.n, struggling = alive(n) && n.state !== 'ko';
    if (n.kind === 'beast') img = peopleImgs[n.type][struggling ? 'run' : n.anim === 'crushed' ? 'crushed' : 'dead'][n.dir][struggling ? Math.floor(n.t) % BEAST_ANIMS.run.frames : 0];
    else if (struggling) { img = peopleImgs[n.type].held[n.dir][Math.floor(n.t) % 6]; if (g > 0.5) rot = side; }
    else img = peopleImgs[n.type][n.anim === 'crushed' ? 'crushed' : n.anim === 'dead' ? 'dead' : 'ko'][n.dir][0];
  } else {
    img = objSprites[h.o][0];
    if (h.tree) { if (g > 0.5) rot = side; else grip = 0.1; } // déraciné : il le tient par le pied du tronc
  }
  if (hp.one) {
    // à une main : pendu à ses doigts par le col (ou l'anse), sans jamais traîner par terre ;
    // en galop, un habitant qui gigote est traîné à l'horizontale
    rot = h.n && h.n.kind !== 'beast' && alive(h.n) && h.n.state !== 'ko' && hp.run ? side : 0;
    const hgt1 = rot & 1 ? img.w : img.h;
    const cy1 = Math.min(hy + hgt1 / 2 - 3, hp.gy - 1 - hgt1 / 2 + (hp.run ? 3 : 0));
    drawCentered(img, hx, cy1, rot);
    if (h.burning || (h.n && h.n.burnT > 0)) drawFlame(1, hx, Math.round(cy1 - 2), 5);
    if (h.n && h.n.flash > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6; drawCentered(img, hx, cy1, rot); ctx.restore(); }
    return;
  }
  const hgt = rot & 1 ? img.w : img.h;
  const cy = hy - (g * (hgt / 2 + 1) + (1 - g) * (0.5 - grip) * hgt); // levé : tout entier au-dessus de ses doigts
  if (!h.n && h.tree && !rot) draw(img, Math.round(hx - img.ox), Math.round(hy + 4 - img.oy));
  else drawCentered(img, hx, cy, rot);
  if (h.burning || (h.n && h.n.burnT > 0)) drawFlame(rot & 1 ? 2 : 1, hx, Math.round(cy - 2), 5);
  if (h.n && h.n.flash > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6; drawCentered(img, hx, cy, rot); ctx.restore(); }
}

// Objet en vol : son ombre au sol, et lui qui tournoie.
function drawThrown(p, ox, oy) {
  const sx = ox + Math.round(isoX(p.x, p.y)), sy = oy + Math.round(isoY(p.x, p.y));
  const gz = groundZ(p.x, p.y), sh = p.w >= 2.5 ? shadows.m : shadows.s;
  ctx.drawImage(sh, sx - sh.ox, sy - Math.round(gz) - sh.oy);
  const img = objSprites[p.o][0];
  drawCentered(img, sx, sy - Math.round(p.fz) - (img.h >> 1) * 0.6, (p.tree ? 1 : 0) + p.spin);
  if (p.burning) drawFlame(p.tree ? 2 : 1, sx, sy - Math.round(p.fz), 2);
}

// Visée du lancer : la trajectoire en pointillés et le point de chute, qui s'allongent avec la force.
const THROW_COLS = ['#fff3b0', '#ffb347', '#ff5a5a'];
function drawThrowAim(ox, oy) {
  const [ux, uy] = aimDir(), pow = 0.3 + 0.7 * player.throwPow;
  const { v, vz: vz0 } = throwSpeed(pow, player.held.w);
  let x = player.x + ux * 0.35, y = player.y + uy * 0.35, z = player.z + HOLD_Z, vz = vz0, gz = 0;
  const st = 1 / 30, march = Math.floor(time * 12) % 3, col = THROW_COLS[Math.min(2, Math.floor(player.throwPow * 3))];
  for (let i = 0; i < 120; i++) {
    x += ux * v * st; y += uy * v * st; vz -= THROW_G * st; z += vz * st;
    gz = groundZ(x, y);
    if (z <= gz) break;
    if (i % 3 !== march || i < 3) continue;
    const px = Math.round(ox + isoX(x, y)), py = Math.round(oy + isoY(x, y) - z);
    ctx.fillStyle = '#1a0e08'; ctx.fillRect(px - 1, py - 1, 4, 4);
    ctx.fillStyle = col; ctx.fillRect(px, py, 2, 2);
  }
  // le point de chute : un losange en tirets qui pulse
  const cx = Math.round(ox + isoX(x, y)), cy = Math.round(oy + isoY(x, y) - gz), r = 7 + Math.sin(time * 10) * 1.5;
  for (let i = 0; i < 24; i++) {
    if (i % 3 === 2) continue;
    const a = i / 24 * Math.PI * 2 + time * 2;
    const px = Math.round(cx + Math.cos(a) * r), py = Math.round(cy + Math.sin(a) * r * 0.5);
    ctx.fillStyle = '#1a0e08'; ctx.fillRect(px, py + 1, 1, 1);
    ctx.fillStyle = col; ctx.fillRect(px, py, 1, 1);
  }
  ctx.fillStyle = '#ff2e63'; ctx.fillRect(cx - 1, cy, 3, 1); ctx.fillRect(cx, cy - 1, 1, 3);
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
  if (f.kind === 'spark') {
    // éclair d'impact d'un poing de la rafale : une étoile blanche à cœur, branches dorées
    if (f.t < 0) return;
    const sx = Math.round(ox + isoX(f.x, f.y)), sy = Math.round(oy + isoY(f.x, f.y) - f.z);
    const k = f.t < 0.06 ? 3 : 2;
    ctx.fillStyle = '#ffe28a';
    ctx.fillRect(sx - k, sy, k * 2 + 1, 1);
    ctx.fillRect(sx, sy - k, 1, k * 2 + 1);
    if (f.t < 0.06) { ctx.fillRect(sx - 1, sy - 1, 1, 1); ctx.fillRect(sx + 1, sy - 1, 1, 1); ctx.fillRect(sx - 1, sy + 1, 1, 1); ctx.fillRect(sx + 1, sy + 1, 1, 1); }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx - 1, sy, 3, 1);
    ctx.fillRect(sx, sy - 1, 1, 3);
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

// ---------------------------------------------------------------- carte et succès
// La carte (onglet du sac) ne montre que les morceaux du monde déjà parcourus, vus d'en haut dans le
// même sens que le jeu (losanges). Villages, ses abris et lui-même y sont marqués.
const explored = new Set(); // morceaux de 32x32 tuiles déjà vus (sauvé)
let exploreT = 0;
function updateExplore(dt) {
  if (realm || (exploreT -= dt) > 0) return;
  exploreT = 1;
  const cx = Math.floor(player.x) >> 5, cy = Math.floor(player.y) >> 5;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) explored.add((cx + dx) + ',' + (cy + dy));
}
const MAP_COLS = {
  [T.WATER]: [42, 102, 166], [T.DEEP]: [29, 75, 130], [T.SAND]: [223, 201, 138], [T.GRASS]: [92, 158, 63], [T.FOREST]: [60, 117, 51],
  [T.STONE]: [135, 140, 150], [T.SNOW]: [227, 234, 241], [T.MEADOW]: [111, 179, 74], [T.PATH]: [148, 112, 74], [T.DIRT]: [102, 67, 48], [T.COBBLE]: [127, 120, 108],
};
// monde -> point de la carte (losanges : comme l'écran, en petit) et l'inverse
const mapPos = (M, x, y) => [M.w / 2 + ((x - M.cx) - (y - M.cy)) / M.z, M.h / 2 + ((x - M.cx) + (y - M.cy)) / 2 / M.z];
function mapImage(M) {
  const c = document.createElement('canvas');
  c.width = M.w; c.height = M.h;
  const g = c.getContext('2d'), id = g.createImageData(M.w, M.h), d = id.data, S = surface;
  for (let py = 0; py < M.h; py++) for (let px = 0; px < M.w; px++) {
    const ix = (px - M.w / 2) * M.z, iy = (py - M.h / 2) * M.z;
    const x = Math.floor(M.cx + (ix + 2 * iy) / 2), y = Math.floor(M.cy + (2 * iy - ix) / 2), o = (py * M.w + px) * 4;
    d[o + 3] = 255;
    if (!explored.has((x >> 5) + ',' + (y >> 5))) { const k = (px ^ py) & 1 ? 30 : 24; d[o] = k; d[o + 1] = k - 6; d[o + 2] = k + 10; continue; } // pas encore vu
    const t = S.typeAt(x, y), ob = OBJ_INFO[S.objAt(x, y)];
    let col = MAP_COLS[t] || [80, 70, 60];
    if (season === 3 && (t === T.GRASS || t === T.FOREST || t === T.MEADOW)) col = [214, 224, 234];
    if (ob && ob.tree) col = season === 2 ? [190, 110, 40] : season === 3 ? [110, 84, 64] : [36, 86, 44];
    else if (ob && (ob.building || ob.part)) col = ob.built ? [224, 178, 58] : [168, 81, 58];
    else if (ob && ob.tilebox) col = [110, 110, 118];
    const k = S.walkable(x, y) ? 0.82 + Math.min(6, S.hAt(x, y)) * 0.06 : 1;
    d[o] = Math.min(255, col[0] * k); d[o + 1] = Math.min(255, col[1] * k); d[o + 2] = Math.min(255, col[2] * k);
  }
  g.putImageData(id, 0, 0);
  return c;
}
function drawMapTab(px, py) {
  const U = invUI;
  if (!U.map) U.map = { cx: realm ? realm.out[0] : player.x, cy: realm ? realm.out[1] : player.y, z: 2, w: PW - 12, h: PH - 36, img: null, key: '' };
  const M = U.map, mx = px + 6, my = py + 14;
  ink('CARTE - ' + SEASONS[season], px + 8, py + 5);
  const key = [Math.round(M.cx), Math.round(M.cy), M.z, explored.size, season].join();
  if (M.key !== key) { M.img = mapImage(M); M.key = key; }
  mcSlot(mx - 1, my - 1, M.w + 2);
  ctx.drawImage(M.img, mx, my);
  ctx.save();
  ctx.beginPath(); ctx.rect(mx, my, M.w, M.h); ctx.clip();
  const mark = (x, y, draw0) => { const [a, b] = mapPos(M, x, y); draw0(Math.round(mx + a), Math.round(my + b)); };
  // les villages déjà vus (les plus grands d'abord ; un nom qui en chevaucherait un autre est omis)
  const labels = [];
  for (const v of [...surface.villages.values()].filter(Boolean).sort((a, b) => b.kind - a.kind)) {
    if (!explored.has((v.cx >> 5) + ',' + (v.cy >> 5))) continue;
    mark(v.cx, v.cy, (x, y) => {
      ctx.fillStyle = '#000000'; ctx.fillRect(x - 3, y - 3, 7, 6);
      ctx.fillStyle = v.kind === 3 ? '#c4c6cb' : '#e8d8b0';
      for (let i = 0; i < 3; i++) ctx.fillRect(x - i, y - 2 + i, 1 + 2 * i, 1);
      ctx.fillRect(x - 2, y + 1, 5, 1);
      const w = textWidth(v.name), r = { x: x - Math.round(w / 2), y: y + 4, w, h: 6 };
      if (labels.some((o) => r.x < o.x + o.w + 2 && o.x < r.x + r.w + 2 && r.y < o.y + o.h && o.y < r.y + r.h)) return;
      labels.push(r);
      drawText(ctx, v.name, r.x, r.y, v.kind === 3 ? '#ffe28a' : '#ffffff', '#000000');
    });
  }
  // ses abris
  for (const [k, o] of surface.mods) {
    if (o !== O.HUT && o !== O.LAIR) continue;
    const [x, y] = k.split(',').map(Number);
    mark(x, y, (a, b) => { ctx.fillStyle = '#000000'; ctx.fillRect(a - 3, b - 3, 7, 7); ctx.fillStyle = o === O.HUT ? '#e0b23a' : '#9a6d45'; ctx.fillRect(a - 2, b - 2, 5, 5); ctx.fillStyle = o === O.HUT ? '#22276b' : '#0a081a'; ctx.fillRect(a - 1, b, 3, 2); });
  }
  // l'expédition qui le traque
  if (!realm) for (const n of npcs) if (n.exp && alive(n)) mark(n.x, n.y, (a, b) => { ctx.fillStyle = '#ff2e3e'; ctx.fillRect(a - 1, b - 1, 2, 2); });
  // lui (il clignote)
  const [lx, ly] = realm ? realm.out : [player.x, player.y];
  if (Math.floor(rt() * 3) % 3) mark(lx, ly, (a, b) => { ctx.fillStyle = '#000000'; ctx.fillRect(a - 2, b - 2, 5, 5); ctx.fillStyle = '#ff5a5e'; ctx.fillRect(a - 1, b - 1, 3, 3); });
  ctx.restore();
  hit(mx, my, M.w, M.h, () => {}); // la carte se glisse au doigt (voir overlayDown)
  const by = my + M.h + 4;
  mcButton(mx, by, 18, 13, '-', M.z < 8, () => { M.z *= 2; });
  mcButton(mx + 20, by, 18, 13, '+', M.z > 1, () => { M.z /= 2; });
  mcButton(mx + 40, by, 30, 13, 'ICI', true, () => { M.cx = lx; M.cy = ly; });
  ink('GLISSE POUR BOUGER', mx + 76, by + 4, '#5a5a5a');
}

// Les succès : vérifiés toutes les 2 s, annoncés un par un, sauvés avec le monde.
const ACHIEVEMENTS = [
  { id: 'meal', name: 'PREMIER REPAS', desc: 'DEVORER UNE PROIE', ok: () => stats.eaten >= 1 },
  { id: 'lumber', name: 'BUCHERON', desc: 'ABATTRE 50 ARBRES', ok: () => stats.trees >= 50 },
  { id: 'wreck', name: 'DEMOLISSEUR', desc: 'RASER 10 MAISONS', ok: () => stats.houses >= 10 },
  { id: 'plague', name: 'FLEAU', desc: 'FAIRE 100 VICTIMES', ok: () => stats.victims + stats.knights >= 100 },
  { id: 'heroes', name: 'MANGEUR DE HEROS', desc: 'DEVORER 5 HEROS', ok: () => stats.heroes >= 5 },
  { id: 'champion', name: 'CHAMPION DECHU', desc: "TERRASSER UN CHAMPION", ok: () => stats.champions >= 1 },
  { id: 'builder', name: 'BATISSEUR', desc: 'POSER 50 CONSTRUCTIONS', ok: () => stats.built >= 50 },
  { id: 'digger', name: 'FOUISSEUR', desc: 'CREUSER 200 PAROIS', ok: () => stats.dug >= 200 },
  { id: 'jailer', name: 'GEOLIER', desc: 'ENCAGER UN PRISONNIER', ok: () => stats.caged >= 1 },
  { id: 'siege', name: 'INEBRANLABLE', desc: 'REPOUSSER UNE EXPEDITION', ok: () => stats.expWon >= 1 },
  { id: 'lvl10', name: 'EVOLUE', desc: 'ATTEINDRE LE NIVEAU 10', ok: () => player.level >= 10 },
  { id: 'mutant', name: 'MUTANT', desc: 'AVOIR 10 MUTATIONS', ok: () => player.muts.length >= 10 },
  { id: 'quake', name: 'SEISME', desc: '100 FRAPPES AU SOL', ok: () => stats.smash >= 100 },
  { id: 'year', name: 'QUATRE SAISONS', desc: 'VIVRE UNE ANNEE ENTIERE', ok: () => stats.play >= SEASON_LEN * 4 },
  { id: 'trophy', name: 'COLLECTIONNEUR', desc: 'EXPOSER 5 TROPHEES', ok: () => player.trophies >= 5 },
  { id: 'fossil', name: 'ARCHEOLOGUE', desc: 'TROUVER UN ANCIEN NOMU', ok: () => stats.fossils >= 1 },
];
let achT = 0;
function updateAchievements(dt) {
  if ((achT -= dt) > 0) return;
  achT = 2;
  const a = ACHIEVEMENTS.find((x) => !player.achieved.includes(x.id) && x.ok());
  if (!a) return;
  player.achieved.push(a.id);
  showMsg('SUCCES : ' + a.name, 4, a.desc);
  sfx.mutate();
  burst(player.x, player.y, player.z + 30, ['#ffe07a', '#e0b23a', '#ffffff'], 30, { up: 50, speed: 1.6, life: 1 });
}
function drawAchTab(px, py) {
  const U = invUI, per = 8, pages = Math.ceil(ACHIEVEMENTS.length / per);
  U.achPage = Math.min(U.achPage || 0, pages - 1);
  ink('SUCCES ' + player.achieved.length + '/' + ACHIEVEMENTS.length, px + 8, py + 5);
  ACHIEVEMENTS.slice(U.achPage * per, U.achPage * per + per).forEach((a, i) => {
    const x = px + 6, y = py + 14 + i * 16, got = player.achieved.includes(a.id);
    mcSlot(x, y, 15, got ? '#c9a24a' : MC.slot);
    ctx.fillStyle = got ? '#fff3b0' : '#5a5a5a';
    if (got) { for (const [dx, dy] of [[7, 3], [6, 5], [7, 5], [8, 5], [4, 6], [5, 6], [9, 6], [10, 6], [5, 7], [9, 7], [6, 8], [8, 8], [5, 10], [9, 10], [6, 9], [7, 9], [8, 9]]) ctx.fillRect(x + dx, y + dy, 1, 1); } // étoile
    else { ctx.fillRect(x + 5, y + 7, 5, 4); ctx.fillRect(x + 6, y + 4, 1, 3); ctx.fillRect(x + 8, y + 4, 1, 3); ctx.fillRect(x + 6, y + 4, 3, 1); } // cadenas
    ink(a.name, x + 19, y + 2, got ? '#2a2a2a' : '#6a6a6a');
    ink(a.desc, x + 19, y + 9, '#7a7a7a');
  });
  if (pages > 1) {
    mcButton(px + PW - 46, py + PH - 18, 18, 13, '<', U.achPage > 0, () => { U.achPage--; });
    mcButton(px + PW - 25, py + PH - 18, 18, 13, '>', U.achPage < pages - 1, () => { U.achPage++; });
    ink((U.achPage + 1) + '/' + pages, px + PW - 66, py + PH - 14, '#5a5a5a');
  }
}

// ---------------------------------------------------------------- oiseaux
// Des petites volées posées dans l'herbe, qui picorent et sautillent. Quand Brainless approche en
// courant, frappe ou rugit, toute la volée s'envole d'un coup et s'éloigne.
const birds = [];
const BIRD_KINDS = [
  { body: '#6b4a2a', belly: '#b08a5a', head: '#4a3020' }, // moineau
  { body: '#26262e', belly: '#3a3a46', head: '#16161c' }, // corbeau
  { body: '#c9b440', belly: '#ecdc84', head: '#3a5a9a' }, // mésange
];
let flockId = 0;
function updateBirds(dt) {
  if (realm) { birds.length = 0; return; }
  for (let i = birds.length - 1; i >= 0; i--) {
    const b = birds[i];
    if (Math.hypot(b.x - player.x, b.y - player.y) > 20 || b.h > 90) birds.splice(i, 1);
  }
  // une volée se pose de temps en temps, le jour, dans l'herbe autour de lui
  if (darkness() < 0.5 && birds.length < 14 && Math.random() < dt * 0.2) {
    const a = Math.random() * Math.PI * 2, r = 7 + Math.random() * 6;
    const cx = player.x + Math.cos(a) * r, cy = player.y + Math.sin(a) * r, t = world.typeAt(Math.floor(cx), Math.floor(cy));
    const oi = OBJ_INFO[world.objAt(Math.floor(cx), Math.floor(cy))];
    if ((t === T.GRASS || t === T.MEADOW || t === T.FOREST || t === T.PATH || t === T.DIRT || t === T.SNOW) && !(oi && !oi.small)) {
      const kind = BIRD_KINDS[season === 3 ? 1 : (Math.random() * 3) | 0], n = 3 + ((Math.random() * 4) | 0), id = ++flockId;
      for (let k = 0; k < n; k++) birds.push({ x: cx + (Math.random() - 0.5) * 1.6, y: cy + (Math.random() - 0.5) * 1.6, h: 0, fly: false, flock: id, kind,
        t: Math.random() * 5, side: Math.random() < 0.5 ? -1 : 1, vx: 0, vy: 0, vz: 0 });
    }
  }
  const loud = shake > 2.2 || windT > 0.4;
  for (const b of birds) {
    b.t += dt;
    if (!b.fly) {
      const d = Math.hypot(b.x - player.x, b.y - player.y);
      if (d < (player.spd > 3 ? 4.5 : 1.8) || (loud && d < 14)) {
        // la volée entière s'envole, chacun dans une direction un peu différente
        for (const o of birds) {
          if (o.flock !== b.flock || o.fly) continue;
          const ang = Math.atan2(o.y - player.y, o.x - player.x) + (Math.random() - 0.5) * 1.2, sp = 3 + Math.random() * 2;
          Object.assign(o, { fly: true, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, vz: 16 + Math.random() * 10, t: Math.random() });
          o.side = Math.cos(ang) - Math.sin(ang) < 0 ? -1 : 1;
        }
        sfx.flap();
      } else if (Math.random() < dt * 0.4) { b.x += (Math.random() - 0.5) * 0.25; b.y += (Math.random() - 0.5) * 0.25; b.side = -b.side; } // un petit saut
    } else {
      b.x += b.vx * dt; b.y += b.vy * dt; b.h += b.vz * dt;
      b.vz = Math.min(40, b.vz + dt * 8);
    }
  }
}
function drawBird(b, ox, oy) {
  const sx = Math.round(ox + isoX(b.x, b.y)), gy = oy + isoY(b.x, b.y) - groundZ(b.x, b.y), sy = Math.round(gy - b.h), K = b.kind;
  ctx.globalAlpha = Math.max(0.1, 0.25 - b.h / 300);
  ctx.fillStyle = '#0a1412'; ctx.fillRect(sx - 1, Math.round(gy), 3, 1); // son ombre
  ctx.globalAlpha = Math.min(1, (90 - b.h) / 20);
  if (!b.fly) {
    const peck = (b.t % 1.7) < 0.3; // il picore
    ctx.fillStyle = K.body; ctx.fillRect(sx - 1, sy - 2, 3, 1);
    ctx.fillStyle = K.belly; ctx.fillRect(sx - 1, sy - 1, 3, 1);
    ctx.fillStyle = K.head; ctx.fillRect(sx + b.side * 2, sy - (peck ? 1 : 3), 1, 1);
    ctx.fillStyle = '#e0b23a'; ctx.fillRect(sx + b.side * 3, sy - (peck ? 0 : 3), 1, 1);
    ctx.fillStyle = K.body; ctx.fillRect(sx - b.side * 2, sy - 2, 1, 1); // la queue
  } else {
    const up = Math.floor(b.t * 14) % 2;
    ctx.fillStyle = K.body; ctx.fillRect(sx - 1, sy, 3, 1);
    ctx.fillStyle = K.head; ctx.fillRect(sx + b.side * 2, sy - 1, 1, 1);
    ctx.fillStyle = K.body;
    if (up) { ctx.fillRect(sx - 3, sy - 2, 1, 1); ctx.fillRect(sx - 2, sy - 1, 1, 1); ctx.fillRect(sx + 2, sy - 1, 1, 1); ctx.fillRect(sx + 3, sy - 2, 1, 1); }
    else { ctx.fillRect(sx - 3, sy + 1, 1, 1); ctx.fillRect(sx - 2, sy + 1, 1, 1); ctx.fillRect(sx + 2, sy + 1, 1, 1); ctx.fillRect(sx + 3, sy + 1, 1, 1); }
  }
  ctx.globalAlpha = 1;
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
  if (realm) c = realm.kind === 'den' ? [150, 134, 168] : [226, 206, 182]; // tanière bleutée, intérieur chaud
  else for (let i = 0; i < SKY.length - 1; i++) {
    if (tod >= SKY[i][0] && tod <= SKY[i + 1][0]) {
      const u = (tod - SKY[i][0]) / (SKY[i + 1][0] - SKY[i][0]);
      c = SKY[i][1].map((v, j) => Math.round(v + (SKY[i + 1][1][j] - v) * u));
      break;
    }
  }
  // ciel couvert : un peu plus sombre et plus bleu
  const k = realm ? 0 : weather.cloud;
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

// Note de musique : blanche = musique du jeu, verte = ma musique (Spotify…), barrée = aucune.
function drawMusicButton() {
  musicBtn.x = VW - 52 - safe.r;
  musicBtn.y = 11 + safe.t;
  const x = musicBtn.x - 5, y = musicBtn.y - 4, m = musicMode();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x - 3, y - 3, 17, 14);
  ctx.fillStyle = m === 'mine' ? '#7ee08a' : '#ffffff';
  // double croche pixel
  ctx.fillRect(x + 3, y, 6, 1); ctx.fillRect(x + 3, y + 1, 6, 1);
  ctx.fillRect(x + 3, y + 2, 1, 4); ctx.fillRect(x + 8, y + 2, 1, 4);
  ctx.fillRect(x + 1, y + 5, 3, 2); ctx.fillRect(x + 6, y + 5, 3, 2);
  if (m === 'mine') { ctx.fillRect(x + 10, y + 6, 1, 2); ctx.fillRect(x + 9, y + 7, 1, 1); } // petit « + » : sa musique à lui
  if (m === 'off') {
    ctx.fillStyle = '#ff5a5e';
    for (let i = 0; i < 9; i++) ctx.fillRect(x + 1 + i, y + i - 1, 1, 1);
  }
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
  touch: ['JOYSTICK A FOND: IL COURT', 'MAINTIENS B POUR CHARGER', 'SPRINT: MAINTIENS >> EN MARCHANT', 'N: FLAIRER LA VIANDE FRAICHE', 'P: PRENDRE, P: LANCER (MAINTENIR = VISER)', 'SAC EN HAUT A DROITE, BARRE: TOUCHE 2 FOIS = UTILISER', 'DANS TA TANIERE, LE MARTEAU: BATIR'],
  keys: ['ZQSD: COURIR  C: MARCHER  MAJ: SPRINT  ESPACE: SAUT', 'J/CLIC: COUP (MAINTENIR = CHARGE)', 'K/CLIC DROIT: FRAPPE AU SOL  R: FLAIRER', 'L/CLIC MOLETTE: PRENDRE, LANCER (MAINTENIR = VISER)', 'I/TAB: SAC  V: CARTE  1-9: BARRE  T: UTILISER  B: BATIR (TANIERE)', 'F: PLEIN ECRAN  N: MUSIQUE'],
  pad: ['STICK: MARCHER, A FOND: COURIR  B/R2: SPRINT  A: SAUT', 'X: COUP (MAINTENIR = CHARGE)', 'Y: FRAPPE AU SOL  L1: FLAIRER', 'R1: PRENDRE, LANCER (MAINTENIR = VISER)', 'CROIX: BARRE, HAUT = UTILISER, BAS = SAC', 'R3: BATIR (TANIERE)  SELECT: SON'],
};

function drawHUD() {
  layoutButtons();
  const x0 = 6 + safe.l, y0 = 6 + safe.t;
  drawText(ctx, 'BRAINLESS', x0, y0, '#f6a6bd');
  drawText(ctx, 'NIV ' + player.level, x0 + 40, y0, '#c9a0ff');
  buttons.n.sub = player.nearCorpse ? 'DEVORER' : player.interact ? interactLabel(player.interact) : 'FLAIR';
  buttons.g.sub = player.held ? 'LANCER' : 'PRENDRE';
  buttons.a.sub = player.held ? 'ECRASER' : 'COUP';
  const night = outsideDark() > 0.5;
  drawText(ctx, (night ? 'NUIT' : 'JOUR') + ' - ' + SEASONS[season] + '  ARBRES ' + stats.trees + '  MAISONS ' + stats.houses + '  VICTIMES ' + (stats.victims + stats.knights), x0, y0 + 8, '#e8f0ff');
  drawSprintBar(x0, y0 + 17);
  drawHpBar(x0, y0 + 26);
  drawHungerBar(x0, y0 + 35);
  if (player.infamy >= 3) {
    // la menace : quand la barre est pleine, une expédition part
    const k = Math.min(1, player.infamy / EXP_AT), w = 50;
    drawText(ctx, 'MENACE', x0, y0 + 44, expedition ? '#ff5a5e' : '#ff9aa8');
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x0 + 27, y0 + 45, w + 2, 4);
    ctx.fillStyle = expedition && Math.floor(rt() * 3) % 2 ? '#ffffff' : '#d22838'; ctx.fillRect(x0 + 28, y0 + 46, Math.round(w * k), 2);
  }
  if (player.equip.some(Boolean)) drawText(ctx, 'ALTERS: ' + player.equip.filter(Boolean).map((a) => ALTERS[a].name + (player.alterLv[a] > 1 ? ' ' + player.alterLv[a] : '')).join(' '), x0, y0 + (player.infamy >= 3 ? 53 : 44), '#c9a0ff');
  drawHotbar();
  drawBagButton();
  drawBuildButton();
  drawMapButton();
  drawScent();
  drawExpedition();
  drawMuteButton();
  drawMusicButton();
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
  for (const k of ['a', 'b', 'j', 's', 'n', 'g']) {
    const b = buttons[k];
    const img = ui[k];
    const press = held(k) ? 1 : 0;
    ctx.drawImage(img, b.x - img.ox, b.y - img.oy + press);
    drawText(ctx, b.label, Math.round(b.x - textWidth(b.label) / 2), b.y - 2 + press, '#ffffff');
    drawText(ctx, b.sub, Math.round(b.x - textWidth(b.sub) / 2), b.y + b.r + 3, '#ffffff');
  }
}

// ---------------------------------------------------------------- boucle
let last = 0, saveT = 0, errT = -99;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  // l'image suivante est demandée d'abord : une erreur ne fige plus jamais le jeu
  requestAnimationFrame(frame);
  try {
    if (mode === 'play') {
      if (build) updateBuild(dt); // mode BÂTIR : le monde est figé, la caméra libre
      else if (overlayOpen()) overlayPad(dt); // sac ou choix de mutation ouvert : le jeu est en pause
      else if (hitstop > 0) hitstop -= dt;
      else update(dt);
    }
    else updateMenu(dt);
    render();
    saveT += dt;
    if (saveT > 4) { saveT = 0; save(); }
  } catch (e) {
    console.error(e);
    // affichée un instant (pas plus d'une fois toutes les 10 s) pour pouvoir la signaler
    if (time - errT > 10) { errT = time; showMsg('ERREUR (LE JEU CONTINUE)', 4, String(e && e.message || e).toUpperCase().slice(0, 48)); }
  }
}

// Écran d'accueil : la caméra survole lentement le monde.
function updateMenu(dt) {
  time += dt;
  advanceSway(dt);
  tod = (tod + dt / DAY_LENGTH) % 1;
  pollPad();
  menuPad(pad, dt);
  player.x += dt * 0.9; player.y -= dt * 0.35;
  player.z += (groundZ(player.x, player.y) - player.z) * Math.min(1, dt * 2);
  updateParticles(dt);
  updateFlyers(dt);
  updateMusic(dt, { night: darkness(), danger: 0, rain: 0 });
  for (let i = fx.length - 1; i >= 0; i--) if ((fx[i].t += dt) > 1.2) fx.splice(i, 1);
}

(async function start() {
  // fond de l'accueil : le dernier monde joué
  const recent = listWorlds()[0];
  if (recent) {
    world = surface = new World(recent.seed, recent.params);
    const s = loadWorldData(recent.id);
    if (s && typeof s.x === 'number') { player.x = s.x; player.y = s.y; tod = s.tod ?? tod; }
  }
  if (!recent || !player.x) { const sp = world.findSpawn(); player.x = sp.x; player.y = sp.y; }
  initMenu({ onPlay: startWorld, music: { get: musicMode, cycle: () => { unlockAudio(); return cycleMusic(); } } });
  document.addEventListener('pointerdown', unlockAudio);
  if (location.hash === '#debug') {
    window.BRAINLESS = { get world() { return world; }, player, startWorld, createWorld, listWorlds, quitToMenu, get mode() { return mode; }, stats, O, T, decals, particles, npcs, damage, hurtPlayer,
      vstate, crime, killNpc, hitNpc, nearestPrey, get scent() { return scent; },
      get tod() { return tod; }, set tod(v) { tod = v; }, weather, spawnBeast, gainEvo, has, get pages() { return atlasMain.pages.concat(atlasNomu.pages); }, blockedFor, freeSpot, OBJ_INFO, overlapping, crackTile, craterTile, doSlam, doBigPunch, doRushHit, openMutChoice, chooseMutation, openInv, addItem, useItem, get mutChoice() { return mutChoice; }, get invUI() { return invUI; }, get baking() { return baking; }, drops, fires, ignite, oilSplash, thrown, startGrab, releaseHeld, grabTarget, holdPts,
      get realm() { return realm; }, get surface() { return surface; }, enterRealm, exitRealm, enterBuilding, builtNear, openBuild, get build() { return build; }, buildPlace, buildDig, digTile, doPunchHit, builtAtScreen, birds, get season() { return season; }, interact, openTile, spawnNpc, launchExpedition, get expedition() { return expedition; }, populate, vstate, deathsOf };
  }
  await loadAssets();
  loading.style.display = 'none';
  showMenu('title');
  requestAnimationFrame((t) => { last = t; frame(t); });
})();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
