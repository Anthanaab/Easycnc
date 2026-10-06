import type { Vec3 } from '../grbl/types'

export type SpindleMode = 'grbl' | 'manual'

export interface SpindleProfile {
  mode: SpindleMode
  minRpm: number
  maxRpm: number
  sMax: number
  spinupSec: number
}

export interface ProbeSettings {
  plate: number
  feed: number
  fast: number
  maxDepth: number
  retract: number
}

export interface MachineProfile {
  id: string
  brand: string
  name: string
  brandEn?: string
  nameEn?: string
  notesEn?: string
  area: Vec3
  baud: number
  maxFeed: number
  maxFeedZ: number
  rapid: number
  spindle: SpindleProfile
  homing: boolean
  safeZ: number
  notes: string
  collet: string
  maxShank: number
  preamble: string
  postamble: string
  probe: ProbeSettings
  builtin: boolean
}

export interface Material {
  id: string
  name: string
  nameEn: string
  color: string
  chip: number
  doc: number
  stepover: number
  rpm: number
  plunge: number
}

export type BitType = 'flat' | 'ball' | 'vbit' | 'drill'
export type BitGeom = 'straight' | 'down' | 'compression' | 'surface'

export interface Bit {
  id: string
  name: string
  nameEn: string
  type: BitType
  diameter: number
  flutes: number
  cutLength: number
  shank: number
  angle?: number
  refDia?: number
  docMax?: number
  geom?: BitGeom
  builtin: boolean
}
