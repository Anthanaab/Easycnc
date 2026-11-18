import type { Hole } from './gerber'
import { differenceLoops, offsetLoops, unionLoops } from './offset'
import { applyTabs, zLevels, type CutPath } from './toolpath'
export { applyLeveling, levelAt, levelPaths, makeLevelMap, type LevelMap } from './leveling'
import type { Bounds, Point, TabsSettings } from './types'

export interface IsolationOptions {
  toolRadius: number
  gap: number
  passes: number
  stepover: number
  depth: number
}


export function mirrorX(paths: Point[][], bounds: Bounds): Point[][] {
  return paths.map((loop) => loop.map((p) => ({ x: bounds.min.x + bounds.max.x - p.x, y: p.y })))
}

export function translatePaths(paths: Point[][], dx: number, dy: number): Point[][] {
  return paths.map((loop) => loop.map((p) => ({ x: p.x + dx, y: p.y + dy })))
}

export function combineCopper(layers: Point[][][]): Point[][] {
  return layers.reduce<Point[][]>((acc, layer) => unionLoops(acc, layer), [])
}

export function isolationPaths(copper: Point[][], options: IsolationOptions): CutPath[] {
  const paths: CutPath[] = []
  if (!copper.length) return paths
  const passes = Math.max(1, Math.round(options.passes))
  for (let k = 0; k < passes; k++) {
    const dist = options.toolRadius + options.gap + k * options.stepover
    const rings = offsetLoops(copper, dist)
    for (const loop of rings) paths.push({ points: loop, closed: true, z: -Math.abs(options.depth) })
  }
  return paths
}

export function drillPaths(holes: Hole[], depth: number, slots: boolean): CutPath[] {
  const paths: CutPath[] = []
  const z = -Math.abs(depth)
  for (const hole of holes) {
    paths.push({ points: [{ x: hole.x, y: hole.y }], closed: false, z })
  }
  void slots
  return paths
}

function insidePolygon(point: Point, loop: Point[]): boolean {
  let inside = false
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i]
    const b = loop[j]
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/**
 * Surface de la carte a partir du calque contour. Le Gerber decrit le contour
 * comme un TRAIT : on obtient un anneau (bord exterieur + bord interieur).
 * Niveaux d'imbrication : 0 = exterieur du trait, 1 = bord de carte,
 * 2 = bord d'une decoupe interne, 3 = interieur du trait de decoupe...
 * Carte = niveaux 1 moins niveaux 2. Contour ouvert (pas de niveau 1) :
 * on prend l'exterieur du trait.
 */
export function boardRegion(outline: Point[][]): Point[][] {
  const loops = outline.filter((loop) => loop.length >= 3)
  if (!loops.length) return []
  const depthOf = loops.map((loop, i) => loops.reduce((n, other, j) => (j !== i && insidePolygon(loop[0], other) ? n + 1 : n), 0))
  const pick = (level: number) => loops.filter((_, i) => depthOf[i] === level)
  const edges = pick(1)
  if (!edges.length) return unionLoops([], pick(0))
  const cutouts = pick(2)
  return differenceLoops(unionLoops([], edges), cutouts)
}

/**
 * Detourage : l'outil roule a l'exterieur de la carte (et a l'interieur des
 * decoupes), decale du rayon de fraise, en plusieurs passes.
 */
export function outlinePaths(board: Point[][], depth: number, tabs: TabsSettings, doc?: number, toolRadius = 0): CutPath[] {
  const paths: CutPath[] = []
  if (!board.length) return paths
  const finalZ = -Math.abs(depth)
  const tabZ = tabs.enabled ? finalZ + tabs.height : null
  // Detourage en plusieurs passes (profondeur de passe doc) plutot qu'en une seule.
  const levels = doc && doc > 0 ? zLevels(Math.abs(depth), doc) : [finalZ]
  const loops = toolRadius > 0 ? offsetLoops(board, toolRadius) : board
  for (const loop of loops) {
    for (const z of levels) paths.push(applyTabs(loop, z, tabZ, tabs))
  }
  return paths
}




export interface ClearingOptions {
  toolRadius: number
  clearance: number
  stepover: number
  depth: number
}

/** Dégagement du cuivre résiduel : poche la zone entre le bord et le cuivre. */
export function clearingPaths(region: Point[][], copper: Point[][], options: ClearingOptions): CutPath[] {
  const paths: CutPath[] = []
  if (!region.length || !copper.length) return paths
  const keepout = offsetLoops(copper, options.clearance)
  const residual = differenceLoops(region, keepout)
  if (!residual.length) return paths
  const z = -Math.abs(options.depth)
  let ring = offsetLoops(residual, -options.toolRadius)
  let pass = 0
  while (ring.length && pass < 2000) {
    for (const loop of ring) paths.push({ points: loop, closed: true, z })
    pass++
    ring = offsetLoops(residual, -(options.toolRadius + pass * options.stepover))
  }
  return paths
}
