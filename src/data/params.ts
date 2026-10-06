import type { Bit, MachineProfile, Material } from './types'

export interface CutParams {
  rpm: number
  feed: number
  plunge: number
  doc: number
  stepover: number
  safeZ: number
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function autoParams(machine: MachineProfile, material: Material, bit: Bit): CutParams {
  const ref = bit.refDia || bit.diameter
  const spindle = machine.spindle
  const rpm = clamp(material.rpm, spindle.minRpm, spindle.maxRpm)
  let feed = rpm * bit.flutes * material.chip * ref * (bit.type === 'vbit' ? 2.5 : 1)
  feed = clamp(Math.round(feed / 10) * 10, 30, machine.maxFeed)
  const plunge = clamp(Math.round((feed * material.plunge) / 10) * 10, 20, machine.maxFeedZ)
  let doc = ref * material.doc
  if (bit.docMax) doc = Math.min(doc, bit.docMax)
  if (bit.cutLength) doc = Math.min(doc, bit.cutLength)
  doc = Math.max(round(doc, 2), 0.05)
  const stepover = Math.max(round(bit.diameter * material.stepover, 2), 0.05)
  return { rpm, feed, plunge, doc, stepover, safeZ: machine.safeZ }
}

export function spindleCommand(machine: MachineProfile, rpm: number): string {
  if (machine.spindle.mode === 'manual') return `S${rpm} M0`
  return `M3 S${rpm}`
}

export function spindleStop(): string {
  return 'M5'
}
