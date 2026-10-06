import type { Feedback, GrblState, GrblStatus, Vec3 } from './types'

function toVec(value: string): Vec3 | undefined {
  const parts = value.split(',').map((n) => Number.parseFloat(n))
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return undefined
  return { x: parts[0], y: parts[1], z: parts[2] }
}

/**
 * Parse un rapport de statut GRBL, ex:
 * <Idle|MPos:0.000,0.000,0.000|FS:0,0|WCO:0,0,0>
 */
export function parseStatus(line: string): GrblStatus | null {
  const match = /^<([^|>]+)(?:\|(.*))?>$/.exec(line.trim())
  if (!match) return null

  const [statePart, dataPart = ''] = [match[1], match[2] ?? '']
  const [rawState, subState] = statePart.split(':')
  const state = (rawState as GrblState) || 'Unknown'

  const status: GrblStatus = {
    state,
    subState,
    raw: line.trim(),
    timestamp: Date.now(),
  }

  for (const field of dataPart.split('|')) {
    if (!field) continue
    const colon = field.indexOf(':')
    const key = colon === -1 ? field : field.slice(0, colon)
    const value = colon === -1 ? '' : field.slice(colon + 1)
    switch (key) {
      case 'MPos':
        status.mpos = toVec(value)
        break
      case 'WPos':
        status.wpos = toVec(value)
        break
      case 'WCO':
        status.wco = toVec(value)
        break
      case 'FS': {
        const [feed, spindle] = value.split(',').map(Number)
        status.fs = { feed: feed || 0, spindle: spindle || 0 }
        break
      }
      case 'F':
        status.fs = { feed: Number(value) || 0, spindle: status.fs?.spindle ?? 0 }
        break
      case 'Ov': {
        const [a, b, c] = value.split(',').map(Number)
        status.ov = [a || 0, b || 0, c || 0]
        break
      }
      case 'Pn':
        status.pn = value
        break
      case 'A':
        status.accessories = value
        break
      case 'Bf': {
        const [planner, rx] = value.split(',').map(Number)
        status.buffer = { planner: planner || 0, rx: rx || 0 }
        break
      }
      default:
        break
    }
  }

  return status
}

/**
 * Parse les messages "feedback" de GRBL: [MSG:...], [GC:...],
 * [G54:...], $0=10, [PRB:...], etc.
 */
export function parseFeedback(line: string): Feedback | null {
  const setting = /^\$(\d+)=(.*)$/.exec(line)
  if (setting) {
    return { kind: 'setting', key: Number(setting[1]), value: setting[2] }
  }

  const message = /^\[MSG:(.*)\]$/.exec(line)
  if (message) {
    return { kind: 'message', text: message[1] }
  }

  const probe = /^\[PRB:([-\d.,]+)(?::(\d))?\]/.exec(line)
  if (probe) {
    const vec = toVec(probe[1]) ?? { x: 0, y: 0, z: 0 }
    return { kind: 'probe', ...vec, ok: probe[2] !== '0' }
  }

  const bracketed = /^\[([A-Z]+):(.*)\]$/.exec(line)
  if (bracketed) {
    return {
      kind: 'parser',
      raw: line,
      data: { [bracketed[1]]: bracketed[2] },
    }
  }

  return null
}
