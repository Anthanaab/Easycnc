import { useT } from '../i18n'
import { useStore } from '../state/store'

const COORD_SYSTEMS = ['G54', 'G55', 'G56', 'G57', 'G58', 'G59', 'G92']

export function OffsetsPanel() {
  const connected = useStore((s) => s.connected)
  const offsets = useStore((s) => s.offsets)
  const parserState = useStore((s) => s.parserState)
  const sendCommand = useStore((s) => s.sendCommand)
  const t = useT()

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t('Décalages')}</h2>
        <button className="btn tiny" disabled={!connected} onClick={() => void sendCommand('$#')}>
          {t('Rafraîchir')}
        </button>
      </div>

      <div className="parser-state" title="État modal courant [GC]">
        {parserState ?? '—'}
      </div>

      <div className="offset-list">
        {COORD_SYSTEMS.map((key) => {
          const value = offsets[key]
          return (
            <div key={key} className="offset-row">
              <span className="offset-label">{key}</span>
              <span>{value ? `${value.x.toFixed(3)}, ${value.y.toFixed(3)}, ${value.z.toFixed(3)}` : '—'}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
