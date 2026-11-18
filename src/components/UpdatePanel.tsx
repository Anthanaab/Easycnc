import { useCallback, useEffect, useState } from 'react'
import { useT } from '../i18n'
import { checkForAppUpdate, useAppUpdate } from '../state/appUpdate'
import { useStore } from '../state/store'

interface ServerStatus {
  branch: string
  current: { sha: string; date: string; subject: string }
  latest: string | null
  remoteError: string | null
  available: boolean
  running: boolean
  lastResult: { ok: boolean; code: number; at: string } | null
  log: string[]
}

type Availability = 'loading' | 'ok' | 'unavailable'

/**
 * Mise a jour du serveur EasyCNC (installation Proxmox/LXC) depuis l'interface :
 * git pull + build + deploiement, puis rechargement de la page sur demande.
 */
export function UpdatePanel() {
  const [availability, setAvailability] = useState<Availability>('loading')
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const jobActive = useStore((s) => s.stream.state !== 'idle')
  const appReady = useAppUpdate((s) => s.ready)
  const applyApp = useAppUpdate((s) => s.apply)
  const t = useT()

  const refresh = useCallback(async (force = false) => {
    try {
      const response = await fetch(`/api/update/status${force ? '?refresh' : ''}`, { cache: 'no-store' })
      const type = response.headers.get('content-type') ?? ''
      if (!response.ok || !type.includes('application/json')) {
        setAvailability('unavailable')
        return null
      }
      const data = (await response.json()) as ServerStatus
      setStatus(data)
      setAvailability('ok')
      return data
    } catch {
      setAvailability('unavailable')
      return null
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Suivi pendant la mise a jour ; a la fin, on cherche la nouvelle version de l'app.
  useEffect(() => {
    if (!status?.running) return
    const timer = window.setInterval(async () => {
      const next = await refresh()
      if (next && !next.running) {
        window.clearInterval(timer)
        if (next.lastResult?.ok) checkForAppUpdate()
      }
    }, 2000)
    return () => window.clearInterval(timer)
  }, [status?.running, refresh])

  const start = async () => {
    setError('')
    try {
      const response = await fetch('/api/update', { method: 'POST', headers: { 'X-EasyCNC': 'update' } })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? `HTTP ${response.status}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    await refresh()
  }

  const check = async () => {
    setChecking(true)
    await refresh(true)
    checkForAppUpdate()
    setChecking(false)
  }

  const short = (sha?: string | null) => (sha ? sha.slice(0, 7) : '—')

  return (
    <section className="panel update-panel">
      <div className="panel-head">
        <h2>{t('Mise à jour')}</h2>
        <button className="btn tiny" disabled={checking || availability !== 'ok'} onClick={() => void check()}>
          {checking ? t('Vérification…') : t('Vérifier')}
        </button>
      </div>

      <div className="file-stats">
        <span>
          {t('Version de cette page')} : <b>{__APP_VERSION__}</b>
        </span>
        <span>{new Date(__APP_BUILD_DATE__).toLocaleString()}</span>
      </div>

      {appReady && (
        <p className="notes">
          {t('Une nouvelle version de la page est prête.')}{' '}
          <button className="btn tiny primary" disabled={jobActive} onClick={applyApp}>
            {t('Recharger maintenant')}
          </button>
        </p>
      )}

      {availability === 'loading' && <p className="notes">{t('Interrogation du serveur…')}</p>}

      {availability === 'unavailable' && (
        <p className="notes">
          {t('Mise à jour depuis l\'interface indisponible ici (développement local, ou serveur installé avant cette fonction). Sur le conteneur Proxmox, lancez une fois : bash /opt/easycnc/deploy/proxmox/install.sh')}
        </p>
      )}

      {availability === 'ok' && status && (
        <>
          <div className="update-versions">
            <div>
              <span className="muted">{t('Serveur')}</span> <b>{short(status.current.sha)}</b> — {status.current.subject}
              <div className="muted">{new Date(status.current.date).toLocaleString()}</div>
            </div>
            <div>
              <span className="muted">{t('Dernière version')} ({status.branch})</span> <b>{short(status.latest)}</b>
              {status.remoteError && <div className="warn">{status.remoteError}</div>}
            </div>
          </div>

          {status.available ? (
            <p className="notes ok">{t('Une mise à jour est disponible.')}</p>
          ) : (
            !status.remoteError && <p className="notes">{t('Le serveur est à jour.')}</p>
          )}

          <button
            className="btn primary"
            style={{ width: '100%' }}
            disabled={status.running || jobActive || !status.available}
            title={jobActive ? t('Impossible pendant un programme') : undefined}
            onClick={() => void start()}
          >
            {status.running ? t('Mise à jour en cours…') : t('Mettre à jour le serveur')}
          </button>
          {jobActive && <p className="notes warn">{t('Impossible pendant un programme.')}</p>}
          {error && <p className="notes warn">{error}</p>}

          {status.lastResult && !status.running && (
            <p className={`notes ${status.lastResult.ok ? 'ok' : 'warn'}`}>
              {status.lastResult.ok
                ? t('Mise à jour réussie : rechargez la page quand le bandeau apparaît.')
                : t('La mise à jour a échoué : le site actuel reste en service (voir le journal).')}
            </p>
          )}

          {(status.running || status.log.length > 0) && (
            <pre className="update-log">{status.log.join('\n')}</pre>
          )}
        </>
      )}
    </section>
  )
}
