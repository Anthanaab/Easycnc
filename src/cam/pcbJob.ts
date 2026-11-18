import type { Hole } from './gerber'
import {
  boardRegion,
  clearingPaths,
  combineCopper,
  drillPaths,
  isolationPaths,
  mirrorX,
  outlinePaths,
  translatePaths,
} from './pcb'
import type { CutPath } from './toolpath'
import type { Bounds, Point, TabsSettings } from './types'

/** Entree serialisable du calcul PCB (executable dans le worker). */
export interface PcbInput {
  top: Point[][][]
  bottom: Point[][][]
  outline: Point[][][]
  holes: Hole[]
  mirrorBottom: boolean
  margin: number
  toolRadius: number
  isoGap: number
  isoPasses: number
  isoStepover: number
  isoDepth: number
  drillDepth: number
  outlineDepth: number
  tabs: TabsSettings
  doc: number
  clearance: number
  clearingStepover: number
}

export interface PcbOutput {
  copper: Point[][]
  outline: Point[][]
  board: Point[][]
  holes: Hole[]
  bounds: Bounds | null
  isolation: CutPath[]
  drills: CutPath[]
  contours: CutPath[]
  clearing: CutPath[]
}

export const EMPTY_PCB: PcbOutput = { copper: [], outline: [], board: [], holes: [], bounds: null, isolation: [], drills: [], contours: [], clearing: [] }

function boundsOf(points: Array<{ x: number; y: number }>): Bounds | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return Number.isFinite(minX) ? { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } } : null
}

function rectangle(bounds: Bounds): Point[][] {
  return [
    [
      { x: bounds.min.x, y: bounds.min.y },
      { x: bounds.max.x, y: bounds.min.y },
      { x: bounds.max.x, y: bounds.max.y },
      { x: bounds.min.x, y: bounds.max.y },
    ],
  ]
}

/** Cuivre fusionne, carte, puis parcours d'isolation, perçage, detourage, degagement. */
export function computePcb(input: PcbInput): PcbOutput {
  const { top, bottom, holes } = input
  let copper = combineCopper([...top, ...bottom])
  let outline = input.outline.flat()
  if (!copper.length && !outline.length) return { ...EMPTY_PCB, holes }
  const bbox = boundsOf([...copper.flat(), ...outline.flat(), ...holes.map((h) => ({ x: h.x, y: h.y }))])
  if (!bbox) return { ...EMPTY_PCB, holes }

  if (input.mirrorBottom && bottom.length) {
    const mirrored = bottom.flatMap((layer) => mirrorX(layer, bbox))
    copper = combineCopper([...top, mirrored])
  }
  // Origine au coin bas-gauche + marge.
  const dx = -bbox.min.x + input.margin
  const dy = -bbox.min.y + input.margin
  copper = translatePaths(copper, dx, dy)
  outline = outline.length ? translatePaths(outline, dx, dy) : rectangle(boundsOf(copper.flat())!)
  const movedHoles = holes.map((h) => ({ ...h, x: h.x + dx, y: h.y + dy }))
  const bounds = boundsOf([...copper.flat(), ...outline.flat()])
  const board = boardRegion(outline)

  const isolation = copper.length
    ? isolationPaths(copper, {
        toolRadius: input.toolRadius,
        gap: input.isoGap,
        passes: input.isoPasses,
        stepover: input.isoStepover,
        depth: input.isoDepth,
      })
    : []
  const drills = drillPaths(movedHoles, input.drillDepth, false)
  const contours = outlinePaths(board, input.outlineDepth, input.tabs, input.doc, input.toolRadius)
  const clearing =
    board.length && copper.length
      ? clearingPaths(board, copper, {
          toolRadius: input.toolRadius,
          clearance: input.clearance,
          stepover: input.clearingStepover,
          depth: input.isoDepth,
        })
      : []
  return { copper, outline, board, holes: movedHoles, bounds, isolation, drills, contours, clearing }
}
