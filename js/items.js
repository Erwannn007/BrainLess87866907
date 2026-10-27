// Objets de l'inventaire : matériaux, nourriture, trophées, et constructions à poser.
// Chaque icône (12x12) est dessinée pixel par pixel au lancement, contour sel-out comme le reste.
import { hex, makeBuffer, outlineBuffer } from './raster.js';
import { O } from './world.js';

// kind : 'mat' matériau, 'food' (food = faim rendue, hp = vie), 'trophy', 'place' (obj = ce qu'on pose)
export const ITEMS = {
  wood: { name: 'BOIS', kind: 'mat' },
  stone: { name: 'PIERRE', kind: 'mat' },
  straw: { name: 'PAILLE', kind: 'mat' },
  iron: { name: 'FER', kind: 'mat' },
  meat: { name: 'VIANDE CRUE', kind: 'food', food: 18, hp: 0 },
  steak: { name: 'VIANDE CUITE', kind: 'food', food: 40, hp: 20 },
  berries: { name: 'BAIES', kind: 'food', food: 6, hp: 0 },
  helmet: { name: 'CASQUE', kind: 'trophy' },
  shield: { name: 'BOUCLIER', kind: 'trophy' },
  emblem: { name: 'EMBLEME DE HEROS', kind: 'trophy' },
  wallWood: { name: 'MUR DE BOIS', kind: 'place', obj: O.WALL_WOOD },
  wallStone: { name: 'MUR DE PIERRE', kind: 'place', obj: O.WALL_STONE },
  fence: { name: 'PALISSADE', kind: 'place', obj: O.FENCE_X },
  spikes: { name: 'PIEGE A PIQUES', kind: 'place', obj: O.SPIKES },
  campfire: { name: 'FEU DE CAMP', kind: 'place', obj: O.CAMPFIRE },
  torch: { name: 'TORCHE', kind: 'place', obj: O.TORCH },
  chest: { name: 'COFFRE', kind: 'place', obj: O.CHEST },
  nest: { name: 'NID', kind: 'place', obj: O.NEST },
};
export const STACK = 64;

// Ce qu'on fabrique (onglet FABRIQUER) : `need` = matériaux consommés, `n` = combien on en obtient.
export const RECIPES = [
  { out: 'wallWood', n: 1, need: { wood: 4 }, desc: 'BLOQUE LE PASSAGE' },
  { out: 'wallStone', n: 1, need: { stone: 4 }, desc: 'PLUS SOLIDE' },
  { out: 'fence', n: 2, need: { wood: 2 }, desc: 'CLOTURE BASSE' },
  { out: 'spikes', n: 1, need: { wood: 2, iron: 1 }, desc: 'BLESSE CEUX QUI MARCHENT DESSUS' },
  { out: 'torch', n: 2, need: { wood: 1, straw: 1 }, desc: 'ECLAIRE LA NUIT' },
  { out: 'campfire', n: 1, need: { wood: 3, stone: 2 }, desc: 'N: CUIRE LA VIANDE' },
  { out: 'chest', n: 1, need: { wood: 6 }, desc: 'N: RANGER DES OBJETS' },
  { out: 'nest', n: 1, need: { straw: 8, wood: 4 }, desc: 'N: DORMIR, SE REVEILLER ICI' },
];

// Ce que rapporte ce qu'on casse : objet du décor -> [item, combien].
export const DROPS = {
  [O.OAK_S]: [['wood', 2]], [O.OAK_M]: [['wood', 3]], [O.OAK_L]: [['wood', 4]], [O.PINE]: [['wood', 3]], [O.PINE_L]: [['wood', 4]],
  [O.SNOW_PINE]: [['wood', 3]], [O.CHERRY]: [['wood', 3]], [O.BURNT]: [['wood', 1]], [O.STUMP]: [['wood', 1]], [O.LOG]: [['wood', 2]],
  [O.ROCK]: [['stone', 2]], [O.ROCK_L]: [['stone', 4]], [O.ROCK_MOSS]: [['stone', 2]], [O.BERRY]: [['berries', 3]],
  [O.CRATE]: [['wood', 2]], [O.BARREL]: [['wood', 1], ['iron', 1]], [O.HAY]: [['straw', 3]], [O.STALL]: [['wood', 2]],
  [O.FENCE_X]: [['wood', 1]], [O.FENCE_Y]: [['wood', 1]], [O.PLANKS]: [['wood', 1]], [O.LANTERN]: [['iron', 1]],
  [O.WELL]: [['stone', 3]], [O.WALL]: [['stone', 3]], [O.WALL_TOWER]: [['stone', 4]],
  [O.WALL_WOOD]: [['wood', 2]], [O.WALL_STONE]: [['stone', 2]], [O.SPIKES]: [['wood', 1]], [O.CAMPFIRE]: [['stone', 1]],
  [O.TORCH]: [['wood', 1]], [O.CHEST]: [['wood', 3]], [O.NEST]: [['straw', 4]],
};

