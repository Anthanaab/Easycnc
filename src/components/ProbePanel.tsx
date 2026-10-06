import { useT } from '../i18n'
import { useStore } from '../state/store'

export function ProbePanel() {
  const connected = useStore((s) => s.connected)
  const homed = useStore((s) => s.homed)
  const status = useStore((s) => s.status)
  const machine = useStore((s) => s.machines.find((m) => m.id === s.machineId))
  const runProbe = useStore((s) => s.runProbe)
  const home = useStore((s) => s.home)
  const unlock = useStore((s) => s.unlock)

  const alarm = status?.state === 'Alarm'
  const probe = useStore((s) => s.probe)
  const t = useT()

  return (
    <section className="panel">
      <h2>{t('Origine & palpage')}</h2>

      <div className="status-line">
        <span className={homed ? 'ok' : 'muted'}>{t(homed ? '● Origine machine connue' : '○ Origine machine inconnue')}</span>
        {alarm && <span className="warn">{t('Alarme active')}</span>}
      </div>

      {alarm && (
        <button className="btn danger" onClick={unlock}>
          {t('Déverrouiller ($X)')}
        </button>
      )}

      <div className="ops-row">
        <button className="btn" disabled={!connected || !machine?.homing} onClick={home} title={machine?.homing ? 'Lancer le homing' : 'Homing indisponible sur ce profil'}>
          {t('⌂ Homing ($H)')}
        </button>
        <button className="btn primary" disabled={!connected} onClick={() => void runProbe()}>
          {t('Palper Z0')} ({t('plaque')} {probe.plate} mm)
        </button>
      </div>

      <p className="notes">{t('Placez la plaque sur la pièce, approchez la fraise au-dessus, puis lancez le palpage. En cas d\'échec, vérifiez le câblage du palpeur et le réglage $6.')}</p>
    </section>
  )
}
