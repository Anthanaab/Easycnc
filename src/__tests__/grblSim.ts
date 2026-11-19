/**
 * Simulateur du protocole GRBL 1.1 (cote machine) pour les tests :
 * - tampon de reception de 128 octets : un depassement est enregistre
 *   (c'est exactement ce que le comptage de caracteres doit eviter) ;
 * - planificateur de 15 blocs : "ok" quand la ligne y entre, pas quand elle
 *   est executee ; une ligne attend dans le tampon serie si le planner est plein ;
 * - mouvement simule (blockMs par bloc), feed hold (Hold:1 -> Hold:0),
 *   cycle start, reset (ALARM:3 si reset en mouvement), G4 P0, $G, $H.
 */
export interface SimOptions {
  blockMs?: number
  decelMs?: number
  /** Ligne qui provoque "error:20". */
  errorOn?: string
  /** Taille du tampon de reception (128 sur GRBL, souvent 1024 sur grblHAL). */
  rxSize?: number
  banner?: string
}

type State = 'Idle' | 'Run' | 'Hold' | 'Alarm'

export class GrblSim {
  readonly executed: string[] = []
  readonly received: string[] = []
  overflow = false
  maxRx = 0
  resets = 0
  alarms: string[] = []
  private rx = ''
  private planner: string[] = []
  private state: State = 'Idle'
  private holdSub: 0 | 1 = 0
  private holdTimer: ReturnType<typeof setTimeout> | null = null
  private blockTimer: ReturnType<typeof setTimeout> | null = null
  private syncPending = false
  private readonly blockMs: number
  private readonly decelMs: number
  private stopped = false
  private wpos = { x: 0, y: 0, z: 0 }

  constructor(
    private readonly output: (line: string) => void,
    private readonly options: SimOptions = {},
  ) {
    this.blockMs = options.blockMs ?? 2
    this.decelMs = options.decelMs ?? 5
  }

  boot(): void {
    setTimeout(() => this.output(this.options.banner ?? "Grbl 1.1h ['$' for help]"), 1)
  }

  dispose(): void {
    this.stopped = true
    if (this.holdTimer) clearTimeout(this.holdTimer)
    if (this.blockTimer) clearTimeout(this.blockTimer)
  }

  get machineState(): string {
    return this.state === 'Hold' ? `Hold:${this.holdSub}` : this.state
  }

  /** Octets recus de l'hote. */
  write(data: string | Uint8Array): void {
    if (this.stopped) return
    const text = typeof data === 'string' ? data : String.fromCharCode(...data)
    for (const ch of text) {
      const code = ch.charCodeAt(0)
      if (ch === '?') this.report()
      else if (ch === '!') this.feedHold()
      else if (ch === '~') this.cycleStart()
      else if (code === 0x18) this.reset()
      else if (code >= 0x80) {
        /* overrides / jog cancel : sans effet ici */
      } else {
        this.rx += ch
        this.maxRx = Math.max(this.maxRx, this.rx.length)
        if (this.rx.length > (this.options.rxSize ?? 128)) this.overflow = true
      }
    }
    this.processRx()
  }

  private report(): void {
    const p = this.wpos
    setTimeout(() => {
      const free = (this.options.rxSize ?? 128) - 1 - this.rx.length
      if (!this.stopped)
        this.output(`<${this.machineState}|MPos:${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}|Bf:${15 - this.planner.length},${free}|FS:0,0|WCO:0.000,0.000,0.000>`)
    }, 0)
  }

  private processRx(): void {
    for (;;) {
      if (this.state === 'Alarm') {
        // Lignes ignorees (error:9) tant que l'alarme n'est pas levee.
        const nl = this.rx.indexOf('\n')
        if (nl < 0) return
        const line = this.rx.slice(0, nl).trim()
        this.rx = this.rx.slice(nl + 1)
        this.received.push(line)
        if (line === '$X') {
          this.state = 'Idle'
          this.reply('ok')
        } else this.reply('error:9')
        continue
      }
      if (this.syncPending) return
      const nl = this.rx.indexOf('\n')
      if (nl < 0) return
      const line = this.rx.slice(0, nl).trim()
      const isMotion = /^(G0?[0-3](?![0-9.])|[XYZ])/i.test(line)
      if (isMotion && this.planner.length >= 15) return // planner plein : la ligne reste dans le tampon serie
      this.rx = this.rx.slice(nl + 1)
      this.received.push(line)
      if (this.options.errorOn && line === this.options.errorOn) {
        this.reply('error:20')
        continue
      }
      if (/^G4\s*P0/i.test(line)) {
        this.syncPending = true
        this.waitEmpty(() => {
          this.syncPending = false
          this.reply('ok')
          this.processRx()
        })
        return
      }
      if (line === '$G') {
        this.reply('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]')
        this.reply('ok')
        continue
      }
      if (line === '$H') {
        this.reply('ok')
        continue
      }
      if (isMotion) {
        this.planner.push(line)
        this.reply('ok')
        this.startMotion()
        continue
      }
      this.executed.push(line)
      this.reply('ok')
    }
  }

  private reply(line: string): void {
    setTimeout(() => {
      if (!this.stopped) this.output(line)
    }, 0)
  }

  private startMotion(): void {
    if (this.state === 'Idle') this.state = 'Run'
    if (this.state !== 'Run' || this.blockTimer) return
    this.blockTimer = setTimeout(() => {
      this.blockTimer = null
      if (this.state !== 'Run') return
      const line = this.planner.shift()
      if (line) {
        this.executed.push(line)
        const x = /X(-?[\d.]+)/i.exec(line)
        if (x) this.wpos.x = Number(x[1])
      }
      if (this.planner.length) this.startMotion()
      else this.state = 'Idle'
      this.processRx()
      this.notifyEmpty()
    }, this.blockMs)
  }

  private emptyWaiters: Array<() => void> = []
  private waitEmpty(fn: () => void): void {
    if (!this.planner.length && this.state !== 'Run') fn()
    else this.emptyWaiters.push(fn)
  }
  private notifyEmpty(): void {
    if (this.planner.length || this.state === 'Run') return
    const waiters = this.emptyWaiters.splice(0)
    for (const fn of waiters) fn()
  }

  private feedHold(): void {
    if (this.state !== 'Run') return
    this.state = 'Hold'
    this.holdSub = 1
    if (this.blockTimer) clearTimeout(this.blockTimer)
    this.blockTimer = null
    this.holdTimer = setTimeout(() => {
      this.holdSub = 0
    }, this.decelMs)
  }

  private cycleStart(): void {
    if (this.state !== 'Hold') return
    this.state = this.planner.length ? 'Run' : 'Idle'
    if (this.state === 'Run') this.startMotion()
  }

  private reset(): void {
    this.resets++
    const moving = this.state === 'Run' || (this.state === 'Hold' && this.holdSub === 1)
    if (this.blockTimer) clearTimeout(this.blockTimer)
    if (this.holdTimer) clearTimeout(this.holdTimer)
    this.blockTimer = null
    this.rx = ''
    this.planner = []
    this.syncPending = false
    this.emptyWaiters = []
    if (moving) {
      // Reset en mouvement : position perdue.
      this.alarms.push('ALARM:3')
      this.state = 'Alarm'
      this.reply('ALARM:3')
    } else {
      this.state = this.state === 'Alarm' ? 'Alarm' : 'Idle'
    }
    this.reply("Grbl 1.1h ['$' for help]")
  }
}
