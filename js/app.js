// Application : projet, onglet « Dessiner », fichiers, import SVG.
(function () {
  const CNC = window.CNC;
  const { el, $ } = CNC;
  const E = CNC.editor;
  const G = CNC.geom;
  const App = (CNC.app = {});

  const newProject = () => ({
    id: CNC.newId(),
    name: 'Sans titre',
    stock: { w: 200, h: 120, t: 12, materialId: 'mdf' },
    shapes: [],
    machineId: CNC.store.get('machineId', 'genmitsu-3018-prover'),
    bitId: 'flat2-3175',
    over: {}, // paramètres de coupe modifiés à la main
    sMax: null, // S maxi détecté ($30)
    origin: 'bl',
    overcut: 0.2, // sur-profondeur pour les découpes traversantes
    mode: 'mill', // outil : 'mill' (fraise) ou 'laser'
    laser: null, // réglages laser (créés à la demande)
    facing: { on: false, depth: 0.5 }, // surfaçage du dessus
  });

  App.project = null;
  App.machine = () => {
    const m = CNC.machine(App.project.machineId);
    return App.project.sMax ? { ...m, spindle: { ...m.spindle, sMax: App.project.sMax } } : m;
  };
  App.bit = () => CNC.bit(App.project.bitId);
  App.material = () => CNC.material(App.project.stock.materialId);
  App.params = () => ({ ...CNC.autoParams(App.machine(), App.material(), App.bit()), ...App.project.over });
  App.grbl = new CNC.Grbl();
  E.area = () => (App.project ? App.machine().area : null);

  App.setProject = (p) => {
    App.project = Object.assign(newProject(), p);
    App.project.stock = Object.assign(newProject().stock, p.stock);
    E.project = App.project;
    E.selection = [];
    E.resetHistory();
    E.sim = null;
    $('#projName').value = App.project.name;
    E._userView = false;
    E.resize();
    E.on.select();
    E.render();
    App.onProjectLoaded && App.onProjectLoaded();
  };

  // ---------- champs ----------
  // field(label, {get, set, step, min, unit, disabled}) -> { row, input, refresh }
  const field = (label, o) => {
    const input = el('input', { type: 'number', step: o.step || 'any', min: o.min });
    const refresh = () => {
      if (document.activeElement === input) return;
      const v = o.get();
      input.value = v == null || Number.isNaN(v) ? '' : CNC.round(v, 3);
      input.disabled = o.disabled ? o.disabled() : false;
    };
    input.addEventListener('change', () => {
      const v = parseFloat(input.value);
      if (Number.isNaN(v)) return refresh();
      o.set(o.min != null ? Math.max(o.min, v) : v);
    });
    const row = el('div', { class: 'row' }, el('label', {}, label), el('div', { class: 'grow' }, input), o.unit ? el('span', { class: 'unit' }, o.unit) : null);
    return { row, input, refresh };
  };
  App.field = field;

  // ---------- panneau « Dessiner » ----------
  function buildDesignPanel() {
    const P = () => App.project;
    const st = () => P().stock;
    const one = () => (E.selection.length === 1 ? E.selected()[0] : null);
    const fields = [];
    const reg = (f) => { fields.push(f); return f; };

    // Matériau
    const matSel = el('select', {}, CNC.data.MATERIALS.map((m) => el('option', { value: m.id }, m.name)));
    matSel.addEventListener('change', () => { E.snapshot(); st().materialId = matSel.value; P().over = {}; E.changed(); });
    const setStock = (k) => (v) => { E.snapshot(); st()[k] = v; if (k === 't') { P().over = {}; } E.changed(); if (k !== 't') E.fit(); };
    const fW = reg(field('Largeur', { get: () => st().w, set: setStock('w'), min: 1, unit: 'mm' }));
    const fH = reg(field('Hauteur', { get: () => st().h, set: setStock('h'), min: 1, unit: 'mm' }));
    const fT = reg(field('Épaisseur', { get: () => st().t, set: setStock('t'), min: 0.1, unit: 'mm' }));
    const machSel = el('select', {});
    machSel.addEventListener('change', () => { P().machineId = machSel.value; P().over = {}; P().sMax = null; CNC.store.set('machineId', machSel.value); E.changed(); E.fit(); });
    const fillMach = () => {
      machSel.innerHTML = '';
      const groups = {};
      CNC.machines().forEach((m) => (groups[m.brand] = groups[m.brand] || []).push(m));
      for (const [brand, items] of Object.entries(groups)) machSel.append(el('optgroup', { label: brand }, items.map((m) => el('option', { value: m.id }, m.name))));
      machSel.value = CNC.machine(P().machineId).id;
    };
    const area = () => App.machine().area;
    const setPos = (k) => (v) => { E.snapshot(); st()[k] = v; E.changed(); };
    const fPx = reg(field('Pos. X', { get: () => CNC.stockPos(st(), area()).x, set: setPos('px'), unit: 'mm' }));
    const fPy = reg(field('Pos. Y', { get: () => CNC.stockPos(st(), area()).y, set: setPos('py'), unit: 'mm' }));
    const cardStock = el('div', { class: 'card' },
      el('h3', {}, 'Machine et matériau'),
      el('div', { class: 'row' }, el('label', {}, 'Machine'), el('div', { class: 'grow' }, machSel)),
      el('div', { class: 'row' }, el('label', {}, 'Type'), el('div', { class: 'grow' }, matSel)),
      fW.row, fH.row, fT.row, fPx.row, fPy.row,
      el('div', { class: 'btns' }, el('button', { class: 'btn sm', onclick: () => { E.snapshot(); delete st().px; delete st().py; E.changed(); } }, 'Centrer'),
        el('button', { class: 'btn sm', onclick: () => { E.snapshot(); st().px = 0; st().py = 0; E.changed(); } }, 'Bas gauche')),
      el('div', { class: 'muted' }, 'Le matériau (beige) est posé dans la zone de travail (pointillés). Sa position sert de repère visuel : le zéro machine se règle sur le coin bas-gauche (croix rouge), Z0 sur le dessus.'));

    // Forme
    const forEachSel = (fn) => { E.snapshot(); E.selected().forEach(fn); E.changed(); };
    const g = (k) => () => (one() ? one()[k] : null);
    const s = (k) => (v) => forEachSel((sh) => { sh[k] = v; });
    const noOne = () => !one();
    const fX = reg(field('X', { get: g('x'), set: s('x'), unit: 'mm', disabled: noOne }));
    const fY = reg(field('Y', { get: g('y'), set: s('y'), unit: 'mm', disabled: noOne }));
    const fw = reg(field('Largeur', { get: g('w'), set: s('w'), min: 0.1, unit: 'mm', disabled: noOne }));
    const fh = reg(field('Hauteur', { get: g('h'), set: s('h'), min: 0.1, unit: 'mm', disabled: noOne }));
    const fr = reg(field('Rotation', { get: g('rot'), set: s('rot'), unit: '°', disabled: noOne }));
    const fs = reg(field('Côtés', { get: g('sides'), set: (v) => forEachSel((sh) => { sh.sides = Math.max(3, Math.round(v)); }), min: 3, step: 1, disabled: noOne }));
    const sidesRow = fs.row;

    const cutSel = el('select', {}, [
      ['outside', 'Contour extérieur'], ['inside', 'Contour intérieur'], ['online', 'Sur le tracé (gravure)'],
      ['pocket', 'Poche (évidement)'], ['vcarve', 'V-carve (gravure en V)'], ['none', 'Ne pas usiner'],
    ].map(([v, t]) => el('option', { value: v }, t)));
    cutSel.addEventListener('change', () => forEachSel((sh) => { sh.cut = { ...sh.cut, type: cutSel.value }; }));
    // découpe traversante d'un contour : les tenons sont activés d'office (désactivables ensuite)
    const CONTOURS = ['outside', 'inside', 'online'];
    const autoTabs = (sh) => {
      if (CONTOURS.includes(sh.cut.type) && sh.cut.depth >= st().t - 1e-6 && !(sh.cut.tabs && 'on' in sh.cut.tabs)) {
        sh.cut = { ...sh.cut, tabs: { count: 4, width: 5, height: 2, on: true } };
      }
    };
    const fd = reg(field('Profondeur', {
      get: () => (E.selected()[0] ? E.selected()[0].cut.depth : null),
      set: (v) => forEachSel((sh) => { sh.cut = { ...sh.cut, depth: Math.min(v, st().t) }; autoTabs(sh); }),
      min: 0, unit: 'mm', disabled: () => !E.selection.length,
    }));
    // texte
    const txtIn = el('textarea', { rows: 2, spellcheck: 'false', style: 'width:100%;resize:vertical' });
    const fontSel = el('select', {}, CNC.text.fonts.map(([v, t]) => el('option', { value: v }, t)));
    const editText = (fn) => { E.snapshot(); const sh = E.selected()[0]; fn(sh); CNC.text.fit(sh); E.changed(); E.on.select(); };
    txtIn.addEventListener('change', () => editText((sh) => { sh.text = txtIn.value; }));
    fontSel.addEventListener('change', () => editText((sh) => { sh.font = fontSel.value; }));
    const fSize = reg(field('Taille', { get: () => (one() && one().kind === 'text' ? one().size : null), set: (v) => editText((sh) => { sh.size = v; }), min: 1, unit: 'mm' }));
    const textBox = el('div', {}, el('h3', { style: 'margin-top:14px' }, 'Texte'), txtIn,
      el('div', { class: 'row' }, el('label', {}, 'Police'), el('div', { class: 'grow' }, fontSel)), fSize.row,
      el('div', { class: 'muted' }, 'Astuce : un texte en « Poche » demande une petite fraise ; la gravure en V (« Sur le tracé ») convient aux lettres fines.'));

    // alignement, répartition, opérations booléennes
    const doAlign = (dir) => {
      const sel = E.selected();
      if (!sel.length) return;
      E.snapshot();
      const ref = sel.length > 1 ? CNC.bool.selectionBox(sel) : { x0: 0, y0: 0, x1: st().w, y1: st().h };
      CNC.bool.align(sel, dir, ref);
      E.changed(); E.on.select();
    };
    const doDist = (axis) => { E.snapshot(); CNC.bool.distribute(E.selected(), axis); E.changed(); E.on.select(); };
    const doCombine = (mode) => {
      const sel = E.project.shapes.filter((q) => E.selection.includes(q.id)); // dans l'ordre de dessin
      if (sel.length < 2) return;
      let res;
      try { res = CNC.bool.combine(mode, sel); } catch (e) { return alert('Opération impossible : ' + e.message); }
      if (!res) return alert('Le résultat est vide (les formes ne se recouvrent pas ?).');
      E.snapshot();
      const at = E.project.shapes.indexOf(sel[0]);
      E.project.shapes = E.project.shapes.filter((q) => !E.selection.includes(q.id));
      E.project.shapes.splice(Math.min(at, E.project.shapes.length), 0, res);
      E.selection = [res.id];
      E.on.select(); E.changed();
    };
    const ab = (label, fn, title) => el('button', { class: 'btn sm', title, onclick: fn }, label);
    const alignRow = el('div', { class: 'btns' },
      ab('⇤ Gauche', () => doAlign('left')), ab('↔ Centre', () => doAlign('hcenter')), ab('Droite ⇥', () => doAlign('right')),
      ab('⤒ Haut', () => doAlign('top')), ab('↕ Milieu', () => doAlign('vcenter')), ab('Bas ⤓', () => doAlign('bottom')));
    const distRow = el('div', { class: 'btns' }, ab('Répartir ↔', () => doDist('h'), 'Espaces égaux horizontalement'), ab('Répartir ↕', () => doDist('v'), 'Espaces égaux verticalement'));
    const comboRow = el('div', { class: 'btns' },
      ab('Fusionner', () => doCombine('union'), 'Réunit les formes en une seule'),
      ab('Soustraire', () => doCombine('subtract'), 'Retire les formes suivantes de la première (celle du dessous)'),
      ab('Intersection', () => doCombine('intersect'), 'Ne garde que la partie commune'));
    const toolsBox = el('div', {},
      el('h3', { style: 'margin-top:14px' }, 'Alignement'),
      el('div', { class: 'muted' }, 'Une forme : alignée sur le matériau. Plusieurs : alignées entre elles.'),
      alignRow, distRow,
      el('div', { class: 'muted', style: 'margin-top:8px' }, 'Combiner (au moins 2 formes ; « Soustraire » retire les suivantes de la première)'), comboRow);

    const vcHint = el('div', { class: 'muted', style: 'margin:4px 0' },
      'V-carve : nécessite une fraise de gravure en V (choix dans l\'onglet Fraiser). La profondeur est un maximum : les traits fins restent peu profonds, les traits larges vont jusqu\'à cette profondeur. Pour les zones très larges, évidez d\'abord à la fraise droite.');
    // relief 3D
    const relOf = (sh) => ({ invert: false, rough: true, allow: 0.3, fstep: 0, ...(sh.relief || {}) });
    const setRel = (k) => (v) => forEachSel((sh) => { sh.relief = { ...relOf(sh), [k]: v }; });
    const relInv = el('input', { type: 'checkbox' }), relRough = el('input', { type: 'checkbox' });
    relInv.addEventListener('change', () => setRel('invert')(relInv.checked));
    relRough.addEventListener('change', () => setRel('rough')(relRough.checked));
    const relGet = (k) => () => (one() && one().kind === 'relief' ? relOf(one())[k] : null);
    const fAllow = reg(field('Réserve', { get: relGet('allow'), set: setRel('allow'), min: 0, unit: 'mm' }));
    const fFstep = reg(field('Pas finition', { get: relGet('fstep'), set: setRel('fstep'), min: 0, unit: 'mm' }));
    const reliefBox = el('div', {}, el('h3', { style: 'margin-top:14px' }, 'Relief 3D'),
      el('label', { style: 'display:flex;gap:8px;align-items:center;margin:6px 0' }, relInv, 'Inverser (blanc = creux, noir = surface)'),
      el('label', { style: 'display:flex;gap:8px;align-items:center;margin:6px 0' }, relRough, 'Ébauche par couches avant la finition'),
      fAllow.row, fFstep.row,
      el('div', { class: 'muted' }, 'Blanc = dessus du matériau, noir = profondeur maximale (champ « Profondeur »). Pas de finition à 0 = automatique. Fraise sphérique conseillée ; usinage long : vérifiez la durée dans l\'onglet Fraiser.'));
    const cutRow = el('div', { class: 'row' }, el('label', {}, 'Type'), el('div', { class: 'grow' }, cutSel));

    // tenons de maintien
    const tabDef = { on: false, count: 4, width: 5, height: 2 };
    const tabsOf = (sh) => ({ ...tabDef, ...((sh.cut && sh.cut.tabs) || {}) });
    const setTab = (k) => (v) => forEachSel((sh) => { sh.cut = { ...sh.cut, tabs: { ...tabsOf(sh), [k]: v } }; });
    const tabGet = (k) => () => (E.selected()[0] ? tabsOf(E.selected()[0])[k] : null);
    const tabChk = el('input', { type: 'checkbox' });
    tabChk.addEventListener('change', () => setTab('on')(tabChk.checked));
    const ftN = reg(field('Nombre', { get: tabGet('count'), set: (v) => setTab('count')(Math.max(1, Math.round(v))), min: 1, step: 1 }));
    const ftW = reg(field('Pont', { get: tabGet('width'), set: setTab('width'), min: 0.5, unit: 'mm' }));
    const ftH = reg(field('Épaisseur', { get: tabGet('height'), set: setTab('height'), min: 0.2, unit: 'mm' }));
    const tabDetails = el('div', {}, ftN.row, ftW.row, ftH.row,
      el('div', { class: 'muted' }, 'Ponts de matière laissés au fond pour que la pièce reste en place ; à recouper au cutter après l\'usinage.'));
    const tabHint = el('div', { class: 'warn' }, 'Découpe traversante sans tenons : la pièce peut bouger ou se coincer sous la fraise à la fin. ',
      el('button', { class: 'btn sm', onclick: () => setTab('on')(true) }, 'Activer les tenons'));
    const tabsBox = el('div', {}, tabHint, el('label', { style: 'display:flex;gap:8px;align-items:center;margin:8px 0 2px' }, tabChk, 'Tenons de maintien'), tabDetails);

    // mode laser : opération par forme
    const modeSel = el('select', {}, el('option', { value: 'mill' }, 'Fraise (défonceuse)'), el('option', { value: 'laser' }, 'Laser'));
    modeSel.addEventListener('change', () => App.setMode(modeSel.value));
    const opSel = el('select', {}, [['', 'Automatique (selon le type)'], ['off', 'Ne pas graver'], ['line', 'Contour (ligne)'], ['fill', 'Remplissage'], ['image', 'Image (niveaux de gris)']]
      .map(([v, t]) => el('option', { value: v }, t)));
    opSel.addEventListener('change', () => forEachSel((sh) => { if (opSel.value) sh.lop = opSel.value; else delete sh.lop; }));
    const lInv = el('input', { type: 'checkbox' });
    lInv.addEventListener('change', () => setRel('invert')(lInv.checked));
    const lInvRow = el('label', { style: 'display:flex;gap:8px;align-items:center;margin:6px 0' }, lInv, 'Inverser l\'image (blanc = brûlé)');
    const laserBox = el('div', {}, el('h3', { style: 'margin-top:14px' }, 'Laser'),
      el('div', { class: 'row' }, el('label', {}, 'Opération'), el('div', { class: 'grow' }, opSel)), lInvRow,
      el('div', { class: 'muted' }, 'Contour : suit le tracé (découpe / marquage). Remplissage : hachures à l\'intérieur. Image : gravure en niveaux de gris. Réglages de puissance et de vitesse dans l\'onglet Fraiser.'));
    machSel.closest('.row').after(el('div', { class: 'row' }, el('label', {}, 'Outil'), el('div', { class: 'grow' }, modeSel)));
    const millBox = el('div', {}, el('h3', { style: 'margin-top:14px' }, 'Usinage'), cutRow, reliefBox, fd.row, vcHint, tabsBox,
      el('div', { class: 'btns' }, el('button', { class: 'btn sm', onclick: () => forEachSel((sh) => { sh.cut = { ...sh.cut, depth: st().t }; autoTabs(sh); }) }, 'Traversant')));

    const cardShape = el('div', { class: 'card' },
      el('h3', {}, 'Forme'),
      el('div', { class: 'grid2' }, fX.row, fY.row, fw.row, fh.row),
      fr.row, sidesRow, textBox, toolsBox,
      millBox, laserBox,      el('div', { class: 'btns' },
        el('button', { class: 'btn sm', onclick: () => E.duplicate() }, 'Dupliquer'),
        el('button', { class: 'btn sm', onclick: () => E.reorder(1) }, 'Avancer'),
        el('button', { class: 'btn sm', onclick: () => E.reorder(-1) }, 'Reculer'),
        el('button', { class: 'btn sm danger', onclick: () => E.removeSelected() }, 'Supprimer')));

    const cardHelp = el('div', { class: 'card' },
      el('h3', {}, 'Bien démarrer'),
      el('div', { class: 'muted' }, '1. Réglez le matériau ci-dessus. 2. Ajoutez des formes depuis la barre de gauche (ou importez un SVG). 3. Choisissez pour chacune le type d\'usinage et la profondeur. 4. Passez à « Fraiser ».'));

    const node = el('div', {}, cardStock, cardShape, cardHelp);
    const refresh = () => {
      fillMach(); matSel.value = st().materialId;
      const sel = E.selected();
      cardShape.style.display = sel.length ? '' : 'none';
      cardHelp.style.display = sel.length ? 'none' : '';
      const laserMode = P().mode === 'laser';
      modeSel.value = laserMode ? 'laser' : 'mill';
      millBox.style.display = laserMode ? 'none' : '';
      laserBox.style.display = laserMode ? '' : 'none';
      if (laserMode && sel.length) { opSel.value = sel[0].lop || ''; lInv.checked = !!(sel[0].relief && sel[0].relief.invert); lInvRow.style.display = sel.every((q) => q.kind === 'relief') ? '' : 'none'; }
      if (sel.length) {
        cutSel.value = sel[0].cut.type;
        const isRelief = sel.length === 1 && sel[0].kind === 'relief';
        reliefBox.style.display = isRelief ? '' : 'none';
        cutRow.style.display = isRelief ? 'none' : '';
        if (isRelief) { relInv.checked = relOf(sel[0]).invert; relRough.checked = relOf(sel[0]).rough !== false; }
        const isText = sel.length === 1 && sel[0].kind === 'text';
        textBox.style.display = isText ? '' : 'none';
        if (isText) { if (document.activeElement !== txtIn) txtIn.value = sel[0].text; fontSel.value = sel[0].font; }
        const tabOk = ['outside', 'inside', 'online'].includes(sel[0].cut.type);
        vcHint.style.display = sel[0].cut.type === 'vcarve' ? '' : 'none';
        tabsBox.style.display = tabOk ? '' : 'none';
        distRow.style.display = sel.length >= 3 ? '' : 'none';
        comboRow.previousSibling.style.display = comboRow.style.display = sel.length >= 2 ? '' : 'none';
        tabChk.checked = !!(sel[0].cut.tabs && sel[0].cut.tabs.on);
        tabDetails.style.display = tabChk.checked ? '' : 'none';
        tabHint.style.display = tabOk && !tabChk.checked && sel[0].cut.depth >= st().t - 1e-6 ? '' : 'none';
        sidesRow.style.display = sel.length === 1 && (sel[0].kind === 'polygon' || sel[0].kind === 'star') ? '' : 'none';
      }
      fields.forEach((f) => f.refresh());
    };
    return { node, refresh };
  }

  // ---------- palette ----------
  const ICONS = {
    rect: '<rect x="5" y="7" width="22" height="18" rx="1"/>',
    ellipse: '<circle cx="16" cy="16" r="10"/>',
    polygon: '<path d="M16 5l9.5 6.9-3.6 11.2H10.1L6.5 11.9z"/>',
    star: '<path d="M16 4l3.5 8 8.5.8-6.4 5.7 1.9 8.5L16 22.6 8.5 27l1.9-8.5L4 12.8l8.5-.8z"/>',
    text: '<path d="M7 8h18M16 8v17M12 25h8"/>',
    relief: '<path d="M4 24l6-9 5 6 4-8 9 11z"/><path d="M4 27h24"/>',
    svg: '<path d="M8 5h11l6 6v16H8z"/><path d="M19 5v6h6"/><path d="M12 20l3-4 3 3 2-2"/>',
  };
  function buildPalette() {
    const pal = $('#palette');
    const add = (kind) => () => {
      const st = App.project.stock;
      const n = App.project.shapes.length;
      const sh = G.make(kind, st.w / 2 + (n % 5) * 6, st.h / 2 - (n % 5) * 6);
      sh.cut.depth = Math.min(3, st.t);
      E.addShape(sh);
    };
    const btn = (icon, label, fn, title) =>
      el('button', { onclick: fn, title: title || label, html: `<svg viewBox="0 0 32 32">${icon}</svg><span>${label}</span>` });
    pal.append(
      btn(ICONS.rect, 'Rectangle', add('rect')),
      btn(ICONS.ellipse, 'Cercle', add('ellipse')),
      btn(ICONS.polygon, 'Polygone', add('polygon')),
      btn(ICONS.star, 'Étoile', add('star')),
      btn(ICONS.text, 'Texte', () => {
        const st = App.project.stock, n = App.project.shapes.length;
        E.addShape(CNC.text.make(st.w / 2 + (n % 5) * 6, st.h / 2 - (n % 5) * 6, st));
      }),
      el('hr'),
      btn(ICONS.relief, 'Relief 3D', () => $('#fileRelief').click(), 'Graver une image en relief 3D (niveaux de gris)'),
      btn(ICONS.svg, 'Import SVG', () => $('#fileSvg').click(), 'Importer un fichier SVG'));
  }

  // ---------- import SVG ----------
  async function importSvgFile(file) {
    try {
      const { polys, skipped } = CNC.importSvg(await file.text());
      if (!polys.length) return alert('Aucun tracé exploitable dans ce SVG.' + (skipped ? ' (Le texte doit être converti en tracés.)' : ''));
      let b = G.bbox(polys);
      const st = App.project.stock;
      let k = 1;
      const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
      if (bw > st.w * 0.95 || bh > st.h * 0.95) k = Math.min((st.w * 0.9) / bw, (st.h * 0.9) / bh);
      const dx = st.w / 2 - ((b.x0 + b.x1) / 2) * k, dy = st.h / 2 - ((b.y0 + b.y1) / 2) * k;
      const groups = {};
      polys.forEach((p) => (groups[p.g] = groups[p.g] || []).push({ closed: p.closed, pts: p.pts.map(([x, y]) => [x * k + dx, y * k + dy]) }));
      E.snapshot();
      const made = Object.values(groups).map((ps, i) => {
        const sh = G.fromWorldPolys(ps, 'SVG ' + (i + 1));
        if (sh.cut.type !== 'online') sh.cut.depth = Math.min(3, st.t);
        return sh;
      });
      App.project.shapes.push(...made);
      E.selection = made.map((m) => m.id);
      E.on.select(); E.changed();
      const notes = [];
      if (k !== 1) notes.push(`Le dessin a été réduit à ${Math.round(k * 100)} % pour tenir dans le matériau.`);
      if (skipped) notes.push(`${skipped} élément(s) texte ignoré(s) : convertissez le texte en tracés dans votre logiciel de dessin.`);
      if (notes.length) alert(notes.join('\n'));
    } catch (e) { alert('Import SVG impossible : ' + e.message); }
  }

  // ---------- onglets ----------
  let design, carve;
  // ---------- disposition de la zone centrale : plan 2D / vue 3D / les deux ----------
  App.viewMode = CNC.store.get('viewMode', 'both');
  const applyView = (mode) => {
    $('#stage').className = 'stage mode-' + mode;
    CNC.$$('#viewMode button').forEach((b) => b.classList.toggle('on', b.dataset.v === mode));
    E.resize();
    CNC.view3d.resize();
  };
  App.setView = (mode) => { App.viewMode = mode; CNC.store.set('viewMode', mode); applyView(mode); };

  // outil : fraise ou laser
  App.refreshView = () => applyView(App.tab === 'carve' && App.project.mode !== 'laser' ? App.viewMode : '2d');
  App.setMode = (mode) => {
    App.project.mode = mode;
    if (mode === 'laser' && !App.project.laser) App.project.laser = CNC.laser.defaults();
    E.sim = null;
    E.changed(); E.on.select();
    if (App.tab === 'carve') carve.enter();
    App.refreshView();
    $('#viewMode').hidden = App.tab !== 'carve' || mode === 'laser';
  };

  App.tab = 'design';
  App.setTab = (tab) => {
    App.tab = tab;
    E.mode = tab;
    CNC.$$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    $('#palette').classList.toggle('disabled', tab !== 'design');
    $('#hint').style.display = tab === 'design' ? '' : 'none';
    const panel = $('#panel');
    panel.innerHTML = '';
    if (tab === 'design') { panel.append(design.node); design.refresh(); E.sim = null; }
    else { panel.append(carve.node); carve.enter(); }
    $('#viewMode').hidden = tab !== 'carve';
    App.refreshView();
    $('#viewMode').hidden = tab !== 'carve' || App.project.mode === 'laser';
    E.render();
  };

  // ---------- fichiers ----------
  const saveFile = () => {
    CNC.download((App.project.name || 'projet') + '.easycnc.json', JSON.stringify({ app: 'easycnc', version: 1, project: App.project }, null, 1), 'application/json');
  };
  const openFile = async (file) => {
    try {
      const data = JSON.parse(await file.text());
      if (!data.project) throw new Error('fichier non reconnu');
      App.setProject(data.project);
    } catch (e) { alert('Ouverture impossible : ' + e.message); }
  };

  // ---------- démarrage ----------
  function boot() {
    E.init($('#cv'));
    CNC.view3d.init($('#pane3d'));
    E.on.sim = (sim) => CNC.view3d.setProgress(sim.progress);
    CNC.$$('#viewMode button').forEach((b) => b.addEventListener('click', () => App.setView(b.dataset.v)));
    design = buildDesignPanel();
    carve = CNC.buildCarvePanel(App);
    buildPalette();

    let saved = CNC.store.get('project', null);
    App.setProject(saved || newProject());

    let saveTimer = null;
    E.on.change = () => {
      design.refresh();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => CNC.store.set('project', App.project), 400);
      if (App.tab === 'carve') carve.invalidate();
    };
    E.on.select = () => design.refresh();
    E.on.cursor = (x, y) => { $('#cursorInfo').textContent = `X ${x.toFixed(1)}  Y ${y.toFixed(1)} mm`; };

    CNC.$$('.tabs button').forEach((b) => b.addEventListener('click', () => App.setTab(b.dataset.tab)));
    $('#btnUndo').onclick = () => E.undo();
    $('#btnRedo').onclick = () => E.redo();
    $('#btnNew').onclick = () => { if (confirm('Créer un nouveau projet ? Les modifications non enregistrées seront perdues.')) App.setProject(newProject()); };
    // enregistrer / ouvrir : sur le serveur quand il est disponible, sinon fichiers
    $('#btnSave').onclick = async () => {
      if (!CNC.projects.available()) return saveFile();
      try {
        App.project.name = $('#projName').value || App.project.name;
        await CNC.projects.save(App.project);
        CNC.toast('Projet « ' + App.project.name + ' » enregistré sur le serveur');
      } catch (e) { CNC.toast('Enregistrement impossible : ' + e.message, 'err'); }
    };
    $('#btnOpen').onclick = () => {
      if (!CNC.projects.available()) return $('#fileOpen').click();
      CNC.projects.browse({
        currentId: App.project.id,
        onOpen: (p) => { App.setProject(p); CNC.toast('Projet « ' + (p.name || 'Sans titre') + ' » ouvert'); },
        onImport: () => $('#fileOpen').click(),
        onExport: saveFile,
      });
    };
    const syncEl = $('#syncState');
    const showSync = (st) => {
      const txt = { synced: 'Serveur', saving: 'Envoi…', error: 'Serveur injoignable', offline: 'Navigateur' }[st] || '';
      syncEl.className = 'sync ' + st;
      syncEl.textContent = txt;
      syncEl.title = st === 'offline' ? 'Réglages enregistrés dans ce navigateur uniquement (pas de serveur)' : st === 'error' ? 'Le serveur ne répond pas : les modifications seront renvoyées automatiquement' : 'Réglages et projets enregistrés sur le serveur';
    };
    CNC.sync.onStatus = showSync;
    showSync(CNC.sync.status);
    $('#fileOpen').onchange = (e) => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ''; };
    $('#fileSvg').onchange = (e) => { if (e.target.files[0]) importSvgFile(e.target.files[0]); e.target.value = ''; };
    $('#fileRelief').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try {
        const im = await CNC.relief.fromFile(f, 300);
        const st = App.project.stock, asp = im.w / im.h;
        let w = st.w * 0.8, h = w / asp;
        if (h > st.h * 0.8) { h = st.h * 0.8; w = h * asp; }
        const sh = G.make('relief', st.w / 2, st.h / 2, { w: CNC.round(w, 2), h: CNC.round(h, 2), img: im, name: f.name, relief: { invert: false, rough: true, allow: 0.3, fstep: 0 } });
        sh.cut = { type: 'relief', depth: Math.min(3, st.t) };
        E.addShape(sh);
      } catch (err) { alert('Import de l\'image impossible : ' + err.message); }
    };
    $('#projName').addEventListener('change', (e) => { App.project.name = e.target.value || 'Sans titre'; CNC.store.set('project', App.project); });
    $('#zIn').onclick = () => E.zoom(1.25);
    $('#zOut').onclick = () => E.zoom(0.8);
    $('#zFit').onclick = () => E.fit();
    // sauvegarde / restauration de tous les réglages stockés dans le navigateur
    const reset3d = CNC.el('button', { class: 'meas3d', style: 'top:54px', title: 'Recentrer la vue 3D' }, '⤢');
    $('#pane3d').append(reset3d);
    reset3d.onclick = () => CNC.view3d.reframe();
    const backupFile = CNC.el('input', { type: 'file', accept: '.json', hidden: true });
    document.body.append(backupFile);
    backupFile.onchange = async () => {
      try {
        const data = JSON.parse(await backupFile.files[0].text());
        if (data.app !== 'easycnc-backup' || typeof data.items !== 'object') throw new Error('fichier de sauvegarde non reconnu');
        if (!confirm('Remplacer vos profils, fraises et projet actuels par cette sauvegarde ?')) return;
        for (const [k, v] of Object.entries(data.items)) if (k.startsWith('easycnc.')) { localStorage.setItem(k, v); CNC.sync.push(k, v); }        await CNC.sync.flushNow(); // le serveur doit recevoir la sauvegarde avant le rechargement (sinon il écraserait l'import)        location.reload();
      } catch (e) { alert('Restauration impossible : ' + e.message); }
      backupFile.value = '';
    };
    $('#btnBackup').onclick = () => CNC.modal({
      title: 'Sauvegarde des réglages',
      body: CNC.el('div', {},
        CNC.el('p', {}, CNC.projects.available() ? 'Vos réglages et projets sont enregistrés sur le serveur (avec une sauvegarde automatique par jour). Cet export sert de copie de sécurité supplémentaire.' : 'Vos profils machines, fraises perso, réglages du palpeur et le projet en cours sont stockés dans ce navigateur. Exportez-les pour les conserver ou les transférer sur un autre PC.'),
        CNC.el('div', { class: 'btns' },
          CNC.el('button', { class: 'btn primary', onclick: () => {
            const items = {};
            for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith('easycnc.')) items[k] = localStorage.getItem(k); }
            CNC.download('easycnc-sauvegarde.json', JSON.stringify({ app: 'easycnc-backup', version: 1, items }, null, 1), 'application/json');
          } }, 'Exporter tous mes réglages'),
          CNC.el('button', { class: 'btn', onclick: () => backupFile.click() }, 'Importer une sauvegarde…'))),
      buttons: [{ label: 'Fermer' }],
    });
    const measBtn3d = CNC.el('button', { class: 'meas3d', title: 'Afficher / masquer les mesures' }, '📏');
    $('#pane3d').append(measBtn3d);
    const applyMeasures = (on) => {
      E.showMeasures = on; CNC.store.set('measures', on); CNC.view3d.setMeasures(on);
      $('#zMeas').classList.toggle('on', on); measBtn3d.classList.toggle('on', on); E.render();
    };
    $('#zMeas').onclick = () => applyMeasures(!E.showMeasures);
    measBtn3d.onclick = () => applyMeasures(!E.showMeasures);
    applyMeasures(E.showMeasures);

    App.setTab('design');
  }

  window.addEventListener('DOMContentLoaded', boot);
})();
