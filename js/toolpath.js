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

  // Ajoute `laps` tours du contour, en interpolant Z de zFrom à zTo. Part de ring[0] (déjà dans out).
  function lap(ring, zFrom, zTo, laps, out) {
    const n = ring.length, total = perimeter(ring) * laps;
    let s = 0, prev = ring[0];
    for (let l = 0; l < laps; l++) {
      for (let i = 1; i <= n; i++) {
        const p = ring[i % n];
        s += CNC.dist(prev, p);
        prev = p;
        out.push([p[0], p[1], zFrom + (zTo - zFrom) * (total ? s / total : 1)]);
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

  const PRIORITY = { pocket: 0, inside: 1, online: 2, outside: 3 };

  // shapes -> { paths, warnings }
  TP.generate = ({ shapes, stock, bit, params, overcut }) => {
    const warnings = [];
    const r = bit.diameter / 2;
    const items = shapes
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.cut && s.cut.type !== 'none' && s.cut.depth > 0)
      .sort((a, b) => PRIORITY[a.s.cut.type] - PRIORITY[b.s.cut.type] || a.i - b.i);
    const paths = [];

    for (const { s } of items) {
      const label = s.name || G.names[s.kind] || 'Forme';
      let D = Math.min(s.cut.depth, stock.t);
      if (s.cut.depth >= stock.t - 1e-6) D = stock.t + overcut;
      if (bit.cutLength && D > bit.cutLength) warnings.push(`« ${label} » : profondeur ${CNC.round(D, 1)} mm > longueur de coupe de la fraise (${bit.cutLength} mm).`);
      const polys = G.worldPolys(s);
      const closed = polys.filter((p) => p.closed && p.pts.length > 2);
      const open = polys.filter((p) => !p.closed && p.pts.length > 1);
      let type = s.cut.type;
      if (bit.type === 'vbit' && type !== 'online') warnings.push(`« ${label} » : une fraise de gravure en V convient surtout au mode « Sur le tracé ».`);

      if (open.length && type !== 'online') {
        warnings.push(`« ${label} » : tracé ouvert, usiné « Sur le tracé ».`);
        open.forEach((p) => paths.push(openPath(p.pts, D, params.doc)));
      } else if (open.length) {
        open.forEach((p) => paths.push(openPath(p.pts, D, params.doc)));
      }
      if (!closed.length) continue;
      const clip = toClip(closed);

      if (type === 'online') {
        closed.forEach((p) => {
          let pts = p.pts.slice();
          if (CNC.dist(pts[0], pts[pts.length - 1]) < 1e-6) pts.pop();
          if (pts.length > 2) paths.push(ringPath(pts, D, params.doc));
        });
      } else if (type === 'outside') {
        const rings = offset(clip, r);
        if (!rings.length) warnings.push(`« ${label} » : contour introuvable.`);
        rings.forEach((ring) => paths.push(ringPath(ring, D, params.doc)));
      } else if (type === 'inside') {
        const rings = offset(clip, -r);
        if (!rings.length) warnings.push(`« ${label} » : trop petit pour la fraise (Ø ${bit.diameter} mm), ignoré.`);
        rings.forEach((ring) => paths.push(ringPath(ring.slice().reverse(), D, params.doc)));
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
