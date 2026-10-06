import { useMemo, useRef, useState } from 'react'
import { useCamStore } from '../cam/camStore'
import { toolpathToGcode } from '../cam/gcode'
import { imageHeight, sampleImage, type LaserImage } from '../cam/laserImage'
import { reliefPaths } from '../cam/relief'
import type { CamResult } from '../cam/toolpath'
import type { Bounds } from '../cam/types'
import { useLoc, useT } from '../i18n'
import { useStore } from '../state/store'
import { useUiStore } from '../state/uiStore'
import { View3D } from './View3D'

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

function boundsOfPaths(paths: CamResult['paths']): Bounds | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const path of paths) {
    for (const p of path.points) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  }
  return Number.isFinite(minX) ? { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } } : null
}

export function ReliefTab() {
  const images = useCamStore((s) => s.images)
  const addImage = useCamStore((s) => s.addImage)
  const updateImage = useCamStore((s) => s.updateImage)
  const removeImage = useCamStore((s) => s.removeImage)
  const stockSetting = useCamStore((s) => s.stock)

  const bit = useStore((s) => s.bits.find((b) => b.id === s.bitId))
  const machine = useStore((s) => s.machines.find((m) => m.id === s.machineId))
  const params = useStore((s) => s.params)
  const loadFile = useStore((s) => s.loadFile)
  const setTab = useUiStore((s) => s.setTab)

  const [maxDepth, setMaxDepth] = useState(4)
  const [direction, setDirection] = useState<'x' | 'y'>('x')
  const [invert, setInvert] = useState(false)
  const [roughing, setRoughing] = useState(false)
  const [allowance, setAllowance] = useState(0.3)
  const [depthPerPass, setDepthPerPass] = useState(1)
  const [roughStepover, setRoughStepover] = useState(2)
  const [thickness, setThickness] = useState(10)
  const [resolution, setResolution] = useState(0.5)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(0.2)
  const [resetToken, setResetToken] = useState(0)
  const [, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const t = useT()
  const loc = useLoc()

  const result: CamResult = useMemo(() => {
    const paths = images.flatMap((image) => {
      const finish = reliefPaths(image, { maxDepth, invert, direction, mode: 'finish' })
      const rough = roughing
        ? reliefPaths(image, {
            maxDepth,
            invert,
            direction,
            mode: 'rough',
            allowance,
            depthPerPass,
            roughStepover,
          })
        : []
      return [...rough, ...finish]
    })
    return { paths, warnings: [], bounds: boundsOfPaths(paths), moveCount: 0, cutLength: 0 }
  }, [images, maxDepth, invert, direction, roughing, allowance, depthPerPass, roughStepover])

  const gcode = useMemo(
    () =>
      toolpathToGcode(result, {
        safeZ: params.safeZ,
        feed: params.feed,
        plunge: params.plunge,
        rpm: params.rpm,
        spindleMode: machine?.spindle.mode ?? 'grbl',
      }),
    [result, params, machine],
  )

  const onImport = (file: File) => {
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const src = String(reader.result ?? '')
        const sample = await sampleImage(src, 60, 0.5)
        const image: LaserImage = {
          id: `img${Date.now()}`,
          name: file.name,
          src,
          x: 0,
          y: 0,
          width: 60,
          pixelSize: 0.5,
          minPower: 0,
          maxPower: 1000,
          invert: false,
          cols: sample.cols,
          rows: sample.rows,
          data: sample.data,
        }
        addImage(image)
        setMessage(`Image chargée : ${sample.cols}×${sample.rows}`)
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Erreur image')
      }
    }
    reader.readAsDataURL(file)
  }

  const resample = async (image: LaserImage, width: number, pixelSize: number) => {
    const sample = await sampleImage(image.src, width, pixelSize)
    updateImage(image.id, { width, pixelSize, cols: sample.cols, rows: sample.rows, data: sample.data })
  }

  const load = () => {
    loadFile('relief.nc', gcode)
    setTab('pilotage')
  }

  const download = () => {
    const blob = new Blob([gcode], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'relief.nc'
    link.click()
    URL.revokeObjectURL(url)
  }

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

  return (
    <main className="design-layout">
      <div className="column left">
        <section className="panel">
          <div className="panel-head">
            <h2>{t('Images')} ({images.length})</h2>
            <button className="btn tiny" onClick={() => fileRef.current?.click()}>
              {t('Importer…')}
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onImport(file)
              e.target.value = ''
            }}
          />
          {message && <p className="notes">{message}</p>}
          {images.map((image) => (
            <div key={image.id} className="image-item">
              <div className="panel-head">
                <b>{image.name}</b>
                <button className="icon-btn danger" onClick={() => removeImage(image.id)}>
                  ✕
                </button>
              </div>
              <div className="params-grid">
                <NumberField label={t('Largeur (mm)')} value={image.width} step={5} onChange={(v) => void resample(image, v, image.pixelSize)} />
                <NumberField label={t('Pas écran (mm)')} value={image.pixelSize} step={0.05} onChange={(v) => void resample(image, image.width, v)} />
                <NumberField label={t('X (mm)')} value={image.x} step={1} onChange={(v) => updateImage(image.id, { x: v })} />
                <NumberField label={t('Y (mm)')} value={image.y} step={1} onChange={(v) => updateImage(image.id, { y: v })} />
              </div>
              <div className="file-stats">
                <span>{image.cols}×{image.rows} {t('points')}</span>
                <span>{imageHeight(image).toFixed(0)} {t('mm de haut')}</span>
              </div>
            </div>
          ))}
          {!images.length && <div className="empty">{t('Importez une image en niveaux de gris.')}</div>}
        </section>

        <section className="panel">
          <h2>{t('Relief')}</h2>
          <div className="params-grid">
            <NumberField label={t('Profondeur max (mm)')} value={maxDepth} step={0.5} onChange={setMaxDepth} />
            <label className="num-field">
              <span>{t('Direction')}</span>
              <select value={direction} onChange={(e) => setDirection(e.target.value as 'x' | 'y')}>
                <option value="x">{t('Balayage X')}</option>
                <option value="y">{t('Balayage Y')}</option>
              </select>
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
            {t('Inverser (blanc = profond)')}
          </label>
          <label className="check">
            <input type="checkbox" checked={roughing} onChange={(e) => setRoughing(e.target.checked)} />
            {t('Ébauche avant finition')}
          </label>
          {roughing && (
            <div className="params-grid">
              <NumberField label={t('Surépaisseur (mm)')} value={allowance} step={0.1} onChange={setAllowance} />
              <NumberField label={t('Passe (mm)')} value={depthPerPass} step={0.25} onChange={setDepthPerPass} />
              <NumberField label={t('Recouvrement ébauche (mm)')} value={roughStepover} step={0.5} onChange={setRoughStepover} />
            </div>
          )}
          <p className="notes">
            {t('Finition 3D : Z suit la luminosité. Utilisez une fraise')} <b>{t('sphérique')}</b> ({bit ? loc(bit.name, bit.nameEn) : '—'}). {t('Pas de balayage = pas écran de l\'image.')}
          </p>
        </section>
      </div>

      <div className="design-center">
        {hasPaths ? (
          <div className="view3d-main">
            <View3D
              result={result}
              toolDiameter={bit?.diameter ?? 3.175}
              toolType={bit?.type === 'ball' ? 'ball' : bit?.type === 'vbit' ? 'vbit' : 'flat'}
              toolAngle={bit?.angle}
              safeZ={params.safeZ}
              thickness={effectiveThickness}
              resolution={resolution}
              margin={2}
              playing={playing}
              speed={speed}
              resetToken={resetToken}
              onProgress={setProgress}
              stockBounds={stockBounds}
              bedArea={machine?.area}
            />
          </div>
        ) : (
          <div className="design-canvas">
            <div className="placeholder">{t('Aucune image')}</div>
          </div>
        )}
        <div className="design-stats">
          <span>{result.paths.length} {t('lignes')}</span>
          <span>≈ {maxDepth} mm</span>
          <span>{params.feed} mm/min · {t('Fraise')} Ø {bit?.diameter ?? '—'} mm</span>
        </div>
      </div>

      <div className="column right">
        <section className="panel">
          <div className="stream-controls">
            <button className="btn primary" disabled={!hasPaths} onClick={() => setPlaying((p) => !p)}>
              {playing ? `❚❚ ${t('Pause')}` : `▶ ${t('Simuler')}`}
            </button>
            <button className="btn" disabled={!hasPaths} onClick={() => setResetToken((v) => v + 1)}>
              ↺
            </button>
          </div>
          <div className="params-grid" style={{ marginTop: 10 }}>
            <NumberField label={t('Épaisseur brut')} value={thickness} step={1} onChange={setThickness} />
            <NumberField label={t('Vitesse simu')} value={speed} step={0.05} onChange={setSpeed} />
          </div>
        </section>

        <section className="panel">
          <h2>{t('Sortie G-code')}</h2>
          <div className="file-stats">
            <span>{gcode.split('\n').length} {t('lignes')}</span>
          </div>
          <div className="stream-controls">
            <button className="btn primary" disabled={!hasPaths} onClick={load}>
              {t('Charger dans Pilotage')}
            </button>
            <button className="btn" disabled={!hasPaths} onClick={download}>
              .nc
            </button>
          </div>
          <p className="notes">{t('Le relief peut être long. Lancez un essai à blanc avant.')}</p>
        </section>
      </div>
    </main>
  )
}
