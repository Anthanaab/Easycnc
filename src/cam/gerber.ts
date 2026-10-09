import { Clipper, ClipperOffset, ClipType, EndType, JoinType, PolyFillType, PolyType } from 'clipper-lib'
import type { Path, Paths } from 'clipper-lib'
import type { Bounds, Point } from './types'

const SC = 1000
const TOL = 0.004

type P = [number, number]

export interface GerberResult {
  paths: Point[][]
  lines: Point[][]
  bbox: Bounds | null
  warnings: string[]
  fn: string
}

export interface Hole {
  x: number
  y: number
  d: number
}

export interface Slot {
  x1: number
  y1: number
  x2: number
  y2: number
  d: number
}

export interface DrillResult {
  holes: Hole[]
  slots: Slot[]
  tools: Record<string, number>
  warnings: string[]
}

export type FileKind = 'copper-top' | 'copper-bottom' | 'outline' | 'drill' | 'other'

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))
const rotate = (x: number, y: number, deg: number): P => {
  const r = (deg * Math.PI) / 180
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)]
}

function arcSteps(r: number, sweep: number): number {
  const dMax = 2 * Math.acos(1 - Math.min(TOL / Math.max(r, 1e-6), 0.9))
  return Math.max(2, Math.ceil(Math.abs(sweep) / dMax))
}

function circlePts(cx: number, cy: number, r: number): P[] {
  const n = clamp(arcSteps(r, 2 * Math.PI), 12, 160)
  const pts: P[] = []
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return pts
}

const rotPts = (pts: P[], deg: number): P[] => (deg ? pts.map(([x, y]) => rotate(x, y, deg)) : pts)
const toClip = (pts: P[]): Path => pts.map(([x, y]) => ({ X: Math.round(x * SC), Y: Math.round(y * SC) }))
const fromClip = (path: Path): Point[] => path.map((p) => ({ x: p.X / SC, y: p.Y / SC }))
const orient = (path: Path): Path => (Clipper.Orientation(path) ? path : path.slice().reverse())
const polyArea = (pts: P[]): number => {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a / 2
}

function evalExpr(src: string, vars: Record<string, number>): number {
  const s = String(src).replace(/\s+/g, '')
  let i = 0
  const peek = () => s[i]
  function number(): number {
    if (peek() === '$') {
      i++
      const j = i
      while (/\d/.test(s[i] || '')) i++
      return vars[s.slice(j, i)] || 0
    }
    if (peek() === '(') {
      i++
      const v = add()
      i++
      return v
    }
    if (peek() === '-') {
      i++
      return -factor()
    }
    if (peek() === '+') {
      i++
      return factor()
    }
    const j = i
    while (/[\d.]/.test(s[i] || '')) i++
    return parseFloat(s.slice(j, i)) || 0
  }
  function factor(): number {
    return number()
  }
  function mul(): number {
    let v = factor()
    while (peek() === 'x' || peek() === 'X' || peek() === '*' || peek() === '/') {
      const o = s[i++]
      const r = factor()
      v = o === '/' ? v / (r || 1e-12) : v * r
    }
    return v
  }
  function add(): number {
    let v = mul()
    while (peek() === '+' || peek() === '-') {
      const o = s[i++]
      const r = mul()
      v = o === '+' ? v + r : v - r
    }
    return v
  }
  return add()
}

