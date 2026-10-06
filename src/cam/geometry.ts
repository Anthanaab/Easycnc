import { textLoops } from './text'
import type { Bounds, Point, Shape } from './types'

function rotate(point: Point, cx: number, cy: number, deg: number): Point {
  if (!deg) return point
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = point.x - cx
  const dy = point.y - cy
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }
}

function localLoops(shape: Shape): Point[][] {
  switch (shape.kind) {
    case 'rect': {
      const hw = shape.width / 2
      const hh = shape.height / 2
      return [
        [
          { x: -hw, y: -hh },
          { x: hw, y: -hh },
          { x: hw, y: hh },
          { x: -hw, y: hh },
        ],
      ]
    }
    case 'circle': {
      const r = shape.radius
      const steps = Math.max(24, Math.min(240, Math.ceil((2 * Math.PI * r) / 0.4)))
      const loop: Point[] = []
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2
        loop.push({ x: Math.cos(a) * r, y: Math.sin(a) * r })
      }
      return [loop]
    }
    case 'polygon': {
      const n = Math.max(3, Math.round(shape.sides))
      const r = shape.radius
      const loop: Point[] = []
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2
        loop.push({ x: Math.cos(a) * r, y: Math.sin(a) * r })
      }
      return [loop]
    }
    case 'star': {
      const n = Math.max(3, Math.round(shape.points))
      const rOuter = shape.radius
      const rInner = shape.radius * Math.min(0.95, Math.max(0.1, shape.innerRatio))
      const loop: Point[] = []
      for (let i = 0; i < n * 2; i++) {
        const r = i % 2 === 0 ? rOuter : rInner
        const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2
        loop.push({ x: Math.cos(a) * r, y: Math.sin(a) * r })
      }
      return [loop]
    }
    case 'path':
      return shape.loops ?? []
    case 'text':
      return textLoops(shape.text ?? '', shape.font ?? 'roboto700', shape.fontSize ?? 20)
    case 'testgrid': {
      const cols = Math.max(1, Math.round(shape.cols ?? 5))
      const rows = Math.max(1, Math.round(shape.rows ?? 2))
      const cell = Math.max(1, shape.cell ?? 8)
      const gap = Math.max(0, shape.gap ?? 2)
      const totalW = cols * cell + (cols - 1) * gap
      const totalH = rows * cell + (rows - 1) * gap
      const x0 = -totalW / 2
      const y0 = -totalH / 2
      const loops: Point[][] = []
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const ox = x0 + c * (cell + gap)
          const oy = y0 + r * (cell + gap)
          loops.push([
            { x: ox, y: oy },
            { x: ox + cell, y: oy },
            { x: ox + cell, y: oy + cell },
            { x: ox, y: oy + cell },
          ])
        }
      }
      return loops
    }
    default:
      return []
  }
}

/** Boucles d'une forme en coordonnees monde (rotation + translation). */
export function shapeLoops(shape: Shape): Point[][] {
  return localLoops(shape).map((loop) =>
    loop.map((p) => {
      const r = rotate(p, 0, 0, shape.rotation)
      return { x: r.x + shape.x, y: r.y + shape.y }
    }),
  )
}

export function polygonArea(points: Point[]): number {
  let area = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += (points[j].x + points[i].x) * (points[j].y - points[i].y)
  }
  return area / 2
}

export function boundsOfPoints(points: Point[]): Bounds | null {
  if (!points.length) return null
  const min = { x: Infinity, y: Infinity }
  const max = { x: -Infinity, y: -Infinity }
  for (const p of points) {
    min.x = Math.min(min.x, p.x)
    min.y = Math.min(min.y, p.y)
    max.x = Math.max(max.x, p.x)
    max.y = Math.max(max.y, p.y)
  }
  return { min, max }
}

export function mergeBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a) return b
  if (!b) return a
  return {
    min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y) },
    max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y) },
  }
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y
    const intersect = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}
