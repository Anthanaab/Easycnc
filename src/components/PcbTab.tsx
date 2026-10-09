import { useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import { useCamStore } from '../cam/camStore'
import { toolpathToGcode } from '../cam/gcode'
import {
  detectFile,
  parseDrill,
  parseGerber,
  type DrillResult,
  type FileKind,
  type GerberResult,
  type Hole,
} from '../cam/gerber'
import {
  applyLeveling,
  clearingPaths,
  combineCopper,
  drillPaths,
  isolationPaths,
  makeLevelMap,
  mirrorX,
  boardRegion,
  outlinePaths,
  translatePaths,
  type LevelMap,
} from '../cam/pcb'
import type { CutPath } from '../cam/toolpath'
import type { Bounds, Point } from '../cam/types'
import { useT, useTf } from '../i18n'
import { client, machineBusyReason, useStore } from '../state/store'
import { useUiStore } from '../state/uiStore'
import { probeGrid } from '../grbl/level'

interface Entry {
  id: string
  name: string
  kind: FileKind
  gerber?: GerberResult
  drill?: DrillResult
}

function NumberField({
  label,
  value,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <label className="num-field">
      <span>{label}</span>
      <input type="number" step={step} value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}

function boundsOf(points: Array<{ x: number; y: number }>): Bounds | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return Number.isFinite(minX) ? { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } } : null
}

