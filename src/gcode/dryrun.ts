const SPINDLE_WORDS = /\bM0?[34578]\b/gi
const SPINDLE_SPEED = /\bS\d+(?:\.\d+)?/gi
const Z_WORD = /Z([+-]?(?:\d+\.?\d*|\.\d+))/i

/**
 * Prepare un G-code pour un essai a blanc: broche coupee et tous les
 * mouvements Z absolus remontes de safeZ (l'outil passe au-dessus de la piece).
 */
export function raiseZ(lines: string[], safeZ: number): string[] {
  let absolute = true
  const out: string[] = []

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    const gCodes = [...line.matchAll(/G(\d+(?:\.\d+)?)/gi)].map((m) => Number(m[1]))
    for (const code of gCodes) {
      if (code === 90) absolute = true
      else if (code === 91) absolute = false
    }

    let cleaned = line.replace(SPINDLE_WORDS, '').replace(SPINDLE_SPEED, '').replace(/\s+/g, ' ').trim()

    if (absolute) {
      cleaned = cleaned.replace(Z_WORD, (_match, value: string) => `Z${(Number(value) + safeZ).toFixed(3)}`)
    }

    if (cleaned) out.push(cleaned)
  }

  return out
}
