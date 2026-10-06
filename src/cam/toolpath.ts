import type { CutParams } from '../data/params'
import { boundsOfPoints, mergeBounds, shapeLoops } from './geometry'
import { normalizeLoops, offsetLoops } from './offset'
import type { Bounds, Point, Shape, SurfacingSettings, TabsSettings } from './types'

export interface CutPoint extends Point {
  z?: number
  s?: number
}

export interface CutPath {
  points: CutPoint[]
  closed: boolean
  z: number
  power?: number
  toolId?: string
}

export interface CamResult {
  paths: CutPath[]
  warnings: string[]
  bounds: Bounds | null
  moveCount: number
  cutLength: number
}

export interface LaserOptions {
  power: number
  fillStepover: number
  passes: number
  spotWidth?: number
}

export interface GenOptions {
  angle?: number
  docMax?: number
  tabs?: TabsSettings
  surfacing?: SurfacingSettings
  laser?: LaserOptions
  entry?: 'plunge' | 'ramp'
  reverse?: boolean
  optimize?: boolean
  resolveTool?: (shape: Shape) => { id?: string; diameter: number; angle?: number; docMax?: number }
}

export function zLevels(depth: number, doc: number): number[] {
  const passes = Math.max(1, Math.ceil(depth / Math.max(doc, 0.01)))
  const levels: number[] = []
  for (let i = 1; i <= passes; i++) levels.push(-Math.min(depth, i * doc))
  return levels
}

export function generateToolpath(
  shapes: Shape[],
  params: CutParams,
  toolDiameter: number,
  options: GenOptions = {},
): CamResult {
  const baseDiameter = toolDiameter
  const paths: CutPath[] = []
  const warnings: string[] = []
  let bounds: Bounds | null = null
  let allBounds: Bounds | null = null

  for (const shape of shapes) {
    if (!shape.enabled) continue
    const loops = shapeLoops(shape)
    for (const loop of loops) allBounds = mergeBounds(allBounds, boundsOfPoints(loop))
    if (shape.op === 'none' || !loops.length) continue

    const tool = options.resolveTool
      ? options.resolveTool(shape)
      : { diameter: baseDiameter, angle: options.angle, docMax: options.docMax }
    const radius = Math.max(tool.diameter, 0.1) / 2
    const startIdx = paths.length
    const tag = () => {
      if (!tool.id) return
      for (let i = startIdx; i < paths.length; i++) paths[i].toolId = tool.id
    }

    const isLaser = shape.op === 'laser_contour' || shape.op === 'laser_fill'
    if (isLaser) {
      laserShape(shape, loops, options, paths)
      tag()
      continue
    }
    if (shape.depth <= 0) continue

    if (shape.op === 'vcarve') {
      vcarveShape(shape, loops, params, { ...options, angle: tool.angle, docMax: tool.docMax }, paths, warnings)
      tag()
      continue
    }

    const tabZ = options.tabs?.enabled ? -shape.depth + options.tabs.height : null

    const addClosed = (loop: Point[], z: number): void => {
      const oriented = options.reverse ? [...loop].reverse() : loop
      if (tabZ !== null) {
        paths.push(applyTabs(oriented, z, tabZ, options.tabs))
      } else if (options.entry === 'ramp' && oriented.length > 1) {
        paths.push(rampPath(oriented, z, Math.max(radius * 2, 1)))
      } else {
        paths.push({ points: oriented, closed: true, z })
      }
    }

    for (const z of zLevels(shape.depth, params.doc)) {
      if (shape.op === 'on') {
        for (const loop of loops) addClosed(loop, z)
        continue
      }
      if (shape.op === 'contour_out') {
        for (const loop of offsetLoops(loops, radius)) addClosed(loop, z)
        continue
      }
      if (shape.op === 'contour_in') {
        const inner = offsetLoops(loops, -radius)
        if (!inner.length) warnings.push(`${shape.name} : trop petit pour un contour intérieur à cette fraise.`)
        for (const loop of inner) addClosed(loop, z)
        continue
      }
      if (shape.op === 'pocket') {
        let ring = offsetLoops(loops, -radius)
        let pass = 0
        while (ring.length && pass < 500) {
          for (const loop of ring) addClosed(loop, z)
          pass++
          ring = offsetLoops(loops, -(radius + pass * params.stepover))
        }
        if (pass >= 500) warnings.push(`${shape.name} : poche tronquée (trop de passes).`)
      }
    }
    tag()
  }

  if (options.surfacing?.enabled && allBounds) {
    for (const path of surfacingPaths(allBounds, options.surfacing)) paths.push(path)
  }

  if (options.optimize && paths.length > 1) {
    // Optimise par outil pour ne pas melanger les groupes d'outils.
    const order: string[] = []
    const groups = new Map<string, CutPath[]>()
    for (const path of paths) {
      const key = path.toolId ?? ''
      if (!groups.has(key)) {
        groups.set(key, [])
        order.push(key)
      }
      groups.get(key)!.push(path)
    }
    const ordered: CutPath[] = []
    for (const key of order) ordered.push(...optimizePaths(groups.get(key)!))
    paths.length = 0
    paths.push(...ordered)
  }

  let moveCount = 0
  let cutLength = 0
  for (const path of paths) {
    moveCount += path.points.length
    bounds = mergeBounds(bounds, boundsOfPoints(path.points))
    for (let i = 1; i < path.points.length; i++) {
      cutLength += dist(path.points[i - 1], path.points[i])
    }
    if (path.closed && path.points.length > 1) {
      cutLength += dist(path.points[path.points.length - 1], path.points[0])
    }
  }

  return { paths, warnings, bounds, moveCount, cutLength }
}

