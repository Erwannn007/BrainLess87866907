// Passe à la version suivante : js/version.js (affichée à l'accueil) et sw.js (cache de l'iPhone).
//   node tools/bump.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const vf = new URL('js/version.js', root), sf = new URL('sw.js', root);
const v = +readFileSync(vf, 'utf8').match(/VERSION = (\d+)/)[1] + 1;
writeFileSync(vf, readFileSync(vf, 'utf8').replace(/VERSION = \d+/, 'VERSION = ' + v));
writeFileSync(sf, readFileSync(sf, 'utf8').replace(/'brainless-v\d+'/, `'brainless-v${v}'`));
console.log('version', v);
