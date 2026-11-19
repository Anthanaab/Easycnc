import { describe, expect, it } from 'vitest'
import type { GrblClient } from '../grbl/GrblClient'
import { probeCorner, probeZ, type Corner } from '../grbl/probe'

function fakeClient(contact = true) {
  const sent: string[] = []
  const client = {
    lastProbe: null as null | { pos: { x: number; y: number; z: number }; ok: boolean },
    clearLastProbe() {
      client.lastProbe = null
    },
    async send(line: string) {
      sent.push(line)
      if (line.startsWith('G38.2')) {
        if (!contact) throw new Error('ALARM:5')
        client.lastProbe = { pos: { x: 0, y: 0, z: 0 }, ok: true }
      }
    },
  }
  return { client: client as unknown as GrblClient, sent }
}

const probe = { plate: 10, feed: 25, fast: 150, maxDepth: 40, retract: 3, xyWall: 4, xyTravel: 15 }
const noop = () => undefined

describe('palpage Z', () => {
  it('Z0 = epaisseur de plaque dans le repere actif (P0)', async () => {
    const { client, sent } = fakeClient()
    await probeZ(client, probe, noop)
    expect(sent).toContain('G10 L20 P0 Z10.000')
    expect(sent[sent.length - 1]).toBe('G90')
  })

  it('parametres invalides refuses', async () => {
    const { client } = fakeClient()
    await expect(probeZ(client, { ...probe, fast: 0 }, noop)).rejects.toThrow()
  })
})

describe('palpage de coin XYZ', () => {
  const cases: Array<[Corner, string, string, string, string]> = [
    ['front-left', 'G0 X-15.000', 'G38.2 X20.000 F150', 'G10 L20 P0 X-7.000', 'G10 L20 P0 Y-7.000'],
    ['front-right', 'G0 X15.000', 'G38.2 X-20.000 F150', 'G10 L20 P0 X7.000', 'G10 L20 P0 Y-7.000'],
    ['back-left', 'G0 X-15.000', 'G38.2 X20.000 F150', 'G10 L20 P0 X-7.000', 'G10 L20 P0 Y7.000'],
    ['back-right', 'G0 X15.000', 'G38.2 X-20.000 F150', 'G10 L20 P0 X7.000', 'G10 L20 P0 Y7.000'],
  ]
  for (const [corner, outX, probeX, setX, setY] of cases) {
    it(`${corner} : sortie, palpage vers la piece, origine = paroi + rayon`, async () => {
      const { client, sent } = fakeClient()
      await probeCorner(client, probe, { corner, toolDiameter: 6 }, noop)
      expect(sent).toContain('G10 L20 P0 Z10.000')
      const iOut = sent.indexOf(outX)
      expect(iOut).toBeGreaterThan(sent.indexOf('G10 L20 P0 Z10.000'))
      // Descente a mi-hauteur de plaque (Z abs = 10/2) : -(3 + 5) en relatif.
      expect(sent[iOut + 1]).toBe('G0 Z-8.000')
      expect(sent[iOut + 2]).toBe(probeX)
      expect(sent).toContain(setX)
      expect(sent).toContain(setY)
      expect(sent.indexOf(setX)).toBeLessThan(sent.indexOf(setY))
      expect(sent[sent.length - 1]).toBe('G90')
    })
  }

  it('remonte au-dessus de la plaque avant tout deplacement horizontal vers la piece', async () => {
    const { client, sent } = fakeClient()
    await probeCorner(client, probe, { corner: 'front-left', toolDiameter: 6 }, noop)
    const setX = sent.indexOf('G10 L20 P0 X-7.000')
    expect(sent.slice(setX + 1, setX + 3)).toEqual(['G0 X-2.000', 'G0 Z8.000'])
    expect(sent[setX + 4]).toBe('G0 X5.000')
  })

  it('sans contact : erreur, et retour en G90', async () => {
    const { client, sent } = fakeClient(false)
    await expect(probeCorner(client, probe, { corner: 'front-left', toolDiameter: 6 }, noop)).rejects.toThrow('ALARM:5')
    expect(sent[sent.length - 1]).toBe('G90')
  })

  it('refuse un degagement hors limites', async () => {
    const { client } = fakeClient()
    await expect(probeCorner(client, { ...probe, xyTravel: 200 }, { corner: 'front-left', toolDiameter: 6 }, noop)).rejects.toThrow()
  })
})

