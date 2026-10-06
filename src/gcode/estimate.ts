import type { Toolpath } from './parser'

export interface EstimateOptions {
  feed: number
  rapid: number
}

export interface Estimate {
  cutLength: number
  rapidLength: number
  minutes: number
}

/** Estime la duree d'usinage a partir du parcours (coupe + rapides). */
export function estimateMinutes(toolpath: Toolpath, options: EstimateOptions): Estimate {
  let cutLength = 0
  let rapidLength = 0
  for (const segment of toolpath.segments) {
    const dx = segment.to.x - segment.from.x
    const dy = segment.to.y - segment.from.y
    const dz = segment.to.z - segment.from.z
    const length = Math.hypot(dx, dy, dz)
    if (segment.rapid) rapidLength += length
    else cutLength += length
  }
  const feed = Math.max(options.feed, 1)
  const rapid = Math.max(options.rapid, 1)
  const minutes = cutLength / feed + rapidLength / rapid
  return { cutLength, rapidLength, minutes }
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
  if (width > area.x + tol) messages.push(`Largeur ${width.toFixed(1)} mm > course X ${area.x} mm`)
  if (height > area.y + tol) messages.push(`Hauteur ${height.toFixed(1)} mm > course Y ${area.y} mm`)
  if (depth > area.z + tol) messages.push(`Profondeur ${depth.toFixed(1)} mm > course Z ${area.z} mm`)
  if (bounds.min.x < -tol) messages.push(`X négatif (${bounds.min.x.toFixed(1)} mm) — hors plateau`)
  if (bounds.min.y < -tol) messages.push(`Y négatif (${bounds.min.y.toFixed(1)} mm) — hors plateau`)
  if (bounds.max.x > area.x + tol) messages.push(`X max ${bounds.max.x.toFixed(1)} mm > ${area.x} mm`)
  if (bounds.max.y > area.y + tol) messages.push(`Y max ${bounds.max.y.toFixed(1)} mm > ${area.y} mm`)
  return { ok: messages.length === 0, width, height, depth, messages }
}
