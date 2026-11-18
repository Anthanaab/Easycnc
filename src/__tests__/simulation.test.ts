import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { GcodeStreamer as StreamerType } from '../gcode/streamer'
import type { GrblClient as ClientType } from '../grbl/GrblClient'
import { GrblSim, type SimOptions } from './grblSim'

// Tests de bout en bout : vrai GrblClient + vrai GcodeStreamer face au simulateur GRBL.
let GrblClient: typeof ClientType
let GcodeStreamer: typeof StreamerType

beforeAll(async () => {
  ;(globalThis as unknown as { window: typeof globalThis }).window = globalThis
  GrblClient = (await import('../grbl/GrblClient')).GrblClient
  GcodeStreamer = (await import('../gcode/streamer')).GcodeStreamer
})

const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn()
})

async function connect(options: SimOptions = {}) {
  const client = new GrblClient()
  const transport = (client as unknown as { transport: Record<string, unknown> }).transport
  const sim = new GrblSim((line) => (transport.onLine as (l: string) => void)(line), options)
  transport.requestAndOpen = async () => {
    transport.writer = {}
    transport.port = {}
    sim.boot()
  }
  transport.write = async (data: string | Uint8Array) => sim.write(data)
  transport.close = async () => undefined
  Object.defineProperty(transport, 'isOpen', { get: () => true })
  await client.connect()
  // Attend la banniere puis un premier rapport d'etat.
  await client.waitForStatus(() => true, 2000)
  cleanups.push(async () => {
    sim.dispose()
    await client.disconnect()
  })
  return { client, sim }
}

function streamerFor(client: ClientType) {
  const events: string[] = []
  let pauseMessage = ''
  const streamer = new GcodeStreamer(client, {
    onDone: () => events.push('done'),
    onError: (error) => events.push(`error ${error.message}`),
    onProgramPause: (message) => {
      pauseMessage = message
    },
  })
  return { streamer, events, pause: () => pauseMessage }
}

const program = (n: number) => Array.from({ length: n }, (_, i) => `G1 X${(i % 100) + 0.123} Y${(i % 37) + 0.456} F1500`)
const until = async (predicate: () => boolean, timeout = 5000) => {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('Delai depasse')
    await new Promise((r) => setTimeout(r, 2))
  }
}

describe('job complet face au simulateur GRBL', () => {
  it('300 lignes : jamais de debordement du tampon, ordre respecte, fin apres le dernier mouvement', async () => {
    const { client, sim } = await connect({ blockMs: 1 })
    const { streamer, events } = streamerFor(client)
    const lines = program(300)
    streamer.loadLines(lines)
    await streamer.start()
    expect(events).toEqual(['done'])
    expect(sim.overflow).toBe(false)
    expect(sim.maxRx).toBeLessThanOrEqual(128)
    expect(sim.maxRx).toBeGreaterThan(80) // le tampon est bien utilise
    expect(sim.executed.filter((l) => /^G1 /.test(l))).toEqual(lines)
    expect(sim.machineState).toBe('Idle')
  })

  it('pause M0 : machine a l\'arret, commande manuelle possible, puis reprise', async () => {
    const { client, sim } = await connect({ blockMs: 1 })
    const { streamer, events, pause } = streamerFor(client)
    streamer.loadLines([...program(40), 'M5', "M0 (Changer l'outil : V60)", ...program(40)])
    const run = streamer.start()
    await until(() => streamer.isPaused)
    expect(pause()).toContain('V60')
    expect(sim.machineState).toBe('Idle')
    expect(sim.executed.filter((l) => /^G1 /.test(l)).length).toBe(40)
    // Commande manuelle pendant la pause (ex. remise a zero Z).
    await client.send('G10 L20 P0 Z0')
    expect(sim.executed).toContain('G10 L20 P0 Z0')
    streamer.resume()
    await run
    expect(events).toEqual(['done'])
    expect(sim.executed.filter((l) => /^G1 /.test(l)).length).toBe(80)
    expect(sim.received).not.toContain("M0 (Changer l'outil : V60)")
  })

  it('Stop en pleine coupe : feed hold, arret complet, puis reset sans perte de position', async () => {
    const { client, sim } = await connect({ blockMs: 3, decelMs: 10 })
    const { streamer, events } = streamerFor(client)
    streamer.loadLines(program(400))
    const run = streamer.start()
    await until(() => sim.executed.length > 20)
    streamer.stop()
    await run
    await until(() => sim.resets === 1)
    expect(events).toEqual([])
    expect(sim.alarms).toEqual([]) // pas d'ALARM:3 : reset fait apres Hold:0
    expect(sim.executed.filter((l) => /^G1 /.test(l)).length).toBeLessThan(400)
  })

  it('erreur GRBL en cours : arret propre de la machine, pas de "termine"', async () => {
    const lines = program(200)
    const { client, sim } = await connect({ blockMs: 2, errorOn: lines[50] })
    const { streamer, events } = streamerFor(client)
    streamer.loadLines(lines)
    await streamer.start()
    await until(() => sim.resets === 1)
    expect(events).toEqual([`error error:20`])
    expect(sim.alarms).toEqual([])
    expect(sim.executed.filter((l) => /^G1 /.test(l)).length).toBeLessThan(200)
  })

  it('pause utilisateur (feed hold) puis reprise : programme complet', async () => {
    const { client, sim } = await connect({ blockMs: 2, decelMs: 5 })
    const { streamer, events } = streamerFor(client)
    const lines = program(150)
    streamer.loadLines(lines)
    const run = streamer.start()
    await until(() => sim.executed.length > 10)
    streamer.pause()
    await until(() => sim.machineState === 'Hold:0')
    const frozen = sim.executed.length
    await new Promise((r) => setTimeout(r, 30))
    expect(sim.executed.length).toBe(frozen)
    streamer.resume()
    await run
    expect(events).toEqual(['done'])
    expect(sim.executed.filter((l) => /^G1 /.test(l))).toEqual(lines)
    expect(sim.overflow).toBe(false)
  })
})
