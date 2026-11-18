import type { CutParams } from '../data/params'
import { toolpathToGcode, type GcodeOptions } from './gcode'
import { loadFonts } from './text'
import { generateToolpath, type CamResult, type GenOptions } from './toolpath'
import type { Shape } from './types'

export interface ToolInfo {
  id?: string
  diameter: number
  angle?: number
  docMax?: number
  cutLength?: number
}

/** Calcul FAO serialisable (aucune fonction) : executable dans un Web Worker. */
export interface CamJob {
  shapes: Shape[]
  params: CutParams
  /** Outil par defaut et outils par forme (shape.bitId). */
  tool: ToolInfo
  tools: Record<string, ToolInfo>
  options: Omit<GenOptions, 'resolveTool' | 'angle' | 'docMax'>
  /** Si present, le G-code est genere aussi. */
  gcode?: GcodeOptions
}

export interface CamJobResult {
  result: CamResult
  gcode: string | null
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
  return { result, gcode: job.gcode ? toolpathToGcode(result, job.gcode) : null }
}
