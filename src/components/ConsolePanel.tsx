import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { useStore } from '../state/store'

export function ConsolePanel() {
  const log = useStore((s) => s.log)
  const clearLog = useStore((s) => s.clearLog)
  const sendCommand = useStore((s) => s.sendCommand)
  const connected = useStore((s) => s.connected)
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const listRef = useRef<HTMLDivElement>(null)
  const t = useT()

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])

  const submit = () => {
    const command = input.trim()
    if (!command) return
    void sendCommand(command)
    setHistory((prev) => [...prev, command].slice(-100))
    setHistoryIndex(-1)
    setInput('')
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      submit()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!history.length) return
      const next = historyIndex < 0 ? history.length - 1 : Math.max(0, historyIndex - 1)
      setHistoryIndex(next)
      setInput(history[next])
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (historyIndex < 0) return
      const next = historyIndex + 1
      if (next >= history.length) {
        setHistoryIndex(-1)
        setInput('')
      } else {
        setHistoryIndex(next)
        setInput(history[next])
      }
    }
  }

  return (
    <section className="panel console-panel">
      <div className="panel-head">
        <h2>{t('Console')}</h2>
        <button className="btn tiny" onClick={clearLog}>
          {t('Effacer')}
        </button>
      </div>

      <div className="console-log" ref={listRef}>
        {log.map((entry) => (
          <div key={entry.id} className={`log-line log-${entry.dir}`}>
            <span className="log-time">
              {new Date(entry.time).toLocaleTimeString([], { hour12: false })}
            </span>
            <span className="log-dir">
              {entry.dir === 'in' ? '←' : entry.dir === 'out' ? '→' : entry.dir === 'error' ? '!' : '·'}
            </span>
            <span className="log-text">{entry.text}</span>
          </div>
        ))}
        {!log.length && <div className="empty">{t('Aucun message.')}</div>}
      </div>

      <div className="console-input">
        <input
          value={input}
          placeholder={t('Commande G-code ou $ (ex: $$, G0 X0 Y0)')}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!connected}
        />
        <button className="btn primary" onClick={submit} disabled={!connected}>
          {t('Envoyer')}
        </button>
      </div>
    </section>
  )
}
