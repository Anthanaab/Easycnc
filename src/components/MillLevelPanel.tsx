import { useState } from 'react'
import { makeLevelMap } from '../cam/leveling'
import type { Bounds } from '../cam/types'
import { probeGrid } from '../grbl/level'
import { useT, useTf } from '../i18n'
import { levelStillValid, useLevelStore } from '../state/levelStore'
import { client, machineBusyReason, useStore } from '../state/store'

/**
 * Nivellement pour le fraisage : palpe une grille sur la zone du dessin et
 * corrige les Z du G-code (gravure fine sur une planche voilee, etc.).
 */
export function MillLevelPanel({ bounds }: { bounds: Bounds | null }) {
  const connected = useStore((s) => s.connected)
  const params = useStore((s) => s.params)
  const probeSettings = useStore((s) => s.probe)
  const wcoZ = useStore((s) => s.status?.wco?.z)
  const { map, wcoZ: mapWcoZ, probedAt, enabled, setMap, setEnabled, clear } = useLevelStore()
  const [cols, setCols] = useState(4)
  const [rows, setRows] = useState(3)
  const [message, setMessage] = useState('')
  const [probing, setProbing] = useState(false)
  const t = useT()
  const tf = useTf()

  const valid = levelStillValid(mapWcoZ, wcoZ)
  const spread = map ? Math.max(...map.heights) - Math.min(...map.heights) : 0

  const run = async () => {
    if (!bounds) return
    const busy = machineBusyReason()
    if (busy) {
      setMessage(busy)
      return
    }
    const currentWco = useStore.getState().status?.wco?.z
    if (currentWco === undefined) {
      setMessage(t('Origine de travail inconnue : définissez Z0 (palpage) avant.'))
      return
    }
    if (!window.confirm(t('Palper une grille sur la zone du dessin ? La sonde doit être branchée (pince sur la fraise, plaque ou surface conductrice).'))) return
    setProbing(true)
    setMessage(t('Palpage…'))
    try {
      const safeZ = Math.max(params.safeZ, 1)
      const heights = await probeGrid(
        client,
        { min: { x: bounds.min.x, y: bounds.min.y }, max: { x: bounds.max.x, y: bounds.max.y } },
        cols,
        rows,
        { safeZ, retract: Math.min(3, safeZ), fast: probeSettings.fast, slow: probeSettings.feed, maxDepth: safeZ + 3 },
        (done, total) => setMessage(tf('Palpage {done}/{total}', { done, total })),
      )
      const deltas = heights.map((h) => h - currentWco)
      const range = Math.max(...deltas) - Math.min(...deltas)
      if (range > 3) throw new Error(tf('Écart de planéité {mm} mm : trop grand, vérifiez la pièce et Z0', { mm: range.toFixed(2) }))
      setMap(makeLevelMap(bounds, cols, rows, deltas), currentWco)
      setMessage(tf('Nivellement prêt : écart max {mm} mm', { mm: range.toFixed(3) }))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setProbing(false)
    }
  }

  return (
    <section className="panel">
      <h2>{t('Nivellement (surface non plane)')}</h2>
      <div className="params-grid">
        <label className="num-field">
          <span>{t('Points X')}</span>
          <input type="number" min={2} max={20} value={cols} onChange={(e) => setCols(Math.max(2, Math.min(20, Math.round(Number(e.target.value)))))} />
        </label>
        <label className="num-field">
          <span>{t('Points Y')}</span>
          <input type="number" min={2} max={20} value={rows} onChange={(e) => setRows(Math.max(2, Math.min(20, Math.round(Number(e.target.value)))))} />
        </label>
      </div>
      <button className="btn" style={{ width: '100%' }} disabled={!connected || !bounds || probing} onClick={() => void run()}>
        {probing ? t('Palpage…') : t('Palper la zone du dessin')}
      </button>
      {map && (
        <>
          <label className="check">
            <input type="checkbox" checked={enabled && valid} disabled={!valid} onChange={(e) => setEnabled(e.target.checked)} />
            {t('Appliquer au G-code')} ({map.cols}×{map.rows}, {t('écart')} {spread.toFixed(3)} mm)
          </label>
          {!valid && <p className="notes warn">{t('Z0 a changé depuis le palpage : carte ignorée. Repalpez la grille.')}</p>}
          <div className="stream-controls">
            <span className="muted">{probedAt ? new Date(probedAt).toLocaleTimeString() : ''}</span>
            <button className="btn tiny" onClick={clear}>
              {t('Effacer')}
            </button>
          </div>
        </>
      )}
      {message && <p className="notes">{message}</p>}
    </section>
  )
}
