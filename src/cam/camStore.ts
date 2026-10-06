import { create } from 'zustand'
import { combineLoops, type BooleanOp } from './booleans'
import { alignShapes, distributeShapes, type AlignMode, type DistributeAxis } from './arrange'
import { shapeLoops } from './geometry'
import type { LaserImage } from './laserImage'
import { importSvg } from './svg'
import { LASER_PRESETS } from '../data/laserPresets'
import {
  createShape,
  type CamOptions,
  type LaserPreset,
  type LaserSettings,
  type Point,
  type Shape,
  type ShapeKind,
  type StockSettings,
  type SurfacingSettings,
  type TabsSettings,
} from './types'

interface ViewState {
  zoom: number
  panX: number
  panY: number
}

interface CamState {
  shapes: Shape[]
  selectedIds: string[]
  past: Shape[][]
  future: Shape[][]
  dragging: boolean
  snap: boolean
  snapStep: number
  view: ViewState
  tabs: TabsSettings
  surfacing: SurfacingSettings
  laser: LaserSettings
  stock: StockSettings
  cam: CamOptions
  images: LaserImage[]
  laserPresets: LaserPreset[]
  addShape: (kind: ShapeKind) => void
  addTextShape: (text: string, font: string, size: number) => void
  addPathShape: (loops: Point[][], name: string) => string
  importSvgShapes: (text: string) => number
  applyBoolean: (op: BooleanOp) => void
  align: (mode: AlignMode) => void
  distribute: (axis: DistributeAxis) => void
  updateShape: (id: string, partial: Partial<Shape>) => void
  removeShape: (id: string) => void
  duplicateShape: (id: string) => void
  select: (id: string | null, additive?: boolean) => void
  selectMany: (ids: string[]) => void
  pushHistory: () => void
  undo: () => void
  redo: () => void
  setDragging: (dragging: boolean) => void
  setSnap: (partial: { snap?: boolean; snapStep?: number }) => void
  setView: (view: Partial<ViewState>) => void
  setTabs: (partial: Partial<TabsSettings>) => void
  setSurfacing: (partial: Partial<SurfacingSettings>) => void
  setLaser: (partial: Partial<LaserSettings>) => void
  setStock: (partial: Partial<StockSettings>) => void
  setCam: (partial: Partial<CamOptions>) => void
  addImage: (image: LaserImage) => void
  updateImage: (id: string, partial: Partial<LaserImage>) => void
  removeImage: (id: string) => void
  addLaserPreset: (preset: LaserPreset) => void
  updateLaserPreset: (id: string, partial: Partial<LaserPreset>) => void
  removeLaserPreset: (id: string) => void
  clear: () => void
}

const HISTORY_MAX = 50

function loadShapes(): Shape[] {
  try {
    const raw = localStorage.getItem('design.shapes')
    if (raw) return JSON.parse(raw) as Shape[]
  } catch {
    /* ignore */
  }
  return []
}

function loadArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return JSON.parse(raw) as T[]
  } catch {
    /* ignore */
  }
  return []
}

function persistArray<T>(key: string, value: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

function persist(shapes: Shape[]): void {
  try {
    localStorage.setItem('design.shapes', JSON.stringify(shapes))
  } catch {
    /* ignore */
  }
}

function newId(): string {
  return `s${Date.now()}${Math.round(Math.random() * 1000)}`
}

function shapeLoopsCombined(shape: Shape): Point[][] {
  return shapeLoops(shape)
}

const initialShapes = loadShapes()
const initialUserLaserPresets = loadArray<LaserPreset>('userLaserPresets')

function loadSetting<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return { ...fallback, ...(JSON.parse(raw) as T) }
  } catch {
    /* ignore */
  }
  return fallback
}

const DEFAULT_TABS: TabsSettings = { enabled: false, width: 4, height: 1, spacing: 40 }
const DEFAULT_SURFACING: SurfacingSettings = { enabled: false, depth: 0.4, stepover: 4, margin: 0 }
const DEFAULT_LASER: LaserSettings = {
  power: 1000,
  fillStepover: 0.15,
  passes: 1,
  mode: 'M4',
  framingPower: 1,
  overscan: 2,
  imageMode: 'grayscale',
  threshold: 128,
  focusZ: 0,
  spotWidth: 0,
}
const DEFAULT_STOCK: StockSettings = { enabled: true, width: 100, height: 80, thickness: 10, x: 50, y: 40 }
const DEFAULT_CAM: CamOptions = {
  entry: 'plunge',
  reverse: false,
  optimize: true,
  units: 'mm',
  arcs: false,
  toolChangeEnabled: true,
  toolChangeX: 0,
  toolChangeY: 0,
  reprobe: true,
}

