import type { Vec3 } from '../grbl/types'
import { useT } from '../i18n'
import { useStore } from '../state/store'

function fmt(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return '—'
  return value.toFixed(3).padStart(9, ' ')
}

function Row({ label, value }: { label: string; value: Vec3 | undefined }) {
  return (
    <div className="dro-row">
      <span className="dro-label">{label}</span>
      <span className="dro-axis">{fmt(value?.x)}</span>
      <span className="dro-axis">{fmt(value?.y)}</span>
      <span className="dro-axis">{fmt(value?.z)}</span>
    </div>
  )
}

export function DroPanel() {
  const status = useStore((s) => s.status)
  const t = useT()

  return (
    <section className="panel">
      <h2>{t('Position')}</h2>
      <div className="dro">
        <div className="dro-row head">
          <span className="dro-label" />
          <span>X</span>
          <span>Y</span>
          <span>Z</span>
        </div>
        <Row label="WPos" value={status?.wpos} />
        <Row label="MPos" value={status?.mpos} />
        <Row label="WCO" value={status?.wco} />
      </div>
      <div className="dro-meta">
        <span>{t('Avance')} {status?.fs ? status.fs.feed.toFixed(0) : '—'} mm/min</span>
        <span>{t('Broche')} {status?.fs ? status.fs.spindle.toFixed(0) : '—'}</span>
        <span>{t('Buffer')} {status?.buffer ? `${status.buffer.planner}/${status.buffer.rx}` : '—'}</span>
        <span>{t('Pin')} {status?.pn || '—'}</span>
      </div>
    </section>
  )
}
