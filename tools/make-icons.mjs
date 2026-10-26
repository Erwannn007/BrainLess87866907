// Génère les icônes de l'écran d'accueil à partir du vrai sprite de Brainless.
// Usage : node tools/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { encodePNG, blit } from './png.mjs';
import { renderNomu } from '../js/nomu.js';

const B = 64;
const base = new Uint8ClampedArray(B * B * 4);
for (let y = 0; y < B; y++) {
  for (let x = 0; x < B; x++) {
    const o = (y * B + x) * 4;
    const d = Math.hypot(x - 32, y - 30) / 45;
    const bayer = ((x & 1) * 2 + (y & 1)) / 4;
    const k = Math.min(1, d + bayer * 0.12);
    // ciel nocturne violet -> bas vert forêt
    const ground = y > 50;
    base[o] = ground ? 40 - k * 20 : 70 - k * 50;
    base[o + 1] = ground ? 92 - k * 40 : 46 - k * 30;
    base[o + 2] = ground ? 46 - k * 20 : 110 - k * 70;
    base[o + 3] = 255;
  }
}
const nomu = renderNomu('idle', 0.25, 2, { w: B, h: B + 40, ox: 32, oy: 96, scale: 1.75 });
blit(base, B, nomu, 0, 0, 1);

for (const size of [180, 192, 512]) {
  const img = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const so = (((y * B / size) | 0) * B + ((x * B / size) | 0)) * 4;
      const o = (y * size + x) * 4;
      img[o] = base[so]; img[o + 1] = base[so + 1]; img[o + 2] = base[so + 2]; img[o + 3] = 255;
    }
  }
  writeFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url), encodePNG(size, size, img));
}
console.log('icônes générées');
