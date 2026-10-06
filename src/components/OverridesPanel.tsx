import { useT } from '../i18n'
import { useStore } from '../state/store'

export function OverridesPanel() {
  const connected = useStore((s) => s.connected)
  const status = useStore((s) => s.status)
  const feedHold = useStore((s) => s.feedHold)
  const cycleStart = useStore((s) => s.cycleStart)
  const feedOverride = useStore((s) => s.feedOverride)
  const spindleOverride = useStore((s) => s.spindleOverride)
  const rapidOverride = useStore((s) => s.rapidOverride)
  const t = useT()

  const ov = status?.ov ?? [100, 100, 100]
  const disabled = !connected

  return (
    <section className="panel">
      <h2>{t('Overrides')}</h2>

      <div className="stream-controls" style={{ marginBottom: 10 }}>
        <button className="btn" disabled={disabled} onClick={feedHold} title="Feed hold (0x21)">
          ⏸ {t('Hold')}
        </button>
        <button className="btn primary" disabled={disabled} onClick={cycleStart} title="Cycle start (0x7E)">
          ▶ {t('Start')}
        </button>
      </div>

      <div className="override-row">
        <span>{t('Avance')}</span>
        <button className="btn tiny" disabled={disabled} onClick={() => feedOverride('down')}>
          −
        </button>
        <b>{ov[0]} %</b>
        <button className="btn tiny" disabled={disabled} onClick={() => feedOverride('up')}>
          +
        </button>
        <button className="btn tiny" disabled={disabled} onClick={() => feedOverride('reset')}>
          100
        </button>
      </div>

      <div className="override-row">
        <span>{t('Broche')}</span>
        <button className="btn tiny" disabled={disabled} onClick={() => spindleOverride('down')}>
          −
        </button>
        <b>{ov[2]} %</b>
        <button className="btn tiny" disabled={disabled} onClick={() => spindleOverride('up')}>
          +
        </button>
        <button className="btn tiny" disabled={disabled} onClick={() => spindleOverride('reset')}>
          100
        </button>
      </div>

      <div className="override-row">
        <span>{t('Rapide')}</span>
        <button className="btn tiny" disabled={disabled} onClick={() => rapidOverride('25')}>
          25
        </button>
        <button className="btn tiny" disabled={disabled} onClick={() => rapidOverride('50')}>
          50
        </button>
        <button className="btn tiny" disabled={disabled} onClick={() => rapidOverride('100')}>
          100
        </button>
        <b>{ov[1]} %</b>
      </div>
    </section>
  )
}
