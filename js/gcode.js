// Post-processeur GRBL : déplacements -> G-code
(function () {
  const CNC = window.CNC;
  const N = CNC.num;

  CNC.gcode = {
    // origin: décalage (mm) soustrait aux coordonnées du matériau pour obtenir les coordonnées machine/travail
    // dry : { zOffset } -> essai à blanc : tout le parcours est relevé de zOffset mm et la broche n est pas démarrée
    generate({ moves, machine, params, bit, material, name, origin, dry }) {
      const L = [];
      const sp = machine.spindle;
      const sVal = Math.round((params.rpm / sp.maxRpm) * sp.sMax);
      const zo = dry ? dry.zOffset : 0;
      const safeZ = params.safeZ + zo;
      if (dry) L.push(`; *** ESSAI À BLANC : parcours relevé de ${N(zo)} mm, broche non démarrée ***`);
      L.push(`; EasyCNC - ${name || 'projet'}`);
      L.push(`; Machine : ${machine.brand} ${machine.name}`);
      L.push(`; Matériau : ${material.name} | Fraise : ${bit.name}`);
      L.push(`; Avance ${params.feed} mm/min | Plongée ${params.plunge} mm/min | Passe ${params.doc} mm | ${params.rpm} tr/min`);
      L.push('; Origine X0 Y0 : ' + (origin.label || 'coin bas-gauche') + ' | Z0 : dessus du matériau');
      L.push('G21 ; mm', 'G90 ; absolu', 'G17', 'G94', 'G54');
      (machine.preamble || '').split('\n').map((s) => s.trim()).filter(Boolean).forEach((s) => L.push(s));
      L.push(`G0 Z${N(safeZ)}`);
      if (dry) { /* pas de broche pendant l'essai à blanc */ } else if (sp.mode === 'grbl') {
        L.push(`M3 S${sVal}`);
        if (sp.spinupSec) L.push(`G4 P${sp.spinupSec}`);
      } else if (sp.mode === 'manual') {
        L.push(`M0 ; Démarrez la broche (~${params.rpm} tr/min) puis reprenez`);
      }

      let last = { x: null, y: null, z: null, f: null, g: null };
      let prev = moves[0];
      for (let i = 1; i < moves.length; i++) {
        const m = moves[i];
        const g = m.r ? 'G0' : 'G1';
        const x = m.x - origin.x, y = m.y - origin.y, z = m.z + zo;
        let s = '';
        if (last.x === null || N(x) !== N(last.x)) s += ` X${N(x)}`;
        if (last.y === null || N(y) !== N(last.y)) s += ` Y${N(y)}`;
        if (last.z === null || N(z) !== N(last.z)) s += ` Z${N(z)}`;
        if (!m.r) {
          const f = Math.round(CNC.toolpath.cutFeed(prev, m, params));
          if (f !== last.f) { s += ` F${f}`; last.f = f; }
        }
        if (s) L.push(g + s);
        last.g = g; last.x = x; last.y = y; last.z = z;
        prev = m;
      }

      const retract = `G0 Z${N(safeZ)}`;
      if (L[L.length - 1] !== retract) L.push(retract);
      if (sp.mode !== 'none') L.push('M5');
      L.push('G0 X0 Y0');
      (machine.postamble || '').split('\n').map((s) => s.trim()).filter(Boolean).forEach((s) => L.push(s));
      L.push('M2');
      return L;
    },

    // Retire les commentaires avant envoi à la machine
    clean(lines) {
      return lines
        .map((l) => l.replace(/;.*$/, '').replace(/\(.*?\)/g, '').trim())
        .filter(Boolean);
    },
  };
})();
