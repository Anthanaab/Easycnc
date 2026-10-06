import { boundsOfPoints, mergeBounds, shapeLoops } from './geometry'
import type { Bounds, Shape } from './types'

export type AlignMode = 'left' | 'hcenter' | 'right' | 'bottom' | 'vcenter' | 'top'
export type DistributeAxis = 'horizontal' | 'vertical'

function shapeBounds(shape: Shape): Bounds | null {
  let bounds: Bounds | null = null
  for (const loop of shapeLoops(shape)) bounds = mergeBounds(bounds, boundsOfPoints(loop))
  return bounds
}

export function alignShapes(shapes: Shape[], ids: string[], mode: AlignMode): Shape[] {
  if (ids.length < 2) return shapes
  const valid = shapes
    .filter((s) => ids.includes(s.id))
    .map((s) => shapeBounds(s))
    .filter((b): b is Bounds => b !== null)
  if (valid.length < 2) return shapes
  const overall = valid.reduce<Bounds | null>((a, b) => mergeBounds(a, b), null)
  if (!overall) return shapes

  return shapes.map((shape) => {
    if (!ids.includes(shape.id)) return shape
    const b = shapeBounds(shape)
    if (!b) return shape
    let dx = 0
    let dy = 0
    switch (mode) {
      case 'left':
        dx = overall.min.x - b.min.x
        break
      case 'right':
        dx = overall.max.x - b.max.x
        break
      case 'hcenter':
        dx = (overall.min.x + overall.max.x) / 2 - (b.min.x + b.max.x) / 2
        break
      case 'bottom':
        dy = overall.min.y - b.min.y
        break
      case 'top':
        dy = overall.max.y - b.max.y
        break
      case 'vcenter':
        dy = (overall.min.y + overall.max.y) / 2 - (b.min.y + b.max.y) / 2
        break
    }
    return { ...shape, x: shape.x + dx, y: shape.y + dy }
  })
}

export function distributeShapes(shapes: Shape[], ids: string[], axis: DistributeAxis): Shape[] {
  if (ids.length < 3) return shapes
  const items = shapes
    .filter((s) => ids.includes(s.id))
    .map((s) => ({ shape: s, bounds: shapeBounds(s) }))
    .filter((item): item is { shape: Shape; bounds: Bounds } => item.bounds !== null)
    .sort((a, b) => (axis === 'horizontal' ? a.bounds.min.x - b.bounds.min.x : a.bounds.min.y - b.bounds.min.y))
  if (items.length < 3) return shapes

  const first = items[0].bounds
  const last = items[items.length - 1].bounds
  const start = axis === 'horizontal' ? first.min.x : first.min.y
  const end = axis === 'horizontal' ? last.min.x : last.min.y
  const totalSize = items.reduce(
    (acc, item) => acc + (axis === 'horizontal' ? item.bounds.max.x - item.bounds.min.x : item.bounds.max.y - item.bounds.min.y),
    0,
  )
  const gap = (end - start - totalSize) / (items.length - 1)

  const targets = new Map<string, number>()
  let cursor = start
  for (const item of items) {
    const size = axis === 'horizontal' ? item.bounds.max.x - item.bounds.min.x : item.bounds.max.y - item.bounds.min.y
    targets.set(item.shape.id, cursor)
    cursor += size + gap
  }

  return shapes.map((shape) => {
    const target = targets.get(shape.id)
    if (target === undefined) return shape
    const b = shapeBounds(shape)
    if (!b) return shape
    return axis === 'horizontal' ? { ...shape, x: shape.x + (target - b.min.x) } : { ...shape, y: shape.y + (target - b.min.y) }
  })
}
