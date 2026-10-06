import type { Bit, BitGeom, BitType } from './types'

interface FlatExtra {
  geom?: BitGeom
  label?: string
  labelEn?: string
}

function flat(diameter: number, flutes: number, cutLength: number, shank: number, extra: FlatExtra = {}): Bit {
  const dotted = String(diameter).replace('.', '')
  const fr = `Droite ${String(diameter).replace('.', ',')} mm - ${flutes} dent${flutes > 1 ? 's' : ''}${extra.label ? ' ' + extra.label : ''}`
  const en = `Flat ${diameter} mm - ${flutes} flute${flutes > 1 ? 's' : ''}${extra.labelEn ? ' ' + extra.labelEn : ''}`
  return {
    id: `flat${flutes}${extra.geom ? extra.geom[0] : ''}-${dotted}`,
    name: fr,
    nameEn: en,
    type: 'flat',
    diameter,
    flutes,
    cutLength,
    shank,
    geom: extra.geom ?? 'straight',
    builtin: true,
  }
}

function ball(diameter: number, cutLength: number, shank: number): Bit {
  return {
    id: `ball2-${String(diameter).replace('.', '')}`,
    name: `Sphérique ${String(diameter).replace('.', ',')} mm - 2 dents`,
    nameEn: `Ball nose ${diameter} mm - 2 flutes`,
    type: 'ball',
    diameter,
    flutes: 2,
    cutLength,
    shank,
    builtin: true,
  }
}

function vbit(angle: number, tip: number, refDia: number, docMax: number, id?: string): Bit {
  return {
    id: id ?? `v${angle}`,
    name: `Gravure V ${angle}° (pointe ${String(tip).replace('.', ',')} mm)`,
    nameEn: `V-bit ${angle}° (tip ${tip} mm)`,
    type: 'vbit',
    angle,
    diameter: tip,
    refDia,
    docMax,
    flutes: 1,
    cutLength: 6,
    shank: 3.175,
    builtin: true,
  }
}

export const BITS: Bit[] = [
  flat(0.8, 2, 3, 3.175),
  flat(1, 2, 4, 3.175),
  flat(1.5, 2, 6, 3.175),
  flat(2, 2, 8, 3.175),
  flat(2.5, 2, 10, 3.175),
  { ...flat(3.175, 2, 12, 3.175), name: 'Droite 3,175 mm (1/8") - 2 dents', nameEn: 'Flat 3.175 mm (1/8") - 2 flutes' },
  flat(4, 2, 15, 4),
  flat(6, 2, 22, 6),
  flat(2, 1, 8, 3.175, { label: '(plastique/alu)', labelEn: '(plastic/aluminium)' }),
  { ...flat(3.175, 1, 12, 3.175), name: 'Droite 3,175 mm - 1 dent (plastique/alu)', nameEn: 'Flat 3.175 mm - 1 flute (plastic/aluminium)' },
  flat(4, 1, 15, 4, { label: '(plastique/alu)', labelEn: '(plastic/aluminium)' }),
  flat(3.175, 3, 12, 3.175),
  { ...flat(3.175, 4, 12, 3.175), name: 'Droite 3,175 mm - 4 dents (bois dur)', nameEn: 'Flat 3.175 mm - 4 flutes (hardwood)' },
  flat(6, 4, 22, 6, { label: '(bois dur/alu)', labelEn: '(hardwood/aluminium)' }),
  flat(3.175, 2, 12, 3.175, { geom: 'down', label: 'hélice descendante', labelEn: 'down-cut' }),
  flat(2, 2, 8, 3.175, { geom: 'down', label: 'hélice descendante', labelEn: 'down-cut' }),
  flat(3.175, 2, 12, 3.175, { geom: 'compression', label: 'compression', labelEn: 'compression' }),
  flat(6, 2, 22, 6, { geom: 'compression', label: 'compression', labelEn: 'compression' }),
  {
    id: 'surf3-12',
    name: 'Surfaçage Ø 12 mm - 3 dents (queue 6)',
    nameEn: 'Facing Ø 12 mm - 3 flutes (shank 6)',
    type: 'flat',
    diameter: 12,
    flutes: 3,
    cutLength: 5,
    shank: 6,
    geom: 'surface',
    builtin: true,
  },
  ball(1, 4, 3.175),
  ball(1.5, 6, 3.175),
  ball(2, 8, 3.175),
  ball(3.175, 12, 3.175),
  ball(4, 15, 4),
  ball(6, 22, 6),
  vbit(15, 0.1, 1.0, 0.3),
  vbit(20, 0.1, 1.2, 0.3, 'v20'),
  vbit(30, 0.1, 1.5, 0.4, 'v30-01'),
  vbit(30, 0.2, 1.5, 0.4),
  vbit(45, 0.2, 1.8, 0.5),
  vbit(60, 0.2, 2.0, 0.5),
  vbit(90, 0.2, 3.0, 0.6),
  { ...vbit(90, 0.5, 3.0, 0.8, 'v90c'), name: 'Chanfreinage V 90° (pointe 0,5 mm)', nameEn: 'Chamfer V 90° (tip 0.5 mm)' },
  ...[0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.5, 2.0].map<Bit>((d) => ({
    id: 'drill-' + String(d).replace('.', ''),
    name: 'Foret PCB Ø ' + String(d).replace('.', ',') + ' mm',
    nameEn: 'PCB drill Ø ' + d + ' mm',
    type: 'drill' as BitType,
    diameter: d,
    flutes: 2,
    cutLength: 8,
    shank: 3.175,
    builtin: true,
  })),
]

export function findBit(id: string, custom: Bit[] = []): Bit {
  return [...BITS, ...custom].find((b) => b.id === id) ?? BITS[0]
}
