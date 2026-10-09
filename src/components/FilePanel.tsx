import { useRef, useState } from 'react'
import { estimateMinutes } from '../gcode/estimate'
import { useT } from '../i18n'
import { jobLimits, useStore } from '../state/store'

export function FilePanel() {
  const connected = useStore((s) => s.connected)
  const fileName = useStore((s) => s.fileName)
  const toolpath = useStore((s) => s.toolpath)
  const stream = useStore((s) => s.stream)
  const loadFile = useStore((s) => s.loadFile)
  const startStream = useStore((s) => s.startStream)
  const pauseStream = useStore((s) => s.pauseStream)
  const resumeStream = useStore((s) => s.resumeStream)
  const stopStream = useStore((s) => s.stopStream)
  const dryRun = useStore((s) => s.dryRun)
  const setDryRun = useStore((s) => s.setDryRun)
  const jobType = useStore((s) => s.jobType)
  const settings = useStore((s) => s.settings)
  const params = useStore((s) => s.params)
  const machine = useStore((s) => s.machines.find((m) => m.id === s.machineId))
  const machines = useStore((s) => s.machines)
  const machineId = useStore((s) => s.machineId)
  const status = useStore((s) => s.status)
  const homed = useStore((s) => s.homed)
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)
  const t = useT()

  const readFile = (file: File) => {
    if (running || paused) return
    const reader = new FileReader()
    reader.onload = () => loadFile(file.name, String(reader.result ?? ''))
    reader.readAsText(file)
  }

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault()
    setDragActive(false)
    const file = event.dataTransfer.files?.[0]
    if (file) readFile(file)
  }

  const percent = stream.total ? Math.round((stream.sent / stream.total) * 100) : 0
  const running = stream.state === 'running'
  const paused = stream.state === 'paused'
  const programPause = paused && stream.pauseReason === 'program'
  const machineState = status?.state
  const notReady = connected && machineState !== 'Idle' && machineState !== 'Check'
  const laserMismatch = jobType === 'laser' && settings[32] !== '1'
  const millMismatch = jobType === 'mill' && settings[32] === '1'
  const blocked = laserMismatch || millMismatch
  const limits = jobLimits(toolpath, { machines, machineId, settings, status, homed })
  const estimate = toolpath && machine ? estimateMinutes(toolpath, { feed: params.feed, rapid: machine.rapid }) : null
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
        <button className="btn tiny" disabled={running || paused} onClick={() => inputRef.current?.click()}>
          {t('Ouvrir…')}
        </button>
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

      <div className="file-name">
        {fileName ?? t('Aucun fichier (glisser-déposer)')}
        {jobType && (
          <span className={`job-badge job-${jobType}`}>{t(jobType === 'laser' ? 'Laser' : 'Fraisage')}</span>
        )}
      </div>

      {laserMismatch && <p className="warn notes">{t('Programme LASER : activez $32=1 (onglet Laser) avant de lancer.')}</p>}
      {millMismatch && <p className="warn notes">{t('$32=1 (mode laser) est actif : programme de fraisage bloqué. Mettez $32=0.')}</p>}

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
          {stream.sent}/{stream.total} ({percent}%)
        </span>
      </div>

      <label className="check">
        <input type="checkbox" checked={dryRun} disabled={running || paused} onChange={(e) => setDryRun(e.target.checked)} />
        {t('Essai à blanc (Z rehaussé, broche coupée)')}
      </label>

      <div className="stream-controls">
        {!running && !paused && (
          <button
            className="btn primary"
            disabled={!connected || !toolpath || blocked || notReady || (limits ? !limits.ok : false)}
            title={notReady ? `${t('Machine non prête')} (${machineState ?? '?'})` : undefined}
            onClick={() => void startStream()}
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
