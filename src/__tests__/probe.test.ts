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
