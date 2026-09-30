// Fenêtre « Réglages GRBL » : lecture ($$) et modification des réglages importants, avec explications.
(function () {
  const CNC = window.CNC;
  const { el } = CNC;

  // [code, libellé, explication, type ('num' | 'mask' | 'bool')]
  const GROUPS = [
    ['Homing (prise d\'origine machine)', [
      ['$22', 'Homing activé', '1 = la commande $H est autorisée.', 'bool'],
      ['$23', 'Sens du homing', 'Par axe : case cochée = le contact est cherché dans l\'autre sens. Le Z doit aller chercher le contact du HAUT pour ne pas heurter le plateau.', 'mask'],
      ['$24', 'Homing : avance de précision', 'mm/min, dernière approche lente du contact.', 'num'],
      ['$25', 'Homing : avance de recherche', 'mm/min, approche rapide du contact.', 'num'],
      ['$27', 'Dégagement après contact', 'mm dont la machine recule une fois le contact trouvé.', 'num'],
    ]],
    ['Limites', [
      ['$20', 'Limites logicielles', '1 = GRBL refuse les déplacements hors de la course (nécessite un homing réussi).', 'bool'],
      ['$21', 'Limites matérielles', '1 = les fins de course arrêtent la machine en cours d\'usinage.', 'bool'],
      ['$130', 'Course X', 'mm.', 'num'], ['$131', 'Course Y', 'mm.', 'num'], ['$132', 'Course Z', 'mm.', 'num'],
    ]],
    ['Axes', [
      ['$3', 'Sens des moteurs', 'Par axe : case cochée = sens de déplacement inversé (à ne changer que si un axe va dans le mauvais sens).', 'mask'],
      ['$100', 'Pas/mm X', '', 'num'], ['$101', 'Pas/mm Y', '', 'num'], ['$102', 'Pas/mm Z', '', 'num'],
      ['$110', 'Vitesse max X', 'mm/min.', 'num'], ['$111', 'Vitesse max Y', 'mm/min.', 'num'], ['$112', 'Vitesse max Z', 'mm/min.', 'num'],
    ]],
    ['Broche, laser, palpeur', [
      ['$30', 'Vitesse broche maxi (S)', 'Valeur S correspondant à 100 %.', 'num'],
      ['$31', 'Vitesse broche mini (S)', '', 'num'],
      ['$32', 'Mode laser', '1 = mode laser (puissance liée à la vitesse). À 0 pour fraiser.', 'bool'],
      ['$6', 'Palpeur : signal inversé', '1 si le palpeur est détecté « à l\'envers ».', 'bool'],
    ]],
  ];
  const AXES = [['X', 1], ['Y', 2], ['Z', 4]];

  CNC.grblSettings = (grbl, log) => {
    const body = el('div', { class: 'gs' });
    let modal;

    const setVal = async (code, v) => {
      try {
        await grbl.send(`${code}=${v}`);
        grbl.settings[code] = v;
        log('i', `${code}=${v} enregistré dans la machine.`);
        CNC.toast(`${code} = ${v} enregistré`);
      } catch (e) {
        log('e', `${code} refusé : ${e.message}`);
        CNC.toast(`${code} refusé par la machine`, 'err');
      }
      render();
    };

    function row([code, label, hint, type]) {
      const cur = grbl.settings[code];
      let input;
      if (cur === undefined) return el('div', { class: 'gsrow' }, el('div', { class: 'gsl' }, el('b', {}, `${code}  ${label}`), el('div', { class: 'muted' }, 'Non renvoyé par la machine.')));
      if (type === 'mask') {
        input = el('div', { class: 'gsmask' }, AXES.map(([ax, bit]) => {
          const cb = el('input', { type: 'checkbox' });
          cb.checked = (cur & bit) !== 0;
          cb.addEventListener('change', () => {
            const nv = cb.checked ? cur | bit : cur & ~bit;
            if (code === '$23' && ax === 'Z' && !confirm('Changer le sens du homing du Z.\n\nPour tester : mains près de l\'arrêt d\'urgence, plateau retiré ou Z relevé à mi-course. Le Z doit monter vers le contact du haut.\n\nContinuer ?')) { cb.checked = !cb.checked; return; }
            setVal(code, nv);
          });
          return el('label', {}, cb, ' ' + ax);
        }));
      } else if (type === 'bool') {
        const cb = el('input', { type: 'checkbox' });
        cb.checked = !!cur;
        cb.addEventListener('change', () => setVal(code, cb.checked ? 1 : 0));
        input = el('label', {}, cb, ' activé');
      } else {
        input = el('input', { type: 'number', step: 'any', value: cur });
        input.addEventListener('change', () => { const v = parseFloat(input.value); if (!Number.isNaN(v)) setVal(code, v); else render(); });
      }
      return el('div', { class: 'gsrow' }, el('div', { class: 'gsl' }, el('b', {}, `${code}  ${label}`), hint ? el('div', { class: 'muted' }, hint) : null), el('div', { class: 'gsi' }, input));
    }

    function render() {
      body.innerHTML = '';
      if (!grbl.connected) { body.append(el('div', { class: 'warn' }, 'Connectez d\'abord la machine.')); return; }
      if (!Object.keys(grbl.settings).length) body.append(el('div', { class: 'warn' }, 'Aucun réglage reçu pour l\'instant : cliquez sur « Relire les réglages ».'));
      const z = grbl.settings.$23;
      if (z !== undefined) {
        const up = (z & 4) !== 0;
        body.append(el('div', { class: 'muted', style: 'margin-bottom:8px' },
          `$23 = ${z} : le Z ${up ? 'a son sens de homing INVERSÉ (case Z cochée)' : 'a son sens de homing par défaut (case Z décochée)'}. ` +
          'Si le Z descend pendant le homing, essayez de ' + (up ? 'décocher' : 'cocher') + ' la case Z ci-dessous (sens $23), avec le plateau retiré pour le premier essai.'));
      }
      for (const [title, rows] of GROUPS) {
        body.append(el('h4', {}, title));
        rows.forEach((r) => body.append(row(r)));
      }
    }

    const reread = async () => {
      try { await grbl.send('$$'); } catch (e) { log('e', e.message); }
      setTimeout(render, 600);
    };
    modal = CNC.modal({
      title: 'Réglages GRBL de la machine',
      body: el('div', {}, el('div', { class: 'warn' }, 'Ces réglages sont enregistrés dans la mémoire de la machine. Modifiez-les avec précaution, un à la fois, et notez les valeurs d\'origine.'), body),
      buttons: [{ label: 'Relire les réglages', keep: true, onclick: reread }, { label: 'Fermer' }],
    });
    if (grbl.connected && !Object.keys(grbl.settings).length) reread(); else render();
    return modal;
  };
})();