import { measureTool, toolLengthOffset } from '../grbl/probe'

describe("mesure d'outil sur capteur fixe", () => {
  const settings = { ...probe, toolsetterX: -280, toolsetterY: -10, toolsetterDepth: 40 }

  it('monte en haut de course AVANT de bouger en XY, palpe, remonte', async () => {
    const { client, sent } = fakeClient()
    ;(client as unknown as { send: (l: string) => Promise<void> }).send = (async (line: string) => {
      sent.push(line)
      if (line.startsWith('G38.2')) (client as unknown as { lastProbe: unknown }).lastProbe = { pos: { x: -280, y: -10, z: -31.5 }, ok: true }
    }) as never
    const z = await measureTool(client, settings, { homed: true, topZ: -1 }, noop)
    expect(z).toBe(-31.5)
    const up = sent.indexOf('G53 G0 Z-1.000')
    const xy = sent.indexOf('G53 G0 X-280.000 Y-10.000')
    expect(up).toBeGreaterThanOrEqual(0)
    expect(xy).toBeGreaterThan(up)
    expect(sent.slice(xy + 1)).toContain('G38.2 Z-40.000 F150')
    expect(sent[sent.length - 1]).toBe('G53 G0 Z-1.000')
  })

  it('refuse sans homing ou sans position de capteur', async () => {
    const { client } = fakeClient()
    await expect(measureTool(client, settings, { homed: false, topZ: -1 }, noop)).rejects.toThrow(/referencee/)
    await expect(measureTool(client, probe, { homed: true, topZ: -1 }, noop)).rejects.toThrow(/capteur/)
  })

  it('outil plus long : contact plus haut, correction positive', () => {
    expect(toolLengthOffset(-31.5, -29.0)).toBeCloseTo(2.5)
    expect(toolLengthOffset(-31.5, -33.0)).toBeCloseTo(-1.5)
  })
})

import { probeBossCenter, probeEdge, probeHoleCenter } from '../grbl/probe'

/**
 * Machine geometrique : suit la position (G90/G91, G53), et pour G38.2 calcule
 * le contact reel de l'outil (rayon r) avec la forme `touches(axis, dir, pos)`.
 */
function geoClient(contactAt: (axis: 'X' | 'Y', dir: number, pos: { x: number; y: number; z: number }) => number | null, start = { x: -100, y: -50, z: -10 }) {
  const pos = { ...start }
  let relative = false
  const sent: string[] = []
  const client = {
    lastProbe: null as null | { pos: { x: number; y: number; z: number }; ok: boolean },
    clearLastProbe() {
      client.lastProbe = null
    },
    waitForStatus: async () => ({ state: 'Idle', mpos: { ...pos }, timestamp: Date.now(), raw: '' }),
    async send(line: string) {
      sent.push(line)
      if (/^G91/.test(line)) relative = true
      if (/^G90/.test(line)) relative = false
      const machine = /G53/.test(line)
      const words = Object.fromEntries([...line.matchAll(/([XYZ])(-?[\d.]+)/g)].map((m) => [m[1], Number(m[2])])) as Record<'X' | 'Y' | 'Z', number>
      if (/^G38\.2/.test(line)) {
        const axis = 'X' in words ? 'X' : 'Y'
        const key = axis === 'X' ? 'x' : 'y'
        const dir = Math.sign(words[axis])
        const limit = pos[key] + words[axis]
        const hit = contactAt(axis, dir, pos)
        if (hit === null || (dir > 0 ? hit > limit : hit < limit)) throw new Error('ALARM:5')
        pos[key] = hit
        client.lastProbe = { pos: { ...pos }, ok: true }
        return
      }
      if (!/^G[01]|^G53/.test(line)) return
      for (const axis of ['X', 'Y', 'Z'] as const) {
        if (!(axis in words)) continue
        const key = axis.toLowerCase() as 'x' | 'y' | 'z'
        pos[key] = relative && !machine ? pos[key] + words[axis] : words[axis]
      }
    },
  }
  return { client: client as unknown as GrblClient, sent, pos }
}

