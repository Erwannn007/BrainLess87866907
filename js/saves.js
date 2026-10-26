// Mondes sauvegardés : une liste (nom, graine, paramètres) + une sauvegarde par monde.
// Tout est dans le localStorage du téléphone.
const INDEX = 'brainless-worlds';
const OLD = 'brainless-save-v1'; // l'ancienne sauvegarde unique, avant les mondes multiples
const dataKey = (id) => 'brainless-world-' + id;

// Paramètres d'un monde : 0 = peu, 1 = normal, 2 = beaucoup.
export const PARAMS = [
  { key: 'villages', label: 'VILLAGES', opts: ['RARES', 'NORMAUX', 'NOMBREUX'] },
  { key: 'heroes', label: 'HEROS', opts: ['RARES', 'NORMAUX', 'NOMBREUX'] },
  { key: 'wildlife', label: 'FAUNE', opts: ['RARE', 'NORMALE', 'ABONDANTE'] },
  { key: 'weather', label: 'METEO', opts: ['CALME', 'VARIABLE', 'ORAGEUSE'] },
  { key: 'relief', label: 'RELIEF', opts: ['DOUX', 'NORMAL', 'MONTAGNEUX'] },
  { key: 'water', label: 'EAU', opts: ['PEU', 'NORMALE', 'ARCHIPEL'] },
  { key: 'difficulty', label: 'DIFFICULTE', opts: ['FACILE', 'NORMALE', 'BRUTALE'] },
];
export const DEFAULTS = Object.fromEntries(PARAMS.map((p) => [p.key, 1]));

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
}
function write(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch (e) { return false; }
}

// Une graine tapée en texte devient un nombre (même texte = même monde).
export function seedFrom(text) {
  const t = String(text || '').trim();
  if (!t) return (Math.random() * 2147483647) | 0;
  if (/^-?\d+$/.test(t)) return Number(t) | 0;
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h | 0;
}

export function listWorlds() {
  let list = read(INDEX);
  if (!Array.isArray(list)) list = [];
  // première fois : l'ancienne partie devient un monde de la liste
  const old = read(OLD);
  if (old && !list.length) {
    const w = { id: 'w' + Date.now(), name: 'MON PREMIER MONDE', seed: 87866907, params: { ...DEFAULTS }, created: Date.now(), played: Date.now() };
    if (write(dataKey(w.id), old)) {
      list.push(w);
      write(INDEX, list);
      try { localStorage.removeItem(OLD); } catch (e) { /* tant pis */ }
    }
  }
  return list.sort((a, b) => (b.played || 0) - (a.played || 0));
}

export function createWorld(name, seed, params) {
  const list = listWorlds();
  const w = { id: 'w' + Date.now(), name: (name || 'MONDE ' + (list.length + 1)).toUpperCase().slice(0, 22), seed, params: { ...DEFAULTS, ...params }, created: Date.now(), played: Date.now() };
  list.push(w);
  write(INDEX, list);
  return w;
}

export function deleteWorld(id) {
  write(INDEX, listWorlds().filter((w) => w.id !== id));
  try { localStorage.removeItem(dataKey(id)); } catch (e) { /* tant pis */ }
}

export function touchWorld(id) {
  const list = listWorlds();
  const w = list.find((x) => x.id === id);
  if (w) { w.played = Date.now(); write(INDEX, list); }
}

export const loadWorldData = (id) => read(dataKey(id));
export const saveWorldData = (id, data) => write(dataKey(id), data);
