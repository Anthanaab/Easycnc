import { useAppUpdate } from '../state/appUpdate'
import { useT } from '../i18n'
import { useStore } from '../state/store'

/** Bandeau « nouvelle version » : jamais appliquee pendant un programme. */
export function UpdateBanner() {
  const ready = useAppUpdate((s) => s.ready)
  const deferredReload = useAppUpdate((s) => s.deferredReload)
  const apply = useAppUpdate((s) => s.apply)
  const jobActive = useStore((s) => s.stream.state !== 'idle')
  const t = useT()

  if (!ready && !deferredReload) return null
  return (
    <div className="update-banner" role="status">
      {deferredReload ? (
        <span>{t('Nouvelle version activée : la page se rechargera à la fin du programme.')}</span>
      ) : (
        <>
          <span>{t('Nouvelle version d\'EasyCNC disponible.')}</span>
          {jobActive ? (
            <span className="muted">{t('Elle sera proposée à la fin du programme.')}</span>
          ) : (
            <button className="btn tiny primary" onClick={apply}>
              {t('Recharger maintenant')}
            </button>
          )}
        </>
      )}
    </div>
  )
}
