// Génération des parcours d'outil (contour extérieur/intérieur, sur le tracé, poche) via Clipper.
(function () {
  const CNC = window.CNC;
  const G = CNC.geom;
  const TP = (CNC.toolpath = {});
  const SC = 1000; // Clipper travaille en entiers : 1 unité = 1 µm

  const toClip = (polys) =>
    polys
      .filter((p) => p.closed && p.pts.length > 2)
      .map((p) => p.pts.map(([x, y]) => ({ X: Math.round(x * SC), Y: Math.round(y * SC) })));
  const fromClip = (paths) => paths.map((p) => p.map((q) => [q.X / SC, q.Y / SC]));

  function offset(paths, delta) {
    const C = ClipperLib;
    const simple = C.Clipper.SimplifyPolygons(paths, C.PolyFillType.pftEvenOdd);
    const co = new C.ClipperOffset(2, 0.005 * SC);
    co.AddPaths(simple, C.JoinType.jtRound, C.EndType.etClosedPolygon);
    const out = new C.Paths();
    co.Execute(out, delta * SC);
    return fromClip(out).filter((r) => r.length > 2);
  }

  const perimeter = (ring) => {
    let L = 0;
    for (let i = 0; i < ring.length; i++) L += CNC.dist(ring[i], ring[(i + 1) % ring.length]);
    return L;
  };
  const rotateRing = (ring, idx) => ring.slice(idx).concat(ring.slice(0, idx));
  const nearestIdx = (ring, p) => {
    let bi = 0, bd = Infinity;
    ring.forEach((q, i) => { const d = CNC.dist(q, p); if (d < bd) { bd = d; bi = i; } });
    return bi;
  };

  // Tenons : ponts de matière laissés sur le contour. `ring` reçoit `flags` (sommet dans un tenon) et `zTab`
  // (profondeur maximale dans le tenon). Les sommets aux limites sont dupliqués pour des flancs verticaux.
  function applyTabs(ring, tabs, zTab, r) {
    const L = perimeter(ring), n = ring.length;
    const count = Math.max(1, Math.round(tabs.count));
    const span = Math.min(tabs.width + 2 * r, (L / count) * 0.8); // pont voulu + diamètre de la fraise
    const iv = [];
    for (let j = 0; j < count; j++) { const c = ((j + 0.5) * L) / count; iv.push([c - span / 2, c + span / 2]); }
    const inTab = (s) => iv.some(([a, b]) => s > a && s < b);
    const events = iv.flat().sort((x, y) => x - y);
    const out = [], flags = [];
    let s = 0;
    for (let i = 0; i < n; i++) {
      const p = ring[i], q = ring[(i + 1) % n], e = CNC.dist(p, q);
      out.push(p); flags.push(inTab(s + 1e-9));
      for (const ev of events) {
        if (ev <= s + 1e-9 || ev >= s + e - 1e-9) continue;
        const t = (ev - s) / e, pt = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
        out.push(pt); flags.push(inTab(ev - 1e-6));
        out.push(pt.slice()); flags.push(inTab(ev + 1e-6));
      }
      s += e;
    }
    out.flags = flags; out.zTab = zTab;
    return out;
  }

  // Ajoute `laps` tours du contour, en interpolant Z de zFrom à zTo. Part de ring[0] (déjà dans out).
  function lap(ring, zFrom, zTo, laps, out) {
    const n = ring.length, total = perimeter(ring) * laps;
    let s = 0, prev = ring[0];
    for (let l = 0; l < laps; l++) {
      for (let i = 1; i <= n; i++) {
        const p = ring[i % n];
        s += CNC.dist(prev, p);
        prev = p;
        let z = zFrom + (zTo - zFrom) * (total ? s / total : 1);
        if (ring.flags && ring.flags[i % n]) z = Math.max(z, ring.zTab);
        out.push([p[0], p[1], z]);
      }
    }
  }
  const rampLaps = (ring, dz) => CNC.clamp(Math.ceil(Math.abs(dz) / (Math.max(perimeter(ring), 0.01) * 0.09)), 1, 30);
  const levelsOf = (D, doc) => {
    const n = Math.max(1, Math.ceil(D / doc - 1e-9));
    return Array.from({ length: n }, (_, k) => -(D * (k + 1)) / n);
  };

  // Contour fermé, passes successives en descente hélicoïdale (aucun retrait entre les passes)
  function ringPath(ring, D, doc) {
    const pts = [[ring[0][0], ring[0][1], 0]];
    let zPrev = 0;
    for (const z of levelsOf(D, doc)) {
      lap(ring, zPrev, z, rampLaps(ring, zPrev - z), pts);
      lap(ring, z, z, 1, pts);
      zPrev = z;
    }
    return { pts };
  }

  // Ligne ouverte : allers-retours avec plongée verticale aux extrémités
  function openPath(line, D, doc) {
    const pts = [[line[0][0], line[0][1], 0]];
    let cur = line, zPrev = 0;
    for (const z of levelsOf(D, doc)) {
      pts.push([cur[0][0], cur[0][1], z]);
      for (let i = 1; i < cur.length; i++) pts.push([cur[i][0], cur[i][1], z]);
      cur = cur.slice().reverse();
      zPrev = z;
    }
    return { pts };
  }

  // Poche : anneaux concentriques de l'extérieur vers l'intérieur, par niveau de profondeur
  function pocketPaths(clip, r, step, D, doc) {
    const rings = [];
    for (let k = 0; k < 800; k++) {
      const res = offset(clip, -(r + k * step));
      if (!res.length) break;
      res.forEach((ring) => rings.push(ring.slice().reverse()));
    }
    if (!rings.length) return null;
    const link = step * 2;
    const out = [];
    let zPrev = 0;
    for (const z of levelsOf(D, doc)) {
      let cur = null, end = null;
      for (const ring of rings) {
        const rr = end ? rotateRing(ring, nearestIdx(ring, end)) : ring;
        if (cur && CNC.dist(end, rr[0]) <= link) {
          cur.pts.push([rr[0][0], rr[0][1], z]);
          lap(rr, z, z, 1, cur.pts);
        } else {
          if (cur) out.push(cur);
          cur = { pts: [[rr[0][0], rr[0][1], zPrev]] };
          lap(rr, zPrev, z, rampLaps(rr, zPrev - z), cur.pts);
          lap(rr, z, z, 1, cur.pts);
        }
        end = rr[0];
      }
      out.push(cur);
      zPrev = z;
    }
    return out;
  }

  // V-carve : passes décalées du bord vers l'intérieur, de plus en plus profondes.
  // Au décalage d du bord, la fraise (pointe de rayon tipR, demi-angle a) atteint le bord en surface à la profondeur (d - tipR) / tan(a).
  // Au-delà de la profondeur maximale, on continue à cette profondeur pour évider le centre (fond en crêtes : évidez plutôt à la fraise droite).
  function vcarvePaths(clip, bit, maxDepth) {
    const tipR = bit.diameter / 2, tan = Math.tan((((bit.angle || 60) / 2) * Math.PI) / 180);
    const step = CNC.clamp(0.25 * tan, 0.05, 0.3);
    const capD = tipR + maxDepth * tan;
    const step2 = Math.max(step, capD * 0.6);
    const rings = [];
    for (let d = Math.max(step, tipR + step), n = 0; n < 2000; n++) {
      const res = offset(clip, -d);
      if (!res.length) break;
      const z = -Math.min(maxDepth, (d - tipR) / tan);
      res.forEach((ring) => rings.push({ ring: ring.slice().reverse(), z }));
      d += d >= capD ? step2 : step;
    }
    if (!rings.length) return null;
    const link = Math.max(step * 2.5, 0.3) + (step2 > step ? step2 : 0);
    const out = [];
    let cur = null, end = null, zPrev = 0;
    for (const { ring, z } of rings) {
      const rr = end ? rotateRing(ring, nearestIdx(ring, end)) : ring;
      if (cur && CNC.dist(end, rr[0]) <= link) {
        cur.pts.push([rr[0][0], rr[0][1], zPrev]);
        lap(rr, zPrev, z, 1, cur.pts); // descente progressive sur le tour
      } else {
        if (cur) out.push(cur);
        cur = { pts: [[rr[0][0], rr[0][1], 0]] };
        lap(rr, 0, z, rampLaps(rr, z), cur.pts);
        lap(rr, z, z, 1, cur.pts);
      }
      end = rr[0]; zPrev = z;
    }
    out.push(cur);
    return out;
  }

  const PRIORITY = { pocket: 0, relief: 0.2, vcarve: 0.5, inside: 1, online: 2, outside: 3 };

  // shapes -> { paths, warnings }
  TP.generate = ({ shapes, stock, bit, params, overcut, facing }) => {
    const warnings = [];
    const r = bit.diameter / 2;
    const items = shapes
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.cut && s.cut.type !== 'none' && s.cut.depth > 0)
      .sort((a, b) => PRIORITY[a.s.cut.type] - PRIORITY[b.s.cut.type] || a.i - b.i);
    const paths = [];

    // surfaçage du dessus du matériau : poche sur tout le brut, débordant d'un rayon de fraise pour couvrir les bords
    if (facing && facing.on && facing.depth > 0) {
      const e = r;
      const rect = [{ closed: true, pts: [[-e, -e], [stock.w + e, -e], [stock.w + e, stock.h + e], [-e, stock.h + e]] }];
      const res = pocketPaths(toClip(rect), r, params.stepover, facing.depth, params.doc);
      if (res) res.forEach((p) => paths.push(p));
      if (bit.diameter < 6) warnings.push(`Surfaçage : une fraise de ${bit.diameter} mm est très lente pour surfacer. Une fraise ≥ 6 mm est conseillée.`);
    }

    for (const { s } of items) {
      const label = s.name || G.names[s.kind] || 'Forme';
      let D = Math.min(s.cut.depth, stock.t);
      if (s.cut.depth >= stock.t - 1e-6) D = stock.t + overcut;
      if (bit.cutLength && D > bit.cutLength) warnings.push(`« ${label} » : profondeur ${CNC.round(D, 1)} mm > longueur de coupe de la fraise (${bit.cutLength} mm).`);
      if (s.kind === 'relief') { // gravure 3D : ébauche + finition calculées par CNC.relief
        paths.push(...CNC.relief.paths(s, { stock, bit, params, warnings, label }));
        continue;
      }
      const polys = G.worldPolys(s);
      const closed = polys.filter((p) => p.closed && p.pts.length > 2);
      const open = polys.filter((p) => !p.closed && p.pts.length > 1);
      let type = s.cut.type;
      if (bit.type === 'vbit' && type !== 'online' && type !== 'vcarve') warnings.push(`« ${label} » : une fraise de gravure en V convient surtout au mode « Sur le tracé ».`);

      if (open.length && type !== 'online') {
        warnings.push(`« ${label} » : tracé ouvert, usiné « Sur le tracé ».`);
        open.forEach((p) => paths.push(openPath(p.pts, D, params.doc)));
      } else if (open.length) {
        open.forEach((p) => paths.push(openPath(p.pts, D, params.doc)));
      }
      if (!closed.length) continue;
      const clip = toClip(closed);
      // tenons de maintien (contours seulement, et uniquement si la coupe traverse jusqu'aux tenons)
      const tb = s.cut.tabs;
      const tabsWanted = !!(tb && tb.on && (type === 'outside' || type === 'inside' || type === 'online'));
      const tabsOn = tabsWanted && D > stock.t - tb.height + 1e-6;
      if (tabsWanted && !tabsOn) warnings.push(`« ${label} » : tenons sans effet (la profondeur n'atteint pas le bas du matériau).`);
      const mk = (ring) => ringPath(tabsOn ? applyTabs(ring, tb, -(stock.t - tb.height), r) : ring, D, params.doc);

      if (type === 'online') {
        closed.forEach((p) => {
          let pts = p.pts.slice();
          if (CNC.dist(pts[0], pts[pts.length - 1]) < 1e-6) pts.pop();
          if (pts.length > 2) paths.push(mk(pts));
        });
      } else if (type === 'outside') {
        const rings = offset(clip, r);
        if (!rings.length) warnings.push(`« ${label} » : contour introuvable.`);
        rings.forEach((ring) => paths.push(mk(ring)));
      } else if (type === 'inside') {
        const rings = offset(clip, -r);
        if (!rings.length) warnings.push(`« ${label} » : trop petit pour la fraise (Ø ${bit.diameter} mm), ignoré.`);
        rings.forEach((ring) => paths.push(mk(ring.slice().reverse())));
      } else if (type === 'vcarve') {
        if (bit.type !== 'vbit') warnings.push(`« ${label} » : le V-carve demande une fraise de gravure en V (choisissez-en une dans l'onglet Fraiser).`);
        else {
          const res = vcarvePaths(clip, bit, D);
          if (!res) warnings.push(`« ${label} » : forme trop fine pour le V-carve, ignorée.`);
          else res.forEach((p) => paths.push(p));
        }
      } else if (type === 'pocket') {
        const res = pocketPaths(clip, r, params.stepover, D, params.doc);
        if (!res) warnings.push(`« ${label} » : trop petit pour la fraise (Ø ${bit.diameter} mm), ignoré.`);
        else res.forEach((p) => paths.push(p));
      }
    }
    return { paths, warnings };
  };

  // Chemins -> déplacements ordonnés (G0 rapide / G1 coupe), partagés par le G-code, la simulation et l'estimation du temps
  TP.toMoves = (paths, safeZ, entryClear) => {
    const moves = [{ r: 1, x: 0, y: 0, z: safeZ }];
    let cur = moves[0];
    const push = (r, x, y, z) => { cur = { r, x, y, z }; moves.push(cur); };
    for (const p of paths) {
      const [x, y, z] = p.pts[0];
      if (cur.z < safeZ) push(1, cur.x, cur.y, safeZ);
      push(1, x, y, safeZ);
      push(1, x, y, Math.min(z + entryClear, safeZ));
      push(0, x, y, z);
      for (let i = 1; i < p.pts.length; i++) push(0, p.pts[i][0], p.pts[i][1], p.pts[i][2]);
    }
    if (cur.z < safeZ) push(1, cur.x, cur.y, safeZ);
    return moves;
  };

  // Vitesse effective d'un déplacement de coupe (la composante Z ne dépasse pas l'avance de plongée)
  TP.cutFeed = (a, b, params) => {
    const dz = b.z - a.z;
    if (dz >= -1e-9) return params.feed;
    const len = Math.hypot(b.x - a.x, b.y - a.y, dz);
    return Math.min(params.feed, (params.plunge * len) / Math.abs(dz));
  };

  TP.stats = (moves, params, rapidSpeed) => {
    let cutLen = 0, rapidLen = 0, sec = 0;
    for (let i = 1; i < moves.length; i++) {
      const a = moves[i - 1], b = moves[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      if (b.r) { rapidLen += len; sec += (len / rapidSpeed) * 60; }
      else { cutLen += len; sec += (len / TP.cutFeed(a, b, params)) * 60; }
    }
    return { cutLen, rapidLen, sec };
  };
})();
