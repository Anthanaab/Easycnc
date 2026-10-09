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
  resolveTool?: (shape: Shape) => { id?: string; diameter: number; angle?: number; docMax?: number; cutLength?: number }
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export function zLevels(depth: number, doc: number): number[] {
  if (!(depth > 0)) return []
  doc = positive(doc, depth)
  const passes = Math.max(1, Math.ceil(depth / Math.max(doc, 0.01) - 1e-9))
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
  const surfacing: CutPath[] = []
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
    const radius = Math.max(positive(tool.diameter, 0.1), 0.1) / 2
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
    if (!(shape.depth > 0)) continue
    if (tool.cutLength && shape.depth > tool.cutLength + 1e-6) {
      warnings.push(`${shape.name} : profondeur ${shape.depth} mm > longueur de coupe de la fraise (${tool.cutLength} mm).`)
    }

    if (shape.op === 'vcarve') {
      vcarveShape(shape, loops, params, { ...options, angle: tool.angle, docMax: tool.docMax }, paths, warnings)
      tag()
      continue
    }

    // Tenons : uniquement pour les contours (detourage), jamais dans une poche.
    const isProfile = shape.op === 'contour_out' || shape.op === 'contour_in'
    const tabZ = options.tabs?.enabled && isProfile ? -shape.depth + options.tabs.height : null
    const stepover = Math.min(positive(params.stepover, radius), radius * 2 * 0.95)
    if (shape.op === 'pocket' && params.stepover > radius * 2 * 0.95) {
      warnings.push(`${shape.name} : recouvrement > diamètre de fraise, limité à ${stepover.toFixed(2)} mm.`)
    }
    // Offsets sur des boucles normalisees (trous correctement orientes, ex. lettre « O »).
    const solid = shape.op === 'on' ? loops : normalizeLoops(loops)

    const addClosed = (loop: Point[], z: number, zPrev: number): void => {
      const oriented = options.reverse ? [...loop].reverse() : loop
      if (tabZ !== null && tabZ > z + 1e-6) {
        paths.push(applyTabs(oriented, z, tabZ, options.tabs))
      } else if (options.entry === 'ramp' && oriented.length > 1) {
        paths.push(rampPath(oriented, zPrev, z, Math.max(radius * 4, 2)))
      } else {
        paths.push({ points: oriented, closed: true, z })
      }
    }

    const levels = zLevels(shape.depth, params.doc)
    for (let level = 0; level < levels.length; level++) {
      const z = levels[level]
      const zPrev = level > 0 ? levels[level - 1] : 0
      if (shape.op === 'on') {
        for (const loop of solid) addClosed(loop, z, zPrev)
        continue
      }
      if (shape.op === 'contour_out') {
        for (const loop of offsetLoops(solid, radius)) addClosed(loop, z, zPrev)
        continue
      }
      if (shape.op === 'contour_in') {
        const inner = offsetLoops(solid, -radius)
        if (!inner.length && level === 0) warnings.push(`${shape.name} : trop petit pour un contour intérieur à cette fraise.`)
        for (const loop of inner) addClosed(loop, z, zPrev)
        continue
      }
      if (shape.op === 'pocket') {
        let ring = offsetLoops(solid, -radius)
        if (!ring.length && level === 0) warnings.push(`${shape.name} : trop petit pour une poche à cette fraise.`)
        let pass = 0
        while (ring.length && pass < 500) {
          for (const loop of ring) addClosed(loop, z, zPrev)
          pass++
          ring = offsetLoops(solid, -(radius + pass * stepover))
        }
        if (pass >= 500) warnings.push(`${shape.name} : poche tronquée (trop de passes).`)
      }
    }
    tag()
  }

  // Le surfacage se fait AVANT les autres operations (il definit la face de reference).
  if (options.surfacing?.enabled && allBounds) {
    for (const path of surfacingPaths(allBounds, options.surfacing)) surfacing.push(path)
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
  if (surfacing.length) paths.unshift(...surfacing)

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
  const step = Math.max(positive(params.stepover, 0.2), 0.2)
  // 1) Anneaux successifs vers l'interieur, profondeur selon l'angle de la fraise.
  const rings: Array<{ loop: Point[]; depth: number }> = []
  let k = 0
  let reachedCap = false
  while (k < 1000) {
    const dist = k * step + step * 0.5
    const ring = offsetLoops(norm, -dist)
    if (!ring.length) break
    const depth = Math.min(cap, dist / tanHalf)
    for (const loop of ring) rings.push({ loop, depth })
    k++
    if (depth >= cap - 1e-6) {
      reachedCap = true
      break
    }
  }
  if (reachedCap) {
    // Fond plat a la profondeur max : on vide l'interieur.
    let dist = k * step + step * 0.5
    for (let g = 0; g < 1000; g++) {
      const ring = offsetLoops(norm, -dist)
      if (!ring.length) break
      for (const loop of ring) rings.push({ loop, depth: cap })
      dist += step
    }
  }
  // 2) Descente par paliers (passe doc) : jamais plus d'une passe de matiere a la fois.
  const levels = zLevels(cap, positive(params.doc, cap))
  let previous = 0
  for (const level of levels) {
    const levelDepth = -level
    for (const { loop, depth } of rings) {
      if (depth <= previous + 1e-6) continue
      paths.push({ points: loop, closed: true, z: -Math.min(depth, levelDepth) })
    }
    previous = levelDepth
  }
}

