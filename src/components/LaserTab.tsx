import { useEffect, useMemo, useRef, useState } from 'react'
import { useCamStore } from '../cam/camStore'
import { toolpathToGcode } from '../cam/gcode'
import { imageHeight, imagePaths, sampleImage, testGridPaths, type LaserImage } from '../cam/laserImage'
import { shapeLoops } from '../cam/geometry'
import { generateToolpath, type CamResult, type CutPath } from '../cam/toolpath'
import type { Bounds, Shape } from '../cam/types'
import { useT, useTf } from '../i18n'
import { client, machineBusyReason, useStore } from '../state/store'
import { useUiStore } from '../state/uiStore'
import { DesignCanvas } from './DesignCanvas'

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
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

function boundsOfPaths(paths: CutPath[]): Bounds | null {
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

export function LaserTab() {
  const shapes = useCamStore((s) => s.shapes)
  const images = useCamStore((s) => s.images)
  const laser = useCamStore((s) => s.laser)
  const setLaser = useCamStore((s) => s.setLaser)
  const addImage = useCamStore((s) => s.addImage)
  const updateImage = useCamStore((s) => s.updateImage)
  const removeImage = useCamStore((s) => s.removeImage)
  const addShape = useCamStore((s) => s.addShape)
  const laserPresets = useCamStore((s) => s.laserPresets)
  const addLaserPreset = useCamStore((s) => s.addLaserPreset)
  const removeLaserPreset = useCamStore((s) => s.removeLaserPreset)
  const selectedIds = useCamStore((s) => s.selectedIds)

  const params = useStore((s) => s.params)
  const setParams = useStore((s) => s.setParams)
  const settings = useStore((s) => s.settings)
  const status = useStore((s) => s.status)
  const connected = useStore((s) => s.connected)
  const homed = useStore((s) => s.homed)
  const machine = useStore((s) => s.machines.find((m) => m.id === s.machineId))
  const sendCommand = useStore((s) => s.sendCommand)
  const loadFile = useStore((s) => s.loadFile)
  const setTab = useUiStore((s) => s.setTab)

  const [message, setMessage] = useState('')
  const [presetId, setPresetId] = useState('')
  const [presetName, setPresetName] = useState('')
  const [focusPct, setFocusPct] = useState(8)
  const [focusOn, setFocusOn] = useState(false)
  const focusStop = useRef(false)

  useEffect(() => () => {
    focusStop.current = true
    client.jogCancel()
  }, [])
  const fileRef = useRef<HTMLInputElement>(null)
  const t = useT()
  const tf = useTf()

  const combined: CamResult = useMemo(() => {
    // Toutes les formes dessinees sont gravees : laser_fill si demande, sinon contour.
    const laserShapes = shapes
      .filter((s) => s.enabled && s.kind !== 'testgrid' && s.op !== 'none')
      .map((s) => ({ ...s, op: s.op === 'laser_fill' ? 'laser_fill' : 'laser_contour' } as Shape))
    const shapeResult = generateToolpath(laserShapes, params, 0.1, {
      laser: { power: laser.power, fillStepover: laser.fillStepover, passes: laser.passes, spotWidth: laser.spotWidth },
    })
    const imgPaths = images.flatMap((image) =>
      imagePaths(image, { mode: laser.imageMode, threshold: laser.threshold, overscan: laser.overscan }),
    )
    const gridPaths = shapes
      .filter((shape) => shape.kind === 'testgrid' && shape.enabled)
      .flatMap((shape) => {
        const cols = Math.max(1, Math.round(shape.cols ?? 5))
        const rows = Math.max(1, Math.round(shape.rows ?? 2))
        const cell = Math.max(1, shape.cell ?? 8)
        const gap = Math.max(0, shape.gap ?? 2)
        const totalW = cols * cell + (cols - 1) * gap
        const totalH = rows * cell + (rows - 1) * gap
        return testGridPaths({
          originX: shape.x - totalW / 2,
          originY: shape.y - totalH / 2,
          cell,
          gap,
          cols,
          rows,
          minPower: Math.round(laser.power * 0.1),
          maxPower: laser.power,
          hatchStep: 0.3,
        })
      })
    const paths = [...shapeResult.paths, ...imgPaths, ...gridPaths]
    return { paths, warnings: shapeResult.warnings, bounds: boundsOfPaths(paths), moveCount: 0, cutLength: 0 }
  }, [shapes, params, images, laser.power, laser.fillStepover, laser.passes, laser.spotWidth, laser.imageMode, laser.threshold, laser.overscan])

  const gcode = useMemo(
    () =>
      toolpathToGcode(combined, {
        safeZ: params.safeZ,
        feed: params.feed,
        plunge: params.plunge,
        rpm: 0,
        spindleMode: 'grbl',
        laser: { mode: laser.mode, power: laser.power, focusZ: laser.focusZ },
      }),
    [combined, params, laser.mode, laser.power],
  )

  const laserModeOn = settings[32] === '1'
  const lineCount = gcode.split('\n').length

  const onImportImage = async (file: File) => {
    const reader = new FileReader()
    reader.onload = async () => {
      const src = String(reader.result ?? '')
      try {
        const sample = await sampleImage(src, 60, 0.2)
        const image: LaserImage = {
          id: `img${Date.now()}`,
          name: file.name,
          src,
          x: 0,
          y: 0,
          width: 60,
          pixelSize: 0.2,
          minPower: 0,
          maxPower: laser.power,
          invert: false,
          cols: sample.cols,
          rows: sample.rows,
          data: sample.data,
        }
        addImage(image)
        setMessage(tf('Image chargée : {cols}×{rows} points', { cols: sample.cols, rows: sample.rows }))
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
    loadFile('laser.nc', gcode, 'laser')
    setTab('pilotage')
  }

  const download = () => {
    const blob = new Blob([gcode], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'laser.nc'
    link.click()
    URL.revokeObjectURL(url)
  }

  const applyPreset = (id: string) => {
    setPresetId(id)
    const preset = laserPresets.find((p) => p.id === id)
    if (!preset) return
    setLaser({
      power: preset.power,
      passes: preset.passes,
      mode: preset.laserMode,
      overscan: preset.overscan,
      focusZ: preset.focusZ,
      spotWidth: preset.spotWidth,
    })
    setParams({ feed: preset.feed })
  }

  const savePreset = () => {
    const name = presetName.trim()
    if (!name) return
    addLaserPreset({
      id: `lp-${Date.now()}`,
      name,
      material: '',
      kind: laser.mode === 'M4' ? 'engrave' : 'cut',
      power: laser.power,
      feed: params.feed,
      passes: laser.passes,
      laserMode: laser.mode,
      overscan: laser.overscan,
      focusZ: laser.focusZ,
      spotWidth: laser.spotWidth,
      builtin: false,
    })
    setPresetName('')
  }

  const focusEnable = async () => {
    if (!connected || focusOn) return
    if (status?.state === 'Alarm') {
      setMessage(t('Alarme active'))
      return
    }
    const busy = machineBusyReason()
    if (busy) {
      setMessage(busy)
      return
    }
    if (status?.state !== 'Idle') {
      setMessage(t('Machine non prête (attendez Idle)'))
      return
    }
    const sMax = settings[30] !== undefined ? Number(settings[30]) : laser.power
    const s = Math.max(20, Math.round((sMax * focusPct) / 100))
    const d = 0.5
    const feed = 200

    // Apres un homing, la tete peut etre collee a un fin de course : on recentre
    // le va-et-vient a l'interieur de la course machine pour ne pas y aller.
    // Espace machine GRBL : [-course, 0] par defaut, [0, course] sinon.
    let shift = 0
    const travel = Number(settings[130]) > 0 ? Number(settings[130]) : machine?.area.x
    const machineX = status?.mpos?.x
    if (homed && travel && travel > d * 8 && typeof machineX === 'number') {
      const negative = machineX <= 0.5
      const lo = negative ? -travel + d * 2 : d * 2
      const hi = negative ? -d * 2 : travel - d * 2
      shift = Math.min(Math.max(machineX, lo), hi) - machineX
    }

    focusStop.current = false
    setFocusOn(true)
    setMessage(`${t('Laser focus ON')} (S${s}, mouvement ±${d} mm) — ${t('réglez la lentille pour le point le plus fin')}`)
    try {
      await client.send('G21')
      await client.send('G90')
      // Doc GRBL (laser_mode) : un jog n'allume le laser que si le mode de
      // mouvement modal est G1 (en G0, le laser est toujours coupe).
      await client.send(`G1 F${feed}`)
      await client.send(`M3 S${s}`)
      // Jogs relatifs : independants du repere de travail.
      await client.send(`$J=G91 G21 X${(shift + d).toFixed(3)} F${feed}`)
      let dir = -1
      while (!focusStop.current) {
        await client.send(`$J=G91 G21 X${(dir * d * 2).toFixed(3)} F${feed}`)
        dir = -dir
      }
    } catch {
      /* ignore */
    }
    client.jogCancel()
    try {
      await client.send('G4P0')
    } catch {
      /* ignore */
    }
    try {
      await client.send('M5')
    } catch {
      /* ignore */
    }
    setFocusOn(false)
    setMessage(t('Laser focus OFF'))
  }

  const focusDisable = () => {
    focusStop.current = true
    client.jogCancel()
  }

  const testLaser = async () => {
    if (!connected) return
    const busy = machineBusyReason()
    if (busy) {
      setMessage(busy)
      return
    }
    const s = settings[30] !== undefined ? Number(settings[30]) : laser.power
    setMessage(t('Test laser : allumage + trait de 5 mm…'))
    await sendCommand('G21')
    await sendCommand('G90')
    await sendCommand('G91')
    await sendCommand(`${laser.mode} S${Math.round(s)}`)
    await sendCommand('G1 X5 F300')
    await sendCommand('M5')
    await sendCommand('G90')
    setMessage(t('Test terminé (trait de 5 mm vers X+)'))
  }

  const frame = () => {
    const selected = shapes.filter((s) => selectedIds.includes(s.id))
    let bounds: Bounds | null = null
    if (selected.length) {
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const shape of selected) {
        for (const loop of shapeLoops(shape)) {
          for (const p of loop) {
            minX = Math.min(minX, p.x)
            minY = Math.min(minY, p.y)
            maxX = Math.max(maxX, p.x)
            maxY = Math.max(maxY, p.y)
          }
        }
      }
      if (Number.isFinite(minX)) bounds = { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } }
    }
    if (!bounds) bounds = combined.bounds
    if (!bounds) {
      setMessage(t('Rien à cadrer'))
      return
    }
    const m = 2
    const loop = [
      { x: bounds.min.x - m, y: bounds.min.y - m },
      { x: bounds.max.x + m, y: bounds.min.y - m },
      { x: bounds.max.x + m, y: bounds.max.y + m },
      { x: bounds.min.x - m, y: bounds.max.y + m },
    ]
    const frameResult: CamResult = {
      paths: [{ points: loop, closed: true, z: 0, power: laser.framingPower }],
      warnings: [],
      bounds,
      moveCount: 4,
      cutLength: 0,
    }
    const frameGcode = toolpathToGcode(frameResult, {
      safeZ: params.safeZ,
      feed: params.feed,
      plunge: params.plunge,
      rpm: 0,
      spindleMode: 'grbl',
      laser: { mode: laser.mode, power: laser.framingPower, focusZ: laser.focusZ },
    })
    loadFile('cadrage.nc', frameGcode, 'laser')
    setTab('pilotage')
  }

  const activeShapes = shapes.filter((s) => s.enabled && s.kind !== 'testgrid' && s.op !== 'none').length

  return (
    <main className="design-layout">
      <div className="column left">
        <section className="panel">
          <h2>{t('Laser')}</h2>
          <div className={`status-line ${laserModeOn ? '' : 'warn'}`}>
            <span>
              {t('Mode laser ($32)')} : <b>{settings[32] === undefined ? '—' : settings[32]}</b>
            </span>
          </div>
          <div className="status-line">
            <span>
              {t('Vitesse broche maxi ($30)')} : <b>{settings[30] === undefined ? '—' : settings[30]}</b>
            </span>
            {settings[30] !== undefined && Number(settings[30]) !== laser.power && (
              <button className="btn tiny" onClick={() => setLaser({ power: Number(settings[30]) })}>
                {t('Utiliser comme S max')}
              </button>
            )}
          </div>
          <div className="two-grid">
            <button className="btn tiny" disabled={!connected} onClick={() => void sendCommand('$$')}>
              {t('Lire $$')}
            </button>
            <button className="btn tiny" disabled={!connected} onClick={() => void sendCommand('$32=1')}>
              {t('Activer $32=1')}
            </button>
            <button className="btn tiny" disabled={!connected} onClick={() => void sendCommand('$32=0')} style={{ gridColumn: '1 / -1' }}>
              {t('Désactiver $32=0')}
            </button>
          </div>
          {!laserModeOn && settings[32] !== undefined && (
            <p className="warn notes">{t('Le mode laser n\'est pas actif. Activez $32=1 pour que la puissance S suive la vitesse.')}</p>
          )}

          <button className="btn" style={{ marginTop: 8, width: '100%' }} disabled={!connected} onClick={() => void testLaser()}>
            {t('Tester le laser (trait 5 mm)')}
          </button>

          <h3 className="sub">{t('Focus laser')}</h3>
          <div className="text-row">
            <NumberField label={t('Focus (%)')} value={focusPct} step={0.5} onChange={setFocusPct} />
            {!focusOn ? (
              <button className="btn" disabled={!connected} onClick={() => void focusEnable()}>
                {t('Focus ON')}
              </button>
            ) : (
              <button className="btn danger" onClick={() => focusDisable()}>
                {t('Focus OFF')}
              </button>
            )}
          </div>
          <p className="notes">{t('Focus : le laser reste allumé en faisant un va-et-vient de ±0,5 mm (utile si ta carte coupe le laser à l\'arrêt). Règle la lentille jusqu\'au point le plus fin, puis coupe.')}</p>

          <div className="params-grid" style={{ marginTop: 10 }}>
            <NumberField label={t('Puissance (S max)')} value={laser.power} step={10} onChange={(v) => setLaser({ power: v })} />
            <NumberField label={t('Remplissage (mm)')} value={laser.fillStepover} step={0.05} onChange={(v) => setLaser({ fillStepover: v })} />
            <NumberField label={t('Passes')} value={laser.passes} step={1} onChange={(v) => setLaser({ passes: Math.max(1, Math.round(v)) })} />
            <NumberField label={t('Cadrage (S)')} value={laser.framingPower} step={1} onChange={(v) => setLaser({ framingPower: v })} />
            <label className="num-field">
              <span>{t('Mode puissance')}</span>
              <select value={laser.mode} onChange={(e) => setLaser({ mode: e.target.value as 'M3' | 'M4' })}>
                <option value="M4">M4 ({t('dynamique')})</option>
                <option value="M3">M3 ({t('constant')})</option>
              </select>
            </label>
            <NumberField label={t('Overscan (mm)')} value={laser.overscan} step={0.5} onChange={(v) => setLaser({ overscan: v })} />
            <NumberField label={t('Focus Z (mm)')} value={laser.focusZ} step={0.5} onChange={(v) => setLaser({ focusZ: v })} />
            <NumberField label={t('Compensation trait (mm)')} value={laser.spotWidth} step={0.05} onChange={(v) => setLaser({ spotWidth: v })} />
            <label className="num-field">
              <span>{t('Mode image')}</span>
              <select
                value={laser.imageMode}
                onChange={(e) => setLaser({ imageMode: e.target.value as 'grayscale' | 'threshold' | 'dither' })}
              >
                <option value="grayscale">{t('Niveaux de gris')}</option>
                <option value="threshold">{t('Seuil (noir/blanc)')}</option>
                <option value="dither">{t('Dithering (Floyd)')}</option>
              </select>
            </label>
            {laser.imageMode !== 'grayscale' && (
              <NumberField label={t('Seuil (0-255)')} value={laser.threshold} step={5} onChange={(v) => setLaser({ threshold: v })} />
            )}
          </div>
          <h3 className="sub">{t('Profils laser')}</h3>
          <select value={presetId} onChange={(e) => applyPreset(e.target.value)} style={{ width: '100%' }}>
            <option value="">{t('Choisir un profil…')}</option>
            {laserPresets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.material ? ` — ${p.material}` : ''} ({p.power}, {p.feed} mm/min, ×{p.passes})
              </option>
            ))}
          </select>
          <div className="text-row" style={{ marginTop: 6 }}>
            <input value={presetName} placeholder={t('Nom du profil')} onChange={(e) => setPresetName(e.target.value)} />
            <button className="btn" onClick={savePreset}>
              {t('Enregistrer')}
            </button>
          </div>
          {presetId && !laserPresets.find((p) => p.id === presetId)?.builtin && (
            <button
              className="btn tiny danger"
              style={{ marginTop: 6 }}
              onClick={() => {
                removeLaserPreset(presetId)
                setPresetId('')
              }}
            >
              {t('Supprimer le profil')}
            </button>
          )}

          <h3 className="sub">{t('Grille de test de puissance')}</h3>
          <button className="btn" style={{ width: '100%' }} onClick={() => addShape('testgrid')}>
            {t('Ajouter une grille de test')}
          </button>
          <p className="notes">{t('Déplacez la grille à la souris sur le plan (Conception 2D) : sa position est utilisée pour le G-code. Laissez la gravure se terminer (les cases fortes sont à la fin).')}</p>
        </section>

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
              if (file) void onImportImage(file)
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
                <NumberField
                  label={t('Pas écran (mm)')}
                  value={image.pixelSize}
                  step={0.05}
                  onChange={(v) => void resample(image, image.width, v)}
                />
                <NumberField label={t('X (mm)')} value={image.x} step={1} onChange={(v) => updateImage(image.id, { x: v })} />
                <NumberField label={t('Y (mm)')} value={image.y} step={1} onChange={(v) => updateImage(image.id, { y: v })} />
                <NumberField label={t('S min')} value={image.minPower} step={10} onChange={(v) => updateImage(image.id, { minPower: v })} />
                <NumberField label={t('S max')} value={image.maxPower} step={10} onChange={(v) => updateImage(image.id, { maxPower: v })} />
              </div>
              <label className="check">
                <input type="checkbox" checked={image.invert} onChange={(e) => updateImage(image.id, { invert: e.target.checked })} />
                {t('Inverser (clair = plus fort)')}
              </label>
              <div className="file-stats">
                <span>{image.cols}×{image.rows} {t('points')}</span>
                <span>{(imageHeight(image)).toFixed(0)} {t('mm de haut')}</span>
              </div>
            </div>
          ))}
          {!images.length && <div className="empty">{t('Aucune image.')}</div>}
        </section>
      </div>

      <div className="design-center">
        <DesignCanvas result={combined} />
        <div className="design-stats">
          <span>{activeShapes} {t('forme(s) laser')}</span>
          <span>{combined.paths.length} {t('parcours')}</span>
          <span>{(combined.cutLength / 1000).toFixed(2)} {t('m de coupe')}</span>
          <span>{params.feed} mm/min</span>
        </div>
      </div>

      <div className="column right">
        <section className="panel">
          <h2>{t('Sortie laser')}</h2>
          <div className="file-stats">
            <span>{lineCount} {t('lignes')}</span>
          </div>
          <div className="stream-controls">
            <button className="btn" disabled={!combined.paths.length} onClick={frame}>
              {t('Cadrer')}
            </button>
            <button className="btn primary" disabled={!combined.paths.length} onClick={load}>
              {t('Charger dans Pilotage')}
            </button>
          </div>
          <button className="btn" style={{ marginTop: 8, width: '100%' }} disabled={!combined.paths.length} onClick={download}>
            {t('Télécharger .nc')}
          </button>
          <p className="notes">{t('Opérations laser sur les formes (contour / remplissage) dans l\'onglet Conception 2D. Le cadrage trace le rectangle à faible puissance pour positionner la pièce.')}</p>
        </section>

        <section className="panel">
          <h2>{t('G-code')}</h2>
          <pre className="gcode-preview">{gcode.split('\n').slice(0, 60).join('\n')}</pre>
        </section>
      </div>
    </main>
  )
}
