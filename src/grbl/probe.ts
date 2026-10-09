import type { ProbeSettings } from '../data/types'
import type { GrblClient } from './GrblClient'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function checkSettings(probe: ProbeSettings): void {
  const finite = [probe.fast, probe.feed, probe.maxDepth, probe.retract, probe.plate].every(Number.isFinite)
  if (!finite) throw new Error('Parametres de palpage invalides')
  if (probe.fast <= 0 || probe.feed <= 0) throw new Error('Avances de palpage invalides (> 0)')
  if (probe.maxDepth <= 0) throw new Error('Course max de palpage invalide (> 0)')
  if (probe.retract <= 0) throw new Error('Degagement de palpage invalide (> 0)')
  if (probe.plate < 0) throw new Error('Epaisseur de plaque invalide (>= 0)')
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
  checkSettings(probe)
  try {
    await client.send('G21')
    await client.send('G91')
    log('Approche rapide (F{fast}, course max {max} mm)…', { fast: probe.fast, max: probe.maxDepth })
    client.clearLastProbe()
    // G38.2 : "ok" seulement a la fin du palpage ; sans contact -> ALARM:5.
    await client.send(`G38.2 Z-${probe.maxDepth.toFixed(3)} F${Math.round(probe.fast)}`)
    await client.send(`G0 Z${probe.retract.toFixed(3)}`)
    await sleep(150)
    log('Approche fine (F{feed})…', { feed: probe.feed })
    client.clearLastProbe()
    await client.send(`G38.2 Z-${(probe.retract + 2).toFixed(3)} F${Math.round(probe.feed)}`)
    if (!client.lastProbe?.ok) throw new Error('Palpage fin sans contact')
    // P0 = repere de travail actif (pas forcement G54).
    await client.send(`G10 L20 P0 Z${probe.plate.toFixed(3)}`)
    await client.send(`G0 Z${probe.retract.toFixed(3)}`)
    log('Z0 défini (plaque {plate} mm), dégagement {retract} mm', { plate: probe.plate, retract: probe.retract })
  } finally {
    try {
      await client.send('G90')
    } catch {
      /* ignore */
    }
  }
}
