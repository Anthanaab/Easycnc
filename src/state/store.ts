import { create } from 'zustand'
import { BITS } from '../data/bits'
import { MACHINES, findMachine } from '../data/machines'
import { MATERIALS, findMaterial } from '../data/materials'
import { autoParams, type CutParams } from '../data/params'
import type { Bit, MachineProfile, Material, ProbeSettings } from '../data/types'
import { GrblClient, MAX_LINE_CHARS, grblLineLength } from '../grbl/GrblClient'
import { probeZ } from '../grbl/probe'
import { tr } from '../i18n'
import type { GrblStatus, LogEntry, Vec3 } from '../grbl/types'
import { raiseZ } from '../gcode/dryrun'
import { checkLimits, checkMachineLimits, type LimitCheck } from '../gcode/estimate'
import { parseGcode, type Toolpath } from '../gcode/parser'
import { GcodeStreamer, parsePause, programLines, type PauseReason, type StreamState } from '../gcode/streamer'
import { describeGrblCode } from '../grbl/codes'

let logId = 0
const MAX_LOG = 800

export const client = new GrblClient()

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

export interface StreamInfo {
  state: StreamState
  sent: number
  total: number
  pauseReason?: PauseReason
  pauseMessage?: string
}

export interface AppState {
  supported: boolean
  connected: boolean
  baudRate: number
  status: GrblStatus | null
  homed: boolean
  welcome: string | null
  log: LogEntry[]
  settings: Record<number, string>
  savedSettings: Record<string, Record<number, string>>
  parserState: string | null
  offsets: Record<string, Vec3>
  jogStep: number
  jogFeed: number
  dryRun: boolean
  machines: MachineProfile[]
  materials: Material[]
  bits: Bit[]
  machineId: string
  materialId: string
  bitId: string
  params: CutParams
  probe: ProbeSettings
  userMachines: MachineProfile[]
  userBits: Bit[]
  fileName: string | null
  rawGcode: string | null
  jobType: 'mill' | 'laser' | null
  toolpath: Toolpath | null
  stream: StreamInfo

  connect: (baudRate?: number) => Promise<void>
  disconnect: () => Promise<void>
  sendCommand: (line: string) => Promise<void>
  setSetting: (code: number, value: number) => Promise<void>
  jog: (axis: 'X' | 'Y' | 'Z', direction: number) => void
  startJog: (axis: 'X' | 'Y' | 'Z', direction: number) => void
  stopJog: () => void
  jogCancel: () => void
  feedHold: () => void
  cycleStart: () => void
  feedOverride: (action: 'up' | 'down' | 'reset') => void
  spindleOverride: (action: 'up' | 'down' | 'reset') => void
  rapidOverride: (level: '100' | '50' | '25') => void
  home: () => void
  unlock: () => void
  softReset: () => void
  setZero: (axes: Array<'X' | 'Y' | 'Z'>) => void
  requestSettings: () => void
  readSettings: () => void
  saveSettings: () => void
  restoreSettings: () => Promise<void>
  exportSettings: () => void
  importSettings: (json: string) => void
  runProbe: () => Promise<void>
  setMachine: (id: string) => void
  setMaterial: (id: string) => void
  setBit: (id: string) => void
  setParams: (partial: Partial<CutParams>) => void
  setProbe: (partial: Partial<ProbeSettings>) => void
  setJogStep: (step: number) => void
  setJogFeed: (feed: number) => void
  setDryRun: (dryRun: boolean) => void
  duplicateMachine: (id: string) => void
  updateMachine: (id: string, partial: Partial<MachineProfile>) => void
  removeMachine: (id: string) => void
  addBit: () => void
  duplicateBit: (id: string) => void
  updateBit: (id: string, partial: Partial<Bit>) => void
  removeBit: (id: string) => void
  loadFile: (name: string, text: string, jobType?: 'mill' | 'laser') => void
  startStream: () => Promise<void>
  pauseStream: () => void
  resumeStream: () => void
  stopStream: () => void
  clearLog: () => void
}

function pushLog(dir: LogEntry['dir'], text: string): void {
  useStore.setState((state) => {
    const entry: LogEntry = { id: ++logId, dir, text, time: Date.now() }
    const log = [...state.log, entry]
    if (log.length > MAX_LOG) log.splice(0, log.length - MAX_LOG)
    return { log }
  })
}

/**
 * Raison pour laquelle une commande manuelle est refusee (ou null si OK).
 * Pendant un programme, toute ligne envoyee s'intercalerait dans le flux :
 * seules les pauses programme (M0, machine a l'arret) l'autorisent.
 */
