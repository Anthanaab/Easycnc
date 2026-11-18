import { useEffect, useRef, useState } from 'react'
import type { AnyJob, CamJobResult } from './camJob'
import { computeJob } from './workerClient'

const EMPTY: CamJobResult = { result: { paths: [], warnings: [], bounds: null, moveCount: 0, cutLength: 0 }, gcode: null }

/**
 * Calcule un job FAO dans un Web Worker. Pendant le calcul, le dernier resultat
 * reste affiche et `pending` est vrai (les exports doivent alors etre bloques).
 * Les demandes rapprochees sont fusionnees : seule la plus recente est calculee.
 */
export function useCamJob(job: AnyJob, deps: unknown[]): { output: CamJobResult; pending: boolean; error: string | null } {
  const [output, setOutput] = useState<CamJobResult>(EMPTY)
  const [pending, setPending] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const queued = useRef<AnyJob | null>(null)
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
          const result = await computeJob(next)
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
