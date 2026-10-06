import { create } from 'zustand'

export type TabId = 'pilotage' | 'conception' | 'vue3d' | 'laser' | 'pcb' | 'relief' | 'reglages'

export type ModalId = 'none' | 'projects' | 'tutorial'

export type Theme = 'dark' | 'light'
export type Language = 'fr' | 'en'

function stored<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback
  } catch {
    return fallback
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}

const initialTheme = stored<Theme>('theme', 'dark')
applyTheme(initialTheme)

interface UiState {
  tab: TabId
  modal: ModalId
  theme: Theme
  language: Language
  setTab: (tab: TabId) => void
  openModal: (modal: ModalId) => void
  closeModal: () => void
  setTheme: (theme: Theme) => void
  setLanguage: (language: Language) => void
}

export const useUiStore = create<UiState>((set) => ({
  tab: 'pilotage',
  modal: 'none',
  theme: initialTheme,
  language: stored<Language>('language', 'fr'),
  setTab: (tab) => set({ tab }),
  openModal: (modal) => set({ modal }),
  closeModal: () => set({ modal: 'none' }),
  setTheme: (theme) => {
    try {
      localStorage.setItem('theme', theme)
    } catch {
      /* ignore */
    }
    applyTheme(theme)
    set({ theme })
  },
  setLanguage: (language) => {
    try {
      localStorage.setItem('language', language)
    } catch {
      /* ignore */
    }
    set({ language })
  },
}))
