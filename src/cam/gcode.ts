import type { CamResult, CutPath, CutPoint } from './toolpath'

export interface LaserGcodeOptions {
  mode: 'M3' | 'M4'
  power: number
  focusZ?: number
}

export interface GcodeOptions {
  safeZ: number
  feed: number
  plunge: number
  rpm: number
  spindleMode: 'grbl' | 'manual'
  preamble?: string
  postamble?: string
  laser?: LaserGcodeOptions
  units?: 'mm' | 'in'
  arcs?: boolean
  toolChange?: { names?: Record<string, string>; enabled?: boolean; x?: number; y?: number; reprobe?: boolean }
}

/** Cercle passant au mieux par les points (centroïde), ou null. */
function fitCircle(points: CutPoint[]): { cx: number; cy: number; r: number } | null {
  if (points.length < 6) return null
  let cx = 0
  let cy = 0
  for (const p of points) {
    cx += p.x
    cy += p.y
  }
  cx /= points.length
  cy /= points.length
  let rSum = 0
  let rMin = Infinity
  let rMax = 0
  for (const p of points) {
    const r = Math.hypot(p.x - cx, p.y - cy)
    rSum += r
    rMin = Math.min(rMin, r)
    rMax = Math.max(rMax, r)
  }
  const rAvg = rSum / points.length
  if (rAvg < 0.3) return null
  if ((rMax - rMin) / rAvg > 0.03) return null
  return { cx, cy, r: rAvg }
}

function signedArea(points: CutPoint[]): number {
  let area = 0
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += (points[j].x + points[i].x) * (points[j].y - points[i].y)
  }
  return area / 2
}

function makeNum(units: 'mm' | 'in') {
  const k = units === 'in' ? 1 / 25.4 : 1
  return (value: number): string => {
    const scaled = Math.round(value * k * 1000) / 1000
    const fixed = scaled.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
    return fixed === '-0' ? '0' : fixed
  }
}

export function toolpathToGcode(result: CamResult, options: GcodeOptions): string {
  return options.laser ? laserGcode(result, options, options.laser) : millGcode(result, options)
}

function preset(lines: string[], units: 'mm' | 'in'): void {
  lines.push(units === 'in' ? 'G20' : 'G21')
  lines.push('G90')
  lines.push('G94')
  lines.push('G17')
}

function pushCustom(lines: string[], text?: string): void {
  if (!text) return
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed) lines.push(trimmed)
  }
}

