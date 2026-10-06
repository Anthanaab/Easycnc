import type { LaserImage } from './laserImage'
import type { CutPath, CutPoint } from './toolpath'

export interface ReliefOptions {
  maxDepth: number
  invert: boolean
  direction: 'x' | 'y'
  mode?: 'finish' | 'rough'
  allowance?: number
  depthPerPass?: number
  roughStepover?: number
}

function depthFactor(lum: number, invert: boolean): number {
  const brightness = lum / 255
  return invert ? brightness : 1 - brightness
}

/** Parcours de relief 3D: Z proportionnel à la luminosité (finitions) ou
 *  paliers avec surépaisseur (ébauche). */
export function reliefPaths(image: LaserImage, options: ReliefOptions): CutPath[] {
  const paths: CutPath[] = []
  const height = image.rows * image.pixelSize
  const x0 = image.x - image.width / 2
  const y0 = image.y - height / 2
  const depth = Math.abs(options.maxDepth)
  const rough = options.mode === 'rough'
  const allowance = options.allowance ?? 0.3
  const pass = Math.max(0.1, options.depthPerPass ?? 1)
  const stride = rough ? Math.max(1, Math.round((options.roughStepover ?? image.pixelSize * 2) / image.pixelSize)) : 1

  const zAt = (lum: number): number => {
    const target = -depth * depthFactor(lum, options.invert)
    if (!rough) return target
    return Math.min(0, Math.ceil((target + allowance) / pass) * pass)
  }

  if (options.direction === 'x') {
    let flip = false
    for (let row = 0; row < image.rows; row += stride) {
      const y = y0 + (row + 0.5) * image.pixelSize
      const points: CutPoint[] = []
      for (let col = 0; col < image.cols; col++) {
        const x = x0 + (col + 0.5) * image.pixelSize
        points.push({ x, y, z: zAt(image.data[row * image.cols + col]) })
      }
      if (flip) points.reverse()
      flip = !flip
      paths.push({ points, closed: false, z: 0 })
    }
    return paths
  }

  let flip = false
  for (let col = 0; col < image.cols; col += stride) {
    const x = x0 + (col + 0.5) * image.pixelSize
    const points: CutPoint[] = []
    for (let row = 0; row < image.rows; row++) {
      const y = y0 + (row + 0.5) * image.pixelSize
      points.push({ x, y, z: zAt(image.data[row * image.cols + col]) })
    }
    if (flip) points.reverse()
    flip = !flip
    paths.push({ points, closed: false, z: 0 })
  }
  return paths
}
