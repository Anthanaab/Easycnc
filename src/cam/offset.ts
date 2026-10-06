import { Clipper, ClipperOffset, ClipType, EndType, JoinType, PolyFillType, PolyType } from 'clipper-lib'
import type { Path, Paths } from 'clipper-lib'
import type { Point } from './types'

const SCALE = 1000
const ARC_TOLERANCE = 0.05 * SCALE

function toClipper(loops: Point[][]): Paths {
  return loops.map((loop) => loop.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) })))
}

function fromClipper(paths: Paths): Point[][] {
  return paths
    .filter((path) => path.length >= 3)
    .map((path) => path.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE })))
}

/** Decale une ou plusieurs boucles: delta > 0 dilate, delta < 0 erode. */
export function offsetLoops(loops: Point[][], delta: number): Point[][] {
  const valid = loops.filter((loop) => loop.length >= 3)
  if (!valid.length) return []
  const offset = new ClipperOffset(2, ARC_TOLERANCE)
  offset.AddPaths(toClipper(valid), JoinType.jtRound, EndType.etClosedPolygon)
  const solution: Paths = []
  offset.Execute(solution, delta * SCALE)
  offset.Clear()
  return fromClipper(solution)
}

/** Union de deux ensembles de boucles. */
export function unionLoops(a: Point[][], b: Point[][]): Point[][] {
  if (!a.length) return b
  if (!b.length) return a
  const clipper = new Clipper()
  clipper.AddPaths(toClipper(a), PolyType.ptSubject, true)
  clipper.AddPaths(toClipper(b), PolyType.ptClip, true)
  const solution: Paths = []
  clipper.Execute(ClipType.ctUnion, solution, PolyFillType.pftNonZero, PolyFillType.pftNonZero)
  return fromClipper(solution)
}

/** Difference a - b. */
export function differenceLoops(a: Point[][], b: Point[][]): Point[][] {
  if (!a.length) return []
  const clipper = new Clipper()
  clipper.AddPaths(toClipper(a), PolyType.ptSubject, true)
  if (b.length) clipper.AddPaths(toClipper(b), PolyType.ptClip, true)
  const solution: Paths = []
  clipper.Execute(ClipType.ctDifference, solution, PolyFillType.pftNonZero, PolyFillType.pftNonZero)
  return fromClipper(solution)
}

/** Intersection a ∩ b. */
export function intersectionLoops(a: Point[][], b: Point[][]): Point[][] {
  if (!a.length || !b.length) return []
  const clipper = new Clipper()
  clipper.AddPaths(toClipper(a), PolyType.ptSubject, true)
  clipper.AddPaths(toClipper(b), PolyType.ptClip, true)
  const solution: Paths = []
  clipper.Execute(ClipType.ctIntersection, solution, PolyFillType.pftNonZero, PolyFillType.pftNonZero)
  return fromClipper(solution)
}

export function areaOf(loop: Point[]): number {
  const path: Path = loop.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }))
  return Clipper.Area(path) / (SCALE * SCALE)
}

/** Normalise un ensemble de boucles (extérieurs/trous) pour l'offset. */
export function normalizeLoops(loops: Point[][]): Point[][] {
  const valid = loops.filter((loop) => loop.length >= 3)
  if (!valid.length) return []
  const solution = Clipper.SimplifyPolygons(toClipper(valid), PolyFillType.pftEvenOdd)
  return fromClipper(solution)
}
