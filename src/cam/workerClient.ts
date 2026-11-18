import type { Toolpath } from '../gcode/parser'
import { runAnyJob, type AnyJob, type CamJobResult } from './camJob'

// Client du Web Worker de calcul (FAO + analyse de G-code). Repli sur le fil
// principal si le worker est indisponible (vieux navigateur, erreur de chargement).

let worker: Worker | null = null
let workerFailed = false
let nextId = 0

function getWorker(): Worker | null {
  if (worker || workerFailed || typeof Worker === 'undefined') return worker
  try {
    worker = new Worker(new URL('./camWorker.ts', import.meta.url), { type: 'module' })
  } catch {
    workerFailed = true
  }
  return worker
}

function call<T>(message: Record<string, unknown>, fallback: () => Promise<T>): Promise<T> {
  const w = getWorker()
  if (!w) return fallback()
  const id = ++nextId
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      w.removeEventListener('message', onMessage)
      w.removeEventListener('error', onError)
    }
    const onMessage = (event: MessageEvent<{ id: number; ok: boolean; output?: T; error?: string }>) => {
      if (event.data.id !== id) return
      cleanup()
      if (event.data.ok && event.data.output !== undefined) resolve(event.data.output)
      else reject(new Error(event.data.error ?? 'Calcul echoue'))
    }
    const onError = () => {
      cleanup()
      // Worker inutilisable : calcul sur le fil principal desormais.
      worker = null
      workerFailed = true
      w.terminate()
      fallback().then(resolve, reject)
    }
    w.addEventListener('message', onMessage)
    w.addEventListener('error', onError)
    w.postMessage({ id, ...message })
  })
}

export function computeJob(job: AnyJob): Promise<CamJobResult> {
  return call({ job }, () => runAnyJob(job))
}

/** Analyse d'un G-code (apercu, emprise, duree) hors du fil principal. */
export function parseGcodeInWorker(source: string): Promise<Toolpath> {
  return call({ parse: source }, async () => (await import('../gcode/parser')).parseGcode(source))
}
