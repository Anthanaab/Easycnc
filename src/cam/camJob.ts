import type { CutParams } from '../data/params'
import { toolpathToGcode, type GcodeOptions } from './gcode'
import { levelPaths, type LevelMap } from './leveling'
import { imagePaths, testGridPaths, type LaserImage } from './laserImage'
import { reliefPaths } from './relief'
import { loadFonts } from './text'
import { generateToolpath, type CamResult, type CutPath, type GenOptions } from './toolpath'
import type { Bounds, LaserSettings, Shape } from './types'

export interface ToolInfo {
  id?: string
  diameter: number
  angle?: number
  docMax?: number
  cutLength?: number
}

/** Calcul FAO serialisable (aucune fonction) : executable dans un Web Worker. */
export interface CamJob {
  kind?: 'mill'
  shapes: Shape[]
  params: CutParams
  /** Outil par defaut et outils par forme (shape.bitId). */
  tool: ToolInfo
  tools: Record<string, ToolInfo>
  options: Omit<GenOptions, 'resolveTool' | 'angle' | 'docMax'>
  /** Si present, le G-code est genere aussi. */
  gcode?: GcodeOptions
  /** Carte de nivellement a appliquer (surface non plane). */
  level?: LevelMap | null
}

export interface CamJobResult {
  result: CamResult
  gcode: string | null
}

/** Image sans sa source (data URL volumineuse, inutile au calcul). */
export type JobImage = Omit<LaserImage, 'src'>

export interface LaserJob {
  kind: 'laser'
  shapes: Shape[]
  params: CutParams
  laser: LaserSettings
  images: JobImage[]
  gcode: GcodeOptions
}

export interface ReliefJob {
  kind: 'relief'
  images: JobImage[]
  options: {
    maxDepth: number
    invert: boolean
    direction: 'x' | 'y'
    roughing: boolean
    allowance: number
    depthPerPass: number
    roughStepover: number
  }
  gcode: GcodeOptions
}

export type AnyJob = CamJob | LaserJob | ReliefJob

export function boundsOfPaths(paths: CutPath[]): Bounds | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const path of paths) {
    for (const p of path.points) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
  }
  return Number.isFinite(minX) ? { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } } : null
}

/** Point d'entree unique (worker ou fil principal). */
export function runAnyJob(job: AnyJob): Promise<CamJobResult> {
  if (job.kind === 'laser') return runLaserJob(job)
  if (job.kind === 'relief') return runReliefJob(job)
  return runCamJob(job)
}

async function runLaserJob(job: LaserJob): Promise<CamJobResult> {
  const { shapes, params, laser } = job
  if (shapes.some((shape) => shape.kind === 'text')) await loadFonts()
  // Toutes les formes dessinees sont gravees : laser_fill si demande, sinon contour.
  const laserShapes = shapes
    .filter((s) => s.enabled && s.kind !== 'testgrid' && s.op !== 'none')
    .map((s) => ({ ...s, op: s.op === 'laser_fill' ? 'laser_fill' : 'laser_contour' }) as Shape)
  const shapeResult = generateToolpath(laserShapes, params, 0.1, {
    laser: { power: laser.power, fillStepover: laser.fillStepover, passes: laser.passes, spotWidth: laser.spotWidth },
  })
  const imgPaths = job.images.flatMap((image) =>
    imagePaths(image as LaserImage, { mode: laser.imageMode, threshold: laser.threshold, overscan: laser.overscan }),
  )
  const gridPaths = shapes
    .filter((shape) => shape.kind === 'testgrid' && shape.enabled)
    .flatMap((shape) => {
      const cols = Math.max(1, Math.round(shape.cols ?? 5))
      const rows = Math.max(1, Math.round(shape.rows ?? 2))
      const cell = Math.max(1, shape.cell ?? 8)
      const gap = Math.max(0, shape.gap ?? 2)
      const totalW = cols * cell + (cols - 1) * gap
      const totalH = rows * cell + (rows - 1) * gap
      return testGridPaths({
        originX: shape.x - totalW / 2,
        originY: shape.y - totalH / 2,
        cell,
        gap,
        cols,
        rows,
        minPower: Math.round(laser.power * 0.1),
        maxPower: laser.power,
        hatchStep: 0.3,
      })
    })
  const paths = [...shapeResult.paths, ...imgPaths, ...gridPaths]
  const result: CamResult = { paths, warnings: shapeResult.warnings, bounds: boundsOfPaths(paths), moveCount: 0, cutLength: 0 }
  return { result, gcode: toolpathToGcode(result, job.gcode) }
}

async function runReliefJob(job: ReliefJob): Promise<CamJobResult> {
  const o = job.options
  const paths = job.images.flatMap((image) => {
    const img = image as LaserImage
    const finish = reliefPaths(img, { maxDepth: o.maxDepth, invert: o.invert, direction: o.direction, mode: 'finish' })
    const rough = o.roughing
      ? reliefPaths(img, {
          maxDepth: o.maxDepth,
          invert: o.invert,
          direction: o.direction,
          mode: 'rough',
          allowance: o.allowance,
          depthPerPass: o.depthPerPass,
          roughStepover: o.roughStepover,
        })
      : []
    return [...rough, ...finish]
  })
  const result: CamResult = { paths, warnings: [], bounds: boundsOfPaths(paths), moveCount: 0, cutLength: 0 }
  return { result, gcode: toolpathToGcode(result, job.gcode) }
}

export async function runCamJob(job: CamJob): Promise<CamJobResult> {
  // Les textes ont besoin des polices (chargees a la demande).
  if (job.shapes.some((shape) => shape.kind === 'text')) await loadFonts()
  const resolveTool = (shape: Shape): ToolInfo => (shape.bitId && job.tools[shape.bitId]) || job.tool
  const result = generateToolpath(job.shapes, job.params, job.tool.diameter, {
    ...job.options,
    angle: job.tool.angle,
    docMax: job.tool.docMax,
    resolveTool,
  })
  const final = job.level ? { ...result, paths: levelPaths(result.paths, job.level) } : result
  return { result: final, gcode: job.gcode ? toolpathToGcode(final, job.gcode) : null }
}
