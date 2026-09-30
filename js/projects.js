// Projets enregistrés sur le serveur (API /api/projects) et navigateur de projets.
(function () {
  const CNC = window.CNC;
  const { el } = CNC;
  const P = (CNC.projects = {});

  P.available = () => CNC.sync && CNC.sync.mode === 'server';
  const ok = async (r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r; };
  P.list = async () => (await ok(await fetch('api/projects', { cache: 'no-store' }))).json();
  P.get = async (id) => (await ok(await fetch('api/projects/' + id, { cache: 'no-store' }))).json();
  P.save = async (project) => { await ok(await fetch('api/projects/' + project.id, { method: 'PUT', body: JSON.stringify(project) })); };
  P.remove = async (id) => { await ok(await fetch('api/projects/' + id, { method: 'DELETE' })); };
  P.duplicate = async (id) => {
    const p = await P.get(id);
    p.id = CNC.newId(); p.name = (p.name || 'Sans titre') + ' (copie)';
    await P.save(p);
    return p;
  };

  const fmtDate = (iso) => { try { return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return ''; } };

  // options : { currentId, onOpen(project), onImport(), onExport() }
  P.browse = (o) => {
    const listBox = el('div', { class: 'plist' });
    const filter = el('input', { type: 'text', placeholder: 'Rechercher un projet…' });
    let items = [], modal;
    const render = () => {
      listBox.innerHTML = '';
      const q = filter.value.trim().toLowerCase();
      const shown = items.filter((m) => !q || m.name.toLowerCase().includes(q));
      if (!shown.length) listBox.append(el('div', { class: 'muted', style: 'padding:14px 4px' }, items.length ? 'Aucun projet ne correspond.' : 'Aucun projet enregistré sur le serveur. Utilisez « Enregistrer » pour en créer un.'));
      for (const m of shown) {
        const dims = m.w ? `${m.w} × ${m.h} × ${m.t} mm` : '';
        const meta = [dims, `${m.shapes} forme${m.shapes > 1 ? 's' : ''}`, m.mode === 'laser' ? 'laser' : 'fraise', 'modifié ' + fmtDate(m.updated)].filter(Boolean).join(' · ');
        listBox.append(el('div', { class: 'pitem' + (m.id === o.currentId ? ' current' : '') },
          el('div', { class: 'pinfo' }, el('b', {}, m.name + (m.id === o.currentId ? '  (ouvert)' : '')), el('div', { class: 'muted' }, meta)),
          el('div', { class: 'pbtns' },
            el('button', { class: 'btn sm primary', onclick: async () => { try { o.onOpen(await P.get(m.id)); modal.close(); } catch (e) { alert('Ouverture impossible : ' + e.message); } } }, 'Ouvrir'),
            el('button', { class: 'btn sm', onclick: async () => { try { await P.duplicate(m.id); CNC.toast('Projet dupliqué'); await load(); } catch (e) { alert('Duplication impossible : ' + e.message); } } }, 'Dupliquer'),
            el('button', { class: 'btn sm danger', onclick: async () => { if (!confirm(`Supprimer le projet « ${m.name} » du serveur ?`)) return; try { await P.remove(m.id); await load(); } catch (e) { alert('Suppression impossible : ' + e.message); } } }, 'Supprimer'))));
      }
    };
    const load = async () => {
      try { items = await P.list(); } catch (e) { listBox.innerHTML = ''; listBox.append(el('div', { class: 'warn err' }, 'Serveur injoignable : ' + e.message)); return; }
      render();
    };
    filter.addEventListener('input', render);
    modal = CNC.modal({
      title: 'Projets enregistrés sur le serveur',
      body: el('div', {}, el('div', { class: 'row' }, filter), listBox),
      buttons: [
        { label: 'Importer un fichier…', onclick: () => { o.onImport(); } },
        { label: 'Exporter le projet actuel', keep: true, onclick: () => { o.onExport(); } },
        { label: 'Fermer' },
      ],
    });
    load();
    return modal;
  };
})();
