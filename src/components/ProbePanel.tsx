import { useState } from 'react'
import type { Corner } from '../grbl/probe'
import { useT } from '../i18n'
import { useStore } from '../state/store'

const CORNERS: Corner[] = ['front-left', 'front-right', 'back-left', 'back-right']

export function ProbePanel() {
  const connected = useStore((s) => s.connected)
  const homed = useStore((s) => s.homed)
  const alarm = useStore((s) => s.status?.state === 'Alarm')
  const machine = useStore((s) => s.machines.find((m) => m.id === s.machineId))
  const runProbe = useStore((s) => s.runProbe)
  const home = useStore((s) => s.home)
  const unlock = useStore((s) => s.unlock)

  const probe = useStore((s) => s.probe)
  const settings = useStore((s) => s.settings)
  const setSetting = useStore((s) => s.setSetting)
  const setProbe = useStore((s) => s.setProbe)
  const runCornerProbe = useStore((s) => s.runCornerProbe)
  const measureReferenceTool = useStore((s) => s.measureReferenceTool)
  const measureNewTool = useStore((s) => s.measureNewTool)
  const clearToolOffset = useStore((s) => s.clearToolOffset)
  const toolRef = useStore((s) => s.toolRef)
  const tlo = useStore((s) => s.tlo)
  const bit = useStore((s) => s.bits.find((b) => b.id === s.bitId))
  const [corner, setCorner] = useState<Corner>('front-left')
  const [busy, setBusy] = useState(false)
  const t = useT()

  const mpos = useStore((s) => s.status?.mpos)
  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  const startCorner = async () => {
    const ok = window.confirm(
      `${t('Palpage de coin XYZ')} — ${t(`corner.${corner}`)}\n\n` +
        t('Avant de continuer :\n• plaque posée sur le coin (ou pièce conductrice), pince du palpeur sur la fraise\n• fraise au-dessus de la plaque, à 5–15 mm des bords\n• rien sur le passage autour du coin (brides, vis)') +
        `\n\n${t('Fraise')} Ø ${bit?.diameter ?? '?'} mm · ${t('paroi')} ${probe.xyWall ?? 0} mm · ${t('dégagement')} ${probe.xyTravel ?? 15} mm`,
    )
    if (!ok) return
    setBusy(true)
    try {
      await runCornerProbe(corner)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel">
      <h2>{t('Origine & palpage')}</h2>

      <div className="status-line">
        <span className={homed ? 'ok' : 'muted'}>{t(homed ? '● Origine machine connue' : '○ Origine machine inconnue')}</span>
        {alarm && <span className="warn">{t('Alarme active')}</span>}
      </div>

      {settings[20] === '0' && (settings[22] === '1' || machine?.homing) && (
        <div className="notes warn">
          {t('Limites logicielles désactivées ($20=0) : GRBL ne bloque pas les déplacements hors course.')}{' '}
          {settings[22] === '1' ? (
            <button className="btn tiny" disabled={!connected} onClick={() => void setSetting(20, 1)}>
              {t('Activer ($20=1)')}
            </button>
          ) : (
            t('Activez d\'abord le homing ($22=1).')
          )}
        </div>
      )}

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

      <h3 className="sub">{t('Palpage de coin XYZ')}</h3>
      <div className="params-grid">
        <label className="num-field">
          <span>{t('Coin')}</span>
          <select value={corner} onChange={(e) => setCorner(e.target.value as Corner)}>
            {CORNERS.map((c) => (
              <option key={c} value={c}>
                {t(`corner.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="num-field">
          <span>{t('Paroi plaque X/Y (mm)')}</span>
          <input type="number" min={0} step={0.1} value={probe.xyWall ?? 0} onChange={(e) => setProbe({ xyWall: Math.max(0, Number(e.target.value)) })} />
        </label>
        <label className="num-field">
          <span>{t('Dégagement latéral (mm)')}</span>
          <input type="number" min={5} max={60} step={1} value={probe.xyTravel ?? 15} onChange={(e) => setProbe({ xyTravel: Number(e.target.value) })} />
        </label>
      </div>
      <button className="btn" style={{ width: '100%' }} disabled={!connected || busy} onClick={() => void startCorner()}>
        {busy ? t('Palpage…') : t('Palper le coin (X, Y, Z)')}
      </button>

      <h3 className="sub">{t("Mesure d'outil (capteur fixe)")}</h3>
      <div className="params-grid">
        <label className="num-field">
          <span>{t('Capteur X machine')}</span>
          <input type="number" step={0.1} value={probe.toolsetterX ?? ''} onChange={(e) => setProbe({ toolsetterX: e.target.value === '' ? undefined : Number(e.target.value) })} />
        </label>
        <label className="num-field">
          <span>{t('Capteur Y machine')}</span>
          <input type="number" step={0.1} value={probe.toolsetterY ?? ''} onChange={(e) => setProbe({ toolsetterY: e.target.value === '' ? undefined : Number(e.target.value) })} />
        </label>
        <label className="num-field">
          <span>{t('Course de palpage (mm)')}</span>
          <input type="number" min={1} max={200} step={1} value={probe.toolsetterDepth ?? 40} onChange={(e) => setProbe({ toolsetterDepth: Number(e.target.value) })} />
        </label>
      </div>
      <button
        className="btn tiny"
        disabled={!mpos}
        onClick={() => mpos && setProbe({ toolsetterX: Number(mpos.x.toFixed(3)), toolsetterY: Number(mpos.y.toFixed(3)) })}
        title={t('Placez la fraise au-dessus du capteur (jog) puis cliquez')}
      >
        {t('Capteur = position actuelle')}
      </button>
      <div className="status-line">
        <span className={toolRef !== null ? 'ok' : 'muted'}>
          {toolRef !== null ? `${t('Référence')} : Z ${toolRef.toFixed(3)}` : t('Pas d\'outil de référence')}
        </span>
        <span className={tlo ? 'warn' : 'muted'}>TLO {tlo !== null ? tlo.toFixed(3) : '—'}</span>
      </div>
      <div className="ops-row">
        <button className="btn" disabled={!connected || !homed || busy} onClick={() => void withBusy(measureReferenceTool)}>
          {t('Mesurer la référence')}
        </button>
        <button className="btn" disabled={!connected || !homed || toolRef === null || busy} onClick={() => void withBusy(measureNewTool)}>
          {t('Mesurer le nouvel outil (G43.1)')}
        </button>
        <button className="btn tiny" disabled={!connected || !tlo} onClick={clearToolOffset}>
          G49
        </button>
      </div>
      {!homed && <p className="notes">{t('Homing ($H) requis : le capteur est repéré en coordonnées machine.')}</p>}

      <p className="notes">{t('Placez la plaque sur la pièce, approchez la fraise au-dessus, puis lancez le palpage. En cas d\'échec, vérifiez le câblage du palpeur et le réglage $6.')}</p>
    </section>
  )
}
