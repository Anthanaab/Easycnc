// Formes : coordonnées locales normalisées (-0.5..0.5), transformées en mm dans le repère matériau (Y vers le haut).
(function () {
  const CNC = window.CNC;
  const G = (CNC.geom = {});

  G.defaults = {
    rect: { w: 30, h: 30 },
    ellipse: { w: 30, h: 30 },
    polygon: { w: 30, h: 30, sides: 6 },
    star: { w: 36, h: 36, sides: 5 },
  };
  G.names = { rect: 'Rectangle', ellipse: 'Cercle', polygon: 'Polygone', star: 'Étoile', path: 'Tracé', text: 'Texte', relief: 'Relief 3D' };

  G.make = (kind, x, y, opts) => {
    const d = G.defaults[kind] || { w: 20, h: 20 };
    return Object.assign(
      {
        id: CNC.uid(), kind, x, y, w: d.w, h: d.h, rot: 0, sides: d.sides || 0, polys: null,
        cut: { type: 'outside', depth: 5 },
      },
      opts || {}
    );
  };

  G.localPolys = (s) => {
    switch (s.kind) {
      case 'rect':
        return [{ pts: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], closed: true }];
      case 'ellipse': {
        const r = Math.max(s.w, s.h, 0.1) / 2;
        const n = CNC.clamp(Math.ceil(Math.PI / Math.acos(1 - 0.02 / Math.max(r, 0.05))), 24, 360);
        const pts = [];
        for (let i = 0; i < n; i++) {
          const t = (2 * Math.PI * i) / n;
          pts.push([0.5 * Math.cos(t), 0.5 * Math.sin(t)]);
        }
        return [{ pts, closed: true }];
      }
      case 'polygon': {
        const n = Math.max(3, Math.round(s.sides || 6));
        const pts = [];
        for (let i = 0; i < n; i++) {
          const t = Math.PI / 2 + (2 * Math.PI * i) / n;
          pts.push([0.5 * Math.cos(t), 0.5 * Math.sin(t)]);
        }
        return [{ pts, closed: true }];
      }
      case 'star': {
        const n = Math.max(3, Math.round(s.sides || 5));
        const pts = [];
        for (let i = 0; i < n * 2; i++) {
          const t = Math.PI / 2 + (Math.PI * i) / n;
          const r = i % 2 ? 0.21 : 0.5;
          pts.push([r * Math.cos(t), r * Math.sin(t)]);
        }
        return [{ pts, closed: true }];
      }
      case 'relief':
        return [{ pts: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], closed: true }];
      case 'text':
        return CNC.text.get(s).polys;
      case 'path':
        return s.polys || [];
    }
    return [];
  };

  G.worldPolys = (s) =>
    G.localPolys(s).map((p) => ({
      closed: p.closed,
      pts: p.pts.map(([u, v]) => {
        const [rx, ry] = CNC.rotate(u * s.w, v * s.h, s.rot);
        return [s.x + rx, s.y + ry];
      }),
    }));

  G.bbox = (polys) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of polys) for (const [x, y] of p.pts) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { x0, y0, x1, y1 };
  };

  // Crée un « tracé » depuis des polylignes en mm (repère monde) : normalise autour du centre du cadre englobant.
  G.fromWorldPolys = (polys, name, offset) => {
    const b = G.bbox(polys);
    const w = Math.max(b.x1 - b.x0, 0.01), h = Math.max(b.y1 - b.y0, 0.01);
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const local = polys.map((p) => ({ closed: p.closed, pts: p.pts.map(([x, y]) => [(x - cx) / w, (y - cy) / h]) }));
    const s = G.make('path', cx + (offset ? offset[0] : 0), cy + (offset ? offset[1] : 0), { w, h, polys: local });
    if (name) s.name = name;
    if (!polys.some((p) => p.closed)) s.cut = { type: 'online', depth: 0.3 };
    return s;
  };

  const inPoly = (pts, x, y) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const segDist = (px, py, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - a[0]) * dx + (py - a[1]) * dy) / l2 : 0;
    t = CNC.clamp(t, 0, 1);
    return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
  };

  G.hit = (s, x, y, tol) => {
    if (s.kind === 'text') { // le texte se sélectionne en cliquant dans son cadre
      const [lx, ly] = CNC.rotate(x - s.x, y - s.y, -s.rot);
      return Math.abs(lx) <= s.w / 2 + tol && Math.abs(ly) <= s.h / 2 + tol;
    }
    const polys = G.worldPolys(s);
    let inside = false;
    for (const p of polys) {
      if (p.closed && inPoly(p.pts, x, y)) inside = !inside;
      const n = p.pts.length;
      for (let i = 0; i < (p.closed ? n : n - 1); i++) {
        if (segDist(x, y, p.pts[i], p.pts[(i + 1) % n]) <= tol) return true;
      }
    }
    return inside;
  };
})();

// Repères des tenons sur le contour d'une forme (pour l'affichage) : liste de polylignes en mm
(function () {
  const CNC = window.CNC;
  CNC.geom.tabMarks = (s) => {
    const tb = s.cut && s.cut.tabs;
    if (!tb || !tb.on) return [];
    const out = [];
    for (const p of CNC.geom.worldPolys(s)) {
      if (!p.closed || p.pts.length < 3) continue;
      const n = p.pts.length, cum = [0];
      for (let i = 0; i < n; i++) cum.push(cum[i] + CNC.dist(p.pts[i], p.pts[(i + 1) % n]));
      const L = cum[n], count = Math.max(1, Math.round(tb.count));
      const at = (d) => {
        d = ((d % L) + L) % L;
        let i = 0; while (i < n - 1 && cum[i + 1] < d) i++;
        const a = p.pts[i], b = p.pts[(i + 1) % n], t = (d - cum[i]) / ((cum[i + 1] - cum[i]) || 1);
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      };
      for (let j = 0; j < count; j++) {
        const c = ((j + 0.5) * L) / count, w = Math.min(tb.width, (L / count) * 0.8), seg = [];
        for (let k = 0; k <= 6; k++) seg.push(at(c - w / 2 + (w * k) / 6));
        out.push(seg);
      }
    }
    return out;
  };
})();
