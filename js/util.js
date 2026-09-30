(function () {
  const CNC = (window.CNC = window.CNC || {});

  CNC.uid = () => Math.random().toString(36).slice(2, 9);
  CNC.clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  CNC.round = (v, d = 3) => {
    const k = Math.pow(10, d);
    return Math.round(v * k) / k;
  };
  CNC.rotate = (x, y, deg) => {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    return [x * c - y * s, x * s + y * c];
  };
  CNC.dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  CNC.deepCopy = (o) => JSON.parse(JSON.stringify(o));

  CNC.store = {
    get(k, d) {
      try {
        const v = localStorage.getItem('easycnc.' + k);
        return v == null ? d : JSON.parse(v);
      } catch (e) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem('easycnc.' + k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ }
    },
  };

  CNC.$ = (s, r) => (r || document).querySelector(s);
  CNC.$$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  // el('div', {class:'x', onclick: fn}, 'texte', autreNoeud)
  CNC.el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) {
      if (c == null || c === false) continue;
      n.append(c.nodeType ? c : document.createTextNode(c));
    }
    return n;
  };

  // Nombre lisible pour le G-code : 3 décimales max, sans zéros inutiles
  CNC.num = (v) => {
    const s = (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '');
    return s === '-0' || s === '' ? '0' : s;
  };

  CNC.download = (filename, text, mime) => {
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  CNC.fmtTime = (sec) => {
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ' h ' : '') + (h || m ? m + ' min ' : '') + s + ' s';
  };
})();
