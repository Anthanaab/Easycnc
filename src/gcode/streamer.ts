import type { GrblClient } from '../grbl/GrblClient'
import { stripComments } from './parser'

export type StreamState = 'idle' | 'running' | 'paused'

export interface StreamProgress {
  sent: number
  total: number
}

export interface StreamCallbacks {
  onProgress?: (progress: StreamProgress) => void
  onDone?: () => void
  onError?: (error: Error) => void
  onStateChange?: (state: StreamState) => void
}

const MAX_IN_FLIGHT = 16

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Retire les numeros de ligne et checksums eventuels d'un post-processeur. */
function normalizeLine(line: string): string {
  let out = line.replace(/\*[0-9]+/g, '').trim()
  out = out.replace(/^N\d+\s*/i, '')
  return out
}

/** Transforme une source G-code en lignes pretes a etre envoyees. */
export function programLines(source: string): string[] {
  return stripComments(source)
    .map(normalizeLine)
    .filter((line) => line.length > 0)
}

/**
 * Envoie un programme G-code a GRBL en respectant le flux, avec
 * pause / reprise / arret.
 */
export class GcodeStreamer {
  private lines: string[] = []
  private paused = false
  private stopped = false
  private running = false
  private error: Error | null = null
  private inFlight = 0
  private sentCount = 0

  constructor(
    private readonly client: GrblClient,
    private readonly callbacks: StreamCallbacks = {},
  ) {}

  load(source: string): void {
    this.loadLines(programLines(source))
  }

  loadLines(lines: string[]): void {
    this.lines = lines.filter((line) => line.trim().length > 0)
  }

  get total(): number {
    return this.lines.length
  }

  get isRunning(): boolean {
    return this.running
  }

  get isPaused(): boolean {
    return this.paused
  }

  async start(): Promise<void> {
    if (this.running || this.lines.length === 0) return
    this.running = true
    this.paused = false
    this.stopped = false
    this.error = null
    this.sentCount = 0
    this.inFlight = 0
    this.callbacks.onStateChange?.('running')

    for (let index = 0; index < this.lines.length; index++) {
      while (this.paused && !this.stopped) await sleep(40)
      if (this.stopped || this.error) break

      while (this.inFlight >= MAX_IN_FLIGHT && !this.stopped && !this.error) await sleep(3)
      if (this.stopped || this.error) break

      const line = this.lines[index]
      this.inFlight++
      this.client
        .send(line)
        .then(() => {
          this.inFlight--
        })
        .catch((err: Error) => {
          this.inFlight--
          if (!this.error) this.error = err
        })

      this.sentCount++
      this.callbacks.onProgress?.({ sent: this.sentCount, total: this.lines.length })
    }

    // Attend la fin des commandes deja envoyees.
    const deadline = Date.now() + 5000
    while (this.inFlight > 0 && !this.error && Date.now() < deadline) await sleep(10)

    this.running = false
    if (this.error) {
      this.callbacks.onError?.(this.error)
    } else if (!this.stopped) {
      this.callbacks.onDone?.()
    }
    this.callbacks.onStateChange?.('idle')
  }

  pause(): void {
    if (!this.running || this.paused) return
    this.paused = true
    this.client.feedHold()
    this.callbacks.onStateChange?.('paused')
  }

  resume(): void {
    if (!this.running || !this.paused) return
    this.paused = false
    this.client.cycleStart()
    this.callbacks.onStateChange?.('running')
  }

  stop(): void {
    if (!this.running) return
    this.stopped = true
    this.paused = false
    this.client.softReset()
    this.callbacks.onStateChange?.('idle')
  }
}
