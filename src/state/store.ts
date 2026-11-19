import { create } from 'zustand'
import { BITS } from '../data/bits'
import { MACHINES } from '../data/machines'
import { MATERIALS, findMaterial } from '../data/materials'
import { autoParams, type CutParams } from '../data/params'
import type { Bit, MachineProfile, Material, ProbeSettings } from '../data/types'
import { GrblClient, MAX_LINE_CHARS, grblLineLength } from '../grbl/GrblClient'
import { measureTool, probeCorner, probeZ, toolLengthOffset, type Corner } from '../grbl/probe'
import { tr } from '../i18n'
import type { GrblStatus, LogEntry, Vec3 } from '../grbl/types'
import { raiseZWithMap } from '../gcode/dryrun'
import { resumeProgram } from '../gcode/resume'
import { estimateMinutes } from '../gcode/estimate'
import { detectJobType, parseGcode, type Toolpath } from '../gcode/parser'
import { parseGcodeInWorker } from '../cam/workerClient'
import { createLibraryActions } from './library'
import { jobLimits, travelOf } from './limits'
import { recordJobEnd, recordJobStart } from './jobHistory'
import { notifyJob, requestJobNotifications } from './notify'
import { loadJSON, saveJSON } from './persist'
import { GcodeStreamer, parsePause, programLines, splitComment, type PauseReason, type StreamState } from '../gcode/streamer'
import { describeGrblCode } from '../grbl/codes'

export { jobLimits } from './limits'

let logId = 0
const MAX_LOG = 800

export const client = new GrblClient()

