import { parsePause, splitComment } from './streamer'

export interface ResumePlan {
  /** Lignes a envoyer : preambule de reprise puis la suite du programme. */
  lines: string[]
  /** Nombre de lignes du preambule (avant la ligne de reprise). */
  preamble: number
}

const WORD = /([A-Z])\s*([+-]?(?:\d+\.?\d*|\.\d+))/g

function format(value: number): string {
  const fixed = (Math.round(value * 10000) / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
  return fixed === '-0' ? '0' : fixed
}

/**
 * Prepare la reprise d'un programme a la ligne `start` (index 0 dans les
 * lignes du programme, comme le compteur de progression).
 *
 * Rejoue l'etat modal des lignes precedentes (unites, plan, repere, avance,
 * broche, arrosage), monte au Z de securite, se place au-dessus du point de
 * reprise, relance la broche, puis plonge a l'avance de plongee.
 * Refuse les cas ambigus (G91, G92, G53, G28/G30 avant la reprise).
 */
export function resumeProgram(lines: string[], start: number, options: { safeZ: number; plunge: number; spinup?: number }): ResumePlan {
  if (!Number.isInteger(start) || start < 1 || start >= lines.length) {
    throw new Error(`Ligne de reprise invalide (1 a ${lines.length - 1})`)
  }
  let metric = true
  let absolute = true
  let plane = 'G17'
  let wcs = 'G54'
  let feedMode = 'G94'
  let feed: number | null = null
  let motion = 0
  let spindle: 'M3' | 'M4' | 'M5' = 'M5'
  let speed: number | null = null
  const coolant = new Set<string>()
  const pos: Record<'X' | 'Y' | 'Z', number | null> = { X: null, Y: null, Z: null }

  for (let i = 0; i < start; i++) {
    const { code } = splitComment(lines[i])
    const upper = code.toUpperCase()
    if (parsePause(lines[i])) continue
    if (upper.startsWith('$')) continue
    const words = [...upper.matchAll(WORD)].map((m) => ({ letter: m[1], value: Number(m[2]) }))
    let nonModalAxes = false
    for (const { letter, value } of words) {
      if (letter === 'G') {
        if (value === 0 || value === 1 || value === 2 || value === 3) motion = value
        else if (value === 20) metric = false
        else if (value === 21) metric = true
        else if (value === 90) absolute = true
        else if (value === 91) absolute = false
        else if (value === 17 || value === 18 || value === 19) plane = `G${value}`
        else if (value >= 54 && value <= 59 && Number.isInteger(value)) wcs = `G${value}`
        else if (value === 93 || value === 94) feedMode = `G${value}`
        else if (value === 92 || value === 53 || value === 28 || value === 30) {
          throw new Error(`Reprise impossible : G${value} avant la ligne ${start + 1}`)
        } else if (value === 10 || value === 4 || (value >= 38 && value < 39)) nonModalAxes = true
      } else if (letter === 'M') {
        if (value === 3 || value === 4) spindle = value === 3 ? 'M3' : 'M4'
        else if (value === 5 || value === 2 || value === 30) spindle = 'M5'
        if (value === 7 || value === 8) coolant.add(`M${value}`)
        if (value === 9 || value === 2 || value === 30) coolant.clear()
      } else if (letter === 'F') feed = value
      else if (letter === 'S') speed = value
    }
    if (nonModalAxes) continue
    for (const { letter, value } of words) {
      if (letter === 'X' || letter === 'Y' || letter === 'Z') {
        if (!absolute) throw new Error(`Reprise impossible : mode relatif (G91) avant la ligne ${start + 1}`)
        pos[letter] = value
      }
    }
  }
  if (!absolute) throw new Error('Reprise impossible : programme en mode relatif (G91)')
  // Arc modal (G2/G3) sans mot G sur la ligne de reprise : on ne peut pas le rejouer sans axes.
  if ((motion === 2 || motion === 3) && !/G\s*0*[0-3](?![0-9.])/i.test(splitComment(lines[start]).code)) {
    throw new Error(`Reprise impossible au milieu d'un arc modal G${motion} : choisissez une autre ligne`)
  }

  const unit = metric ? 1 : 1 / 25.4
  const out: string[] = []
  out.push(`${metric ? 'G21' : 'G20'} G90 ${plane} ${feedMode} ${wcs}`)
  out.push('M5')
  out.push(`G0 Z${format(options.safeZ * unit)}`)
  if (pos.X !== null || pos.Y !== null) {
    out.push(`G0${pos.X !== null ? ` X${format(pos.X)}` : ''}${pos.Y !== null ? ` Y${format(pos.Y)}` : ''}`)
  }
  if (spindle !== 'M5') {
    out.push(`${spindle}${speed !== null ? ` S${format(speed)}` : ''}`)
    out.push(`G4 P${options.spinup ?? 3}`)
  }
  for (const word of coolant) out.push(word)
  if (pos.Z !== null) out.push(`G1 Z${format(pos.Z)} F${format(options.plunge * unit)}`)
  // Mode de mouvement modal restaure en dernier (la suite peut omettre G0/G1).
  const motionWord = motion === 2 || motion === 3 ? 'G1' : `G${motion}`
  out.push(feed !== null ? `${motionWord} F${format(feed)}` : motionWord)
  return { lines: [...out, ...lines.slice(start)], preamble: out.length }
}
