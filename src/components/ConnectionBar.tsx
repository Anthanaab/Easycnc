import { useEffect, useState } from 'react'
import { useLoc, useT } from '../i18n'
import { useStore } from '../state/store'
import { useUiStore } from '../state/uiStore'
import { ToolIndicator } from './ToolIndicator'

const BAUD_RATES = [115200, 250000, 57600, 38400, 19200]

export function ConnectionBar() {
  const supported = useStore((s) => s.supported)
  const connected = useStore((s) => s.connected)
  const baudRate = useStore((s) => s.baudRate)
  const status = useStore((s) => s.status)
  const welcome = useStore((s) => s.welcome)
  const connect = useStore((s) => s.connect)
  const disconnect = useStore((s) => s.disconnect)
  const home = useStore((s) => s.home)
  const unlock = useStore((s) => s.unlock)
  const softReset = useStore((s) => s.softReset)
  const openModal = useUiStore((s) => s.openModal)
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const language = useUiStore((s) => s.language)
  const setLanguage = useUiStore((s) => s.setLanguage)
  const t = useT()
  const loc = useLoc()
  const [baud, setBaud] = useState(baudRate)

  useEffect(() => setBaud(baudRate), [baudRate])

  const machine = useStore((s) => s.machines.find((m) => m.id === s.machineId))
  const machineLabel = machine
    ? `${loc(machine.brand, machine.brandEn)} — ${loc(machine.name, machine.nameEn)}`
    : 'Contrôleur GRBL'

  const state = status?.state ?? (connected ? '…' : 'offline')
  const badgeClass = `state-badge state-${state.toLowerCase()}`

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">◉</span>
        <div>
          <strong>EasyCNC</strong>
          <small>{machineLabel}</small>
        </div>
      </div>

      <div className="topbar-group">
        <select value={baud} onChange={(e) => setBaud(Number(e.target.value))} disabled={connected}>
          {BAUD_RATES.map((rate) => (
            <option key={rate} value={rate}>
              {rate} bauds
            </option>
          ))}
        </select>

        {connected ? (
          <button className="btn danger" onClick={() => void disconnect()}>
            {t('top.disconnect')}
          </button>
        ) : (
          <button className="btn primary" disabled={!supported} onClick={() => void connect(baud)}>
            {t('top.connect')}
          </button>
        )}

        <span className={badgeClass}>{state}</span>
      </div>

      <div className="topbar-group">
        <button className="btn" disabled={!connected} onClick={unlock} title="Deverrouille ($X)">
          {t('top.unlock')}
        </button>
        <button className="btn" disabled={!connected} onClick={home} title="Origine machine ($H)">
          {t('top.home')}
        </button>
        <button className="btn" disabled={!connected} onClick={softReset} title="Reset logiciel (Ctrl-X)">
          {t('top.reset')}
        </button>
      </div>

      <div className="topbar-group">
        <button className="btn" onClick={() => openModal('projects')}>
          {t('top.projects')}
        </button>
        <button className="btn" onClick={() => openModal('tutorial')}>
          {t('top.help')}
        </button>
        <button className="btn" title="Thème" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        <button className="btn" title="Langue" onClick={() => setLanguage(language === 'fr' ? 'en' : 'fr')}>
          {language.toUpperCase()}
        </button>
      </div>

      <div className="topbar-group">
        <ToolIndicator compact />
      </div>

      <div className="topbar-info">
        {!supported ? (
          <span className="warn">Web Serial indisponible : utilisez Chrome ou Edge en HTTPS/localhost.</span>
        ) : (
          welcome && <span className="muted">{welcome}</span>
        )}
      </div>
    </header>
  )
}
