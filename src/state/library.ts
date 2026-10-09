import { BITS } from '../data/bits'
import { MACHINES } from '../data/machines'
import { findMaterial } from '../data/materials'
import { autoParams } from '../data/params'
import type { Bit, MachineProfile, ProbeSettings } from '../data/types'
import type { LogEntry } from '../grbl/types'
import { tr } from '../i18n'
import { loadJSON, saveJSON } from './persist'
import type { AppState } from './store'

type Set = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void
type Get = () => AppState
type Log = (dir: LogEntry['dir'], text: string) => void

export type LibraryActions = Pick<
  AppState,
  | 'setMachine'
  | 'setMaterial'
  | 'setBit'
  | 'duplicateMachine'
  | 'updateMachine'
  | 'removeMachine'
  | 'addBit'
  | 'duplicateBit'
  | 'updateBit'
  | 'removeBit'
  | 'setParams'
  | 'setProbe'
>

export function bitById(bits: Bit[], id: string): Bit {
  return bits.find((b) => b.id === id) ?? bits[0]
}

/** Profils machines, materiaux, fraises, parametres de coupe et palpeur. */
export function createLibraryActions(set: Set, get: Get, pushLog: Log): LibraryActions {
  return {
    setMachine: (id) => {
      const machine = get().machines.find((m) => m.id === id) ?? get().machines[0]
      const probe = { ...machine.probe, ...loadJSON<Partial<ProbeSettings>>('probe.' + id, {}) }
      set({
        machineId: id,
        baudRate: machine.baud,
        probe,
        params: autoParams(machine, findMaterial(get().materialId), bitById(get().bits, get().bitId)),
      })
      saveJSON('machineId', id)
    },

    setMaterial: (id) => {
      const machine = get().machines.find((m) => m.id === get().machineId) ?? get().machines[0]
      set({
        materialId: id,
        params: autoParams(machine, findMaterial(id), bitById(get().bits, get().bitId)),
      })
      saveJSON('materialId', id)
    },

    setBit: (id) => {
      const machine = get().machines.find((m) => m.id === get().machineId) ?? get().machines[0]
      set({
        bitId: id,
        params: autoParams(machine, findMaterial(get().materialId), bitById(get().bits, id)),
      })
      saveJSON('bitId', id)
    },

    duplicateMachine: (id) => {
      const source = get().machines.find((m) => m.id === id)
      if (!source) return
      const copy: MachineProfile = {
        ...source,
        id: `user-${Date.now()}`,
        name: `${source.name} (copie)`,
        builtin: false,
      }
      const userMachines = [...get().userMachines, copy]
      saveJSON('userMachines', userMachines)
      set({ userMachines, machines: [...MACHINES, ...userMachines] })
      get().setMachine(copy.id)
      pushLog('info', tr('Profil créé : {name}', { name: copy.name }))
    },

    updateMachine: (id, partial) => {
      const userMachines = get().userMachines.map((m) => (m.id === id ? { ...m, ...partial } : m))
      saveJSON('userMachines', userMachines)
      const machines = [...MACHINES, ...userMachines]
      const patch: Partial<AppState> = { userMachines, machines }
      if (get().machineId === id) {
        const current = machines.find((m) => m.id === id)
        if (current) {
          patch.baudRate = current.baud
          patch.params = autoParams(current, findMaterial(get().materialId), bitById(get().bits, get().bitId))
        }
      }
      set(patch)
    },

    removeMachine: (id) => {
      const userMachines = get().userMachines.filter((m) => m.id !== id)
      saveJSON('userMachines', userMachines)
      const machines = [...MACHINES, ...userMachines]
      set({ userMachines, machines })
      if (get().machineId === id) get().setMachine(machines[0].id)
    },

    addBit: () => {
      const bit: Bit = {
        id: `bit-${Date.now()}`,
        name: 'Ma fraise',
        nameEn: 'My end mill',
        type: 'flat',
        diameter: 3.175,
        flutes: 2,
        cutLength: 12,
        shank: 3.175,
        geom: 'straight',
        builtin: false,
      }
      const userBits = [...get().userBits, bit]
      saveJSON('userBits', userBits)
      set({ userBits, bits: [...BITS, ...userBits] })
      get().setBit(bit.id)
      pushLog('info', tr('Fraise créée : {name}', { name: bit.name }))
    },

    duplicateBit: (id) => {
      const source = get().bits.find((b) => b.id === id)
      if (!source) return
      const copy: Bit = { ...source, id: `bit-${Date.now()}`, name: `${source.name} (copie)`, nameEn: `${source.nameEn} (copy)`, builtin: false }
      const userBits = [...get().userBits, copy]
      saveJSON('userBits', userBits)
      set({ userBits, bits: [...BITS, ...userBits] })
      get().setBit(copy.id)
      pushLog('info', tr('Fraise créée : {name}', { name: copy.name }))
    },

    updateBit: (id, partial) => {
      const userBits = get().userBits.map((b) => (b.id === id ? { ...b, ...partial } : b))
      saveJSON('userBits', userBits)
      const bits = [...BITS, ...userBits]
      const patch: Partial<AppState> = { userBits, bits }
      if (get().bitId === id) {
        const machine = get().machines.find((m) => m.id === get().machineId) ?? get().machines[0]
        patch.params = autoParams(machine, findMaterial(get().materialId), bitById(bits, id))
      }
      set(patch)
    },

    removeBit: (id) => {
      const userBits = get().userBits.filter((b) => b.id !== id)
      saveJSON('userBits', userBits)
      const bits = [...BITS, ...userBits]
      set({ userBits, bits })
      if (get().bitId === id) get().setBit(bits[0].id)
    },

    setParams: (partial) => set((state) => ({ params: { ...state.params, ...partial } })),

    setProbe: (partial) => {
      const machineId = get().machineId
      const probe = { ...get().probe, ...partial }
      set({ probe })
      saveJSON('probe.' + machineId, probe)
    },
  }
}
