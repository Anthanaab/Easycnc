import type { ProbeSettings } from '../data/types'
import type { GrblClient } from './GrblClient'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Palpage Z guide sur plaque: approche rapide, degagement, approche fine,
 * puis definition de Z0 (avec l'epaisseur de plaque).
 */
export async function probeZ(
  client: GrblClient,
  probe: ProbeSettings,
  log: (key: string, params?: Record<string, string | number>) => void,
): Promise<void> {
  try {
    await client.send('G21')
    await client.send('G91')
    log('Approche rapide (F{fast}, course max {max} mm)…', { fast: probe.fast, max: probe.maxDepth })
    await client.send(`G38.2 Z-${probe.maxDepth} F${probe.fast}`)
    await client.send(`G0 Z${probe.retract}`)
    await sleep(150)
    log('Approche fine (F{feed})…', { feed: probe.feed })
    await client.send(`G38.2 Z-${(probe.retract + probe.plate + 2).toFixed(3)} F${probe.feed}`)
    await client.send(`G10 L20 P1 Z${probe.plate}`)
    await client.send(`G0 Z${probe.retract}`)
    log('Z0 défini (plaque {plate} mm), dégagement {retract} mm', { plate: probe.plate, retract: probe.retract })
  } finally {
    try {
      await client.send('G90')
    } catch {
      /* ignore */
    }
  }
}
