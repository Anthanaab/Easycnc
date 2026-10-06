declare module 'opentype.js' {
  export interface PathCommand {
    type: 'M' | 'L' | 'C' | 'Q' | 'Z'
    x?: number
    y?: number
    x1?: number
    y1?: number
    x2?: number
    y2?: number
  }
  export interface Path {
    commands: PathCommand[]
  }
  export interface Font {
    getPath(text: string, x: number, y: number, fontSize: number): Path
  }
  export function parse(buffer: ArrayBuffer): Font
}
