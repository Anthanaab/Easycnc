// Profils machines, matériaux et fraises.
// Les valeurs des profils intégrés sont INDICATIVES : vérifiez-les avec votre machine ($$ dans GRBL).
(function () {
  const CNC = window.CNC;

  const spindle3018 = { mode: 'grbl', minRpm: 3000, maxRpm: 10000, sMax: 1000, spinupSec: 3 };

  const MACHINES = [
    {
      id: 'genmitsu-3018-prover', brand: 'Genmitsu / SainSmart', name: '3018-PROVer',
      area: { x: 300, y: 180, z: 45 }, baud: 115200, maxFeed: 1000, maxFeedZ: 300, rapid: 1500,
      spindle: { ...spindle3018, sMax: 10000 }, homing: false, safeZ: 5,
      notes: 'GRBL 1.1. $30 = 10000 en général : vérifiez avec $$ (bouton "Lire les réglages").',
    },
    {
      id: 'genmitsu-3018-pro', brand: 'Genmitsu / SainSmart', name: '3018-PRO',
      area: { x: 300, y: 180, z: 45 }, baud: 115200, maxFeed: 1000, maxFeedZ: 300, rapid: 1500,
      spindle: { ...spindle3018 }, homing: false, safeZ: 5,
      notes: 'GRBL 1.1, sans fins de course : zéro machine manuel.',
    },
    {
      id: 'genmitsu-4040-pro', brand: 'Genmitsu / SainSmart', name: '4040-PRO',
      area: { x: 400, y: 400, z: 78 }, baud: 115200, maxFeed: 1500, maxFeedZ: 400, rapid: 2500,
      spindle: { ...spindle3018, maxRpm: 10000 }, homing: true, safeZ: 5,
      notes: 'GRBL 1.1 avec fins de course : homing $H disponible.',
    },
    {
      id: 'lunyee-3018-pro-max', brand: 'Lunyee', name: '3018 Pro Max',
      area: { x: 300, y: 180, z: 80 }, baud: 115200, maxFeed: 2000, maxFeedZ: 600, rapid: 5000,
      spindle: { ...spindle3018, minRpm: 3000, maxRpm: 10000 }, homing: true, safeZ: 5,
      notes: 'Fiche Lunyee : 300×180×80 mm, broche 500 W 10 000 tr/min, carte 32 bits GRBL F1.1, 6 fins de course (homing $H), 2000 mm/min max en coupe. Pince et $30 non précisés : vérifiez avec "Lire les réglages". Le laser 5,5 W n\'est pas géré.',
    },
    {
      id: 'generic-3018', brand: 'Générique (Vevor, etc.)', name: 'CNC 3018 GRBL',
      area: { x: 300, y: 180, z: 40 }, baud: 115200, maxFeed: 800, maxFeedZ: 250, rapid: 1200,
      spindle: { ...spindle3018 }, homing: false, safeZ: 5,
      notes: 'Profil prudent pour les 3018 sans marque : course utile souvent un peu inférieure.',
    },
    {
      id: 'generic-3018-manual', brand: 'Générique (Vevor, etc.)', name: 'CNC 3018, broche manuelle',
      area: { x: 300, y: 180, z: 40 }, baud: 115200, maxFeed: 800, maxFeedZ: 250, rapid: 1200,
      spindle: { ...spindle3018, mode: 'manual' }, homing: false, safeZ: 5,
      notes: 'Broche commandée par un potentiomètre / interrupteur : le G-code fait une pause (M0) pour la démarrer à la main.',
    },
    {
      id: 'sienci-longmill-mk2-12', brand: 'Sienci', name: 'LongMill MK2 12x12',
      area: { x: 305, y: 305, z: 110 }, baud: 115200, maxFeed: 2500, maxFeedZ: 800, rapid: 4000,
      spindle: { mode: 'manual', minRpm: 10000, maxRpm: 30000, sMax: 1000, spinupSec: 5 }, homing: true, safeZ: 5,
      notes: 'Défroneuse manuelle (type Makita) : réglez la molette. Valeurs à vérifier.',
    },
    {
      id: 'custom-grbl', brand: 'Personnalisé', name: 'GRBL (à régler)',
      area: { x: 300, y: 300, z: 50 }, baud: 115200, maxFeed: 1000, maxFeedZ: 300, rapid: 1500,
      spindle: { ...spindle3018 }, homing: false, safeZ: 5,
      notes: 'Dupliquez ce profil et adaptez-le à votre machine.',
    },
  ].map((m) => ({ builtin: true, collet: 'ER11', maxShank: 7, preamble: '', postamble: '', probe: { plate: 15, feed: 30, maxDepth: 25, retract: 5 }, ...m }));
  // Palpeur Z (plaque de touche) : épaisseur de plaque, avance de palpage, course max de recherche, remontée
  const PROBE = { plate: 15, feed: 30, maxDepth: 25, retract: 5 };
  // Réglages palpeur : dans le profil (perso) ou, pour un profil intégré, dans une surcharge mémorisée par machine
  CNC.probeOf = (m) => ({ ...PROBE, ...(m.probe || {}), ...(m.builtin ? CNC.store.get('probe.' + m.id, {}) : {}) });
  CNC.setProbe = (m, key, val) => {
    if (m.builtin) CNC.store.set('probe.' + m.id, { ...CNC.store.get('probe.' + m.id, {}), [key]: val });
    else { m.probe = { ...(m.probe || {}), [key]: val }; CNC.saveUserMachines(); }
  };

  // chip = charge par dent (mm) par mm de diamètre de fraise
  // doc = profondeur de passe (fraction du diamètre), stepover = recouvrement latéral (fraction du diamètre)
  const MATERIALS = [
    { id: 'pine', name: 'Pin / bois tendre', color: '#e3c99a', chip: 0.010, doc: 0.35, stepover: 0.45, rpm: 10000, plunge: 0.4 },
    { id: 'plywood', name: 'Contreplaqué', color: '#d8b98a', chip: 0.009, doc: 0.30, stepover: 0.42, rpm: 10000, plunge: 0.4 },
    { id: 'mdf', name: 'MDF', color: '#bfa27a', chip: 0.010, doc: 0.35, stepover: 0.45, rpm: 10000, plunge: 0.4 },
    { id: 'hardwood', name: 'Bois dur (chêne, hêtre…)', color: '#b68a5b', chip: 0.006, doc: 0.25, stepover: 0.35, rpm: 10000, plunge: 0.35 },
    { id: 'acrylic', name: 'Acrylique (PMMA)', color: '#bfe3f2', chip: 0.008, doc: 0.30, stepover: 0.40, rpm: 8000, plunge: 0.35 },
    { id: 'abs', name: 'ABS / PVC / HDPE', color: '#d9d9d9', chip: 0.009, doc: 0.30, stepover: 0.40, rpm: 8000, plunge: 0.35 },
    { id: 'foam', name: 'Mousse / XPS', color: '#cfe6ff', chip: 0.020, doc: 1.00, stepover: 0.60, rpm: 8000, plunge: 0.6 },
    { id: 'alu', name: 'Aluminium (avec prudence)', color: '#b9c0c9', chip: 0.003, doc: 0.08, stepover: 0.25, rpm: 10000, plunge: 0.3 },
    { id: 'pcb', name: 'Cuivre / circuit imprimé', color: '#c7833a', chip: 0.004, doc: 0.10, stepover: 0.30, rpm: 10000, plunge: 0.3 },
  ];

  // Catalogue de fraises courantes pour pince ER11 (queues 3,175 / 4 / 6 mm).
  // geom : 'down' = hélice descendante (surface du dessus propre), 'compression' = haut + bas (contreplaqué / mélaminé)
  const flat = (d, fl, cut, shank, extra) => ({
    id: `flat${fl}${(extra && extra.geom) ? extra.geom[0] : ''}-${String(d).replace('.', '')}`,
    name: `Droite ${String(d).replace('.', ',')} mm - ${fl} dent${fl > 1 ? 's' : ''}${extra && extra.label ? ' ' + extra.label : ''}`,
    type: 'flat', diameter: d, flutes: fl, cutLength: cut, shank, ...(extra && extra.geom ? { geom: extra.geom } : {}),
  });
  const ball = (d, cut, shank) => ({ id: `ball2-${String(d).replace('.', '')}`, name: `Sphérique ${String(d).replace('.', ',')} mm - 2 dents`, type: 'ball', diameter: d, flutes: 2, cutLength: cut, shank });
  const vb = (angle, tip, ref, doc, id) => ({
    id: id || `v${angle}`, name: `Gravure V ${angle}° (pointe ${String(tip).replace('.', ',')} mm)`,
    type: 'vbit', angle, diameter: tip, refDia: ref, docMax: doc, flutes: 1, cutLength: 6, shank: 3.175,
  });
  const BITS = [
    // --- droites, 2 dents (usage général) ---
    flat(0.8, 2, 3, 3.175), flat(1, 2, 4, 3.175), flat(1.5, 2, 6, 3.175), flat(2, 2, 8, 3.175), flat(2.5, 2, 10, 3.175),
    { ...flat(3.175, 2, 12, 3.175), name: 'Droite 3,175 mm (1/8") - 2 dents' },
    flat(4, 2, 15, 4), flat(6, 2, 22, 6),
    // --- droites, 1 dent (plastiques, aluminium : évacuation maximale des copeaux) ---
    flat(2, 1, 8, 3.175, { label: '(plastique/alu)' }),
    { ...flat(3.175, 1, 12, 3.175), name: 'Droite 3,175 mm - 1 dent (plastique/alu)' },
    flat(4, 1, 15, 4, { label: '(plastique/alu)' }),
    // --- droites, 3 et 4 dents (finition) ---
    flat(3.175, 3, 12, 3.175), { ...flat(3.175, 4, 12, 3.175), name: 'Droite 3,175 mm - 4 dents (bois dur)' }, flat(6, 4, 22, 6, { label: '(bois dur/alu)' }),
    // --- hélices spéciales ---
    flat(3.175, 2, 12, 3.175, { geom: 'down', label: 'hélice descendante' }),
    flat(2, 2, 8, 3.175, { geom: 'down', label: 'hélice descendante' }),
    flat(3.175, 2, 12, 3.175, { geom: 'compression', label: 'compression' }),
    flat(6, 2, 22, 6, { geom: 'compression', label: 'compression' }),
    // --- surfaçage ---
    { id: 'surf3-12', name: 'Surfaçage Ø 12 mm - 3 dents (queue 6)', type: 'flat', diameter: 12, flutes: 3, cutLength: 5, shank: 6, geom: 'surface' },
    // --- sphériques ---
    ball(1, 4, 3.175), ball(1.5, 6, 3.175), ball(2, 8, 3.175), ball(3.175, 12, 3.175), ball(4, 15, 4), ball(6, 22, 6),
    // --- gravure / chanfrein en V ---
    vb(15, 0.1, 1.0, 0.3), vb(20, 0.1, 1.2, 0.3, 'v20'), vb(30, 0.2, 1.5, 0.4), vb(45, 0.2, 1.8, 0.5), vb(60, 0.2, 2.0, 0.5),
    vb(90, 0.2, 3.0, 0.6),
    { ...vb(90, 0.5, 3.0, 0.8, 'v90c'), name: 'Chanfreinage V 90° (pointe 0,5 mm)' },
  ].map((b) => ({ builtin: true, ...b }));

  CNC.data = { MACHINES, MATERIALS, BITS };

  // --- profils utilisateur (stockés dans le navigateur) ---
  CNC.userMachines = CNC.store.get('userMachines', []);
  CNC.userBits = CNC.store.get('userBits', []);
  CNC.saveUserMachines = () => CNC.store.set('userMachines', CNC.userMachines);
  CNC.saveUserBits = () => CNC.store.set('userBits', CNC.userBits);

  CNC.machines = () => MACHINES.concat(CNC.userMachines);
  CNC.bits = () => BITS.concat(CNC.userBits);
  CNC.machine = (id) => CNC.machines().find((m) => m.id === id) || MACHINES[0];
  CNC.bit = (id) => CNC.bits().find((b) => b.id === id) || BITS[0];
  CNC.material = (id) => MATERIALS.find((m) => m.id === id) || MATERIALS[0];

  // Paramètres de coupe calculés depuis machine + matériau + fraise
  CNC.autoParams = (machine, material, bit) => {
    const ref = bit.refDia || bit.diameter;
    const sp = machine.spindle;
    const rpm = CNC.clamp(material.rpm, sp.minRpm, sp.maxRpm);
    let feed = rpm * bit.flutes * material.chip * ref;
    feed = CNC.clamp(Math.round(feed / 10) * 10, 30, machine.maxFeed);
    const plunge = CNC.clamp(Math.round((feed * material.plunge) / 10) * 10, 20, machine.maxFeedZ);
    let doc = ref * material.doc;
    if (bit.docMax) doc = Math.min(doc, bit.docMax);
    if (bit.cutLength) doc = Math.min(doc, bit.cutLength);
    doc = Math.max(CNC.round(doc, 2), 0.05);
    const stepover = Math.max(CNC.round(bit.diameter * material.stepover, 2), 0.05);
    return { rpm, feed, plunge, doc, stepover, safeZ: machine.safeZ };
  };
})();
