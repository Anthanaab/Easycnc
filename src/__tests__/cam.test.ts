import { describe, expect, it } from 'vitest'
import { toolpathToGcode } from '../cam/gcode'
import { applyTabs, generateToolpath, rampPath, zLevels, type CamResult } from '../cam/toolpath'
import { createShape } from '../cam/types'

const params = { rpm: 12000, feed: 600, plunge: 200, doc: 1, stepover: 1, safeZ: 5 }
const tabs = { enabled: true, width: 4, height: 1, spacing: 30 }

describe('zLevels', () => {
  it('decoupe la profondeur en passes', () => {
    expect(zLevels(3, 1)).toEqual([-1, -2, -3])
    expect(zLevels(2.5, 1)).toEqual([-1, -2, -2.5])
  })

  it('reste sur des valeurs invalides', () => {
    expect(zLevels(0, 1)).toEqual([])
    expect(zLevels(2, Number.NaN)).toEqual([-2])
  })
})

describe('tenons', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 40 },
    { x: 0, y: 40 },
  ]

  it('rehausse la passe finale au niveau des tenons', () => {
    const path = applyTabs(square, -6, -5, tabs)
    const zs = path.points.map((p) => p.z ?? path.z)
    expect(Math.max(...zs)).toBe(-5)
    expect(Math.min(...zs)).toBe(-6)
  })

  it('ne creuse jamais plus profond que la passe', () => {
    const path = applyTabs(square, -2, -5, tabs)
    expect(path.points.every((p) => (p.z ?? path.z) >= -2)).toBe(true)
  })

  it('contour exterieur : tenons sur la derniere passe seulement', () => {
    const shape = { ...createShape('rect', 1), depth: 3, op: 'contour_out' as const }
    const result = generateToolpath([shape], params, 3, { tabs })
    const minZ = Math.min(...result.paths.flatMap((p) => p.points.map((pt) => pt.z ?? p.z)))
    expect(minZ).toBe(-3)
    const last = result.paths[result.paths.length - 1]
    expect(last.points.some((pt) => pt.z === -2)).toBe(true)
  })

  it('pas de tenons dans une poche', () => {
    const shape = { ...createShape('rect', 1), depth: 3, op: 'pocket' as const }
    const result = generateToolpath([shape], params, 3, { tabs })
    expect(result.paths.every((p) => p.points.every((pt) => pt.z === undefined))).toBe(true)
  })
})

describe('rampe', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]

  it('descend sur le parcours sans en sortir', () => {
    const path = rampPath(square, -1, -2, 15)
    expect(path.points[0]).toEqual({ x: 0, y: 0, z: -1 })
    for (const p of path.points) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(10)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(10)
      expect(p.z!).toBeLessThanOrEqual(-1)
      expect(p.z!).toBeGreaterThanOrEqual(-2)
    }
    // Fin de rampe a 15 mm : (10, 5), puis tour complet et retour a ce point.
    const end = path.points[path.points.length - 1]
    expect(end).toEqual({ x: 10, y: 5, z: -2 })
    expect(path.points.filter((p) => p.z === -2).length).toBeGreaterThanOrEqual(5)
  })

  it('profondeurs monotones par forme', () => {
    const shape = { ...createShape('circle', 1), depth: 2, op: 'contour_out' as const }
    const result = generateToolpath([shape], params, 3, { entry: 'ramp' })
    const starts = result.paths.map((p) => p.points[0].z)
    expect(starts).toEqual([0, -1])
  })
})

describe('surfacage', () => {
  it('passe avant les autres operations, meme optimise', () => {
    const shape = { ...createShape('rect', 1), depth: 2, op: 'contour_out' as const }
    const result = generateToolpath([shape], params, 3, {
      optimize: true,
      surfacing: { enabled: true, depth: 0.5, stepover: 2, margin: 2 },
    })
    expect(result.paths[0].z).toBe(-0.5)
    const firstShape = result.paths.findIndex((p) => p.z !== -0.5)
    expect(result.paths.slice(firstShape).every((p) => p.z !== -0.5)).toBe(true)
  })
})

describe('post-processeur fraisage', () => {
  const result = (paths: CamResult['paths']): CamResult => ({ paths, warnings: [], bounds: null, moveCount: 0, cutLength: 0 })
  const options = { safeZ: 5, feed: 600, plunge: 200, rpm: 12000, spindleMode: 'grbl' as const, arcs: true }

  it('attend la mise en vitesse de la broche avant de plonger', () => {
    const lines = toolpathToGcode(result([{ points: [{ x: 1, y: 1 }], closed: false, z: -1 }]), options).split('\n')
    const m3 = lines.findIndex((l) => l.startsWith('M3'))
    expect(lines[m3 + 1]).toMatch(/^G4 P\d/)
    expect(lines.findIndex((l) => l.startsWith('G1 Z'))).toBeGreaterThan(m3 + 1)
  })

  it('ne remplace pas un cercle en rampe par un arc plat', () => {
    const circle = Array.from({ length: 36 }, (_, i) => ({
      x: 10 * Math.cos((i / 36) * 2 * Math.PI),
      y: 10 * Math.sin((i / 36) * 2 * Math.PI),
      z: i < 6 ? -i / 6 : -1,
    }))
    const gcode = toolpathToGcode(result([{ points: circle, closed: true, z: -1 }]), options)
    expect(gcode).not.toMatch(/G[23] /)
  })

  it('utilise un arc pour un cercle a Z constant', () => {
    const circle = Array.from({ length: 36 }, (_, i) => ({
      x: 10 * Math.cos((i / 36) * 2 * Math.PI),
      y: 10 * Math.sin((i / 36) * 2 * Math.PI),
    }))
    const gcode = toolpathToGcode(result([{ points: circle, closed: true, z: -1 }]), options)
    expect(gcode).toMatch(/G[23] /)
  })

  it('changement d\'outil : M5, M0 avec message, puis broche relancee', () => {
    const paths = [
      { points: [{ x: 0, y: 0 }], closed: false, z: -1, toolId: 'a' },
      { points: [{ x: 5, y: 5 }], closed: false, z: -1, toolId: 'b' },
    ]
    const lines = toolpathToGcode(result(paths), { ...options, toolChange: { names: { b: 'Fraise B' } } }).split('\n')
    const m0 = lines.findIndex((l) => l.startsWith('M0 '))
    expect(lines[m0]).toContain('Fraise B')
    expect(lines.slice(0, m0).reverse().find((l) => /^M[35]/.test(l))).toBe('M5')
    expect(lines[m0 + 1]).toMatch(/^M3/)
  })
})
