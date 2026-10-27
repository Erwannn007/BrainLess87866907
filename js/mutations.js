// Mutations : le vrai pouvoir du Nomu. À chaque niveau, le jeu en propose 3 au hasard parmi celles
// dont les prérequis sont remplis ; on en choisit une. Rangées en 3 branches (l'arbre de l'inventaire).
// `look: true` : elle se voit sur le modèle (nomuParts lit le même nom), ses sprites sont recuits.
// `req` : il faut déjà avoir l'une de ces mutations (arbre).

export const BRANCHES = {
  brute: { name: 'BRUTE', col: '#ff6b5a', dark: '#5e1a14' },
  prey: { name: 'PREDATEUR', col: '#ffd23f', dark: '#5a4610' },
  colossus: { name: 'COLOSSE', col: '#8fb4ff', dark: '#1c2a52' },
};

export const MUTATIONS = {
  // --- BRUTE : frapper, broyer, lancer
  arms: { branch: 'brute', row: 0, name: 'BRAS DE TITAN', desc: ['AVANT-BRAS ENORMES', 'COUPS +25%'], look: true },
  thrower: { branch: 'brute', row: 0, name: 'LANCEUR', desc: ['LANCERS 40% PLUS LOIN', 'ET PLUS VIOLENTS'] },
  claws: { branch: 'brute', row: 1, name: "GRIFFES D'ACIER", desc: ['LONGUES LAMES', 'COUPS +15%, ILS SAIGNENT'], look: true, req: ['arms'] },
  fists: { branch: 'brute', row: 1, name: 'POINGS-MASSES', desc: ["JOINTURES D'OS", 'ONDE DE CHOC A CHAQUE COUP'], look: true, req: ['arms', 'thrower'] },
  spikes: { branch: 'brute', row: 2, name: "DOS D'EPINES", desc: ['QUI LE FRAPPE', 'SE BLESSE'], look: true, req: ['claws', 'fists'] },
  // --- PREDATEUR : courir, flairer, dévorer
  legs: { branch: 'prey', row: 0, name: 'PATTES DE COUREUR', desc: ['MOLLETS RAYES', 'SPRINT +25%'], look: true },
  lungs: { branch: 'prey', row: 0, name: 'POUMONS', desc: ['ENDURANCE', 'DU SPRINT +50%'] },
  jaw: { branch: 'prey', row: 1, name: 'MACHOIRE BEANTE', desc: ['DEVORE 2 FOIS PLUS VITE', 'ET REPREND DE LA VIE'], look: true, req: ['legs', 'lungs'] },
  eyes: { branch: 'prey', row: 1, name: 'YEUX DE CHASSEUR', desc: ['YEUX ROUGES', 'FLAIR PLUS LONG ET PLUS LOIN'], look: true, req: ['legs', 'lungs'] },
  stomach: { branch: 'prey', row: 2, name: 'ESTOMAC', desc: ['LA FAIM DESCEND', '40% MOINS VITE'], req: ['jaw'] },
  tail: { branch: 'prey', row: 2, name: 'QUEUE', desc: ['LE 3E COUP FAIT', 'UN BALAYAGE AUTOUR'], look: true, req: ['legs'] },
  // --- COLOSSE : encaisser, durer
  carapace: { branch: 'colossus', row: 0, name: 'CARAPACE', desc: ["PLAQUES D'OS", 'DEGATS -25%'], look: true },
  hams: { branch: 'colossus', row: 0, name: 'JARRETS', desc: ['SAUT +35%'] },
  brain: { branch: 'colossus', row: 1, name: 'CERVEAU HYPERTROPHIE', desc: ['REGENERATION 2 FOIS', 'PLUS FORTE ET PLUS TOT'], look: true, req: ['carapace', 'hams'] },
  fireproof: { branch: 'colossus', row: 1, name: 'PEAU IGNIFUGE', desc: ['PEAU CRAMOISIE', 'LE FEU NE LE BRULE PLUS'], look: true, req: ['carapace', 'hams'] },
  grip: { branch: 'colossus', row: 2, name: 'POIGNE', desc: ['NE LACHE PLUS', 'SA PRISE QUAND ON LE FRAPPE'], req: ['carapace'] },
  mass: { branch: 'colossus', row: 2, name: 'MASSE', desc: ['IL GRANDIT', 'VIE +40, LE SOL TREMBLE'], look: true, req: ['brain', 'fireproof'] },
};

// Mutations proposables : pas encore prises, prérequis remplis.
export function available(owned) {
  return Object.keys(MUTATIONS).filter((id) => !owned.includes(id) && (!MUTATIONS[id].req || MUTATIONS[id].req.some((r) => owned.includes(r))));
}

// 3 au hasard (une par branche si possible, pour que le choix ait du sens).
export function draw3(owned) {
  const pool = available(owned).sort(() => Math.random() - 0.5);
  const out = [];
  for (const b of Object.keys(BRANCHES).sort(() => Math.random() - 0.5)) {
    const m = pool.find((id) => MUTATIONS[id].branch === b && !out.includes(id));
    if (m) out.push(m);
  }
  for (const id of pool) if (out.length < 3 && !out.includes(id)) out.push(id);
  return out.slice(0, 3);
}

// Les mutations visibles, sous la forme que lit le modèle : { arms: true, … }.
export function looks(owned) {
  const M = {};
  for (const id of owned) if (MUTATIONS[id] && MUTATIONS[id].look) M[id] = true;
  return M;
}