function macroShape(def: string[], params: number[], warn: (m: string) => void): Paths {
  const vars: Record<string, number> = {}
  params.forEach((v, i) => {
    vars[String(i + 1)] = v
  })
  let acc: Paths = []
  const apply = (exposure: number, pts: P[]) => {
    if (pts.length < 3) return
    const c = new Clipper()
    const out: Paths = []
    c.AddPaths(acc, PolyType.ptSubject, true)
    c.AddPath(orient(toClip(pts)), PolyType.ptClip, true)
    c.Execute(exposure ? ClipType.ctUnion : ClipType.ctDifference, out, PolyFillType.pftNonZero, PolyFillType.pftNonZero)
    acc = out
  }
  for (const stmt of def) {
    const t = stmt.trim()
    if (!t) continue
    const assign = /^\$(\d+)\s*=(.*)$/.exec(t)
    if (assign) {
      vars[assign[1]] = evalExpr(assign[2], vars)
      continue
    }
    const f = t.split(',')
    const code = parseInt(f[0], 10)
    const v = (k: number): number => evalExpr(f[k] === undefined ? '0' : f[k], vars)
    if (code === 0) continue
    const ex = v(1)
    if (code === 1) apply(ex, rotPts(circlePts(v(3), v(4), v(2) / 2), v(5)))
    else if (code === 20) {
      const w = v(2)
      const x1 = v(3)
      const y1 = v(4)
      const x2 = v(5)
      const y2 = v(6)
      const rot = v(7)
      const dx = x2 - x1
      const dy = y2 - y1
      const L = Math.hypot(dx, dy) || 1e-9
      const nx = (-dy / L) * (w / 2)
      const ny = (dx / L) * (w / 2)
      apply(ex, rotPts([[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]], rot))
    } else if (code === 21) {
      const w = v(2)
      const h = v(3)
      const cx = v(4)
      const cy = v(5)
      const rot = v(6)
      apply(ex, rotPts([[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]], rot))
    } else if (code === 22) {
      const w = v(2)
      const h = v(3)
      const x = v(4)
      const y = v(5)
      const rot = v(6)
      apply(ex, rotPts([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], rot))
    } else if (code === 4) {
      const n = Math.round(v(2))
      const pts: P[] = []
      for (let k = 0; k <= n; k++) pts.push([v(3 + 2 * k), v(4 + 2 * k)])
      apply(ex, rotPts(pts, v(5 + 2 * n)))
    } else if (code === 5) {
      const n = Math.max(3, Math.round(v(2)))
      const cx = v(3)
      const cy = v(4)
      const d = v(5)
      const rot = v(6)
      const pts: P[] = []
      for (let k = 0; k < n; k++) {
        const a = (2 * Math.PI * k) / n
        pts.push([cx + (d / 2) * Math.cos(a), cy + (d / 2) * Math.sin(a)])
      }
      apply(ex, rotPts(pts, rot))
    } else warn(`macro : primitive ${code} ignorée`)
  }
  return acc
}

interface Aperture {
  t: string
  p: number[]
  inch?: boolean
  paths?: Paths
}

interface GerberState {
  unit: 'mm' | 'in'
  zeros: 'L' | 'T'
  xi: number
  xd: number
  yi: number
  yd: number
  mode: number
  multi: boolean
  polarity: 'D' | 'C'
  aps: Record<string, Aperture>
  macros: Record<string, string[]>
  cur: string | null
  x: number
  y: number
  region: boolean
  contour: P[] | null
  stroke: { ap: string | null; pts: P[] } | null
}

