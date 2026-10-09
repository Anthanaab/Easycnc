import type { CamResult, CutPath } from './toolpath'
import type { Bounds, Point } from './types'

export interface Sample {
  x: number
  y: number
  z: number
  cut: boolean
  toolId?: string
}

export interface HeightMap {
  gx: number
  gy: number
  dx: number
  dy: number
  x0: number
  y0: number
  width: number
  height: number
  thickness: number
  heights: Float32Array
}

export interface StockBounds {
  min: Point
  max: Point
}

export function stockFromBounds(bounds: Bounds | null, margin: number, fallback = 100): StockBounds {
  if (!bounds) {
    return { min: { x: -fallback / 2, y: -fallback / 2 }, max: { x: fallback / 2, y: fallback / 2 } }
  }
  return {
    min: { x: bounds.min.x - margin, y: bounds.min.y - margin },
    max: { x: bounds.max.x + margin, y: bounds.max.y + margin },
  }
}

export function buildHeightMap(stock: StockBounds, thickness: number, resolution: number): HeightMap {
  const width = Math.max(1, stock.max.x - stock.min.x)
  const height = Math.max(1, stock.max.y - stock.min.y)
  const res = Math.max(0.2, resolution)
  const gx = Math.max(2, Math.min(400, Math.round(width / res) + 1))
  const gy = Math.max(2, Math.min(400, Math.round(height / res) + 1))
  const dx = width / (gx - 1)
  const dy = height / (gy - 1)
  return {
    gx,
    gy,
    dx,
    dy,
    x0: stock.min.x,
    y0: stock.min.y,
    width,
    height,
    thickness,
    heights: new Float32Array(gx * gy),
  }
}

/** Echantillons pour l'animation: montée, plongée, coupe, dégagement. */
export function buildSamples(result: CamResult, safeZ: number, step: number): Sample[] {
  const samples: Sample[] = []
  for (const path of result.paths) {
    addPathSamples(samples, path, safeZ, step)
  }
  return samples
}

function addPathSamples(samples: Sample[], path: CutPath, safeZ: number, step: number): void {
  const points = path.points
  if (!points.length) return
  const tid = path.toolId
  const zOf = (p: { z?: number }): number => p.z ?? path.z
  const first = points[0]
  samples.push({ x: first.x, y: first.y, z: safeZ, cut: false, toolId: tid })
  samples.push({ x: first.x, y: first.y, z: zOf(first), cut: true, toolId: tid })

  const sequence = path.closed && points.length > 1 ? [...points, first] : points
  for (let i = 1; i < sequence.length; i++) {
    const a = sequence[i - 1]
    const b = sequence[i]
    const az = zOf(a)
    const bz = zOf(b)
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    const n = Math.max(1, Math.ceil(length / Math.max(0.4, step)))
    for (let s = 1; s <= n; s++) {
      const t = s / n
      samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: az + (bz - az) * t, cut: true, toolId: tid })
    }
  }
  const last = points[points.length - 1]
  samples.push({ x: last.x, y: last.y, z: safeZ, cut: false, toolId: tid })
}

/** Abaisse les cellules de la heightmap sous l'outil. */
export function carve(map: HeightMap, x: number, y: number, z: number, radius: number): void {
  carveTool(map, x, y, z, { kind: 'flat', radius })
}

export type ToolKind = 'flat' | 'ball' | 'vbit'

export interface ToolShape {
  kind: ToolKind
  radius: number
  /** Tangente du demi-angle, pour les fraises V. */
  tanHalf?: number
}

/** Abaisse la heightmap selon la forme reelle de l'outil (cylindre, bille, cone). */
export function carveTool(map: HeightMap, x: number, y: number, z: number, tool: ToolShape): void {
  if (z >= 0) return
  const radius = Math.max(tool.radius, 0.02)
  const tanHalf = tool.tanHalf ?? 1
  // Fraise V : pointe plate de rayon `radius`, puis cone.
  const influence = tool.kind === 'vbit' ? radius - z * tanHalf : radius
  const ix0 = Math.max(0, Math.floor((x - influence - map.x0) / map.dx))
  const ix1 = Math.min(map.gx - 1, Math.ceil((x + influence - map.x0) / map.dx))
  const iy0 = Math.max(0, Math.floor((y - influence - map.y0) / map.dy))
  const iy1 = Math.min(map.gy - 1, Math.ceil((y + influence - map.y0) / map.dy))
  const infl2 = influence * influence

  for (let iy = iy0; iy <= iy1; iy++) {
    const cy = map.y0 + iy * map.dy
    const dy = cy - y
    for (let ix = ix0; ix <= ix1; ix++) {
      const cx = map.x0 + ix * map.dx
      const dx = cx - x
      const d2 = dx * dx + dy * dy
      if (d2 > infl2) continue
      const d = Math.sqrt(d2)
      let surface: number
      if (tool.kind === 'ball') {
        if (d > radius) continue
        surface = z + radius - Math.sqrt(Math.max(0, radius * radius - d * d))
      } else if (tool.kind === 'vbit') {
        surface = d <= radius ? z : z + (d - radius) / tanHalf
      } else {
        if (d > radius) continue
        surface = z
      }
      const idx = iy * map.gx + ix
      if (surface < map.heights[idx]) map.heights[idx] = surface
    }
  }
}

export function simulateAll(result: CamResult, map: HeightMap, radius: number): void {
  for (const path of result.paths) {
    const points = path.points
    const zOf = (p: { z?: number }): number => p.z ?? path.z
    const sequence = path.closed && points.length > 1 ? [...points, points[0]] : points
    for (let i = 0; i < sequence.length; i++) {
      const p = sequence[i]
      carve(map, p.x, p.y, zOf(p), radius)
      if (i > 0) {
        const a = sequence[i - 1]
        const b = p
        const length = Math.hypot(b.x - a.x, b.y - a.y)
        const n = Math.max(1, Math.ceil(length / 0.6))
        for (let s = 1; s < n; s++) {
          const t = s / n
          carve(map, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, zOf(a) + (zOf(b) - zOf(a)) * t, radius)
        }
      }
    }
  }
}
