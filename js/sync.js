// Synchronisation des réglages avec le serveur (API /api, voir server/easycnc_api.py).
// Chargée juste après util.js : le contenu du serveur est récupéré AVANT que le reste de l'appli ne lise ses réglages.
// Sans serveur (fichier local, service arrêté), l'appli reste sur le stockage du navigateur.
(function () {
  const CNC = (window.CNC = window.CNC || {});
  const S = (CNC.sync = { mode: 'offline', status: 'offline', onStatus: null });
  const PFX = 'easycnc.';

  const setStatus = (st) => { S.status = st; if (S.onStatus) S.onStatus(st); };

  // --- chargement synchrone initial ---
  (function loadOnce() {
    if (location.protocol === 'file:') return;
    let remote = null;
    try {
      const x = new XMLHttpRequest();
      x.open('GET', 'api/store', false);
      x.send();
      if (x.status === 200) remote = JSON.parse(x.responseText);
    } catch (e) { remote = null; }
    if (!remote || typeof remote !== 'object') return;
    S.mode = 'server'; S.status = 'synced';
    try {
      for (const [k, v] of Object.entries(remote)) if (k.startsWith(PFX)) localStorage.setItem(k, v);
    } catch (e) { /* stockage local indisponible */ }
    // réglages présents seulement dans ce navigateur : envoyés au serveur (première utilisation, migration)
    S.initialPush = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith(PFX) && !(k in remote)) S.initialPush.push(k);
      }
    } catch (e) { /* ignoré */ }
  })();

  // --- envoi vers le serveur ---
  const pending = new Map();
  let timer = null, retry = null;

  async function flush() {
    if (S.mode !== 'server') return;
    const items = Array.from(pending);
    pending.clear();
    for (let i = 0; i < items.length; i++) {
      const [k, v] = items[i];
      try {
        const r = await fetch('api/store/' + encodeURIComponent(k), { method: 'PUT', body: v });
        if (!r.ok) throw new Error('HTTP ' + r.status);
      } catch (e) {
        // ce réglage et les suivants seront renvoyés (sauf s'ils ont été modifiés entre-temps)
        for (const [k2, v2] of items.slice(i)) if (!pending.has(k2)) pending.set(k2, v2);
        setStatus('error');
        clearTimeout(retry);
        retry = setTimeout(flush, 10000);
        return;
      }
    }
    if (!pending.size) setStatus('synced');
  }
  S.flushNow = () => { clearTimeout(timer); return flush(); };

  S.push = (key, value) => {
    if (S.mode !== 'server') return;
    pending.set(key, value);
    setStatus('saving');
    clearTimeout(timer);
    timer = setTimeout(flush, 400);
  };

  if (S.mode === 'server' && S.initialPush) S.initialPush.forEach((k) => S.push(k, localStorage.getItem(k)));
})();
