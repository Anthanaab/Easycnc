// Opérations sur les formes (union, soustraction, intersection) et alignement / répartition.
(function () {
  const CNC = window.CNC;
  const G = CNC.geom;
  const SC = 1000;
  const B = (CNC.bool = {});

  const toPaths = (shape) =>
    G.worldPolys(shape)
      .filter((p) => p.closed && p.pts.length > 2)
      .map((p) => p.pts.map(([x, y]) => ({ X: Math.round(x * SC), Y: Math.round(y * SC) })));
  // remplissage pair-impair -> contours extérieurs + trous correctement orientés
  const solid = (shape) => ClipperLib.Clipper.SimplifyPolygons(toPaths(shape), ClipperLib.PolyFillType.pftEvenOdd);

  function run(type, subject, clip) {
    const C = ClipperLib, c = new C.Clipper(), out = new C.Paths();
    c.AddPaths(subject, C.PolyType.ptSubject, true);
    c.AddPaths(clip, C.PolyType.ptClip, true);
    c.Execute(type, out, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero);
    return out;
  }

  // mode : 'union' | 'subtract' | 'intersect'. shapes : dans l'ordre de dessin (la première est la « base »).
  // Retourne une nouvelle forme (tracé) ou null si le résultat est vide.
  B.combine = (mode, shapes) => {
    const C = ClipperLib;
    let acc = solid(shapes[0]);
    for (const s of shapes.slice(1)) {
      const t = { union: C.ClipType.ctUnion, subtract: C.ClipType.ctDifference, intersect: C.ClipType.ctIntersection }[mode];
      acc = run(t, acc, solid(s));
    }
    const polys = acc.filter((p) => p.length > 2).map((p) => ({ closed: true, pts: p.map((q) => [q.X / SC, q.Y / SC]) }));
    if (!polys.length) return null;
    const res = G.fromWorldPolys(polys, { union: 'Fusion', subtract: 'Soustraction', intersect: 'Intersection' }[mode]);
    res.cut = CNC.deepCopy(shapes[0].cut);
    return res;
  };

  const box = (s) => G.bbox(G.worldPolys(s));

  // dir : 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'
  // ref : rectangle de référence {x0,y0,x1,y1} (sélection ou matériau)
  B.align = (shapes, dir, ref) => {
    for (const s of shapes) {
      const b = box(s);
      let dx = 0, dy = 0;
      if (dir === 'left') dx = ref.x0 - b.x0;
      if (dir === 'right') dx = ref.x1 - b.x1;
      if (dir === 'hcenter') dx = (ref.x0 + ref.x1) / 2 - (b.x0 + b.x1) / 2;
      if (dir === 'bottom') dy = ref.y0 - b.y0;
      if (dir === 'top') dy = ref.y1 - b.y1;
      if (dir === 'vcenter') dy = (ref.y0 + ref.y1) / 2 - (b.y0 + b.y1) / 2;
      s.x = CNC.round(s.x + dx, 3); s.y = CNC.round(s.y + dy, 3);
    }
  };

  B.selectionBox = (shapes) => {
    const all = [];
    shapes.forEach((s) => all.push(...G.worldPolys(s)));
    return G.bbox(all);
  };

  // axis : 'h' | 'v' : espaces égaux entre les formes (au moins 3)
  B.distribute = (shapes, axis) => {
    if (shapes.length < 3) return;
    const h = axis === 'h';
    const items = shapes.map((s) => ({ s, b: box(s) })).sort((a, c) => (h ? a.b.x0 - c.b.x0 : a.b.y0 - c.b.y0));
    const first = items[0].b, last = items[items.length - 1].b;
    const total = h ? last.x1 - first.x0 : last.y1 - first.y0;
    const sizes = items.reduce((a, it) => a + (h ? it.b.x1 - it.b.x0 : it.b.y1 - it.b.y0), 0);
    const gap = (total - sizes) / (items.length - 1);
    let pos = h ? first.x0 : first.y0;
    for (const it of items) {
      const size = h ? it.b.x1 - it.b.x0 : it.b.y1 - it.b.y0;
      const d = pos - (h ? it.b.x0 : it.b.y0);
      if (h) it.s.x = CNC.round(it.s.x + d, 3); else it.s.y = CNC.round(it.s.y + d, 3);
      pos += size + gap;
    }
  };
})();