// ---------------------------------------------------------------- icônes
const C = (h) => hex(h);
function icon(draw) {
  const b = makeBuffer(12, 12);
  draw((x, y, c) => b.set(x, y, typeof c === 'string' ? C(c) : c));
  return outlineBuffer(b, 0.35);
}
const fillRect = (p, x0, y0, w, h, c) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) p(x, y, c); };
const disc = (p, cx, cy, r, cols) => {
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
    if (d > r) continue;
    p(x, y, cols[d > r - 1 ? 0 : dx + dy < -r * 0.4 ? 3 : dx + dy > r * 0.5 ? 1 : 2]);
  }
};
const flame = (p, cx, y0) => {
  p(cx, y0, '#ffd23f'); p(cx - 1, y0 + 1, '#ff9a3c'); p(cx, y0 + 1, '#fff3b0'); p(cx + 1, y0 + 1, '#ff9a3c');
  p(cx - 1, y0 + 2, '#ff5a2a'); p(cx, y0 + 2, '#ffd23f'); p(cx + 1, y0 + 2, '#ff5a2a');
};
const WOODC = ['#3d2614', '#5e3d22', '#86593a', '#a87a52'];
const STONEC = ['#3f434b', '#5e636e', '#808590', '#a7acb5'];
const STRAWC = ['#6e5420', '#a3812f', '#cfa94a', '#ead37a'];
const IRONC = ['#2a2e36', '#5a606e', '#9aa2b2', '#dfe5ee'];

