import type { Point } from './types'

export type FitSegment =
  | { kind: 'line'; to: Point }
  | { kind: 'arc'; to: Point; cx: number; cy: number; cw: boolean }

const MIN_POINTS = 4
const MAX_RADIUS = 2000
const MIN_RADIUS = 0.05

function circumcircle(a: Point, b: Point, c: Point): { cx: number; cy: number; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y))
  if (Math.abs(d) < 1e-12) return null
  const a2 = a.x * a.x + a.y * a.y
  const b2 = b.x * b.x + b.y * b.y
  const c2 = c.x * c.x + c.y * c.y
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d
  const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d
  return { cx, cy, r: Math.hypot(a.x - cx, a.y - cy) }
}

/**
 * Verifie que points[i..j] suivent un arc (centre, rayon) a `tol` pres, dans un
 * seul sens et sur moins d'un tour, cordes comprises (fleche <= tol).
 */
function fits(points: Point[], i: number, j: number, tol: number): { cx: number; cy: number; cw: boolean } | null {
  const circle = circumcircle(points[i], points[(i + j) >> 1], points[j])
  if (!circle || circle.r > MAX_RADIUS || circle.r < MIN_RADIUS) return null
  const { cx, cy, r } = circle
  let sign = 0
  let sweep = 0
  for (let k = i; k < j; k++) {
    const p = points[k]
    const q = points[k + 1]
    if (Math.abs(Math.hypot(q.x - cx, q.y - cy) - r) > tol) return null
    const cross = (p.x - cx) * (q.y - cy) - (p.y - cy) * (q.x - cx)
    const dot = (p.x - cx) * (q.x - cx) + (p.y - cy) * (q.y - cy)
    const s = Math.sign(cross)
    if (s === 0) return null
    if (sign === 0) sign = s
    else if (s !== sign) return null
    const angle = Math.atan2(Math.abs(cross), dot)
    // Fleche de la corde remplacee par l'arc.
    const sagitta = r * (1 - Math.cos(angle / 2))
    if (sagitta > tol) return null
    sweep += angle
  }
  if (sweep >= 2 * Math.PI - 1e-3) return null
  return { cx, cy, cw: sign < 0 }
}

/**
 * Remplace les suites de points alignees sur un arc par des arcs (G2/G3).
 * `points` commence a la position courante. Ecart max au trace d'origine : `tol`.
 */
export function fitArcs(points: Point[], tol = 0.01): FitSegment[] {
  const out: FitSegment[] = []
  let i = 0
  while (i < points.length - 1) {
    let best: { j: number; cx: number; cy: number; cw: boolean } | null = null
    for (let j = i + MIN_POINTS - 1; j < points.length; j++) {
      const arc = fits(points, i, j, tol)
      if (!arc) break
      best = { j, ...arc }
    }
    if (best) {
      out.push({ kind: 'arc', to: points[best.j], cx: best.cx, cy: best.cy, cw: best.cw })
      i = best.j
    } else {
      out.push({ kind: 'line', to: points[i + 1] })
      i++
    }
  }
  return out
}
