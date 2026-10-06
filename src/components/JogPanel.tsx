import { useEffect } from 'react'
import { useStore } from '../state/store'

const STEPS = [0.01, 0.1, 0.5, 1, 5, 10, 50]

export function JogPanel() {
  const connected = useStore((s) => s.connected)
  const jog = useStore((s) => s.jog)
  const startJog = useStore((s) => s.startJog)
  const stopJog = useStore((s) => s.stopJog)
  const jogStep = useStore((s) => s.jogStep)
  const setJogStep = useStore((s) => s.setJogStep)
  const jogFeed = useStore((s) => s.jogFeed)
  const setJogFeed = useStore((s) => s.setJogFeed)
  const setZero = useStore((s) => s.setZero)
  const home = useStore((s) => s.home)
  const jogCancel = useStore((s) => s.jogCancel)

  const disabled = !connected

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return
      if (disabled) return
      if (e.repeat) return
      switch (e.key) {
        case 'ArrowLeft':
          jog('X', -1)
          break
        case 'ArrowRight':
          jog('X', 1)
          break
        case 'ArrowUp':
          jog('Y', 1)
          break
        case 'ArrowDown':
          jog('Y', -1)
          break
        case 'PageUp':
          jog('Z', 1)
          break
        case 'PageDown':
          jog('Z', -1)
          break
        default:
          return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [disabled, jog])

  const hold = (axis: 'X' | 'Y' | 'Z', dir: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault()
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      startJog(axis, dir)
    },
    onPointerUp: () => stopJog(),
    onPointerLeave: () => stopJog(),
    onPointerCancel: () => stopJog(),
  })

  return (
    <section className="panel">
      <h2>Jogging</h2>

      <div className="jog-controls">
        <label>
          Pas (mm)
          <select value={jogStep} onChange={(e) => setJogStep(Number(e.target.value))}>
            {STEPS.map((step) => (
              <option key={step} value={step}>
                {step}
              </option>
            ))}
          </select>
        </label>
        <label>
          Avance (mm/min)
          <input type="number" min={10} step={10} value={jogFeed} onChange={(e) => setJogFeed(Number(e.target.value))} />
        </label>
      </div>

      <div className="jog-grid">
        <button className="btn jog" disabled={disabled} {...hold('Y', 1)}>
          Y+
        </button>
        <button className="btn jog" disabled={disabled} {...hold('Z', 1)}>
          Z+
        </button>
        <button className="btn jog home" disabled={disabled} onClick={home} title="Home ($H)">
          ⌂
        </button>
        <button className="btn jog" disabled={disabled} {...hold('X', -1)}>
          X−
        </button>
        <button className="btn jog" disabled={disabled} onClick={jogCancel} title="Annuler le jog">
          ■
        </button>
        <button className="btn jog" disabled={disabled} {...hold('X', 1)}>
          X+
        </button>
        <button className="btn jog" disabled={disabled} {...hold('Y', -1)}>
          Y−
        </button>
        <button className="btn jog" disabled={disabled} {...hold('Z', -1)}>
          Z−
        </button>
        <span />
      </div>

      <p className="notes">
        Maintenir un bouton pour un déplacement continu. Clavier : flèches = X/Y (pas), Page ↑/↓ = Z.
      </p>

      <div className="zero-grid">
        <button className="btn" disabled={disabled} onClick={() => setZero(['X', 'Y'])}>
          XY = 0
        </button>
        <button className="btn" disabled={disabled} onClick={() => setZero(['Z'])}>
          Z = 0
        </button>
        <button className="btn" disabled={disabled} onClick={() => setZero(['X', 'Y', 'Z'])}>
          Tout = 0
        </button>
      </div>
    </section>
  )
}
