import { beforeAll, describe, expect, it } from 'vitest'
import type { GrblClient as GrblClientType } from '../grbl/GrblClient'

let GrblClient: typeof GrblClientType

beforeAll(async () => {
  // Le client utilise window.setTimeout / setInterval.
  ;(globalThis as unknown as { window: typeof globalThis }).window = globalThis
  GrblClient = (await import('../grbl/GrblClient')).GrblClient
})

/** Remplace le transport serie par un faux qui enregistre les ecritures. */
function makeClient() {
  const client = new GrblClient()
  const written: string[] = []
  const transport = (client as unknown as { transport: Record<string, unknown> }).transport
  transport.requestAndOpen = async () => {
    transport.writer = {}
    transport.port = {}
  }
  transport.write = async (data: string | Uint8Array) => {
    written.push(typeof data === 'string' ? data : `<0x${data[0].toString(16)}>`)
  }
  transport.close = async () => undefined
  Object.defineProperty(transport, 'isOpen', { get: () => true })
  const receive = (line: string) => (transport.onLine as (l: string) => void)(line)
  return { client, written, receive }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('GrblClient', () => {
  it('n\'envoie rien avant la banniere GRBL (reset DTR au branchement)', async () => {
    const { client, written, receive } = makeClient()
    await client.connect()
    const done = client.send('G0 X1')
    await tick()
    expect(written.filter((w) => !w.startsWith('<'))).toEqual([])
    receive("Grbl 1.1h ['$' for help]")
    await tick()
    expect(written).toContain('G0 X1\n')
    receive('ok')
    await done
    await client.disconnect()
  })

  it('respecte le tampon de 127 octets (comptage de caracteres)', async () => {
    const { client, written, receive } = makeClient()
    await client.connect()
    receive('Grbl 1.1h')
    const line = 'G1 X100.000 Y100.000 F1000' // 26 + 1 octets
    const promises = Array.from({ length: 10 }, () => client.send(line))
    await tick()
    const lines = () => written.filter((w) => w.startsWith('G1'))
    expect(lines().length).toBe(4) // 4 * 27 = 108 <= 127 ; 5 * 27 = 135 > 127
    receive('ok')
    await tick()
    expect(lines().length).toBe(5)
    for (let i = 0; i < 9; i++) receive('ok')
    await Promise.all(promises)
    await client.disconnect()
  })

  it('error:N rejette la plus ancienne ligne en vol', async () => {
    const { client, receive } = makeClient()
    await client.connect()
    receive('Grbl 1.1h')
    const a = client.send('G1 X1')
    const b = client.send('G1 X2')
    await tick()
    receive('error:20')
    receive('ok')
    await expect(a).rejects.toThrow('error:20')
    await expect(b).resolves.toBeUndefined()
    await client.disconnect()
  })

  it('ALARM purge la file et attend le redemarrage', async () => {
    const { client, written, receive } = makeClient()
    await client.connect()
    receive('Grbl 1.1h')
    const a = client.send('G38.2 Z-10 F100')
    await tick()
    receive('ALARM:5')
    await expect(a).rejects.toThrow('ALARM:5')
    const b = client.send('$X')
    await tick()
    expect(written).not.toContain('$X\n')
    receive('Grbl 1.1h')
    await tick()
    expect(written).toContain('$X\n')
    receive('ok')
    await b
    await client.disconnect()
  })

  it('refuse une ligne trop longue pour le tampon de ligne GRBL', async () => {
    const { client, receive } = makeClient()
    await client.connect()
    receive('Grbl 1.1h')
    await expect(client.send('G1 ' + 'X1.23456789 '.repeat(8))).rejects.toThrow(/trop longue/)
    await client.disconnect()
  })

  it('$H acquitte = machine referencee', async () => {
    const { client, receive } = makeClient()
    await client.connect()
    receive('Grbl 1.1h')
    const homing = client.home()
    await tick()
    receive('ok')
    await homing
    expect(client.homed).toBe(true)
    receive('<Idle|MPos:0.000,0.000,0.000|FS:0,0>')
    expect(client.status?.homed).toBe(true)
    await client.disconnect()
  })
})

describe('GrblClient redemarrage inattendu', () => {
  it('purge toute la file (ne pas executer la suite hors contexte)', async () => {
    const { client, written, receive } = makeClient()
    await client.connect()
    receive('Grbl 1.1h')
    const line = 'G1 X100.000 Y100.000 F1000'
    const promises = Array.from({ length: 10 }, () => client.send(line).catch((e: Error) => e.message))
    await tick()
    const before = written.filter((w) => w.startsWith('G1')).length
    receive('Grbl 1.1h') // reboot sans reset demande
    await tick()
    expect(written.filter((w) => w.startsWith('G1')).length).toBe(before)
    expect(await Promise.all(promises)).toEqual(Array(10).fill('GRBL a redemarre'))
    await client.disconnect()
  })
})
