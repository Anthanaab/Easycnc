import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { useStore } from '../state/store'
import { useUiStore } from '../state/uiStore'

const STEPS = [0.1, 1, 10]
type Axis = 'X' | 'Y' | 'Z'

/**
 * Mode atelier : position lisible de loin, gros boutons (tactile), programme
 * et arrets toujours visibles. Pour une tablette ou un ecran pres de la machine.
 */
export function ShopView() {
  const connected = useStore((s) => s.connected)
  const machineState = useStore((s) => s.status?.state ?? (s.connected ? '…' : 'offline'))
  const wpos = useStore((s) => s.status?.wpos)
  const homed = useStore((s) => s.homed)
  const stream = useStore((s) => s.stream)
  const fileName = useStore((s) => s.fileName)
  const toolpath = useStore((s) => s.toolpath)
  const jogStep = useStore((s) => s.jogStep)
  const store = useStore.getState
  const setShopMode = useUiStore((s) => s.setShopMode)
  const [now, setNow] = useState(Date.now())
  const t = useT()

  const running = stream.state === 'running'
  const paused = stream.state === 'paused'
  const jobActive = running || paused
  const manual = connected && (!jobActive || stream.pauseReason === 'program')
  const done = stream.done ?? stream.sent
  const percent = stream.total ? Math.round((done / stream.total) * 100) : 0

  useEffect(() => {
    if (!jobActive) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [jobActive])

  // Appui court = un pas ; appui long (> 350 ms) = deplacement continu jusqu'au relachement.
  const pressTimer = useRef<number | null>(null)
  const continuous = useRef(false)
  const hold = (axis: Axis, dir: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault()
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      continuous.current = false
      pressTimer.current = window.setTimeout(() => {
        pressTimer.current = null
        continuous.current = true
        store().startJog(axis, dir)
      }, 350)
    },
    onPointerUp: () => release(axis, dir, true),
    onPointerCancel: () => release(axis, dir, false),
    onLostPointerCapture: () => release(axis, dir, false),
  })
  const release = (axis: Axis, dir: number, tap: boolean) => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current)
      pressTimer.current = null
      if (tap) store().jog(axis, dir)
    } else if (continuous.current) {
      continuous.current = false
      store().stopJog()
    }
  }

  const elapsed = stream.startedAt ? Math.round((now - stream.startedAt) / 1000) : 0
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <main className="shop">
      <section className="shop-dro panel">
        <div className={`shop-state state-${String(machineState).toLowerCase()}`}>
          {machineState}
          {homed && <span className="shop-homed">⌂</span>}
        </div>
        {(['x', 'y', 'z'] as const).map((key) => (
          <div key={key} className="shop-axis">
            <span className="shop-axis-name">{key.toUpperCase()}</span>
            <span className="shop-axis-value">{wpos ? wpos[key].toFixed(2) : '—'}</span>
            <button className="btn shop-zero" disabled={!manual} onClick={() => store().setZero([key.toUpperCase() as Axis])}>
              {key.toUpperCase()}=0
            </button>
          </div>
        ))}
      </section>

      <section className="shop-jog panel">
        <div className="shop-steps">
          {STEPS.map((value) => (
            <button key={value} className={`btn ${jogStep === value ? 'primary' : ''}`} onClick={() => store().setJogStep(value)}>
              {value} mm
            </button>
          ))}
        </div>
        <div className="shop-pad">
          <span />
          <button className="btn shop-key" disabled={!manual} {...hold('Y', 1)}>Y+</button>
          <span />
          <button className="btn shop-key" disabled={!manual} {...hold('Z', 1)}>Z+</button>
          <button className="btn shop-key" disabled={!manual} {...hold('X', -1)}>X−</button>
          <button className="btn shop-key" disabled={!manual} onClick={() => store().goToWorkZero()}>⌖</button>
          <button className="btn shop-key" disabled={!manual} {...hold('X', 1)}>X+</button>
          <span />
          <span />
          <button className="btn shop-key" disabled={!manual} {...hold('Y', -1)}>Y−</button>
          <span />
          <button className="btn shop-key" disabled={!manual} {...hold('Z', -1)}>Z−</button>
        </div>
        <p className="notes">{t('Appui court : un pas · appui long : déplacement continu · ⌖ : retour X0 Y0 (Z sécurité)')}</p>
      </section>

      <section className="shop-job panel">
        <div className="shop-file">{fileName ?? t('Aucun programme chargé')}</div>
        <div className="progress shop-progress">
          <div className="progress-fill" style={{ width: `${percent}%` }} />
          <span className="progress-label">
            {percent}% {jobActive && `· ${fmt(elapsed)}`}
          </span>
        </div>
        {stream.pauseReason === 'program' && <p className="notes warn">⏸ {stream.pauseMessage}</p>}
        <div className="shop-actions">
          {!jobActive && (
            <button className="btn primary shop-big" disabled={!connected || !toolpath} onClick={() => void store().startStream()}>
              ▶ {t('Démarrer')}
            </button>
          )}
          {running && (
            <button className="btn shop-big" onClick={() => store().pauseStream()}>
              ❚❚ {t('Pause')}
            </button>
          )}
          {paused && (
            <button className="btn primary shop-big" onClick={() => store().resumeStream()}>
              ▶ {t('Reprendre')}
            </button>
          )}
          <button className="btn danger shop-big" disabled={!jobActive} onClick={() => store().stopStream()}>
            ■ {t('Stop')}
          </button>
        </div>
      </section>

      <section className="shop-machine panel">
        <button className="btn shop-mid" disabled={!connected || jobActive} onClick={() => store().unlock()}>
          {t('top.unlock')}
        </button>
        <button className="btn shop-mid" disabled={!connected || jobActive} onClick={() => store().home()}>
          ⌂ {t('top.home')}
        </button>
        <button className="btn shop-mid" disabled={!manual} onClick={() => void store().runProbe()}>
          {t('Palper Z0')}
        </button>
        <button className="btn danger shop-mid shop-reset" disabled={!connected} onClick={() => store().softReset()}>
          {t('top.reset')}
        </button>
        <button className="btn shop-mid" onClick={() => setShopMode(false)}>
          {t('Quitter le mode atelier')}
        </button>
      </section>
    </main>
  )
}