export function machineBusyReason(): string | null {
  if (!client.connected) return tr('Non connecte')
  if (!streamer.acceptsCommands) return tr('Programme en cours : commande refusee (mettez en pause M0 ou arretez)')
  return null
}

function guard(): boolean {
  const reason = machineBusyReason()
  if (reason) pushLog('error', reason)
  return reason === null
}

/** Courses GRBL ($130-$132) si connues, sinon celles du profil machine. */
function travelOf(settings: Record<number, string>, area: { x: number; y: number; z: number }) {
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
export function jobLimits(toolpath: Toolpath | null, state: Pick<AppState, 'machines' | 'machineId' | 'settings' | 'status' | 'homed'>): LimitCheck | null {
  const machine = state.machines.find((m) => m.id === state.machineId)
  if (!toolpath || !machine || !toolpath.segments.length) return null
  const wco = state.status?.wco ?? lastWco
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

// GRBL n'envoie WCO que periodiquement (tous les 10-30 rapports) : on garde le dernier.
let lastWco: Vec3 | null = null

// Jog continu en cours (annule si la fenetre perd le focus).
let continuousJog = false

function bitById(bits: Bit[], id: string): Bit {
  return bits.find((b) => b.id === id) ?? bits[0]
}

const initialMachineId = loadJSON('machineId', 'lunyee-3018-pro-max')
const initialMaterialId = loadJSON('materialId', 'plywood')
const initialBitId = loadJSON('bitId', 'flat2-3175')
const initialUserMachines = loadJSON<MachineProfile[]>('userMachines', [])
const initialUserBits = loadJSON<Bit[]>('userBits', [])
const initialBit =
  [...BITS, ...initialUserBits].find((b) => b.id === initialBitId) ?? BITS[0]
const initialMachine =
  [...MACHINES, ...initialUserMachines].find((m) => m.id === initialMachineId) ?? MACHINES[0]
const initialProbe: ProbeSettings = {
  ...initialMachine.probe,
  ...loadJSON<Partial<ProbeSettings>>('probe.' + initialMachineId, {}),
}

export const useStore = create<AppState>((set, get) => ({
  supported: GrblClient.isSupported(),
  connected: false,
  baudRate: initialMachine.baud,
  status: null,
  homed: false,
  welcome: null,
  log: [],
  settings: {},
  savedSettings: loadJSON('savedSettings', {}),
  parserState: null,
  offsets: {},
  jogStep: 1,
  jogFeed: 500,
  dryRun: false,
  machines: [...MACHINES, ...initialUserMachines],
  materials: MATERIALS,
  bits: [...BITS, ...initialUserBits],
  machineId: initialMachineId,
  materialId: initialMaterialId,
  bitId: initialBitId,
  params: autoParams(initialMachine, findMaterial(initialMaterialId), initialBit),
  probe: initialProbe,
  userMachines: initialUserMachines,
  userBits: initialUserBits,
  fileName: null,
  rawGcode: null,
  jobType: null,
  toolpath: null,
  stream: { state: 'idle', sent: 0, total: 0 },

  connect: async (baudRate) => {
    const rate = baudRate ?? get().baudRate
    set({ baudRate: rate })
    try {
      await client.connect(rate)
      pushLog('info', tr('Port ouvert a {baud} bauds', { baud: rate }))
      // Reglages ($32 laser, courses $130-$132) et decalages : necessaires aux
      // controles de securite avant demarrage. Envoyes des que GRBL est pret.
      void client.send('$$').catch(() => undefined)
      void client.send('$#').catch(() => undefined)
    } catch (error) {
      pushLog('error', message(error))
    }
  },

  disconnect: async () => {
    await client.disconnect()
    pushLog('info', tr('Port ferme'))
  },

  sendCommand: async (line) => {
    const clean = line.trim()
    if (!clean) return
    if (!guard()) return
    try {
      await client.send(clean)
    } catch (error) {
      pushLog('error', message(error))
    }
  },

  setSetting: async (code, value) => {
    if (!Number.isInteger(code) || code < 0 || !Number.isFinite(value)) {
      pushLog('error', tr('Valeur invalide pour ${code}', { code }))
      return
    }
    if (!guard()) return
    try {
      await client.send(`$${code}=${value}`)
      // GRBL n'affiche pas la nouvelle valeur : on met a jour l'affichage.
      set((state) => ({ settings: { ...state.settings, [code]: String(value) } }))
    } catch (error) {
      pushLog('error', describeGrblCode(message(error)))
    }
  },

  jog: (axis, direction) => {
    if (!guard()) return
    const { jogStep, jogFeed } = get()
    client.jog(axis, jogStep * direction, jogFeed).catch((error) => pushLog('error', message(error)))
  },

  startJog: (axis, direction) => {
    if (!guard()) return
    const { jogFeed, settings, status, homed } = get()
    const machine = get().machines.find((m) => m.id === get().machineId) ?? get().machines[0]
    const key = axis.toLowerCase() as 'x' | 'y' | 'z'
    const travel = travelOf(settings, machine.area)[key]
    // Distance bornee : jamais plus que la course de l'axe, et, machine
    // referencee, pas au-dela de la butee logicielle (espace GRBL [-course, 0]).
    let distance = travel
    const mpos = status?.mpos?.[key]
    if (homed && typeof mpos === 'number' && mpos <= 0.5) {
      const margin = 0.5
      distance = direction > 0 ? -mpos - margin : travel + mpos - margin
    }
    if (!(distance > 0.01)) {
      pushLog('info', tr('Jog {axis} : butee atteinte', { axis: `${axis}${direction > 0 ? '+' : '-'}` }))
      return
    }
    continuousJog = true
    client.jog(axis, direction * distance, jogFeed).catch((error) => pushLog('error', message(error)))
  },

  stopJog: () => {
    continuousJog = false
    client.jogCancel()
  },

  jogCancel: () => {
    continuousJog = false
    client.jogCancel()
  },
  feedHold: () => client.feedHold(),
  cycleStart: () => client.cycleStart(),
  feedOverride: (action) => {
    if (action === 'up') client.feedOverrideUp()
    else if (action === 'down') client.feedOverrideDown()
    else client.feedOverrideReset()
  },
  spindleOverride: (action) => {
    if (action === 'up') client.spindleOverrideUp()
    else if (action === 'down') client.spindleOverrideDown()
    else client.spindleOverrideReset()
  },
  rapidOverride: (level) => client.rapidOverride(level),
  home: () => {
    if (!guard()) return
    client.home().then(
      () => useStore.setState({ homed: true }),
      (error) => pushLog('error', message(error)),
    )
  },
  unlock: () => {
    if (!guard()) return
    client.unlock().catch((error) => pushLog('error', message(error)))
  },
  softReset: () => {
    continuousJog = false
    streamer.abort()
    pushLog('info', tr('Reset logiciel envoye'))
  },
  setZero: (axes) => {
    if (!guard()) return
    client
      .setWorkZero(axes)
      .then(() => client.send('$#'))
      .catch((error) => pushLog('error', message(error)))
  },
  requestSettings: () => {
    if (!guard()) return
    client.requestSettings().catch((error) => pushLog('error', message(error)))
  },

  readSettings: () => {
    if (!guard()) return
    set({ settings: {} })
    client.requestSettings().catch((error) => pushLog('error', message(error)))
  },

  saveSettings: () => {
    const { settings, savedSettings, machineId } = get()
    if (!Object.keys(settings).length) {
      pushLog('error', tr('Aucun reglage a sauvegarder (lisez d\'abord $$)'))
      return
    }
    const next = { ...savedSettings, [machineId]: { ...settings } }
    set({ savedSettings: next })
    saveJSON('savedSettings', next)
    pushLog('info', tr('Reglages sauvegardes pour {machine} ({count} valeurs)', { machine: machineId, count: Object.keys(settings).length }))
  },

  restoreSettings: async () => {
    const { savedSettings, machineId } = get()
    const saved = savedSettings[machineId]
    if (!saved) {
      pushLog('error', tr('Aucun reglage sauvegarde pour cette machine'))
      return
    }
    if (!guard()) return
    const keys = Object.keys(saved)
      .map(Number)
      .filter((key) => Number.isInteger(key) && key >= 0 && /^[-+]?\d*\.?\d+$/.test(String(saved[key]).trim()))
      .sort((a, b) => a - b)
    for (const key of keys) {
      try {
        await client.send(`$${key}=${saved[key]}`)
      } catch (error) {
        pushLog('error', tr('$k refuse: {msg}', { k: `$${key}`, msg: message(error) }))
      }
    }
    pushLog('info', tr('Reglages restaures'))
  },

  exportSettings: () => {
    const { savedSettings, machineId } = get()
    const data = savedSettings[machineId] ?? get().settings
    const blob = new Blob([JSON.stringify({ machineId, settings: data }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `grbl-${machineId}.json`
    link.click()
    URL.revokeObjectURL(url)
  },

  importSettings: (json) => {
    try {
      const parsed = JSON.parse(json) as { machineId?: unknown; settings?: unknown }
      if (!parsed || typeof parsed !== 'object') throw new Error('JSON invalide')
      const id = typeof parsed.machineId === 'string' ? parsed.machineId : get().machineId
      const source = (parsed.settings ?? parsed) as Record<string, unknown>
      // Seules des paires $n = nombre sont acceptees (rien d'autre n'est renvoye a GRBL).
      const settings: Record<number, string> = {}
      for (const [key, value] of Object.entries(source)) {
        const code = Number(key)
        const text = String(value).trim()
        if (Number.isInteger(code) && code >= 0 && /^[-+]?\d*\.?\d+$/.test(text)) settings[code] = text
      }
      if (!Object.keys(settings).length) throw new Error('aucun reglage $n=valeur')
      const next = { ...get().savedSettings, [id]: settings }
      set({ savedSettings: next })
      saveJSON('savedSettings', next)
      pushLog('info', tr('Reglages importes pour {id}', { id }))
    } catch (error) {
      pushLog('error', tr('Import impossible: {msg}', { msg: message(error) }))
    }
  },

  runProbe: async () => {
    if (!guard()) return
    pushLog('info', tr('Palpage Z en cours…'))
    try {
      const machine = get().machines.find((m) => m.id === get().machineId)
      const probe = { ...get().probe }
      if (machine) probe.maxDepth = Math.max(probe.maxDepth, machine.area.z)
      await probeZ(client, probe, (key, params) => pushLog('info', tr(key, params)))
      void client.send('$#').catch(() => undefined)
    } catch (error) {
      pushLog('error', tr('Palpage echoue: {msg} (verifiez le cablage et $6, puis $X)', { msg: message(error) }))
    }
  },

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

  setJogStep: (step) => set({ jogStep: step }),
  setJogFeed: (feed) => set({ jogFeed: feed }),
  setDryRun: (dryRun) => set({ dryRun }),

  loadFile: (name, text, jobType = 'mill') => {
    if (streamer.isRunning) {
      pushLog('error', tr('Programme en cours : arretez-le avant d\'en charger un autre'))
      return
    }
    const toolpath = parseGcode(text)
    streamer.load(text)
    set({
      fileName: name,
      rawGcode: text,
      jobType,
      toolpath,
      stream: { state: 'idle', sent: 0, total: streamer.total },
    })
    pushLog('info', tr('Fichier charge: {name} ({lines} lignes, {moves} mouvements)', { name, lines: toolpath.lines, moves: toolpath.moves }))
    for (const warning of toolpath.warnings) pushLog('info', tr('Apercu: {msg}', { msg: warning }))
  },

  startStream: async () => {
    const { connected, dryRun, rawGcode, params, jobType, settings } = get()
    if (!connected) {
      pushLog('error', tr('Non connecte'))
      return
    }
    if (!rawGcode) {
      pushLog('error', tr('Aucun programme charge'))
      return
    }
    if (streamer.isRunning) return
    const machineState = get().status?.state
    if (machineState !== 'Idle' && machineState !== 'Check') {
      pushLog('error', tr('Machine non prete (etat {state}) : attendez Idle, ou deverrouillez ($X) / faites le homing', { state: machineState ?? '?' }))
      return
    }
    const lines = dryRun ? raiseZ(programLines(rawGcode), params.safeZ) : programLines(rawGcode)
    const tooLong = lines.findIndex((line) => !parsePause(line) && grblLineLength(line) > MAX_LINE_CHARS)
    if (tooLong >= 0) {
      pushLog('error', tr('Ligne {n} trop longue pour GRBL ({max} caracteres max) : {line}', { n: tooLong + 1, max: MAX_LINE_CHARS, line: lines[tooLong].slice(0, 60) }))
      return
    }
    // En essai a blanc, l'emprise est celle du programme rehausse (Z de securite + rehausse).
    const toolpathData = dryRun ? parseGcode(lines.join('\n')) : get().toolpath
    const check = jobLimits(toolpathData, get())
    if (check && !check.ok) {
      pushLog('error', tr('Programme hors zone de travail : {detail}', { detail: check.messages.join(' ; ') }))
      return
    }
    if (!dryRun) {
      if (jobType === 'laser') {
        if (settings[32] === undefined) {
          pushLog('error', tr('Programme LASER : verifiez $32 (mode laser) avec « Lire $$ » avant de lancer.'))
          return
        }
        if (settings[32] !== '1') {
          pushLog('error', tr('Programme LASER mais $32=0 : activez $32=1 (onglet Laser) sinon la broche est pilotee a la place du laser.'))
          return
        }
      } else if (jobType === 'mill' && settings[32] === '1') {
        pushLog('error', tr('Programme de FRAISAGE mais $32=1 (mode laser) : remettez $32=0 sinon la broche ne tournera pas.'))
        return
      }
    }
    streamer.loadLines(lines)
    if (dryRun) pushLog('info', tr('Essai à blanc : Z +{z} mm, broche coupée', { z: params.safeZ }))
    pushLog('info', tr('Demarrage du programme'))
    await streamer.start()
  },
  pauseStream: () => streamer.pause(),
  resumeStream: () => streamer.resume(),
  stopStream: () => streamer.stop(),

  clearLog: () => set({ log: [] }),
}))

export const streamer = new GcodeStreamer(client, {
  onProgress: (progress) =>
    useStore.setState((state) => ({ stream: { ...state.stream, sent: progress.sent, total: progress.total } })),
  onStateChange: (streamState, reason) =>
    useStore.setState((state) => ({
      stream: {
        ...state.stream,
        state: streamState,
        pauseReason: streamState === 'paused' ? reason : undefined,
        pauseMessage: streamState === 'paused' ? state.stream.pauseMessage : undefined,
      },
    })),
  onProgramPause: (text) => {
    const pauseMessage = text || tr('Pause programme (M0)')
    useStore.setState((state) => ({ stream: { ...state.stream, pauseMessage } }))
    pushLog('info', tr('Pause programme : {msg} — machine arrêtée, commandes manuelles autorisées. « Reprendre » pour continuer.', { msg: pauseMessage }))
  },
  onDone: () => pushLog('info', tr('Programme termine')),
  onError: (error) => pushLog('error', tr('Erreur programme: {msg} — machine arrêtée (feed hold + reset)', { msg: describeGrblCode(error.message) })),
})

if (typeof window !== 'undefined') {
  // Jog continu : si la fenetre perd le focus, le relachement du bouton peut
  // ne jamais arriver -> on annule le jog.
  const cancelContinuous = () => {
    if (!continuousJog) return
    continuousJog = false
    client.jogCancel()
  }
  window.addEventListener('blur', cancelContinuous)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelContinuous()
  })
  // Fermer/recharger la page pendant un job couperait le flux en pleine coupe.
  window.addEventListener('beforeunload', (event) => {
    if (!streamer.isRunning) return
    event.preventDefault()
    event.returnValue = ''
  })
}

client.on('connected', () => {
  useStore.setState({ connected: true })
  pushLog('info', tr('Connecte a GRBL'))
})
client.on('disconnected', () => {
  lastWco = null
  continuousJog = false
  useStore.setState({ connected: false, status: null, homed: false })
  pushLog('info', tr('Deconnecte'))
})
client.on('welcome', (line) => {
  useStore.setState({ welcome: line })
  pushLog('info', line)
})
client.on('status', (status) => {
  if (status.wco) lastWco = status.wco
  // Les rapports sans WCO gardent le dernier decalage connu, et MPos/WPos
  // manquant ($10) est reconstitue : MPos = WPos + WCO.
  const merged: GrblStatus = { ...status, wco: status.wco ?? lastWco ?? undefined }
  const wco = merged.wco
  if (wco && !merged.mpos && merged.wpos) {
    merged.mpos = { x: merged.wpos.x + wco.x, y: merged.wpos.y + wco.y, z: merged.wpos.z + wco.z }
  } else if (wco && !merged.wpos && merged.mpos) {
    merged.wpos = { x: merged.mpos.x - wco.x, y: merged.mpos.y - wco.y, z: merged.mpos.z - wco.z }
  }
  useStore.setState({ status: merged, homed: status.homed ?? false })
})
client.on('alarm', (line) => pushLog('error', describeGrblCode(line)))
client.on('error', (error) => pushLog('error', message(error)))
client.on('line', (line) => {
  if (line.startsWith('<') || line === 'ok') return
  pushLog('in', line.startsWith('error:') ? describeGrblCode(line) : line)
})
client.on('sent', (line) => {
  if (useStore.getState().stream.state === 'running') return
  pushLog('out', line)
})
client.on('feedback', (feedback) => {
  if (feedback.kind === 'setting') {
    useStore.setState((state) => ({ settings: { ...state.settings, [feedback.key]: feedback.value } }))
  } else if (feedback.kind === 'parser') {
    const [key, value] = Object.entries(feedback.data)[0] ?? []
    if (!key) return
    if (key === 'GC') {
      useStore.setState({ parserState: value })
    } else if (key.startsWith('G5') || key === 'G92') {
      const [x, y, z] = value.split(',').map(Number)
      if (![x, y, z].some(Number.isNaN)) {
        useStore.setState((state) => ({ offsets: { ...state.offsets, [key]: { x, y, z } } }))
      }
    }
  }
})

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
