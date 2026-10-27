// Aperçu des sprites en PNG agrandi, pour vérifier un nouveau sprite avant de l'intégrer.
//
//   node tools/preview.mjs nomu out.png '[["idle",0,2],["run",0.25,1]]'   poses [anim, t (0..1), direction 0..7]
//   node tools/preview.mjs nomu-sheet out.png run                          une anim, toutes frames x 8 directions
//   node tools/preview.mjs nature out.png                                  tous les objets du décor + tuiles
//   node tools/preview.mjs people out.png                                  villageois et chevalier (poses clés) à côté de Brainless
//   node tools/preview.mjs people-sheet out.png knight attack              une anim d'un habitant x 8 directions
//   node tools/preview.mjs beasts out.png                                  la faune (poses clés)
//   node tools/preview.mjs beast-sheet out.png wolf                        une espèce (repos, marche, course, attaque) x 8 directions
//   node tools/preview.mjs village out.png                                 bâtiments (3 états), objets de village, tuiles, fissures
//
// Variable K = facteur d'agrandissement (défaut 6). Ouvrir le PNG pour juger le rendu.
import { writeFileSync } from 'node:fs';
import { encodePNG, blit } from './png.mjs';
import { renderNomu, ANIMS, SPRITE_W, SPRITE_H } from '../js/nomu.js';
import * as SP from '../js/sprites.js';
import { T } from '../js/world.js';
import { buildVillageSprites } from '../js/buildings.js';
import { renderPerson, PEOPLE, PEOPLE_ANIMS, PEOPLE_W, PEOPLE_H } from '../js/people.js';
import { renderBeast, BEASTS, BEAST_W, BEAST_H } from '../js/beasts.js';

const [mode = 'nomu', out = 'preview.png', arg] = process.argv.slice(2);
const K = +(process.env.K || 6);
const BG = [120, 170, 90];

function canvas(w, h) {
  const img = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { img[i * 4] = BG[0]; img[i * 4 + 1] = BG[1]; img[i * 4 + 2] = BG[2]; img[i * 4 + 3] = 255; }
  return img;
}

