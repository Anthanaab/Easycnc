export interface Point {
  x: number
  y: number
}

export type Operation = 'none' | 'contour_out' | 'contour_in' | 'on' | 'pocket' | 'vcarve' | 'laser_contour' | 'laser_fill'

export type ShapeKind = 'rect' | 'circle' | 'polygon' | 'star' | 'path' | 'text' | 'testgrid'

export interface Shape {
  id: string
  kind: ShapeKind
  name: string
  x: number
  y: number
  rotation: number
  width: number
  height: number
  radius: number
  sides: number
  points: number
  innerRatio: number
  op: Operation
  depth: number
  enabled: boolean
  bitId?: string
  loops?: Point[][]
  text?: string
  font?: string
  fontSize?: number
  cols?: number
  rows?: number
  cell?: number
  gap?: number
}

export interface Bounds {
  min: Point
  max: Point
}

export interface TabsSettings {
  enabled: boolean
  width: number
  height: number
  spacing: number
}

export interface SurfacingSettings {
  enabled: boolean
  depth: number
  stepover: number
  margin: number
}

export interface LaserSettings {
  power: number
  fillStepover: number
  passes: number
  mode: 'M3' | 'M4'
  framingPower: number
  overscan: number
  imageMode: 'grayscale' | 'threshold' | 'dither'
  threshold: number
  focusZ: number
  spotWidth: number
}

export interface StockSettings {
  enabled: boolean
  width: number
  height: number
  thickness: number
  x: number
  y: number
}

export interface CamOptions {
  entry: 'plunge' | 'ramp'
  reverse: boolean
  optimize: boolean
  units: 'mm' | 'in'
  arcs: boolean
  toolChangeEnabled: boolean
  toolChangeX: number
  toolChangeY: number
  reprobe: boolean
}

export interface LaserPreset {
  id: string
  name: string
  material: string
  kind: 'engrave' | 'cut'
  power: number
  feed: number
  passes: number
  laserMode: 'M3' | 'M4'
  overscan: number
  focusZ: number
  spotWidth: number
  builtin: boolean
}

export const OPERATIONS: Array<{ id: Operation; label: string }> = [
  { id: 'none', label: 'Aucune (repère)' },
  { id: 'contour_out', label: 'Contour extérieur' },
  { id: 'contour_in', label: 'Contour intérieur' },
  { id: 'on', label: 'Sur le tracé (gravure)' },
  { id: 'pocket', label: 'Poche' },
  { id: 'vcarve', label: 'V-carve (fraise V)' },
  { id: 'laser_contour', label: 'Laser : contour' },
  { id: 'laser_fill', label: 'Laser : remplissage' },
]

export function createShape(kind: ShapeKind, index: number): Shape {
  const base: Shape = {
    id: `s${Date.now()}${Math.round(Math.random() * 1000)}`,
    kind,
    name: `${labelOf(kind)} ${index}`,
    // Centre de la forme : assez loin de l'origine pour que le contour
    // exterieur (rayon de fraise compris) reste sur le plateau.
    x: 40,
    y: 35,
    rotation: 0,
    width: 40,
    height: 30,
    radius: 15,
    sides: 6,
    points: 5,
    innerRatio: 0.45,
    op: 'contour_out',
    depth: 3,
    enabled: true,
  }
  if (kind === 'text') {
    base.text = 'Texte'
    base.font = 'roboto700'
    base.fontSize = 20
    base.loops = []
  }
  if (kind === 'path') {
    base.loops = []
  }
  if (kind === 'testgrid') {
    base.cols = 5
    base.rows = 2
    base.cell = 8
    base.gap = 2
    base.x = 30
    base.y = 22
    base.op = 'none'
    base.name = `Grille de test ${index}`
  }
  return base
}

function labelOf(kind: ShapeKind): string {
  switch (kind) {
    case 'rect':
      return 'Rectangle'
    case 'circle':
      return 'Cercle'
    case 'polygon':
      return 'Polygone'
    case 'star':
      return 'Étoile'
    case 'path':
      return 'Tracé'
    case 'text':
      return 'Texte'
    case 'testgrid':
      return 'Grille de test'
    default:
      return 'Forme'
  }
}
