import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// En test, les imports « ?url » donnent un chemin du projet (/src/...) :
// fetch() le lit sur le disque, comme le ferait le navigateur.
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.startsWith('/src/')) {
    const data = await readFile(resolve(process.cwd(), '.' + url.split('?')[0]))
    return new Response(data, { status: 200 })
  }
  return realFetch(input, init)
}) as typeof fetch
