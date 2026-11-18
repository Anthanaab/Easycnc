/// <reference lib="webworker" />
import { parseGcode } from '../gcode/parser'
import { runAnyJob, type AnyJob } from './camJob'
import { computePcb, type PcbInput } from './pcbJob'

// Calculs hors du fil principal : l'interface reste fluide pendant le calcul des
// poches, V-carve, textes, images laser, et l'analyse des gros G-code.
self.onmessage = async (event: MessageEvent<{ id: number; job?: AnyJob; parse?: string; pcb?: PcbInput }>) => {
  const { id, job, parse, pcb } = event.data
  try {
    const output = parse !== undefined ? parseGcode(parse) : pcb ? computePcb(pcb) : await runAnyJob(job as AnyJob)
    self.postMessage({ id, ok: true, output })
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
