import type { CutPath } from './toolpath'

export interface LaserImage {
  id: string
  name: string
  src: string
  x: number
  y: number
  width: number
  pixelSize: number
  minPower: number
  maxPower: number
  invert: boolean
  cols: number
  rows: number
  data: Uint8Array
}

export interface ImageSample {
  cols: number
  rows: number
  data: Uint8Array
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image illisible'))
    img.src = src
  })
}

export async function sampleImage(src: string, widthMm: number, pixelSize: number): Promise<ImageSample> {
  const img = await loadImage(src)
  const aspect = img.naturalHeight / Math.max(1, img.naturalWidth)
  const cols = Math.max(2, Math.min(800, Math.round(widthMm / Math.max(0.05, pixelSize))))
  const rows = Math.max(2, Math.min(800, Math.round(cols * aspect)))
  const canvas = document.createElement('canvas')
  canvas.width = cols
  canvas.height = rows
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponible')
  ctx.drawImage(img, 0, 0, cols, rows)
  const pixels = ctx.getImageData(0, 0, cols, rows).data
  const data = new Uint8Array(cols * rows)
  for (let i = 0; i < cols * rows; i++) {
    const r = pixels[i * 4]
    const g = pixels[i * 4 + 1]
    const b = pixels[i * 4 + 2]
    const a = pixels[i * 4 + 3] / 255
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) * a + 255 * (1 - a)
    data[i] = Math.round(lum)
  }
  return { cols, rows, data }
}

export function imageHeight(image: LaserImage): number {
  return image.rows * image.pixelSize
}

export type ImageMode = 'grayscale' | 'threshold' | 'dither'

export interface ImageRenderOptions {
  mode?: ImageMode
  threshold?: number
  overscan?: number
}

function binarize(image: LaserImage, mode: ImageMode, threshold: number): Uint8Array {
  const n = image.cols * image.rows
  const out = new Uint8Array(n)
  if (mode === 'threshold') {
    for (let i = 0; i < n; i++) out[i] = image.data[i] < threshold ? 0 : 255
    return out
  }
  const buf = Float32Array.from(image.data)
  for (let y = 0; y < image.rows; y++) {
    for (let x = 0; x < image.cols; x++) {
      const i = y * image.cols + x
      const old = buf[i]
      const nv = old < threshold ? 0 : 255
      const err = old - nv
      out[i] = nv
      const spread = (dx: number, dy: number, f: number) => {
        const nx = x + dx
        const ny = y + dy
        if (nx >= 0 && nx < image.cols && ny < image.rows) buf[ny * image.cols + nx] += err * f
      }
      spread(1, 0, 7 / 16)
      spread(-1, 1, 3 / 16)
      spread(0, 1, 5 / 16)
      spread(1, 1, 1 / 16)
    }
  }
  return out
}

export interface TestGridOptions {
  originX: number
  originY: number
  cell: number
  gap: number
  cols: number
  rows: number
  minPower: number
  maxPower: number
  hatchStep: number
}

/** Grille de test de puissance : carrés remplis à puissance croissante. */
export function testGridPaths(options: TestGridOptions): CutPath[] {
  const paths: CutPath[] = []
  const cells = options.cols * options.rows
  const span = options.maxPower - options.minPower
  for (let r = 0; r < options.rows; r++) {
    for (let c = 0; c < options.cols; c++) {
      const index = r * options.cols + c
      const power = Math.round(options.minPower + (cells > 1 ? (span * index) / (cells - 1) : 0))
      const ox = options.originX + c * (options.cell + options.gap)
      const oy = options.originY + r * (options.cell + options.gap)
      for (let y = oy + options.hatchStep / 2; y < oy + options.cell; y += options.hatchStep) {
        paths.push({
          points: [
            { x: ox, y, s: power },
            { x: ox + options.cell, y, s: power },
          ],
          closed: false,
          z: 0,
        })
      }
    }
  }
  return paths
}

/** Lignes de balayage bidirectionnelles avec puissance par point. */
export function imagePaths(image: LaserImage, options: ImageRenderOptions = {}): CutPath[] {
  const mode = options.mode ?? 'grayscale'
  const threshold = options.threshold ?? 128
  const overscan = Math.max(0, options.overscan ?? 0)
  const binary = mode === 'grayscale' ? image.data : binarize(image, mode, threshold)

  const paths: CutPath[] = []
  const height = imageHeight(image)
  const x0 = image.x - image.width / 2
  const yTop = image.y + height / 2
  for (let row = 0; row < image.rows; row++) {
    const y = yTop - (row + 0.5) * image.pixelSize
    const points = []
    for (let col = 0; col < image.cols; col++) {
      const cx = x0 + (col + 0.5) * image.pixelSize
      const lum = binary[row * image.cols + col] / 255
      let power: number
      if (mode === 'grayscale') {
        const darkness = image.invert ? lum : 1 - lum
        power = Math.round(image.minPower + darkness * (image.maxPower - image.minPower))
      } else {
        const burn = image.invert ? lum > 0.5 : lum < 0.5
        power = burn ? image.maxPower : 0
      }
      points.push({ x: cx, y, s: power })
    }
    if (row % 2 === 1) points.reverse()
    if (overscan > 0 && points.length) {
      const leftX = x0 - overscan
      const rightX = x0 + image.width + overscan
      const forward = points[0].x <= points[points.length - 1].x
      points.unshift({ x: forward ? leftX : rightX, y, s: 0 })
      points.push({ x: forward ? rightX : leftX, y, s: 0 })
    }
    paths.push({ points, closed: false, z: 0 })
  }
  return paths
}
