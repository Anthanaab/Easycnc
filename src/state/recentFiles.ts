// Derniers programmes ouverts, gardes dans IndexedDB (les G-code depassent
// vite le quota de localStorage). Tout echec est silencieux : c'est un confort.

export interface RecentFile {
  name: string
  text: string
  size: number
  openedAt: number
}

const DB = 'easycnc'
const STORE = 'recentFiles'
const MAX_FILES = 8
const MAX_SIZE = 20 * 1024 * 1024

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponible'))
      return
    }
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'name' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const request = fn(tx.objectStore(STORE))
        tx.oncomplete = () => {
          db.close()
          resolve(request ? request.result : undefined)
        }
        tx.onerror = () => {
          db.close()
          reject(tx.error)
        }
      }),
  )
}

/** Liste (sans le contenu), du plus recent au plus ancien. */
export async function listRecentFiles(): Promise<Array<Omit<RecentFile, 'text'>>> {
  try {
    const all = (await run<RecentFile[]>('readonly', (store) => store.getAll())) ?? []
    return all.sort((a, b) => b.openedAt - a.openedAt).map(({ name, size, openedAt }) => ({ name, size, openedAt }))
  } catch {
    return []
  }
}

export async function getRecentFile(name: string): Promise<RecentFile | undefined> {
  try {
    return await run<RecentFile>('readonly', (store) => store.get(name))
  } catch {
    return undefined
  }
}

export async function addRecentFile(name: string, text: string): Promise<void> {
  if (text.length > MAX_SIZE) return
  try {
    await run('readwrite', (store) => {
      store.put({ name, text, size: text.length, openedAt: Date.now() })
    })
    const list = await listRecentFiles()
    const extra = list.slice(MAX_FILES)
    if (extra.length) await run('readwrite', (store) => extra.forEach((f) => store.delete(f.name)))
  } catch {
    /* quota / navigation privee */
  }
}

export async function removeRecentFile(name: string): Promise<void> {
  try {
    await run('readwrite', (store) => {
      store.delete(name)
    })
  } catch {
    /* ignore */
  }
}
