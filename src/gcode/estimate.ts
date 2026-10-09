import type { Toolpath } from './parser'

export interface EstimateOptions {
  /** Avance par defaut si le programme n'en donne pas (mm/min). */
  feed: number
  /** Vitesse des deplacements rapides G0 (mm/min). */
  rapid: number
  /** Acceleration (mm/s^2), ex. min($120, $121). */
  accel?: number
}

export interface Estimate {
  cutLength: number
  rapidLength: number
  minutes: number
}

// Changement de direction au-dela duquel on considere un arret (rad).
const CORNER = (35 * Math.PI) / 180

/** Duree (s) d'un trajet de longueur L partant et finissant a l'arret (profil trapeze). */
function trapezoid(length: number, speed: number, accel: number): number {
  if (length <= 0 || speed <= 0) return 0
  const rampDistance = (speed * speed) / accel
  if (length >= rampDistance) return length / speed + speed / accel
  return 2 * Math.sqrt(length / accel)
}

/**
 * Estime la duree d'usinage : avance programmee de chaque segment, rapides,
 * et acceleration (les suites de segments quasi alignes forment un seul trajet
 * continu ; un angle vif impose un arret).
 */
export function estimateMinutes(toolpath: Toolpath, options: EstimateOptions): Estimate {
  const accel = options.accel && options.accel > 0 ? options.accel : 500
  const defaultFeed = Math.max(options.feed, 1)
  const rapid = Math.max(options.rapid, 1)
  let cutLength = 0
  let rapidLength = 0
  let seconds = 0

  let chainLength = 0
  let chainTime = 0 // a vitesse constante
  let chainSpeed = 0 // vitesse max du trajet (mm/s)
  let lastDir: { x: number; y: number; z: number } | null = null
  let lastRapid: boolean | null = null

  const closeChain = () => {
    if (chainLength > 0) {
      // Temps a vitesse constante + penalite d'acceleration/deceleration.
      seconds += chainTime + (trapezoid(chainLength, chainSpeed, accel) - chainLength / chainSpeed)
    }
    chainLength = 0
    chainTime = 0
    chainSpeed = 0
  }

  for (const segment of toolpath.segments) {
    const dx = segment.to.x - segment.from.x
    const dy = segment.to.y - segment.from.y
    const dz = segment.to.z - segment.from.z
    const length = Math.hypot(dx, dy, dz)
    if (length < 1e-9) continue
    if (segment.rapid) rapidLength += length
    else cutLength += length
    const speed = (segment.rapid ? rapid : segment.feed && segment.feed > 0 ? segment.feed : defaultFeed) / 60
    const dir = { x: dx / length, y: dy / length, z: dz / length }
    const continuous =
      lastDir !== null &&
      lastRapid === segment.rapid &&
      Math.acos(Math.max(-1, Math.min(1, dir.x * lastDir.x + dir.y * lastDir.y + dir.z * lastDir.z))) < CORNER
    if (!continuous) closeChain()
    chainLength += length
    chainTime += length / speed
    chainSpeed = Math.max(chainSpeed, speed)
    lastDir = dir
    lastRapid = segment.rapid
  }
  closeChain()
  return { cutLength, rapidLength, minutes: seconds / 60 }
}

export interface LimitCheck {
  ok: boolean
  width: number
  height: number
  depth: number
  messages: string[]
}

/** Verifie que l'emprise du job tient dans la zone de travail de la machine. */
export function checkLimits(
  bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } },
  area: { x: number; y: number; z: number },
): LimitCheck {
  const width = bounds.max.x - bounds.min.x
  const height = bounds.max.y - bounds.min.y
  const depth = Math.max(0, -bounds.min.z)
  const tol = 0.5
  const messages: string[] = []
  if (![area.x, area.y, area.z].every((v) => Number.isFinite(v) && v > 0)) {
    messages.push('Course machine invalide dans le profil (X/Y/Z > 0 requis)')
  }
  const finiteBounds = [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z].every(Number.isFinite)
  if (!finiteBounds) messages.push('Emprise du programme invalide (valeurs non numeriques)')
  if (width > area.x + tol) messages.push(`Largeur ${width.toFixed(1)} mm > course X ${area.x} mm`)
  if (height > area.y + tol) messages.push(`Hauteur ${height.toFixed(1)} mm > course Y ${area.y} mm`)
  if (depth > area.z + tol) messages.push(`Profondeur ${depth.toFixed(1)} mm > course Z ${area.z} mm`)
  if (bounds.min.x < -tol) messages.push(`X négatif (${bounds.min.x.toFixed(1)} mm) — hors plateau`)
  if (bounds.min.y < -tol) messages.push(`Y négatif (${bounds.min.y.toFixed(1)} mm) — hors plateau`)
  if (bounds.max.x > area.x + tol) messages.push(`X max ${bounds.max.x.toFixed(1)} mm > ${area.x} mm`)
  if (bounds.max.y > area.y + tol) messages.push(`Y max ${bounds.max.y.toFixed(1)} mm > ${area.y} mm`)
  return { ok: messages.length === 0, width, height, depth, messages }
}

type Axis = 'x' | 'y' | 'z'
const AXES: Axis[] = ['x', 'y', 'z']

/**
 * Verifie l'emprise du job en coordonnees MACHINE (origine de travail incluse),
 * contre les courses GRBL ($130-$132). Necessite une machine referencee ($H).
 *
 * GRBL travaille par defaut en espace negatif ([-course, 0] apres homing) ;
 * certaines configurations utilisent [0, course]. Si la position actuelle ne
 * permet pas de trancher, le job n'est refuse que s'il ne tient dans aucun des deux.
 */
export function checkMachineLimits(
  bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } },
  wco: { x: number; y: number; z: number },
  mpos: { x: number; y: number; z: number } | undefined,
  travel: { x: number; y: number; z: number },
): LimitCheck {
  const tol = 0.2
  const messages: string[] = []
  for (const axis of AXES) {
    const max = travel[axis]
    if (!(max > 0)) continue
    const lo = bounds.min[axis] + wco[axis]
    const hi = bounds.max[axis] + wco[axis]
    const fitsNegative = lo >= -max - tol && hi <= tol
    const fitsPositive = lo >= -tol && hi <= max + tol
    const current = mpos?.[axis] ?? 0
    const space = current < -0.5 ? 'neg' : current > 0.5 ? 'pos' : 'unknown'
    const ok = space === 'neg' ? fitsNegative : space === 'pos' ? fitsPositive : fitsNegative || fitsPositive
    if (ok) continue
    const label = axis.toUpperCase()
    const [rangeLo, rangeHi] = space === 'pos' ? [0, max] : [-max, 0]
    if (axis === 'z' && hi > rangeHi + tol) {
      messages.push(`Z monte jusqu'a ${hi.toFixed(1)} (machine) > ${rangeHi} : Z de securite trop haut ou Z0 trop proche du haut`)
    } else {
      messages.push(`${label} machine ${lo.toFixed(1)}…${hi.toFixed(1)} hors course [${rangeLo}, ${rangeHi}]`)
    }
  }
  return {
    ok: messages.length === 0,
    width: bounds.max.x - bounds.min.x,
    height: bounds.max.y - bounds.min.y,
    depth: Math.max(0, -bounds.min.z),
    messages,
  }
}
