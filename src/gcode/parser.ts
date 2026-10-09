import type { Vec3 } from '../grbl/types'

export interface Segment {
  from: Vec3
  to: Vec3
  rapid: boolean
  /** Avance programmee (mm/min) ; 0 si inconnue. */
  feed?: number
}

export interface Bounds {
  min: Vec3
  max: Vec3
}

export interface Toolpath {
  segments: Segment[]
  bounds: Bounds
  lines: number
  moves: number
  warnings: string[]
}

const ARC_TOLERANCE = 0.05 // mm
const MAX_ARC_STEPS = 720

// Codes G sans effet geometrique pour l'apercu 3D.
const IGNORED_G_CODES = new Set<number>([
  40, 43, 43.1, 44, 49, 54, 55, 56, 57, 58, 59, 61, 64, 80, 93, 94, 95, 96, 97, 98, 99,
])
// Codes non modaux dont les mots X/Y/Z ne sont pas un deplacement en
// coordonnees de travail : ils ne doivent pas fausser l'emprise du programme.
const NON_MOTION_G_CODES = new Set<number>([4, 10, 28, 28.1, 30, 30.1, 92.1, 92.2, 92.3])

function vec(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z }
}

function clone(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z }
}

/** Retire les commentaires ( ... ) et ; ... ainsi que les lignes vides. */
export function stripComments(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((line) => {
      let out = ''
      let depth = 0
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (ch === '(') depth++
        else if (ch === ')') depth = Math.max(0, depth - 1)
        else if (ch === ';' && depth === 0) break
        else if (depth === 0) out += ch
      }
      return out.trim()
    })
    .filter((line) => line.length > 0 && line !== '%')
}

interface Word {
  letter: string
  value: number
}

function tokenize(line: string): Word[] {
  const words: Word[] = []
  const regex = /([A-Za-z])\s*([+-]?(?:\d+\.?\d*|\.\d+))/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(line.toUpperCase())) !== null) {
    words.push({ letter: match[1], value: Number.parseFloat(match[2]) })
  }
  return words
}

interface ParseState {
  scale: number
  absolute: boolean
  arcAbsolute: boolean
  plane: 17 | 18 | 19
  pos: Vec3
  feed: number
  motion: 0 | 1 | 2 | 3
}

export function parseGcode(source: string): Toolpath {
  const lines = stripComments(source)
  const segments: Segment[] = []
  const warnings = new Set<string>()
  const min = vec(Infinity, Infinity, Infinity)
  const max = vec(-Infinity, -Infinity, -Infinity)

  const state: ParseState = {
    scale: 1,
    absolute: true,
    arcAbsolute: false,
    plane: 17,
    pos: vec(0, 0, 0),
    feed: 0,
    motion: 0,
  }

  const track = (p: Vec3) => {
    min.x = Math.min(min.x, p.x)
    min.y = Math.min(min.y, p.y)
    min.z = Math.min(min.z, p.z)
    max.x = Math.max(max.x, p.x)
    max.y = Math.max(max.y, p.y)
    max.z = Math.max(max.z, p.z)
  }

  const pushSegment = (from: Vec3, to: Vec3, rapid: boolean) => {
    segments.push({ from: clone(from), to: clone(to), rapid, feed: rapid ? undefined : state.feed * state.scale })
    track(to)
  }

  track(state.pos)
  let moves = 0

  for (const rawLine of lines) {
    const words = tokenize(rawLine)
    if (!words.length) continue

    const gCodes: number[] = []
    const axisWords: Partial<Record<'X' | 'Y' | 'Z', number>> = {}
    let i: number | undefined
    let j: number | undefined
    let k: number | undefined
    let r: number | undefined
    let f: number | undefined

    for (const word of words) {
      switch (word.letter) {
        case 'G':
          gCodes.push(word.value)
          break
        case 'X':
        case 'Y':
        case 'Z':
          axisWords[word.letter] = word.value
          break
        case 'I':
          i = word.value
          break
        case 'J':
          j = word.value
          break
        case 'K':
          k = word.value
          break
        case 'R':
          r = word.value
          break
        case 'F':
          f = word.value
          break
        default:
          break
      }
    }

    if (f !== undefined) state.feed = f

    let bypassMotion = false
    for (const g of gCodes) {
      const code = Math.floor(g * 10) / 10
      if (code === 17 || code === 18 || code === 19) {
        state.plane = code as 17 | 18 | 19
        if (code !== 17) warnings.add('Seul le plan G17 (XY) est supporte pour les arcs.')
        continue
      }
      if (code === 20) state.scale = 25.4
      else if (code === 21) state.scale = 1
      else if (code === 90) state.absolute = true
      else if (code === 91) state.absolute = false
      else if (code === 90.1) state.arcAbsolute = true
      else if (code === 91.1) state.arcAbsolute = false
      else if (code === 0 || code === 1 || code === 2 || code === 3) {
        state.motion = code as 0 | 1 | 2 | 3
        continue
      } else if (code === 92) {
        applyG92(state, axisWords)
        bypassMotion = true
        continue
      } else if (code === 53) {
        // Coordonnees machine : position inconnue dans le repere de travail.
        warnings.add('Mouvements G53 (coordonnees machine) non representes dans l\'apercu.')
        bypassMotion = true
        continue
      } else if (code === 28 || code === 30) {
        warnings.add(`G${code} (retour a une position memorisee) non represente dans l'apercu.`)
        bypassMotion = true
        continue
      } else if (code >= 38.2 && code <= 38.5) {
        warnings.add('Palpage G38.x dans le programme : profondeur reelle inconnue.')
        bypassMotion = true
        continue
      } else if (NON_MOTION_G_CODES.has(code)) {
        bypassMotion = true
        continue
      } else if (IGNORED_G_CODES.has(code)) {
        // Dwell / offsets / modes non geometriques: sans effet sur l'apercu.
        continue
      } else {
        warnings.add(`Commande G${code} ignoree dans l'apercu.`)
        continue
      }
    }

    const hasAxis = Object.keys(axisWords).length > 0
    const isMotion = state.motion === 0 || state.motion === 1 || state.motion === 2 || state.motion === 3
    if (!hasAxis || !isMotion || bypassMotion) continue

    const start = state.pos
    const target = targetFromWords(state, axisWords)
    moves++

    if (state.motion === 0 || state.motion === 1) {
      pushSegment(start, target, state.motion === 0)
    } else {
      const points = buildArc(state, start, target, { i, j, k, r })
      let previous = start
      for (const point of points) {
        pushSegment(previous, point, false)
        previous = point
      }
    }

    state.pos = target
  }

  if (!Number.isFinite(min.x)) {
    return { segments, bounds: { min: vec(0, 0, 0), max: vec(0, 0, 0) }, lines: lines.length, moves, warnings: [...warnings] }
  }

  return { segments, bounds: { min, max }, lines: lines.length, moves, warnings: [...warnings] }
}

