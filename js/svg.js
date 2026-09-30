// Import SVG : échantillonnage des tracés en polylignes (mm), Y vers le haut.
(function () {
  const CNC = window.CNC;
  const NS = 'http://www.w3.org/2000/svg';

  // Sépare un attribut d d'un <path> en sous-chemins autonomes (chacun débute par un M absolu)
  function splitSubpaths(d) {
    const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
    const arity = { L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };
    let cx = 0, cy = 0, sx = 0, sy = 0, cur = null, m;
    const subs = [];
    while ((m = re.exec(d))) {
      const c = m[1], up = c.toUpperCase(), rel = c !== up;
      const nums = (m[2].match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || []).map(Number);
      if (up === 'M') {
        let x = nums[0], y = nums[1];
        if (rel) { x += cx; y += cy; }
        cx = sx = x; cy = sy = y;
        cur = { d: `M${x} ${y}`, closed: false };
        subs.push(cur);
        for (let i = 2; i + 1 < nums.length; i += 2) {
          const px = nums[i] + (rel ? cx : 0), py = nums[i + 1] + (rel ? cy : 0);
          cur.d += ` L${px} ${py}`; cx = px; cy = py;
        }
        continue;
      }
      if (!cur) { cur = { d: `M${cx} ${cy}`, closed: false }; subs.push(cur); }
      if (up === 'Z') { cur.d += ' Z'; cur.closed = true; cx = sx; cy = sy; cur = null; continue; }
      cur.d += c + m[2];
      const a = arity[up];
      for (let i = 0; i + a <= nums.length; i += a) {
        if (up === 'H') cx = nums[i] + (rel ? cx : 0);
        else if (up === 'V') cy = nums[i] + (rel ? cy : 0);
        else { const nx = nums[i + a - 2] + (rel ? cx : 0), ny = nums[i + a - 1] + (rel ? cy : 0); cx = nx; cy = ny; }
      }
    }
    return subs;
  }

  // Ramer–Douglas–Peucker
  function simplify(pts, tol) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let md = 0, mi = -1;
      const [ax, ay] = pts[a], [bx, by] = pts[b];
      const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1e-9;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / l;
        if (d > md) { md = d; mi = i; }
      }
      if (md > tol && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }

  // retourne { polys:[{pts,closed}], skipped:n } en mm
  CNC.importSvg = (text) => {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error('Fichier SVG invalide.');
    const live = document.importNode(root, true);
    const vb = live.viewBox && live.viewBox.baseVal;
    const w = live.getAttribute('width'), h = live.getAttribute('height');
    if ((!w || /%/.test(w) || !h || /%/.test(h)) && vb && vb.width) {
      live.setAttribute('width', vb.width); live.setAttribute('height', vb.height);
    }
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-100000px;top:0;width:4000px;height:4000px;overflow:hidden;visibility:hidden';
    host.appendChild(live);
    document.body.appendChild(host);

    const K = 25.4 / 96; // px CSS -> mm
    const polys = [];
    let skipped = live.querySelectorAll('text').length;
    let gid = -1; // un groupe par élément SVG : ses sous-chemins forment une seule forme (trous inclus)
    try {
      const measure = (el, closed) => {
        const m = el.getCTM();
        if (!m || !el.getTotalLength) return;
        const L = el.getTotalLength();
        if (!(L > 0)) return;
        const scale = Math.hypot(m.a, m.b) * K;
        const n = CNC.clamp(Math.ceil((L * scale) / 0.25), 4, 6000);
        let pts = [];
        for (let i = 0; i <= n; i++) {
          const p = el.getPointAtLength((L * i) / n);
          const q = new DOMPoint(p.x, p.y).matrixTransform(m);
          pts.push([q.x * K, -q.y * K]);
        }
        if (closed && CNC.dist(pts[0], pts[pts.length - 1]) < 1e-3) pts.pop();
        pts = simplify(pts, 0.01);
        if (pts.length >= (closed ? 3 : 2)) polys.push({ pts, closed, g: gid });
      };
      live.querySelectorAll('path,rect,circle,ellipse,polygon,polyline,line').forEach((el) => {
        const tag = el.tagName.toLowerCase();
        gid++;
        if (tag === 'path') {
          for (const sub of splitSubpaths(el.getAttribute('d') || '')) {
            const p = document.createElementNS(NS, 'path');
            p.setAttribute('d', sub.d);
            el.parentNode.insertBefore(p, el);
            try { measure(p, sub.closed); } finally { p.remove(); }
          }
        } else measure(el, tag !== 'polyline' && tag !== 'line');
      });
    } finally {
      host.remove();
    }
    return { polys, skipped };
  };
})();
