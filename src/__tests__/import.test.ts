import { describe, expect, it } from 'vitest'
import { parseDrill, parseGerber } from '../cam/gerber'

const GERBER = `%FSLAX26Y26*%
%MOMM*%
%ADD10C,0.200*%
%ADD11R,1.6X1.6*%
%AMOC8*5,1,8,0,0,1.08239X$1,22.5*%
%ADD12OC8,1.8*%
D10*
X0Y0D02*
X10000000Y0D01*
X10000000Y5000000D01*
G75*
G03X5000000Y10000000I-5000000J0D01*
D11*
X2000000Y2000000D03*
D12*
X8000000Y8000000D03*
G36*
X0Y12000000D02*
X3000000Y12000000D01*
X3000000Y15000000D01*
G37*
M02*`

const DRILL = `M48
METRIC,TZ
T1C0.800
T2C1.000
%
T1
X5.0Y5.0
X10.0Y5.0
T2
X15.0Y5.0
M30`

// Generateur pseudo-aleatoire deterministe.
function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
}

function mutate(text: string, rand: () => number): string {
  const chars = text.split('')
  const ops = Math.floor(rand() * 20) + 1
  for (let k = 0; k < ops; k++) {
    const i = Math.floor(rand() * chars.length)
    const r = rand()
    if (r < 0.3) chars.splice(i, 1)
    else if (r < 0.6) chars.splice(i, 0, '%*XYD0123456789-.G,'[Math.floor(rand() * 19)])
    else if (r < 0.8) chars.length = i
    else chars[i] = String.fromCharCode(32 + Math.floor(rand() * 90))
  }
  return chars.join('')
}

const finite = (n: number) => Number.isFinite(n)

describe('imports PCB', () => {
  it('parse un Gerber valide', () => {
    const result = parseGerber(GERBER)
    expect(result.paths.length).toBeGreaterThan(0)
    expect(result.paths.every((p) => p.every((q) => finite(q.x) && finite(q.y)))).toBe(true)
  })

  it('parse un Excellon valide', () => {
    const result = parseDrill(DRILL)
    expect(result.holes).toEqual([
      { x: 5, y: 5, d: 0.8 },
      { x: 10, y: 5, d: 0.8 },
      { x: 15, y: 5, d: 1 },
    ])
  })

  it('fichiers corrompus : pas de plantage, pas de coordonnees invalides', () => {
    const rand = rng(42)
    for (let n = 0; n < 300; n++) {
      const g = parseGerber(mutate(GERBER, rand))
      for (const path of g.paths) for (const q of path) expect(finite(q.x) && finite(q.y)).toBe(true)
      const d = parseDrill(mutate(DRILL, rand))
      for (const h of d.holes) expect(finite(h.x) && finite(h.y) && finite(h.d)).toBe(true)
    }
  })
})

import { boardRegion, outlinePaths } from '../cam/pcb'
import { areaOf } from '../cam/offset'

const square = (x: number, y: number, size: number) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
]

describe('surface de carte PCB', () => {
  // Trait de contour de 0,2 mm autour d'une carte 50x50 + decoupe 10x10.
  const ring = [square(-0.1, -0.1, 50.2), square(0.1, 0.1, 49.8), square(19.9, 19.9, 10.2), square(20.1, 20.1, 9.8)]

  it('carte = interieur du trait moins les decoupes', () => {
    const board = boardRegion(ring)
    const area = board.reduce((sum, loop) => sum + areaOf(loop), 0)
    expect(Math.abs(area)).toBeCloseTo(49.8 * 49.8 - 10.2 * 10.2, 0)
  })

  it('detourage decale du rayon, a l\'exterieur de la carte', () => {
    const paths = outlinePaths(boardRegion(ring), 1.6, { enabled: false, width: 3, height: 1, spacing: 30 }, 0.8, 0.5)
    expect(paths.length).toBe(4) // 2 boucles (bord + decoupe) x 2 passes
    const xs = paths.flatMap((p) => p.points.map((q) => q.x))
    expect(Math.min(...xs)).toBeCloseTo(0.1 - 0.5, 1)
    expect(Math.max(...xs)).toBeCloseTo(49.9 + 0.5, 1)
  })

  it('contour ouvert : exterieur du trait', () => {
    expect(boardRegion([square(0, 0, 10)]).length).toBe(1)
  })
})
