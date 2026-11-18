/// <reference lib="webworker" />
import { runCamJob, type CamJob } from './camJob'

// Calculs FAO hors du fil principal : l'interface reste fluide pendant le
// calcul des poches, V-carve, textes...
self.onmessage = async (event: MessageEvent<{ id: number; job: CamJob }>) => {
  const { id, job } = event.data
  try {
    const output = await runCamJob(job)
    self.postMessage({ id, ok: true, output })
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
