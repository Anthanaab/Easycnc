import { useState } from 'react'
import { useT } from '../i18n'
import { useStore } from '../state/store'
import { useUiStore } from '../state/uiStore'

/**
 * Assistant de pause programme (M0, ex. changement d'outil) : visible depuis
 * tous les onglets, sans bloquer l'interface (jog et DRO restent accessibles).
 */
export function ProgramPauseCard() {
  const stream = useStore((s) => s.stream)
  const wpos = useStore((s) => s.status?.wpos)
  const resumeStream = useStore((s) => s.resumeStream)
  const stopStream = useStore((s) => s.stopStream)
  const runProbe = useStore((s) => s.runProbe)
  const goToWorkZero = useStore((s) => s.goToWorkZero)
  const measureNewTool = useStore((s) => s.measureNewTool)
  const toolsetterReady = useStore((s) => s.toolRef !== null && s.homed && s.probe.toolsetterX !== undefined)
  const setTab = useUiStore((s) => s.setTab)
  const [probing, setProbing] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const t = useT()

  if (stream.state !== 'paused' || stream.pauseReason !== 'program') return null
  const toolChange = /outil|tool/i.test(stream.pauseMessage ?? '')
  const reprobe = /palp|probe/i.test(stream.pauseMessage ?? '')

  const probe = async () => {
    setProbing(true)
    try {
      await runProbe()
    } finally {
      setProbing(false)
    }
  }

  return (
    <aside className={`pause-card ${collapsed ? 'collapsed' : ''}`} role="dialog" aria-live="assertive">
      <div className="pause-card-head">
        <strong>⏸ {stream.pauseMessage ?? t('Pause programme (M0)')}</strong>
        <button className="btn tiny" onClick={() => setCollapsed(!collapsed)} title={t('Réduire')}>
          {collapsed ? '▴' : '▾'}
        </button>
      </div>
      {!collapsed && (
        <>
          <ol className="pause-steps">
            {toolChange && <li>{t('Broche arrêtée : changez l\'outil et serrez la pince.')}</li>}
            {reprobe ? (
              <li>{t('Posez la plaque, approchez la fraise, puis « Palper Z0 ».')}</li>
            ) : (
              toolChange && <li>{t('Si la longueur d\'outil change, re-palpez Z0.')}</li>
            )}
            <li>{t('Retirez la plaque et les clés, puis « Reprendre » : la broche redémarre avant la suite.')}</li>
          </ol>
          <div className="pause-pos">
            WPos {wpos ? `X ${wpos.x.toFixed(2)} · Y ${wpos.y.toFixed(2)} · Z ${wpos.z.toFixed(2)}` : '—'}
          </div>
          <div className="pause-actions">
            <button className="btn" onClick={() => setTab('pilotage')}>
              {t('Jog (Pilotage)')}
            </button>
            {toolsetterReady && (
              <button
                className="btn"
                disabled={probing}
                onClick={async () => {
                  setProbing(true)
                  try {
                    await measureNewTool()
                  } finally {
                    setProbing(false)
                  }
                }}
                title={t('Mesure sur le capteur fixe et correction G43.1 : pas besoin de re-palper la pièce')}
              >
                {t('Mesurer l\'outil (capteur)')}
              </button>
            )}
            <button className="btn" disabled={probing} onClick={() => void probe()}>
              {probing ? t('Palpage…') : t('Palper Z0')}
            </button>
            <button className="btn" onClick={goToWorkZero}>
              {t('→ X0 Y0 (Z sécurité)')}
            </button>
          </div>
          <div className="pause-actions">
            <button className="btn primary" disabled={probing} onClick={resumeStream}>
              ▶ {t('Reprendre')}
            </button>
            <button className="btn danger" disabled={probing} onClick={stopStream}>
              ■ {t('Stop')}
            </button>
          </div>
        </>
      )}
    </aside>
  )
}
