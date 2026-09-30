// Outil Texte : contours des lettres depuis des polices embarquées (opentype.js).
(function () {
  const CNC = window.CNC;
  const T = (CNC.text = {});

  T.fonts = [
    ['roboto400', 'Roboto'],
    ['roboto700', 'Roboto Gras'],
    ['oswald500', 'Oswald (condensée)'],
    ['playfair700', 'Playfair (empattements)'],
    ['pacifico400', 'Pacifico (écriture)'],
  ];

  const fontObj = {}, cache = new Map();
  function getFont(id) {
    if (!fontObj[id]) {
      const bin = atob(CNC.fontData[id] || CNC.fontData.roboto700);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      fontObj[id] = opentype.parse(buf.buffer);
    }
    return fontObj[id];
  }

  // contours en mm (Y vers le haut), origine sur la ligne de base du texte
  function outline(text, fontId, size) {
    const font = getFont(fontId), lh = size * 1.2, polys = [];
    String(text).split('\n').forEach((line, li) => {
      if (!line.trim()) return;
      const cmds = font.getPath(line, 0, 0, size).commands;
      let cur = null, px = 0, py = 0;
      const pt = (x, y) => [x, -y - li * lh];
      const end = () => { if (cur && cur.length > 2) polys.push({ closed: true, pts: cur }); cur = null; };
      for (const c of cmds) {
        if (c.type === 'M') { end(); cur = [pt(c.x, c.y)]; px = c.x; py = c.y; }
        else if (c.type === 'L') { cur.push(pt(c.x, c.y)); px = c.x; py = c.y; }
        else if (c.type === 'Q') {
          for (let i = 1; i <= 8; i++) {
            const t = i / 8, u = 1 - t;
            cur.push(pt(u * u * px + 2 * u * t * c.x1 + t * t * c.x, u * u * py + 2 * u * t * c.y1 + t * t * c.y));
          }
          px = c.x; py = c.y;
        } else if (c.type === 'C') {
          for (let i = 1; i <= 10; i++) {
            const t = i / 10, u = 1 - t;
            cur.push(pt(
              u * u * u * px + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
              u * u * u * py + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y));
          }
          px = c.x; py = c.y;
        } else if (c.type === 'Z') end();
      }
      end();
    });
    // retire le point de fermeture dupliqué
    polys.forEach((p) => { if (CNC.dist(p.pts[0], p.pts[p.pts.length - 1]) < 1e-6) p.pts.pop(); });
    return polys;
  }

  // { polys (normalisés -0.5..0.5), w, h } pour la forme texte s
  T.get = (s) => {
    const key = [s.font, s.size, s.text].join('\u0001');
    let r = cache.get(key);
    if (!r) {
      const world = outline(s.text || '', s.font || 'roboto700', s.size || 20);
      if (!world.length) r = { polys: [], w: s.size || 20, h: s.size || 20 };
      else {
        const b = CNC.geom.bbox(world);
        const w = Math.max(b.x1 - b.x0, 0.01), h = Math.max(b.y1 - b.y0, 0.01), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
        r = {
          w, h,
          polys: world.map((p) => ({ closed: true, pts: p.pts.map(([x, y]) => [(x - cx) / w, (y - cy) / h]) })),
        };
      }
      if (cache.size > 200) cache.clear();
      cache.set(key, r);
    }
    return r;
  };

  // remet la taille naturelle du texte (après modification du texte, de la police ou de la taille)
  T.fit = (s) => { const r = T.get(s); s.w = CNC.round(r.w, 2); s.h = CNC.round(r.h, 2); };

  T.make = (x, y, stock) => {
    const s = CNC.geom.make('text', x, y, { text: 'Texte', font: 'roboto700', size: 20 });
    T.fit(s);
    s.cut = { type: 'pocket', depth: Math.min(1, stock.t) };
    return s;
  };
})();
