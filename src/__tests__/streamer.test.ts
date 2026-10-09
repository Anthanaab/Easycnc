import { describe, expect, it } from 'vitest'
import { GcodeStreamer, type PauseReason, type StreamState } from '../gcode/streamer'
import type { GrblClient } from '../grbl/GrblClient'
import type { GrblStatus } from '../grbl/types'

/** Faux client GRBL : acquitte chaque ligne au tick suivant (ou en erreur). */
class FakeClient {
  sent: string[] = []
  realtime: string[] = []
  connected = true
  status: GrblStatus = { state: 'Idle', raw: '', timestamp: Date.now() }
  failOn: string | null = null
  gc = 'G0 G54 G17 G21 G90 G94 M3 M9 T0 F600 S12000'

  send(line: string): Promise<void> {
    this.sent.push(line)
    if (line === '$G') return Promise.resolve().then(() => this.emitGc())
    return new Promise((resolve, reject) => {
      setTimeout(() => (this.failOn && line === this.failOn ? reject(new Error('error:20')) : resolve()), 0)
    })
  }

  private gcListeners: Array<(fb: unknown) => void> = []
  private emitGc(): void {
    for (const fn of this.gcListeners) fn({ kind: 'parser', raw: '', data: { GC: this.gc } })
  }

  async sync(): Promise<void> {
    await this.send('G4 P0')
  }

  async parserState(): Promise<string> {
    this.sent.push('$G')
    return this.gc
  }

  waitForStatus(): Promise<GrblStatus> {
    return Promise.resolve({ ...this.status, timestamp: Date.now() })
  }

  feedHold(): void {
    this.realtime.push('!')
  }
  cycleStart(): void {
    this.realtime.push('~')
  }
  softReset(): void {
    this.realtime.push('reset')
  }
}

function setup() {
  const fake = new FakeClient()
  const states: Array<[StreamState, PauseReason | undefined]> = []
  const events: string[] = []
  let pauseMessage = ''
  const streamer = new GcodeStreamer(fake as unknown as GrblClient, {
    onStateChange: (state, reason) => states.push([state, reason]),
    onDone: () => events.push('done'),
    onError: (error) => events.push(`error ${error.message}`),
    onProgramPause: (message) => {
      pauseMessage = message
    },
  })
  return { fake, streamer, states, events, pause: () => pauseMessage }
}

describe('GcodeStreamer', () => {
  it('envoie tout puis attend la fin des mouvements avant "termine"', async () => {
    const { fake, streamer, events } = setup()
    const lines = Array.from({ length: 200 }, (_, i) => `G1 X${i} F500`)
    streamer.loadLines(lines)
    await streamer.start()
    expect(fake.sent.slice(0, 200)).toEqual(lines)
    expect(fake.sent[200]).toBe('G4 P0')
    expect(events).toEqual(['done'])
    expect(streamer.isRunning).toBe(false)
  })

  it('erreur GRBL : arrete le flux et stoppe la machine (hold + reset)', async () => {
    const { fake, streamer, events } = setup()
    fake.failOn = 'G1 X5'
    streamer.loadLines(Array.from({ length: 100 }, (_, i) => `G1 X${i}`))
    await streamer.start()
    expect(events).toEqual(['error error:20'])
    expect(fake.realtime).toEqual(['!', 'reset'])
    expect(fake.sent.length).toBeLessThan(100)
    expect(fake.sent).not.toContain('G4 P0')
  })

  it('refuse de charger un programme pendant l\'execution', async () => {
    const { streamer } = setup()
    streamer.loadLines(['G1 X1', 'G1 X2'])
    const run = streamer.start()
    expect(() => streamer.loadLines(['G0 X0'])).toThrow()
    await run
  })

  it('pause M0 : machine arretee, commandes autorisees, reprise avec restauration modale', async () => {
    const { fake, streamer, states, events, pause } = setup()
    streamer.loadLines(['G1 X1', 'M5', "M0 (Changer l'outil : B)", 'G1 X2'])
    fake.gc = 'G0 G54 G17 G21 G90 G94 M3 M9 T0 F600 S12000'
    const run = streamer.start()
    while (!streamer.isPaused) await new Promise((r) => setTimeout(r, 1))
    expect(pause()).toBe("Changer l'outil : B")
    expect(streamer.acceptsCommands).toBe(true)
    expect(states[states.length - 1]).toEqual(['paused', 'program'])
    expect(fake.sent).not.toContain('M0')
    expect(fake.sent).not.toContain('G1 X2')
    // M0 ne doit jamais etre envoye a GRBL ; le flux attend la fin des mouvements.
    expect(fake.sent.slice(0, 3)).toEqual(['G1 X1', 'M5', 'G4 P0'])
    fake.gc = 'G0 G54 G17 G21 G91 G94 M5 M9 T0 F50 S0'
    streamer.resume()
    await run
    const afterPause = fake.sent.slice(fake.sent.lastIndexOf('$G') + 1)
    expect(afterPause[0]).toBe('M3 S12000')
    expect(afterPause[1]).toMatch(/^G4 P/)
    expect(fake.sent).toContain('G54 G17 G21 G90 G94 F600')
    expect(fake.sent.indexOf('G54 G17 G21 G90 G94 F600')).toBeLessThan(fake.sent.indexOf('G1 X2'))
    expect(events).toEqual(['done'])
  })

  it('pause utilisateur : feed hold, plus rien n\'est envoye, cycle start a la reprise', async () => {
    const { fake, streamer, events } = setup()
    streamer.loadLines(Array.from({ length: 100 }, (_, i) => `G1 X${i}`))
    const run = streamer.start()
    streamer.pause()
    expect(streamer.acceptsCommands).toBe(false)
    await new Promise((r) => setTimeout(r, 20))
    const count = fake.sent.length
    await new Promise((r) => setTimeout(r, 20))
    expect(fake.sent.length).toBe(count)
    streamer.resume()
    await run
    expect(fake.realtime).toEqual(['!', '~'])
    expect(events).toEqual(['done'])
  })

  it('stop : hold puis reset, pas de "termine"', async () => {
    const { fake, streamer, events } = setup()
    streamer.loadLines(Array.from({ length: 100 }, (_, i) => `G1 X${i}`))
    const run = streamer.start()
    await new Promise((r) => setTimeout(r, 2))
    streamer.stop()
    await run
    expect(events).toEqual([])
    expect(fake.realtime).toEqual(['!', 'reset'])
  })
})
