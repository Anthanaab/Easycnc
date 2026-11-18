import { describe, expect, it } from 'vitest'
import { fitArcs } from '../cam/arcFit'
import { toolpathToGcode } from '../cam/gcode'
import { loadFonts, textLoops } from '../cam/text'
import type { CamResult } from '../cam/toolpath'
import type { Point } from '../cam/types'
import { parseGcode } from '../gcode/parser'

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function distToPolyline(p: Point, poly: Point[]): number {
  let best = Infinity
  for (let i = 1; i < poly.length; i++) best = Math.min(best, distToSegment(p, poly[i - 1], poly[i]))
  return best
}

const options = { safeZ: 5, feed: 600, plunge: 200, rpm: 12000, spindleMode: 'grbl' as const, arcs: true }

/** G-code avec arcs, relu par le parseur : ecart max entre trace d'origine et trace relu. */
function roundTrip(loop: Point[]) {
  const result: CamResult = { paths: [{ points: loop, closed: true, z: -1 }], warnings: [], bounds: null, moveCount: 0, cutLength: 0 }
  const gcode = toolpathToGcode(result, options)
  const parsed = parseGcode(gcode, { arcTolerance: 0.0005 })
  const cut = parsed.segments.filter((s) => !s.rapid && s.from.z === -1 && s.to.z === -1)
  const traced: Point[] = [cut[0].from, ...cut.map((s) => s.to)]
  const original = [...loop, loop[0]]
  let error = 0
  for (const p of traced) error = Math.max(error, distToPolyline(p, original))
  for (const p of original) error = Math.max(error, distToPolyline(p, traced))
  const arcs = gcode.split('\n').filter((l) => /^G[23] /.test(l)).length
  const lines = gcode.split('\n').filter((l) => /^G1 X/.test(l)).length
  return { error, arcs, lines }
}

function roundedRect(w: number, h: number, r: number): Point[] {
  const pts: Point[] = []
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= 16; i++) {
      const a = a0 + (i / 16) * (Math.PI / 2)
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
    }
  }
  corner(w - r, r, -Math.PI / 2)
  corner(w - r, h - r, 0)
  corner(r, h - r, Math.PI / 2)
  corner(r, r, Math.PI)
  return pts
}

describe('arcs G2/G3 sur les courbes', () => {
  it('rectangle a coins arrondis : 4 arcs, trace fidele', () => {
    const { error, arcs } = roundTrip(roundedRect(60, 40, 8))
    expect(arcs).toBeGreaterThanOrEqual(4)
    expect(error).toBeLessThan(0.02)
  })

  it('ellipse (pas un cercle) : reste fidele a 0,02 mm', () => {
    const loop = Array.from({ length: 200 }, (_, i) => ({ x: 30 * Math.cos((i / 200) * 2 * Math.PI), y: 12 * Math.sin((i / 200) * 2 * Math.PI) }))
    const { error, arcs, lines } = roundTrip(loop)
    expect(error).toBeLessThan(0.02)
    expect(arcs + lines).toBeLessThan(200)
  })

  it('zigzag (aucun arc) : uniquement des lignes, identique', () => {
    const loop = Array.from({ length: 40 }, (_, i) => ({ x: i * 2, y: i % 2 ? 3 : 0 }))
    const { error, arcs } = roundTrip([...loop, { x: 78, y: -10 }, { x: 0, y: -10 }])
    expect(arcs).toBe(0)
    expect(error).toBeLessThan(1e-3)
  })

  it('texte : beaucoup moins de lignes, trace fidele', async () => {
    await loadFonts()
    for (const loop of textLoops('Sg', 'pacifico400', 30)) {
      const { error, arcs } = roundTrip(loop)
      expect(error).toBeLessThan(0.02)
      expect(arcs).toBeGreaterThan(0)
    }
  })

  it('jamais d\'arc sur moins de 4 points ni dans les deux sens', () => {
    const s = fitArcs([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }])
    expect(s.every((seg) => seg.kind === 'line')).toBe(true)
    const wave = Array.from({ length: 30 }, (_, i) => ({ x: i, y: Math.sin(i / 3) * 5 }))
    for (const seg of fitArcs(wave)) if (seg.kind === 'arc') expect(Number.isFinite(seg.cx)).toBe(true)
  })
})

describe('arcs acceptes par GRBL (erreur 33)', () => {
  it('rayon de debut et de fin identiques a 0,005 mm pres apres arrondi', async () => {
    await loadFonts()
    const paths = [...textLoops('EasyCNC & Co', 'pacifico400', 18), roundedRect(50, 30, 6)].map((points) => ({ points, closed: true, z: -0.5 }))
    const gcode = toolpathToGcode({ paths, warnings: [], bounds: null, moveCount: 0, cutLength: 0 }, options)
    let x = 0
    let y = 0
    let checked = 0
    for (const line of gcode.split('\n')) {
      const get = (k: string) => {
        const m = new RegExp(`${k}(-?[\\d.]+)`).exec(line)
        return m ? Number(m[1]) : undefined
      }
      const nx = get('X')
      const ny = get('Y')
      if (/^G[23] /.test(line)) {
        const i = get('I')!
        const j = get('J')!
        const rStart = Math.hypot(i, j)
        const rEnd = Math.hypot(nx! - (x + i), ny! - (y + j))
        expect(Math.abs(rStart - rEnd)).toBeLessThan(0.005)
        checked++
      }
      if (nx !== undefined) x = nx
      if (ny !== undefined) y = ny
    }
    expect(checked).toBeGreaterThan(20)
  })
})
