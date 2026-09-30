// Fenêtres modales et gestionnaires de profils (machines, fraises).
(function () {
  const CNC = window.CNC;
  const { el } = CNC;

  CNC.modal = ({ title, body, buttons, narrow, onClose }) => {
    const close = () => { ov.remove(); onClose && onClose(); };
    const ov = el('div', { class: 'overlay', onmousedown: (e) => { if (e.target === ov) close(); } },
      el('div', { class: 'modal' + (narrow ? ' narrow' : '') },
        el('header', {}, title),
        el('div', { class: 'body' }, body),
        el('footer', {}, (buttons || [{ label: 'Fermer' }]).map((b) =>
          el('button', { class: 'btn ' + (b.cls || ''), onclick: () => { if (!b.onclick || b.onclick() !== false) { if (!b.keep) close(); } } }, b.label)))));
    document.body.appendChild(ov);
    return { close, root: ov };
  };

  CNC.confirmModal = (title, body, okLabel) =>
    new Promise((res) => {
      let done = false;
      CNC.modal({
        title, body, narrow: true,
        buttons: [
          { label: 'Annuler', onclick: () => { done = true; res(false); } },
          { label: okLabel || 'OK', cls: 'primary', onclick: () => { done = true; res(true); } },
        ],
        onClose: () => { if (!done) res(false); },
      });
    });

  const getPath = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const setPath = (o, path, v) => {
    const ks = path.split('.');
    const last = ks.pop();
    ks.reduce((a, k) => (a[k] = a[k] || {}), o)[last] = v;
  };

  // cfg : { title, all(), user (tableau modifiable), save(), fields, group(rec), label(rec), blank(), current(), onUse(id), onEdit(), file }
  CNC.openManager = (cfg) => {
    let sel = cfg.current();
    const list = el('div', { class: 'mgr-list' });
    const form = el('div', { class: 'mgr-form' });
    const body = el('div', { class: 'mgr' }, list, form);
    const rec = () => cfg.all().find((r) => r.id === sel) || cfg.all()[0];

    function rebuild() {
      list.innerHTML = '';
      const groups = {};
      cfg.all().forEach((r) => (groups[cfg.group(r)] = groups[cfg.group(r)] || []).push(r));
      for (const [g, items] of Object.entries(groups)) {
        list.append(el('h4', {}, g));
        items.forEach((r) => list.append(el('button', { class: 'mgr-item' + (r.id === rec().id ? ' on' : ''), onclick: () => { sel = r.id; rebuild(); } }, cfg.label(r))));
      }
      form.innerHTML = '';
      const r = rec();
      if (r.builtin) form.append(el('div', { class: 'warn' }, 'Profil intégré (valeurs indicatives, non modifiable). Utilisez « Dupliquer » pour créer votre version.'));
      if (cfg.preview) form.append(cfg.preview(r));
      if (r.notes && !cfg.fields.some((f) => f[0] === 'notes')) form.append(el('div', { class: 'muted' }, r.notes));
      for (const [path, label, type, opts] of cfg.fields) {
        let input;
        const val = getPath(r, path);
        if (type === 'select') {
          input = el('select', {}, opts.map(([v, t]) => el('option', { value: v }, t)));
          input.value = val == null ? '' : val;
        } else if (type === 'check') {
          input = el('input', { type: 'checkbox' });
          input.checked = !!val;
        } else if (type === 'area') {
          input = el('textarea', { spellcheck: 'false' });
          input.value = val || '';
        } else {
          input = el('input', { type: type === 'num' ? 'number' : 'text', step: 'any' });
          input.value = val == null ? '' : val;
        }
        input.disabled = !!r.builtin;
        input.addEventListener('change', () => {
          let v = type === 'check' ? input.checked : input.value;
          if (type === 'num') v = input.value === '' ? undefined : parseFloat(input.value);
          setPath(r, path, v);
          cfg.save();
          if (r.id === cfg.current()) cfg.onEdit && cfg.onEdit();
          if (path === 'name' || path === 'brand') rebuild();
        });
        form.append(el('div', { class: 'row' }, el('label', {}, label), el('div', { class: 'grow' }, input)));
      }
    }

    const fileIn = el('input', { type: 'file', accept: '.json', hidden: true });
    fileIn.addEventListener('change', async () => {
      try {
        const data = JSON.parse(await fileIn.files[0].text());
        (Array.isArray(data) ? data : [data]).forEach((d) => {
          cfg.user.push({ ...d, id: CNC.uid(), builtin: false });
        });
        cfg.save(); rebuild();
      } catch (e) { alert('Import impossible : ' + e.message); }
      fileIn.value = '';
    });

    const copyOf = (r) => ({ ...CNC.deepCopy(r), id: CNC.uid(), builtin: false, name: r.name + (r.builtin ? ' (copie)' : ' (copie)') });
    const m = CNC.modal({
      title: cfg.title, body: el('div', {}, body, fileIn),
      buttons: [
        { label: 'Nouveau', keep: true, onclick: () => { const n = cfg.blank(); cfg.user.push(n); sel = n.id; cfg.save(); rebuild(); } },
        { label: 'Dupliquer', keep: true, onclick: () => { const n = copyOf(rec()); cfg.user.push(n); sel = n.id; cfg.save(); rebuild(); } },
        { label: 'Supprimer', cls: 'danger', keep: true, onclick: () => {
          const r = rec();
          if (r.builtin || !confirm(`Supprimer « ${cfg.label(r)} » ?`)) return;
          cfg.user.splice(cfg.user.findIndex((x) => x.id === r.id), 1);
          cfg.save(); sel = cfg.all()[0].id; rebuild();
          if (r.id === cfg.current()) cfg.onUse(sel);
        } },
        { label: 'Exporter mes profils', keep: true, onclick: () => CNC.download(cfg.file, JSON.stringify(cfg.user, null, 2), 'application/json') },
        { label: 'Importer', keep: true, onclick: () => fileIn.click() },
        { label: 'Utiliser ce profil', cls: 'primary', onclick: () => cfg.onUse(rec().id) },
      ],
    });
    rebuild();
    return m;
  };

  CNC.machineFields = [
    ['brand', 'Marque', 'text'],
    ['name', 'Modèle', 'text'],
    ['area.x', 'Course X (mm)', 'num'],
    ['area.y', 'Course Y (mm)', 'num'],
    ['area.z', 'Course Z (mm)', 'num'],
    ['baud', 'Vitesse série (bauds)', 'num'],
    ['maxFeed', 'Avance max XY (mm/min)', 'num'],
    ['maxFeedZ', 'Avance max Z (mm/min)', 'num'],
    ['rapid', 'Vitesse rapide (estimation)', 'num'],
    ['spindle.mode', 'Broche', 'select', [['grbl', 'Pilotée par GRBL (M3 S…)'], ['manual', 'Manuelle (pause M0)'], ['none', 'Aucune']]],
    ['spindle.minRpm', 'Vitesse mini (tr/min)', 'num'],
    ['spindle.maxRpm', 'Vitesse maxi (tr/min)', 'num'],
    ['spindle.sMax', 'S maxi = $30 de GRBL', 'num'],
    ['spindle.spinupSec', 'Attente montée en vitesse (s)', 'num'],
    ['safeZ', 'Hauteur de dégagement (mm)', 'num'],
    ['probe.plate', 'Palpeur : épaisseur plaque (mm)', 'num'],
    ['probe.feed', 'Palpeur : avance (mm/min)', 'num'],
    ['probe.maxDepth', 'Palpeur : course max (mm)', 'num'],
    ['probe.retract', 'Palpeur : remontée (mm)', 'num'],
    ['homing', 'Homing $H disponible', 'check'],
    ['preamble', 'G-code avant le programme', 'area'],
    ['postamble', 'G-code après le programme', 'area'],
    ['notes', 'Notes', 'area'],
  ];
  CNC.bitFields = [
    ['name', 'Nom', 'text'],
    ['type', 'Type', 'select', [['flat', 'Droite'], ['ball', 'Sphérique'], ['vbit', 'Gravure en V']]],
    ['diameter', 'Diamètre (mm, pointe pour V)', 'num'],
    ['flutes', 'Nombre de dents', 'num'],
    ['cutLength', 'Longueur de coupe (mm)', 'num'],
    ['shank', 'Queue (mm)', 'num'],
    ['refDia', 'Diamètre de calcul (opt.)', 'num'],
    ['docMax', 'Passe max (mm, opt.)', 'num'],
    ['angle', 'Angle de la pointe V (°)', 'num'],
  ];
})();