export interface StreamInfo {
  state: StreamState
  sent: number
  total: number
  pauseReason?: PauseReason
  pauseMessage?: string
  /** Lignes acquittees par GRBL (avancement reel, a ~15 blocs pres). */
  done?: number
  /** Debut du programme (ms) pour le temps ecoule / restant. */
  startedAt?: number
  /** Decalage entre lignes envoyees et lignes du fichier (reprise a une ligne). */
  lineOffset?: number
  /** Ligne du fichier correspondant a chaque ligne envoyee (essai a blanc, reprise). */
  lineMap?: Int32Array
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
  /** Correction de longueur d'outil active (G43.1), rapport [TLO:] de $#. */
  tlo: number | null
  /** Z machine du contact de l'outil de reference sur le capteur. */
  toolRef: number | null
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
  /** Analyse du G-code en cours (gros fichiers, dans le worker). */
  parsing: boolean
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
  goToWorkZero: () => void
  requestSettings: () => void
  readSettings: () => void
  saveSettings: () => void
  restoreSettings: () => Promise<void>
  exportSettings: () => void
  importSettings: (json: string) => void
  runProbe: () => Promise<void>
  runCornerProbe: (corner: Corner) => Promise<void>
  measureReferenceTool: () => Promise<void>
  measureNewTool: () => Promise<void>
  clearToolOffset: () => void
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
  setJobType: (jobType: 'mill' | 'laser') => void
  /** fromLine : reprise a cette ligne du programme (1 = debut). */
  startStream: (fromLine?: number) => Promise<void>
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

// GRBL n'envoie WCO que periodiquement (tous les 10-30 rapports) : on garde le dernier.
let lastWco: Vec3 | null = null

/** Duree estimee (s) du programme, pour calibrer l'estimation avec l'historique. */
function estimatedSecondsFor(toolpath: Toolpath | null, state: AppState): number | undefined {
  const machine = state.machines.find((m) => m.id === state.machineId)
  if (!toolpath || !machine) return undefined
  const accel = Math.min(Number(state.settings[120]) || 500, Number(state.settings[121]) || 500)
  return estimateMinutes(toolpath, { feed: state.params.feed, rapid: machine.rapid, accel }).minutes * 60
}

/** Mesure sur le capteur fixe ; null (et message) si impossible. */
async function toolsetterMeasure(): Promise<number | null> {
  if (!guard()) return null
  const state = useStore.getState()
  if (state.status?.state !== 'Idle') {
    pushLog('error', tr('Machine non prête (attendez Idle)'))
    return null
  }
  const machine = state.machines.find((m) => m.id === state.machineId) ?? state.machines[0]
  const travelZ = travelOf(state.settings, machine.area).z
  const mz = state.status?.mpos?.z ?? 0
  // Haut de course : espace GRBL negatif [-course, 0] par defaut, sinon [0, course].
  const topZ = mz <= 0.5 ? -1 : travelZ - 1
  try {
    return await measureTool(client, state.probe, { homed: state.homed, topZ }, (key, params) => pushLog('info', tr(key, params)))
  } catch (error) {
    pushLog('error', tr('Mesure d’outil échouée : {msg}', { msg: describeGrblCode(message(error)) }))
    return null
  }
}

// Chargements successifs : seul le dernier resultat d'analyse compte.
let loadCounter = 0

// Jog continu en cours (annule si la fenetre perd le focus).
let continuousJog = false

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
  tlo: null,
  toolRef: loadJSON<number | null>('toolRef.' + initialMachineId, null),
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
  parsing: false,
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
    if (streamer.isRunning) recordJobEnd('stopped', streamer.acked, 'Reset')
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
  goToWorkZero: () => {
    if (!guard()) return
    const { status, params } = get()
    if (status?.state !== 'Idle') {
      pushLog('error', tr('Machine non prête (attendez Idle)'))
      return
    }
    // Monte d'abord (jamais de deplacement XY a basse altitude), puis X0 Y0.
    const z = Math.max(status.wpos?.z ?? params.safeZ, params.safeZ)
    void (async () => {
      try {
        await client.send('G90')
        await client.send(`G0 Z${z.toFixed(3)}`)
        await client.send('G0 X0 Y0')
      } catch (error) {
        pushLog('error', describeGrblCode(message(error)))
      }
    })()
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

  measureReferenceTool: async () => {
    const contact = await toolsetterMeasure()
    if (contact === null) return
    set({ toolRef: contact })
    saveJSON('toolRef.' + get().machineId, contact)
    // L'outil de reference definit la longueur nulle : pas de correction active.
    await client.send('G49').catch(() => undefined)
    void client.send('$#').catch(() => undefined)
    pushLog('info', tr('Outil de référence mesuré (Z machine {z}). Définissez Z0 avec cet outil.', { z: contact.toFixed(3) }))
  },

  measureNewTool: async () => {
    const reference = get().toolRef
    if (reference === null) {
      pushLog('error', tr("Mesurez d'abord l'outil de référence"))
      return
    }
    const contact = await toolsetterMeasure()
    if (contact === null) return
    const offset = toolLengthOffset(reference, contact)
    if (Math.abs(offset) > 50) {
      pushLog('error', tr('Écart de longueur {mm} mm invraisemblable : correction non appliquée', { mm: offset.toFixed(3) }))
      return
    }
    try {
      await client.send(`G43.1 Z${offset.toFixed(3)}`)
      void client.send('$#').catch(() => undefined)
      pushLog('info', tr('Correction de longueur appliquée : G43.1 Z{mm}', { mm: offset.toFixed(3) }))
    } catch (error) {
      pushLog('error', describeGrblCode(message(error)))
    }
  },

  clearToolOffset: () => {
    if (!guard()) return
    client
      .send('G49')
      .then(() => client.send('$#'))
      .catch((error) => pushLog('error', describeGrblCode(message(error))))
  },

  runCornerProbe: async (corner) => {
    if (!guard()) return
    if (get().status?.state !== 'Idle') {
      pushLog('error', tr('Machine non prête (attendez Idle)'))
      return
    }
    try {
      const machine = get().machines.find((m) => m.id === get().machineId)
      const probe = { ...get().probe }
      if (machine) probe.maxDepth = Math.max(probe.maxDepth, machine.area.z)
      const bit = get().bits.find((b) => b.id === get().bitId) ?? get().bits[0]
      await probeCorner(client, probe, { corner, toolDiameter: bit.diameter }, (key, params) =>
        pushLog('info', tr(key, { ...params, corner: tr(`corner.${corner}`) })),
      )
      void client.send('$#').catch(() => undefined)
    } catch (error) {
      pushLog('error', tr('Palpage echoue: {msg} (verifiez le cablage et $6, puis $X)', { msg: message(error) }))
    }
  },

  ...createLibraryActions(set, get, pushLog),

  setJogStep: (step) => set({ jogStep: step }),
  setJogFeed: (feed) => set({ jogFeed: feed }),
  setDryRun: (dryRun) => set({ dryRun }),

  setJobType: (jobType) => {
    if (streamer.isRunning || !get().rawGcode) return
    set({ jobType })
  },

  loadFile: (name, text, jobType = detectJobType(text)) => {
    if (streamer.isRunning) {
      pushLog('error', tr('Programme en cours : arretez-le avant d\'en charger un autre'))
      return
    }
    streamer.load(text)
    const loadId = ++loadCounter
    const done = (toolpath: Toolpath) => {
      // Un autre fichier a ete charge entre-temps : resultat perime.
      if (loadId !== loadCounter) return
      set({ toolpath, parsing: false })
      pushLog('info', tr('Fichier charge: {name} ({lines} lignes, {moves} mouvements)', { name, lines: toolpath.lines, moves: toolpath.moves }))
      for (const warning of toolpath.warnings) pushLog('info', tr('Apercu: {msg}', { msg: warning }))
    }
    set({
      fileName: name,
      rawGcode: text,
      jobType,
      toolpath: null,
      parsing: true,
      stream: { state: 'idle', sent: 0, total: streamer.total },
    })
    // Petits fichiers : immediat. Gros fichiers : analyse dans le worker (page fluide).
    if (text.length < 200_000) {
      done(parseGcode(text))
    } else {
      pushLog('info', tr('Analyse de {name}…', { name }))
      parseGcodeInWorker(text).then(done, (error) => {
        if (loadId !== loadCounter) return
        set({ parsing: false })
        pushLog('error', tr('Analyse impossible : {msg}', { msg: message(error) }))
      })
    }
  },

  startStream: async (fromLine) => {
    // Pendant le clic (geste utilisateur) : autorisation des notifications de fin.
    requestJobNotifications()
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
    // Sans apercu analyse, pas de controle d'emprise : demarrage refuse.
    if (get().parsing || !get().toolpath) {
      pushLog('error', tr('Analyse du programme en cours : patientez'))
      return
    }
    const machineState = get().status?.state
    if (machineState !== 'Idle' && machineState !== 'Check') {
      pushLog('error', tr('Machine non prete (etat {state}) : attendez Idle, ou deverrouillez ($X) / faites le homing', { state: machineState ?? '?' }))
      return
    }
    if (client.wcoStale) {
      // Origine tout juste modifiee : on attend le nouveau WCO avant de controler l'emprise.
      try {
        await client.waitForStatus((s) => s.wco !== undefined, 2000)
      } catch {
        pushLog('error', tr('Décalage de travail non confirmé par GRBL : réessayez'))
        return
      }
    }
    let resumeOffset = 0
    const original = programLines(rawGcode)
    // Correspondance ligne envoyee -> ligne du fichier, pour l'avancement affiche.
    let lines = original
    let origin = original.map((_, i) => i)
    if (dryRun) {
      const raised = raiseZWithMap(original, params.safeZ)
      lines = raised.lines
      origin = raised.origin
    }
    if (fromLine && fromLine > 1) {
      try {
        const plan = resumeProgram(lines, fromLine - 1, { safeZ: params.safeZ, plunge: params.plunge })
        lines = plan.lines
        resumeOffset = fromLine - 1 - plan.preamble
        // Preambule de reprise : rattache a la ligne de reprise.
        const startOrigin = origin[fromLine - 1] ?? 0
        origin = [...new Array<number>(plan.preamble).fill(startOrigin), ...origin.slice(fromLine - 1)]
      } catch (error) {
        pushLog('error', message(error))
        return
      }
      pushLog('info', tr('Reprise à la ligne {n} : Z sécurité, placement, broche, plongée', { n: fromLine }))
    }
    const invalid = lines.findIndex((line) => /nan|infinity/i.test(splitComment(line).code))
    if (invalid >= 0) {
      pushLog('error', tr('Ligne {n} invalide (valeur non numérique) : {line}', { n: invalid + 1, line: lines[invalid].slice(0, 60) }))
      return
    }
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
    set((state) => ({ stream: { ...state.stream, done: 0, startedAt: Date.now(), lineOffset: resumeOffset, lineMap: Int32Array.from(origin) } }))
    if (dryRun) pushLog('info', tr('Essai à blanc : Z +{z} mm, broche coupée', { z: params.safeZ }))
    pushLog('info', tr('Demarrage du programme'))
    const state = get()
    recordJobStart({
      file: state.fileName ?? '—',
      jobType: state.jobType,
      dryRun,
      lines: lines.length,
      material: state.materials.find((m) => m.id === state.materialId)?.name,
      bit: state.bits.find((b) => b.id === state.bitId)?.name,
      fromLine: fromLine && fromLine > 1 ? fromLine : undefined,
      estimatedSeconds: estimatedSecondsFor(toolpathData, state),
    })
    await streamer.start()
  },
  pauseStream: () => streamer.pause(),
  resumeStream: () => streamer.resume(),
  stopStream: () => {
    if (streamer.isRunning) recordJobEnd('stopped', streamer.acked)
    streamer.stop()
  },

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
    notifyJob(tr('Pause programme (M0)'), pauseMessage)
  },
  onDone: () => {
    useStore.setState((state) => ({ stream: { ...state.stream, done: state.stream.total } }))
    pushLog('info', tr('Programme termine'))
    recordJobEnd('done', streamer.total)
    notifyJob(tr('Programme terminé'), useStore.getState().fileName ?? '')
  },
  onError: (error) => {
    const msg = describeGrblCode(error.message)
    pushLog('error', tr('Erreur programme: {msg} — machine arrêtée (feed hold + reset)', { msg }))
    notifyJob(tr('Programme arrêté sur erreur'), msg)
    recordJobEnd('error', streamer.acked, msg)
  },
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
  const patch: Partial<AppState> = { status: merged, homed: status.homed ?? false }
  // Avancement reel du programme, rafraichi au rythme des rapports d'etat (5/s).
  if (streamer.isRunning && useStore.getState().stream.done !== streamer.acked) {
    patch.stream = { ...useStore.getState().stream, done: streamer.acked }
  }
  useStore.setState(patch)
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
    } else if (key === 'TLO') {
      const tlo = Number(value)
      if (Number.isFinite(tlo)) useStore.setState({ tlo })
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
