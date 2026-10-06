import { useMemo, useState } from 'react'
import { useCamStore } from '../cam/camStore'
import { stockFromBounds, type ToolShape } from '../cam/simulation'
import { generateToolpath } from '../cam/toolpath'
import { useT } from '../i18n'
import { useStore } from '../state/store'
import { View3D } from './View3D'

export function View3DTab() {
  const shapes = useCamStore((s) => s.shapes)
  const tabs = useCamStore((s) => s.tabs)
  const surfacing = useCamStore((s) => s.surfacing)
  const stockSetting = useCamStore((s) => s.stock)
  const cam = useCamStore((s) => s.cam)
  const bits = useStore((s) => s.bits)
  const bitId = useStore((s) => s.bitId)
  const params = useStore((s) => s.params)
  const machine = useStore((s) => s.machines.find((m) => m.id === s.machineId))

  const [thickness, setThickness] = useState(10)
  const [resolution, setResolution] = useState(1)
  const [margin, setMargin] = useState(5)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(0.2)
  const [resetToken, setResetToken] = useState(0)
  const [progress, setProgress] = useState(0)
  const t = useT()

  const bit = bits.find((b) => b.id === bitId) ?? bits[0]
  const result = useMemo(
    () =>
      generateToolpath(shapes, params, bit.diameter, {
        angle: bit.angle,
        docMax: bit.docMax,
        tabs,
        surfacing,
        entry: cam.entry,
        reverse: cam.reverse,
        optimize: cam.optimize,
        resolveTool: (shape: { bitId?: string }) => {
          const b = (shape.bitId && bits.find((x) => x.id === shape.bitId)) || bit
          return { id: b.id, diameter: b.diameter, angle: b.angle, docMax: b.docMax }
        },
      }),
    [shapes, params, bit, tabs, surfacing, cam, bits],
  )
  const stock = useMemo(() => stockFromBounds(result.bounds, margin), [result.bounds, margin])

  const hasPaths = result.paths.length > 0
  const stockBounds = useMemo(
    () =>
      stockSetting.enabled
        ? {
            min: { x: stockSetting.x - stockSetting.width / 2, y: stockSetting.y - stockSetting.height / 2 },
            max: { x: stockSetting.x + stockSetting.width / 2, y: stockSetting.y + stockSetting.height / 2 },
          }
        : null,
    [stockSetting],
  )
  const effectiveThickness = stockSetting.enabled ? stockSetting.thickness : thickness

  const toolShapes = useMemo(() => {
    const map: Record<string, ToolShape> = {}
    for (const b of bits) {
      const kind = b.type === 'vbit' ? 'vbit' : b.type === 'ball' ? 'ball' : 'flat'
      map[b.id] = {
        kind,
        radius: Math.max(b.diameter, 0.1) / 2,
        tanHalf: kind === 'vbit' ? Math.tan(((b.angle ?? 90) / 2) * (Math.PI / 180)) : undefined,
      }
    }
    return map
  }, [bits])

  const reset = () => {
    setPlaying(false)
    setProgress(0)
    setResetToken((v) => v + 1)
  }

  return (
    <main className="view3d-layout">
      <div className="view3d-main">
        {hasPaths ? (
          <View3D
            result={result}
            toolDiameter={bit.diameter}
            toolType={bit.type === 'vbit' ? 'vbit' : bit.type === 'ball' ? 'ball' : 'flat'}
            toolAngle={bit.angle}
            safeZ={params.safeZ}
            thickness={effectiveThickness}
            resolution={resolution}
            margin={margin}
            playing={playing}
            speed={speed}
            resetToken={resetToken}
            onProgress={setProgress}
            stockBounds={stockBounds}
            toolShapes={toolShapes}
            bedArea={machine?.area}
          />
        ) : (
          <div className="placeholder">
            <h2>{t('Aucun parcours à simuler')}</h2>
            <p>{t('Ajoutez des formes et définissez une opération dans l\'onglet Conception 2D.')}</p>
          </div>
        )}
      </div>

      <div className="column right">
        <section className="panel">
          <h2>{t('Simulation')}</h2>
          <div className="stream-controls">
            <button className="btn primary" disabled={!hasPaths} onClick={() => setPlaying((p) => !p)}>
              {playing ? `❚❚ ${t('Pause')}` : `▶ ${t('Lire')}`}
            </button>
            <button className="btn" disabled={!hasPaths} onClick={reset}>
              ↺ {t('Réinitialiser')}
            </button>
          </div>
          <div className="progress" style={{ marginTop: 10 }}>
            <div className="progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
            <span className="progress-label">{Math.round(progress * 100)}%</span>
          </div>
          <label className="num-field" style={{ marginTop: 10 }}>
            <span>{t('Vitesse')}</span>
            <input type="range" min={0.05} max={1} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
          </label>
        </section>

        <section className="panel">
          <h2>{t('Matière')}</h2>
          <div className="params-grid">
            <label className="num-field">
              <span>{t('Épaisseur (mm)')}</span>
              <input type="number" min={1} step={1} value={thickness} onChange={(e) => setThickness(Number(e.target.value))} />
            </label>
            <label className="num-field">
              <span>{t('Résolution (mm)')}</span>
              <select value={resolution} onChange={(e) => setResolution(Number(e.target.value))}>
                <option value={0.2}>0.2</option>
                <option value={0.3}>0.3</option>
                <option value={0.5}>0.5</option>
                <option value={1}>1</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </label>
            <label className="num-field">
              <span>{t('Marge (mm)')}</span>
              <input type="number" min={0} step={1} value={margin} onChange={(e) => setMargin(Number(e.target.value))} />
            </label>
          </div>
          <div className="file-stats">
            <span>
              {t('Brut')} {(stock.max.x - stock.min.x).toFixed(0)}×{(stock.max.y - stock.min.y).toFixed(0)}×{thickness} mm
            </span>
          </div>
          <p className="notes">{t('Vue indicative : la heightmap sert à visualiser le résultat, elle n\'influence pas le G-code. La résolution plus fine est plus lente.')}</p>
        </section>
      </div>
    </main>
  )
}
