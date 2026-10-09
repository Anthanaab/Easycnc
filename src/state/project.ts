import type { LaserImage } from '../cam/laserImage'
import { shapeLoops } from '../cam/geometry'
import type { Shape, LaserSettings, SurfacingSettings, TabsSettings } from '../cam/types'
import { BITS } from '../data/bits'
import { MACHINES } from '../data/machines'
import type { Bit, MachineProfile } from '../data/types'
import type { CutParams } from '../data/params'
import { useCamStore } from '../cam/camStore'
import { useStore } from './store'

export const PROJECTS_KEY = 'projects'

export interface SerializedImage extends Omit<LaserImage, 'data'> {
  data: number[]
}

export interface ProjectData {
  version: number
  name: string
  date: number
  thumbnail?: string
  shapes: Shape[]
  images: SerializedImage[]
  tabs: TabsSettings
  surfacing: SurfacingSettings
  laser: LaserSettings
  machineId: string
  materialId: string
  bitId: string
  params: CutParams
  savedSettings: Record<string, Record<number, string>>
  userMachines: MachineProfile[]
  userBits: Bit[]
}

export const AUTOSAVE_NAME = 'Dernière session'

const PROJECT_VERSION = 1

function storage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function projectMap(): Record<string, ProjectData> {
  return storage<Record<string, ProjectData>>(PROJECTS_KEY, {})
}

export function renderThumbnail(shapes: Shape[], images: SerializedImage[]): string | undefined {
  if (!shapes.length && !images.length) return undefined
  const canvas = document.createElement('canvas')
  canvas.width = 200
  canvas.height = 140
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  ctx.fillStyle = '#141a22'
  ctx.fillRect(0, 0, 200, 140)

  const loops: Array<Array<{ x: number; y: number }>> = []
  for (const shape of shapes) {
    for (const loop of shapeLoops(shape)) loops.push(loop)
  }
  for (const image of images) {
    const h = image.rows * image.pixelSize
    loops.push([
      { x: image.x - image.width / 2, y: image.y - h / 2 },
      { x: image.x + image.width / 2, y: image.y + h / 2 },
    ])
  }
  if (!loops.length) return undefined

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const loop of loops) {
    for (const p of loop) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  }
  const w = maxX - minX || 1
  const h = maxY - minY || 1
  const scale = Math.min(180 / w, 120 / h)
  const ox = 10 + (180 - w * scale) / 2 - minX * scale
  const oy = 130 - (120 - h * scale) / 2 + minY * scale
  const sx = (x: number) => x * scale + ox
  const sy = (y: number) => -y * scale + oy

  ctx.strokeStyle = '#35d0ba'
  ctx.lineWidth = 1.4
  ctx.beginPath()
  for (const loop of loops) {
    if (loop.length < 2) continue
    loop.forEach((p, i) => (i ? ctx.lineTo(sx(p.x), sy(p.y)) : ctx.moveTo(sx(p.x), sy(p.y))))
  }
  ctx.stroke()
  return canvas.toDataURL('image/png')
}

export function listProjects(): ProjectData[] {
  return Object.values(projectMap()).sort((a, b) => b.date - a.date)
}

export function currentProject(name: string): ProjectData {
  const cam = useCamStore.getState()
  const main = useStore.getState()
  const images = cam.images.map((img) => ({ ...img, data: Array.from(img.data) }))
  return {
    version: PROJECT_VERSION,
    name: name.trim() || 'Projet',
    date: Date.now(),
    thumbnail: renderThumbnail(cam.shapes, images),
    shapes: cam.shapes,
    images,
    tabs: cam.tabs,
    surfacing: cam.surfacing,
    laser: cam.laser,
    machineId: main.machineId,
    materialId: main.materialId,
    bitId: main.bitId,
    params: main.params,
    savedSettings: main.savedSettings,
    userMachines: main.userMachines,
    userBits: main.userBits,
  }
}

export function saveProject(project: ProjectData): void {
  const map = projectMap()
  map[project.name] = project
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(map))
}

export function deleteProject(name: string): void {
  const map = projectMap()
  delete map[name]
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(map))
}

function persist(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* stockage plein / indisponible : le projet reste applique en memoire */
  }
}

export function applyProject(project: ProjectData): void {
  const cam = useCamStore.getState()
  const images: LaserImage[] = (Array.isArray(project.images) ? project.images : []).map((img) => ({
    ...img,
    data: new Uint8Array(img.data ?? []),
  }))
  // Les champs absents (anciens projets, fichier edite a la main) gardent les valeurs courantes.
  const tabs = { ...cam.tabs, ...(project.tabs ?? {}) }
  const surfacing = { ...cam.surfacing, ...(project.surfacing ?? {}) }
  const laser = { ...cam.laser, ...(project.laser ?? {}) }
  const shapes = Array.isArray(project.shapes) ? project.shapes : []
  useCamStore.setState({ shapes, images, tabs, surfacing, laser, selectedIds: [] })
  persist('design.shapes', shapes)
  persist('design.tabs', tabs)
  persist('design.surfacing', surfacing)
  persist('design.laser', laser)

  const main = useStore.getState()
  const userMachines = Array.isArray(project.userMachines) ? project.userMachines : []
  const userBits = Array.isArray(project.userBits) ? project.userBits : []
  const machines = [...MACHINES, ...userMachines]
  const bits = [...BITS, ...userBits]
  useStore.setState({ userMachines, userBits, machines, bits })
  persist('userMachines', userMachines)
  persist('userBits', userBits)

  const machineId = machines.some((m) => m.id === project.machineId) ? project.machineId : main.machineId
  const bitId = bits.some((b) => b.id === project.bitId) ? project.bitId : bits.some((b) => b.id === main.bitId) ? main.bitId : bits[0].id
  main.setMachine(machines.some((m) => m.id === machineId) ? machineId : machines[0].id)
  if (typeof project.materialId === 'string') main.setMaterial(project.materialId)
  main.setBit(bitId)
  if (project.params && typeof project.params === 'object') main.setParams(project.params)
  const savedSettings = project.savedSettings && typeof project.savedSettings === 'object' ? project.savedSettings : {}
  useStore.setState({ savedSettings })
  persist('savedSettings', savedSettings)
}

export function downloadProject(project: ProjectData): void {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${project.name.replace(/\s+/g, '_')}.easycnc.json`
  link.click()
  URL.revokeObjectURL(url)
}

export function parseProject(json: string): ProjectData {
  const data = JSON.parse(json) as ProjectData
  if (!data || typeof data !== 'object' || !Array.isArray(data.shapes)) {
    throw new Error('Projet invalide')
  }
  return data
}