export function parseGerber(text: string): GerberResult {
  const warnings: string[] = []
  const warned = new Set<string>()
  const warn = (m: string) => {
    if (!warned.has(m)) {
      warned.add(m)
      warnings.push(m)
    }
  }
  const S: GerberState = {
    unit: 'mm',
    zeros: 'L',
    xi: 2,
    xd: 4,
    yi: 2,
    yd: 4,
    mode: 1,
    multi: true,
    polarity: 'D',
    aps: {},
    macros: {},
    cur: null,
    x: 0,
    y: 0,
    region: false,
    contour: null,
    stroke: null,
  }
  const objs: Array<{ pol: 'D' | 'C'; paths: Paths }> = []
  const attrs: Record<string, string> = {}
  const strokeLines: P[][] = []
  const k = () => (S.unit === 'in' ? 25.4 : 1)

  const num = (str: string | undefined, int: number, dec: number): number | undefined => {
    if (str === undefined) return undefined
    if (str.includes('.')) return parseFloat(str) * k()
    let neg = false
    let d = str
    if (d[0] === '-') {
      neg = true
      d = d.slice(1)
    } else if (d[0] === '+') d = d.slice(1)
    if (S.zeros === 'T') d = d.padEnd(int + dec, '0')
    const v = parseInt(d || '0', 10) / Math.pow(10, dec)
    return (neg ? -v : v) * k()
  }

  const pushObj = (paths: Paths) => {
    if (paths.length) objs.push({ pol: S.polarity, paths })
  }

  const apShape = (ap: Aperture): Paths => {
    if (ap.paths) return ap.paths
    let pts: P[] | null = null
    if (ap.t === 'C') pts = circlePts(0, 0, ap.p[0] / 2)
    else if (ap.t === 'R') {
      const w = ap.p[0]
      const h = ap.p[1]
      pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
    } else if (ap.t === 'O') {
      const w = ap.p[0]
      const h = ap.p[1]
      const r = Math.min(w, h) / 2
      const cs: P[] = []
      if (w >= h) {
        const e = w / 2 - r
        for (let i = 0; i <= 16; i++) {
          const a = -Math.PI / 2 + (Math.PI * i) / 16
          cs.push([e + r * Math.cos(a), r * Math.sin(a)])
        }
        for (let i = 0; i <= 16; i++) {
          const a = Math.PI / 2 + (Math.PI * i) / 16
          cs.push([-e + r * Math.cos(a), r * Math.sin(a)])
        }
      } else {
        const e = h / 2 - r
        for (let i = 0; i <= 16; i++) {
          const a = (Math.PI * i) / 16
          cs.push([r * Math.cos(a), e + r * Math.sin(a)])
        }
        for (let i = 0; i <= 16; i++) {
          const a = Math.PI + (Math.PI * i) / 16
          cs.push([r * Math.cos(a), -e + r * Math.sin(a)])
        }
      }
      pts = cs
    } else if (ap.t === 'P') {
      const d = ap.p[0]
      const n = Math.max(3, Math.round(ap.p[1] || 3))
      const rot = ap.p[2] || 0
      const cs: P[] = []
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n
        cs.push([(d / 2) * Math.cos(a), (d / 2) * Math.sin(a)])
      }
      pts = rotPts(cs, rot)
    } else if (S.macros[ap.t]) {
      let sh = macroShape(S.macros[ap.t], ap.p, warn)
      if (ap.inch) sh = sh.map((pa) => pa.map((q) => ({ X: Math.round(q.X * 25.4), Y: Math.round(q.Y * 25.4) })))
      ap.paths = sh
      return ap.paths
    } else {
      warn('ouverture inconnue ' + ap.t)
      return []
    }
    ap.paths = [orient(toClip(pts))]
    return ap.paths
  }

  const moved = (paths: Paths, x: number, y: number): Paths =>
    paths.map((p) => p.map((q) => ({ X: q.X + Math.round(x * SC), Y: q.Y + Math.round(y * SC) })))

  const flushStroke = () => {
    const st = S.stroke
    S.stroke = null
    if (!st || st.pts.length < 2) return
    const ap = st.ap ? S.aps[st.ap] : null
    if (!ap) return
    const w = ap.t === 'C' ? ap.p[0] : Math.min(ap.p[0] || 0, ap.p[1] || ap.p[0] || 0)
    if (S.polarity === 'D') strokeLines.push(st.pts.map((q) => q.slice() as P))
    if (w <= 0) return
    const co = new ClipperOffset(2, TOL * SC)
    const out: Paths = []
    co.AddPath(toClip(st.pts), JoinType.jtRound, EndType.etOpenRound)
    co.Execute(out, (w / 2) * SC)
    pushObj(out)
  }

  const arcPts = (x: number, y: number, i: number, j: number, cw: boolean): P[] => {
    const x0 = S.x
    const y0 = S.y
    let cands: P[] = [[x0 + i, y0 + j]]
    if (!S.multi) cands = [[x0 + i, y0 + j], [x0 - i, y0 + j], [x0 + i, y0 - j], [x0 - i, y0 - j]]
    let best: { cx: number; cy: number; a0: number; sweep: number; r: number; err: number } | null = null
    for (const [cx, cy] of cands) {
      const r1 = Math.hypot(x0 - cx, y0 - cy)
      const r2 = Math.hypot(x - cx, y - cy)
      const err = Math.abs(r1 - r2)
      const a0 = Math.atan2(y0 - cy, x0 - cx)
      const a1 = Math.atan2(y - cy, x - cx)
      let sweep = a1 - a0
      if (cw) {
        while (sweep > 0) sweep -= 2 * Math.PI
      } else {
        while (sweep < 0) sweep += 2 * Math.PI
      }
      if (S.multi && Math.abs(sweep) < 1e-9 && Math.hypot(x - x0, y - y0) < 1e-9) sweep = cw ? -2 * Math.PI : 2 * Math.PI
      if (!S.multi && Math.abs(sweep) > Math.PI / 2 + 1e-6) continue
      if (!best || err < best.err) best = { cx, cy, a0, sweep, r: (r1 + r2) / 2, err }
    }
    if (!best) return [[x, y]]
    const n = arcSteps(best.r, best.sweep)
    const pts: P[] = []
    for (let s = 1; s <= n; s++) {
      const a = best.a0 + (best.sweep * s) / n
      pts.push([best.cx + best.r * Math.cos(a), best.cy + best.r * Math.sin(a)])
    }
    pts[pts.length - 1] = [x, y]
    return pts
  }

  const src = text.replace(/\r/g, '')
  const blocks: Array<{ ext: boolean; items: string[] }> = []
  for (let p = 0; p < src.length; ) {
    const c = src[p]
    if (c === '%') {
      const e = src.indexOf('%', p + 1)
      if (e < 0) break
      blocks.push({
        ext: true,
        items: src
          .slice(p + 1, e)
          .split('*')
          .map((t) => t.replace(/\s+/g, ' ').trim())
          .filter(Boolean),
      })
      p = e + 1
    } else if (/\s/.test(c)) p++
    else {
      const e = src.indexOf('*', p)
      if (e < 0) break
      blocks.push({ ext: false, items: [src.slice(p, e).replace(/\s+/g, '')] })
      p = e + 1
    }
  }

  for (const b of blocks) {
    if (b.ext) {
      const first = b.items[0] || ''
      if (first.startsWith('AM')) {
        S.macros[first.slice(2)] = b.items.slice(1)
        continue
      }
      for (const it of b.items) {
        let m: RegExpExecArray | null
        if ((m = /^FS([LTD]?)([AI]?)X(\d)(\d)Y(\d)(\d)/.exec(it))) {
          S.zeros = m[1] === 'T' ? 'T' : 'L'
          S.xi = +m[3]
          S.xd = +m[4]
          S.yi = +m[5]
          S.yd = +m[6]
        } else if (it === 'MOMM') S.unit = 'mm'
        else if (it === 'MOIN') S.unit = 'in'
        else if ((m = /^ADD(\d+)([^,]+)(?:,(.*))?$/.exec(it))) {
          const t = m[2]
          const std = ['C', 'R', 'O', 'P'].includes(t)
          const raw = (m[3] || '')
            .split('X')
            .map((v) => parseFloat(v))
            .filter((v) => !Number.isNaN(v))
          if (std) S.aps[m[1]] = { t, p: t === 'P' ? [raw[0] * k(), raw[1] || 3, raw[2] || 0] : raw.map((v) => v * k()) }
          else S.aps[m[1]] = { t, p: raw, inch: S.unit === 'in' }
        } else if (it === 'LPD') {
          flushStroke()
          S.polarity = 'D'
        } else if (it === 'LPC') {
          flushStroke()
          S.polarity = 'C'
        } else if ((m = /^TF\.FileFunction,(.*)$/.exec(it))) attrs.function = m[1]
        else if (it.startsWith('SR') && it !== 'SR') warn('répétition de motifs (SR) non gérée')
      }
      continue
    }
    const t = b.items[0]
    if (!t) continue
    if (t.startsWith('G04')) continue
    let rest = t
    let g: RegExpExecArray | null
    while ((g = /^G0*(\d+)/.exec(rest))) {
      const n = +g[1]
      if (n === 1) S.mode = 1
      else if (n === 2) S.mode = 2
      else if (n === 3) S.mode = 3
      else if (n === 74) S.multi = false
      else if (n === 75) S.multi = true
      else if (n === 36) {
        flushStroke()
        S.region = true
        S.contour = null
      } else if (n === 37) {
        if (S.contour && S.contour.length >= 3) pushObj([orient(toClip(S.contour))])
        S.region = false
        S.contour = null
      } else if (n === 70) S.unit = 'in'
      else if (n === 71) S.unit = 'mm'
      rest = rest.slice(g[0].length)
    }
    if (!rest) continue
    if (/^M0?[0-2]$/.test(rest)) break
    const d = /D0*(\d+)$/.exec(rest)
    const coords: Record<string, string> = {}
    const re = /([XYIJ])([+-]?\d*\.?\d+)/g
    let mm: RegExpExecArray | null
    while ((mm = re.exec(rest))) coords[mm[1]] = mm[2]
    const dn = d ? +d[1] : null
    if (dn !== null && dn >= 10 && !('X' in coords) && !('Y' in coords)) {
      flushStroke()
      S.cur = String(dn)
      continue
    }
    const nx = 'X' in coords ? num(coords.X, S.xi, S.xd)! : S.x
    const ny = 'Y' in coords ? num(coords.Y, S.yi, S.yd)! : S.y
    const ci = 'I' in coords ? num(coords.I, S.xi, S.xd)! : 0
    const cj = 'J' in coords ? num(coords.J, S.yi, S.yd)! : 0
    const op = dn === null ? 1 : dn
    if (op === 2) {
      if (S.region) {
        if (S.contour && S.contour.length >= 3) pushObj([orient(toClip(S.contour))])
        S.contour = [[nx, ny]]
      } else flushStroke()
      S.x = nx
      S.y = ny
    } else if (op === 1) {
      const pts = S.mode === 1 ? [[nx, ny] as P] : arcPts(nx, ny, ci, cj, S.mode === 2)
      if (S.region) {
        if (!S.contour) S.contour = [[S.x, S.y]]
        pts.forEach((q) => S.contour!.push(q))
      } else {
        if (S.stroke && S.stroke.ap !== S.cur) flushStroke()
        if (!S.stroke) S.stroke = { ap: S.cur, pts: [[S.x, S.y]] }
        const stroke = S.stroke
        pts.forEach((q) => stroke.pts.push(q))
      }
      S.x = nx
      S.y = ny
    } else if (op === 3) {
      flushStroke()
      S.x = nx
      S.y = ny
      const ap = S.cur ? S.aps[S.cur] : null
      if (ap) pushObj(moved(apShape(ap), nx, ny))
      else warn('pastille sans ouverture définie')
    }
  }
  flushStroke()

  let acc: Paths = []
  let batch: Paths = []
  let batchPol: 'D' | 'C' = 'D'
  const flush = () => {
    if (!batch.length) return
    const c = new Clipper()
    const out: Paths = []
    c.AddPaths(acc, PolyType.ptSubject, true)
    c.AddPaths(batch, PolyType.ptClip, true)
    c.Execute(batchPol === 'D' ? ClipType.ctUnion : ClipType.ctDifference, out, PolyFillType.pftNonZero, PolyFillType.pftNonZero)
    acc = out
    batch = []
  }
  for (const o of objs) {
    if (o.pol !== batchPol) {
      flush()
      batchPol = o.pol
    }
    o.paths.forEach((p) => batch.push(p))
  }
  flush()
  acc = Clipper.SimplifyPolygons(acc, PolyFillType.pftNonZero)

  const paths = acc.map(fromClip).filter((p) => p.length > 2 && Math.abs(polyArea(p.map((q) => [q.x, q.y] as P))) > 1e-6)
  return { paths, lines: strokeLines.map((l) => l.map(([x, y]) => ({ x, y }))), bbox: bboxOf(paths), warnings, fn: attrs.function || '' }
}

