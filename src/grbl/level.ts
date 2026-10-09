import type { Bounds } from '../cam/types'
import type { GrblClient } from './GrblClient'

export interface ProbeGridOptions {
  safeZ: number
  retract: number
  fast: number
  maxDepth: number
  /** Avance de la seconde approche, lente et precise (mm/min). */
  slow?: number
}

/** Palpe vers le bas et renvoie le Z machine du contact (ou rejette). */
async function probeDown(client: GrblClient, distance: number, feed: number): Promise<number> {
  client.clearLastProbe()
  await client.send('G91')
  try {
    // G38.2 : GRBL ne repond "ok" qu'une fois le palpage termine ;
    // un echec declenche ALARM:4/5 et rejette la commande.
    await client.send(`G38.2 Z-${distance.toFixed(3)} F${Math.round(feed)}`)
  } finally {
    await client.send('G90').catch(() => undefined)
  }
  const probe = client.lastProbe
  if (!probe || !probe.ok) throw new Error('Palpage sans contact')
  return probe.pos.z
}

/**
 * Palpe une grille de points sur la surface et renvoie les Z (coordonnees
 * machine) pour le nivellement automatique du plateau.
 * Chaque point : approche rapide, degagement de 1 mm, approche lente.
 */
export async function probeGrid(
  client: GrblClient,
  bounds: Bounds,
  cols: number,
  rows: number,
  options: ProbeGridOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<number[]> {
  cols = Math.max(1, Math.round(cols))
  rows = Math.max(1, Math.round(rows))
  const values = [options.safeZ, options.retract, options.fast, options.maxDepth]
  if (values.some((v) => !Number.isFinite(v)) || options.fast <= 0 || options.maxDepth <= 0 || options.safeZ <= 0) {
    throw new Error('Parametres de palpage invalides')
  }
  const slow = Math.max(5, Math.min(options.slow ?? 25, options.fast))
  const heights: number[] = []
  const total = cols * rows
  let done = 0
  await client.send('G21')
  await client.send('G90')
  await client.send(`G0 Z${options.safeZ.toFixed(3)}`)
  for (let iy = 0; iy < rows; iy++) {
    // Parcours en serpentin : deplacements plus courts.
    for (let step = 0; step < cols; step++) {
      const ix = iy % 2 === 0 ? step : cols - 1 - step
      const x = bounds.min.x + (bounds.max.x - bounds.min.x) * (cols > 1 ? ix / (cols - 1) : 0.5)
      const y = bounds.min.y + (bounds.max.y - bounds.min.y) * (rows > 1 ? iy / (rows - 1) : 0.5)
      await client.send(`G0 Z${options.safeZ.toFixed(3)}`)
      await client.send(`G0 X${x.toFixed(3)} Y${y.toFixed(3)}`)
      await probeDown(client, options.maxDepth, options.fast)
      await client.send('G91')
      await client.send('G0 Z1')
      await client.send('G90')
      const z = await probeDown(client, 2, slow)
      await client.send(`G0 Z${options.retract.toFixed(3)}`)
      heights[iy * cols + ix] = z
      done++
      onProgress?.(done, total)
    }
  }
  await client.send(`G0 Z${options.safeZ.toFixed(3)}`)
  return heights
}
