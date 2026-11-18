import type { ProjectData } from './project'

// Projets enregistres sur le serveur EasyCNC (installation Proxmox/LXC).
// Indisponible en local ou sur un hebergement statique : les fonctions le signalent.

export interface ServerProjectInfo {
  name: string
  date?: number
  thumbnail?: string
  shapes: number
  size: number
}

const BASE = '/api/projects'

function isJson(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').includes('application/json')
}

/** Liste des projets du serveur, ou null si le serveur ne les gere pas. */
export async function listServerProjects(): Promise<ServerProjectInfo[] | null> {
  try {
    const response = await fetch(BASE, { cache: 'no-store' })
    if (!response.ok || !isJson(response)) return null
    const data = (await response.json()) as unknown
    return Array.isArray(data) ? (data as ServerProjectInfo[]) : null
  } catch {
    return null
  }
}

export async function loadServerProject(name: string): Promise<ProjectData> {
  const response = await fetch(`${BASE}/${encodeURIComponent(name)}`, { cache: 'no-store' })
  if (!response.ok || !isJson(response)) throw new Error(`Projet introuvable (${response.status})`)
  return (await response.json()) as ProjectData
}

async function check(response: Response): Promise<void> {
  if (response.ok) return
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  throw new Error(body.error ?? `HTTP ${response.status}`)
}

export async function saveServerProject(project: ProjectData): Promise<void> {
  const response = await fetch(`${BASE}/${encodeURIComponent(project.name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-EasyCNC': 'projects' },
    body: JSON.stringify(project),
  })
  await check(response)
}

export async function deleteServerProject(name: string): Promise<void> {
  const response = await fetch(`${BASE}/${encodeURIComponent(name)}`, { method: 'DELETE', headers: { 'X-EasyCNC': 'projects' } })
  await check(response)
}
