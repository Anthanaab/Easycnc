import { describe, expect, it } from 'vitest'
import { alignShapes, distributeShapes } from '../cam/arrange'
import { combineLoops } from '../cam/booleans'
import { runAnyJob } from '../cam/camJob'
import { areaOf } from '../cam/offset'
import { imagePaths, testGridPaths } from '../cam/laserImage'
import { buildHeightMap, carveTool } from '../cam/simulation'
import { createShape } from '../cam/types'
import { RenderLoop } from '../components/renderLoop'
import { BITS } from '../data/bits'
import { MACHINES } from '../data/machines'
import { MATERIALS } from '../data/materials'
import { autoParams } from '../data/params'
import { describeGrblCode } from '../grbl/codes'
import { probeGrid } from '../grbl/level'
import type { GrblClient } from '../grbl/GrblClient'
import { setCoreLanguage } from '../i18nCore'

const params = { rpm: 12000, feed: 600, plunge: 200, doc: 1, stepover: 1, safeZ: 5 }
const square = (x: number, y: number, s: number) => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
]

describe('booleens', () => {
  it('union, soustraction, intersection de deux carres', () => {
    const a = [square(0, 0, 10)]
    const b = [square(5, 0, 10)]
    const area = (loops: ReturnType<typeof combineLoops>) => loops.reduce((s, l) => s + Math.abs(areaOf(l)), 0)
    expect(area(combineLoops(a, b, 'union'))).toBeCloseTo(150)
    expect(area(combineLoops(a, b, 'subtract'))).toBeCloseTo(50)
    expect(area(combineLoops(a, b, 'intersect'))).toBeCloseTo(50)
  })
})

describe('alignement / repartition', () => {
  const shapes = [
    { ...createShape('rect', 1), id: 'a', x: 10, y: 10, width: 10, height: 10 },
    { ...createShape('rect', 2), id: 'b', x: 50, y: 30, width: 20, height: 10 },
    { ...createShape('rect', 3), id: 'c', x: 100, y: 20, width: 10, height: 10 },
  ]
  it('aligne a gauche et repartit en X', () => {
    const left = alignShapes(shapes, ['a', 'b', 'c'], 'left')
    const lefts = left.map((s) => s.x - s.width / 2)
    expect(new Set(lefts.map((v) => v.toFixed(3))).size).toBe(1)
    // Ecarts egaux entre les formes ; la premiere et la derniere ne bougent pas.
    const spread = distributeShapes(shapes, ['a', 'b', 'c'], 'horizontal')
    expect(spread.find((s) => s.id === 'b')!.x).toBeCloseTo(55)
    expect(spread.find((s) => s.id === 'a')!.x).toBeCloseTo(10)
    expect(spread.find((s) => s.id === 'c')!.x).toBeCloseTo(100)
  })
})

describe('parametres de coupe automatiques', () => {
  it('bornes par la machine (vitesse, avance) et la fraise (passe)', () => {
    const machine = MACHINES[0]
    for (const material of MATERIALS) {
      for (const bit of BITS) {
        const p = autoParams(machine, material, bit)
        expect(p.rpm).toBeGreaterThanOrEqual(machine.spindle.minRpm)
        expect(p.rpm).toBeLessThanOrEqual(machine.spindle.maxRpm)
        expect(p.feed).toBeLessThanOrEqual(machine.maxFeed)
        expect(p.plunge).toBeLessThanOrEqual(machine.maxFeedZ)
        if (bit.docMax) expect(p.doc).toBeLessThanOrEqual(Math.max(bit.docMax, 0.05))
        expect(p.doc).toBeGreaterThan(0)
        expect(p.stepover).toBeGreaterThan(0)
      }
    }
  })
})

describe('codes GRBL expliques', () => {
  it('FR / EN, code inconnu laisse tel quel', () => {
    expect(describeGrblCode('error:9')).toMatch(/verrouille/)
    setCoreLanguage('en')
    expect(describeGrblCode('ALARM:2')).toMatch(/Soft limit/)
    setCoreLanguage('fr')
    expect(describeGrblCode('error:999')).toBe('error:999')
    expect(describeGrblCode('ok')).toBe('ok')
  })
})

describe('simulation 3D (heightmap)', () => {
  const map = () => buildHeightMap({ min: { x: 0, y: 0 }, max: { x: 20, y: 20 } }, 10, 0.5)
  const at = (m: ReturnType<typeof map>, x: number, y: number) => m.heights[Math.round(y / m.dy) * m.gx + Math.round(x / m.dx)]

  it('fraise droite, sphérique, V : profils differents', () => {
    const flat = map()
    carveTool(flat, 10, 10, -2, { kind: 'flat', radius: 2 })
    expect(at(flat, 10, 10)).toBe(-2)
    expect(at(flat, 11.5, 10)).toBe(-2)
    expect(at(flat, 13, 10)).toBe(0)

    const ball = map()
    carveTool(ball, 10, 10, -2, { kind: 'ball', radius: 2 })
    expect(at(ball, 10, 10)).toBeCloseTo(-2)
    expect(at(ball, 11.5, 10)).toBeGreaterThan(-2)

    const vbit = map()
    carveTool(vbit, 10, 10, -2, { kind: 'vbit', radius: 0.1, tanHalf: 1 })
    expect(at(vbit, 10, 10)).toBeCloseTo(-2)
    expect(at(vbit, 11, 10)).toBeCloseTo(-2 + 0.9, 1)
  })

  it('ne creuse jamais au-dessus de la surface', () => {
    const m = map()
    carveTool(m, 10, 10, 1, { kind: 'flat', radius: 2 })
    expect(Math.min(...m.heights)).toBe(0)
  })
})