function applyG92(state: ParseState, axisWords: Partial<Record<'X' | 'Y' | 'Z', number>>): void {
  const next = clone(state.pos)
  if (axisWords.X !== undefined) next.x = axisWords.X * state.scale
  if (axisWords.Y !== undefined) next.y = axisWords.Y * state.scale
  if (axisWords.Z !== undefined) next.z = axisWords.Z * state.scale
  state.pos = next
}

function targetFromWords(state: ParseState, axisWords: Partial<Record<'X' | 'Y' | 'Z', number>>): Vec3 {
  const target = clone(state.pos)
  const apply = (axis: 'X' | 'Y' | 'Z', key: 'x' | 'y' | 'z') => {
    const value = axisWords[axis]
    if (value === undefined) return
    const scaled = value * state.scale
    target[key] = state.absolute ? scaled : state.pos[key] + scaled
  }
  apply('X', 'x')
  apply('Y', 'y')
  apply('Z', 'z')
  return target
}

interface ArcWords {
  i?: number
  j?: number
  k?: number
  r?: number
}

function buildArc(state: ParseState, start: Vec3, end: Vec3, words: ArcWords): Vec3[] {
  const clockwise = state.motion === 2
  if (state.plane !== 17) {
    // Plans non supportes: interpolation lineaire de secours.
    return [end]
  }

  const radius = Math.hypot(end.x - start.x, end.y - start.y)
  let center: { x: number; y: number }

  if (words.r !== undefined) {
    const r = words.r * state.scale
    const d = radius
    if (Math.abs(r) < 1e-6 || d > Math.abs(r) * 2 + 1e-6) {
      return [end]
    }
    const mx = (start.x + end.x) / 2
    const my = (start.y + end.y) / 2
    const h = Math.sqrt(Math.max(0, r * r - (d * d) / 4))
    let dx = 0
    let dy = 0
    if (d > 1e-9) {
      dx = (end.x - start.x) / d
      dy = (end.y - start.y) / d
    }
    const c1 = { x: mx - dy * h, y: my + dx * h }
    const c2 = { x: mx + dy * h, y: my - dx * h }
    const a = { c: c1, sweep: sweepAngle(start, end, c1, clockwise) }
    const b = { c: c2, sweep: sweepAngle(start, end, c2, clockwise) }
    const minorWanted = words.r > 0
    center = pickArc(a, b, minorWanted)
  } else {
    const cx = start.x + (words.i ?? 0) * state.scale
    const cy = start.y + (words.j ?? 0) * state.scale
    center = { x: cx, y: cy }
  }

  const r = Math.hypot(start.x - center.x, start.y - center.y)
  if (r < 1e-9) return [end]
  const sweep = sweepAngle(start, end, center, clockwise)
  const maxAngle = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - ARC_TOLERANCE / r)))
  const steps = Math.max(1, Math.min(MAX_ARC_STEPS, Math.ceil(Math.abs(sweep) / Math.max(maxAngle, 1e-4))))

  const a0 = Math.atan2(start.y - center.y, start.x - center.x)
  const points: Vec3[] = []
  for (let s = 1; s <= steps; s++) {
    const t = s / steps
    const angle = a0 + sweep * t
    points.push({
      x: center.x + r * Math.cos(angle),
      y: center.y + r * Math.sin(angle),
      z: start.z + (end.z - start.z) * t,
    })
  }
  if (points.length) points[points.length - 1] = clone(end)
  return points
}

function pickArc(
  a: { c: { x: number; y: number }; sweep: number },
  b: { c: { x: number; y: number }; sweep: number },
  minorWanted: boolean,
): { x: number; y: number } {
  const aMinor = Math.abs(a.sweep) <= Math.PI + 1e-9
  return aMinor === minorWanted ? a.c : b.c
}

function sweepAngle(start: Vec3, end: Vec3, center: { x: number; y: number }, clockwise: boolean): number {
  const a0 = Math.atan2(start.y - center.y, start.x - center.x)
  const a1 = Math.atan2(end.y - center.y, end.x - center.x)
  let delta = a1 - a0
  if (clockwise) {
    while (delta >= 0) delta -= 2 * Math.PI
  } else {
    while (delta <= 0) delta += 2 * Math.PI
  }
  return delta
}
