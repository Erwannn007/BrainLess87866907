// Aperçu des sprites en PNG agrandi, pour vérifier un nouveau sprite avant de l'intégrer.
//
//   node tools/preview.mjs nomu out.png '[["idle",0,2],["run",0.25,1]]'   poses [anim, t (0..1), direction 0..7]
//   node tools/preview.mjs nomu-sheet out.png run                          une anim, toutes frames x 8 directions
//   node tools/preview.mjs nature out.png                                  tous les objets du décor + tuiles
//
// Variable K = facteur d'agrandissement (défaut 6). Ouvrir le PNG pour juger le rendu.
import { writeFileSync } from 'node:fs';
import { encodePNG, blit } from './png.mjs';
import { renderNomu, ANIMS, SPRITE_W, SPRITE_H } from '../js/nomu.js';
import * as SP from '../js/sprites.js';
import { T } from '../js/world.js';

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
console.log('écrit :', out);
