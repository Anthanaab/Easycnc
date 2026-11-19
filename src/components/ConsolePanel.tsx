import { useEffect, useMemo, useRef, useState } from 'react'
import type { LogEntry } from '../grbl/types'
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
  // Defilement auto seulement si l'on est deja en bas (sinon on relit l'historique).
  const stickToBottom = useRef(true)
  const [filter, setFilter] = useState<'all' | 'errors' | 'machine' | 'sent'>('all')
  const [copied, setCopied] = useState(false)
  const t = useT()

  const visible = useMemo(() => log.filter((entry) => matches(entry, filter)), [log, filter])

  useEffect(() => {
    const el = listRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [visible])

  const copy = async () => {
    const text = visible
      .map((entry) => `${new Date(entry.time).toLocaleTimeString([], { hour12: false })} ${DIR[entry.dir]} ${entry.text}`)
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* presse-papiers refuse */
    }
  }

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
        <div className="console-tools">
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label={t('Filtre')}>
            <option value="all">{t('Tout')}</option>
            <option value="errors">{t('Erreurs')}</option>
            <option value="machine">{t('Machine')}</option>
            <option value="sent">{t('Envoyé')}</option>
          </select>
          <button className="btn tiny" disabled={!visible.length} onClick={() => void copy()}>
            {copied ? t('Copié ✓') : t('Copier')}
          </button>
          <button className="btn tiny" onClick={clearLog}>
            {t('Effacer')}
          </button>
        </div>
      </div>

      <div
        className="console-log"
        ref={listRef}
        role="log"
        aria-label={t('Journal de la console')}
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
      >
        {visible.map((entry) => (
          <div key={entry.id} className={`log-line log-${entry.dir}`}>
            <span className="log-time">
              {new Date(entry.time).toLocaleTimeString([], { hour12: false })}
            </span>
            <span className="log-dir">
              {DIR[entry.dir]}
            </span>
            <span className="log-text">{entry.text}</span>
          </div>
        ))}
        {!visible.length && <div className="empty">{t('Aucun message.')}</div>}
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

const DIR: Record<LogEntry['dir'], string> = { in: '←', out: '→', error: '!', info: '·' }

function matches(entry: LogEntry, filter: 'all' | 'errors' | 'machine' | 'sent'): boolean {
  if (filter === 'errors') return entry.dir === 'error'
  if (filter === 'machine') return entry.dir === 'in' || entry.dir === 'error'
  if (filter === 'sent') return entry.dir === 'out'
  return true
}
