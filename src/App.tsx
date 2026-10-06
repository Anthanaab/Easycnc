import { useEffect } from 'react'
import { useCamStore } from './cam/camStore'
import { ConnectionBar } from './components/ConnectionBar'
import { ConsolePanel } from './components/ConsolePanel'
import { DesignTab } from './components/DesignTab'
import { DroPanel } from './components/DroPanel'
import { FilePanel } from './components/FilePanel'
import { JogPanel } from './components/JogPanel'
import { LaserTab } from './components/LaserTab'
import { MachinePanel } from './components/MachinePanel'
import { OffsetsPanel } from './components/OffsetsPanel'
import { OverridesPanel } from './components/OverridesPanel'
import { PcbTab } from './components/PcbTab'
import { ProbePanel } from './components/ProbePanel'
import { ProjectsModal } from './components/ProjectsModal'
import { ReliefTab } from './components/ReliefTab'
import { SettingsPanel } from './components/SettingsPanel'
import { ToolpathViewer } from './components/ToolpathViewer'
import { TutorialModal } from './components/TutorialModal'
import { View3DTab } from './components/View3DTab'
import { AUTOSAVE_NAME, currentProject, saveProject } from './state/project'
import { useT } from './i18n'
import { useUiStore, type TabId } from './state/uiStore'

const TABS: Array<{ id: TabId; ready: boolean }> = [
  { id: 'pilotage', ready: true },
  { id: 'conception', ready: true },
  { id: 'vue3d', ready: true },
  { id: 'laser', ready: true },
  { id: 'pcb', ready: true },
  { id: 'relief', ready: true },
  { id: 'reglages', ready: true },
]

export function App() {
  const tab = useUiStore((s) => s.tab)
  const setTab = useUiStore((s) => s.setTab)
  const modal = useUiStore((s) => s.modal)
  const t = useT()

  useEffect(() => {
    let timer: number | undefined
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        try {
          saveProject(currentProject(AUTOSAVE_NAME))
        } catch {
          /* ignore */
        }
      }, 4000)
    }
    const unsubscribe = useCamStore.subscribe(schedule)
    return () => {
      window.clearTimeout(timer)
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useUiStore.getState().closeModal()
      const target = e.target as HTMLElement
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')
      if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) useCamStore.getState().redo()
        else useCamStore.getState().undo()
      }
      if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        useCamStore.getState().redo()
      }
      if ((e.ctrlKey || e.metaKey) && /^[1-7]$/.test(e.key)) {
        e.preventDefault()
        const ids: TabId[] = ['pilotage', 'conception', 'vue3d', 'laser', 'pcb', 'relief', 'reglages']
        setTab(ids[Number(e.key) - 1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setTab])

  return (
    <div className="app">
      <ConnectionBar />
      <nav className="tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={`tab ${tab === item.id ? 'active' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {t(`tab.${item.id}`)}
            {!item.ready && <span className="tab-soon">bientôt</span>}
          </button>
        ))}
      </nav>

      {tab === 'pilotage' && (
        <main className="layout">
          <div className="column left">
            <DroPanel />
            <JogPanel />
            <ProbePanel />
            <MachinePanel />
          </div>
          <div className="column center">
            <div className="panel viewer-panel">
              <ToolpathViewer />
            </div>
            <FilePanel />
          </div>
          <div className="column right">
            <ConsolePanel />
            <OverridesPanel />
            <OffsetsPanel />
          </div>
        </main>
      )}

      {tab === 'conception' && <DesignTab />}

      {tab === 'vue3d' && <View3DTab />}

      {tab === 'laser' && <LaserTab />}

      {tab === 'pcb' && <PcbTab />}

      {tab === 'relief' && <ReliefTab />}

      {tab === 'reglages' && (
        <main className="single">
          <SettingsPanel />
        </main>
      )}

      {tab !== 'pilotage' && tab !== 'conception' && tab !== 'vue3d' && tab !== 'laser' && tab !== 'pcb' && tab !== 'relief' && tab !== 'reglages' && (
        <main className="single">
          <section className="panel placeholder">
            <h2>Module en préparation</h2>
            <p>
              Ce module ({t(`tab.${tab}`)}) fait partie de la feuille de route de portage.
              Il sera ajouté dans une prochaine étape.
            </p>
          </section>
        </main>
      )}

      {modal === 'projects' && <ProjectsModal />}
      {modal === 'tutorial' && <TutorialModal />}
    </div>
  )
}