function laserShape(shape: Shape, loops: Point[][], options: GenOptions, paths: CutPath[]): void {
  const power = options.laser?.power ?? 1000
  const passes = Math.max(1, Math.round(options.laser?.passes ?? 1))
  const spot = Math.max(0, options.laser?.spotWidth ?? 0)
  if (shape.op === 'laser_contour') {
    const contour = spot > 0 ? offsetLoops(loops, spot / 2) : loops
    for (let p = 0; p < passes; p++) {
      for (const loop of contour) paths.push({ points: loop, closed: true, z: 0, power })
    }
    return
  }
  const norm = normalizeLoops(loops)
  const step = Math.max(options.laser?.fillStepover ?? 1, 0.1)
  let k = 0
  while (k < 2000) {
    const ring = offsetLoops(norm, -k * step)
    if (!ring.length) break
    for (const loop of ring) paths.push({ points: loop, closed: true, z: 0, power })
    k++
  }
}

function vcarveShape(
  shape: Shape,
  loops: Point[][],
  params: CutParams,
  options: GenOptions,
  paths: CutPath[],
  warnings: string[],
): void {
  const angle = options.angle && options.angle > 0 ? options.angle : 90
  const tanHalf = Math.tan((angle / 2) * (Math.PI / 180)) || 1
  const cap = Math.min(shape.depth > 0 ? shape.depth : Infinity, options.docMax ?? Infinity)
  if (!Number.isFinite(cap) || cap <= 0) {
    warnings.push(`${shape.name} : V-carve nécessite une profondeur max (docMax de la fraise V).`)
    return
  }
  const norm = normalizeLoops(loops)
  if (!norm.length) return
  const step = Math.max(params.stepover, 0.2)
  let k = 0
  let reachedCap = false
  while (k < 1000) {
    const dist = k * step + step * 0.5
    const ring = offsetLoops(norm, -dist)
    if (!ring.length) break
    const depth = Math.min(cap, dist / tanHalf)
    for (const loop of ring) paths.push({ points: loop, closed: true, z: -depth })
    k++
    if (depth >= cap - 1e-6) {
      reachedCap = true
      break
    }
  }
  if (reachedCap) {
    let dist = k * step + step * 0.5
    for (let g = 0; g < 1000; g++) {
      const ring = offsetLoops(norm, -dist)
      if (!ring.length) break
      for (const loop of ring) paths.push({ points: loop, closed: true, z: -cap })
      dist += step
    }
  }
}