// Ancien defaut centre sur (0,0) : on le replace dans le quadrant positif
// (0,0 = home en bas-gauche) pour ne pas travailler hors plateau.
const initialStock: StockSettings = (() => {
  const s = loadSetting('design.stock', DEFAULT_STOCK)
  if (s.x === 0 && s.y === 0) return { ...s, x: s.width / 2, y: s.height / 2 }
  return s
})()

export const useCamStore = create<CamState>((set, get) => ({
  shapes: initialShapes,
  selectedIds: [],
  past: [],
  future: [],
  dragging: false,
  snap: true,
  snapStep: 1,
  view: { zoom: 3, panX: 0, panY: 0 },
  tabs: loadSetting('design.tabs', DEFAULT_TABS),
  surfacing: loadSetting('design.surfacing', DEFAULT_SURFACING),
  laser: loadSetting('design.laser', DEFAULT_LASER),
  stock: initialStock,
  cam: loadSetting('design.cam', DEFAULT_CAM),
  images: [],
  laserPresets: [...LASER_PRESETS, ...initialUserLaserPresets],

  pushHistory: () =>
    set((state) => {
      const past = [...state.past, state.shapes]
      if (past.length > HISTORY_MAX) past.shift()
      return { past, future: [] }
    }),

  undo: () =>
    set((state) => {
      if (!state.past.length) return {}
      const previous = state.past[state.past.length - 1]
      persist(previous)
      return {
        shapes: previous,
        past: state.past.slice(0, -1),
        future: [state.shapes, ...state.future].slice(0, HISTORY_MAX),
        selectedIds: [],
      }
    }),

  redo: () =>
    set((state) => {
      if (!state.future.length) return {}
      const next = state.future[0]
      persist(next)
      return {
        shapes: next,
        past: [...state.past, state.shapes].slice(-HISTORY_MAX),
        future: state.future.slice(1),
        selectedIds: [],
      }
    }),

  setDragging: (dragging) => set({ dragging }),
  setSnap: (partial) => set((state) => ({ snap: partial.snap ?? state.snap, snapStep: partial.snapStep ?? state.snapStep })),

  addShape: (kind) => {
    get().pushHistory()
    const shape = createShape(kind, get().shapes.length + 1)
    const shapes = [...get().shapes, shape]
    persist(shapes)
    set({ shapes, selectedIds: [shape.id] })
  },

  addTextShape: (text, font, size) => {
    get().pushHistory()
    const shape = createShape('text', get().shapes.length + 1)
    shape.text = text
    shape.font = font
    shape.fontSize = size
    shape.name = text.slice(0, 18) || 'Texte'
    const shapes = [...get().shapes, shape]
    persist(shapes)
    set({ shapes, selectedIds: [shape.id] })
  },

  addPathShape: (loops, name) => {
    get().pushHistory()
    const shape = createShape('path', get().shapes.length + 1)
    shape.loops = loops
    shape.name = name
    const shapes = [...get().shapes, shape]
    persist(shapes)
    set({ shapes, selectedIds: [shape.id] })
    return shape.id
  },

  importSvgShapes: (text) => {
    const { groups } = importSvg(text)
    if (!groups.length) return 0
    get().pushHistory()
    const created: Shape[] = groups.map((loops, index) => {
      const shape = createShape('path', get().shapes.length + index + 1)
      shape.loops = loops
      shape.name = `SVG ${index + 1}`
      return shape
    })
    const shapes = [...get().shapes, ...created]
    persist(shapes)
    set({ shapes, selectedIds: created.map((s) => s.id) })
    return created.length
  },

  applyBoolean: (op) => {
    const { shapes, selectedIds } = get()
    const selected = shapes.filter((s) => selectedIds.includes(s.id))
    if (selected.length < 2) return

    const loopSets = selected.map((s) => shapeLoopsCombined(s).filter((loop) => loop.length >= 3))
    let result: Point[][] = []
    if (op === 'union') {
      result = loopSets.reduce((acc, cur) => combineLoops(acc, cur, 'union'), [])
    } else if (op === 'intersect') {
      result = loopSets[0] ?? []
      for (let i = 1; i < loopSets.length; i++) result = combineLoops(result, loopSets[i], 'intersect')
    } else {
      const [base, ...rest] = loopSets
      const remove = rest.reduce((acc, cur) => combineLoops(acc, cur, 'union'), [])
      result = combineLoops(base ?? [], remove, 'subtract')
    }
    if (!result.length) return

    get().pushHistory()
    const first = selected[0]
    const shape = createShape('path', shapes.length + 1)
    shape.loops = result
    shape.name = op === 'union' ? 'Union' : op === 'subtract' ? 'Soustraction' : 'Intersection'
    shape.op = first.op === 'none' ? 'contour_out' : first.op
    shape.depth = Math.max(...selected.map((s) => s.depth))

    const remaining = shapes.filter((s) => !selectedIds.includes(s.id))
    const next = [...remaining, shape]
    persist(next)
    set({ shapes: next, selectedIds: [shape.id] })
  },

  align: (mode) => {
    get().pushHistory()
    const shapes = alignShapes(get().shapes, get().selectedIds, mode)
    persist(shapes)
    set({ shapes })
  },

  distribute: (axis) => {
    get().pushHistory()
    const shapes = distributeShapes(get().shapes, get().selectedIds, axis)
    persist(shapes)
    set({ shapes })
  },

  updateShape: (id, partial) => {
    if (!get().dragging) get().pushHistory()
    const shapes = get().shapes.map((s) => (s.id === id ? { ...s, ...partial } : s))
    persist(shapes)
    set({ shapes })
  },

  removeShape: (id) => {
    get().pushHistory()
    const shapes = get().shapes.filter((s) => s.id !== id)
    persist(shapes)
    set({ shapes, selectedIds: get().selectedIds.filter((sid) => sid !== id) })
  },

  duplicateShape: (id) => {
    const source = get().shapes.find((s) => s.id === id)
    if (!source) return
    get().pushHistory()
    const copy: Shape = { ...source, id: newId(), name: `${source.name} (copie)`, x: source.x + 5, y: source.y + 5 }
    const shapes = [...get().shapes, copy]
    persist(shapes)
    set({ shapes, selectedIds: [copy.id] })
  },

  select: (id, additive = false) => {
    if (id === null) {
      set({ selectedIds: [] })
      return
    }
    if (!additive) {
      set({ selectedIds: [id] })
      return
    }
    const current = get().selectedIds
    set({ selectedIds: current.includes(id) ? current.filter((x) => x !== id) : [...current, id] })
  },

  selectMany: (ids) => set({ selectedIds: ids }),
  setView: (view) => set((state) => ({ view: { ...state.view, ...view } })),
  setTabs: (partial) => {
    const tabs = { ...get().tabs, ...partial }
    localStorage.setItem('design.tabs', JSON.stringify(tabs))
    set({ tabs })
  },
  setSurfacing: (partial) => {
    const surfacing = { ...get().surfacing, ...partial }
    localStorage.setItem('design.surfacing', JSON.stringify(surfacing))
    set({ surfacing })
  },
  setLaser: (partial) => {
    const laser = { ...get().laser, ...partial }
    localStorage.setItem('design.laser', JSON.stringify(laser))
    set({ laser })
  },
  setStock: (partial) => {
    const stock = { ...get().stock, ...partial }
    localStorage.setItem('design.stock', JSON.stringify(stock))
    set({ stock })
  },
  setCam: (partial) => {
    const cam = { ...get().cam, ...partial }
    localStorage.setItem('design.cam', JSON.stringify(cam))
    set({ cam })
  },
  addImage: (image) => set((state) => ({ images: [...state.images, image] })),
  updateImage: (id, partial) =>
    set((state) => ({ images: state.images.map((img) => (img.id === id ? { ...img, ...partial } : img)) })),
  removeImage: (id) => set((state) => ({ images: state.images.filter((img) => img.id !== id) })),

  addLaserPreset: (preset) => {
    const user = [...loadArray<LaserPreset>('userLaserPresets'), preset]
    persistArray('userLaserPresets', user)
    set({ laserPresets: [...LASER_PRESETS, ...user] })
  },
  updateLaserPreset: (id, partial) => {
    const user = loadArray<LaserPreset>('userLaserPresets').map((p) => (p.id === id ? { ...p, ...partial } : p))
    persistArray('userLaserPresets', user)
    set({ laserPresets: [...LASER_PRESETS, ...user] })
  },
  removeLaserPreset: (id) => {
    const user = loadArray<LaserPreset>('userLaserPresets').filter((p) => p.id !== id)
    persistArray('userLaserPresets', user)
    set({ laserPresets: [...LASER_PRESETS, ...user] })
  },
  clear: () => {
    get().pushHistory()
    persist([])
    set({ shapes: [], selectedIds: [] })
  },
}))
