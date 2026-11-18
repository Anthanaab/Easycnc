import { useStore } from './store'

/**
 * Accompagne un programme en cours :
 * - empeche la mise en veille de l'ecran (et donc du Mac) : une veille couperait
 *   la liaison serie en pleine coupe ;
 * - affiche l'avancement dans le titre de l'onglet ;
 * - notifie (si l'onglet est cache) la fin, une erreur ou une pause M0.
 */

let wakeLock: WakeLockSentinel | null = null
let wanted = false

async function acquireWakeLock(): Promise<void> {
  if (!wanted || wakeLock || !('wakeLock' in navigator) || document.hidden) return
  try {
    wakeLock = await navigator.wakeLock.request('screen')
    wakeLock.addEventListener('release', () => {
      wakeLock = null
    })
  } catch {
    /* refuse (batterie faible, onglet cache) : on reessaiera au retour */
  }
}

function releaseWakeLock(): void {
  wanted = false
  void wakeLock?.release().catch(() => undefined)
  wakeLock = null
}

export function startJobWatch(): void {
  const baseTitle = document.title
  document.addEventListener('visibilitychange', () => {
    // Le verrou est relache automatiquement quand l'onglet est cache.
    if (!document.hidden) void acquireWakeLock()
  })
  useStore.subscribe((state, previous) => {
    const stream = state.stream
    if (stream === previous.stream) return
    const active = stream.state !== 'idle'
    if (active && !wanted) {
      wanted = true
      void acquireWakeLock()
    } else if (!active && wanted) {
      releaseWakeLock()
    }
    if (!active) {
      document.title = baseTitle
      return
    }
    const done = stream.done ?? stream.sent
    const percent = stream.total ? Math.floor((done / stream.total) * 100) : 0
    const icon = stream.state === 'paused' ? '⏸' : '▶'
    document.title = `${icon} ${percent}% · ${baseTitle}`
  })
}