function millGcode(result: CamResult, options: GcodeOptions): string {
  const units = options.units ?? 'mm'
  const num = makeNum(units)
  const lines: string[] = []
  let currentX = 0
  let currentY = 0
  let currentZ = options.safeZ

  preset(lines, units)
  lines.push(`G0 Z${num(options.safeZ)}`)
  if (options.spindleMode === 'manual') lines.push(`S${Math.round(options.rpm)} M0`)
  else lines.push(`M3 S${Math.round(options.rpm)}`)
  pushCustom(lines, options.preamble)

  let currentTool: string | null = null
  for (const path of result.paths) {
    if (!path.points.length) continue
    const tid = path.toolId
    if (tid !== undefined && currentTool !== null && tid !== currentTool) {
      if (currentZ !== options.safeZ) {
        lines.push(`G0 Z${num(options.safeZ)}`)
        currentZ = options.safeZ
      }
      lines.push('M5')
      const name = options.toolChange?.names?.[tid] ?? tid
      if (options.toolChange?.enabled) {
        const tx = options.toolChange.x ?? 0
        const ty = options.toolChange.y ?? 0
        lines.push(`G0 X${num(tx)} Y${num(ty)}`)
        currentX = tx
        currentY = ty
      }
      lines.push(`M0 (Changer l'outil : ${name})`)
      if (options.toolChange?.reprobe) lines.push('M0 (Re-palper Z0 puis Cycle start)')
      if (options.spindleMode === 'manual') lines.push(`S${Math.round(options.rpm)} M0`)
      else lines.push(`M3 S${Math.round(options.rpm)}`)
    }
    if (tid !== undefined) currentTool = tid
    if (currentZ !== options.safeZ) {
      lines.push(`G0 Z${num(options.safeZ)}`)
      currentZ = options.safeZ
    }
    const first = path.points[0]
    if (currentX !== first.x || currentY !== first.y) {
      lines.push(`G0 X${num(first.x)} Y${num(first.y)}`)
      currentX = first.x
      currentY = first.y
    }
    const firstZ = first.z ?? path.z
    if (currentZ !== firstZ) {
      lines.push(`G1 Z${num(firstZ)} F${num(options.plunge)}`)
      currentZ = firstZ
    }

    const circle = options.arcs && path.closed ? fitCircle(path.points) : null
    if (circle) {
      const cw = signedArea(path.points) < 0
      const i = circle.cx - first.x
      const j = circle.cy - first.y
      lines.push(`${cw ? 'G2' : 'G3'} X${num(first.x)} Y${num(first.y)} I${num(i)} J${num(j)} F${num(options.feed)}`)
      currentX = first.x
      currentY = first.y
      continue
    }

    for (let pIndex = 1; pIndex < path.points.length; pIndex++) {
      const point = path.points[pIndex]
      const z = point.z ?? path.z
      if (z !== currentZ) {
        lines.push(`G1 X${num(point.x)} Y${num(point.y)} Z${num(z)} F${num(options.feed)}`)
        currentZ = z
      } else {
        lines.push(`G1 X${num(point.x)} Y${num(point.y)} F${num(options.feed)}`)
      }
      currentX = point.x
      currentY = point.y
    }
    if (path.closed && path.points.length > 1) {
      const z = first.z ?? path.z
      if (z !== currentZ) {
        lines.push(`G1 Z${num(z)} F${num(options.plunge)}`)
        currentZ = z
      }
      lines.push(`G1 X${num(first.x)} Y${num(first.y)}`)
      currentX = first.x
      currentY = first.y
    }
  }

  pushCustom(lines, options.postamble)
  lines.push(`G0 Z${num(options.safeZ)}`)
  lines.push('M5')
  lines.push('M30')
  return lines.join('\n') + '\n'
}

function laserGcode(result: CamResult, options: GcodeOptions, laser: LaserGcodeOptions): string {
  const units = options.units ?? 'mm'
  const num = makeNum(units)
  const lines: string[] = []
  preset(lines, units)
  lines.push('G54')
  lines.push(`${laser.mode} S0`)

  let lastX: number | null = null
  let lastY: number | null = null
  let lastF: number | null = null
  let lastS: number | null = null
  const powerOf = (path: CutPath, point?: CutPoint): number => point?.s ?? path.power ?? laser.power

  for (const path of result.paths) {
    if (!path.points.length) continue
    const sequence = path.closed && path.points.length > 1 ? [...path.points, path.points[0]] : path.points
    const start = sequence[0]
    // Rapide vers le debut (laser coupe automatiquement en G0 en mode laser).
    let axes = ''
    if (lastX === null || Math.abs(start.x - lastX) > 1e-6) axes += ` X${num(start.x)}`
    if (lastY === null || Math.abs(start.y - lastY) > 1e-6) axes += ` Y${num(start.y)}`
    if (axes) lines.push(`G0${axes}`)
    lastX = start.x
    lastY = start.y
    lastF = null
    lastS = null

    for (let i = 0; i < sequence.length; i++) {
      const point = sequence[i]
      const power = powerOf(path, point)
      let move = ''
      if (Math.abs(point.x - (lastX ?? point.x)) > 1e-6) move += ` X${num(point.x)}`
      if (Math.abs(point.y - (lastY ?? point.y)) > 1e-6) move += ` Y${num(point.y)}`
      let extra = ''
      if (lastF !== options.feed) {
        extra += ` F${num(options.feed)}`
        lastF = options.feed
      }
      if (lastS !== power) {
        extra += ` S${num(power)}`
        lastS = power
      }
      if (move || extra) lines.push(`G1${move}${extra}`)
      lastX = point.x
      lastY = point.y
    }
  }

  lines.push('M5')
  lines.push('M2')
  return lines.join('\n') + '\n'
}
