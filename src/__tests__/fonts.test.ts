import { describe, expect, it } from 'vitest'
import { fontsReady, loadFonts, onFontsReady, textLoops } from '../cam/text'

describe('polices chargees a la demande', () => {
  it('texte vide avant chargement, contours apres, avec notification', async () => {
    expect(fontsReady()).toBe(false)
    let notified = false
    onFontsReady(() => {
      notified = true
    })
    expect(textLoops('A', 'roboto700', 10)).toEqual([])
    await loadFonts()
    expect(fontsReady()).toBe(true)
    expect(notified).toBe(true)
    expect(textLoops('A', 'roboto700', 10).length).toBeGreaterThan(0)
  })
})
