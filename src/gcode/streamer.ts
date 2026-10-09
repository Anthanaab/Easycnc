import type { GrblClient } from '../grbl/GrblClient'
import { stripComments } from './parser'

export type StreamState = 'idle' | 'running' | 'paused'

/** 'user' = feed hold demande par l'utilisateur ; 'program' = M0 du programme (machine a l'arret). */
export type PauseReason = 'user' | 'program'

export interface StreamProgress {
  sent: number
  total: number
}

export interface StreamCallbacks {
  onProgress?: (progress: StreamProgress) => void
  onDone?: () => void
  onError?: (error: Error) => void
  onStateChange?: (state: StreamState, reason?: PauseReason) => void
  /** Pause programme (M0) : message eventuel du commentaire, ex. changement d'outil. */
  onProgramPause?: (message: string) => void
}

// Nombre max de lignes confiees au client GRBL (qui gere lui-meme le
// remplissage exact du tampon serie par comptage de caracteres).
const MAX_IN_FLIGHT = 32
// Temporisation de mise en vitesse de la broche apres restauration (s).
const SPINUP_SECONDS = 2

const PAUSE_WORD = /(^|[^A-Z])M0*0(?![0-9.])/i

/** Retire les numeros de ligne et checksums eventuels d'un post-processeur. */
function normalizeLine(line: string): string {
  let out = line.replace(/\*[0-9]+\s*$/, '').trim()
  out = out.replace(/^N\d+\s*/i, '')
  return out
}

/** Separe le code d'un commentaire entre parentheses eventuel. */
export function splitComment(line: string): { code: string; comment: string } {
  const comments: string[] = []
  const code = line
    .replace(/\(([^)]*)\)/g, (_m, text: string) => {
      comments.push(text.trim())
      return ' '
    })
    .replace(/\s+/g, ' ')
    .trim()
  return { code, comment: comments.filter(Boolean).join(' ') }
}

/** Ligne de pause programme (M0) : renvoie le code restant et le message. */
export function parsePause(line: string): { rest: string; message: string } | null {
  const { code, comment } = splitComment(line)
  if (!PAUSE_WORD.test(code)) return null
  const rest = code.replace(new RegExp(PAUSE_WORD.source, 'gi'), '$1').replace(/\s+/g, ' ').trim()
  return { rest, message: comment }
}

/**
 * Transforme une source G-code en lignes pretes a etre envoyees.
 * Les commentaires sont retires, sauf sur les lignes M0 ou ils servent de
 * message de pause (ex. « Changer l'outil »). Ces lignes ne sont jamais
 * envoyees telles quelles a GRBL : le streamer les intercepte.
 */
export function programLines(source: string): string[] {
  const out: string[] = []
  for (const raw of source.split(/\r?\n/)) {
    const [stripped] = stripComments(raw)
    if (!stripped) continue
    const line = normalizeLine(stripped)
    if (!line) continue
    if (PAUSE_WORD.test(line)) {
      const comment = splitComment(raw.replace(/;.*$/, '')).comment
      out.push(comment ? `${line} (${comment.replace(/[()]/g, '')})` : line)
    } else {
      out.push(line)
    }
  }
  return out
}

/** Mots modaux a restaurer apres une pause programme (rapport [GC:...] de $G). */
function modalRestore(gc: string): { modal: string; spindle: string | null } {
  const words = gc.trim().split(/\s+/)
  const modal = words.filter((w) => /^(G1[789]|G2[01]|G9[01]|G9[34]|G5[4-9]|F[\d.]+)$/.test(w))
  const spindleWord = words.find((w) => /^M[345]$/.test(w))
  const speed = words.find((w) => /^S[\d.]+$/.test(w))
  const spindle = spindleWord && spindleWord !== 'M5' ? `${spindleWord}${speed ? ` ${speed}` : ''}` : null
  return { modal: modal.join(' '), spindle }
}

/**
 * Envoie un programme G-code a GRBL en respectant le flux, avec
 * pause / reprise / arret.
 *
 * Le flux est pilote par les acquittements ("ok") et non par des minuteries :
 * un onglet en arriere-plan (minuteries ralenties par le navigateur) ne
 * provoque donc pas de famine du tampon GRBL.
 */
export class GcodeStreamer {
  private lines: string[] = []
  private running = false
  private stopped = false
  private error: Error | null = null
  private inFlight = 0
  private sentCount = 0
  private pauseReason: PauseReason | null = null
  private wake: (() => void) | null = null
  private savedModal: string | null = null

  constructor(
    private readonly client: GrblClient,
    private readonly callbacks: StreamCallbacks = {},
  ) {}

  load(source: string): void {
    this.loadLines(programLines(source))
  }

  loadLines(lines: string[]): void {
    if (this.running) throw new Error('Programme en cours : arretez-le avant d\'en charger un autre')
    this.lines = lines.map((line) => line.trim()).filter((line) => line.length > 0)
  }

  get total(): number {
    return this.lines.length
  }

  get isRunning(): boolean {
    return this.running
  }

  get isPaused(): boolean {
    return this.pauseReason !== null
  }

  /** Vrai si la machine est disponible pour des commandes manuelles. */
  get acceptsCommands(): boolean {
    return !this.running || this.pauseReason === 'program'
  }

  private signal(): void {
    const wake = this.wake
    this.wake = null
    wake?.()
  }

  private wait(): Promise<void> {
    return new Promise((resolve) => {
      this.wake = resolve
    })
  }

