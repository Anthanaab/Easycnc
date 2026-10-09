import { Emitter } from './emitter'
import { parseFeedback, parseStatus } from './parser'
import { SerialTransport } from './transport'
import type { Feedback, GrblStatus } from './types'

interface Task {
  line: string
  bytes: number
  resolve: () => void
  reject: (error: Error) => void
}

export interface GrblEvents extends Record<string, unknown> {
  status: GrblStatus
  line: string
  sent: string
  feedback: Feedback
  alarm: string
  welcome: string
  error: Error
  connected: void
  disconnected: void
}

// Taille du buffer de reception GRBL (128 octets) moins 1 de marge.
const RX_BUDGET = 127
// Tampon de ligne GRBL (LINE_BUFFER_SIZE = 80) : au-dela, error:11. GRBL ignore
// les espaces et les commentaires avant de remplir ce tampon.
export const MAX_LINE_CHARS = 79
// Commandes qui modifient le decalage de travail (WCO).
const WCO_CHANGE = /G\s*0*(?:10|92(?:\.\d)?|5[4-9]|43\.1|49)(?![0-9])/i
// Delai max d'attente du message de bienvenue apres ouverture / reset.
const BOOT_TIMEOUT_MS = 3000

/** Longueur effective d'une ligne dans le tampon GRBL (sans espaces ni commentaires). */
export function grblLineLength(line: string): number {
  return line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').replace(/\s+/g, '').length
}

/**
 * Client GRBL implementant le protocole "character-counting" pour
 * remplir le buffer serie sans depassement, plus les commandes temps-reel.
 */
export class GrblClient extends Emitter<GrblEvents> {
  private readonly transport = new SerialTransport()
  private pending: Task[] = []
  private inFlight: Task[] = []
  private txCount = 0
  private pollTimer: number | null = null
  private _connected = false
  private _baudRate = 115200
  private homing = false
  // Faux tant que GRBL n'a pas (re)demarre : evite d'envoyer des lignes
  // pendant le boot (reset DTR) ou apres un reset/alarme, ou elles seraient
  // perdues et desynchroniseraient le comptage des "ok".
  private ready = false
  private readyTimer: number | null = null

  status: GrblStatus | null = null
  /** Vrai entre un changement d'origine (G10/G92/G5x/G43.1) et le rapport WCO suivant. */
  wcoStale = false
  welcome: string | null = null
  homed = false
  lastProbe: { pos: { x: number; y: number; z: number }; ok: boolean } | null = null

  clearLastProbe(): void {
    this.lastProbe = null
  }

  constructor() {
    super()
    this.transport.onLine = (line) => this.handleLine(line)
    this.transport.onClose = () => this.handleDisconnect()
    this.transport.onError = (error) => this.emit('error', toError(error))
  }

  static isSupported(): boolean {
    return SerialTransport.isSupported()
  }

  get connected(): boolean {
    return this._connected
  }

  get baudRate(): number {
    return this._baudRate
  }

  /** Vrai quand GRBL a demarre et accepte des lignes. */
  get isReady(): boolean {
    return this._connected && this.ready
  }

  async connect(baudRate = this._baudRate): Promise<void> {
    if (this._connected) return
    this._baudRate = baudRate
    this.txCount = 0
    this.pending = []
    this.inFlight = []
    this.welcome = null
    this.status = null
    await this.transport.requestAndOpen(baudRate)
    this._connected = true
    // La plupart des cartes GRBL redemarrent a l'ouverture du port (DTR) :
    // on attend la banniere "Grbl x.y" (ou un premier rapport d'etat).
    this.waitForBoot()
    this.emit('connected', undefined)
    this.startPolling()
  }

  async disconnect(): Promise<void> {
    this.stopPolling()
    this.clearQueue(new Error('Deconnecte'))
    await this.transport.close()
    this.handleDisconnect()
  }

  private handleDisconnect(): void {
    if (!this._connected) return
    this._connected = false
    this.homed = false
    this.homing = false
    this.ready = false
    this.clearReadyTimer()
    this.stopPolling()
    this.clearQueue(new Error('Deconnecte'))
    this.status = null
    // Deconnexion inattendue (cable arrache) : libere le port pour pouvoir
    // se reconnecter sans recharger la page.
    if (this.transport.isOpen) void this.transport.close()
    this.emit('disconnected', undefined)
  }

  private clearReadyTimer(): void {
    if (this.readyTimer !== null) {
      window.clearTimeout(this.readyTimer)
      this.readyTimer = null
    }
  }

  /** Bloque l'envoi jusqu'au (re)demarrage de GRBL, avec un delai de secours. */
  private waitForBoot(timeoutMs = BOOT_TIMEOUT_MS): void {
    this.ready = false
    this.clearReadyTimer()
    this.readyTimer = window.setTimeout(() => {
      this.readyTimer = null
      if (!this._connected || this.ready) return
      // Certaines cartes ne redemarrent pas et n'envoient rien : on continue.
      this.markReady()
    }, timeoutMs)
  }

