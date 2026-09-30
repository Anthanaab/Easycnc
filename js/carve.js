// Onglet « Fraiser » : machine, fraise, paramètres, aperçu, G-code, pilotage GRBL.
(function () {
  const CNC = window.CNC;
  const { el } = CNC;
  const TP = CNC.toolpath;

  CNC.buildCarvePanel = (App) => {
    const E = CNC.editor;
    const P = () => App.project;
    const grbl = App.grbl;
    let job = null, timer = null, playing = false;

    const card = (num, title, ...kids) => el('div', { class: 'card' }, el('h3', {}, el('span', { class: 'num' }, num), title), ...kids);
    const select = (onchange) => { const s = el('select'); s.addEventListener('change', () => onchange(s.value)); return s; };
    const row = (label, node) => el('div', { class: 'row' }, el('label', {}, label), el('div', { class: 'grow' }, node));

    // ---------- 1. Machine ----------
    const machSel = select((v) => {
      P().machineId = v; P().over = {}; P().sMax = null;
      CNC.store.set('machineId', v); E.fit();
      refreshAll(); recompute();
    });
    const machInfo = el('div', { class: 'muted' });
    const machWarn = el('div');
    const fillMachines = () => {
      machSel.innerHTML = '';
      const groups = {};
      CNC.machines().forEach((m) => (groups[m.brand] = groups[m.brand] || []).push(m));
      for (const [brand, items] of Object.entries(groups)) {
        machSel.append(el('optgroup', { label: brand }, items.map((m) => el('option', { value: m.id }, m.name))));
      }
      machSel.value = CNC.machine(P().machineId).id;
    };
    const manageMachines = () => CNC.openManager({
      title: 'Profils machines', all: CNC.machines, user: CNC.userMachines, save: CNC.saveUserMachines,
      fields: CNC.machineFields, group: (m) => m.brand || 'Sans marque', label: (m) => m.name,
      blank: () => ({ ...CNC.deepCopy(CNC.data.MACHINES[CNC.data.MACHINES.length - 1]), id: CNC.uid(), builtin: false, brand: 'Personnalisé', name: 'Nouvelle machine' }),
      current: () => P().machineId,
      onUse: (id) => { P().machineId = id; P().over = {}; P().sMax = null; CNC.store.set('machineId', id); refreshAll(); recompute(); },
      onEdit: () => { refreshAll(); recompute(); },
      file: 'profils-machines.json',
    });
    const c1 = card(1, 'Machine', row('Profil', machSel), machInfo, machWarn,
      el('div', { class: 'btns' }, el('button', { class: 'btn sm', onclick: manageMachines }, 'Gérer les profils…')));

    // ---------- 2. Matériau & fraise ----------
    const matSel = select((v) => { E.snapshot(); P().stock.materialId = v; P().over = {}; refreshAll(); E.changed(); });
    CNC.data.MATERIALS.forEach((m) => matSel.append(el('option', { value: m.id }, m.name)));
    const bitSel = select((v) => { P().bitId = v; P().over = {}; refreshAll(); recompute(); });
    const fillBits = () => {
      bitSel.innerHTML = '';
      const groups = {};
      CNC.bits().forEach((b) => (groups[b.builtin ? CNC.bitCategory(b) : 'Mes fraises'] = groups[b.builtin ? CNC.bitCategory(b) : 'Mes fraises'] || []).push(b));
      for (const [g, items] of Object.entries(groups)) bitSel.append(el('optgroup', { label: g }, items.map((b) => el('option', { value: b.id }, b.name))));
      bitSel.value = CNC.bit(P().bitId).id;
    };
    const manageBits = () => CNC.openManager({
      title: 'Fraises', all: CNC.bits, user: CNC.userBits, save: CNC.saveUserBits,
      fields: CNC.bitFields, group: (b) => (b.builtin ? CNC.bitCategory(b) : 'Mes fraises'), label: (b) => b.name,
      blank: () => ({ id: CNC.uid(), builtin: false, name: 'Nouvelle fraise', type: 'flat', diameter: 3.175, flutes: 2, cutLength: 12, shank: 3.175 }),
      current: () => P().bitId,
      onUse: (id) => { P().bitId = id; P().over = {}; refreshAll(); recompute(); },
      onEdit: () => { refreshAll(); recompute(); },
      preview: CNC.bitCard,
      file: 'fraises.json',
    });
    const bitWarn = el('div');
    const bitHolder = el('div');
    const c2 = card(2, 'Matériau et fraise', row('Matériau', matSel), row('Fraise', bitSel), bitHolder, bitWarn,
      el('div', { class: 'btns' }, el('button', { class: 'btn sm', onclick: manageBits }, 'Gérer les fraises…')));

    // ---------- 3. Paramètres ----------
    const pfields = [];
    const pf = (label, key, unit, min) => {
      const f = App.field(label, {
        get: () => App.params()[key], unit, min,
        set: (v) => { P().over[key] = v; refreshParams(); recompute(); },
      });
      pfields.push(f); return f.row;
    };
    const originSel = select((v) => { P().origin = v; recompute(); });
    originSel.append(el('option', { value: 'bl' }, 'Coin bas-gauche du matériau'), el('option', { value: 'center' }, 'Centre du matériau'));
    const sInfo = el('div', { class: 'muted' });
    const facChk = el('input', { type: 'checkbox' });
    facChk.addEventListener('change', () => { P().facing.on = facChk.checked; facDepth.row.style.display = facChk.checked ? '' : 'none'; recompute(); });
    const facDepth = App.field('Profondeur', { get: () => P().facing.depth, set: (v) => { P().facing.depth = v; recompute(); }, unit: 'mm', min: 0.05 });
    pfields.push(facDepth);
    const facBox = el('div', {},
      el('label', { style: 'display:flex;gap:8px;align-items:center;margin:8px 0 2px' }, facChk, 'Surfacer le dessus avant l\'usinage'),
      facDepth.row,
      el('div', { class: 'muted' }, 'Passe de mise à plat sur tout le matériau (fraise ≥ 6 mm conseillée). Les profondeurs des formes restent comptées depuis le dessus d\'origine (Z0).'));
    const c3 = card(3, 'Paramètres de coupe',
      pf('Broche', 'rpm', 'tr/min', 1), pf('Avance', 'feed', 'mm/min', 1), pf('Plongée', 'plunge', 'mm/min', 1),
      pf('Passe', 'doc', 'mm', 0.01), pf('Recouvrt.', 'stepover', 'mm', 0.01), pf('Dégagement', 'safeZ', 'mm', 1),
      row('Origine X0 Y0', originSel), sInfo, facBox,
      el('div', { class: 'btns' }, el('button', { class: 'btn sm', onclick: () => { P().over = {}; refreshParams(); recompute(); } }, 'Valeurs automatiques')));

    // ---------- 4. Aperçu ----------
    const warnBox = el('div');
    const stats = el('div');
    const slider = el('input', { type: 'range', min: 0, max: 1000, value: 1000 });
    const playBtn = el('button', { class: 'btn sm' }, '▶ Lecture');
    const rapidChk = el('input', { type: 'checkbox', checked: true });
    const dlBtn = el('button', { class: 'btn primary', onclick: () => { if (job) CNC.download((P().name || 'projet') + '.nc', job.lines.join('\n')); } }, 'Télécharger le G-code');
    rapidChk.addEventListener('change', () => { E.showRapids = rapidChk.checked; E.render(); });
    slider.addEventListener('input', () => { stopPlay(); E.setProgress(slider.value / 1000); });
    function stopPlay() { playing = false; playBtn.textContent = '▶ Lecture'; }
    playBtn.addEventListener('click', () => {
      if (!E.sim) return;
      if (playing) return stopPlay();
      playing = true; playBtn.textContent = '⏸ Pause';
      if (E.sim.progress >= 1) E.sim.progress = 0;
      let last = performance.now();
      const tick = (t) => {
        if (!playing || !E.sim) return;
        E.sim.progress = Math.min(1, E.sim.progress + (t - last) / 10000);
        last = t;
        slider.value = E.sim.progress * 1000;
        E.render();
        if (E.sim.progress >= 1) return stopPlay();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    // ---------- Laser (mode alternatif à la fraise) ----------
    const L = CNC.laser;
    const LS = () => (P().laser = P().laser || L.defaults());
    const lcfg = () => L.cfg(P().machineId);
    const getPath = (o, p) => p.split('.').reduce((a, k) => a && a[k], o);
    const lfields = [];
    const lf = (label, path, unit, min, step) => {
      const f = App.field(label, {
        get: () => getPath(LS(), path), unit, min, step,
        set: (v) => { const ks = path.split('.'), last = ks.pop(); ks.reduce((a, k) => a[k], LS())[last] = v; LS().preset = 'custom'; recompute(); },
      });
      lfields.push(f); return f.row;
    };
    const enChk = el('input', { type: 'checkbox' });
    enChk.addEventListener('change', () => { L.setCfg(P().machineId, { enabled: enChk.checked }); refreshAll(); recompute(); });
    const powF = App.field('Puissance', { get: () => lcfg().power || null, unit: 'W', min: 0.1, set: (v) => { L.setCfg(P().machineId, { power: v }); recompute(); } });
    const waveF = App.field('Longueur d\'onde', { get: () => lcfg().wave || null, unit: 'nm', min: 100, set: (v) => { L.setCfg(P().machineId, { wave: v }); recompute(); } });
    lfields.push(powF, waveF);
    const cmdSel = select((v) => { L.setCfg(P().machineId, { cmd: v }); recompute(); });
    cmdSel.append(el('option', { value: 'M4' }, 'M4 (puissance dynamique, recommandé)'), el('option', { value: 'M3' }, 'M3 (puissance constante)'));
    const presetSel = select((v) => {
      if (v === 'custom') return;
      const p = L.presets[v];
      const s = LS();
      s.preset = v; s.line = { ...p.line }; s.fill = { ...p.fill }; s.image = { ...p.image };
      refreshAll(); recompute();
    });
    presetSel.append(el('option', { value: 'custom' }, 'Personnalisé'), ...Object.entries(L.presets).map(([k, p]) => el('option', { value: k }, p.name)));
    const imgMode = select((v) => { LS().image.mode = v; LS().preset = 'custom'; recompute(); });
    imgMode.append(el('option', { value: 'gray' }, 'Niveaux de gris (puissance variable)'), el('option', { value: 'thresh' }, 'Noir et blanc (seuil)'));
    const originSelL = select((v) => { P().origin = v; recompute(); });
    originSelL.append(el('option', { value: 'bl' }, 'Coin bas-gauche du matériau'), el('option', { value: 'center' }, 'Centre du matériau'));
    const frameBtn = el('button', { class: 'btn sm', onclick: () => frameLaser() }, 'Cadrer (très faible puissance)');
    const laserWarn = el('div');
    const cL = card(3, 'Laser',
      el('label', { style: 'display:flex;gap:8px;align-items:center;margin:4px 0' }, enChk, 'Un module laser est monté sur cette machine'),
      powF.row, waveF.row, row('Commande', cmdSel),
      el('div', { class: 'muted' }, 'Puissance optique et longueur d\'onde figurent sur l\'étiquette du module (elles servent au G-code et aux consignes de sécurité). Mode laser GRBL requis : $32 = 1.'),
      laserWarn,
      el('h3', { style: 'margin-top:14px' }, 'Matériau'), row('Réglages', presetSel),
      el('div', { class: 'muted' }, 'Valeurs de départ prudentes : testez sur une chute et ajustez puissance et vitesse.'),
      el('h3', { style: 'margin-top:14px' }, 'Contour (ligne)'), lf('Puissance', 'line.power', '%', 1, 1), lf('Vitesse', 'line.speed', 'mm/min', 10), lf('Passes', 'line.passes', '', 1, 1),
      el('h3', { style: 'margin-top:14px' }, 'Remplissage'), lf('Puissance', 'fill.power', '%', 1, 1), lf('Vitesse', 'fill.speed', 'mm/min', 10), lf('Interligne', 'fill.interval', 'mm', 0.03), lf('Angle', 'fill.angle', '°', 0, 1),
      el('h3', { style: 'margin-top:14px' }, 'Image'), row('Mode', imgMode), lf('Puissance mini', 'image.min', '%', 0, 1), lf('Puissance maxi', 'image.max', '%', 1, 1), lf('Vitesse', 'image.speed', 'mm/min', 10), lf('Interligne', 'image.interval', 'mm', 0.03),
      el('h3', { style: 'margin-top:14px' }, 'Origine et cadrage'), row('Origine X0 Y0', originSelL), lf('Puissance', 'frame.power', '%', 0, 0.5), lf('Vitesse', 'frame.speed', 'mm/min', 100),
      el('div', { class: 'btns' }, frameBtn));

    const c4 = card(4, 'Aperçu et G-code', warnBox, stats,
      el('div', { class: 'row' }, slider),
      el('div', { class: 'btns' }, playBtn, el('label', { class: 'muted' }, rapidChk, ' déplacements rapides')),
      el('div', { class: 'btns' }, dlBtn, el('button', { class: 'btn', onclick: () => recompute() }, 'Recalculer')));

    // ---------- 5. Usinage ----------
    const connBtn = el('button', { class: 'btn primary' }, 'Connecter la machine');
    const stateBadge = el('span', { class: 'badge' }, 'Déconnecté');
    const dro = ['X', 'Y', 'Z'].map((a) => el('div', {}, el('small', {}, a), el('b', {}, '—')));
    const stepSel = el('select', {}, [0.1, 1, 5, 10, 50].map((v) => el('option', { value: v, selected: v === 1 }, v + ' mm')));
    const jogFeed = el('input', { type: 'number', value: 800 });
    const jogBtn = (label, dx, dy, dz, cls) => el('button', { class: cls || '', onclick: () => {
      if (grbl.connected && !grbl.job) { const st = parseFloat(stepSel.value); grbl.jog(dx * st, dy * st, dz * st, parseFloat(jogFeed.value) || 800).catch((e) => log('e', e.message)); }
    } }, label);
    const cmd = (c) => () => { if (grbl.connected) grbl.send(c).catch((e) => log('e', e.message)); };
    const zeroBtns = [
      el('button', { class: 'btn sm', onclick: cmd('G10 L20 P1 X0 Y0') }, 'X0 Y0'),
      el('button', { class: 'btn sm', onclick: cmd('G10 L20 P1 Z0') }, 'Z0'),
      el('button', { class: 'btn sm', onclick: cmd('G10 L20 P1 X0 Y0 Z0') }, 'X0 Y0 Z0'),
    ];
    // ---------- Assistant de palpage Z (pince crocodile sur la fraise + plaque) ----------
    const wiz = el('div', { class: 'wiz', style: 'display:none' });
    const wizState = { on: false, step: 1, phase: 'free0', busy: false, done: false, err: '' };
    const probeParams = () => {
      const pr = CNC.probeOf(App.machine());
      return pr;
    };
    const pinOn = () => /P/.test(grbl.status.pins || '');
    const wizClose = () => { wizState.on = false; wiz.style.display = 'none'; wiz.innerHTML = ''; };
    const wizOpen = () => {
      if (!grbl.connected || grbl.job) return;
      Object.assign(wizState, { on: true, step: 1, phase: pinOn() ? 'free0' : 'contact', busy: false, done: false, err: '' });
      wiz.style.display = ''; wizRender();
    };
    const wizBtns = (...b) => el('div', { class: 'btns' }, ...b);
    const stepper = (n) => el('div', { class: 'muted', style: 'margin-bottom:6px' }, `Palpage Z · étape ${n} sur 3`);

    function wizRender() {
      if (!wizState.on) return;
      const pr = probeParams();
      wiz.innerHTML = '';
      const cancel = el('button', { class: 'btn sm', onclick: wizClose }, wizState.done ? 'Terminer' : 'Annuler');

      if (wizState.step === 1) {
        const checks = ['Pince crocodile attachée à la fraise (ou à la pince ER11), sur une partie métallique propre',
          'Câble du palpeur branché sur l\'entrée « probe » de la carte',
          'Plaque de touche posée à plat sur le matériau, sous la fraise'].map((t) => {
          const cb = el('input', { type: 'checkbox' });
          cb.addEventListener('change', () => refreshNext());
          const lab = el('label', { style: 'display:flex;gap:8px;margin:6px 0;align-items:flex-start' }, cb, t);
          lab.cb = cb; return lab;
        });
        const next = el('button', { class: 'btn primary sm', disabled: true, onclick: () => { wizState.step = 2; wizRender(); } }, 'Suivant');
        const refreshNext = () => { next.disabled = !(checks.every((c) => c.cb.checked) && probeParams().plate > 0); };
        const plate = App.field('Épaisseur plaque', { get: () => pr.plate || null, set: (v) => { CNC.setProbe(CNC.machine(P().machineId), 'plate', v); refreshNext(); }, unit: 'mm', min: 0.1 });
        plate.refresh(); plate.row.style.flexWrap = 'wrap'; plate.row.append(el('div', { class: 'muted', style: 'flex-basis:100%' }, 'Mesurez-la au pied à coulisse : elle sert à régler Z0. Enregistrée pour cette machine.'));
        refreshNext();
        wiz.append(stepper(1), el('b', {}, 'Préparation'), ...checks, plate.row, wizBtns(next, cancel));
        return;
      }

      if (wizState.step === 2) {
        const msgs = {
          free0: ['warn', 'Contact déjà détecté : éloignez la fraise de la plaque (ou vérifiez que la pince ne touche pas la broche/le châssis).'],
          contact: ['', 'Touchez la plaque avec la pointe de la fraise, à la main, pour tester le circuit…'],
          release: ['', '✓ Contact détecté ! Écartez maintenant la fraise de la plaque.'],
          ok: ['ok', '✓ Contact détecté puis relâché : le palpeur est correctement câblé.'],
        };
        const [cls, txt] = msgs[wizState.phase];
        const next = el('button', { class: 'btn primary sm', disabled: wizState.phase !== 'ok', onclick: () => { wizState.step = 3; wizRender(); } }, 'Suivant');
        wiz.append(stepper(2), el('b', {}, 'Test du circuit'),
          el('div', { class: 'warn' + (cls === 'warn' ? '' : ''), style: cls === 'ok' ? 'background:#dcfce7;color:#166534' : '' }, txt),
          el('div', { class: 'muted' }, 'Utilisez les flèches de déplacement ci-dessous pour amener la fraise juste au-dessus de la plaque.'),
          el('div', { class: 'muted' }, 'Palpeur : ' + (pinOn() ? '● contact' : '○ libre')),
          wizBtns(el('button', { class: 'btn sm', onclick: () => { wizState.step = 1; wizRender(); } }, 'Retour'), next, cancel));
        return;
      }

      // étape 3 : palpage
      const run = el('button', { class: 'btn ok sm', disabled: wizState.busy || wizState.done || pinOn(), onclick: wizRun }, wizState.busy ? 'Palpage…' : 'Lancer le palpage');
      wiz.append(...[stepper(3), el('b', {}, 'Palpage'),
        el('div', { class: 'muted', style: 'margin:6px 0' }, `La fraise descendra jusqu'à ${pr.maxDepth} mm à ${pr.feed} mm/min jusqu'au contact avec la plaque (${pr.plate} mm), puis Z0 sera défini sur le dessus du matériau et la fraise remontera de ${pr.retract} mm. Restez près de l'arrêt d'urgence.`),
        pinOn() ? el('div', { class: 'warn' }, 'Le palpeur est déjà en contact : écartez la fraise de la plaque.') : null,
        wizState.err ? el('div', { class: 'warn err' }, wizState.err) : null,
        wizState.done ? el('div', { class: 'warn', style: 'background:#dcfce7;color:#166534' }, '✓ Z0 défini sur le dessus du matériau. Retirez la plaque et la pince crocodile.') : null,
        el('div', { class: 'muted wizz', style: 'margin:6px 0' }, wizState.busy ? 'Descente en cours… Z actuel : ' + (grbl.status.wpos[2] || 0).toFixed(2) + ' mm' : ''),
        wizBtns(wizState.done || wizState.busy ? null : el('button', { class: 'btn sm', onclick: () => { wizState.step = 2; wizState.phase = 'ok'; wizRender(); } }, 'Retour'), wizState.busy ? el('button', { class: 'btn danger sm', onclick: wizAbort }, '■ Arrêt') : run, wizState.busy ? null : cancel)].filter(Boolean));
    }

    function wizAbort() {
      grbl.stop(); // arrêt immédiat (feed hold puis reset)
      wizState.err = 'Palpage interrompu. Déverrouillez avec « Déverrouiller $X » et relevez le Z avant de réessayer.';
      wizState.busy = false; wizRender();
    }

    async function wizRun() {
      const pr = probeParams();
      if (!(pr.plate > 0)) { wizState.err = 'Renseignez l\'épaisseur de votre plaque de palpage (étape 1).'; return wizRender(); }
      const stt = grbl.status.state;
      if (stt !== 'Idle') {
        wizState.err = stt === 'Alarm' ? 'La machine est en alarme : cliquez sur « Déverrouiller $X », puis réessayez.' : `La machine n'est pas prête (état : ${stt}). Attendez l'état « Idle ».`;
        return wizRender();
      }
      wizState.busy = true; wizState.err = ''; wizRender();
      grbl.lastPrb = null;
      try {
        log('i', 'Palpage Z…');
        await grbl.send('G91');
        await grbl.send(`G38.2 Z-${pr.maxDepth} F${pr.feed}`);
        // GRBL envoie [PRB:x,y,z:1] en cas de contact ; une alarme (état « Alarm ») sinon
        await new Promise((r) => setTimeout(r, 400));
        if (grbl.status.state === 'Alarm' || !grbl.lastPrb || !grbl.lastPrb.ok) throw new Error('aucun contact détecté');
        await grbl.send(`G10 L20 P1 Z${pr.plate}`);
        await grbl.send(`G0 Z${pr.retract}`);
        await grbl.send('G90');
        wizState.done = true;
        log('i', 'Palpage terminé : Z0 = dessus du matériau.');
      } catch (e) {
        wizState.err = 'Palpage échoué (' + e.message + ' sur ' + pr.maxDepth + ' mm maximum). Si la machine est en alarme, cliquez sur « Déverrouiller $X », relevez le Z, vérifiez la pince et la plaque, puis réessayez.';
        log('e', wizState.err);
        grbl.send('G90').catch(() => {});
      }
      wizState.busy = false; wizRender();
    }

    // appelé à chaque rapport d'état GRBL
    function wizUpdate() {
      if (!wizState.on) return;
      if (!grbl.connected) return wizClose();
      const on = pinOn(), before = wizState.phase;
      if (wizState.phase === 'free0' && !on) wizState.phase = 'contact';
      else if (wizState.phase === 'contact' && on) wizState.phase = 'release';
      else if (wizState.phase === 'release' && !on) wizState.phase = 'ok';
      if (wizState.step === 3 && wizState.busy) { const z = wiz.querySelector('.wizz'); if (z) z.textContent = 'Descente en cours… Z actuel : ' + (grbl.status.wpos[2] || 0).toFixed(2) + ' mm'; return; }
      if (wizState.step === 2 || (wizState.step === 3 && !wizState.busy) || wizState.phase !== before) wizRender();
    }
    const probeBtn = el('button', { class: 'btn sm', onclick: wizOpen }, 'Palper Z…');
    const pinBadge = el('span', { class: 'muted' });
    const startBtn = el('button', { class: 'btn ok' }, '▶ Démarrer');
    const pauseBtn = el('button', { class: 'btn' }, '⏸ Pause');
    const stopBtn = el('button', { class: 'btn danger' }, '■ Arrêt');
    const bar = el('i');
    const progText = el('div', { class: 'muted' });
    const consoleBox = el('div', { class: 'console' });
    const cmdIn = el('input', { type: 'text', placeholder: 'Commande manuelle (Entrée)…' });
    const settingsNote = el('div');
    const homeBtn = el('button', { class: 'btn sm', onclick: cmd('$H') }, 'Homing $H');
    // essai à blanc + fichier G-code externe
    let dryZ = 10, extJob = null;
    const dryChk = el('input', { type: 'checkbox' });
    const dryOff = App.field('Relever de', { get: () => dryZ, set: (v) => { dryZ = v; }, unit: 'mm', min: 1 });
    dryOff.refresh();
    const extIn = el('input', { type: 'file', accept: '.nc,.gcode,.gc,.ngc,.tap,.txt', hidden: true });
    const extLabel = el('div', { class: 'muted' });
    const extClear = el('button', { class: 'btn sm', style: 'display:none', onclick: () => { extJob = null; extRefresh(); updateConn(); } }, 'Revenir au projet');
    const extRefresh = () => {
      extLabel.textContent = extJob ? `Fichier chargé : ${extJob.name} (${extJob.lines.length} lignes) - remplace le projet` : '';
      extClear.style.display = extJob ? '' : 'none';
      dryChk.disabled = !!extJob;
    };
    extIn.addEventListener('change', async () => {
      const f = extIn.files[0]; extIn.value = '';
      if (!f) return;
      extJob = { name: f.name, lines: (await f.text()).split(/\r?\n/) };
      extRefresh(); updateConn();
    });
    const dryBox = el('div', {},
      el('label', { style: 'display:flex;gap:8px;align-items:flex-start;margin:8px 0 2px' }, dryChk, 'Essai à blanc : parcours relevé, broche non démarrée (à faire avant la première vraie coupe)'),
      dryOff.row,
      el('div', { class: 'btns' }, el('button', { class: 'btn sm', onclick: () => frameMill() }, 'Cadrer le parcours (Z relevé)'), el('button', { class: 'btn sm', onclick: () => extIn.click() }, 'Charger un fichier G-code…'), extClear, extIn), extLabel);

    const c5 = card(5, 'Usinage',
      el('div', { class: 'row' }, connBtn, stateBadge),
      el('div', {}, dro && el('div', { class: 'dro' }, dro)),
      pinBadge, wiz, settingsNote,
      el('div', { class: 'row' }, el('label', {}, 'Pas'), el('div', { class: 'grow' }, stepSel), el('label', { style: 'width:auto' }, 'F'), el('div', { style: 'width:70px' }, jogFeed)),
      el('div', { class: 'jog' },
        jogBtn('↖', -1, 1, 0), jogBtn('Y+', 0, 1, 0), jogBtn('↗', 1, 1, 0), jogBtn('Z+', 0, 0, 1, 'z'),
        jogBtn('X−', -1, 0, 0), el('span'), jogBtn('X+', 1, 0, 0), jogBtn('Z−', 0, 0, -1, 'z'),
        jogBtn('↙', -1, -1, 0), jogBtn('Y−', 0, -1, 0), jogBtn('↘', 1, -1, 0), el('span')),
      el('div', { class: 'muted' }, 'Positionnez la fraise à l\'origine choisie, puis définissez le zéro :'),
      el('div', { class: 'btns' }, zeroBtns, probeBtn, homeBtn, el('button', { class: 'btn sm', onclick: cmd('$X') }, 'Déverrouiller $X'), el('button', { class: 'btn sm', onclick: cmd('$$') }, 'Lire les réglages'), el('button', { class: 'btn sm', onclick: () => { if (grbl.connected) CNC.grblSettings(grbl, log); else alert('Connectez d\'abord la machine.'); } }, 'Réglages GRBL…')),
      dryBox,
      el('div', { class: 'btns' }, startBtn, pauseBtn, stopBtn),
      el('div', { class: 'progress' }, bar), progText, consoleBox, cmdIn);

    const log = (cls, text) => {
      consoleBox.append(el('div', { class: cls === 'e' || cls === 'err' ? 'e' : '' }, text));
      while (consoleBox.childNodes.length > 200) consoleBox.firstChild.remove();
      consoleBox.scrollTop = consoleBox.scrollHeight;
    };
    cmdIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && cmdIn.value.trim() && grbl.connected) {
        log('i', '> ' + cmdIn.value);
        grbl.send(cmdIn.value.trim()).catch((er) => log('e', er.message));
        cmdIn.value = '';
      }
    });

    function updateConn() {
      const c = grbl.connected, running = !!grbl.job;
      connBtn.textContent = c ? 'Déconnecter' : 'Connecter la machine';
      connBtn.classList.toggle('primary', !c);
      startBtn.disabled = !c || running || (!job && !extJob);
      pauseBtn.disabled = !running;
      stopBtn.disabled = !c;
      homeBtn.style.display = App.machine().homing ? '' : 'none';
      probeBtn.disabled = !c || running;
      pinBadge.textContent = c ? 'Palpeur : ' + (/P/.test(grbl.status.pins || '') ? 'contact (activé)' : 'libre') : '';
      wizUpdate();
      const s = grbl.status;
      stateBadge.textContent = s.state;
      stateBadge.className = 'badge ' + s.state;
      dro.forEach((d, i) => { d.lastChild.textContent = c ? (s.wpos[i] || 0).toFixed(2) : '—'; });
      pauseBtn.textContent = grbl.job && grbl.job.paused ? '▶ Reprendre' : '⏸ Pause';
    }

    connBtn.addEventListener('click', async () => {
      if (grbl.connected) return grbl.disconnect();
      if (!CNC.Grbl.supported()) return alert('Web Serial n\'est pas disponible dans ce navigateur. Utilisez Chrome ou Edge (sur http://localhost ou en ouvrant le fichier).');
      try { await grbl.connect(App.machine().baud); log('i', 'Port ouvert.'); } catch (e) { if (e.name !== 'NotFoundError') alert('Connexion impossible : ' + e.message); }
      updateConn();
    });
    pauseBtn.addEventListener('click', () => { if (!grbl.job) return; grbl.job.paused ? grbl.resume() : grbl.pause(); updateConn(); });
    stopBtn.addEventListener('click', () => { grbl.stop(); log('i', 'Arrêt demandé (reset). Utilisez « Déverrouiller $X » puis relevez Z.'); });
    startBtn.addEventListener('click', async () => {
      if (!job && !extJob) return;
      if (job && job.laser && !extJob) { // lancement d'une gravure laser
        const cfg = L.cfg(P().machineId);
        if (!cfg.enabled) return alert('Déclarez d\'abord le module laser (carte Laser : « Un module laser est monté »).');
        if (!cfg.power) return alert('Renseignez la puissance de votre laser (carte Laser) : elle sert aux consignes de sécurité.');
        const okL = await CNC.confirmModal('Lancer la gravure laser ?', el('div', {},
          el('div', { class: 'warn' }, 'Le faisceau laser peut causer des lésions oculaires permanentes et déclencher un incendie.'),
          el('ul', { class: 'checks' },
            el('li', {}, cfg.wave ? `Lunettes de protection homologuées pour ${cfg.wave} nm portées par toutes les personnes présentes` : 'Lunettes de protection homologuées pour la longueur d\'onde de votre laser portées par toutes les personnes présentes'),
            el('li', {}, 'Module laser à la bonne hauteur (mise au point) et bien fixé'),
            el('li', {}, `Matériau adapté au laser (${App.material().name.includes('PVC') ? 'PAS de PVC : gaz toxiques' : 'ni PVC, ni plastique inconnu'}) et immobilisé`),
            el('li', {}, 'Pièce bien aérée ou aspiration ; extincteur ou eau à portée de main'),
            el('li', {}, 'Ne jamais laisser la machine sans surveillance ; arrêt d\'urgence accessible'),
            el('li', {}, 'Zéro X/Y défini sur ' + (P().origin === 'center' ? 'le centre' : 'le coin bas-gauche') + ' du matériau'))), 'Lancer');
        if (!okL) return;
        grbl.startJob(CNC.gcode.clean(job.lines));
        updateConn();
        return;
      }
      const dry = !extJob && dryChk.checked;
      const items = dry
        ? [`Le parcours sera relevé de ${dryZ} mm et la broche ne sera PAS démarrée : la fraise passe au-dessus du matériau`,
           `Zéro défini sur ${P().origin === 'center' ? 'le centre' : 'le coin bas-gauche'} en X/Y et sur le dessus du matériau en Z`,
           'Vérifiez que rien ne gêne les déplacements (serre-joints, brides…)', 'Arrêt d\'urgence à portée de main']
        : [`Fraise montée : ${App.bit().name}`,
           `Matériau fixé solidement : ${App.material().name}, ${P().stock.w} × ${P().stock.h} × ${P().stock.t} mm`,
           `Zéro défini sur ${P().origin === 'center' ? 'le centre' : 'le coin bas-gauche'} en X/Y et sur le dessus du matériau en Z`,
           'Broche ' + (App.machine().spindle.mode === 'manual' ? 'à démarrer à la main quand le programme se met en pause' : 'commandée par le programme'),
           'Lunettes de protection, aspiration, arrêt d\'urgence à portée de main'];
      if (extJob) items.unshift(`Fichier G-code externe : ${extJob.name} (non vérifié par EasyCNC)`);
      const ok = await CNC.confirmModal(dry ? 'Lancer l\'essai à blanc ?' : 'Démarrer l\'usinage ?', el('div', {},
        el('div', {}, 'Vérifiez avant de lancer :'), el('ul', { class: 'checks' }, items.map((t) => el('li', {}, t)))), 'Lancer');
      if (!ok) return;
      const lines = extJob ? extJob.lines : dry ? CNC.gcode.generate({ ...job.args, dry: { zOffset: dryZ } }) : job.lines;
      grbl.startJob(CNC.gcode.clean(lines));
      updateConn();
    });

    grbl.on.log = log;
    grbl.on.status = updateConn;
    grbl.on.close = () => { updateConn(); log('i', 'Port fermé.'); };
    grbl.on.job = (j) => {
      const pct = j.total ? Math.round((j.acked / j.total) * 100) : 0;
      bar.style.width = pct + '%';
      progText.textContent = j.done ? (j.aborted ? 'Interrompu.' : 'Terminé.') : `${j.acked} / ${j.total} lignes (${pct} %)`;
      if (j.error) log('e', 'Erreur GRBL : ' + j.error);
      updateConn();
    };
    grbl.on.settings = (st) => {
      settingsNote.innerHTML = '';
      const s32 = st.$32;
      if (s32 !== undefined) {
        if (P().mode === 'laser' && s32 !== 1) {
          settingsNote.append(el('div', { class: 'warn' }, 'Le mode laser de GRBL n\'est pas activé ($32 = 0) : la puissance ne suivrait pas la vitesse. ',
            el('button', { class: 'btn sm', onclick: () => { grbl.send('$32=1').then(() => { log('i', '$32=1 enregistré.'); settingsNote.innerHTML = ''; }).catch((e) => log('e', e.message)); } }, 'Activer ($32=1)')));
        } else if (P().mode !== 'laser' && s32 === 1) {
          settingsNote.append(el('div', { class: 'warn' }, 'Le mode laser de GRBL est activé ($32 = 1) : à désactiver pour fraiser. ',
            el('button', { class: 'btn sm', onclick: () => { grbl.send('$32=0').then(() => { log('i', '$32=0 enregistré.'); settingsNote.innerHTML = ''; }).catch((e) => log('e', e.message)); } }, 'Désactiver ($32=0)')));
        }
      }
      const s30 = st.$30, mine = App.machine().spindle.sMax;
      if (s30 && s30 !== mine) {
        settingsNote.append(el('div', { class: 'warn' }, `GRBL indique $30 = ${s30}, le profil suppose S max = ${mine}. `,
          el('button', { class: 'btn sm', onclick: () => { P().sMax = s30; settingsNote.innerHTML = ''; refreshAll(); recompute(); } }, `Utiliser ${s30}`)));
      }
    };

    const originOf = () => {
      const st = P().stock;
      return P().origin === 'center' ? { x: st.w / 2, y: st.h / 2, label: 'centre du matériau' } : { x: 0, y: 0, label: 'coin bas-gauche du matériau' };
    };

    // ---------- calcul en mode laser ----------
    function recomputeLaser() {
      clearTimeout(timer);
      stopPlay();
      const machine = App.machine(), cfg = L.cfg(P().machineId), settings = LS(), st = P().stock;
      warnBox.innerHTML = ''; stats.innerHTML = '';
      const warns = [];
      if (!cfg.enabled) warns.push('Le module laser n\'est pas déclaré pour cette machine : cochez « Un module laser est monté » dans la carte Laser.');
      if (!cfg.power) warns.push('Renseignez la puissance de votre laser (en W) dans la carte Laser.');
      const plan = L.plan({ shapes: P().shapes, settings, machine });
      warns.push(...plan.warnings);
      if (plan.moves.length < 2) {
        job = null; E.sim = null; E.render();
        warns.push('Rien à graver : choisissez une opération laser pour vos formes (onglet Dessiner).');
        warns.forEach((w) => warnBox.append(el('div', { class: 'warn' }, w)));
        updateConn();
        return;
      }
      let out = false;
      for (const m of plan.moves) if (!m.r && (m.x < -0.01 || m.y < -0.01 || m.x > st.w + 0.01 || m.y > st.h + 0.01)) out = true;
      if (out) warns.push('Une partie de la gravure sort du matériau.');
      if (st.w > machine.area.x || st.h > machine.area.y) warns.push(`Le matériau dépasse la zone de travail (${machine.area.x} × ${machine.area.y} mm).`);
      const lines = L.gcode({ moves: plan.moves, machine, cfg, origin: originOf(), name: P().name, settings });
      job = { lines, moves: plan.moves, stats: plan.stats, laser: true };
      warns.forEach((w) => warnBox.append(el('div', { class: 'warn' }, w)));
      const stat = (a, b) => el('div', { class: 'stat' }, el('span', {}, a), el('b', {}, b));
      stats.append(stat('Durée estimée', CNC.fmtTime(plan.stats.sec)), stat('Longueur gravée', CNC.round(plan.stats.burnLen / 1000, 2) + ' m'), stat('Lignes de G-code', lines.length));
      E.setSim(plan.moves, { diameter: 0.2 });
      E.sim.laser = true;
      E.render();
      slider.value = 1000;
      updateConn();
    }

    // cadrage à blanc du parcours : la fraise fait le tour de la zone usinée, relevée et broche arrêtée
    async function frameMill() {
      if (!grbl.connected || grbl.job) return alert('Connectez la machine (et attendez la fin du travail en cours).');
      if (!job || job.laser || !job.moves) return alert('Aucun parcours à cadrer : ajoutez des formes à usiner.');
      const org = originOf(), params = App.params(), N = CNC.num;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const m of job.moves) {
        if (m.r) continue;
        x0 = Math.min(x0, m.x); x1 = Math.max(x1, m.x); y0 = Math.min(y0, m.y); y1 = Math.max(y1, m.y);
      }
      if (!Number.isFinite(x0)) return alert('Aucun parcours à cadrer.');
      const ax = x0 - org.x, bx = x1 - org.x, ay = y0 - org.y, by = y1 - org.y;
      const ok = await CNC.confirmModal('Cadrer le parcours ?', el('div', {},
        el('div', {}, 'La fraise va faire le tour de la zone usinée, relevée, sans tourner.'),
        el('ul', { class: 'checks' },
          el('li', {}, `Zone en X : de ${CNC.round(ax, 1)} à ${CNC.round(bx, 1)} mm (depuis l'origine)`),
          el('li', {}, `Zone en Y : de ${CNC.round(ay, 1)} à ${CNC.round(by, 1)} mm (depuis l'origine)`),
          el('li', {}, `Hauteur : ${params.safeZ} mm au-dessus du Z0`),
          el('li', {}, `Origine du programme : ${org.label}`)),
        el('div', { class: 'muted' }, 'Si le cadre sort du matériau, corrigez la taille du matériau ou la position des formes (onglet Dessiner) avant de couper.')), 'Cadrer');
      if (!ok) return;
      const lines = ['; Cadrage du parcours (Z relevé, broche arrêtée)', 'G21', 'G90', 'G17', 'G94', 'G54', `G0 Z${N(params.safeZ)}`,
        `G0 X${N(ax)} Y${N(ay)}`, `G0 X${N(bx)}`, `G0 Y${N(by)}`, `G0 X${N(ax)}`, `G0 Y${N(ay)}`, 'G0 X0 Y0'];
      log('i', `Cadrage : X ${CNC.round(ax, 1)}..${CNC.round(bx, 1)}, Y ${CNC.round(ay, 1)}..${CNC.round(by, 1)}`);
      grbl.startJob(lines);
      updateConn();
    }

    function frameLaser() {
      if (!grbl.connected || grbl.job) return alert('Connectez la machine (et attendez la fin du travail en cours).');
      const cfg = L.cfg(P().machineId), plan = L.framePlan({ shapes: P().shapes, settings: LS() });
      if (!plan) return alert('Aucune forme à cadrer.');
      const go = CNC.confirmModal('Cadrer la zone ?', el('div', {},
        el('div', {}, 'Le laser va parcourir le rectangle englobant à très faible puissance.'),
        el('ul', { class: 'checks' },
          el('li', {}, cfg.wave ? `Lunettes de protection adaptées à ${cfg.wave} nm` : 'Lunettes de protection adaptées à la longueur d\'onde du module'),
          el('li', {}, 'Zéro X/Y défini sur l\'origine choisie'), el('li', {}, 'Rien d\'inflammable sous le faisceau'))), 'Cadrer');
      go.then((ok) => {
        if (!ok) return;
        const lines = L.gcode({ moves: plan.moves, machine: App.machine(), cfg, origin: originOf(), name: P().name, note: 'cadrage' });
        grbl.startJob(CNC.gcode.clean(lines));
        updateConn();
      });
    }

    // ---------- calcul ----------
    function recompute() {
      if (P().mode === 'laser') return recomputeLaser();
      clearTimeout(timer);
      stopPlay();
      const machine = App.machine(), bit = App.bit(), material = App.material(), params = App.params(), st = P().stock;
      warnBox.innerHTML = ''; stats.innerHTML = '';
      const warns = [];
      const res = TP.generate({ shapes: P().shapes, stock: st, bit, params, overcut: P().overcut, facing: P().facing });
      warns.push(...res.warnings);
      if (!res.paths.length) {
        job = null; E.sim = null; E.render();
        CNC.view3d.setJob({ stock: st, pos: CNC.stockPos(st, machine.area), area: machine.area, material, moves: [], bit });
        warns.push('Rien à usiner : ajoutez des formes avec un type d\'usinage.');
        warns.forEach((w) => warnBox.append(el('div', { class: 'warn' }, w)));
        updateConn();
        return;
      }
      const moves = TP.toMoves(res.paths, params.safeZ, 0.5);
      let out = false, minZ = 0;
      const tol = 0.01;
      for (const m of moves) {
        if (m.r) continue;
        if (m.x < -tol || m.y < -tol || m.x > st.w + tol || m.y > st.h + tol) out = true;
        if (m.z < minZ) minZ = m.z;
      }
      if (out) warns.push('Une partie du parcours sort du matériau (contour extérieur trop près du bord ?).');
      const sp = CNC.stockPos(st, machine.area);
      if (sp.x < -1e-6 || sp.y < -1e-6 || sp.x + st.w > machine.area.x + 1e-6 || sp.y + st.h > machine.area.y + 1e-6) warns.push(`Le matériau (${st.w} × ${st.h} mm) ne tient pas dans la zone de travail de la machine (${machine.area.x} × ${machine.area.y} mm) : réduisez-le ou changez sa position.`);
      if (-minZ > machine.area.z) warns.push(`Profondeur ${CNC.round(-minZ, 1)} mm > course Z de la machine (${machine.area.z} mm).`);
      const origin = P().origin === 'center' ? { x: st.w / 2, y: st.h / 2, label: 'centre du matériau' } : { x: 0, y: 0, label: 'coin bas-gauche du matériau' };
      const lines = CNC.gcode.generate({ moves, machine, params, bit, material, name: P().name, origin });
      const s = TP.stats(moves, params, machine.rapid || 1500);
      job = { lines, moves, stats: s, args: { moves, machine, params, bit, material, name: P().name, origin } };
      warns.forEach((w) => warnBox.append(el('div', { class: 'warn' }, w)));
      const stat = (a, b) => el('div', { class: 'stat' }, el('span', {}, a), el('b', {}, b));
      stats.append(stat('Durée estimée', CNC.fmtTime(s.sec)), stat('Longueur de coupe', CNC.round(s.cutLen / 1000, 2) + ' m'),
        stat('Profondeur max', CNC.round(-minZ, 2) + ' mm'), stat('Lignes de G-code', lines.length));
      CNC.view3d.setJob({ stock: st, pos: CNC.stockPos(st, machine.area), area: machine.area, material, moves, bit, base: P().facing.on ? -P().facing.depth : 0,
        tabZ: P().shapes.filter((q) => q.cut && q.cut.tabs && q.cut.tabs.on && ['outside', 'inside', 'online'].includes(q.cut.type)).map((q) => -(st.t - q.cut.tabs.height)) });
      E.setSim(moves, bit);
      slider.value = 1000;
      updateConn();
    }

    // ---------- rafraîchissements ----------
    function refreshParams() {
      pfields.forEach((f) => f.refresh());
      const m = App.machine(), p = App.params();
      sInfo.textContent = m.spindle.mode === 'grbl' ? `S${Math.round((p.rpm / m.spindle.maxRpm) * m.spindle.sMax)} envoyé à la broche (max ${m.spindle.maxRpm} tr/min ↔ S${m.spindle.sMax}).` : m.spindle.mode === 'manual' ? 'Broche manuelle : réglez la vitesse à la main.' : '';
    }
    function refreshAll() {
      fillMachines(); fillBits();
      const laserMode = P().mode === 'laser';
      c2.style.display = c3.style.display = laserMode ? 'none' : '';
      cL.style.display = laserMode ? '' : 'none';
      probeBtn.style.display = dryBox.style.display = laserMode ? 'none' : '';
      if (laserMode) {
        const cfg = L.cfg(P().machineId);
        enChk.checked = !!cfg.enabled; cmdSel.value = cfg.cmd; presetSel.value = LS().preset in L.presets ? LS().preset : 'custom';
        imgMode.value = LS().image.mode; originSelL.value = P().origin;
        lfields.forEach((f) => f.refresh());
      }
      matSel.value = P().stock.materialId;
      originSel.value = P().origin; facChk.checked = !!P().facing.on; facDepth.row.style.display = P().facing.on ? '' : 'none';
      const m = App.machine(), b = App.bit();
      machInfo.textContent = `Zone ${m.area.x} × ${m.area.y} × ${m.area.z} mm · avance max ${m.maxFeed} mm/min · broche ${m.spindle.mode === 'grbl' ? 'pilotée' : m.spindle.mode === 'manual' ? 'manuelle' : '—'}`;
      machWarn.innerHTML = '';
      if (m.notes) machWarn.append(el('div', { class: 'muted', style: 'margin-top:4px' }, m.notes));
      bitHolder.innerHTML = ''; bitHolder.append(CNC.bitCard(b));
      bitWarn.innerHTML = '';
      if (b.shank > m.maxShank) bitWarn.append(el('div', { class: 'warn' }, `Queue Ø ${b.shank} mm > pince ${m.collet} (max ${m.maxShank} mm).`));
      refreshParams();
      updateConn();
    }

    App.onProjectLoaded = () => { job = null; if (App.tab === 'carve') { refreshAll(); recompute(); } };

    return {
      node: el('div', {}, c1, c2, c3, cL, c4, c5),
      enter() { refreshAll(); recompute(); },
      invalidate() { job = null; clearTimeout(timer); timer = setTimeout(recompute, 250); },
    };
  };
})();
