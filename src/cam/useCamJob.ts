import { useEffect, useRef, useState } from 'react'
import { runCamJob, type CamJob, type CamJobResult } from './camJob'

const EMPTY: CamJobResult = { result: { paths: [], warnings: [], bounds: null, moveCount: 0, cutLength: 0 }, gcode: null }

let worker: Worker | null = null
let workerFailed = false
let nextId = 0

function getWorker(): Worker | null {
  if (worker || workerFailed) return worker
  try {
    worker = new Worker(new URL('./camWorker.ts', import.meta.url), { type: 'module' })
  } catch {
    workerFailed = true
  }
  return worker
}

/**
 * Calcule un job FAO dans un Web Worker. Pendant le calcul, le dernier resultat
 * reste affiche et `pending` est vrai (les exports doivent alors etre bloques).
 * Les demandes rapprochees sont fusionnees : seule la plus recente est calculee.
 */
export function useCamJob(job: CamJob, deps: unknown[]): { output: CamJobResult; pending: boolean; error: string | null } {
  const [output, setOutput] = useState<CamJobResult>(EMPTY)
  const [pending, setPending] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const queued = useRef<CamJob | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    setPending(true)
    queued.current = job
    if (busy.current) return
    const pump = async () => {
      while (queued.current) {
        const next = queued.current
        queued.current = null
        busy.current = true
        try {
          const result = await compute(next)
          if (!alive.current) return
          if (!queued.current) {
            setOutput(result)
            setError(null)
          }
        } catch (err) {
          if (alive.current) setError(err instanceof Error ? err.message : String(err))
        } finally {
          busy.current = false
        }
      }
      if (alive.current) setPending(false)
    }
    void pump()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { output, pending, error }
}

function compute(job: CamJob): Promise<CamJobResult> {
  const w = getWorker()
  if (!w) return runCamJob(job)
  const id = ++nextId
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<{ id: number; ok: boolean; output?: CamJobResult; error?: string }>) => {
      if (event.data.id !== id) return
      w.removeEventListener('message', onMessage)
      w.removeEventListener('error', onError)
      if (event.data.ok && event.data.output) resolve(event.data.output)
      else reject(new Error(event.data.error ?? 'Calcul FAO echoue'))
    }
    const onError = (event: ErrorEvent) => {
      w.removeEventListener('message', onMessage)
      w.removeEventListener('error', onError)
      // Worker inutilisable : calcul sur le fil principal desormais.
      worker = null
      workerFailed = true
      w.terminate()
      runCamJob(job).then(resolve, () => reject(new Error(event.message)))
    }
    w.addEventListener('message', onMessage)
    w.addEventListener('error', onError)
    w.postMessage({ id, job })
  })
}
