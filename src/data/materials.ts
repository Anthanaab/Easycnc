import type { Material } from './types'

export const MATERIALS: Material[] = [
  { id: 'pine', name: 'Pin / bois tendre', nameEn: 'Pine / softwood', color: '#e3c99a', chip: 0.01, doc: 0.35, stepover: 0.45, rpm: 10000, plunge: 0.4 },
  { id: 'plywood', name: 'Contreplaqué', nameEn: 'Plywood', color: '#d8b98a', chip: 0.009, doc: 0.3, stepover: 0.42, rpm: 10000, plunge: 0.4 },
  { id: 'mdf', name: 'MDF', nameEn: 'MDF', color: '#bfa27a', chip: 0.01, doc: 0.35, stepover: 0.45, rpm: 10000, plunge: 0.4 },
  { id: 'hardwood', name: 'Bois dur (chêne, hêtre…)', nameEn: 'Hardwood (oak, beech…)', color: '#b68a5b', chip: 0.006, doc: 0.25, stepover: 0.35, rpm: 10000, plunge: 0.35 },
  { id: 'acrylic', name: 'Acrylique (PMMA)', nameEn: 'Acrylic (PMMA)', color: '#bfe3f2', chip: 0.008, doc: 0.3, stepover: 0.4, rpm: 8000, plunge: 0.35 },
  { id: 'abs', name: 'ABS / PVC / HDPE', nameEn: 'ABS / PVC / HDPE', color: '#d9d9d9', chip: 0.009, doc: 0.3, stepover: 0.4, rpm: 8000, plunge: 0.35 },
  { id: 'foam', name: 'Mousse / XPS', nameEn: 'Foam / XPS', color: '#cfe6ff', chip: 0.02, doc: 1.0, stepover: 0.6, rpm: 8000, plunge: 0.6 },
  { id: 'alu', name: 'Aluminium (avec prudence)', nameEn: 'Aluminium (careful)', color: '#b9c0c9', chip: 0.003, doc: 0.08, stepover: 0.25, rpm: 10000, plunge: 0.3 },
  { id: 'pcb', name: 'Cuivre / circuit imprimé', nameEn: 'Copper / PCB', color: '#c7833a', chip: 0.004, doc: 0.1, stepover: 0.3, rpm: 10000, plunge: 0.3 },
]

export function findMaterial(id: string): Material {
  return MATERIALS.find((m) => m.id === id) ?? MATERIALS[0]
}
