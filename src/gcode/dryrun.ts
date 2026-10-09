import { splitComment } from './streamer'

const SPINDLE_WORDS = /\bM0*[34578](?![0-9.])/gi
const SPINDLE_SPEED = /\bS\s*[+-]?(?:\d+\.?\d*|\.\d+)/gi
const Z_WORD = /Z\s*([+-]?(?:\d+\.?\d*|\.\d+))/i
// Lignes dont le Z n'est pas une position de travail a rehausser :
// G10/G92 (definition d'origine), G53 (coordonnees machine), G28/G30
// (retour origine), G38.x (palpage), G4 (tempo).
const NON_WORK_Z = /G0*(?:10|92(?:\.\d)?|53|28(?:\.\d)?|30(?:\.\d)?|38\.\d|4)(?![0-9.])/i

/**
 * Prepare un G-code pour un essai a blanc: broche coupee et tous les
 * mouvements Z absolus remontes de safeZ (l'outil passe au-dessus de la piece).
 */
export function raiseZ(lines: string[], safeZ: number): string[] {
  let absolute = true
  let metric = true
  const out: string[] = []

  for (const raw of lines) {
    const { code, comment } = splitComment(raw.trim())
    if (!code) continue

    const gCodes = [...code.matchAll(/G\s*0*(\d+(?:\.\d+)?)/gi)].map((m) => Number(m[1]))
    for (const value of gCodes) {
      if (value === 90) absolute = true
      else if (value === 91) absolute = false
      else if (value === 20) metric = false
      else if (value === 21) metric = true
    }

    let cleaned = code.replace(SPINDLE_WORDS, '').replace(SPINDLE_SPEED, '').replace(/\s+/g, ' ').trim()

    if (absolute && !NON_WORK_Z.test(cleaned)) {
      // safeZ est en mm : converti si le programme est en pouces (G20).
      const offset = metric ? safeZ : safeZ / 25.4
      cleaned = cleaned.replace(Z_WORD, (_match, value: string) => `Z${(Number(value) + offset).toFixed(metric ? 3 : 4)}`)
    }

    // Le commentaire des pauses M0 est conserve (message de changement d'outil).
    if (cleaned) out.push(comment ? `${cleaned} (${comment})` : cleaned)
  }

  return out
}
