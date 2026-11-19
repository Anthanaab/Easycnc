// Historique des programmes executes (IndexedDB, local au navigateur).

export type JobOutcome = 'done' | 'stopped' | 'error'

export interface JobRecord {
  id: number
  file: string
  jobType: 'mill' | 'laser' | null
  dryRun: boolean
  startedAt: number
  endedAt?: number
  outcome?: JobOutcome
  message?: string
  lines: number
  done?: number
  material?: string
  bit?: string
  fromLine?: number
  /** Duree estimee au demarrage (s), pour calibrer l'estimation. */
  estimatedSeconds?: number
}

const DB = 'easycnc-jobs'
const STORE = 'jobs'
const MAX_JOBS = 300

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponible'))
      return
    }
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode)
    const request = fn(transaction.objectStore(STORE))
    transaction.oncomplete = () => {
      db.close()
      resolve(request ? request.result : undefined)
    }
    transaction.onerror = () => {
      db.close()
      reject(transaction.error)
    }
  })
}

let current: JobRecord | null = null

export function recordJobStart(entry: Omit<JobRecord, 'id' | 'startedAt'>): void {
  current = { ...entry, id: Date.now(), startedAt: Date.now() }
  const record = current
  void tx('readwrite', (store) => {
    store.put(record)
  }).catch(() => undefined)
}

export function recordJobEnd(outcome: JobOutcome, done: number, message?: string): void {
  if (!current) return
  const record: JobRecord = { ...current, endedAt: Date.now(), outcome, done, message }
  current = null
  void tx('readwrite', (store) => {
    store.put(record)
  })
    .then(prune)
    .catch(() => undefined)
}

export async function listJobs(): Promise<JobRecord[]> {
  try {
    const all = (await tx<JobRecord[]>('readonly', (store) => store.getAll())) ?? []
    return all.sort((a, b) => b.startedAt - a.startedAt)
  } catch {
    return []
  }
}

export async function clearJobs(): Promise<void> {
  try {
    await tx('readwrite', (store) => {
      store.clear()
    })
  } catch {
    /* ignore */
  }
}

async function prune(): Promise<void> {
  const all = await listJobs()
  const extra = all.slice(MAX_JOBS)
  if (extra.length) await tx('readwrite', (store) => extra.forEach((job) => store.delete(job.id)))
}

export interface Calibration {
  /** Duree reelle / duree estimee (mediane). */
  factor: number
  samples: number
}

/**
 * Coefficient de correction de l'estimation, appris sur les programmes termines
 * en entier (pas de reprise) : mediane des 10 derniers, bornee a [0,5 ; 3].
 */
export function calibrationFrom(jobs: JobRecord[]): Calibration | null {
  const ratios = jobs
    .filter((job) => job.outcome === 'done' && !job.fromLine && job.endedAt && (job.estimatedSeconds ?? 0) >= 30)
    .slice(0, 10)
    .map((job) => (job.endedAt! - job.startedAt) / 1000 / job.estimatedSeconds!)
    .filter((ratio) => Number.isFinite(ratio) && ratio > 0)
    .sort((a, b) => a - b)
  if (ratios.length < 2) return null
  const mid = ratios.length >> 1
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2
  return { factor: Math.min(3, Math.max(0.5, median)), samples: ratios.length }
}
