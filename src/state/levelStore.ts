import { create } from 'zustand'
import type { LevelMap } from '../cam/leveling'

/**
 * Carte de nivellement pour le fraisage (gravure fine sur surface non plane).
 * Les ecarts sont relatifs au Z0 de travail au moment du palpage : si Z0 change
 * ensuite, la carte n'est plus valable et n'est plus appliquee.
 */
interface LevelState {
  map: LevelMap | null
  /** WCO.z (Z machine du Z0) au moment du palpage. */
  wcoZ: number | null
  probedAt: number | null
  enabled: boolean
  setMap: (map: LevelMap, wcoZ: number) => void
  setEnabled: (enabled: boolean) => void
  clear: () => void
}

export const useLevelStore = create<LevelState>((set) => ({
  map: null,
  wcoZ: null,
  probedAt: null,
  enabled: false,
  setMap: (map, wcoZ) => set({ map, wcoZ, probedAt: Date.now(), enabled: true }),
  setEnabled: (enabled) => set({ enabled }),
  clear: () => set({ map: null, wcoZ: null, probedAt: null, enabled: false }),
}))

/** Vrai si la carte correspond encore au Z0 actuel. */
export function levelStillValid(wcoZ: number | null, currentWcoZ: number | undefined): boolean {
  return wcoZ !== null && currentWcoZ !== undefined && Math.abs(wcoZ - currentWcoZ) < 0.02
}
