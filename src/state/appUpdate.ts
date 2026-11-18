import { registerSW } from 'virtual:pwa-register'
import { create } from 'zustand'
import { streamer, useStore } from './store'

/**
 * Mises a jour de l'application (service worker PWA).
 *
 * Jamais de rechargement automatique : un rechargement pendant un programme
 * couperait le flux vers GRBL en pleine coupe. Une nouvelle version est
 * signalee ; elle s'applique sur demande, et seulement hors programme.
 */
interface AppUpdateState {
  /** Nouvelle version telechargee, prete a etre appliquee. */
  ready: boolean
  /** Rechargement demande (autre onglet) mais differe : programme en cours. */
  deferredReload: boolean
  apply: () => void
}

let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null
let registration: ServiceWorkerRegistration | undefined

function busy(): boolean {
  return streamer.isRunning
}

function reloadWhenSafe(): void {
  if (!busy()) {
    window.location.reload()
    return
  }
  useAppUpdate.setState({ deferredReload: true })
}

export const useAppUpdate = create<AppUpdateState>(() => ({
  ready: false,
  deferredReload: false,
  apply: () => {
    if (busy() || !updateSW) return
    void updateSW(true)
  },
}))

/** Verifie tout de suite s'il existe une nouvelle version (apres une mise a jour serveur). */
export function checkForAppUpdate(): void {
  void registration?.update().catch(() => undefined)
}

export function startAppUpdate(): void {
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh: () => useAppUpdate.setState({ ready: true }),
    // Nouvelle version activee (ex. depuis un autre onglet) : rechargement differe si besoin.
    onNeedReload: reloadWhenSafe,
    onRegisteredSW: (_url, reg) => {
      registration = reg
      // Verification periodique (toutes les heures).
      window.setInterval(checkForAppUpdate, 60 * 60 * 1000)
    },
  })
  useStore.subscribe((state, previous) => {
    if (state.stream.state === 'idle' && previous.stream.state !== 'idle' && useAppUpdate.getState().deferredReload) {
      window.location.reload()
    }
  })
}
