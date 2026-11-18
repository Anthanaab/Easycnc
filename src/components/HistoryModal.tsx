import { useEffect, useState } from 'react'
import { useT } from '../i18n'
import { clearJobs, listJobs, type JobRecord } from '../state/jobHistory'
import { useUiStore } from '../state/uiStore'
import { Modal } from './Modal'

function duration(job: JobRecord): string {
  if (!job.endedAt) return '—'
  const s = Math.round((job.endedAt - job.startedAt) / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min ${String(s % 60).padStart(2, '0')}`
}

/** Historique des programmes executes (duree reelle, issue, matiere, fraise). */
export function HistoryModal() {
  const closeModal = useUiStore((s) => s.closeModal)
  const [jobs, setJobs] = useState<JobRecord[] | null>(null)
  const t = useT()

  useEffect(() => {
    void listJobs().then(setJobs)
  }, [])

  const outcome = (job: JobRecord) => {
    if (!job.outcome) return <span className="muted">{t('interrompu')}</span>
    if (job.outcome === 'done') return <span className="ok">{t('terminé')}</span>
    if (job.outcome === 'stopped') return <span className="warn">{t('arrêté')}</span>
    return (
      <span className="warn" title={job.message}>
        {t('erreur')}
      </span>
    )
  }

  const exportCsv = () => {
    if (!jobs?.length) return
    const header = ['debut', 'fichier', 'type', 'essai_a_blanc', 'duree_s', 'lignes', 'lignes_faites', 'issue', 'message', 'matiere', 'fraise']
    const rows = jobs.map((job) => [
      new Date(job.startedAt).toISOString(),
      job.file,
      job.jobType ?? '',
      job.dryRun ? 'oui' : 'non',
      job.endedAt ? String(Math.round((job.endedAt - job.startedAt) / 1000)) : '',
      String(job.lines),
      String(job.done ?? ''),
      job.outcome ?? 'interrompu',
      job.message ?? '',
      job.material ?? '',
      job.bit ?? '',
    ])
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(';')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'easycnc-historique.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Modal title={t('Historique des programmes')} onClose={closeModal} wide>
      <div className="stream-controls" style={{ marginBottom: 10 }}>
        <button className="btn tiny" disabled={!jobs?.length} onClick={exportCsv}>
          {t('Exporter CSV')}
        </button>
        <button
          className="btn tiny danger"
          disabled={!jobs?.length}
          onClick={() => {
            if (window.confirm(t("Effacer tout l'historique ?"))) void clearJobs().then(() => setJobs([]))
          }}
        >
          {t('Effacer')}
        </button>
      </div>
      {jobs === null ? (
        <p className="notes">…</p>
      ) : jobs.length === 0 ? (
        <div className="empty">{t('Aucun programme exécuté pour le moment.')}</div>
      ) : (
        <div className="history-table">
          <table>
            <thead>
              <tr>
                <th>{t('Date')}</th>
                <th>{t('Fichier')}</th>
                <th>{t('Durée')}</th>
                <th>{t('Lignes')}</th>
                <th>{t('Issue')}</th>
                <th>{t('Matériau')}</th>
                <th>{t('Fraise')}</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>{new Date(job.startedAt).toLocaleString()}</td>
                  <td>
                    {job.file}
                    {job.dryRun && <span className="muted"> · {t('essai à blanc')}</span>}
                    {job.jobType === 'laser' && <span className="muted"> · laser</span>}
                    {job.fromLine && <span className="muted"> · {t('reprise')} L{job.fromLine}</span>}
                  </td>
                  <td>{duration(job)}</td>
                  <td>
                    {job.done ?? '—'}/{job.lines}
                  </td>
                  <td>{outcome(job)}</td>
                  <td>{job.material ?? '—'}</td>
                  <td>{job.bit ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
