import { setCoreLanguage, translate, translateParams, type Language } from './i18nCore'
import { useUiStore } from './state/uiStore'

export { translate, translateParams, trc } from './i18nCore'

// Les modules sans interface (protocole, calcul, palpage) traduisent via le noyau :
// on lui transmet la langue choisie.
setCoreLanguage(useUiStore.getState().language)
useUiStore.subscribe((state) => setCoreLanguage(state.language))

/** Traduction hors composant React (store, grbl…), langue courante. */
export function tr(key: string, params?: Record<string, string | number>): string {
  return translateParams(key, params, useUiStore.getState().language)
}

/** Choisit la variante localisée d'une donnée (nom de profil, matériau…). */
export function loc(fr: string, en?: string): string {
  return useUiStore.getState().language === 'en' && en ? en : fr
}

export function useT(): (key: string) => string {
  const lang = useUiStore((s) => s.language)
  return (key: string) => translate(key, lang)
}

export function useTf(): (key: string, params?: Record<string, string | number>) => string {
  const lang = useUiStore((s) => s.language)
  return (key, params) => translateParams(key, params, lang)
}

export function useLoc(): (fr: string, en?: string) => string {
  const lang = useUiStore((s) => s.language)
  return (fr, en) => (lang === 'en' && en ? en : fr)
}