if (mode === 'nomu') {
  const list = JSON.parse(arg || '[["idle",0,2],["walk",0.25,1],["run",0.25,1],["charge",0.3,2],["jabL",0.44,1],["swim",0,1]]');
  const W = SPRITE_W * K * list.length, H = SPRITE_H * K;
  const img = canvas(W, H);
  list.forEach(([a, t, d], i) => blit(img, W, renderNomu(a, t, d), i * SPRITE_W * K, 0, K));
  writeFileSync(out, encodePNG(W, H, img));
} else if (mode === 'nomu-sheet') {
  const anim = arg || 'walk', n = ANIMS[anim].frames, k = Math.min(K, 3);
  const W = SPRITE_W * n * k, H = SPRITE_H * 8 * k;
  const img = canvas(W, H);
  for (let d = 0; d < 8; d++) for (let f = 0; f < n; f++) blit(img, W, renderNomu(anim, f / n, d), f * SPRITE_W * k, d * SPRITE_H * k, k);
  writeFileSync(out, encodePNG(W, H, img));
} else if (mode === 'nature') {
  const k = Math.min(K, 4);
  const objs = SP.buildObjectSprites();
  const W = 1200, rowH = 80 * k;
  const ids = Object.keys(objs);
  let x = 0, y = 0;
  const pos = ids.map((id) => {
    const s = objs[id][0];
    if (x + s.w * k > W) { x = 0; y += rowH; }
    const p = [x, y];
    x += s.w * k;
    return p;
  });
  const H = y + rowH + 60 * k;
  const img = canvas(W, H);
  ids.forEach((id, i) => blit(img, W, objs[id][0], pos[i][0], pos[i][1], k));
  let bx = 0;
  for (const t of [T.GRASS, T.FOREST, T.MEADOW, T.SAND, T.STONE, T.SNOW]) { blit(img, W, SP.blockBuffer(t, 2, 0), bx, y + rowH, 3); bx += 100; }
  blit(img, W, SP.waterBuffer(false, 0, 0), bx, y + rowH, 3);
  blit(img, W, SP.waterBuffer(true, 1, 0), bx + 100, y + rowH, 3);
  writeFileSync(out, encodePNG(W, H, img));
}
if (mode === 'people') {
  const k = Math.min(K, 4);
  const cols = { civ: [['idle', 0, 2], ['idle', 0, 1], ['walk', 0.25, 1], ['walk', 0.25, 6], ['flee', 0.25, 3], ['wave', 0.25, 2], ['ko', 0, 2]],
    knight: [['idle', 0, 2], ['idle', 0, 1], ['walk', 0.25, 1], ['run', 0.25, 6], ['attack', 0.35, 3], ['attack', 0.55, 3], ['hurt', 0, 2], ['ko', 0, 2]],
    hero: [['idle', 0, 2], ['idle', 0, 1], ['run', 0.25, 1], ['attack', 0.5, 3], ['special', 0.3, 1], ['special', 0.6, 3], ['hurt', 0, 2], ['dead', 0, 2]] };
  const types = Object.keys(PEOPLE);
  const W = (8 * PEOPLE_W + SPRITE_W) * k, H = Math.max(types.length * PEOPLE_H, SPRITE_H) * k;
  const img = canvas(W, H);
  types.forEach((type, r) => cols[PEOPLE[type].kind].forEach(([a, t, d], c) => blit(img, W, renderPerson(type, a, t, d), c * PEOPLE_W * k, r * PEOPLE_H * k, k)));
  blit(img, W, renderNomu('idle', 0, 2), 8 * PEOPLE_W * k, 0, k);
  writeFileSync(out, encodePNG(W, H, img));
} else if (mode === 'people-sheet') {
  const [type = 'knight', anim = 'walk'] = [arg, process.argv[5]];
  const n = PEOPLE_ANIMS[PEOPLE[type].kind][anim].frames, k = Math.min(K, 4);
  const W = PEOPLE_W * n * k, H = PEOPLE_H * 8 * k;
  const img = canvas(W, H);
  for (let d = 0; d < 8; d++) for (let f = 0; f < n; f++) blit(img, W, renderPerson(type, anim, f / n, d), f * PEOPLE_W * k, d * PEOPLE_H * k, k);
  writeFileSync(out, encodePNG(W, H, img));
}
if (mode === 'beasts') {
  const k = Math.min(K, 4);
  const cols = [['idle', 0, 2], ['idle', 0, 1], ['walk', 0.25, 1], ['run', 0.2, 6], ['run', 0.6, 3], ['attack', 0.5, 1], ['dead', 0, 2], ['crushed', 0, 2]];
  const types = Object.keys(BEASTS), W = BEAST_W * cols.length * k, H = BEAST_H * types.length * k;
  const img = canvas(W, H);
  types.forEach((t, r) => cols.forEach(([a, tt, d], c) => blit(img, W, renderBeast(t, a, tt, d), c * BEAST_W * k, r * BEAST_H * k, k)));
  writeFileSync(out, encodePNG(W, H, img));
}
if (mode === 'beast-sheet') {
  // une espèce : idle, marche et course x 8 directions
  const type = arg || 'wolf', k = Math.min(K, 4);
  const cols = [['idle', 0], ['walk', 0.25], ['run', 0.2], ['run', 0.6], ['attack', 0.5]];
  const W = BEAST_W * cols.length * k, H = BEAST_H * 8 * k;
  const img = canvas(W, H);
  for (let d = 0; d < 8; d++) cols.forEach(([a, t], c) => blit(img, W, renderBeast(type, a, t, d), c * BEAST_W * k, d * BEAST_H * k, k));
  writeFileSync(out, encodePNG(W, H, img));
}
if (mode === 'village') {
  const k = Math.min(K, 3);
  const S = buildVillageSprites();
  const ids = Object.keys(S);
  const W = 1500;
  let x = 0, y = 0, rowH = 0;
  const pos = ids.map((id) => {
    const s = S[id][0].img;
    if (x + s.w * k > W) { x = 0; y += rowH + 8; rowH = 0; }
    const p = [x, y];
    x += s.w * k + 6; rowH = Math.max(rowH, s.h * k);
    return p;
  });
  const top = y + rowH + 10;
  const H = top + 80 * k;
  const img = canvas(W, H);
  ids.forEach((id, i) => blit(img, W, S[id][0].img, pos[i][0], pos[i][1], k));
  let bx = 0;
  for (const t of [T.PATH, T.DIRT, T.COBBLE, T.GRASS]) { blit(img, W, SP.blockBuffer(t, 1, 0), bx, top, k); bx += 34 * k; }
  for (const m of ['earth', 'sand', 'stone', 'snow']) {
    for (let l = 1; l <= 3; l++) {
      const base = SP.blockBuffer(m === 'earth' ? T.GRASS : m === 'sand' ? T.SAND : m === 'stone' ? T.STONE : T.SNOW, 1, 0);
      blit(img, W, base, bx, top, k);
      blit(img, W, SP.crackBuffer(m, l, 1), bx, top, k);
      bx += 34 * k;
      if (bx > W - 34 * k) break;
    }
  }
  writeFileSync(out, encodePNG(W, H, img));
}
console.log('écrit :', out);
