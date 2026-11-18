// Notifications systeme de fin / erreur / pause de programme.

/** A appeler sur une action de l'utilisateur (clic Demarrer) : demande l'autorisation. */
export function requestJobNotifications(): void {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    void Notification.requestPermission().catch(() => undefined)
  }
}

/** Notification systeme, seulement si l'onglet n'est pas visible. */
export function notifyJob(title: string, body: string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || !document.hidden) return
  try {
    new Notification(title, { body, icon: '/icon.svg', tag: 'easycnc-job' })
  } catch {
    /* ignore */
  }
}