export function parseDrill(text: string): DrillResult {
  const warnings: string[] = []
  const tools: Record<string, number> = {}
  const holes: Hole[] = []
  const slots: Slot[] = []
  let unit: 'mm' | 'in' = 'mm'
  let zeros: 'L' | 'T' = 'L'
  let cur: string | null = null
  let header = true
  let int = 3
  let dec = 3
  let lastPt: [number, number] | null = null
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const val = (str: string | undefined): number | undefined => {
    if (str === undefined) return undefined
    if (str.includes('.')) return parseFloat(str) * (unit === 'in' ? 25.4 : 1)
    let neg = false
    let d = str
    if (d[0] === '-') {
      neg = true
      d = d.slice(1)
    } else if (d[0] === '+') d = d.slice(1)
    if (zeros === 'L') d = d.padEnd(int + dec, '0')
    const v = parseInt(d || '0', 10) / Math.pow(10, dec)
    return (neg ? -v : v) * (unit === 'in' ? 25.4 : 1)
  }
  for (const l0 of lines) {
    const l = l0.replace(/;.*$/, '').trim()
    if (!l) continue
    if (l === 'M48') {
      header = true
      continue
    }
    if (l === '%' || l === 'M95') {
      header = false
      continue
    }
    let m: RegExpExecArray | null
    if ((m = /^(METRIC|INCH)(?:,(LZ|TZ))?(?:,([\d.]+))?/.exec(l))) {
      unit = m[1] === 'INCH' ? 'in' : 'mm'
      if (m[2]) zeros = m[2] === 'TZ' ? 'T' : 'L'
      if (unit === 'in') {
        int = 2
        dec = 4
      } else {
        int = 3
        dec = 3
      }
      continue
    }
    if ((m = /^T(\d+)(?:.*?C([\d.]+))?/.exec(l)) && !/^[XY]/.test(l)) {
      const id = String(+m[1])
      if (m[2] !== undefined) tools[id] = parseFloat(m[2]) * (unit === 'in' ? 25.4 : 1)
      else cur = id
      if (!header) cur = id
      continue
    }
    if (header) continue
    if (/^(M30|M00)/.test(l)) break
    if (/^G05|^G90|^G91|^%|^M/.test(l)) continue
    if ((m = /^X([+-]?[\d.]+)Y([+-]?[\d.]+)G85X([+-]?[\d.]+)Y([+-]?[\d.]+)/.exec(l))) {
      slots.push({ x1: val(m[1])!, y1: val(m[2])!, x2: val(m[3])!, y2: val(m[4])!, d: tools[cur ?? ''] || 0 })
      continue
    }
    if ((m = /^(?:X([+-]?[\d.]+))?(?:Y([+-]?[\d.]+))?$/.exec(l)) && (m[1] !== undefined || m[2] !== undefined)) {
      const x: number = m[1] !== undefined ? val(m[1])! : lastPt ? lastPt[0] : 0
      const y: number = m[2] !== undefined ? val(m[2])! : lastPt ? lastPt[1] : 0
      lastPt = [x, y]
      if (cur === null || !tools[cur]) {
        if (!warnings.includes('trou sans outil défini')) warnings.push('trou sans outil défini')
        continue
      }
      holes.push({ x, y, d: tools[cur] })
    }
  }
  if (slots.length) warnings.push(`${slots.length} trou(s) oblong(s) (G85) non usiné(s)`)
  return { holes, slots, tools, warnings }
}

