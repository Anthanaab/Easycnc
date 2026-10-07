import { useEffect, useRef, useState } from 'react'
import { useCamStore } from '../cam/camStore'
import { pointInPolygon, shapeLoops, boundsOfPoints } from '../cam/geometry'
import type { CamResult } from '../cam/toolpath'
import type { Bounds, Point, Shape } from '../cam/types'
import { useStore } from '../state/store'

const GRID_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500]

interface Props {
  result: CamResult | null
}

export function DesignCanvas({ result }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const shapes = useCamStore((s) => s.shapes)
  const images = useCamStore((s) => s.images)
  const stock = useCamStore((s) => s.stock)
  const machine = useStore((s) => s.machines.find((m) => m.id === s.machineId))
  const selectedIds = useCamStore((s) => s.selectedIds)
  const view = useCamStore((s) => s.view)
  const select = useCamStore((s) => s.select)
  const updateShape = useCamStore((s) => s.updateShape)
  const setStock = useCamStore((s) => s.setStock)
  const setView = useCamStore((s) => s.setView)
  const pushHistory = useCamStore((s) => s.pushHistory)
  const setDragging = useCamStore((s) => s.setDragging)
  const snap = useCamStore((s) => s.snap)
  const snapStep = useCamStore((s) => s.snapStep)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [, setTick] = useState(0)
  const imgCache = useRef(new Map<string, HTMLImageElement>())

  useEffect(() => {
    let added = false
    for (const image of images) {
      if (!imgCache.current.has(image.src)) {
        const el = new Image()
        el.onload = () => setTick((t) => t + 1)
        el.src = image.src
        imgCache.current.set(image.src, el)
        added = true
      }
    }
    if (added) setTick((t) => t + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images])

  const drag = useRef<{
    mode: 'none' | 'pan' | 'move' | 'move-stock' | 'resize'
    shapeId?: string
    handle?: string
    startBounds?: Bounds
    startShape?: Shape
    startX: number
    startY: number
    panX: number
    panY: number
    shapeX: number
    shapeY: number
    stockX: number
    stockY: number
  }>({ mode: 'none', startX: 0, startY: 0, panX: 0, panY: 0, shapeX: 0, shapeY: 0, stockX: 0, stockY: 0 })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => {
      setSize({ width: container.clientWidth, height: container.clientHeight })
    })
    observer.observe(container)
    setSize({ width: container.clientWidth, height: container.clientHeight })
    return () => observer.disconnect()
  }, [])

  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current || !size.width || !size.height || !machine) return
    const area = machine.area
    const zoom = Math.min((size.width - 40) / area.x, (size.height - 40) / area.y, 6)
    if (!Number.isFinite(zoom) || zoom <= 0) return
    setView({ zoom, panX: -(area.x / 2) * zoom, panY: (area.y / 2) * zoom })
    fitted.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, machine])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !size.width || !size.height) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size.width * dpr
    canvas.height = size.height * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw(ctx, size.width, size.height, view, shapes, selectedIds, result, images, imgCache.current, stock, machine?.area)
  }, [size, view, shapes, selectedIds, result, images, stock, machine])

  const toWorld = (sx: number, sy: number): Point => ({
    x: (sx - size.width / 2 - view.panX) / view.zoom,
    y: -(sy - size.height / 2 - view.panY) / view.zoom,
  })

  const toScreenPoint = (p: Point): { sx: number; sy: number } => ({
    sx: p.x * view.zoom + view.panX + size.width / 2,
    sy: -p.y * view.zoom + view.panY + size.height / 2,
  })

  const hitTest = (world: Point): string | null => {
    for (let i = shapes.length - 1; i >= 0; i--) {
      const shape = shapes[i]
      for (const loop of shapeLoops(shape)) {
        if (pointInPolygon(world, loop)) return shape.id
      }
    }
    return null
  }

  const stockScreenRect = () => {
    const c = toScreenPoint({ x: stock.x, y: stock.y })
    const halfW = (stock.width * view.zoom) / 2
    const halfH = (stock.height * view.zoom) / 2
    return { left: c.sx - halfW, right: c.sx + halfW, top: c.sy - halfH, bottom: c.sy + halfH }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const world = toWorld(sx, sy)
    drag.current.startX = sx
    drag.current.startY = sy
    drag.current.panX = view.panX
    drag.current.panY = view.panY

    if (e.button === 1 || e.button === 2) {
      drag.current.mode = 'pan'
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0) return

    if (selectedIds.length === 1) {
      const shape = shapes.find((s) => s.id === selectedIds[0])
      if (shape && supportsResize(shape.kind)) {
        const b = shapeBoundsOf(shape)
        if (b) {
          for (const hp of handlePoints(b)) {
            const sp = toScreenPoint(hp)
            if (Math.abs(sp.sx - sx) <= 8 && Math.abs(sp.sy - sy) <= 8) {
              pushHistory()
              setDragging(true)
              drag.current.mode = 'resize'
              drag.current.handle = hp.id
              drag.current.shapeId = shape.id
              drag.current.startBounds = b
              drag.current.startShape = shape
              e.currentTarget.setPointerCapture(e.pointerId)
              return
            }
          }
        }
      }
    }

    const hit = hitTest(world)
    if (stock.enabled) {
      const r = stockScreenRect()
      const tol = 8
      const inside = sx >= r.left && sx <= r.right && sy >= r.top && sy <= r.bottom
      const nearBorder =
        sx >= r.left - tol && sx <= r.right + tol && sy >= r.top - tol && sy <= r.bottom + tol && !inside
      if (nearBorder || (!hit && inside)) {
        drag.current.mode = 'move-stock'
        drag.current.stockX = stock.x
        drag.current.stockY = stock.y
        setDragging(true)
        e.currentTarget.setPointerCapture(e.pointerId)
        return
      }
    }
    if (hit) {
      select(hit, e.shiftKey)
      const shape = shapes.find((s) => s.id === hit)
      if (shape) {
        pushHistory()
        setDragging(true)
        drag.current.mode = 'move'
        drag.current.shapeId = hit
        drag.current.shapeX = shape.x
        drag.current.shapeY = shape.y
      }
    } else {
      select(null)
      drag.current.mode = 'pan'
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const state = drag.current
    const rect = e.currentTarget.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    if (state.mode === 'none') {
      if (stock.enabled) {
        const r = stockScreenRect()
        const inside = sx >= r.left && sx <= r.right && sy >= r.top && sy <= r.bottom
        e.currentTarget.style.cursor = inside ? 'move' : ''
      }
      return
    }
    const dx = sx - state.startX
    const dy = sy - state.startY

    if (state.mode === 'pan') {
      setView({ panX: state.panX + dx, panY: state.panY + dy })
    } else if (state.mode === 'resize' && state.handle && state.shapeId && state.startBounds && state.startShape) {
      const world = toWorld(sx, sy)
      const patch = resizePatch(state.startShape, state.startBounds, state.handle, world)
      if (patch) updateShape(state.shapeId, patch)
    } else if (state.mode === 'move' && state.shapeId) {
      let x = state.shapeX + dx / view.zoom
      let y = state.shapeY - dy / view.zoom
      if (snap && snapStep > 0) {
        x = Math.round(x / snapStep) * snapStep
        y = Math.round(y / snapStep) * snapStep
      }
      updateShape(state.shapeId, { x, y })
    } else if (state.mode === 'move-stock') {
      let x = state.stockX + dx / view.zoom
      let y = state.stockY - dy / view.zoom
      if (snap && snapStep > 0) {
        x = Math.round(x / snapStep) * snapStep
        y = Math.round(y / snapStep) * snapStep
      }
      setStock({ x, y })
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drag.current.mode = 'none'
    setDragging(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const before = toWorld(sx, sy)
    const zoom = Math.min(80, Math.max(0.2, view.zoom * Math.exp(-e.deltaY * 0.0015)))
    setView({
      zoom,
      panX: sx - before.x * zoom - size.width / 2,
      panY: sy + before.y * zoom - size.height / 2,
    })
  }

  return (
    <div className="design-canvas" ref={containerRef}>
      <canvas
        ref={canvasRef}
        style={{ width: size.width, height: size.height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  )
}

function draw(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  view: { zoom: number; panX: number; panY: number },
  shapes: ReturnType<typeof useCamStore.getState>['shapes'],
  selectedIds: string[],
  result: CamResult | null,
  images: ReturnType<typeof useCamStore.getState>['images'],
  imgCache: Map<string, HTMLImageElement>,
  stock: ReturnType<typeof useCamStore.getState>['stock'],
  bed: { x: number; y: number } | undefined,
): void {
  ctx.fillStyle = '#0b0e13'
  ctx.fillRect(0, 0, width, height)

  const toScreen = (p: Point) => ({
    sx: p.x * view.zoom + view.panX + width / 2,
    sy: -p.y * view.zoom + view.panY + height / 2,
  })
  const toWorld = (sx: number, sy: number) => ({
    x: (sx - width / 2 - view.panX) / view.zoom,
    y: -(sy - height / 2 - view.panY) / view.zoom,
  })

  const topLeft = toWorld(0, 0)
  const bottomRight = toWorld(width, height)
  const step = GRID_STEPS.find((s) => s * view.zoom >= 28) ?? GRID_STEPS[GRID_STEPS.length - 1]

  ctx.lineWidth = 1
  ctx.strokeStyle = '#161d26'
  ctx.beginPath()
  for (let x = Math.floor(topLeft.x / step) * step; x <= bottomRight.x; x += step) {
    const { sx } = toScreen({ x, y: 0 })
    ctx.moveTo(sx, 0)
    ctx.lineTo(sx, height)
  }
  for (let y = Math.floor(bottomRight.y / step) * step; y <= topLeft.y; y += step) {
    const { sy } = toScreen({ x: 0, y })
    ctx.moveTo(0, sy)
    ctx.lineTo(width, sy)
  }
  ctx.stroke()

  const origin = toScreen({ x: 0, y: 0 })
  ctx.strokeStyle = '#3a2a2a'
  ctx.beginPath()
  ctx.moveTo(0, origin.sy)
  ctx.lineTo(width, origin.sy)
  ctx.stroke()
  ctx.strokeStyle = '#26332a'
  ctx.beginPath()
  ctx.moveTo(origin.sx, 0)
  ctx.lineTo(origin.sx, height)
  ctx.stroke()

  if (bed && bed.x > 0 && bed.y > 0) {
    const origin = toScreen({ x: 0, y: 0 })
    const corner = toScreen({ x: bed.x, y: bed.y })
    const left = origin.sx
    const top = corner.sy
    const w = corner.sx - origin.sx
    const h = origin.sy - corner.sy
    ctx.save()
    ctx.setLineDash([10, 6])
    ctx.strokeStyle = '#4c8dff'
    ctx.lineWidth = 2
    ctx.strokeRect(left, top, w, h)
    ctx.restore()
    ctx.fillStyle = '#4c8dff'
    ctx.font = '12px ui-monospace, monospace'
    ctx.fillText(`Plateau ${bed.x}×${bed.y} mm  (0,0)`, left + 6, top + 16)
  }

  if (stock.enabled) {
    const sw = stock.width * view.zoom
    const sh = stock.height * view.zoom
    const center = toScreen({ x: stock.x, y: stock.y })
    const left = center.sx - sw / 2
    const top = center.sy - sh / 2
    ctx.fillStyle = 'rgba(216,185,138,0.10)'
    ctx.fillRect(left, top, sw, sh)
    ctx.save()
    ctx.setLineDash([8, 5])
    ctx.strokeStyle = '#c8a878'
    ctx.lineWidth = 1.6
    ctx.strokeRect(left, top, sw, sh)
    ctx.restore()
    ctx.fillStyle = '#c8a878'
    ctx.font = '12px ui-monospace, monospace'
    ctx.fillText(`${stock.width} × ${stock.height} × ${stock.thickness} mm`, left + 6, top + 16)
  }

  for (const image of images) {
    const el = imgCache.get(image.src)
    const height = image.rows * image.pixelSize
    const tl = toScreen({ x: image.x - image.width / 2, y: image.y + height / 2 })
    const br = toScreen({ x: image.x + image.width / 2, y: image.y - height / 2 })
    const w = br.sx - tl.sx
    const h = br.sy - tl.sy
    if (el && el.complete && w > 0 && h > 0) {
      ctx.globalAlpha = 0.85
      ctx.drawImage(el, tl.sx, tl.sy, w, h)
      ctx.globalAlpha = 1
    }
    ctx.strokeStyle = '#8a7a5a'
    ctx.lineWidth = 1
    ctx.strokeRect(tl.sx, tl.sy, w, h)
  }

  for (const shape of shapes) {
    const loops = shapeLoops(shape)
    const selected = selectedIds.includes(shape.id)
    ctx.beginPath()
    for (const loop of loops) {
      loop.forEach((p, i) => {
        const { sx, sy } = toScreen(p)
        if (i === 0) ctx.moveTo(sx, sy)
        else ctx.lineTo(sx, sy)
      })
      ctx.closePath()
    }
    ctx.fillStyle = selected ? 'rgba(53,208,186,0.18)' : 'rgba(76,141,255,0.10)'
    ctx.fill()
    ctx.strokeStyle = selected ? '#35d0ba' : '#4c8dff'
    ctx.lineWidth = selected ? 2 : 1.4
    ctx.stroke()
  }

  if (selectedIds.length === 1) {
    const shape = shapes.find((s) => s.id === selectedIds[0])
    if (shape && supportsResize(shape.kind)) {
      const b = shapeBoundsOf(shape)
      if (b) {
        for (const hp of handlePoints(b)) {
          const { sx, sy } = toScreen(hp)
          ctx.fillStyle = '#35d0ba'
          ctx.strokeStyle = '#0b0e13'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.rect(sx - 4, sy - 4, 8, 8)
          ctx.fill()
          ctx.stroke()
        }
      }
    }
  }

  if (result) {
    ctx.strokeStyle = '#e0803c'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    for (const path of result.paths) {
      path.points.forEach((p, i) => {
        const { sx, sy } = toScreen(p)
        if (i === 0) ctx.moveTo(sx, sy)
        else ctx.lineTo(sx, sy)
      })
      if (path.closed && path.points.length) {
        const { sx, sy } = toScreen(path.points[0])
        ctx.lineTo(sx, sy)
      }
    }
    ctx.stroke()
  }
}

function supportsResize(kind: Shape['kind']): boolean {
  return kind === 'rect' || kind === 'circle' || kind === 'polygon' || kind === 'star' || kind === 'text' || kind === 'path'
}

function shapeBoundsOf(shape: Shape): Bounds | null {
  let bounds: Bounds | null = null
  for (const loop of shapeLoops(shape)) {
    const lb = boundsOfPoints(loop)
    if (!lb) continue
    bounds = bounds
      ? {
          min: { x: Math.min(bounds.min.x, lb.min.x), y: Math.min(bounds.min.y, lb.min.y) },
          max: { x: Math.max(bounds.max.x, lb.max.x), y: Math.max(bounds.max.y, lb.max.y) },
        }
      : lb
  }
  return bounds
}

function handlePoints(b: Bounds): Array<{ id: string; x: number; y: number }> {
  const cx = (b.min.x + b.max.x) / 2
  const cy = (b.min.y + b.max.y) / 2
  return [
    { id: 'nw', x: b.min.x, y: b.max.y },
    { id: 'n', x: cx, y: b.max.y },
    { id: 'ne', x: b.max.x, y: b.max.y },
    { id: 'e', x: b.max.x, y: cy },
    { id: 'se', x: b.max.x, y: b.min.y },
    { id: 's', x: cx, y: b.min.y },
    { id: 'sw', x: b.min.x, y: b.min.y },
    { id: 'w', x: b.min.x, y: cy },
  ]
}

function resizePatch(shape: Shape, b0: Bounds, handle: string, world: Point): Partial<Shape> | null {
  const minSize = 0.5
  const b: Bounds = { min: { ...b0.min }, max: { ...b0.max } }
  if (handle.includes('w')) b.min.x = Math.min(world.x, b.max.x - minSize)
  if (handle.includes('e')) b.max.x = Math.max(world.x, b.min.x + minSize)
  if (handle.includes('s')) b.min.y = Math.min(world.y, b.max.y - minSize)
  if (handle.includes('n')) b.max.y = Math.max(world.y, b.min.y + minSize)
  const w = b.max.x - b.min.x
  const h = b.max.y - b.min.y
  const cx = (b.min.x + b.max.x) / 2
  const cy = (b.min.y + b.max.y) / 2
  if (shape.kind === 'rect') return { x: cx, y: cy, width: w, height: h }
  if (shape.kind === 'circle' || shape.kind === 'polygon' || shape.kind === 'star') {
    return { x: cx, y: cy, radius: Math.max(w, h) / 2 }
  }
  if (shape.kind === 'text') {
    const h0 = b0.max.y - b0.min.y
    const scale = h0 > 0 ? h / h0 : 1
    return { x: cx, y: cy, fontSize: Math.max(2, (shape.fontSize ?? 20) * scale) }
  }
  if (shape.kind === 'path') {
    const loops = shape.loops ?? []
    if (!loops.length) return null
    let lminX = Infinity
    let lminY = Infinity
    let lmaxX = -Infinity
    let lmaxY = -Infinity
    for (const loop of loops) {
      for (const p of loop) {
        lminX = Math.min(lminX, p.x)
        lminY = Math.min(lminY, p.y)
        lmaxX = Math.max(lmaxX, p.x)
        lmaxY = Math.max(lmaxY, p.y)
      }
    }
    if (!Number.isFinite(lminX)) return null
    const lcx = (lminX + lmaxX) / 2
    const lcy = (lminY + lmaxY) / 2
    const oldW = b0.max.x - b0.min.x
    const oldH = b0.max.y - b0.min.y
    const fx = oldW > 1e-6 ? w / oldW : 1
    const fy = oldH > 1e-6 ? h / oldH : 1
    const nextLoops = loops.map((loop) => loop.map((p) => ({ x: lcx + (p.x - lcx) * fx, y: lcy + (p.y - lcy) * fy })))
    return { loops: nextLoops, x: cx - lcx, y: cy - lcy }
  }
  return null
}