describe('autres palpages', () => {
  const tool = 3
  const r = tool / 2

  it('centre de trou : trouve le vrai centre et le diametre, meme demarre decentre', async () => {
    const c = { x: -100, y: -50 }
    const R = 10
    // Contact sur la paroi interieure : le centre de l'outil est a R - r du centre du trou.
    const contact = (axis: 'X' | 'Y', dir: number, p: { x: number; y: number }) => {
      const other = axis === 'X' ? p.y - c.y : p.x - c.x
      const half = Math.sqrt(Math.max(0, (R - r) ** 2 - other ** 2))
      return (axis === 'X' ? c.x : c.y) + dir * half
    }
    const { client, sent } = geoClient(contact, { x: c.x + 3, y: c.y - 2, z: -10 })
    const result = await probeHoleCenter(client, probe, { approxDiameter: 20, toolDiameter: tool }, noop)
    expect(result.x).toBeCloseTo(c.x, 3)
    expect(result.y).toBeCloseTo(c.y, 3)
    expect(result.sizeX).toBeCloseTo(2 * R, 3)
    expect(sent).toContain('G10 L20 P0 X0 Y0')
  })

  it('centre de tenon : sort, descend, palpe vers le centre, remonte avant de revenir', async () => {
    const c = { x: -120, y: -60 }
    const half = { X: 15, Y: 10 }
    const contact = (axis: 'X' | 'Y', dir: number) => (axis === 'X' ? c.x : c.y) - dir * (half[axis] + r)
    const { client, sent } = geoClient((axis, dir) => contact(axis, dir), { x: c.x + 2, y: c.y + 1, z: -5 })
    const result = await probeBossCenter(client, probe, { approxSize: 30, depth: 4, toolDiameter: tool }, noop)
    expect(result.x).toBeCloseTo(c.x, 3)
    expect(result.y).toBeCloseTo(c.y, 3)
    expect(result.sizeX).toBeCloseTo(30, 3)
    expect(result.sizeY).toBeCloseTo(20, 3)
    // Jamais de deplacement absolu (G53) sans etre remonte juste avant.
    sent.forEach((line, i) => {
      if (line.startsWith('G53 G0')) expect(sent.slice(Math.max(0, i - 3), i).some((l) => l === 'G0 Z4.000' || l.startsWith('G0 X') || l.startsWith('G0 Y'))).toBe(true)
    })
  })

  it('bord X+ : origine X sur le bord (rayon + paroi)', async () => {
    const edge = -80
    const { client, sent } = geoClient((axis, dir) => (axis === 'X' && dir > 0 ? edge - r : null), { x: -90, y: -50, z: -12 })
    await probeEdge(client, { ...probe, xyWall: 0 }, { direction: 'X+', toolDiameter: tool, travel: 20 }, noop)
    expect(sent).toContain('G10 L20 P0 X-1.500')
  })

  it('sans contact : erreur et retour en G90', async () => {
    const { client, sent } = geoClient(() => null)
    await expect(probeEdge(client, probe, { direction: 'Y-', toolDiameter: tool, travel: 10 }, noop)).rejects.toThrow()
    expect(sent[sent.length - 1]).toBe('G90')
  })
})
