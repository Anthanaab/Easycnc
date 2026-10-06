import { differenceLoops, intersectionLoops, unionLoops } from './offset'
import type { Point } from './types'

export type BooleanOp = 'union' | 'subtract' | 'intersect'

export function combineLoops(a: Point[][], b: Point[][], op: BooleanOp): Point[][] {
  if (op === 'union') return unionLoops(a, b)
  if (op === 'subtract') return differenceLoops(a, b)
  return intersectionLoops(a, b)
}