export function PcbTab() {
  const tabs = useCamStore((s) => s.tabs)
  const bit = useStore((s) => s.bits.find((b) => b.id === s.bitId))
  const params = useStore((s) => s.params)
  const machine = useStore((s) => s.machines.find((m) => m.id === s.machineId))
  const connected = useStore((s) => s.connected)
  const probeSettings = useStore((s) => s.probe)
  const loadFile = useStore((s) => s.loadFile)
  const setTab = useUiStore((s) => s.setTab)

  const [entries, setEntries] = useState<Entry[]>([])
  const [mirrorBottom, setMirrorBottom] = useState(false)
  const [margin, setMargin] = useState(10)
  const [isoGap, setIsoGap] = useState(0.2)
  const [isoPasses, setIsoPasses] = useState(1)
  const [isoStepover, setIsoStepover] = useState(0.3)
  const [isoDepth, setIsoDepth] = useState(0.15)
  const [drillDepth, setDrillDepth] = useState(2)
  const [outlineDepth, setOutlineDepth] = useState(2)
  const [clearance, setClearance] = useState(0.3)
  const [clearingStepover, setClearingStepover] = useState(0.4)
  const [levelCols, setLevelCols] = useState(6)
  const [levelRows, setLevelRows] = useState(5)
  const [level, setLevel] = useState<LevelMap | null>(null)
  const [useLevel, setUseLevel] = useState(false)
  const [probing, setProbing] = useState(false)
  const [progress, setProgress] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const t = useT()
  const tf = useTf()

  const toolRadius = (bit?.diameter ?? 0.2) / 2

  const derived = useMemo(() => {
    const topLayers = entries.filter((e) => e.kind === 'copper-top' && e.gerber).map((e) => e.gerber!.paths)
    const bottomLayers = entries.filter((e) => e.kind === 'copper-bottom' && e.gerber).map((e) => e.gerber!.paths)
    const outlineLayers = entries.filter((e) => e.kind === 'outline' && e.gerber).map((e) => e.gerber!.paths)
    const holes: Hole[] = entries.filter((e) => e.kind === 'drill' && e.drill).flatMap((e) => e.drill!.holes)

    const raw = [...topLayers, ...bottomLayers]
    let copper = combineCopper(raw)
    let outline = outlineLayers.flat()
    if (!copper.length && !outline.length) {
      return { copper: [] as Point[][], outline: [] as Point[][], board: [] as Point[][], holes, bounds: null as Bounds | null }
    }
    const boardPoints = [...copper.flat(), ...outline.flat(), ...holes.map((h) => ({ x: h.x, y: h.y }))]
    const bbox = boundsOf(boardPoints)
    if (!bbox) return { copper: [] as Point[][], outline: [] as Point[][], board: [] as Point[][], holes, bounds: null as Bounds | null }

    if (mirrorBottom && bottomLayers.length) {
      const mirrored = bottomLayers.flatMap((layer) => mirrorX(layer, bbox))
      copper = combineCopper([...topLayers, mirrored])
    }
    const dx = -bbox.min.x + margin
    const dy = -bbox.min.y + margin
    copper = translatePaths(copper, dx, dy)
    outline = outline.length ? translatePaths(outline, dx, dy) : rectangle(boundsOf(copper.flat())!, 0)
    const movedHoles = holes.map((h) => ({ ...h, x: h.x + dx, y: h.y + dy }))
    const bounds = boundsOf([...copper.flat(), ...outline.flat()])
    return { copper, outline, board: boardRegion(outline), holes: movedHoles, bounds }
  }, [entries, mirrorBottom, margin])

  const isolation = useMemo<CutPath[]>(() => {
    if (!derived.copper.length) return []
    return isolationPaths(derived.copper, {
      toolRadius,
      gap: isoGap,
      passes: isoPasses,
      stepover: isoStepover,
      depth: isoDepth,
    })
  }, [derived.copper, toolRadius, isoGap, isoPasses, isoStepover, isoDepth])

  const drills = useMemo(() => drillPaths(derived.holes, drillDepth, false), [derived.holes, drillDepth])
  const contours = useMemo<CutPath[]>(() => outlinePaths(derived.board, outlineDepth, tabs, params.doc, toolRadius), [derived.board, outlineDepth, tabs, params.doc, toolRadius])
  const clearing = useMemo<CutPath[]>(() => {
    if (!derived.board.length || !derived.copper.length) return []
    return clearingPaths(derived.board, derived.copper, {
      toolRadius,
      clearance,
      stepover: clearingStepover,
      depth: isoDepth,
    })
  }, [derived.board, derived.copper, toolRadius, clearance, clearingStepover, isoDepth])

  // Nivellement : isolation, degagement et percage (passes peu profondes ou
  // qui doivent traverser la carte). Le detourage traverse : inutile.
  const leveled = (paths: CutPath[]): CutPath[] => {
    if (!useLevel || !level) return paths
    const copy = paths.map((p) => ({ ...p, points: p.points.map((pt) => ({ ...pt })) }))
    applyLeveling(copy, level)
    return copy
  }
  const leveledIsolation = useMemo(() => leveled(isolation), [isolation, useLevel, level])
  const leveledClearing = useMemo(() => leveled(clearing), [clearing, useLevel, level])
  const leveledDrills = useMemo(() => leveled(drills), [drills, useLevel, level])

  const millOptions = {
    safeZ: params.safeZ,
    feed: params.feed,
    plunge: params.plunge,
    rpm: params.rpm,
    spindleMode: machine?.spindle.mode ?? 'grbl',
  }

  const gcodeFor = (paths: CutPath[]): string =>
    toolpathToGcode(
      { paths, warnings: [], bounds: derived.bounds, moveCount: 0, cutLength: 0 },
      millOptions,
    )

  const onFiles = async (files: FileList) => {
    const parsed: Entry[] = []
    const addText = (name: string, text: string) => {
      const kind = detectFile(name, text)
      if (kind === 'other') return
      if (kind === 'drill') parsed.push({ id: `${Date.now()}${Math.random()}`, name, kind, drill: parseDrill(text) })
      else parsed.push({ id: `${Date.now()}${Math.random()}`, name, kind, gerber: parseGerber(text) })
    }
    for (const file of Array.from(files)) {
      try {
        if (/\.zip$/i.test(file.name)) {
          const zip = await JSZip.loadAsync(await file.arrayBuffer())
          const entries = Object.values(zip.files).filter((entry) => !entry.dir && /\.(gbr|ger|gtl|gbl|gko|gm1|gml|drl|xln|exc|txt)$/i.test(entry.name))
          for (const entry of entries) addText(entry.name, await entry.async('string'))
        } else {
          addText(file.name, await file.text())
        }
      } catch (error) {
        parsed.push({ id: `${Date.now()}${Math.random()}`, name: file.name, kind: 'other' })
        console.error(error)
      }
    }
    setEntries((prev) => [...prev, ...parsed])
  }

  const runProbe = async () => {
    if (!derived.bounds) return
    const busy = machineBusyReason()
    if (busy) {
      setProgress(busy)
      return
    }
    setProbing(true)
    setProgress(t('Palpage…'))
    try {
      const heights = await probeGrid(
        client,
        derived.bounds,
        levelCols,
        levelRows,
        {
          safeZ: Math.max(params.safeZ, 1),
          retract: Math.min(3, Math.max(params.safeZ, 1)),
          fast: probeSettings.fast,
          slow: probeSettings.feed,
          // On part de Z securite : la course doit couvrir au moins Z0 + 3 mm.
          maxDepth: Math.max(params.safeZ, 1) + 3,
        },
        (done, total) => setProgress(tf('Palpage {done}/{total}', { done, total })),
      )
      // Ecart de chaque point par rapport au Z0 de travail courant (Z machine
      // du Z0 = WCO.z). A defaut, reference = point le plus haut.
      const wcoZ = useStore.getState().status?.wco?.z
      const reference = typeof wcoZ === 'number' ? wcoZ : Math.max(...heights)
      const deltas = heights.map((h) => h - reference)
      const spread = Math.max(...deltas) - Math.min(...deltas)
      if (spread > 1.5) throw new Error(tf('Écart de planéité {mm} mm : trop grand, vérifiez la carte et Z0', { mm: spread.toFixed(2) }))
      setLevel(makeLevelMap(derived.bounds, levelCols, levelRows, deltas))
      setUseLevel(true)
      setProgress(t('Nivellement prêt'))
    } catch (error) {
      setProgress(error instanceof Error ? error.message : t('Échec du palpage'))
    } finally {
      setProbing(false)
    }
  }

  const load = (name: string, paths: CutPath[]) => {
    if (!paths.length) return
    loadFile(name, gcodeFor(paths))
    setTab('pilotage')
  }

  const hasBoard = derived.copper.length > 0 || derived.outline.length > 0

  return (
    <main className="design-layout">
      <div className="column left">
        <section className="panel">
          <div className="panel-head">
            <h2>{t('Fichiers')} ({entries.length})</h2>
            <button className="btn tiny" onClick={() => fileRef.current?.click()}>
              {t('Importer…')}
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".gbr,.ger,.gtl,.gbl,.gko,.gm1,.drl,.xln,.txt"
            hidden
            onChange={(e) => {
              if (e.target.files) void onFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <div className="shape-list">
            {entries.map((e) => (
              <div key={e.id} className="shape-item">
                <span className="shape-name">{e.name}</span>
                <span className="shape-op">{e.kind}</span>
                <button
                  className="icon-btn danger"
                  onClick={() => setEntries((prev) => prev.filter((x) => x.id !== e.id))}
                >
                  ✕
                </button>
              </div>
            ))}
            {!entries.length && <div className="empty">{t('Gerber (cuivre, contour) et Excellon (perçage).')}</div>}
          </div>
          <label className="check">
            <input type="checkbox" checked={mirrorBottom} onChange={(e) => setMirrorBottom(e.target.checked)} />
            {t('Miroir face inférieure')}
          </label>
          <NumberField label={t('Marge bord (mm)')} value={margin} step={1} onChange={setMargin} />
        </section>

        <section className="panel">
          <h2>{t('Isolation')}</h2>
          <div className="params-grid">
            <NumberField label={t('Écartement (mm)')} value={isoGap} step={0.05} onChange={setIsoGap} />
            <NumberField label={t('Passes')} value={isoPasses} step={1} onChange={(v) => setIsoPasses(Math.max(1, Math.round(v)))} />
            <NumberField label={t('Recouvrement (mm)')} value={isoStepover} step={0.05} onChange={setIsoStepover} />
            <NumberField label={t('Profondeur (mm)')} value={isoDepth} step={0.05} onChange={setIsoDepth} />
          </div>
          <div className="file-stats">
            <span>{t('Fraise')} Ø {(toolRadius * 2).toFixed(2)} mm</span>
            <span>{isolation.length} {t('parcours')}</span>
          </div>
          <button className="btn primary" style={{ width: '100%' }} disabled={!isolation.length} onClick={() => load('isolation.nc', leveledIsolation)}>
            {t('Isolation → Pilotage')}
          </button>
        </section>

        <section className="panel">
          <h2>{t('Perçage / détourage')}</h2>
          <div className="params-grid">
            <NumberField label={t('Perçage (mm)')} value={drillDepth} step={0.5} onChange={setDrillDepth} />
            <NumberField label={t('Détourage (mm)')} value={outlineDepth} step={0.5} onChange={setOutlineDepth} />
          </div>
          <div className="file-stats">
            <span>{derived.holes.length} {t('trous')}</span>
            <span>{contours.length} {t('segments')}</span>
          </div>
          <div className="two-grid">
            <button className="btn" disabled={!drills.length} onClick={() => load('percage.nc', leveledDrills)}>
              {t('Perçage')}
            </button>
            <button className="btn" disabled={!contours.length} onClick={() => load('detourage.nc', contours)}>
              {t('Détourage')}
            </button>
          </div>

          <h3 className="sub">{t('Dégagement du cuivre')}</h3>
          <div className="params-grid">
            <NumberField label={t('Écartement (mm)')} value={clearance} step={0.05} onChange={setClearance} />
            <NumberField label={t('Recouvrement (mm)')} value={clearingStepover} step={0.05} onChange={setClearingStepover} />
          </div>
          <button className="btn" style={{ width: '100%' }} disabled={!clearing.length} onClick={() => load('degage.nc', leveledClearing)}>
            {t('Dégagement → Pilotage')} ({clearing.length} {t('parcours')})
          </button>
        </section>

        <section className="panel">
          <h2>{t('Nivellement auto')}</h2>
          <div className="params-grid">
            <NumberField label={t('Points X')} value={levelCols} step={1} onChange={(v) => setLevelCols(Math.max(2, Math.round(v)))} />
            <NumberField label={t('Points Y')} value={levelRows} step={1} onChange={(v) => setLevelRows(Math.max(2, Math.round(v)))} />
          </div>
          <button className="btn" disabled={!connected || !hasBoard || probing} onClick={() => void runProbe()}>
            {probing ? t('Palpage…') : t('Palper la grille')}
          </button>
          <label className="check">
            <input type="checkbox" checked={useLevel} disabled={!level} onChange={(e) => setUseLevel(e.target.checked)} />
            {t('Appliquer (isolation, dégagement, perçage)')}
          </label>
          {progress && <p className="notes">{progress}</p>}
        </section>
      </div>

      <div className="design-center">
        <PcbPreview copper={derived.copper} outline={derived.outline} isolation={leveledIsolation} holes={derived.holes} />
        <div className="design-stats">
          {derived.bounds ? (
            <span>
              {t('Carte')} {(derived.bounds.max.x - derived.bounds.min.x).toFixed(1)}×
              {(derived.bounds.max.y - derived.bounds.min.y).toFixed(1)} mm
            </span>
          ) : (
            <span>{t('Aucune carte importée')}</span>
          )}
          <span>{derived.holes.length} {t('trous')}</span>
          <span>{leveledIsolation.length} {t('parcours isolation')}</span>
        </div>
      </div>

      <div className="column right">
        <section className="panel">
          <h2>{t('Notes')}</h2>
          <p className="notes">{t('Importez le cuivre (F_Cu / B_Cu), le contour (Edge.Cuts) et le perçage (Excellon). L\'origine est placée au coin bas-gauche + marge. Utilisez une fraise V pour l\'isolation, puis changez d\'outil pour le perçage et le détourage. Le nivellement compense la planéité du plateau.')}</p>
          {entries.some((e) => e.kind === 'other') && <p className="warn notes">{t('Certains fichiers n\'ont pas été reconnus.')}</p>}
        </section>
      </div>
    </main>
  )
}

function rectangle(bounds: Bounds, margin: number): Point[][] {
  return [
    [
      { x: bounds.min.x - margin, y: bounds.min.y - margin },
      { x: bounds.max.x + margin, y: bounds.min.y - margin },
      { x: bounds.max.x + margin, y: bounds.max.y + margin },
      { x: bounds.min.x - margin, y: bounds.max.y + margin },
    ],
  ]
}

function PcbPreview({
  copper,
  outline,
  isolation,
  holes,
}: {
  copper: Point[][]
  outline: Point[][]
  isolation: CutPath[]
  holes: Hole[]
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => setSize({ width: container.clientWidth, height: container.clientHeight }))
    observer.observe(container)
    setSize({ width: container.clientWidth, height: container.clientHeight })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !size.width || !size.height) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size.width * dpr
    canvas.height = size.height * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#0b0e13'
    ctx.fillRect(0, 0, size.width, size.height)

    const all: Point[] = [...copper.flat(), ...outline.flat(), ...holes.map((h) => ({ x: h.x, y: h.y }))]
    if (!all.length) return
    const b = boundsOf(all)!
    const pad = 30
    const scale = Math.min((size.width - pad) / (b.max.x - b.min.x || 1), (size.height - pad) / (b.max.y - b.min.y || 1))
    const ox = (size.width - (b.max.x - b.min.x) * scale) / 2 - b.min.x * scale
    const oy = (size.height - (b.max.y - b.min.y) * scale) / 2 + b.max.y * scale
    const toX = (x: number) => x * scale + ox
    const toY = (y: number) => -y * scale + oy

    ctx.fillStyle = 'rgba(200,140,60,0.55)'
    for (const loop of copper) {
      ctx.beginPath()
      loop.forEach((p, i) => (i ? ctx.lineTo(toX(p.x), toY(p.y)) : ctx.moveTo(toX(p.x), toY(p.y))))
      ctx.closePath()
      ctx.fill()
    }

    ctx.strokeStyle = '#e0803c'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (const path of isolation) {
      path.points.forEach((p, i) => (i ? ctx.lineTo(toX(p.x), toY(p.y)) : ctx.moveTo(toX(p.x), toY(p.y))))
      if (path.closed && path.points.length) ctx.closePath()
    }
    ctx.stroke()

    ctx.strokeStyle = '#4c8dff'
    ctx.lineWidth = 1.4
    ctx.beginPath()
    for (const loop of outline) {
      loop.forEach((p, i) => (i ? ctx.lineTo(toX(p.x), toY(p.y)) : ctx.moveTo(toX(p.x), toY(p.y))))
      ctx.closePath()
    }
    ctx.stroke()

    ctx.fillStyle = '#35d0ba'
    for (const h of holes) {
      ctx.beginPath()
      ctx.arc(toX(h.x), toY(h.y), Math.max(1, (h.d / 2) * scale), 0, Math.PI * 2)
      ctx.fill()
    }
  }, [copper, outline, isolation, holes, size])

  return (
    <div className="design-canvas" ref={containerRef}>
      <canvas ref={ref} style={{ width: size.width, height: size.height }} />
    </div>
  )
}
