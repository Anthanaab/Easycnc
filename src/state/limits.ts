import type { MachineProfile } from '../data/types'
import { checkLimits, checkMachineLimits, type LimitCheck } from '../gcode/estimate'
import type { Toolpath } from '../gcode/parser'
import type { GrblStatus } from '../grbl/types'

export interface LimitState {
  machines: MachineProfile[]
  machineId: string
  settings: Record<number, string>
  status: GrblStatus | null
  homed: boolean
}

/** Courses GRBL ($130-$132) si connues, sinon celles du profil machine. */
export function travelOf(settings: Record<number, string>, area: { x: number; y: number; z: number }) {
  const read = (key: number, fallback: number) => {
    const value = Number(settings[key])
    return Number.isFinite(value) && value > 0 ? value : fallback
  }
  return { x: read(130, area.x), y: read(131, area.y), z: read(132, area.z) }
}

/**
 * Controle d'emprise du programme. Si la machine est referencee et que
 * l'origine de travail est connue, le controle se fait en coordonnees machine
 * (precis, inclut le Z de securite) ; sinon, controle approximatif sur le plateau.
 */
export function jobLimits(toolpath: Toolpath | null, state: LimitState): LimitCheck | null {
  const machine = state.machines.find((m) => m.id === state.machineId)
  if (!toolpath || !machine || !toolpath.segments.length) return null
  // Le store complete chaque rapport avec le dernier WCO connu.
  const wco = state.status?.wco
  if (state.homed && wco) {
    const machineCheck = checkMachineLimits(toolpath.bounds, wco, state.status?.mpos, travelOf(state.settings, machine.area))
    const basic = checkLimits(toolpath.bounds, travelOf(state.settings, machine.area))
    // Les controles "X/Y negatif" approximatifs n'ont plus de sens ici.
    const sizeMessages = basic.messages.filter((m) => /^(Largeur|Hauteur|Profondeur)/.test(m))
    const messages = [...sizeMessages, ...machineCheck.messages]
    return { ...machineCheck, ok: messages.length === 0, messages }
  }
  return checkLimits(toolpath.bounds, machine.area)
}
