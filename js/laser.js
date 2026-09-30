// Mode laser (diode) : contour, remplissage et gravure d'image -> déplacements + G-code GRBL (mode laser $32=1, M4).
(function () {
  const CNC = window.CNC;
  const G = CNC.geom;
  const L = (CNC.laser = {});

  // ---------- réglages ----------
  // Valeurs de départ prudentes pour une petite diode (quelques watts), à valider sur chute et à adapter à votre laser
  L.presets = {
    plywood: { name: 'Contreplaqué / bois clair', line: { power: 100, speed: 250, passes: 1 }, fill: { power: 60, speed: 1500, interval: 0.1, angle: 0 }, image: { min: 10, max: 70, speed: 1500, interval: 0.1, mode: 'gray' } },
    mdf: { name: 'MDF', line: { power: 100, speed: 200, passes: 1 }, fill: { power: 70, speed: 1500, interval: 0.1, angle: 0 }, image: { min: 15, max: 80, speed: 1200, interval: 0.1, mode: 'gray' } },
    cardboard: { name: 'Carton', line: { power: 100, speed: 500, passes: 1 }, fill: { power: 25, speed: 2500, interval: 0.1, angle: 0 }, image: { min: 8, max: 40, speed: 2500, interval: 0.1, mode: 'gray' } },
    leather: { name: 'Cuir', line: { power: 100, speed: 400, passes: 1 }, fill: { power: 45, speed: 1800, interval: 0.1, angle: 0 }, image: { min: 12, max: 55, speed: 1800, interval: 0.1, mode: 'gray' } },
    paper: { name: 'Papier', line: { power: 30, speed: 1200, passes: 1 }, fill: { power: 15, speed: 3000, interval: 0.1, angle: 0 }, image: { min: 6, max: 25, speed: 3000, interval: 0.1, mode: 'gray' } },
    cork: { name: 'Liège', line: { power: 100, speed: 300, passes: 1 }, fill: { power: 40, speed: 1800, interval: 0.1, angle: 0 }, image: { min: 10, max: 50, speed: 1800, interval: 0.1, mode: 'gray' } },
  };
  L.defaults = () => ({ preset: 'plywood', frame: { power: 1, speed: 2000 }, ...CNC.deepCopy({ line: L.presets.plywood.line, fill: L.presets.plywood.fill, image: L.presets.plywood.image }) });

  // module laser par machine (mémorisé à part, comme le palpeur : les profils intégrés ne sont pas modifiables)
  // puissance et longueur d'onde : à renseigner par l'utilisateur (0 = non renseigné)
  L.cfg = (machineId) => ({ enabled: false, power: 0, wave: 0, cmd: 'M4', ...CNC.store.get('laser.' + machineId, {}) });
  L.setCfg = (machineId, patch) => CNC.store.set('laser.' + machineId, { ...L.cfg(machineId), ...patch });

  L.opOf = (s) => s.lop || (s.kind === 'relief' ? 'image' : { none: 'off', pocket: 'fill', vcarve: 'fill' }[s.cut && s.cut.type] || 'line');

  // ---------- géométrie ----------
  // hachures d'une forme (contours pairs-impairs) : segments [x0,y0,x1,y1] en zigzag
  function hatch(polys, interval, angleDeg) {
    const a = (-angleDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const rot = (x, y) => [x * ca - y * sa, x * sa + y * ca];
    const rings = polys.filter((p) => p.closed && p.pts.length > 2).map((p) => p.pts.map(([x, y]) => rot(x, y)));
    if (!rings.length) return [];
    let y0 = Infinity, y1 = -Infinity;
    rings.forEach((r) => r.forEach(([, y]) => { if (y < y0) y0 = y; if (y > y1) y1 = y; }));
    const back = (x, y) => { const c = Math.cos(-a), s = Math.sin(-a); return [x * c - y * s, x * s + y * c]; };
    const segs = [];
    let dir = true;
    for (let y = y0 + interval / 2; y < y1; y += interval) {
      const xs = [];
      for (const r of rings) {
        for (let i = 0, n = r.length; i < n; i++) {
          const [ax, ay] = r[i], [bx, by] = r[(i + 1) % n];
          if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
        }
      }
      xs.sort((p, q) => p - q);
      const line = [];
      for (let k = 0; k + 1 < xs.length; k += 2) line.push([xs[k], xs[k + 1]]);
      if (!dir) line.reverse();
      for (const [xa, xb] of line) {
        const p = dir ? [xa, xb] : [xb, xa];
        const A = back(p[0], y), B = back(p[1], y);
        segs.push([A[0], A[1], B[0], B[1]]);
      }
      dir = !dir;
    }
    return segs;
  }

  // gravure d'une image : lignes de balayage horizontales, puissance variable selon la teinte
  function imageSegs(s, cfg) {
    const d = CNC.relief.decode(s);
    if (!d) return [];
    const inv = !!(s.relief && s.relief.invert);
    const b = G.bbox(G.worldPolys(s));
    const step = 0.1, segs = [];
    let dir = true;
    const sampleAt = (x, y) => {
      const [lx, ly] = CNC.rotate(x - s.x, y - s.y, -s.rot);
      const u = lx / s.w + 0.5, v = 0.5 - ly / s.h;
      if (u < 0 || u > 1 || v < 0 || v > 1) return null;
      const px = Math.min(d.w - 1, Math.floor(u * d.w)), py = Math.min(d.h - 1, Math.floor(v * d.h));
      const g = d.data[py * d.w + px] / 255;
      return inv ? g : 1 - g; // noirceur : 0 = blanc (rien), 1 = noir (puissance max)
    };
    for (let y = b.y0 + cfg.interval / 2; y < b.y1; y += cfg.interval) {
      const xs = [];
      for (let x = b.x0; x <= b.x1 + 1e-9; x += step) xs.push(x);
      if (!dir) xs.reverse();
      let runP = 0, runStart = null, last = null;
      const flush = (xEnd) => { if (runP > 0 && runStart !== null) segs.push([runStart, y, xEnd, y, runP]); runP = 0; runStart = null; };
      for (const x of xs) {
        const dk = sampleAt(x, y);
        let p = 0;
        if (dk !== null) {
          if (cfg.mode === 'thresh') p = dk > 0.5 ? cfg.max : 0;
          else p = dk < 0.04 ? 0 : cfg.min + (cfg.max - cfg.min) * dk;
          p = Math.round(p / 2) * 2; // paliers de 2 % : moins de commandes
        }
        if (p !== runP) { flush(x); if (p > 0) { runP = p; runStart = x; } } // le segment suivant démarre là où l'autre finit : pas de trou
        last = x;
      }
      flush(last);
      dir = !dir;
    }
    return segs;
  }

  // ---------- génération ----------
  // Retourne { moves, warnings, stats } ; moves : { r (rapide), x, y, z:0, s (0..1), f }
  L.plan = ({ shapes, settings, machine }) => {
    const warnings = [], burns = []; // burns : { pts:[[x,y]...], s, f } (une passe)
    const active = shapes.filter((s) => L.opOf(s) !== 'off');
    const order = { image: 0, fill: 1, line: 2 };
    active.sort((a, b) => order[L.opOf(a)] - order[L.opOf(b)]);
    const push = (a, s, f) => burns.push({ pts: a, s: CNC.clamp(s / 100, 0, 1), f });
    for (const sh of active) {
      const op = L.opOf(sh), label = sh.name || G.names[sh.kind] || 'Forme', polys = G.worldPolys(sh);
      if (op === 'image') {
        if (sh.kind !== 'relief') { warnings.push(`« ${label} » : seule une image peut être gravée en mode Image.`); continue; }
        for (const sg of imageSegs(sh, settings.image)) push([[sg[0], sg[1]], [sg[2], sg[3]]], sg[4], settings.image.speed);
      } else if (op === 'fill') {
        const segs = hatch(polys, Math.max(0.03, settings.fill.interval), settings.fill.angle);
        if (!segs.length) warnings.push(`« ${label} » : rien à remplir (forme ouverte ?).`);
        for (const sg of segs) push([[sg[0], sg[1]], [sg[2], sg[3]]], settings.fill.power, settings.fill.speed);
      } else if (op === 'line') {
        for (let pass = 0; pass < Math.max(1, Math.round(settings.line.passes)); pass++) {
          for (const p of polys) {
            const pts = p.pts.map((q) => [q[0], q[1]]);
            if (p.closed) pts.push([pts[0][0], pts[0][1]]);
            if (pts.length > 1) push(pts, settings.line.power, settings.line.speed);
          }
        }
      }
    }
    // déplacements : rapide (laser éteint) jusqu'au début de chaque tracé, puis tracé à puissance
    const moves = [{ r: 1, x: 0, y: 0, z: 0, s: 0, f: 0 }];
    let cur = [0, 0];
    for (const bn of burns) {
      const [x, y] = bn.pts[0];
      if (Math.hypot(x - cur[0], y - cur[1]) > 1e-6) moves.push({ r: 1, x, y, z: 0, s: 0, f: 0 });
      for (let i = 1; i < bn.pts.length; i++) moves.push({ r: 0, x: bn.pts[i][0], y: bn.pts[i][1], z: 0, s: bn.s, f: bn.f });
      cur = bn.pts[bn.pts.length - 1];
    }
    // statistiques
    let sec = 0, burn = 0, prev = moves[0];
    const rapid = machine.rapid || 1500;
    for (let i = 1; i < moves.length; i++) {
      const m = moves[i], len = Math.hypot(m.x - prev.x, m.y - prev.y);
      if (m.r) sec += (len / rapid) * 60; else { sec += (len / m.f) * 60; burn += len; }
      prev = m;
    }
    return { moves, warnings, stats: { sec, burnLen: burn } };
  };

  // cadrage : contour du rectangle englobant à très faible puissance (visualiser la zone)
  L.framePlan = ({ shapes, settings }) => {
    const polys = [];
    shapes.filter((s) => L.opOf(s) !== 'off').forEach((s) => polys.push(...G.worldPolys(s)));
    if (!polys.length) return null;
    const b = G.bbox(polys), p = settings.frame.power / 100, f = settings.frame.speed;
    const pts = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1], [b.x0, b.y0]];
    const moves = [{ r: 1, x: 0, y: 0, z: 0, s: 0, f: 0 }, { r: 1, x: pts[0][0], y: pts[0][1], z: 0, s: 0, f: 0 }];
    for (let i = 1; i < pts.length; i++) moves.push({ r: 0, x: pts[i][0], y: pts[i][1], z: 0, s: p, f });
    return { moves };
  };

  // moves -> lignes de G-code
  L.gcode = ({ moves, machine, cfg, origin, name, settings, note }) => {
    const sMax = machine.spindle.sMax || 1000, N = CNC.num;
    const out = [];
    out.push(`; EasyCNC LASER - ${name || 'projet'}${note ? ' (' + note + ')' : ''}`);
    out.push(`; Machine : ${machine.brand} ${machine.name} | Laser ${cfg.power ? cfg.power + ' W' : 'puissance non renseignée'}${cfg.wave ? ' ' + cfg.wave + ' nm' : ''}`);
    out.push('; ATTENTION : lunettes de protection adaptées, aération, ne jamais laisser le laser sans surveillance');
    out.push('G21 ; mm', 'G90 ; absolu', 'G17', 'G94', 'G54');
    out.push(`${cfg.cmd} S0 ; mode laser (\$32=1 requis)`);
    let last = { x: null, y: null, f: null, s: null };
    for (let i = 1; i < moves.length; i++) {
      const m = moves[i], x = m.x - origin.x, y = m.y - origin.y;
      let axes = '';
      if (last.x === null || N(x) !== N(last.x)) axes += ` X${N(x)}`;
      if (last.y === null || N(y) !== N(last.y)) axes += ` Y${N(y)}`;
      if (m.r) { if (axes) out.push('G0' + axes); }
      else {
        const sv = Math.round(m.s * sMax), f = Math.round(m.f);
        let extra = '';
        if (f !== last.f) { extra += ` F${f}`; last.f = f; }
        if (sv !== last.s) { extra += ` S${sv}`; last.s = sv; }
        if (axes || extra) out.push('G1' + axes + extra);
      }
      last.x = x; last.y = y;
    }
    out.push('M5', 'G0 X0 Y0', 'M2');
    return out;
  };
})();
