import { afterEach, describe, expect, it } from 'vitest'
import { checkLimits } from '../gcode/estimate'
import { resumeProgram } from '../gcode/resume'
import { setCoreLanguage } from '../i18nCore'

afterEach(() => setCoreLanguage('fr'))

describe('messages traduits (noyau i18n, aussi dans le worker)', () => {
  const bounds = { min: { x: -2, y: 0, z: -1 }, max: { x: 400, y: 10, z: 5 } }
  const area = { x: 300, y: 180, z: 45 }

  it('francais par defaut, anglais sur demande, parametres remplaces', () => {
    expect(checkLimits(bounds, area).messages[0]).toBe('Largeur 402.0 mm > course X 300 mm')
    setCoreLanguage('en')
    expect(checkLimits(bounds, area).messages[0]).toBe('Width 402.0 mm > X travel 300 mm')
    expect(() => resumeProgram(['G91', 'G1 X1', 'G1 X1'], 2, { safeZ: 5, plunge: 100 })).toThrow('Cannot resume: relative mode (G91) before line 3')
  })

  it("controle de taille seul (sans les controles de position)", () => {
    const check = checkLimits(bounds, area, { sizeOnly: true })
    expect(check.messages).toHaveLength(1)
  })
})
