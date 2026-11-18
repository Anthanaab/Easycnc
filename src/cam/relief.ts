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

  // Ebauche : profondeur visee = relief + surepaisseur, arrondie au palier.
  const roughTarget = (lum: number): number => {
    const target = -depth * depthFactor(lum, options.invert)
    return Math.min(0, Math.ceil((target + allowance) / pass) * pass)
  }
  const finishAt = (lum: number): number => -depth * depthFactor(lum, options.invert)

  // Lignes de balayage (serpentin), chacune = suite d'echantillons (x, y, luminosite).
  const scanLines: Array<Array<{ x: number; y: number; lum: number }>> = []
  const across = options.direction === 'x'
  const outer = across ? image.rows : image.cols
  const inner = across ? image.cols : image.rows
  for (let a = 0; a < outer; a += stride) {
    const line: Array<{ x: number; y: number; lum: number }> = []
    for (let b = 0; b < inner; b++) {
      const row = across ? a : b
      const col = across ? b : a
      line.push({
        x: x0 + (col + 0.5) * image.pixelSize,
        y: y0 + (row + 0.5) * image.pixelSize,
        lum: image.data[row * image.cols + col],
      })
    }
    scanLines.push(line)
  }

  const emit = (zOf: (sample: { lum: number }) => number, skipAbove?: number) => {
    let flip = false
    for (const line of scanLines) {
      const points: CutPoint[] = line.map((sample) => ({ x: sample.x, y: sample.y, z: zOf(sample) }))
      // Rien a enlever sur cette ligne a ce palier.
      if (skipAbove !== undefined && points.every((p) => (p.z ?? 0) >= skipAbove - 1e-9)) continue
      if (flip) points.reverse()
      flip = !flip
      paths.push({ points, closed: false, z: 0 })
    }
  }

  if (!rough) {
    emit((sample) => finishAt(sample.lum))
    return paths
  }
  // Ebauche par paliers : jamais plus d'une passe (depthPerPass) de matiere a la fois.
  const deepest = Math.min(0, ...scanLines.flat().map((sample) => roughTarget(sample.lum)))
  const levels = Math.ceil(-deepest / pass - 1e-9)
  for (let k = 1; k <= levels; k++) {
    const levelZ = -k * pass
    const previous = -(k - 1) * pass
    emit((sample) => Math.max(roughTarget(sample.lum), levelZ), previous)
  }
  return paths
}
