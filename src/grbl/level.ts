import type { Bounds } from '../cam/types'
import type { GrblClient } from './GrblClient'

export interface ProbeGridOptions {
  safeZ: number
  retract: number
  fast: number
  maxDepth: number
}

/**
 * Palpe une grille de points sur la surface et renvoie les Z (coordonnees
 * machine) pour le nivellement automatique du plateau.
 */
export async function probeGrid(
  client: GrblClient,
  bounds: Bounds,
  cols: number,
  rows: number,
  options: ProbeGridOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<number[]> {
  const heights: number[] = []
  const total = cols * rows
  let done = 0
  await client.send('G21')
  await client.send('G90')
  for (let iy = 0; iy < rows; iy++) {
    for (let ix = 0; ix < cols; ix++) {
      const x = bounds.min.x + (bounds.max.x - bounds.min.x) * (cols > 1 ? ix / (cols - 1) : 0)
      const y = bounds.min.y + (bounds.max.y - bounds.min.y) * (rows > 1 ? iy / (rows - 1) : 0)
      await client.send(`G0 Z${options.safeZ}`)
      await client.send(`G0 X${x.toFixed(3)} Y${y.toFixed(3)}`)
      client.clearLastProbe()
      await client.send('G91')
      await client.send(`G38.2 Z-${options.maxDepth} F${options.fast}`)
      await client.send('G90')
      await client.send(`G0 Z${options.retract}`)
      const probe = client.lastProbe as { pos: { z: number }; ok: boolean } | null
      heights.push(probe && probe.ok ? probe.pos.z : Number.NaN)
      done++
      onProgress?.(done, total)
    }
  }
  // Remplace les échecs par la moyenne des points valides.
  const valid = heights.filter((h) => Number.isFinite(h))
  const fallback = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0
  return heights.map((h) => (Number.isFinite(h) ? h : fallback))
}
