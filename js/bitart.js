// Schémas explicatifs des fraises (vue de côté + vue de dessous) et conseils d'usage pour débutants.
(function () {
  const CNC = window.CNC;

  const INFO = {
    flat: {
      title: 'Fraise droite',
      use: 'Fond plat, coupe sur les côtés et en bout. La fraise « à tout faire » : découpe de contours, poches, rainures.',
    },
    ball: {
      title: 'Fraise sphérique',
      use: 'Bout arrondi. Laisse des fonds et des bords arrondis : gravure en relief, sculpture 3D, finition de surfaces courbes.',
    },
    vbit: {
      title: 'Fraise de gravure en V',
      use: 'Pointe très fine. Gravure de lettres, logos et détails, chanfreins. Peu profond : quelques dixièmes de mm par passe.',
    },
  };
  const FLUTES = {
    1: '1 dent : évacue très bien les copeaux, idéale pour plastiques et aluminium.',
    2: '2 dents : le meilleur compromis pour le bois, le MDF et les plastiques.',
    3: '3 dents : bon état de surface, pour bois durs et plastiques.',
    4: '4 dents : finition soignée sur bois dur ; évacue moins bien les copeaux, passes plus légères.',
  };

  CNC.bitInfo = (b) => {
    const i = INFO[b.type] || INFO.flat;
    const parts = [i.use, FLUTES[Math.min(4, Math.max(1, Math.round(b.flutes)))] || ''];
    if (b.type !== 'vbit') parts.push('Plus le diamètre est petit, plus le détail est fin, mais plus la fraise est fragile : passes légères.');
    return { title: i.title, text: parts.filter(Boolean) };
  };

  CNC.bitSvg = (b) => {
    const n = Math.min(4, Math.max(1, Math.round(b.flutes) || 2));
    const gold = '#d4a72c', steel = '#98a2b3', ink = 'currentColor';
    const f = (v) => String(Math.round(v * 10) / 10);
    // vue de côté
    let cutter;
    if (b.type === 'vbit') {
      cutter = `<polygon points="41,55 59,55 51.5,122 48.5,122" fill="${gold}" stroke="${ink}" stroke-width="1"/>`;
    } else if (b.type === 'ball') {
      cutter = `<path d="M41 55 H59 V113 A9 9 0 0 1 41 113 Z" fill="${gold}" stroke="${ink}" stroke-width="1"/>`;
    } else {
      cutter = `<rect x="41" y="55" width="18" height="67" fill="${gold}" stroke="${ink}" stroke-width="1"/>`;
    }
    // spirales des dents (schématiques)
    let helix = '';
    if (b.type !== 'vbit') {
      const bottom = b.type === 'ball' ? 110 : 120;
      for (let k = 0; k < n; k++) {
        for (let y = 58 + k * (14 / n); y < bottom; y += 14) {
          helix += `<line x1="41" y1="${f(y)}" x2="59" y2="${f(Math.min(y + 9, bottom))}" stroke="${ink}" stroke-width=".8" opacity=".55"/>`;
        }
      }
    }
    // vue de dessous : cercle divisé selon le nombre de dents
    const cx = 112, cy = 92, r = 17;
    let end = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${gold}" stroke="${ink}" stroke-width="1"/>`;
    if (b.type === 'vbit') end += `<circle cx="${cx}" cy="${cy}" r="3" fill="${steel}" stroke="${ink}" stroke-width=".8"/>`;
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + 0.5;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      end += `<line x1="${cx}" y1="${cy}" x2="${f(x)}" y2="${f(y)}" stroke="${ink}" stroke-width="1.6"/>`;
      // creux entre les dents
      const a2 = a + Math.PI / n;
      end += `<circle cx="${f(cx + Math.cos(a2) * r * 0.62)}" cy="${f(cy + Math.sin(a2) * r * 0.62)}" r="${f(r * 0.2)}" fill="var(--panel,#fff)" stroke="${ink}" stroke-width=".7"/>`;
    }
    const d = String(b.diameter).replace('.', ',');
    return `<svg viewBox="0 0 150 150" width="150" height="150" role="img" aria-label="${(CNC.bitInfo(b).title)}" style="color:var(--ink,#1e293b)">
      <rect x="42" y="6" width="16" height="49" fill="${steel}" stroke="${ink}" stroke-width="1"/>
      ${cutter}${helix}
      <text x="5" y="34" font-size="8.5" fill="${ink}">queue</text>
      <line x1="30" y1="32" x2="41" y2="32" stroke="${ink}" stroke-width=".8"/>
      <text x="8" y="94" font-size="8.5" fill="${ink}">coupe</text>
      <line x1="34" y1="92" x2="41" y2="92" stroke="${ink}" stroke-width=".8"/>
      <text x="${b.type === 'vbit' ? 30 : 33}" y="139" font-size="9" font-weight="600" fill="${ink}">${b.type === 'vbit' ? 'pointe Ø ' + d : 'Ø ' + d} mm</text>
      ${end}
      <text x="${cx - 20}" y="${cy + r + 14}" font-size="8" fill="${ink}">vue de dessous</text>
      <text x="${cx - 14}" y="${cy - r - 6}" font-size="8" fill="${ink}">${n} dent${n > 1 ? 's' : ''}</text>
    </svg>`;
  };

  // Carte « aide fraise » : schéma + explications
  CNC.bitCard = (b) => {
    const info = CNC.bitInfo(b);
    const box = CNC.el('div', { class: 'bitcard' },
      CNC.el('div', { class: 'bitart', html: CNC.bitSvg(b) }),
      CNC.el('div', {},
        CNC.el('b', {}, info.title),
        CNC.el('div', { class: 'muted' }, `Ø ${b.diameter} mm · ${b.flutes} dent${b.flutes > 1 ? 's' : ''}${b.cutLength ? ' · coupe ' + b.cutLength + ' mm' : ''}`),
        info.text.map((t) => CNC.el('p', {}, t))));
    return box;
  };
})();
