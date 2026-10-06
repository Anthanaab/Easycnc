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

  status: GrblStatus | null = null
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

  async connect(baudRate = this._baudRate): Promise<void> {
    this._baudRate = baudRate
    this.txCount = 0
    this.pending = []
    this.inFlight = []
    await this.transport.requestAndOpen(baudRate)
    this._connected = true
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
    this.stopPolling()
    this.clearQueue(new Error('Deconnecte'))
    this.status = null
    this.emit('disconnected', undefined)
  }

  /**
   * Envoie une ligne de commande et resout la promesse quand GRBL repond
   * "ok". Rejette en cas de "error:" ou d'ALARM.
   */
  send(line: string): Promise<void> {
    const clean = line.replace(/[\r\n]/g, '').trim()
    if (!clean) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const bytes = clean.length + 1
      if (bytes > RX_BUDGET) {
        reject(new Error(`Ligne trop longue pour GRBL (${bytes} octets)`))
        return
      }
      this.pending.push({ line: clean, bytes, resolve, reject })
      this.emit('sent', clean)
      this.pump()
    })
  }

  private pump(): void {
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
      this.emit('alarm', line)
      this.clearQueue(new Error(line))
      return
    }
    if (line.startsWith('<')) {
      const status = parseStatus(line)
      if (status) {
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
      this.welcome = line
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
    this.writeRealtime(0x18) // Ctrl-X
    this.homed = false
    this.homing = false
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
    await this.send('$H')
  }

  async requestSettings(): Promise<void> {
    await this.send('$$')
  }

  /** Jog GRBL 1.1: $J=G91 G21 X.. Y.. Z.. F.. */
  async jog(axis: 'X' | 'Y' | 'Z', distance: number, feed: number): Promise<void> {
    const line = `$J=G91 G21 ${axis}${distance.toFixed(3)} F${feed}`
    await this.send(line)
  }

  /** Definir la position courante dans le repere de travail actif. */
  async setWorkZero(axes: Array<'X' | 'Y' | 'Z'>): Promise<void> {
    if (!axes.length) return
    const words = axes.map((axis) => `${axis}0`).join(' ')
    await this.send(`G10 L20 P1 ${words}`)
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
