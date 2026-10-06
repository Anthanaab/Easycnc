import { useRef, useState } from 'react'
import { useCamStore } from '../cam/camStore'
import { FONTS } from '../cam/text'
import { OPERATIONS, type Operation, type Shape, type ShapeKind } from '../cam/types'
import { useLoc, useT } from '../i18n'
import { useStore } from '../state/store'

function NumberField({
  label,
  value,
  step = 1,
  min,
  onChange,
}: {
  label: string
  value: number
  step?: number
  min?: number
  onChange: (value: number) => void
}) {
  return (
    <label className="num-field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

const ADD_KINDS: Array<{ kind: ShapeKind; label: string }> = [
  { kind: 'rect', label: '▭ Rectangle' },
  { kind: 'circle', label: '◯ Cercle' },
  { kind: 'polygon', label: '⬡ Polygone' },
  { kind: 'star', label: '★ Étoile' },
]

const ALIGN_BUTTONS: Array<{ mode: 'left' | 'hcenter' | 'right' | 'bottom' | 'vcenter' | 'top'; label: string; title: string }> = [
  { mode: 'left', label: '⇤', title: 'Aligner à gauche' },
  { mode: 'hcenter', label: '↔', title: 'Centrer horizontalement' },
  { mode: 'right', label: '⇥', title: 'Aligner à droite' },
  { mode: 'bottom', label: '⇩', title: 'Aligner en bas' },
  { mode: 'vcenter', label: '↕', title: 'Centrer verticalement' },
  { mode: 'top', label: '⇧', title: 'Aligner en haut' },
]

export function ShapeInspector() {
  const shapes = useCamStore((s) => s.shapes)
  const selectedIds = useCamStore((s) => s.selectedIds)
  const addShape = useCamStore((s) => s.addShape)
  const addTextShape = useCamStore((s) => s.addTextShape)
  const importSvgShapes = useCamStore((s) => s.importSvgShapes)
  const applyBoolean = useCamStore((s) => s.applyBoolean)
  const align = useCamStore((s) => s.align)
  const distribute = useCamStore((s) => s.distribute)
  const updateShape = useCamStore((s) => s.updateShape)
  const removeShape = useCamStore((s) => s.removeShape)
  const duplicateShape = useCamStore((s) => s.duplicateShape)
  const select = useCamStore((s) => s.select)
  const selectMany = useCamStore((s) => s.selectMany)
  const clear = useCamStore((s) => s.clear)
  const undo = useCamStore((s) => s.undo)
  const redo = useCamStore((s) => s.redo)
  const canUndo = useCamStore((s) => s.past.length > 0)
  const canRedo = useCamStore((s) => s.future.length > 0)
  const snap = useCamStore((s) => s.snap)
  const snapStep = useCamStore((s) => s.snapStep)
  const setSnap = useCamStore((s) => s.setSnap)

  const [text, setText] = useState('EasyCNC')
  const [font, setFont] = useState('roboto700')
  const [size, setSize] = useState(20)
  const [message, setMessage] = useState('')
  const svgRef = useRef<HTMLInputElement>(null)
  const t = useT()
  const loc = useLoc()
  const bits = useStore((s) => s.bits)

  const selected = selectedIds.length === 1 ? shapes.find((s) => s.id === selectedIds[0]) ?? null : null
  const update = (partial: Partial<Shape>) => selected && updateShape(selected.id, partial)

  const onImportSvg = async (file: File) => {
    try {
      const count = importSvgShapes(await file.text())
      setMessage(count ? `${count} forme(s) importée(s)` : 'Aucun tracé exploitable')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erreur SVG')
    }
  }

  return (
    <div className="inspector">
      <section className="panel">
        <h2>{t('Ajouter')}</h2>
        <div className="add-grid">
          {ADD_KINDS.map((k) => (
            <button key={k.kind} className="btn" onClick={() => addShape(k.kind)}>
              {t(k.label)}
            </button>
          ))}
        </div>

        <h3 className="sub">{t('Texte')}</h3>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Votre texte')} />
        <div className="text-row">
          <select value={font} onChange={(e) => setFont(e.target.value)}>
            {FONTS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
          <input type="number" min={4} step={1} value={size} onChange={(e) => setSize(Number(e.target.value))} title="Hauteur (mm)" />
          <button className="btn" onClick={() => addTextShape(text, font, size)}>
            {t('Ajouter')}
          </button>
        </div>

        <h3 className="sub">{t('Import')}</h3>
        <button className="btn" onClick={() => svgRef.current?.click()}>
          {t('Importer un SVG…')}
        </button>
        <input
          ref={svgRef}
          type="file"
          accept=".svg,image/svg+xml"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void onImportSvg(file)
            e.target.value = ''
          }}
        />
        {message && <p className="notes">{message}</p>}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t('Formes')} ({shapes.length})</h2>
          <div className="head-actions">
            <button className="btn tiny" disabled={!canUndo} onClick={undo} title={t('Annuler')}>
              ↶
            </button>
            <button className="btn tiny" disabled={!canRedo} onClick={redo} title={t('Rétablir')}>
              ↷
            </button>
            <button className="btn tiny" disabled={!shapes.length} onClick={() => selectMany(shapes.map((s) => s.id))}>
              {t('Tout')}
            </button>
            <button className="btn tiny" disabled={!shapes.length} onClick={clear}>
              {t('Effacer')}
            </button>
          </div>
        </div>
        <label className="check" style={{ marginTop: 0 }}>
          <input type="checkbox" checked={snap} onChange={(e) => setSnap({ snap: e.target.checked })} />
          {t('Aimant')}
          <input
            type="number"
            min={0.1}
            step={0.5}
            value={snapStep}
            onChange={(e) => setSnap({ snapStep: Math.max(0.1, Number(e.target.value)) })}
            style={{ width: 64 }}
          />
          mm
        </label>
        <div className="shape-list">
          {shapes.map((shape) => (
            <div
              key={shape.id}
              className={`shape-item ${selectedIds.includes(shape.id) ? 'active' : ''} ${shape.enabled ? '' : 'off'}`}
              onClick={(e) => select(shape.id, e.shiftKey || e.ctrlKey || e.metaKey)}
            >
              <span className="shape-name">{shape.name}</span>
              <span className="shape-op">{t(OPERATIONS.find((o) => o.id === shape.op)?.label ?? '')}</span>
              <span className="shape-depth">{shape.depth} mm</span>
              <button
                className="icon-btn"
                title={t('Dupliquer')}
                onClick={(e) => {
                  e.stopPropagation()
                  duplicateShape(shape.id)
                }}
              >
                ⧉
              </button>
              <button
                className="icon-btn danger"
                title={t('Supprimer')}
                onClick={(e) => {
                  e.stopPropagation()
                  removeShape(shape.id)
                }}
              >
                ✕
              </button>
            </div>
          ))}
          {!shapes.length && <div className="empty">{t('Aucune forme. Ajoutez-en une.')}</div>}
        </div>
      </section>

      {selectedIds.length >= 2 && (
        <section className="panel">
          <h2>{selectedIds.length} {t('Formes')}</h2>
          <div className="sub">{t('Aligner')}</div>
          <div className="icon-grid">
            {ALIGN_BUTTONS.map((b) => (
              <button key={b.mode} className="btn" title={t(b.title)} onClick={() => align(b.mode)}>
                {b.label}
              </button>
            ))}
          </div>
          <div className="sub">{t('Répartir')}</div>
          <div className="two-grid">
            <button className="btn" onClick={() => distribute('horizontal')}>
              {t('Horizontal')}
            </button>
            <button className="btn" onClick={() => distribute('vertical')}>
              {t('Vertical')}
            </button>
          </div>
          <div className="sub">{t('Opérations booléennes')}</div>
          <div className="two-grid">
            <button className="btn" onClick={() => applyBoolean('union')}>
              {t('Fusionner')}
            </button>
            <button className="btn" onClick={() => applyBoolean('subtract')}>
              {t('Soustraire')}
            </button>
            <button className="btn" onClick={() => applyBoolean('intersect')}>
              {t('Intersection')}
            </button>
          </div>
        </section>
      )}

      {selected && (
        <section className="panel">
          <h2>{t('Propriétés')}</h2>
          <label className="field">
            <span>{t('Nom')}</span>
            <input value={selected.name} onChange={(e) => update({ name: e.target.value })} />
          </label>

          {selected.kind === 'text' && (
            <>
              <label className="field">
                <span>{t('Texte')}</span>
                <input value={selected.text ?? ''} onChange={(e) => update({ text: e.target.value })} />
              </label>
              <div className="params-grid">
                <label className="num-field">
                  <span>{t('Police')}</span>
                  <select value={selected.font} onChange={(e) => update({ font: e.target.value })}>
                    {FONTS.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
                <NumberField label={t('Hauteur (mm)')} value={selected.fontSize ?? 20} step={1} min={4} onChange={(v) => update({ fontSize: v })} />
              </div>
            </>
          )}

          <div className="params-grid">
            <NumberField label={t('X (mm)')} value={selected.x} step={0.5} onChange={(v) => update({ x: v })} />
            <NumberField label={t('Y (mm)')} value={selected.y} step={0.5} onChange={(v) => update({ y: v })} />
            <NumberField label={t('Rotation (°)')} value={selected.rotation} step={1} onChange={(v) => update({ rotation: v })} />
            {selected.kind === 'rect' && (
              <>
                <NumberField label={t('Largeur (mm)')} value={selected.width} step={1} min={0.1} onChange={(v) => update({ width: v })} />
                <NumberField label={t('Hauteur (mm)')} value={selected.height} step={1} min={0.1} onChange={(v) => update({ height: v })} />
              </>
            )}
            {(selected.kind === 'circle' || selected.kind === 'polygon' || selected.kind === 'star') && (
              <NumberField label={t('Rayon (mm)')} value={selected.radius} step={1} min={0.1} onChange={(v) => update({ radius: v })} />
            )}
            {selected.kind === 'polygon' && (
              <NumberField label={t('Côtés')} value={selected.sides} step={1} min={3} onChange={(v) => update({ sides: Math.round(v) })} />
            )}
            {selected.kind === 'star' && (
              <>
                <NumberField label={t('Branches')} value={selected.points} step={1} min={3} onChange={(v) => update({ points: Math.round(v) })} />
                <NumberField label={t('Ratio intérieur')} value={selected.innerRatio} step={0.05} onChange={(v) => update({ innerRatio: v })} />
              </>
            )}
            {selected.kind === 'testgrid' && (
              <>
                <NumberField label={t('Colonnes')} value={selected.cols ?? 5} step={1} min={1} onChange={(v) => update({ cols: Math.round(v) })} />
                <NumberField label={t('Lignes')} value={selected.rows ?? 2} step={1} min={1} onChange={(v) => update({ rows: Math.round(v) })} />
                <NumberField label={t('Cellule (mm)')} value={selected.cell ?? 8} step={1} min={1} onChange={(v) => update({ cell: v })} />
                <NumberField label={t('Écart (mm)')} value={selected.gap ?? 2} step={0.5} min={0} onChange={(v) => update({ gap: v })} />
              </>
            )}
          </div>

          <h3 className="sub">{t('Usinage')}</h3>
          <div className="params-grid">
            <label className="num-field">
              <span>{t('Opération')}</span>
              <select value={selected.op} onChange={(e) => update({ op: e.target.value as Operation })}>
                {OPERATIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {t(o.label)}
                  </option>
                ))}
              </select>
            </label>
            <NumberField label={t('Profondeur (mm)')} value={selected.depth} step={0.5} onChange={(v) => update({ depth: v })} />
            <label className="num-field">
              <span>{t('Outil')}</span>
              <select value={selected.bitId ?? ''} onChange={(e) => update({ bitId: e.target.value || undefined })}>
                <option value="">{t('Outil global')}</option>
                {bits.map((b) => (
                  <option key={b.id} value={b.id}>
                    {loc(b.name, b.nameEn)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={selected.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
            {t('Inclure dans l\'usinage')}
          </label>
        </section>
      )}
    </div>
  )
}
