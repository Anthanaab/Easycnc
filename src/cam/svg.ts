import type { Point } from './types'

export interface SvgImportResult {
  groups: Point[][][]
  skipped: number
}

const NS = 'http://www.w3.org/2000/svg'
const PX_TO_MM = 25.4 / 96

function splitSubpaths(d: string): Array<{ d: string; closed: boolean }> {
  const regex = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g
  const arity: Record<string, number> = { L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 }
  let cx = 0
  let cy = 0
  let sx = 0
  let sy = 0
  let current: { d: string; closed: boolean } | null = null
  const subs: Array<{ d: string; closed: boolean }> = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(d)) !== null) {
    const command = match[1]
    const upper = command.toUpperCase()
    const relative = command !== upper
    const nums = (match[2].match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || []).map(Number)
    if (upper === 'M') {
      let x = nums[0]
      let y = nums[1]
      if (relative) {
        x += cx
        y += cy
      }
      cx = sx = x
      cy = sy = y
      current = { d: `M${x} ${y}`, closed: false }
      subs.push(current)
      for (let i = 2; i + 1 < nums.length; i += 2) {
        const px = nums[i] + (relative ? cx : 0)
        const py = nums[i + 1] + (relative ? cy : 0)
        current.d += ` L${px} ${py}`
        cx = px
        cy = py
      }
      continue
    }
    if (!current) {
      current = { d: `M${cx} ${cy}`, closed: false }
      subs.push(current)
    }
    if (upper === 'Z') {
      current.d += ' Z'
      current.closed = true
      cx = sx
      cy = sy
      current = null
      continue
    }
    current.d += command + match[2]
    const a = arity[upper]
    for (let i = 0; i + a <= nums.length; i += a) {
      if (upper === 'H') cx = nums[i] + (relative ? cx : 0)
      else if (upper === 'V') cy = nums[i] + (relative ? cy : 0)
      else {
        cx = nums[i + a - 2] + (relative ? cx : 0)
        cy = nums[i + a - 1] + (relative ? cy : 0)
      }
    }
  }
  return subs
}

function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let maxDist = 0
    let maxIndex = -1
    const ax = points[a].x
    const ay = points[a].y
    const bx = points[b].x
    const by = points[b].y
    const dx = bx - ax
    const dy = by - ay
    const length = Math.hypot(dx, dy) || 1e-9
    for (let i = a + 1; i < b; i++) {
      const dist = Math.abs((points[i].x - ax) * dy - (points[i].y - ay) * dx) / length
      if (dist > maxDist) {
        maxDist = dist
        maxIndex = i
      }
    }
    if (maxDist > tolerance && maxIndex > 0) {
      keep[maxIndex] = 1
      stack.push([a, maxIndex], [maxIndex, b])
    }
  }
  return points.filter((_, i) => keep[i])
}

export function importSvg(text: string): SvgImportResult {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const root = doc.documentElement
  if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) {
    throw new Error('Fichier SVG invalide.')
  }
  const live = document.importNode(root, true) as unknown as SVGSVGElement
  const viewBox = live.viewBox && live.viewBox.baseVal
  const w = live.getAttribute('width')
  const h = live.getAttribute('height')
  if ((!w || /%/.test(w) || !h || /%/.test(h)) && viewBox && viewBox.width) {
    live.setAttribute('width', String(viewBox.width))
    live.setAttribute('height', String(viewBox.height))
  }

  const host = document.createElement('div')
  host.style.cssText = 'position:absolute;left:-100000px;top:0;width:4000px;height:4000px;overflow:hidden;visibility:hidden'
  host.appendChild(live)
  document.body.appendChild(host)

  const groups: Point[][][] = []
  let skipped = live.querySelectorAll('text').length

  const measure = (el: SVGGeometryElement, closed: boolean, bucket: Point[][]) => {
    const m = (el as unknown as SVGGraphicsElement).getCTM()
    if (!m || !el.getTotalLength) return
    const total = el.getTotalLength()
    if (!(total > 0)) return
    const scale = Math.hypot(m.a, m.b) * PX_TO_MM
    const steps = Math.max(4, Math.min(6000, Math.ceil((total * scale) / 0.25)))
    let points: Point[] = []
    for (let i = 0; i <= steps; i++) {
      const p = el.getPointAtLength((total * i) / steps)
      const q = new DOMPoint(p.x, p.y).matrixTransform(m)
      points.push({ x: q.x * PX_TO_MM, y: -q.y * PX_TO_MM })
    }
    if (closed && points.length > 1 && Math.hypot(points[0].x - points[points.length - 1].x, points[0].y - points[points.length - 1].y) < 1e-3) {
      points.pop()
    }
    points = simplify(points, 0.01)
    if (points.length >= (closed ? 3 : 2)) bucket.push(points)
  }

  try {
    live.querySelectorAll('path,rect,circle,ellipse,polygon,polyline,line').forEach((node) => {
      const el = node as unknown as SVGGeometryElement
      const tag = node.tagName.toLowerCase()
      const bucket: Point[][] = []
      if (tag === 'path') {
        for (const sub of splitSubpaths(el.getAttribute('d') || '')) {
          const p = document.createElementNS(NS, 'path') as SVGPathElement
          p.setAttribute('d', sub.d)
          el.parentNode!.insertBefore(p, el)
          try {
            measure(p, sub.closed, bucket)
          } finally {
            p.remove()
          }
        }
      } else {
        measure(el, tag !== 'polyline' && tag !== 'line', bucket)
      }
      if (bucket.length) groups.push(bucket)
    })
  } finally {
    host.remove()
  }

  return { groups, skipped }
}
