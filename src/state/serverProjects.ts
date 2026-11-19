import { tokenHeader } from './accessToken'
import type { ProjectData } from './project'
import { trc } from '../i18nCore'

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

/** Liste des projets du serveur ; null si le serveur ne les gere pas ; 'locked' si un code est requis. */
export async function listServerProjects(): Promise<ServerProjectInfo[] | null | 'locked'> {
  try {
    const response = await fetch(BASE, { cache: 'no-store', headers: tokenHeader() })
    if (response.status === 401) return 'locked'
    if (!response.ok || !isJson(response)) return null
    const data = (await response.json()) as unknown
    return Array.isArray(data) ? (data as ServerProjectInfo[]) : null
  } catch {
    return null
  }
}

export async function loadServerProject(name: string): Promise<ProjectData> {
  const response = await fetch(`${BASE}/${encodeURIComponent(name)}`, { cache: 'no-store', headers: tokenHeader() })
  if (!response.ok || !isJson(response)) throw new Error(trc('Projet introuvable ({status})', { status: response.status }))
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
    headers: { 'Content-Type': 'application/json', 'X-EasyCNC': 'projects', ...tokenHeader() },
    body: JSON.stringify(project),
  })
  await check(response)
}

export async function deleteServerProject(name: string): Promise<void> {
  const response = await fetch(`${BASE}/${encodeURIComponent(name)}`, { method: 'DELETE', headers: { 'X-EasyCNC': 'projects', ...tokenHeader() } })
  await check(response)
}

/** Sauvegarde : tous les projets du serveur dans un fichier JSON telecharge. */
export async function exportServerProjects(): Promise<number> {
  const response = await fetch(`${BASE}/_export`, { cache: 'no-store', headers: tokenHeader() })
  if (!response.ok || !isJson(response)) throw new Error(trc('Export impossible ({status})', { status: response.status }))
  const bundle = (await response.json()) as { projects: ProjectData[] }
  const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `easycnc-projets-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(url)
  return bundle.projects.length
}

/** Restaure une sauvegarde (fichier d'export) sur le serveur. */
export async function importServerProjects(json: string): Promise<number> {
  const bundle = JSON.parse(json) as { format?: string; projects?: unknown }
  if (bundle.format !== 'easycnc-projects' || !Array.isArray(bundle.projects)) throw new Error(trc('Fichier de sauvegarde invalide'))
  let count = 0
  for (const project of bundle.projects as ProjectData[]) {
    if (!project || typeof project.name !== 'string' || !Array.isArray(project.shapes)) continue
    await saveServerProject(project)
    count++
  }
  return count
}