const ICONS = {
  wood: (p) => {
    for (const [y0, x0] of [[2, 1], [6, 2]]) {
      fillRect(p, x0, y0, 8, 3, WOODC[2]); fillRect(p, x0, y0, 8, 1, WOODC[3]); fillRect(p, x0, y0 + 2, 8, 1, WOODC[1]);
      fillRect(p, x0 + 8, y0, 2, 3, '#c9a06a'); p(x0 + 8, y0 + 1, WOODC[1]);
    }
  },
  stone: (p) => { disc(p, 5, 7, 4.2, STONEC); disc(p, 8.5, 6, 2.6, STONEC); p(4, 6, STONEC[1]); p(6, 8, STONEC[1]); },
  straw: (p) => {
    for (let x = 2; x < 10; x++) for (let y = 2; y < 11; y++) if (Math.abs(x - 6) < 3 + Math.abs(y - 6) * 0.25) p(x, y, STRAWC[(x + y) % 3 === 0 ? 1 : x < 5 ? 3 : 2]);
    fillRect(p, 2, 6, 8, 1, '#6b4226');
  },
  iron: (p) => {
    for (let y = 4; y < 9; y++) for (let x = 1 + (8 - y) * 0.5; x < 11 - (8 - y) * 0.5; x++) p(Math.floor(x), y, IRONC[y === 4 ? 3 : y > 7 ? 1 : 2]);
    p(4, 5, IRONC[3]); p(5, 5, IRONC[3]);
  },
  meat: (p) => { disc(p, 5, 5, 3.8, ['#6e0e18', '#a01824', '#d02c36', '#ff6b6b']); fillRect(p, 7, 7, 3, 2, '#e9e4d2'); p(10, 9, '#fffdf2'); p(9, 10, '#fffdf2'); },
  steak: (p) => { disc(p, 5, 5, 3.8, ['#3e1e0c', '#6b3a18', '#9a5a2a', '#c98a4a']); fillRect(p, 7, 7, 3, 2, '#e9e4d2'); p(10, 9, '#fffdf2'); p(9, 10, '#fffdf2'); p(4, 4, '#e0b060'); },
  berries: (p) => {
    for (const [cx, cy] of [[4, 7], [7.5, 7.5], [5.8, 4.5]]) disc(p, cx, cy, 2, ['#5e0a14', '#a8162a', '#e8283c', '#ff8a8a']);
    p(6, 2, '#2d6a33'); p(7, 1, '#4a923d'); p(8, 2, '#2d6a33');
  },
  helmet: (p) => {
    for (let y = 2; y < 10; y++) for (let x = 2; x < 10; x++) if (Math.hypot(x - 5.5, (y - 6) * 1.1) < 4.2) p(x, y, IRONC[x < 5 ? 3 : x > 7 ? 1 : 2]);
    fillRect(p, 3, 6, 6, 1, '#14141a'); p(5, 1, '#d02c36'); p(6, 1, '#ff5a5e'); p(6, 0, '#d02c36');
  },
  shield: (p) => {
    for (let y = 1; y < 11; y++) for (let x = 2; x < 10; x++) if (Math.abs(x - 5.5) < 4 - Math.max(0, y - 6) * 0.8) p(x, y, x < 5 ? '#5078b4' : '#355a94');
    fillRect(p, 5, 2, 1, 7, '#e0b23a'); fillRect(p, 3, 4, 5, 1, '#e0b23a');
  },
  emblem: (p) => {
    disc(p, 6, 6, 4.6, ['#6b4a10', '#b0851e', '#e0b23a', '#ffe07a']);
    for (const [x, y] of [[6, 3], [5, 5], [6, 5], [7, 5], [4, 6], [8, 6], [5, 7], [7, 7]]) p(x, y, '#fff6d8');
  },
  wallWood: (p) => {
    for (let i = 0; i < 4; i++) { fillRect(p, 1 + i * 3, 3, 2, 8, WOODC[i & 1 ? 1 : 2]); p(1 + i * 3, 2, WOODC[3]); p(2 + i * 3, 1, WOODC[3]); }
    fillRect(p, 1, 6, 11, 1, WOODC[0]);
  },
  wallStone: (p) => {
    fillRect(p, 1, 2, 10, 9, STONEC[2]);
    for (let y = 2; y < 11; y += 3) fillRect(p, 1, y, 10, 1, STONEC[1]);
    for (const [x, y] of [[4, 3], [8, 3], [2, 6], [6, 6], [10, 6], [4, 9], [8, 9]]) fillRect(p, x, y, 1, 2, STONEC[1]);
    fillRect(p, 1, 2, 10, 1, STONEC[3]);
  },
  fence: (p) => { for (const x of [2, 9]) fillRect(p, x, 2, 2, 9, WOODC[2]); fillRect(p, 1, 4, 11, 2, WOODC[3]); fillRect(p, 1, 8, 11, 2, WOODC[1]); },
  spikes: (p) => {
    fillRect(p, 1, 9, 10, 2, WOODC[1]);
    for (let i = 0; i < 4; i++) { fillRect(p, 2 + i * 2.5, 5, 1, 4, WOODC[2]); p(2 + i * 2.5, 3, IRONC[3]); p(2 + i * 2.5, 4, IRONC[2]); }
  },
  campfire: (p) => {
    for (const x of [1, 3, 8, 10]) p(x, 10, STONEC[2]);
    for (let i = 0; i < 7; i++) { p(2 + i, 9 - Math.floor(i / 3), WOODC[2]); p(9 - i, 9 - Math.floor(i / 3), WOODC[1]); }
    flame(p, 5, 3); flame(p, 6, 2);
  },
  torch: (p) => { fillRect(p, 5, 5, 2, 7, WOODC[2]); fillRect(p, 4, 4, 4, 2, STRAWC[2]); flame(p, 5, 1); flame(p, 6, 1); },
  chest: (p) => {
    fillRect(p, 1, 3, 10, 8, WOODC[2]); fillRect(p, 1, 3, 10, 2, WOODC[3]); fillRect(p, 1, 6, 10, 1, WOODC[0]);
    fillRect(p, 5, 5, 2, 3, '#e0b23a'); fillRect(p, 1, 3, 1, 8, IRONC[1]); fillRect(p, 10, 3, 1, 8, IRONC[1]);
  },
  nest: (p) => {
    for (let y = 5; y < 11; y++) for (let x = 1; x < 11; x++) {
      const d = Math.hypot((x + 0.5 - 6) / 5, (y + 0.5 - 8) / 2.8);
      if (d < 1 && d > 0.45) p(x, y, STRAWC[(x * 3 + y) % 4]);
      else if (d <= 0.45) p(x, y, '#3a2a14');
    }
  },
};

// Icônes de tous les objets : { id: buffer 12x12 }.
export function buildIcons() {
  const out = {};
  for (const id in ITEMS) out[id] = icon(ICONS[id]);
  return out;
}