function rampPath(loop: Point[], z: number, length: number): CutPath {
  const p0 = loop[0]
  const p1 = loop[1] ?? loop[loop.length - 1]
  const dx = p1.x - p0.x
  const dy = p1.y - p0.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const steps = 8
  const points: CutPoint[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    points.push({ x: p0.x - ux * length * (1 - t), y: p0.y - uy * length * (1 - t), z: z * t })
  }
  for (let i = 1; i < loop.length; i++) points.push({ ...loop[i], z })
  points.push({ x: p0.x, y: p0.y, z })
  return { points, closed: false, z }
}

function optimizePaths(paths: CutPath[]): CutPath[] {
  const remaining = [...paths]
  const ordered: CutPath[] = []
  let cx = 0
  let cy = 0
  while (remaining.length) {
    let bestIndex = -1
    let bestDist = Infinity
    let reverse = false
    for (let i = 0; i < remaining.length; i++) {
      const path = remaining[i]
      if (!path.points.length) continue
      const start = path.points[0]
      const end = path.points[path.points.length - 1]
      const d1 = Math.hypot(start.x - cx, start.y - cy)
      if (d1 < bestDist) {
        bestDist = d1
        bestIndex = i
        reverse = false
      }
      if (!path.closed) {
        const d2 = Math.hypot(end.x - cx, end.y - cy)
        if (d2 < bestDist) {
          bestDist = d2
          bestIndex = i
          reverse = true
        }
      }
    }
    if (bestIndex < 0) break
    let path = remaining.splice(bestIndex, 1)[0]
    if (reverse) path = { ...path, points: [...path.points].reverse() }
    ordered.push(path)
    const last = path.points[path.points.length - 1]
    cx = last.x
    cy = last.y
  }
  return ordered
}

export function applyTabs(
  loop: Point[],
  z: number,
  tabZ: number | null | undefined,
  tabs: TabsSettings | undefined,
): CutPath {
  if (tabZ === null || tabZ === undefined || !tabs || tabZ >= z + 1e-6 || loop.length < 2) {
    return { points: loop, closed: true, z }
  }
  const result = resampleClosed(loop, Math.max(0.3, Math.min(1, tabs.width / 2)))
  const total = result.total
  if (total <= 0) return { points: loop, closed: true, z }
  const count = Math.max(1, Math.round(total / Math.max(tabs.spacing, 1)))
  const halfWidth = Math.max(0.5, tabs.width / 2)
  const points: CutPoint[] = result.points.map((point) => {
    const nearest = nearestTabDistance(point.s, total, count)
    return nearest <= halfWidth ? { x: point.x, y: point.y, z: tabZ } : { x: point.x, y: point.y }
  })
  return { points, closed: true, z }
}

function nearestTabDistance(s: number, total: number, count: number): number {
  const spacing = total / count
  const offsetFromCenter = ((s + spacing / 2) % spacing) - spacing / 2
  return Math.abs(offsetFromCenter)
}

function resampleClosed(loop: Point[], step: number): { points: Array<Point & { s: number }>; total: number } {
  const pts: Array<Point & { s: number }> = []
  const n = loop.length
  let s = 0
  for (let i = 0; i < n; i++) {
    const a = loop[i]
    const b = loop[(i + 1) % n]
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    const segments = Math.max(1, Math.ceil(length / step))
    for (let j = 0; j < segments; j++) {
      const t = j / segments
      pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, s })
      s += length / segments
    }
  }
  return { points: pts, total: s }
}

function surfacingPaths(bounds: Bounds, surfacing: SurfacingSettings): CutPath[] {
  const min = { x: bounds.min.x - surfacing.margin, y: bounds.min.y - surfacing.margin }
  const max = { x: bounds.max.x + surfacing.margin, y: bounds.max.y + surfacing.margin }
  const step = Math.max(surfacing.stepover, 0.5)
  const paths: CutPath[] = []
  let direction = 1
  for (let y = min.y; y <= max.y + 1e-6; y += step) {
    const points: CutPoint[] =
      direction > 0
        ? [
            { x: min.x, y },
            { x: max.x, y },
          ]
        : [
            { x: max.x, y },
            { x: min.x, y },
          ]
    paths.push({ points, closed: false, z: -Math.abs(surfacing.depth) })
    direction = -direction
  }
  return paths
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
