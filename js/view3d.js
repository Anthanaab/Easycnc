// Vue 3D du résultat : carte de hauteurs du matériau creusée par la fraise (three.js).
(function () {
  const CNC = window.CNC;
  const V = (CNC.view3d = {});

  let host, renderer, scene, camera, controls, raf = 0, ready = false;
  let top, sides, bed, bedEdges, tool;
  let hm = null; // état de la carte de hauteurs
  let frameKey = '', userCam = false;

  V.init = (el) => {
    host = el;
    if (!window.THREE || !THREE.OrbitControls) {
      el.innerHTML = '<div class="v3d-msg">Vue 3D indisponible : la bibliothèque three.js n\'a pas pu être chargée (connexion internet requise).</div>';
      return;
    }
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    el.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(38, 1, 1, 5000);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.addEventListener('change', V.invalidate);
    controls.addEventListener('start', () => { userCam = true; });
    controls.maxPolarAngle = Math.PI * 0.499;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7a8c, 0.55));
    const dl = new THREE.DirectionalLight(0xffffff, 0.5);
    dl.position.set(-180, 320, 220);
    scene.add(dl);
    new ResizeObserver(V.resize).observe(el);
    ready = true;
    V.resize();
  };

  V.resize = () => {
    if (!ready) return;
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    frame();
    camera.updateProjectionMatrix();
    V.invalidate();
  };

  // cadre le matériau dans la vue (tient compte du format du panneau) tant que l'utilisateur n'a pas bougé la caméra
  function frame() {
    if (!hm || userCam) return;
    const tanV = Math.tan((camera.fov * Math.PI) / 360), tanH = tanV * camera.aspect;
    const fb = hm.fb, D = ((fb.size * 0.62) / Math.min(tanV, tanH)) * 1.15;
    controls.target.set(fb.cx, -hm.t / 2, fb.cz);
    camera.position.set(fb.cx, D * 0.62, fb.cz + D * 0.78);
    camera.near = 1; camera.far = D * 20; camera.updateProjectionMatrix();
    controls.update();
  }
  V.reframe = () => { userCam = false; frame(); V.invalidate(); };

  V.invalidate = () => {
    if (!ready || raf) return;
    raf = requestAnimationFrame(() => { raf = 0; renderer.render(scene, camera); });
  };

  const disposeObj = (o) => {
    if (!o) return;
    scene.remove(o);
    o.geometry && o.geometry.dispose();
    if (o.material) o.material.dispose();
  };

  // job : { stock, pos, area, material, moves, bit }
  V.setJob = (job) => {
    if (!ready) return;
    [top, sides, bed, bedEdges, tool].forEach(disposeObj);
    const st = job.stock, w = st.w, h = st.h, t = st.t;
    const c = CNC.clamp(Math.max(w, h) / 450, 0.2, 1);
    const nx = Math.round(w / c) + 1, ny = Math.round(h / c) + 1;
    const dx = w / (nx - 1), dy = h / (ny - 1);
    const moves = job.moves || [];
    const cum = new Float64Array(moves.length);
    for (let i = 1; i < moves.length; i++) {
      const a = moves[i - 1], b = moves[i];
      cum[i] = cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
    hm = {
      w, h, t, nx, ny, dx, dy, H: new Float32Array(nx * ny), moves, cum, total: cum[cum.length - 1] || 1,
      done: 0, lastProg: -1, bit: job.bit, color: new THREE.Color(job.material.color), base: job.base || 0, tabZ: job.tabZ || [],
    };

    // surface
    const n = nx * ny;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = (j * nx + i) * 3;
      pos[k] = i * dx - w / 2; pos[k + 2] = h / 2 - j * dy;
    }
    const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
    let q = 0;
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, cc = a + nx, d = cc + 1;
      idx[q++] = a; idx[q++] = b; idx[q++] = cc; idx[q++] = b; idx[q++] = d; idx[q++] = cc;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    top = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }));
    scene.add(top);

    // flancs du bloc (4 bandes qui suivent la hauteur des bords)
    const strips = [
      { list: Array.from({ length: nx }, (_, i) => [i, 0]), n: [0, 0, 1] },
      { list: Array.from({ length: ny }, (_, j) => [nx - 1, j]), n: [1, 0, 0] },
      { list: Array.from({ length: nx }, (_, i) => [nx - 1 - i, ny - 1]), n: [0, 0, -1] },
      { list: Array.from({ length: ny }, (_, j) => [0, ny - 1 - j]), n: [-1, 0, 0] },
    ];
    const total = strips.reduce((a, s) => a + s.list.length, 0);
    const sp = new Float32Array(total * 2 * 3), sn = new Float32Array(total * 2 * 3);
    const si = [];
    const sideRef = []; // indice de la carte pour chaque sommet haut
    let vtx = 0;
    for (const s of strips) {
      const base = vtx;
      s.list.forEach(([i, j], m) => {
        const x = i * dx - w / 2, z = h / 2 - j * dy;
        const kt = (base + m * 2) * 3, kb = kt + 3;
        sp[kt] = x; sp[kt + 2] = z; sp[kb] = x; sp[kb + 1] = -t; sp[kb + 2] = z;
        sn.set(s.n, kt); sn.set(s.n, kb);
        sideRef.push(j * nx + i);
        if (m < s.list.length - 1) {
          const T = base + m * 2, B = T + 1, T2 = T + 2, B2 = T + 3;
          si.push(T, B, T2, T2, B, B2);
        }
      });
      vtx += s.list.length * 2;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('normal', new THREE.BufferAttribute(sn, 3));
    sg.setIndex(si);
    sides = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: hm.color.clone().multiplyScalar(0.82), roughness: 0.95 }));
    hm.sideRef = sideRef;
    scene.add(sides);

    // plateau de la machine (zone de travail) sous le matériau
    const A = job.area, P = job.pos;
    if (A) {
      const bg = new THREE.PlaneGeometry(A.x, A.y);
      bg.rotateX(-Math.PI / 2);
      bed = new THREE.Mesh(bg, new THREE.MeshStandardMaterial({ color: 0x4a5566, roughness: 1 }));
      bed.position.set(A.x / 2 - P.x - w / 2, -t - 0.05, h / 2 - (A.y / 2 - P.y));
      scene.add(bed);
      bedEdges = new THREE.LineSegments(new THREE.EdgesGeometry(bg), new THREE.LineBasicMaterial({ color: 0x94a3b8 }));
      bedEdges.position.copy(bed.position);
      scene.add(bedEdges);
    }

    // fraise (repère de position pendant la simulation)
    const r = Math.max(job.bit.diameter / 2, 0.4);
    const tg = new THREE.CylinderGeometry(r, job.bit.type === 'vbit' ? 0.1 : r, 18, 20);
    tg.translate(0, 9, 0);
    tool = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ color: 0xdc2626, transparent: true, opacity: 0.85 }));
    tool.visible = false;
    scene.add(tool);

    const A0 = job.area, P0 = job.pos;
    hm.fb = A0 ? { cx: A0.x / 2 - P0.x - w / 2, cz: h / 2 - (A0.y / 2 - P0.y), size: Math.max(A0.x, A0.y, w, h) } : { cx: 0, cz: 0, size: Math.max(w, h) };
    buildMeasures(job);
    // cadrage de la caméra quand les dimensions changent
    const key = [w, h, t, A && A.x, A && A.y].join('|');
    if (key !== frameKey) {
      frameKey = key; userCam = false; frame();
    }
    refresh(true);
    V.setProgress(1, null, true);
  };

  // ----- cotes 3D : lignes + étiquettes qui font toujours face à la caméra -----
  let measures = null, showMeasures = CNC.store.get('measures', true);
  V.setMeasures = (on) => { showMeasures = on; if (measures) measures.visible = on; V.invalidate(); };

  function textSprite(text, size, color) {
    const cvs = document.createElement('canvas');
    cvs.width = 384; cvs.height = 96;
    const c = cvs.getContext('2d');
    c.font = '600 46px system-ui, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 9; c.strokeStyle = 'rgba(15,23,42,.85)'; c.strokeText(text, 192, 50);
    c.fillStyle = color; c.fillText(text, 192, 50);
    const tex = new THREE.CanvasTexture(cvs);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(size * 4, size, 1);
    sp.renderOrder = 10;
    return sp;
  }
  function dimLine3d(group, p0, p1, tickDir, text, size, color) {
    const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1), td = new THREE.Vector3(...tickDir).multiplyScalar(size * 0.25);
    const g = new THREE.BufferGeometry().setFromPoints([
      a, b, a.clone().sub(td), a.clone().add(td), b.clone().sub(td), b.clone().add(td)]);
    const line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, depthTest: false }));
    line.renderOrder = 9;
    // segments : a-b, puis les deux traits d'extrémité (paires 2-3 et 4-5)
    group.add(line);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const sp = textSprite(text, size, '#' + new THREE.Color(color).getHexString());
    sp.position.copy(mid).add(new THREE.Vector3(0, size * 0.9, 0));
    group.add(sp);
  }
  function buildMeasures(job) {
    if (measures) {
      scene.remove(measures);
      measures.traverse((o) => { o.geometry && o.geometry.dispose(); if (o.material) { o.material.map && o.material.map.dispose(); o.material.dispose(); } });
    }
    measures = new THREE.Group();
    const { w, h, t } = hm, fmt = (v) => String(CNC.round(v, 1)).replace('.', ',') + ' mm';
    const size = Math.max(w, h, job.area ? Math.max(job.area.x, job.area.y) * 0.7 : 0) / 11;
    const off = size * 1.6, gold = 0xfbbf24, grey = 0x94a3b8;
    // matériau : largeur (avant), hauteur (côté droit), épaisseur (coin avant gauche)
    dimLine3d(measures, [-w / 2, 0, h / 2 + off], [w / 2, 0, h / 2 + off], [0, 0, 1], fmt(w), size, gold);
    dimLine3d(measures, [w / 2 + off, 0, h / 2], [w / 2 + off, 0, -h / 2], [1, 0, 0], fmt(h), size, gold);
    dimLine3d(measures, [-w / 2 - off, 0, h / 2 + off * 0.2], [-w / 2 - off, -t, h / 2 + off * 0.2], [1, 0, 0], fmt(t), size, gold);
    // zone de travail de la machine
    if (job.area && bed) {
      const A = job.area, bx = bed.position.x, bz = bed.position.z, y = -t - 0.05;
      dimLine3d(measures, [bx - A.x / 2, y, bz + A.y / 2 + off * 0.7], [bx + A.x / 2, y, bz + A.y / 2 + off * 0.7], [0, 0, 1], fmt(A.x), size * 0.85, grey);
      dimLine3d(measures, [bx + A.x / 2 + off * 0.7, y, bz + A.y / 2], [bx + A.x / 2 + off * 0.7, y, bz - A.y / 2], [1, 0, 0], fmt(A.y), size * 0.85, grey);
    }
    measures.visible = showMeasures;
    scene.add(measures);
  }

  // ----- creusage -----
  function stamp(px, py, z, bit) {
    if (z >= 0) return;
    const { nx, ny, dx, dy, H } = hm;
    const r = bit.diameter / 2;
    let R = r, slope = 0;
    if (bit.type === 'vbit') {
      slope = 1 / Math.tan((((bit.angle || 60) / 2) * Math.PI) / 180);
      R = Math.min(8, r + -z / slope);
    }
    const i0 = Math.max(0, Math.floor((px - R) / dx)), i1 = Math.min(nx - 1, Math.ceil((px + R) / dx));
    const j0 = Math.max(0, Math.floor((py - R) / dy)), j1 = Math.min(ny - 1, Math.ceil((py + R) / dy));
    for (let j = j0; j <= j1; j++) {
      const yy = j * dy - py;
      for (let i = i0; i <= i1; i++) {
        const xx = i * dx - px;
        const d2 = xx * xx + yy * yy;
        if (d2 > R * R) continue;
        let hh;
        if (bit.type === 'ball') hh = z + r - Math.sqrt(Math.max(0, r * r - d2));
        else if (bit.type === 'vbit') hh = z + Math.max(0, Math.sqrt(d2) - r) * slope;
        else hh = z;
        const k = j * nx + i;
        if (hh < H[k]) H[k] = hh;
      }
    }
  }

  function carve(a, b, frac) {
    const bit = hm.bit;
    const bx = a.x + (b.x - a.x) * frac, by = a.y + (b.y - a.y) * frac, bz = a.z + (b.z - a.z) * frac;
    const L = Math.hypot(bx - a.x, by - a.y, bz - a.z);
    const step = Math.min(hm.dx, hm.dy) * 0.7;
    const n = Math.max(1, Math.ceil(L / step));
    for (let s = 0; s <= n; s++) {
      const f = s / n;
      stamp(a.x + (bx - a.x) * f, a.y + (by - a.y) * f, a.z + (bz - a.z) * f, bit);
    }
  }

  // progress : 0..1 ; cur : position de la fraise [x,y,z] (facultatif)
  V.setProgress = (p, cur, force) => {
    if (!ready || !hm) return;
    if (!force && Math.abs(p - hm.lastProg) < 1e-6) return;
    hm.lastProg = p;
    const { moves, cum, total } = hm;
    const target = total * p;
    let end = 0, frac = 1;
    if (moves.length > 1) {
      let lo = 1, hi = moves.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < target) lo = mid + 1; else hi = mid; }
      end = lo;
      const seg = cum[end] - cum[end - 1];
      frac = seg > 0 ? CNC.clamp((target - cum[end - 1]) / seg, 0, 1) : 1;
      if (p <= 0) end = 0;
    }
    if (end < hm.done) { hm.H.fill(0); hm.done = 0; }
    for (let i = hm.done + 1; i <= end; i++) {
      if (moves[i].r) continue;
      carve(moves[i - 1], moves[i], i === end ? frac : 1);
    }
    hm.done = frac >= 1 ? end : Math.max(0, end - 1);
    // fraise
    if (moves.length > 1 && p < 1 && end >= 1) {
      const a = moves[end - 1], b = moves[end];
      tool.visible = true;
      const x = a.x + (b.x - a.x) * frac, y = a.y + (b.y - a.y) * frac, z = a.z + (b.z - a.z) * frac;
      tool.position.set(x - hm.w / 2, z, hm.h / 2 - y);
    } else tool.visible = false;
    refresh();
  };

  // met à jour la géométrie (hauteurs, normales, couleurs) depuis la carte
  function refresh() {
    const { nx, ny, dx, dy, H, t, color, base, tabZ } = hm;
    const amber = new THREE.Color(0xf59e0b);
    const g = top.geometry;
    const pos = g.attributes.position.array, nor = g.attributes.normal.array, col = g.attributes.color.array;
    const bedC = new THREE.Color(0x3a4250);
    const cut = color.clone().multiplyScalar(0.72);
    const tmp = new THREE.Color();
    for (let j = 0; j < ny; j++) {
      const jm = j > 0 ? j - 1 : j, jp = j < ny - 1 ? j + 1 : j;
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i, o = k * 3;
        const im = i > 0 ? i - 1 : i, ip = i < nx - 1 ? i + 1 : i;
        const gx = (H[j * nx + ip] - H[j * nx + im]) / ((ip - im) * dx || 1);
        const gy = (H[jp * nx + i] - H[jm * nx + i]) / ((jp - jm) * dy || 1);
        const inv = 1 / Math.hypot(gx, 1, gy);
        pos[o + 1] = H[k];
        nor[o] = -gx * inv; nor[o + 1] = inv; nor[o + 2] = gy * inv;
        const hh = H[k];
        if (hh > base - 0.005) tmp.copy(color);
        else if (tabZ.some((z) => Math.abs(hh - z) < 0.03)) tmp.copy(amber);
        else if (hh <= -t + 0.01) tmp.copy(bedC);
        else tmp.copy(color).lerp(cut, Math.min(1, 0.55 + ((base - hh) / t) * 0.45));
        col[o] = tmp.r; col[o + 1] = tmp.g; col[o + 2] = tmp.b;
      }
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    // flancs : le haut suit la hauteur du bord
    const sp = sides.geometry.attributes.position.array;
    hm.sideRef.forEach((k, m) => { sp[m * 6 + 1] = Math.max(H[k], -t); });
    sides.geometry.attributes.position.needsUpdate = true;
    V.invalidate();
  }
})();
