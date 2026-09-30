// Éditeur 2D sur canvas : dessin, sélection, déplacement, redimensionnement, rotation, zoom, simulation.
(function () {
  const CNC = window.CNC;
  const G = CNC.geom;
  const E = (CNC.editor = {});

  let cv, ctx, W = 0, H = 0, dpr = 1;
  const view = (E.view = { s: 4, ox: 40, oy: 400 }); // s = px/mm ; (ox,oy) = position écran de l'origine (0,0)
  E.project = null;
  E.selection = [];
  E.mode = 'design'; // 'design' | 'carve'
  E.sim = null; // { moves, cum, total, progress, bit, maxDepth }
  E.showRapids = true;
  E.on = { change() {}, select() {}, cursor() {} };

  const w2s = (x, y) => [view.ox + x * view.s, view.oy - y * view.s];
  const s2w = (px, py) => [(px - view.ox) / view.s, (view.oy - py) / view.s];

  // ---------- historique ----------
  const undoStack = [], redoStack = [];
  E.snapshot = () => {
    undoStack.push(JSON.stringify(E.project));
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
  };
  E.undo = () => {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(E.project));
    E.project = JSON.parse(undoStack.pop());
    afterHistory();
  };
  E.redo = () => {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(E.project));
    E.project = JSON.parse(redoStack.pop());
    afterHistory();
  };
  function afterHistory() {
    E.selection = E.selection.filter((id) => E.project.shapes.some((s) => s.id === id));
    E.on.select(); E.changed();
  }
  E.resetHistory = () => { undoStack.length = 0; redoStack.length = 0; };
  E.changed = () => { E.sim = null; E.on.change(); E.render(); };

  E.selected = () => E.project.shapes.filter((s) => E.selection.includes(s.id));
  E.setSelection = (ids) => { E.selection = ids; E.on.select(); E.render(); };

  // ---------- vue ----------
  E.init = (canvas) => {
    cv = canvas; ctx = cv.getContext('2d');
    new ResizeObserver(E.resize).observe(cv.parentElement);
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('dblclick', () => E.fit());
    window.addEventListener('keydown', onKey);
    E.resize();
  };

  E.resize = () => {
    const r = cv.parentElement.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = Math.max(50, r.width); H = Math.max(50, r.height);
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    if (!E._userView && E.project) E.fit(); else E.render();
  };

  // position du coin bas-gauche du matériau dans la zone de travail (centré par défaut)
  CNC.stockPos = (st, area) => ({
    x: st.px != null ? st.px : area ? (area.x - st.w) / 2 : 0,
    y: st.py != null ? st.py : area ? (area.y - st.h) / 2 : 0,
  });
  E.area = () => null; // fourni par l'application (zone de travail de la machine)
  // rectangle englobant (repère matériau) : zone machine + matériau
  E.bounds = () => {
    const st = E.project.stock, a = E.area();
    let b = { x0: 0, y0: 0, x1: st.w, y1: st.h };
    if (a) {
      const p = CNC.stockPos(st, a);
      b = { x0: Math.min(b.x0, -p.x), y0: Math.min(b.y0, -p.y), x1: Math.max(b.x1, a.x - p.x), y1: Math.max(b.y1, a.y - p.y) };
    }
    return b;
  };
  E.fit = () => {
    const b = E.bounds(), pad = 90, bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    view.s = Math.max(0.2, Math.min((W - pad * 2) / bw, (H - pad * 2) / bh));
    view.ox = (W - bw * view.s) / 2 - b.x0 * view.s;
    view.oy = (H + bh * view.s) / 2 + b.y0 * view.s;
    E.render();
  };
  E.zoom = (f, cx, cy) => {
    cx = cx == null ? W / 2 : cx; cy = cy == null ? H / 2 : cy;
    const [wx, wy] = s2w(cx, cy);
    E._userView = true;
    view.s = CNC.clamp(view.s * f, 0.3, 200);
    view.ox = cx - wx * view.s; view.oy = cy + wy * view.s;
    E.render();
  };
  function onWheel(e) {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    E.zoom(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }

  // ---------- poignées ----------
  const HANDLES = [[-1, 1], [0, 1], [1, 1], [-1, 0], [1, 0], [-1, -1], [0, -1], [1, -1]];
  function handlePos(s, sx, sy) {
    const [rx, ry] = CNC.rotate((sx * s.w) / 2, (sy * s.h) / 2, s.rot);
    return [s.x + rx, s.y + ry];
  }
  function rotHandlePos(s) {
    const [rx, ry] = CNC.rotate(0, s.h / 2 + 26 / view.s, s.rot);
    return [s.x + rx, s.y + ry];
  }
  function hitHandle(px, py) {
    if (E.mode !== 'design' || E.selection.length !== 1) return null;
    const s = E.selected()[0];
    if (!s) return null;
    const [rx, ry] = w2s(...rotHandlePos(s));
    if (Math.hypot(px - rx, py - ry) < 9) return { type: 'rotate' };
    for (const [sx, sy] of HANDLES) {
      const [hx, hy] = w2s(...handlePos(s, sx, sy));
      if (Math.hypot(px - hx, py - hy) < 8) return { type: 'resize', sx, sy };
    }
    return null;
  }

  // ---------- interactions ----------
  let drag = null;
  const evPos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

  function onDown(e) {
    cv.setPointerCapture(e.pointerId);
    const [px, py] = evPos(e);
    const [wx, wy] = s2w(px, py);
    if (e.button === 1 || e.button === 2 || E.mode !== 'design') {
      E._userView = true; drag = { type: 'pan', px, py, ox: view.ox, oy: view.oy };
      return;
    }
    const h = hitHandle(px, py);
    if (h) {
      const s = E.selected()[0];
      drag = { ...h, s0: { ...s }, moved: false };
      return;
    }
    const tol = 4 / view.s;
    let hit = null;
    for (let i = E.project.shapes.length - 1; i >= 0; i--) {
      if (G.hit(E.project.shapes[i], wx, wy, tol)) { hit = E.project.shapes[i]; break; }
    }
    if (hit) {
      if (e.shiftKey) {
        const has = E.selection.includes(hit.id);
        E.setSelection(has ? E.selection.filter((i) => i !== hit.id) : E.selection.concat(hit.id));
      } else if (!E.selection.includes(hit.id)) E.setSelection([hit.id]);
      drag = { type: 'move', wx, wy, starts: E.selected().map((s) => [s.id, s.x, s.y]), moved: false };
    } else {
      const st = E.project.stock, a = E.area();
      if (a && !e.shiftKey && wx >= 0 && wy >= 0 && wx <= st.w && wy <= st.h) {
        E.setSelection([]);
        drag = { type: 'stock', px, py, ox: view.ox, oy: view.oy, p0: CNC.stockPos(st, a), moved: false };
        return;
      }
      if (!e.shiftKey) E.setSelection([]);
      E._userView = true; drag = { type: 'pan', px, py, ox: view.ox, oy: view.oy };
    }
  }

  function onMove(e) {
    const [px, py] = evPos(e);
    const [wx, wy] = s2w(px, py);
    E.on.cursor(wx, wy);
    if (!drag) {
      const st = E.project.stock, over = E.mode === 'design' && E.area() && wx >= 0 && wy >= 0 && wx <= st.w && wy <= st.h;
      cv.style.cursor = E.mode === 'design' && hitHandle(px, py) ? 'pointer' : over ? 'move' : 'default';
      return;
    }
    if (drag.type === 'pan') {
      view.ox = drag.ox + (px - drag.px); view.oy = drag.oy + (py - drag.py);
      E.render();
      return;
    }
    if (drag.type === 'stock') {
      const st = E.project.stock, a = E.area();
      let nx = drag.p0.x + (px - drag.px) / view.s, ny = drag.p0.y - (py - drag.py) / view.s;
      if (a) { // reste dans la zone de travail quand il y tient
        if (st.w <= a.x) nx = CNC.clamp(nx, 0, a.x - st.w);
        if (st.h <= a.y) ny = CNC.clamp(ny, 0, a.y - st.h);
      }
      nx = CNC.round(nx, 1); ny = CNC.round(ny, 1);
      if (!drag.moved && (nx !== drag.p0.x || ny !== drag.p0.y)) { E.snapshot(); drag.moved = true; }
      st.px = nx; st.py = ny;
      // le matériau suit la souris : on garde la zone de travail immobile à l'écran
      view.ox = drag.ox + (nx - drag.p0.x) * view.s;
      view.oy = drag.oy - (ny - drag.p0.y) * view.s;
      E.on.change(); E.render();
      return;
    }
    if (!drag.moved) { E.snapshot(); drag.moved = true; }
    if (drag.type === 'move') {
      const dx = wx - drag.wx, dy = wy - drag.wy;
      for (const [id, x, y] of drag.starts) {
        const s = E.project.shapes.find((q) => q.id === id);
        s.x = CNC.round(x + dx, 2); s.y = CNC.round(y + dy, 2);
      }
    } else if (drag.type === 'rotate') {
      const s = E.project.shapes.find((q) => q.id === drag.s0.id);
      let a = (Math.atan2(wy - s.y, wx - s.x) * 180) / Math.PI - 90;
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      s.rot = CNC.round(((a % 360) + 360) % 360, 1);
    } else if (drag.type === 'resize') {
      const s = E.project.shapes.find((q) => q.id === drag.s0.id);
      const s0 = drag.s0;
      const [lx, ly] = CNC.rotate(wx - s0.x, wy - s0.y, -s0.rot);
      let w = s0.w, h = s0.h, cxl = 0, cyl = 0;
      if (drag.sx) {
        const ax = (-drag.sx * s0.w) / 2;
        w = Math.max(0.5, drag.sx * (lx - ax));
        cxl = ax + (drag.sx * w) / 2;
      }
      if (drag.sy) {
        const ay = (-drag.sy * s0.h) / 2;
        h = Math.max(0.5, drag.sy * (ly - ay));
        cyl = ay + (drag.sy * h) / 2;
      }
      if ((e.shiftKey || s0.lock) && drag.sx && drag.sy) {
        const k = Math.max(w / s0.w, h / s0.h);
        w = s0.w * k; h = s0.h * k;
        cxl = (-drag.sx * s0.w) / 2 + (drag.sx * w) / 2;
        cyl = (-drag.sy * s0.h) / 2 + (drag.sy * h) / 2;
      }
      const [rx, ry] = CNC.rotate(cxl, cyl, s0.rot);
      s.w = CNC.round(w, 2); s.h = CNC.round(h, 2);
      s.x = CNC.round(s0.x + rx, 2); s.y = CNC.round(s0.y + ry, 2);
    }
    E.on.change(); E.on.select(); E.render();
  }

  function onUp() { drag = null; }

  function onKey(e) {
    const t = e.target;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if (E.mode !== 'design') return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? E.redo() : E.undo(); return; }
    if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); E.redo(); return; }
    if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); E.setSelection(E.project.shapes.map((s) => s.id)); return; }
    if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); E.duplicate(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); E.removeSelected(); return; }
    const step = e.altKey ? 0.1 : e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (d && E.selection.length) {
      e.preventDefault(); E.snapshot();
      E.selected().forEach((s) => { s.x = CNC.round(s.x + d[0] * step, 2); s.y = CNC.round(s.y + d[1] * step, 2); });
      E.changed(); E.on.select();
    }
  }

  // ---------- actions ----------
  E.addShape = (shape) => {
    E.snapshot();
    E.project.shapes.push(shape);
    E.selection = [shape.id];
    E.on.select(); E.changed();
  };
  E.removeSelected = () => {
    if (!E.selection.length) return;
    E.snapshot();
    E.project.shapes = E.project.shapes.filter((s) => !E.selection.includes(s.id));
    E.selection = [];
    E.on.select(); E.changed();
  };
  E.duplicate = () => {
    if (!E.selection.length) return;
    E.snapshot();
    const copies = E.selected().map((s) => ({ ...CNC.deepCopy(s), id: CNC.uid(), x: s.x + 5, y: s.y - 5 }));
    E.project.shapes.push(...copies);
    E.selection = copies.map((c) => c.id);
    E.on.select(); E.changed();
  };
  E.reorder = (dir) => {
    if (E.selection.length !== 1) return;
    E.snapshot();
    const a = E.project.shapes, i = a.findIndex((s) => s.id === E.selection[0]), j = i + dir;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    E.changed();
  };

  // ---------- rendu ----------
  function trace(polys) {
    ctx.beginPath();
    for (const p of polys) {
      p.pts.forEach(([x, y], i) => { const [sx, sy] = w2s(x, y); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
      if (p.closed) ctx.closePath();
    }
  }

  const CUT_STYLE = {
    outside: { stroke: '#2563eb', fill: null },
    inside: { stroke: '#0d9488', fill: null },
    online: { stroke: '#7c3aed', fill: null },
    pocket: { stroke: '#92400e', fill: true },
    none: { stroke: '#8a8f98', fill: null },
  };

  function drawGrid(gx, gy, gw, gh, alpha) {
    const minor = [1, 5, 10, 50, 100].find((v) => v * view.s >= 10) || 100;
    const major = minor * (minor === 5 ? 2 : 5);
    const [x0, y0] = w2s(gx, gy + gh), [x1, y1] = w2s(gx + gw, gy);
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
    const col = (isMajor) => `rgba(0,0,0,${(isMajor ? 0.18 : 0.07) * alpha})`;
    for (let v = 0; v <= gw + 1e-6; v += minor) {
      const [sx] = w2s(gx + v, 0);
      ctx.strokeStyle = col(v % major < 1e-6);
      ctx.beginPath(); ctx.moveTo(sx, y0); ctx.lineTo(sx, y1); ctx.stroke();
    }
    for (let v = 0; v <= gh + 1e-6; v += minor) {
      const [, sy] = w2s(0, gy + v);
      ctx.strokeStyle = col(v % major < 1e-6);
      ctx.beginPath(); ctx.moveTo(x0, sy); ctx.lineTo(x1, sy); ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- mesures (règles, cotes du matériau, cotes de la sélection) ----------
  E.showMeasures = CNC.store.get('measures', true);
  const darkUI = () => window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const fmt = (v) => String(CNC.round(v, 1)).replace('.', ',');

  function label(text, x, y, o) {
    o = o || {};
    ctx.save();
    ctx.font = (o.bold ? '600 ' : '') + (o.size || 11) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.translate(x, y);
    if (o.rot) ctx.rotate(-Math.PI / 2);
    if (o.halo) { ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(text, 0, 0); }
    ctx.fillStyle = o.color || (darkUI() ? '#a9b6c8' : '#475569');
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
  // cote horizontale : de x0 à x1 (monde) à la hauteur écran sy
  function dimH(x0, x1, sy, text, o) {
    const [a] = w2s(x0, 0), [b] = w2s(x1, 0);
    ctx.save(); ctx.strokeStyle = (o && o.color) || (darkUI() ? '#a9b6c8' : '#475569'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a, sy); ctx.lineTo(b, sy);
    ctx.moveTo(a, sy - 4); ctx.lineTo(a, sy + 4); ctx.moveTo(b, sy - 4); ctx.lineTo(b, sy + 4); ctx.stroke(); ctx.restore();
    label(text, (a + b) / 2, sy + ((o && o.above) ? -9 : 10), { bold: true, ...(o || {}) });
  }
  function dimV(y0, y1, sx, text, o) {
    const [, a] = w2s(0, y0), [, b] = w2s(0, y1);
    ctx.save(); ctx.strokeStyle = (o && o.color) || (darkUI() ? '#a9b6c8' : '#475569'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(sx, a); ctx.lineTo(sx, b);
    ctx.moveTo(sx - 4, a); ctx.lineTo(sx + 4, a); ctx.moveTo(sx - 4, b); ctx.lineTo(sx + 4, b); ctx.stroke(); ctx.restore();
    label(text, sx + ((o && o.right) ? 10 : -10), (a + b) / 2, { bold: true, rot: true, ...(o || {}) });
  }
  const niceStep = () => [1, 2, 5, 10, 20, 50, 100, 200, 500].find((v) => v * view.s >= 48) || 500;

  function drawMeasures() {
    const st = E.project.stock;
    const [ax, ay] = w2s(0, st.h), [bx, by] = w2s(st.w, 0);
    const col = darkUI() ? '#a9b6c8' : '#475569';
    // règles graduées sous et à gauche du matériau (0 = origine X0 Y0)
    const step = niceStep(), sub = step / (step === 2 || step === 20 || step === 200 ? 2 : 5);
    ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let v = 0; v <= st.w + 1e-6; v += sub) {
      const [sx] = w2s(v, 0), major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      ctx.moveTo(sx, by); ctx.lineTo(sx, by + (major ? 7 : 3.5));
    }
    for (let v = 0; v <= st.h + 1e-6; v += sub) {
      const [, sy] = w2s(0, v), major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      ctx.moveTo(ax, sy); ctx.lineTo(ax - (major ? 7 : 3.5), sy);
    }
    ctx.stroke(); ctx.restore();
    for (let v = 0; v <= st.w + 1e-6; v += step) label(String(CNC.round(v, 1)), w2s(v, 0)[0], by + 17, { size: 10 });
    for (let v = step; v <= st.h + 1e-6; v += step) label(String(CNC.round(v, 1)), ax - 20, w2s(0, v)[1], { size: 10 });
    // cotes du matériau
    dimH(0, st.w, by + 36, `${fmt(st.w)} mm  ·  épaisseur ${fmt(st.t)} mm`);
    dimV(0, st.h, ax - 36, `${fmt(st.h)} mm`);

    // cotes de la sélection (onglet Dessiner)
    if (E.mode === 'design' && E.selection.length) {
      const polys = [];
      E.selected().forEach((s) => polys.push(...G.worldPolys(s)));
      if (!polys.length) return;
      const b = G.bbox(polys), C = '#2563eb';
      const [l, t] = w2s(b.x0, b.y1), [r, bt] = w2s(b.x1, b.y0);
      dimH(b.x0, b.x1, t - 16, `${fmt(b.x1 - b.x0)} mm`, { color: C, halo: true, above: true });
      dimV(b.y0, b.y1, r + 16, `${fmt(b.y1 - b.y0)} mm`, { color: C, halo: true, right: true });
      // distances au bord gauche et au bord bas du matériau
      const cyS = (t + bt) / 2, cxS = (l + r) / 2;
      ctx.save(); ctx.setLineDash([4, 3]); ctx.strokeStyle = C; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ax, cyS); ctx.lineTo(l, cyS); ctx.moveTo(cxS, by); ctx.lineTo(cxS, bt); ctx.stroke(); ctx.restore();
      if (b.x0 > 0.05) label(`${fmt(b.x0)}`, (ax + l) / 2, cyS - 8, { color: C, halo: true, size: 10.5 });
      if (b.y0 > 0.05) label(`${fmt(b.y0)}`, cxS + 14, (by + bt) / 2, { color: C, halo: true, size: 10.5 });
    }
  }

  E.render = () => {
    if (!ctx || !E.project) return;
    const P = E.project, st = P.stock;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.lineJoin = 'round';

    // zone de travail de la machine (le matériau est posé dessus)
    const area = E.area();
    if (area) {
      const p = CNC.stockPos(st, area);
      const [tx0, ty0] = w2s(-p.x, area.y - p.y), [tx1, ty1] = w2s(area.x - p.x, -p.y);
      ctx.fillStyle = 'rgba(148,163,184,.28)';
      ctx.fillRect(tx0, ty0, tx1 - tx0, ty1 - ty0);
      drawGrid(-p.x, -p.y, area.x, area.y, 0.6);
      const fits = p.x >= -1e-6 && p.y >= -1e-6 && p.x + st.w <= area.x + 1e-6 && p.y + st.h <= area.y + 1e-6;
      ctx.setLineDash([8, 5]); ctx.lineWidth = 2;
      ctx.strokeStyle = fits ? '#64748b' : '#dc2626';
      ctx.strokeRect(tx0, ty0, tx1 - tx0, ty1 - ty0);
      ctx.setLineDash([]);
      ctx.fillStyle = fits ? '#64748b' : '#dc2626'; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(`Zone de travail ${area.x} × ${area.y} mm${fits ? '' : ' — le matériau dépasse !'}`, tx0 + 6, ty0 - 7);
    }

    // matériau
    const mat = CNC.material(st.materialId);
    const [ax, ay] = w2s(0, st.h), [bx, by] = w2s(st.w, 0);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 3;
    ctx.fillStyle = mat.color;
    ctx.fillRect(ax, ay, bx - ax, by - ay);
    ctx.restore();
    drawGrid(0, 0, st.w, st.h, 1);
    ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 1;
    ctx.strokeRect(ax, ay, bx - ax, by - ay);

    const [ox, oy] = w2s(0, 0);
    ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(ox - 6, oy); ctx.lineTo(ox + 14, oy); ctx.moveTo(ox, oy + 6); ctx.lineTo(ox, oy - 14); ctx.stroke();

    // formes
    for (const s of P.shapes) {
      const polys = G.worldPolys(s);
      const style = CUT_STYLE[s.cut ? s.cut.type : 'none'] || CUT_STYLE.none;
      const sel = E.selection.includes(s.id);
      trace(polys);
      if (style.fill && E.mode === 'design') {
        const a = 0.25 + 0.5 * CNC.clamp(s.cut.depth / Math.max(st.t, 0.1), 0, 1);
        ctx.fillStyle = `rgba(120,53,15,${a})`;
        ctx.fill('evenodd');
      }
      ctx.lineWidth = sel ? 2.5 : 1.5;
      ctx.strokeStyle = E.mode === 'carve' ? 'rgba(30,41,59,.45)' : style.stroke;
      ctx.setLineDash(s.cut && s.cut.type === 'none' ? [5, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      if (s.cut && s.cut.tabs && s.cut.tabs.on && s.cut.type !== 'pocket' && s.cut.type !== 'none') {
        ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (const seg of G.tabMarks(s)) {
          ctx.beginPath();
          seg.forEach(([x, y], i) => { const [sx, sy] = w2s(x, y); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 11; ctx.stroke(); // liseré pour rester lisible sur le matériau
          ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 7; ctx.stroke();
        }
        ctx.restore();
      }
    }

    // sélection
    if (E.mode === 'design') {
      for (const s of E.selected()) {
        const c = HANDLES.length && [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => w2s(...handlePos(s, sx, sy)));
        ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
        ctx.beginPath(); c.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (E.selection.length === 1) {
        const s = E.selected()[0];
        if (s) {
          const [rx, ry] = w2s(...rotHandlePos(s)), [tx, ty] = w2s(...handlePos(s, 0, 1));
          ctx.strokeStyle = '#2563eb'; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(rx, ry); ctx.stroke();
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.arc(rx, ry, 6, 0, 7); ctx.fill(); ctx.stroke();
          for (const [sx, sy] of HANDLES) {
            const [hx, hy] = w2s(...handlePos(s, sx, sy));
            ctx.fillStyle = '#fff'; ctx.fillRect(hx - 4.5, hy - 4.5, 9, 9); ctx.strokeRect(hx - 4.5, hy - 4.5, 9, 9);
          }
        }
      }
    }

    if (E.showMeasures) drawMeasures();
    if (E.mode === 'carve' && E.sim) { drawSim(); E.on.sim && E.on.sim(E.sim); }
  };

  // ---------- simulation ----------
  E.setSim = (moves, bit, stockDepth) => {
    const cum = new Float64Array(moves.length);
    for (let i = 1; i < moves.length; i++) {
      const a = moves[i - 1], b = moves[i];
      cum[i] = cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
    let maxDepth = 0.1;
    moves.forEach((m) => { if (-m.z > maxDepth) maxDepth = -m.z; });
    E.sim = { moves, cum, total: cum[cum.length - 1] || 1, progress: 1, bit, maxDepth };
    E.render();
  };
  E.setProgress = (p) => { if (E.sim) { E.sim.progress = p; E.render(); } };

  function drawSim() {
    const { moves, cum, total, progress, bit, maxDepth } = E.sim;
    const target = total * progress;
    let end = 1;
    // index de la dernière position atteinte
    let lo = 1, hi = moves.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < target) lo = mid + 1; else hi = mid; }
    end = Math.min(lo, moves.length - 1);

    const point = (i, frac) => {
      const a = moves[i - 1], b = moves[i];
      return [a.x + (b.x - a.x) * frac, a.y + (b.y - a.y) * frac, a.z + (b.z - a.z) * frac];
    };
    let cur = [moves[0].x, moves[0].y, moves[0].z];
    let fracEnd = 1;
    if (end >= 1 && target > 0) {
      const seg = cum[end] - cum[end - 1];
      fracEnd = seg > 0 ? CNC.clamp((target - cum[end - 1]) / seg, 0, 1) : 1;
      cur = point(end, fracEnd);
    }

    // rapides (non exécutés) + trajet complet en fin
    if (E.showRapids) {
      ctx.strokeStyle = 'rgba(100,116,139,.35)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath();
      for (let i = 1; i < moves.length; i++) {
        if (!moves[i].r || moves[i].z !== moves[i - 1].z) continue;
        const [x0, y0] = w2s(moves[i - 1].x, moves[i - 1].y), [x1, y1] = w2s(moves[i].x, moves[i].y);
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
      }
      ctx.stroke(); ctx.setLineDash([]);
    }

    // matière enlevée, par tranches de profondeur
    const B = 8;
    const paths = Array.from({ length: B }, () => new Path2D());
    for (let i = 1; i <= end; i++) {
      const m = moves[i];
      if (m.r) continue;
      let a = moves[i - 1], b = m;
      if (i === end && fracEnd < 1) { const q = point(i, fracEnd); b = { x: q[0], y: q[1], z: q[2] }; }
      const z = Math.min(-a.z, -b.z);
      const k = CNC.clamp(Math.floor((Math.max(z, 0) / maxDepth) * (B - 0.001)), 0, B - 1);
      const [x0, y0] = w2s(a.x, a.y), [x1, y1] = w2s(b.x, b.y);
      paths[k].moveTo(x0, y0); paths[k].lineTo(x1, y1);
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.5, bit.diameter * view.s);
    for (let k = 0; k < B; k++) {
      ctx.strokeStyle = `hsl(28, 55%, ${58 - k * 4.5}%)`;
      ctx.stroke(paths[k]);
    }
    ctx.lineCap = 'butt';

    // parcours restant (fin)
    ctx.strokeStyle = 'rgba(37,99,235,.55)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = end + 1; i < moves.length; i++) {
      if (moves[i].r) continue;
      const [x0, y0] = w2s(moves[i - 1].x, moves[i - 1].y), [x1, y1] = w2s(moves[i].x, moves[i].y);
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    }
    ctx.stroke();

    // fraise
    const [cx, cy] = w2s(cur[0], cur[1]);
    const rr = Math.max(4, (bit.diameter / 2) * view.s);
    ctx.strokeStyle = cur[2] < 0 ? '#dc2626' : '#16a34a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 7); ctx.moveTo(cx - rr - 4, cy); ctx.lineTo(cx + rr + 4, cy);
    ctx.moveTo(cx, cy - rr - 4); ctx.lineTo(cx, cy + rr + 4); ctx.stroke();
    E.sim.cur = cur;
  }
})();
