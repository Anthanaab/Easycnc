import type { CutPath, CutPoint } from './toolpath'
import type { Bounds } from './types'

/** Carte des ecarts de hauteur (mm) par rapport au Z0 de travail, sur une grille. */
export interface LevelMap {
  x0: number
  y0: number
  dx: number
  dy: number
  cols: number
  rows: number
  heights: number[]
}

export function levelAt(level: LevelMap, x: number, y: number): number {
  if (level.cols < 2 || level.rows < 2) return level.heights[0] ?? 0
  // Zone de largeur nulle (dx = 0) : premiere colonne / ligne.
  const fx = level.dx > 0 ? Math.min(Math.max((x - level.x0) / level.dx, 0), level.cols - 1.001) : 0
  const fy = level.dy > 0 ? Math.min(Math.max((y - level.y0) / level.dy, 0), level.rows - 1.001) : 0
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

/**
 * Applique la carte des hauteurs : chaque Z (y compris tenons, rampes) est
 * decale de l'ecart local. Les segments longs sont subdivises (`maxSegment`)
 * pour suivre le relief entre deux points. Le surfacage n'est pas nivele (il
 * sert justement a aplanir). Renvoie de nouveaux parcours.
 */
export function levelPaths(paths: CutPath[], level: LevelMap, maxSegment = 2): CutPath[] {
  return paths.map((path) => {
    if (path.surfacing) return path
    const src = path.closed && path.points.length > 1 ? [...path.points, path.points[0]] : path.points
    const out: CutPoint[] = []
    const z = (p: CutPoint) => p.z ?? path.z
    src.forEach((point, i) => {
      if (i > 0) {
        const prev = src[i - 1]
        const steps = Math.ceil(Math.hypot(point.x - prev.x, point.y - prev.y) / maxSegment)
        for (let k = 1; k < steps; k++) {
          const t = k / steps
          const x = prev.x + (point.x - prev.x) * t
          const y = prev.y + (point.y - prev.y) * t
          const base = z(prev) + (z(point) - z(prev)) * t
          out.push({ ...point, x, y, z: base + levelAt(level, x, y) })
        }
      }
      out.push({ ...point, z: z(point) + levelAt(level, point.x, point.y) })
    })
    // La boucle fermee est deja bouclee explicitement.
    if (path.closed && out.length > 1) out.pop()
    return { ...path, points: out }
  })
}

/** Ancienne API (PCB) : nivelle en place. */
export function applyLeveling(paths: CutPath[], level: LevelMap): void {
  const leveled = levelPaths(paths, level)
  leveled.forEach((path, i) => {
    paths[i].points = path.points
  })
}
