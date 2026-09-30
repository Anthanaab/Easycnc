// Gravure 3D : image en niveaux de gris -> relief. Ébauche par couches (suit le terrain) + finition en balayage.
// La position de la fraise est calculée par « drop-cutter » : Z(x,y) = max(H(x+dx,y+dy) - profil(d)) sur l'empreinte de la fraise.
(function () {
  const CNC = window.CNC;
  const R = (CNC.relief = {});

  // ---------- image ----------
  const cache = new Map();
  R.decode = (s) => {
    const im = s.img;
    if (!im) return null;
    const key = s.id + ':' + im.b64.length;
    let d = cache.get(key);
    if (!d) {
      const bin = atob(im.b64), a = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      d = { w: im.w, h: im.h, data: a };
      if (cache.size > 20) cache.clear();
      cache.set(key, d);
    }
    return d;
  };

  // fichier image -> { w, h, b64 } en niveaux de gris (grand côté <= maxSide)
  R.fromFile = (file, maxSide) =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const sc = Math.min(1, (maxSide || 300) / Math.max(img.width, img.height));
        const w = Math.max(2, Math.round(img.width * sc)), h = Math.max(2, Math.round(img.height * sc));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const c = cv.getContext('2d');
        c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); // transparence = blanc
        c.drawImage(img, 0, 0, w, h);
        const px = c.getImageData(0, 0, w, h).data, g = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) g[i] = Math.round(0.299 * px[4 * i] + 0.587 * px[4 * i + 1] + 0.114 * px[4 * i + 2]);
        let bin = '';
        for (let k = 0; k < g.length; k += 8192) bin += String.fromCharCode.apply(null, g.subarray(k, k + 8192));
        URL.revokeObjectURL(url);
        resolve({ w, h, b64: btoa(bin) });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image illisible')); };
      img.src = url;
    });

  // aperçu 2D (canvas) de l'image, avec l'inversion éventuelle
  const previews = new Map();
  R.preview = (s) => {
    const d = R.decode(s);
    if (!d) return null;
    const key = s.id + ':' + s.img.b64.length + ':' + (s.relief && s.relief.invert ? 1 : 0);
    let cv = previews.get(key);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.width = d.w; cv.height = d.h;
      const c = cv.getContext('2d'), im = c.createImageData(d.w, d.h), inv = s.relief && s.relief.invert;
      for (let i = 0; i < d.w * d.h; i++) {
        const v = inv ? 255 - d.data[i] : d.data[i];
        im.data[4 * i] = im.data[4 * i + 1] = im.data[4 * i + 2] = v; im.data[4 * i + 3] = 255;
      }
      c.putImageData(im, 0, 0);
      if (previews.size > 20) previews.clear();
      previews.set(key, cv);
    }
    return cv;
  };

  // ---------- grille de hauteurs ----------
  function sampleGray(d, u, v) { // bilinéaire, u,v dans [0,1]
    const x = CNC.clamp(u * (d.w - 1), 0, d.w - 1), y = CNC.clamp(v * (d.h - 1), 0, d.h - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(d.w - 1, x0 + 1), y1 = Math.min(d.h - 1, y0 + 1);
    const fx = x - x0, fy = y - y0, D = d.data;
    return ((D[y0 * d.w + x0] * (1 - fx) + D[y0 * d.w + x1] * fx) * (1 - fy) + (D[y1 * d.w + x0] * (1 - fx) + D[y1 * d.w + x1] * fx) * fy) / 255;
  }

  function buildHeights(s, depth, c, M) {
    const d = R.decode(s), inv = !!(s.relief && s.relief.invert);
    const b = CNC.geom.bbox(CNC.geom.worldPolys(s));
    const gx0 = b.x0 - M * c, gy0 = b.y0 - M * c;
    const nx = Math.ceil((b.x1 - b.x0) / c) + 1 + 2 * M, ny = Math.ceil((b.y1 - b.y0) / c) + 1 + 2 * M;
    const H = new Float32Array(nx * ny); // 0 = dessus du matériau (hors du relief aussi)
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const [lx, ly] = CNC.rotate(gx0 + i * c - s.x, gy0 + j * c - s.y, -s.rot);
      const u = lx / s.w + 0.5, v = 0.5 - ly / s.h;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      const g = sampleGray(d, u, v);
      H[j * nx + i] = -depth * (inv ? g : 1 - g); // blanc = dessus, noir = creux (inversible)
    }
    return { H, nx, ny, c, gx0, gy0, M };
  }

  function footprint(bit, c) {
    const r = bit.diameter / 2;
    let Rr = r, slope = 0;
    if (bit.type === 'vbit') { slope = 1 / Math.tan((((bit.angle || 60) / 2) * Math.PI) / 180); Rr = 6; }
    const n = Math.ceil(Rr / c), list = [];
    for (let dj = -n; dj <= n; dj++) for (let di = -n; di <= n; di++) {
      const d = Math.hypot(di, dj) * c;
      if (d > Rr + 1e-9) continue;
      const prof = bit.type === 'ball' ? r - Math.sqrt(Math.max(0, r * r - d * d)) : bit.type === 'vbit' ? Math.max(0, d - r) * slope : 0;
      list.push([di, dj, prof]);
    }
    return { list, margin: n + 1 };
  }

  // 3D : distance point-segment pour la simplification des lignes
  function simplify3(pts, tol) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const A = pts[a], B = pts[b], ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1e-12;
      let md = 0, mi = -1;
      for (let i = a + 1; i < b; i++) {
        const P = pts[i];
        const t = CNC.clamp(((P[0] - A[0]) * ab[0] + (P[1] - A[1]) * ab[1] + (P[2] - A[2]) * ab[2]) / l2, 0, 1);
        const dd = Math.hypot(P[0] - (A[0] + t * ab[0]), P[1] - (A[1] + t * ab[1]), P[2] - (A[2] + t * ab[2]));
        if (dd > md) { md = dd; mi = i; }
      }
      if (md > tol && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }

  // ctx : { stock, bit, params, warnings, label }
  R.paths = (s, ctx) => {
    const { stock, bit, params, warnings, label } = ctx;
    const rel = { rough: true, allow: 0.3, fstep: 0, ...(s.relief || {}) };
    if (!R.decode(s)) { warnings.push(`« ${label} » : image manquante.`); return []; }
    const depth = Math.min(s.cut.depth, stock.t);
    if (depth <= 0) return [];
    if (bit.type === 'flat') warnings.push(`« ${label} » : une fraise sphérique donne un bien meilleur relief qu'une fraise droite.`);

    let c = Math.max(0.2, Math.min(0.4, bit.diameter / 8));
    const bb = CNC.geom.bbox(CNC.geom.worldPolys(s));
    const area = (bb.x1 - bb.x0) * (bb.y1 - bb.y0);
    if (area / (c * c) > 700000) c = Math.sqrt(area / 700000);
    const fp = footprint(bit, c), M = fp.margin;
    const G = buildHeights(s, depth, c, M);
    const { H, nx, ny, gx0, gy0 } = G;
    const iA = M, iB = nx - M - 1, jA = M, jB = ny - M - 1;

    // Z de la fraise au-dessus de chaque nœud (drop-cutter)
    const ZF = new Float32Array(nx * ny);
    for (let j = jA; j <= jB; j++) for (let i = iA; i <= iB; i++) {
      let best = -Infinity;
      for (const [di, dj, prof] of fp.list) { const v = H[(j + dj) * nx + i + di] - prof; if (v > best) best = v; }
      ZF[j * nx + i] = Math.min(0, best);
    }
    const X = (i) => gx0 + i * c, Y = (j) => gy0 + j * c;
    const rows = (stride) => {
      const r = [];
      for (let j = jA; j <= jB; j += stride) r.push(j);
      if (r[r.length - 1] !== jB) r.push(jB);
      return r;
    };
    const paths = [];

    // ---- ébauche par couches : la fraise suit le terrain + réserve, sans descendre sous le niveau de la couche ----
    const allow = Math.max(0, rel.allow);
    const ZR = (idx) => Math.min(0, ZF[idx] + allow);
    if (rel.rough !== false) {
      let minZR = 0;
      for (let j = jA; j <= jB; j++) for (let i = iA; i <= iB; i++) minZR = Math.min(minZR, ZR(j * nx + i));
      const stride = Math.max(1, Math.round(params.stepover / c));
      const rr = rows(stride);
      let prev = 0;
      for (let k = 1; prev > minZR + 1e-6 && k < 200; k++) {
        const L = Math.max(-k * params.doc, minZR);
        const need = (i, j) => ZR(j * nx + i) < prev - 1e-6;
        let cur = null, curRow = -1, curEnd = -1, dirPlus = true;
        const flush = () => { if (cur) paths.push({ pts: simplify3(cur, 0.01) }); cur = null; };
        rr.forEach((j, ri) => {
          // segments contigus où il faut enlever de la matière
          const runs = [];
          for (let i = iA; i <= iB; i++) {
            if (!need(i, j)) continue;
            const a = i; while (i + 1 <= iB && need(i + 1, j)) i++;
            runs.push([a, i]);
          }
          if (!dirPlus) runs.reverse();
          for (const [a, b] of runs) {
            const seq = [];
            if (dirPlus) for (let i = a; i <= b; i++) seq.push(i); else for (let i = b; i >= a; i--) seq.push(i);
            const pts = seq.map((i) => [X(i), Y(j), Math.max(ZR(j * nx + i), L)]);
            // raccord avec la ligne précédente si tout le trajet est dans la zone à enlever
            let joined = false;
            if (cur && curRow === rr[ri - 1] && Math.abs(seq[0] - curEnd) <= 3) {
              const conn = [];
              let ok = true;
              for (let jj = curRow + 1; jj <= j && ok; jj++) { if (!need(curEnd, jj)) ok = false; else conn.push([X(curEnd), Y(jj), Math.max(ZR(jj * nx + curEnd), L)]); }
              const step = seq[0] >= curEnd ? 1 : -1;
              for (let ii = curEnd + step; ok && (step > 0 ? ii <= seq[0] : ii >= seq[0]); ii += step) {
                if (!need(ii, j)) ok = false; else conn.push([X(ii), Y(j), Math.max(ZR(j * nx + ii), L)]);
              }
              if (ok) { cur.push(...conn, ...pts); joined = true; }
            }
            if (!joined) {
              flush();
              cur = [[pts[0][0], pts[0][1], prev], ...pts]; // descente verticale (<= une couche) depuis la couche précédente
            }
            curRow = j; curEnd = seq[seq.length - 1];
          }
          dirPlus = !dirPlus;
        });
        flush();
        prev = L;
      }
    }

    // ---- finition : balayage en zigzag, fraise posée sur la surface ----
    const fstep = rel.fstep > 0 ? rel.fstep : Math.max(0.2, 0.15 * Math.max(bit.diameter, 0.5));
    const fr = rows(Math.max(1, Math.round(fstep / c)));
    let line = [], dirPlus = true;
    fr.forEach((j, ri) => {
      const seq = [];
      if (dirPlus) for (let i = iA; i <= iB; i++) seq.push(i); else for (let i = iB; i >= iA; i--) seq.push(i);
      if (ri > 0) { // colonne de raccord entre la ligne précédente et celle-ci
        const jPrev = fr[ri - 1], i0 = seq[0];
        for (let jj = jPrev + 1; jj < j; jj++) line.push([X(i0), Y(jj), ZF[jj * nx + i0]]);
      }
      seq.forEach((i) => line.push([X(i), Y(j), ZF[j * nx + i]]));
      dirPlus = !dirPlus;
    });
    if (line.length) {
      const pts = simplify3(line, 0.01);
      pts.unshift([pts[0][0], pts[0][1], 0]); // plongée verticale au départ
      paths.push({ pts });
    }
    return paths;
  };
})();