export function detectFile(name: string, text: string): FileKind {
  const n = name.toLowerCase()
  if (/(\.drl|\.xln|\.exc|\.drd|\.txt)$/.test(n) && /M48|METRIC|INCH/.test(text.slice(0, 800))) return 'drill'
  if (/^M48/m.test(text.slice(0, 200))) return 'drill'
  const ff = (/%TF\.FileFunction,([^*%]*)/.exec(text) || [])[1] || ''
  if (/Copper/i.test(ff)) return /Bot/i.test(ff) ? 'copper-bottom' : /Top/i.test(ff) ? 'copper-top' : /L1/.test(ff) ? 'copper-top' : 'copper-bottom'
  if (/Profile/i.test(ff)) return 'outline'
  if (/(edge[._-]?cuts|\.gko|\.gm1|\.gml|outline|profile)/.test(n)) return 'outline'
  if (/(f[._-]?cu|\.gtl|top[._-]?copper|[._-]top\.g)/.test(n)) return 'copper-top'
  if (/(b[._-]?cu|\.gbl|bottom[._-]?copper|[._-]bot(tom)?\.g)/.test(n)) return 'copper-bottom'
  if (/(\.drl|\.xln|\.drd)$/.test(n)) return 'drill'
  return 'other'
}

function bboxOf(paths: Point[][]): Bounds | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of paths) {
    for (const q of p) {
      if (q.x < minX) minX = q.x
      if (q.x > maxX) maxX = q.x
      if (q.y < minY) minY = q.y
      if (q.y > maxY) maxY = q.y
    }
  }
  return Number.isFinite(minX) ? { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } } : null
}