/**
 * Entree en rampe SUR le parcours lui-meme : on descend de zStart (passe
 * precedente, deja usinee) a zEnd en suivant la boucle sur `length` mm, on fait
 * le tour complet a zEnd, puis on repasse sur la rampe pour l'araser.
 * (Une rampe hors parcours entaillerait la piece ou de la matiere vierge.)
 */
export function rampPath(loop: Point[], zStart: number, zEnd: number, length: number): CutPath {
  const n = loop.length
  let perimeter = 0
  for (let i = 0; i < n; i++) perimeter += dist(loop[i], loop[(i + 1) % n])
  const rampLength = Math.min(Math.max(length, 0.1), perimeter)
  if (!(perimeter > 1e-9) || zStart <= zEnd + 1e-9) return { points: loop, closed: true, z: zEnd }

  const points: CutPoint[] = [{ x: loop[0].x, y: loop[0].y, z: zStart }]
  let travelled = 0
  let i = 0
  // Descente le long des aretes jusqu'a rampLength.
  while (travelled < rampLength - 1e-9) {
    const a = loop[i % n]
    const b = loop[(i + 1) % n]
    const edge = dist(a, b)
    if (travelled + edge >= rampLength - 1e-9) {
      const t = edge > 0 ? (rampLength - travelled) / edge : 1
      const end = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: zEnd }
      points.push(end)
      travelled = rampLength
      // Tour complet a zEnd depuis ce point, retour au point de fin de rampe.
      for (let k = 1; k <= n; k++) points.push({ ...loop[(i + k) % n], z: zEnd })
      points.push({ ...end })
      break
    }
    travelled += edge
    points.push({ ...b, z: zStart + (zEnd - zStart) * (travelled / rampLength) })
    i++
  }
  return { points, closed: false, z: zEnd }
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
    // On ne choisit que parmi les passes du niveau le moins profond restant :
    // jamais une passe profonde avant la passe moins profonde voisine.
    let shallowest = -Infinity
    for (const path of remaining) if (path.points.length) shallowest = Math.max(shallowest, path.z)
    for (let i = 0; i < remaining.length; i++) {
      const path = remaining[i]
      if (!path.points.length || path.z < shallowest - 1e-6) continue
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
  // Tenons utiles seulement si leur sommet est AU-DESSUS du niveau de coupe
  // (sinon on creuserait plus profond que la passe).
  if (tabZ === null || tabZ === undefined || !tabs || tabZ <= z + 1e-6 || loop.length < 2) {
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
  if (!(Math.abs(surfacing.depth) > 0)) return []
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
