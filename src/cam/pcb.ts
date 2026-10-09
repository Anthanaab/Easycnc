import type { Hole } from './gerber'
import { differenceLoops, offsetLoops, unionLoops } from './offset'
import { applyTabs, zLevels, type CutPath } from './toolpath'
import type { Bounds, Point, TabsSettings } from './types'

export interface IsolationOptions {
  toolRadius: number
  gap: number
  passes: number
  stepover: number
  depth: number
}

export interface LevelMap {
  x0: number
  y0: number
  dx: number
  dy: number
  cols: number
  rows: number
  heights: number[]
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

export function outlinePaths(outline: Point[][], depth: number, tabs: TabsSettings, doc?: number): CutPath[] {
  const paths: CutPath[] = []
  if (!outline.length) return paths
  const finalZ = -Math.abs(depth)
  const tabZ = tabs.enabled ? finalZ + tabs.height : null
  // Detourage en plusieurs passes (profondeur de passe doc) plutot qu'en une seule.
  const levels = doc && doc > 0 ? zLevels(Math.abs(depth), doc) : [finalZ]
  for (const loop of outline) {
    for (const z of levels) paths.push(applyTabs(loop, z, tabZ, tabs))
  }
  return paths
}

export function levelAt(level: LevelMap, x: number, y: number): number {
  if (level.cols < 2 || level.rows < 2) return level.heights[0] ?? 0
  const fx = Math.min(Math.max((x - level.x0) / level.dx, 0), level.cols - 1.001)
  const fy = Math.min(Math.max((y - level.y0) / level.dy, 0), level.rows - 1.001)
  const ix = Math.floor(fx)
  const iy = Math.floor(fy)
  const tx = fx - ix
  const ty = fy - iy
  const h00 = level.heights[iy * level.cols + ix]
  const h10 = level.heights[iy * level.cols + ix + 1]
  const h01 = level.heights[(iy + 1) * level.cols + ix]
  const h11 = level.heights[(iy + 1) * level.cols + ix + 1]
  return h00 * (1 - tx) * (1 - ty) + h10 * tx * (1 - ty) + h01 * (1 - tx) * ty + h11 * tx * ty
}

/** Applique la carte des hauteurs en Z par point (nivellement automatique). */
export function applyLeveling(paths: CutPath[], level: LevelMap): void {
  for (const path of paths) {
    for (const point of path.points) {
      point.z = path.z + levelAt(level, point.x, point.y)
    }
  }
}

export function makeLevelMap(bounds: Bounds, cols: number, rows: number, heights: number[]): LevelMap {
  return {
    x0: bounds.min.x,
    y0: bounds.min.y,
    dx: (bounds.max.x - bounds.min.x) / Math.max(1, cols - 1),
    dy: (bounds.max.y - bounds.min.y) / Math.max(1, rows - 1),
    cols,
    rows,
    heights,
  }
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
