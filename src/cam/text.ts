import * as opentype from 'opentype.js'
import { FONT_DATA } from './fonts'
import type { Point } from './types'

export const FONTS = [
  { id: 'roboto400', label: 'Roboto' },
  { id: 'roboto700', label: 'Roboto Gras' },
  { id: 'oswald500', label: 'Oswald (condensée)' },
  { id: 'playfair700', label: 'Playfair (empattements)' },
  { id: 'pacifico400', label: 'Pacifico (écriture)' },
]

const fontCache: Record<string, opentype.Font> = {}
const outlineCache = new Map<string, Point[][]>()

function getFont(id: string): opentype.Font {
  const key = FONT_DATA[id] ? id : 'roboto700'
  if (!fontCache[key]) {
    const binary = atob(FONT_DATA[key])
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    fontCache[key] = opentype.parse(bytes.buffer)
  }
  return fontCache[key]
}

/** Contours d'un texte, centres sur l'origine (Y vers le haut), en mm. */
export function textLoops(text: string, fontId: string, size: number): Point[][] {
  const cacheKey = `${fontId}\u0001${size}\u0001${text}`
  const cached = outlineCache.get(cacheKey)
  if (cached) return cached

  const font = getFont(fontId)
  const lineHeight = size * 1.2
  const loops: Point[][] = []

  text.split('\n').forEach((line, lineIndex) => {
    if (!line.trim()) return
    const commands = font.getPath(line, 0, 0, size).commands
    let current: Point[] | null = null
    let px = 0
    let py = 0
    const pt = (x: number, y: number): Point => ({ x, y: -y - lineIndex * lineHeight })
    const end = () => {
      if (current && current.length > 2) loops.push(current)
      current = null
    }
    for (const c of commands) {
      if (c.type === 'M') {
        end()
        current = [pt(c.x!, c.y!)]
        px = c.x!
        py = c.y!
      } else if (c.type === 'L') {
        current?.push(pt(c.x!, c.y!))
        px = c.x!
        py = c.y!
      } else if (c.type === 'Q') {
        for (let i = 1; i <= 8; i++) {
          const t = i / 8
          const u = 1 - t
          current?.push(pt(u * u * px + 2 * u * t * c.x1! + t * t * c.x!, u * u * py + 2 * u * t * c.y1! + t * t * c.y!))
        }
        px = c.x!
        py = c.y!
      } else if (c.type === 'C') {
        for (let i = 1; i <= 10; i++) {
          const t = i / 10
          const u = 1 - t
          current?.push(
            pt(
              u * u * u * px + 3 * u * u * t * c.x1! + 3 * u * t * t * c.x2! + t * t * t * c.x!,
              u * u * u * py + 3 * u * u * t * c.y1! + 3 * u * t * t * c.y2! + t * t * t * c.y!,
            ),
          )
        }
        px = c.x!
        py = c.y!
      } else if (c.type === 'Z') {
        end()
      }
    }
    end()
  })

  for (const loop of loops) {
    const last = loop[loop.length - 1]
    if (loop.length > 1 && loop[0].x === last.x && loop[0].y === last.y) loop.pop()
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const loop of loops) {
    for (const p of loop) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  }
  const cx = Number.isFinite(minX) ? (minX + maxX) / 2 : 0
  const cy = Number.isFinite(minY) ? (minY + maxY) / 2 : 0
  const centered = loops.map((loop) => loop.map((p) => ({ x: p.x - cx, y: p.y - cy })))

  if (outlineCache.size > 100) outlineCache.clear()
  outlineCache.set(cacheKey, centered)
  return centered
}