describe('laser : image et grille de test', () => {
  const image = { id: 'i', name: 'i', src: '', x: 10, y: 10, width: 4, pixelSize: 1, minPower: 0, maxPower: 1000, invert: false, cols: 4, rows: 2, data: Uint8Array.from([0, 255, 128, 0, 255, 255, 255, 255]) }

  it('image : une ligne par rangee non vide, puissance par point', () => {
    const paths = imagePaths(image, { mode: 'grayscale', threshold: 128, overscan: 0 })
    expect(paths.length).toBeGreaterThan(0)
    const powers = paths.flatMap((p) => p.points.map((q) => q.s ?? 0))
    expect(Math.max(...powers)).toBeLessThanOrEqual(1000)
  })

  it('grille de test : une case par puissance', () => {
    const paths = testGridPaths({ originX: 0, originY: 0, cell: 5, gap: 1, cols: 3, rows: 2, minPower: 100, maxPower: 600, hatchStep: 1 })
    const powers = new Set(paths.map((p) => p.power ?? p.points[0].s))
    expect(powers.size).toBe(6)
  })

  it('job laser complet (G-code M4, S)', async () => {
    const laser = { power: 800, fillStepover: 0.2, passes: 1, mode: 'M4' as const, framingPower: 10, overscan: 0, imageMode: 'grayscale' as const, threshold: 128, focusZ: 0, spotWidth: 0 }
    const out = await runAnyJob({
      kind: 'laser',
      shapes: [{ ...createShape('rect', 1), op: 'laser_contour' as const }],
      params,
      laser,
      images: [],
      gcode: { safeZ: 5, feed: 1500, plunge: 300, rpm: 0, spindleMode: 'grbl', laser: { mode: 'M4', power: 800 } },
    })
    expect(out.gcode).toContain('M4 S0')
    expect(out.gcode).toMatch(/G1 .*S800/)
  })

  it('job relief complet', async () => {
    const out = await runAnyJob({
      kind: 'relief',
      images: [{ ...image }],
      options: { maxDepth: 2, invert: false, direction: 'x', roughing: true, allowance: 0.2, depthPerPass: 1, roughStepover: 1 },
      gcode: { safeZ: 5, feed: 600, plunge: 200, rpm: 12000, spindleMode: 'grbl' },
    })
    expect(out.result.paths.length).toBeGreaterThan(0)
    expect(out.gcode).toContain('M3 S12000')
  })
})

describe('palpage en grille (nivellement)', () => {
  it('serpentin, double approche, hauteurs rangees par point', async () => {
    const sent: string[] = []
    let x = 0
    let y = 0
    const client = {
      lastProbe: null as null | { pos: { x: number; y: number; z: number }; ok: boolean },
      clearLastProbe() {
        client.lastProbe = null
      },
      async send(line: string) {
        sent.push(line)
        const mx = /G0 X(-?[\d.]+) Y(-?[\d.]+)/.exec(line)
        if (mx) {
          x = Number(mx[1])
          y = Number(mx[2])
        }
        // Surface inclinee : z = -10 + x/100.
        if (line.startsWith('G38.2')) client.lastProbe = { pos: { x, y, z: -10 + x / 100 }, ok: true }
      },
    }
    const heights = await probeGrid(client as unknown as GrblClient, { min: { x: 0, y: 0 }, max: { x: 100, y: 50 } }, 3, 2, { safeZ: 5, retract: 3, fast: 150, slow: 25, maxDepth: 8 })
    expect(heights).toEqual([-10, -9.5, -9, -10, -9.5, -9])
    // 2 palpages par point (rapide + lent).
    expect(sent.filter((l) => l.startsWith('G38.2')).length).toBe(12)
    // Serpentin : la 2e rangee commence a droite.
    const moves = sent.filter((l) => /^G0 X/.test(l))
    expect(moves[3]).toBe('G0 X100.000 Y50.000')
  })
})

describe('boucle de rendu a la demande', () => {
  it('ne dessine que sur demande et tant que l\'animation continue', async () => {
    const frames: Array<(t: number) => void> = []
    ;(globalThis as unknown as { requestAnimationFrame: (cb: (t: number) => void) => number }).requestAnimationFrame = (cb) => frames.push(cb)
    ;(globalThis as unknown as { cancelAnimationFrame: () => void }).cancelAnimationFrame = () => undefined
    let calls = 0
    let busyFrames = 2
    const loop = new RenderLoop(() => {
      calls++
      return busyFrames-- > 0
    })
    expect(frames.length).toBe(0)
    loop.invalidate()
    let t = 0
    while (frames.length) frames.shift()!((t += 16))
    expect(calls).toBe(3) // 1 demande + 2 images d'animation
    loop.dispose()
  })
})
