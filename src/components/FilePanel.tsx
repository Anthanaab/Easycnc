import { useEffect, useMemo, useRef, useState } from 'react'
import { estimateMinutes } from '../gcode/estimate'
import { useT } from '../i18n'
import { addRecentFile, getRecentFile, listRecentFiles, removeRecentFile, type RecentFile } from '../state/recentFiles'
import { jobLimits, useStore } from '../state/store'
import { useUiStore } from '../state/uiStore'

export function FilePanel() {
  const connected = useStore((s) => s.connected)
  const fileName = useStore((s) => s.fileName)
  const toolpath = useStore((s) => s.toolpath)
  const parsing = useStore((s) => s.parsing)
  const stream = useStore((s) => s.stream)
  const loadFile = useStore((s) => s.loadFile)
  const startStream = useStore((s) => s.startStream)
  const pauseStream = useStore((s) => s.pauseStream)
  const resumeStream = useStore((s) => s.resumeStream)
  const stopStream = useStore((s) => s.stopStream)
  const dryRun = useStore((s) => s.dryRun)
  const setDryRun = useStore((s) => s.setDryRun)
  const jobType = useStore((s) => s.jobType)
  const setJobType = useStore((s) => s.setJobType)
  const settings = useStore((s) => s.settings)
  const params = useStore((s) => s.params)
  const machine = useStore((s) => s.machines.find((m) => m.id === s.machineId))
  const machines = useStore((s) => s.machines)
  const machineId = useStore((s) => s.machineId)
  // Abonnements fins : le statut arrive 5 fois/s, on ne garde que ce qui sert
  // (sinon emprise et duree seraient recalculees en permanence).
  const machineState = useStore((s) => s.status?.state)
  const wcoKey = useStore((s) => (s.status?.wco ? `${s.status.wco.x},${s.status.wco.y},${s.status.wco.z}` : ''))
  const mposSign = useStore((s) => (s.status?.mpos ? [s.status.mpos.x, s.status.mpos.y, s.status.mpos.z].map((v) => (v < -0.5 ? '-' : v > 0.5 ? '+' : '0')).join('') : ''))
  const homed = useStore((s) => s.homed)
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)
  const [fromLine, setFromLine] = useState('')
  const [recent, setRecent] = useState<Array<Omit<RecentFile, 'text'>>>([])
  const t = useT()

  const refreshRecent = () => void listRecentFiles().then(setRecent)
  useEffect(refreshRecent, [])

  const readFile = (file: File) => {
    if (running || paused) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      loadFile(file.name, text)
      void addRecentFile(file.name, text).then(refreshRecent)
    }
    reader.readAsText(file)
  }

  const openRecent = async (name: string) => {
    if (!name || running || paused) return
    const file = await getRecentFile(name)
    if (!file) {
      refreshRecent()
      return
    }
    loadFile(file.name, file.text)
    void addRecentFile(file.name, file.text).then(refreshRecent)
  }

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault()
    setDragActive(false)
    const file = event.dataTransfer.files?.[0]
    if (file) readFile(file)
  }

  const running = stream.state === 'running'
  const paused = stream.state === 'paused'
  // Avancement reel = lignes acquittees par GRBL (et non simplement envoyees).
  const done = stream.done ?? stream.sent
  const percent = stream.total ? Math.round((done / stream.total) * 100) : 0
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!running && !paused) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running, paused])
  const programPause = paused && stream.pauseReason === 'program'
  const notReady = connected && machineState !== 'Idle' && machineState !== 'Check'
  const laserMismatch = jobType === 'laser' && settings[32] !== '1'
  const millMismatch = jobType === 'mill' && settings[32] === '1'
  const blocked = laserMismatch || millMismatch
  const limits = useMemo(
    () => jobLimits(toolpath, { machines, machineId, settings, status: useStore.getState().status, homed }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toolpath, machines, machineId, settings, homed, wcoKey, mposSign],
  )
  const accel = Math.min(Number(settings[120]) || 500, Number(settings[121]) || 500)
  const estimate = useMemo(
    () => (toolpath && machine ? estimateMinutes(toolpath, { feed: params.feed, rapid: machine.rapid, accel }) : null),
    [toolpath, machine, params.feed, accel],
  )
  const timeText = estimate
    ? estimate.minutes >= 1
      ? `${estimate.minutes.toFixed(1)} min`
      : `${Math.round(estimate.minutes * 60)} s`
    : null

  return (
    <section
      className={`panel file-panel ${dragActive ? 'drag' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragActive(true)
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={onDrop}
    >
      <div className="panel-head">
        <h2>{t('Programme')}</h2>
        <div className="console-tools">
          <button className="btn tiny" onClick={() => useUiStore.getState().openModal('history')}>
            {t('Historique')}
          </button>
          <button className="btn tiny" disabled={running || paused} onClick={() => inputRef.current?.click()}>
            {t('Ouvrir…')}
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".nc,.gcode,.gc,.tap,.cnc,.txt"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) readFile(file)
            e.target.value = ''
          }}
        />
      </div>

      {recent.length > 0 && (
        <div className="recent-files">
          <select
            value=""
            disabled={running || paused}
            aria-label={t('Fichiers récents')}
            onChange={(e) => void openRecent(e.target.value)}
          >
            <option value="">{t('Fichiers récents…')}</option>
            {recent.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name} — {formatSize(f.size)} · {new Date(f.openedAt).toLocaleDateString()}
              </option>
            ))}
          </select>
          {fileName && recent.some((f) => f.name === fileName) && (
            <button
              className="btn tiny"
              title={t('Retirer des récents')}
              onClick={() => void removeRecentFile(fileName).then(refreshRecent)}
            >
              ✕
            </button>
          )}
        </div>
      )}

      <div className="file-name">
        {fileName ?? t('Aucun fichier (glisser-déposer)')}
        {jobType && (
          <select
            className={`job-badge job-${jobType}`}
            value={jobType}
            disabled={running || paused}
            title={t('Type de programme (détecté automatiquement, modifiable)')}
            onChange={(e) => setJobType(e.target.value as 'mill' | 'laser')}
          >
            <option value="mill">{t('Fraisage')}</option>
            <option value="laser">{t('Laser')}</option>
          </select>
        )}
      </div>

      {laserMismatch && <p className="warn notes">{t('Programme LASER : activez $32=1 (onglet Laser) avant de lancer.')}</p>}
      {millMismatch && <p className="warn notes">{t('$32=1 (mode laser) est actif : programme de fraisage bloqué. Mettez $32=0.')}</p>}

      {parsing && <p className="notes">{t('Analyse du G-code…')}</p>}
      {toolpath && (
        <div className="file-stats">
          <span>{toolpath.lines} {t('lignes')}</span>
          <span>{toolpath.moves} {t('mouvements')}</span>
          <span>{toolpath.segments.length} {t('segments')}</span>
        </div>
      )}

      {estimate && (
        <div className="file-stats">
          <span>{t('Durée estimée')} : {timeText}</span>
          {limits && (
            <span>
              {t('Emprise')} {limits.width.toFixed(1)}×{limits.height.toFixed(1)} mm
            </span>
          )}
        </div>
      )}
      {limits && !limits.ok && (
        <p className="warn notes">
          {t('Hors zone de travail')} : {limits.messages.join(' ; ')}
        </p>
      )}
      {limits && limits.ok && !homed && connected && (
        <p className="notes">{t('Machine non référencée : contrôle d\'emprise approximatif (faites le homing pour un contrôle précis).')}</p>
      )}
      {programPause && (
        <p className="warn notes">
          ⏸ {stream.pauseMessage ?? t('Pause programme (M0)')} — {t('machine arrêtée : jog / palpage autorisés, puis « Reprendre ».')}
        </p>
      )}

      <div className="progress">
        <div className="progress-fill" style={{ width: `${percent}%` }} />
        <span className="progress-label">
          {done}/{stream.total} ({percent}%)
        </span>
      </div>
      {(running || paused) && stream.startedAt && (
        <div className="file-stats">
          <span>{t('Écoulé')} : {formatDuration((now - stream.startedAt) / 1000)}</span>
          <span>
            {t('Restant')} ≈ {formatDuration(remainingSeconds(now - stream.startedAt, done, stream.total, estimate?.minutes))}
          </span>
        </div>
      )}

      <label className="check">
        <input type="checkbox" checked={dryRun} disabled={running || paused} onChange={(e) => setDryRun(e.target.checked)} />
        {t('Essai à blanc (Z rehaussé, broche coupée)')}
      </label>

      {!running && !paused && toolpath && (
        <label className="field">
          <span>
            {t('Reprendre à la ligne (vide = début)')}
            {stream.sent > 0 && stream.sent < stream.total && (
              <> — {t('arrêt vers la ligne')} ≤ {stream.sent}, {t('reprenez un peu avant')}</>
            )}
          </span>
          <input type="number" min={1} max={stream.total} step={1} value={fromLine} placeholder="1" onChange={(e) => setFromLine(e.target.value)} />
        </label>
      )}

      <div className="stream-controls">
        {!running && !paused && (
          <button
            className="btn primary"
            disabled={!connected || !toolpath || blocked || notReady || (limits ? !limits.ok : false)}
            title={notReady ? `${t('Machine non prête')} (${machineState ?? '?'})` : undefined}
            onClick={() => void startStream(Number(fromLine) > 1 ? Math.round(Number(fromLine)) : undefined)}
          >
            ▶ {t('Démarrer')}
          </button>
        )}
        {running && (
          <button className="btn" onClick={pauseStream}>
            ❚❚ {t('Pause')}
          </button>
        )}
        {paused && (
          <button className="btn primary" onClick={resumeStream}>
            ▶ {t('Reprendre')}
          </button>
        )}
        <button className="btn danger" disabled={!running && !paused} onClick={stopStream}>
          ■ {t('Stop')}
        </button>
      </div>
    </section>
  )
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min ${String(sec).padStart(2, '0')}`
}

/** Temps restant : extrapole la vitesse reelle une fois le job lance, sinon l'estimation. */
function remainingSeconds(elapsedMs: number, done: number, total: number, estimateMinutes?: number): number {
  const fraction = total ? done / total : 0
  if (fraction > 0.03 && elapsedMs > 20000) return ((elapsedMs / 1000) * (1 - fraction)) / fraction
  return estimateMinutes !== undefined ? estimateMinutes * 60 * (1 - fraction) : Number.NaN
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
}
