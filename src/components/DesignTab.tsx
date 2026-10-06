import { useMemo } from 'react'
import { useCamStore } from '../cam/camStore'
import { toolpathToGcode } from '../cam/gcode'
import { generateToolpath } from '../cam/toolpath'
import { useLoc, useT } from '../i18n'
import { useStore } from '../state/store'
import { useUiStore } from '../state/uiStore'
import { DesignCanvas } from './DesignCanvas'
import { ShapeInspector } from './ShapeInspector'

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

export function DesignTab() {
  const shapes = useCamStore((s) => s.shapes)
  const tabs = useCamStore((s) => s.tabs)
  const surfacing = useCamStore((s) => s.surfacing)
  const setTabs = useCamStore((s) => s.setTabs)
  const setSurfacing = useCamStore((s) => s.setSurfacing)
  const stock = useCamStore((s) => s.stock)
  const setStock = useCamStore((s) => s.setStock)
  const cam = useCamStore((s) => s.cam)
  const setCam = useCamStore((s) => s.setCam)
  const bits = useStore((s) => s.bits)
  const bitId = useStore((s) => s.bitId)
  const params = useStore((s) => s.params)
  const machines = useStore((s) => s.machines)
  const machineId = useStore((s) => s.machineId)
  const loadFile = useStore((s) => s.loadFile)
  const setTab = useUiStore((s) => s.setTab)
  const language = useUiStore((s) => s.language)
  const t = useT()
  const loc = useLoc()
  const toolOf = (shapeId: string | undefined) => {
    const chosen = shapeId ? bits.find((b) => b.id === shapeId) : bit
    return chosen ?? bit
  }
  const resolveTool = (shape: { bitId?: string }) => {
    const b = toolOf(shape.bitId)
    return { id: b.id, diameter: b.diameter, angle: b.angle, docMax: b.docMax }
  }
  const toolNames = Object.fromEntries(bits.map((b) => [b.id, loc(b.name, b.nameEn)]))

  const bit = bits.find((b) => b.id === bitId) ?? bits[0]
  const machine = machines.find((m) => m.id === machineId) ?? machines[0]

  const result = useMemo(
    () =>
      generateToolpath(
        shapes.filter((s) => s.op !== 'laser_contour' && s.op !== 'laser_fill'),
        params,
        bit.diameter,
        { angle: bit.angle, docMax: bit.docMax, tabs, surfacing, entry: cam.entry, reverse: cam.reverse, optimize: cam.optimize, resolveTool },
      ),
    [shapes, params, bit, tabs, surfacing, cam, bits],
  )

  const gcode = useMemo(
    () =>
      toolpathToGcode(result, {
        safeZ: params.safeZ,
        feed: params.feed,
        plunge: params.plunge,
        rpm: params.rpm,
        spindleMode: machine.spindle.mode,
        preamble: machine.preamble,
        postamble: machine.postamble,
        units: cam.units,
        arcs: cam.arcs,
        toolChange: {
          names: toolNames,
          enabled: cam.toolChangeEnabled,
          x: cam.toolChangeX,
          y: cam.toolChangeY,
          reprobe: cam.reprobe,
        },
      }),
    [result, params, machine, cam, language],
  )

  const cutMinutes = params.feed > 0 ? result.cutLength / params.feed : 0
  const plcMinutes = result.paths.length > 0 ? (result.paths.length * (params.safeZ * 2 + Math.abs(params.doc))) / Math.max(params.plunge, 1) : 0
  const totalMinutes = cutMinutes + plcMinutes

  const load = () => {
    loadFile('conception.nc', gcode)
    setTab('pilotage')
  }

  const download = () => {
    const blob = new Blob([gcode], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'conception.nc'
    link.click()
    URL.revokeObjectURL(url)
  }

  const activeShapes = shapes.filter(
    (s) => s.enabled && s.op !== 'none' && s.op !== 'laser_contour' && s.op !== 'laser_fill',
  ).length

  return (
    <main className="design-layout">
      <div className="column left">
        <ShapeInspector />
      </div>

      <div className="design-center">
        <DesignCanvas result={result} />
        <div className="design-stats">
          <span>{activeShapes} {t('forme(s) usinée(s)')}</span>
          <span>{result.paths.length} {t('passe(s)')}</span>
          <span>{(result.cutLength / 1000).toFixed(2)} {t('m de coupe')}</span>
          <span>≈ {totalMinutes.toFixed(1)} min</span>
          <span>
            {t('Outil')} Ø {bit.diameter} mm · {params.feed} mm/min
          </span>
        </div>
      </div>

      <div className="column right">
        <section className="panel">
          <h2>{t('Brut (matière)')}</h2>
          <label className="check">
            <input type="checkbox" checked={stock.enabled} onChange={(e) => setStock({ enabled: e.target.checked })} />
            {t('Afficher la matière sur la grille')}
          </label>
          <div className="params-grid">
            <NumberField label={t('Largeur X (mm)')} value={stock.width} step={5} onChange={(v) => setStock({ width: v })} />
            <NumberField label={t('Hauteur Y (mm)')} value={stock.height} step={5} onChange={(v) => setStock({ height: v })} />
            <NumberField label={t('Épaisseur Z (mm)')} value={stock.thickness} step={1} onChange={(v) => setStock({ thickness: v })} />
            <NumberField label={t('Centre X (mm)')} value={stock.x} step={5} onChange={(v) => setStock({ x: v })} />
            <NumberField label={t('Centre Y (mm)')} value={stock.y} step={5} onChange={(v) => setStock({ y: v })} />
          </div>
          <div className="two-grid" style={{ marginTop: 8 }}>
            <button
              className="btn tiny"
              onClick={() => {
                if (!result.bounds) return
                setStock({
                  x: (result.bounds.min.x + result.bounds.max.x) / 2,
                  y: (result.bounds.min.y + result.bounds.max.y) / 2,
                })
              }}
            >
              {t('Centrer sur le dessin')}
            </button>
            <button
              className="btn tiny"
              onClick={() => {
                if (!result.bounds) return
                setStock({
                  width: Math.ceil((result.bounds.max.x - result.bounds.min.x) / 5) * 5,
                  height: Math.ceil((result.bounds.max.y - result.bounds.min.y) / 5) * 5,
                  x: (result.bounds.min.x + result.bounds.max.x) / 2,
                  y: (result.bounds.min.y + result.bounds.max.y) / 2,
                })
              }}
            >
              {t('Ajuster au dessin')}
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>{t('Usinage spécial')}</h2>

          <label className="check">
            <input type="checkbox" checked={tabs.enabled} onChange={(e) => setTabs({ enabled: e.target.checked })} />
            {t('Tenons de maintien')}
          </label>
          {tabs.enabled && (
            <div className="params-grid">
              <NumberField label={t('Largeur (mm)')} value={tabs.width} step={0.5} onChange={(v) => setTabs({ width: v })} />
              <NumberField label={t('Hauteur (mm)')} value={tabs.height} step={0.5} onChange={(v) => setTabs({ height: v })} />
              <NumberField label={t('Espacement (mm)')} value={tabs.spacing} step={5} onChange={(v) => setTabs({ spacing: v })} />
            </div>
          )}

          <label className="check">
            <input
              type="checkbox"
              checked={surfacing.enabled}
              onChange={(e) => setSurfacing({ enabled: e.target.checked })}
            />
            {t('Surfaçage du dessus')}
          </label>
          {surfacing.enabled && (
            <div className="params-grid">
              <NumberField label={t('Profondeur (mm)')} value={surfacing.depth} step={0.1} onChange={(v) => setSurfacing({ depth: v })} />
              <NumberField label={t('Recouvrement (mm)')} value={surfacing.stepover} step={0.5} onChange={(v) => setSurfacing({ stepover: v })} />
              <NumberField label={t('Marge (mm)')} value={surfacing.margin} step={1} onChange={(v) => setSurfacing({ margin: v })} />
            </div>
          )}

          <h3 className="sub">{t('Trajectoire')}</h3>
          <div className="params-grid">
            <label className="num-field">
              <span>{t('Entrée')}</span>
              <select value={cam.entry} onChange={(e) => setCam({ entry: e.target.value as 'plunge' | 'ramp' })}>
                <option value="plunge">{t('Plongée droite')}</option>
                <option value="ramp">{t('Rampe (entrée oblique)')}</option>
              </select>
            </label>
            <label className="num-field">
              <span>{t('Sens')}</span>
              <select value={cam.reverse ? 'ccw' : 'cw'} onChange={(e) => setCam({ reverse: e.target.value === 'ccw' })}>
                <option value="cw">{t('Horaire')}</option>
                <option value="ccw">{t('Anti-horaire (avalant)')}</option>
              </select>
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={cam.optimize} onChange={(e) => setCam({ optimize: e.target.checked })} />
            {t('Optimiser l\'ordre des parcours (moins de déplacements)')}
          </label>
          <div className="params-grid">
            <label className="num-field">
              <span>{t('Unités')}</span>
              <select value={cam.units} onChange={(e) => setCam({ units: e.target.value as 'mm' | 'in' })}>
                <option value="mm">{t('Millimètres (G21)')}</option>
                <option value="in">{t('Pouces (G20)')}</option>
              </select>
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={cam.arcs} onChange={(e) => setCam({ arcs: e.target.checked })} />
            {t('Sortie en arcs G2/G3 (cercles)')}
          </label>
          <h3 className="sub">{t('Changement d\'outil')}</h3>
          <label className="check">
            <input type="checkbox" checked={cam.toolChangeEnabled} onChange={(e) => setCam({ toolChangeEnabled: e.target.checked })} />
            {t('Déplacer vers la position de changement')}
          </label>
          <div className="params-grid">
            <NumberField label={t('Position X (mm)')} value={cam.toolChangeX} step={5} onChange={(v) => setCam({ toolChangeX: v })} />
            <NumberField label={t('Position Y (mm)')} value={cam.toolChangeY} step={5} onChange={(v) => setCam({ toolChangeY: v })} />
          </div>
          <label className="check">
            <input type="checkbox" checked={cam.reprobe} onChange={(e) => setCam({ reprobe: e.target.checked })} />
            {t('Demander le re-palpage Z après changement')}
          </label>

          <p className="notes">{t('V-carve : choisissez une fraise V et l\'opération « V-carve » sur la forme. Le surfaçage couvre l\'ensemble des formes (passe parallèle).')}</p>
        </section>

        <section className="panel">
          <h2>{t('Sortie G-code')}</h2>
          <div className="file-stats">
            <span>{gcode.split('\n').length} {t('lignes')}</span>
            <span>{result.moveCount} {t('mouvements')}</span>
          </div>
          {result.warnings.length > 0 && (
            <div className="warnings">
              {result.warnings.map((w, i) => (
                <div key={i} className="warn">
                  {w}
                </div>
              ))}
            </div>
          )}
          <div className="stream-controls">
            <button className="btn primary" disabled={!result.paths.length} onClick={load}>
              {t('Charger dans Pilotage')}
            </button>
            <button className="btn" disabled={!result.paths.length} onClick={download}>
              {t('Télécharger .nc')}
            </button>
          </div>
          <p className="notes">{t('Le G-code est chargé dans l\'onglet Pilotage : lancez d\'abord un essai à blanc, puis la coupe. Vérifiez l\'origine Z avant de lancer.')}</p>
        </section>

        <section className="panel">
          <h2>{t('Aperçu G-code')}</h2>
          <pre className="gcode-preview">{gcode.split('\n').slice(0, 60).join('\n')}</pre>
        </section>
      </div>
    </main>
  )
}