  private markReady(): void {
    this.clearReadyTimer()
    if (this.ready) return
    this.ready = true
    this.pump()
  }

  /**
   * Envoie une ligne de commande et resout la promesse quand GRBL repond
   * "ok". Rejette en cas de "error:" ou d'ALARM.
   */
  send(line: string): Promise<void> {
    const clean = line.replace(/[\r\n]/g, '').trim()
    if (!clean) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      if (!this._connected) {
        reject(new Error('Non connecte'))
        return
      }
      const bytes = clean.length + 1
      if (bytes > RX_BUDGET || grblLineLength(clean) > MAX_LINE_CHARS) {
        reject(new Error(`Ligne trop longue pour GRBL (${grblLineLength(clean)} caracteres) : ${clean.slice(0, 40)}…`))
        return
      }
      this.pending.push({ line: clean, bytes, resolve, reject })
      this.emit('sent', clean)
      this.pump()
    })
  }

  private pump(): void {
    if (!this.ready || !this._connected) return
    while (this.pending.length) {
      const task = this.pending[0]
      if (this.txCount + task.bytes > RX_BUDGET) break
      this.pending.shift()
      this.inFlight.push(task)
      this.txCount += task.bytes
      this.transport.write(task.line + '\n').catch((error) => {
        const index = this.inFlight.indexOf(task)
        if (index >= 0) this.inFlight.splice(index, 1)
        this.txCount -= task.bytes
        task.reject(toError(error))
        this.pump()
      })
    }
  }

  private acknowledge(): void {
    const task = this.inFlight.shift()
    if (task) {
      // Changement d'origine : GRBL renverra WCO dans le prochain rapport ;
      // jusque-la, le decalage connu est perime.
      if (WCO_CHANGE.test(task.line)) this.wcoStale = true
      this.txCount -= task.bytes
      task.resolve()
    }
    this.pump()
  }

  private rejectOldest(error: Error): void {
    const task = this.inFlight.shift()
    if (task) {
      this.txCount -= task.bytes
      task.reject(error)
    }
    this.pump()
  }

  private rejectInFlight(reason: Error): void {
    const tasks = this.inFlight
    this.inFlight = []
    this.txCount = 0
    for (const task of tasks) task.reject(reason)
  }

  /** Vide la file d'attente (utile pour stop / reset). */
  clearQueue(reason: Error): void {
    const tasks = [...this.inFlight, ...this.pending]
    this.inFlight = []
    this.pending = []
    this.txCount = 0
    for (const task of tasks) task.reject(reason)
  }

  private handleLine(line: string): void {
    this.emit('line', line)

    if (line.startsWith('ok')) {
      this.acknowledge()
      return
    }
    if (line.startsWith('error:')) {
      this.rejectOldest(new Error(line))
      return
    }
    if (line.startsWith('ALARM')) {
      // GRBL fait un reset interne (tampon serie vide) puis renvoie sa banniere :
      // on attend celle-ci avant de renvoyer quoi que ce soit.
      this.homed = false
      this.homing = false
      this.waitForBoot(1500)
      this.clearQueue(new Error(line))
      this.emit('alarm', line)
      return
    }
    if (line.startsWith('<')) {
      const status = parseStatus(line)
      if (status) {
        if (status.wco) this.wcoStale = false
        // Un rapport d'etat prouve que GRBL tourne (cartes sans banniere).
        if (!this.ready) this.markReady()
        if (status.state === 'Home') this.homing = true
        else if (this.homing && status.state === 'Idle') {
          this.homed = true
          this.homing = false
        } else if (status.state === 'Alarm') {
          this.homed = false
          this.homing = false
        }
        status.homed = this.homed
        this.status = status
        this.emit('status', status)
      }
      return
    }
    if (line.startsWith('Grbl ')) {
      // Banniere = GRBL vient de (re)demarrer : ce qui etait dans son tampon
      // est perdu. Redemarrage attendu (connexion, reset, alarme) : seules les
      // lignes deja envoyees sont perdues, celles en attente sont pour la
      // nouvelle session. Redemarrage inattendu (coupure, glitch) : tout est
      // purge pour ne pas executer la suite d'un programme hors contexte.
      this.welcome = line
      this.homed = false
      this.homing = false
      if (this.ready) {
        this.clearQueue(new Error('GRBL a redemarre'))
      } else {
        this.rejectInFlight(new Error('GRBL a redemarre'))
      }
      this.markReady()
      this.emit('welcome', line)
      return
    }

    const feedback = parseFeedback(line)
    if (feedback) {
      if (feedback.kind === 'probe') {
        this.lastProbe = { pos: { x: feedback.x, y: feedback.y, z: feedback.z }, ok: feedback.ok }
      }
      this.emit('feedback', feedback)
    }
  }

  // ----- Commandes temps-reel (hors file d'attente, sans newline) -----

  private writeRealtime(byte: number): void {
    if (!this.transport.isOpen) return
    this.transport.write(new Uint8Array([byte])).catch((error) => {
      this.emit('error', toError(error))
    })
  }

  statusQuery(): void {
    this.writeRealtime(0x3f) // '?'
  }

  feedHold(): void {
    this.writeRealtime(0x21) // '!'
  }

  cycleStart(): void {
    this.writeRealtime(0x7e) // '~'
  }

  softReset(): void {
    if (!this.transport.isOpen) return
    this.writeRealtime(0x18) // Ctrl-X
    this.homed = false
    this.homing = false
    this.waitForBoot(2000)
    this.clearQueue(new Error('Reset'))
  }

  jogCancel(): void {
    this.writeRealtime(0x85)
  }

  feedOverrideReset(): void {
    this.writeRealtime(0x90)
  }
  feedOverrideUp(): void {
    this.writeRealtime(0x91)
  }
  feedOverrideDown(): void {
    this.writeRealtime(0x92)
  }
  rapidOverride(level: '100' | '50' | '25'): void {
    this.writeRealtime(level === '100' ? 0x95 : level === '50' ? 0x96 : 0x97)
  }
  spindleOverrideReset(): void {
    this.writeRealtime(0x99)
  }
  spindleOverrideUp(): void {
    this.writeRealtime(0x9a)
  }
  spindleOverrideDown(): void {
    this.writeRealtime(0x9b)
  }

  // ----- Commandes utilitaires -----

  startPolling(intervalMs = 200): void {
    this.stopPolling()
    this.pollTimer = window.setInterval(() => {
      if (this._connected) this.statusQuery()
    }, intervalMs)
  }

  stopPolling(): void {
    if (this.pollTimer !== null) {
      window.clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  async unlock(): Promise<void> {
    await this.send('$X')
  }

  async home(): Promise<void> {
    this.homing = true
    try {
      // GRBL ne repond "ok" a $H qu'une fois le cycle termine avec succes.
      await this.send('$H')
      this.homed = true
    } finally {
      this.homing = false
    }
  }

  /** Attend que toutes les lignes deja envoyees soient executees (planner vide). */
  async sync(): Promise<void> {
    await this.send('G4 P0')
  }

  /** Interroge l'etat modal ($G) et renvoie le contenu du rapport [GC:...]. */
  async parserState(): Promise<string> {
    let gc: string | null = null
    const off = this.on('feedback', (feedback) => {
      if (feedback.kind === 'parser' && feedback.data.GC !== undefined) gc = feedback.data.GC
    })
    try {
      await this.send('$G')
    } finally {
      off()
    }
    if (gc === null) throw new Error('Etat modal ($G) non recu')
    return gc
  }

  /** Attend un rapport d'etat verifiant le predicat (ou rejette apres timeout). */
  waitForStatus(predicate: (status: GrblStatus) => boolean, timeoutMs: number): Promise<GrblStatus> {
    if (this.status && predicate(this.status)) return Promise.resolve(this.status)
    return new Promise<GrblStatus>((resolve, reject) => {
      const off = this.on('status', (status) => {
        if (!predicate(status)) return
        cleanup()
        resolve(status)
      })
      const offDisconnect = this.on('disconnected', () => {
        cleanup()
        reject(new Error('Deconnecte'))
      })
      const timer = window.setTimeout(() => {
        cleanup()
        reject(new Error('Delai depasse'))
      }, timeoutMs)
      const cleanup = () => {
        off()
        offDisconnect()
        window.clearTimeout(timer)
      }
    })
  }

  async requestSettings(): Promise<void> {
    await this.send('$$')
  }

  /** Jog GRBL 1.1: $J=G91 G21 X.. Y.. Z.. F.. */
  async jog(axis: 'X' | 'Y' | 'Z', distance: number, feed: number): Promise<void> {
    if (!Number.isFinite(distance) || !Number.isFinite(feed) || feed <= 0) {
      throw new Error('Jog : distance ou avance invalide')
    }
    const line = `$J=G91 G21 ${axis}${distance.toFixed(3)} F${Math.round(feed)}`
    await this.send(line)
  }

  /** Definir la position courante dans le repere de travail actif. */
  async setWorkZero(axes: Array<'X' | 'Y' | 'Z'>): Promise<void> {
    if (!axes.length) return
    const words = axes.map((axis) => `${axis}0`).join(' ')
    // P0 = repere de travail actif (G54..G59), pas forcement G54.
    await this.send(`G10 L20 P0 ${words}`)
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
