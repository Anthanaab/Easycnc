// Code d'acces du serveur EasyCNC (s'il est configure), garde pour la session.
const KEY = 'easycnc.updateToken'

export function getAccessToken(): string {
  try {
    return sessionStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function setAccessToken(value: string): void {
  try {
    sessionStorage.setItem(KEY, value)
  } catch {
    /* ignore */
  }
}

export function tokenHeader(): Record<string, string> {
  const token = getAccessToken()
  return token ? { 'X-EasyCNC-Token': token } : {}
}
