// Application : projet, onglet « Dessiner », fichiers, import SVG.
(function () {
  const CNC = window.CNC;
  const { el, $ } = CNC;
  const E = CNC.editor;
  const G = CNC.geom;
  const App = (CNC.app = {});

  const newProject = () => ({
    name: 'Sans titre',
    stock: { w: 200, h: 120, t: 12, materialId: 'mdf' },
    shapes: [],
    machineId: CNC.store.get('machineId', 'genmitsu-3018-prover'),
    bitId: 'flat2-3175',
    over: {}, // paramètres de coupe modifiés à la main
    sMax: null, // S maxi détecté ($30)
    origin: 'bl',
    overcut: 0.2, // sur-profondeur pour les découpes traversantes
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
      ['pocket', 'Poche (évidement)'], ['none', 'Ne pas usiner'],
    ].map(([v, t]) => el('option', { value: v }, t)));
    cutSel.addEventListener('change', () => forEachSel((sh) => { sh.cut = { ...sh.cut, type: cutSel.value }; }));
    const fd = reg(field('Profondeur', {
      get: () => (E.selected()[0] ? E.selected()[0].cut.depth : null),
      set: (v) => forEachSel((sh) => { sh.cut = { ...sh.cut, depth: Math.min(v, st().t) }; }),
      min: 0, unit: 'mm', disabled: () => !E.selection.length,
    }));
    const cardShape = el('div', { class: 'card' },
      el('h3', {}, 'Forme'),
      el('div', { class: 'grid2' }, fX.row, fY.row, fw.row, fh.row),
      fr.row, sidesRow,
      el('h3', { style: 'margin-top:14px' }, 'Usinage'),
      el('div', { class: 'row' }, el('label', {}, 'Type'), el('div', { class: 'grow' }, cutSel)),
      fd.row,
      el('div', { class: 'btns' },
        el('button', { class: 'btn sm', onclick: () => forEachSel((sh) => { sh.cut = { ...sh.cut, depth: st().t }; }) }, 'Traversant'),
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
      if (sel.length) {
        cutSel.value = sel[0].cut.type;
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
      el('hr'),
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
    applyView(tab === 'carve' ? App.viewMode : '2d');
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
    $('#btnSave').onclick = saveFile;
    $('#btnOpen').onclick = () => $('#fileOpen').click();
    $('#fileOpen').onchange = (e) => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ''; };
    $('#fileSvg').onchange = (e) => { if (e.target.files[0]) importSvgFile(e.target.files[0]); e.target.value = ''; };
    $('#projName').addEventListener('change', (e) => { App.project.name = e.target.value || 'Sans titre'; CNC.store.set('project', App.project); });
    $('#zIn').onclick = () => E.zoom(1.25);
    $('#zOut').onclick = () => E.zoom(0.8);
    $('#zFit').onclick = () => E.fit();
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
