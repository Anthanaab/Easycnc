import { describe, expect, it } from 'vitest'
import { raiseZ } from '../gcode/dryrun'
import { checkLimits, checkMachineLimits } from '../gcode/estimate'
import { parseGcode } from '../gcode/parser'
import { parsePause, programLines } from '../gcode/streamer'
import { grblLineLength } from '../grbl/GrblClient'
import { parseFeedback, parseStatus } from '../grbl/parser'

describe('programLines', () => {
  it('retire commentaires, numeros de ligne et checksums', () => {
    expect(programLines('N10 G0 X1 (rapide) ; fin\n%\n\nN20 G1 Y2*45\n')).toEqual(['G0 X1', 'G1 Y2'])
  })

  it('garde le message des pauses M0', () => {
    expect(programLines("M5\nM0 (Changer l'outil : V 60)\nM3 S1000")).toEqual(['M5', "M0 (Changer l'outil : V 60)", 'M3 S1000'])
  })
})

describe('parsePause', () => {
  it('detecte M0 / M00 et extrait le reste et le message', () => {
    expect(parsePause('M0 (Changer outil)')).toEqual({ rest: '', message: 'Changer outil' })
    expect(parsePause('S12000 M00')).toEqual({ rest: 'S12000', message: '' })
  })

  it('ne confond pas M30, M01, M3', () => {
    expect(parsePause('M30')).toBeNull()
    expect(parsePause('M01')).toBeNull()
    expect(parsePause('M3 S1000')).toBeNull()
    expect(parsePause('G0 X10 (M0 dans un commentaire)')).toBeNull()
  })
})

describe('raiseZ (essai a blanc)', () => {
  it('rehausse les Z absolus et coupe la broche', () => {
    expect(raiseZ(['G90', 'M3 S12000', 'G0 Z5', 'G1 Z-2 F100', 'M5'], 10)).toEqual(['G90', 'G0 Z15.000', 'G1 Z8.000 F100'])
  })

  it('ne touche pas les Z relatifs', () => {
    expect(raiseZ(['G91', 'G1 Z-1'], 10)).toEqual(['G91', 'G1 Z-1'])
  })

  it('ne touche pas G10/G92/G53/G28/G38', () => {
    const lines = ['G10 L20 P1 Z0', 'G92 Z0', 'G53 G0 Z-1', 'G28 Z0', 'G38.2 Z-10 F50']
    expect(raiseZ(lines, 10)).toEqual(lines)
  })

  it('convertit le rehaussement en pouces (G20)', () => {
    expect(raiseZ(['G20', 'G0 Z0'], 25.4)).toEqual(['G20', 'G0 Z1.0000'])
  })

  it('ne lit pas les Z dans les commentaires', () => {
    expect(raiseZ(['M0 (Re-palper Z0)'], 10)).toEqual(['M0 (Re-palper Z0)'])
  })
})

describe('parseGcode', () => {
  it('calcule l\'emprise', () => {
    const tp = parseGcode('G21 G90\nG0 Z5\nG0 X10 Y10\nG1 Z-1 F100\nG1 X20\n')
    expect(tp.bounds.min).toEqual({ x: 0, y: 0, z: -1 })
    expect(tp.bounds.max).toEqual({ x: 20, y: 10, z: 5 })
  })

  it('ignore les mots d\'axe de G10 / G53 / G28 dans l\'emprise', () => {
    const tp = parseGcode('G0 X5\nG10 L20 P1 X100 Y100 Z100\nG53 G0 Z-200\nG28 X300\nG1 X6 F100\n')
    expect(tp.bounds.max.x).toBe(6)
    expect(tp.bounds.min.z).toBe(0)
  })

  it('gere les pouces et le relatif', () => {
    const tp = parseGcode('G20 G91\nG1 X1 F10\nG1 X1\n')
    expect(tp.bounds.max.x).toBeCloseTo(50.8)
  })
})

describe('checkMachineLimits', () => {
  const travel = { x: 300, y: 180, z: 45 }
  const bounds = { min: { x: 0, y: 0, z: -3 }, max: { x: 100, y: 50, z: 5 } }

  it('accepte un job dans la course (espace negatif GRBL)', () => {
    const wco = { x: -250, y: -150, z: -30 }
    expect(checkMachineLimits(bounds, wco, { x: -200, y: -100, z: -10 }, travel).ok).toBe(true)
  })

  it('refuse un Z de securite qui depasse le haut de la course', () => {
    const wco = { x: -250, y: -150, z: -3 }
    const check = checkMachineLimits(bounds, wco, { x: -200, y: -100, z: -1 }, travel)
    expect(check.ok).toBe(false)
    expect(check.messages[0]).toMatch(/^Z/)
  })

  it('refuse un X qui sort de la course', () => {
    const wco = { x: -50, y: -150, z: -30 }
    expect(checkMachineLimits(bounds, wco, { x: -10, y: -100, z: -10 }, travel).ok).toBe(false)
  })

  it('accepte l\'espace positif quand la position le montre', () => {
    const wco = { x: 10, y: 10, z: 30 }
    const positiveBounds = { min: { x: 0, y: 0, z: -3 }, max: { x: 100, y: 50, z: 5 } }
    expect(checkMachineLimits(positiveBounds, wco, { x: 20, y: 20, z: 40 }, travel).ok).toBe(true)
  })
})

describe('checkLimits', () => {
  it('refuse un job plus grand que la machine', () => {
    const check = checkLimits({ min: { x: 0, y: 0, z: -1 }, max: { x: 400, y: 10, z: 5 } }, { x: 300, y: 180, z: 45 })
    expect(check.ok).toBe(false)
  })
})

describe('protocole GRBL', () => {
  it('longueur effective sans espaces ni commentaires', () => {
    expect(grblLineLength('G1 X10 Y20 (commentaire long)')).toBe(8)
  })

  it('parse un rapport d\'etat', () => {
    const status = parseStatus('<Hold:0|MPos:-1.000,-2.000,-3.000|FS:0,0|WCO:-10.000,-20.000,-30.000>')
    expect(status?.state).toBe('Hold')
    expect(status?.subState).toBe('0')
    expect(status?.mpos).toEqual({ x: -1, y: -2, z: -3 })
    expect(status?.wco).toEqual({ x: -10, y: -20, z: -30 })
  })

  it('parse un resultat de palpage', () => {
    expect(parseFeedback('[PRB:-1.000,-2.000,-15.250:1]')).toEqual({ kind: 'probe', x: -1, y: -2, z: -15.25, ok: true })
    expect(parseFeedback('[PRB:0.000,0.000,0.000:0]')).toMatchObject({ ok: false })
  })
})