  private get halted(): boolean {
    return this.stopped || this.error !== null
  }

  private enqueue(line: string): void {
    this.inFlight++
    this.client
      .send(line)
      .then(() => {
        this.inFlight--
        this.signal()
      })
      .catch((err: unknown) => {
        this.inFlight--
        if (!this.halted) this.fail(err instanceof Error ? err : new Error(String(err)))
        this.signal()
      })
  }

  private fail(error: Error): void {
    if (this.error) return
    this.error = error
    // GRBL continue d'executer ce qu'il a deja en tampon apres un "error:" :
    // on arrete proprement la machine (feed hold puis reset).
    void this.haltMachine()
    this.signal()
  }

  /** Feed hold, attente de l'arret complet, puis reset (position conservee). */
  private async haltMachine(): Promise<void> {
    if (!this.client.connected) return
    // Le feed hold est sans effet a l'arret ; en mouvement il decelere
    // proprement, ce qui evite l'alarme (perte de position) d'un reset en marche.
    const since = Date.now()
    this.client.feedHold()
    try {
      await this.client.waitForStatus(
        (s) =>
          s.timestamp >= since &&
          ((s.state === 'Hold' && s.subState === '0') || s.state === 'Idle' || s.state === 'Alarm' || s.state === 'Door'),
        5000,
      )
    } catch {
      /* reset quand meme */
    }
    this.client.softReset()
  }

  /** Attend que toutes les lignes confiees aient ete acquittees. */
  private async drain(): Promise<void> {
    while (this.inFlight > 0) await this.wait()
  }

  async start(): Promise<void> {
    if (this.running || this.lines.length === 0) return
    this.running = true
    this.stopped = false
    this.error = null
    this.sentCount = 0
    this.inFlight = 0
    this.pauseReason = null
    this.callbacks.onStateChange?.('running')
    this.callbacks.onProgress?.({ sent: 0, total: this.lines.length })

    try {
      for (let index = 0; index < this.lines.length; index++) {
        while (this.pauseReason === 'user' && !this.halted) await this.wait()
        if (this.halted) break

        const line = this.lines[index]
        const pause = parsePause(line)
        if (pause) {
          if (pause.rest) this.enqueue(pause.rest)
          await this.programPause(pause.message)
          if (this.halted) break
        } else {
          while (this.inFlight >= MAX_IN_FLIGHT && !this.halted) await this.wait()
          if (this.halted) break
          this.enqueue(line)
        }

        this.sentCount++
        this.callbacks.onProgress?.({ sent: this.sentCount, total: this.lines.length })
      }

      await this.drain()
      // "ok" = ligne planifiee, pas executee : on attend la fin reelle des mouvements.
      if (!this.halted) {
        try {
          await this.client.sync()
        } catch (err) {
          if (!this.halted) this.fail(err instanceof Error ? err : new Error(String(err)))
        }
      }
    } finally {
      this.running = false
      this.pauseReason = null
      this.wake = null
    }

    if (this.error) {
      this.callbacks.onError?.(this.error)
    } else if (!this.stopped) {
      this.callbacks.onDone?.()
    }
    this.callbacks.onStateChange?.('idle')
  }

  /** Pause programme : attend l'arret complet de la machine, puis l'action de l'utilisateur. */
  private async programPause(message: string): Promise<void> {
    await this.drain()
    if (this.halted) return
    try {
      await this.client.sync()
      this.savedModal = await this.client.parserState().catch(() => null)
    } catch (err) {
      if (!this.halted) this.fail(err instanceof Error ? err : new Error(String(err)))
      return
    }
    if (this.halted) return
    this.pauseReason = 'program'
    this.callbacks.onStateChange?.('paused', 'program')
    this.callbacks.onProgramPause?.(message)
    while (this.pauseReason === 'program' && !this.halted) await this.wait()
    if (this.halted) return
    await this.restoreModal()
  }

  /** Restaure l'etat modal (unites, G90/G91, repere, avance, broche) apres une pause programme. */
  private async restoreModal(): Promise<void> {
    const saved = this.savedModal
    this.savedModal = null
    if (!saved) return
    try {
      const { modal, spindle } = modalRestore(saved)
      if (modal) await this.client.send(modal)
      const current = await this.client.parserState().catch(() => '')
      if (spindle && modalRestore(current).spindle === null) {
        await this.client.send(spindle)
        await this.client.send(`G4 P${SPINUP_SECONDS}`)
      }
    } catch (err) {
      if (!this.halted) this.fail(err instanceof Error ? err : new Error(String(err)))
    }
  }

  pause(): void {
    if (!this.running || this.pauseReason !== null) return
    this.pauseReason = 'user'
    this.client.feedHold()
    this.callbacks.onStateChange?.('paused', 'user')
  }

  resume(): void {
    if (!this.running || this.pauseReason === null) return
    if (this.pauseReason === 'user') this.client.cycleStart()
    this.pauseReason = null
    this.callbacks.onStateChange?.('running')
    this.signal()
  }

  /** Arret d'urgence : reset immediat (sans attendre la deceleration). */
  abort(): void {
    if (this.running) {
      this.stopped = true
      this.pauseReason = null
      this.signal()
      this.callbacks.onStateChange?.('idle')
    }
    this.client.softReset()
  }

  stop(): void {
    if (!this.running) return
    this.stopped = true
    this.pauseReason = null
    this.signal()
    void this.haltMachine()
    this.callbacks.onStateChange?.('idle')
  }
}
