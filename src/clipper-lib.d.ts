declare module 'clipper-lib' {
  export interface IntPoint {
    X: number
    Y: number
  }
  export type Path = IntPoint[]
  export type Paths = Path[]

  export const JoinType: {
    jtSquare: number
    jtRound: number
    jtMiter: number
  }
  export const EndType: {
    etClosedPolygon: number
    etClosedLine: number
    etOpenButt: number
    etOpenSquare: number
    etOpenRound: number
  }
  export const ClipType: {
    ctIntersection: number
    ctUnion: number
    ctDifference: number
    ctXor: number
  }
  export const PolyType: {
    ptSubject: number
    ptClip: number
  }
  export const PolyFillType: {
    pftEvenOdd: number
    pftNonZero: number
    pftPositive: number
    pftNegative: number
  }

  export class ClipperOffset {
    constructor(miterLimit?: number, arcTolerance?: number)
    AddPath(path: Path, joinType: number, endType: number): void
    AddPaths(paths: Paths, joinType: number, endType: number): void
    Execute(solution: Paths, delta: number): void
    Clear(): void
  }

  export class Clipper {
    constructor(initOptions?: number)
    AddPath(path: Path, polyType: number, closed: boolean): boolean
    AddPaths(paths: Paths, polyType: number, closed: boolean): boolean
    Execute(clipType: number, solution: Paths, subjFillType?: number, clipFillType?: number): boolean
    static Orientation(path: Path): boolean
    static Area(path: Path): number
    static SimplifyPolygons(paths: Paths, fillType?: number): Paths
  }
}
