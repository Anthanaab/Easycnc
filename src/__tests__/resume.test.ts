import { describe, expect, it } from 'vitest'
import { resumeProgram } from '../gcode/resume'

const program = ['G21', 'G90', 'G0 Z5', 'M3 S12000', 'G4 P3', 'G0 X10 Y10', 'G1 Z-1 F200', 'G1 X20 F600', 'X30', 'G1 Y20']

describe('resumeProgram', () => {
  it('rejoue l\'etat modal et se replace au point de reprise', () => {
    const plan = resumeProgram(program, 8, { safeZ: 5, plunge: 200 })
    expect(plan.lines.slice(0, plan.preamble)).toEqual([
      'G21 G90 G17 G94 G54',
      'M5',
      'G0 Z5',
      'G0 X20 Y10',
      'M3 S12000',
      'G4 P3',
      'G1 Z-1 F200',
      'G1 F600',
    ])
    expect(plan.lines.slice(plan.preamble)).toEqual(['X30', 'G1 Y20'])
  })

  it('convertit Z securite et plongee en pouces', () => {
    const plan = resumeProgram(['G20', 'G90', 'G0 X1 Y1', 'G1 Z-0.1 F10', 'G1 X2'], 4, { safeZ: 25.4, plunge: 254 })
    expect(plan.lines).toContain('G0 Z1')
    expect(plan.lines).toContain('G1 Z-0.1 F10')
  })

  it('refuse les cas ambigus', () => {
    expect(() => resumeProgram(['G91', 'G1 X1', 'G1 X1'], 2, { safeZ: 5, plunge: 100 })).toThrow(/relatif/)
    expect(() => resumeProgram(['G92 X0', 'G1 X1', 'G1 X2'], 2, { safeZ: 5, plunge: 100 })).toThrow(/G92/)
    expect(() => resumeProgram(['G0 X0 Y0', 'G2 X10 Y0 I5 J0 F100', 'X0 Y0 I-5 J0'], 2, { safeZ: 5, plunge: 100 })).toThrow(/arc/)
    expect(() => resumeProgram(program, 0, { safeZ: 5, plunge: 100 })).toThrow(/invalide/)
  })

  it('n\'interprete pas G10 comme une position', () => {
    const plan = resumeProgram(['G0 X5 Y5', 'G10 L20 P0 X0 Y0', 'G1 X6 F100'], 2, { safeZ: 5, plunge: 100 })
    expect(plan.lines).toContain('G0 X5 Y5')
  })
})
