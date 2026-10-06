import { useRef, useState } from 'react'
import {
  applyProject,
  currentProject,
  deleteProject,
  downloadProject,
  listProjects,
  parseProject,
  saveProject,
} from '../state/project'
import { useT } from '../i18n'
import { useUiStore } from '../state/uiStore'
import { Modal } from './Modal'

export function ProjectsModal() {
  const closeModal = useUiStore((s) => s.closeModal)
  const [projects, setProjects] = useState(() => listProjects())
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const t = useT()

  const refresh = () => setProjects(listProjects())

  const save = () => {
    if (!name.trim()) {
      setMessage('Donnez un nom au projet')
      return
    }
    saveProject(currentProject(name))
    setName('')
    setMessage('Projet enregistré')
    refresh()
  }

  const open = (projectName: string) => {
    const project = projects.find((p) => p.name === projectName)
    if (!project) return
    applyProject(project)
    setMessage(`Projet « ${projectName} » ouvert`)
  }

  const remove = (projectName: string) => {
    deleteProject(projectName)
    refresh()
  }

  return (
    <Modal title={t('Projets')} onClose={closeModal} wide>
      <div className="projects-save">
        <input value={name} placeholder={t('Nom du projet')} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary" onClick={save}>
          {t('Enregistrer le projet actuel')}
        </button>
        <button className="btn" onClick={() => downloadProject(currentProject(name || 'projet'))}>
          {t('Exporter')}
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          {t('Importer')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (file) {
              try {
                const project = parseProject(await file.text())
                applyProject(project)
                setMessage(`Projet « ${project.name} » importé`)
              } catch (error) {
                setMessage(error instanceof Error ? error.message : 'Import impossible')
              }
            }
            e.target.value = ''
          }}
        />
      </div>
      {message && <p className="notes">{message}</p>}

      <div className="project-list">
        {projects.map((project) => (
          <div key={project.name} className="project-item">
            {project.thumbnail && <img className="project-thumb" src={project.thumbnail} alt="" />}
            <div className="project-info">
              <b>{project.name}</b>
              <div className="muted">
                {new Date(project.date).toLocaleString()} · {project.shapes.length} forme(s) · {project.images.length} image(s)
              </div>
            </div>
            <div className="project-actions">
              <button className="btn tiny" onClick={() => open(project.name)}>
                {t('Ouvrir')}
              </button>
              <button className="btn tiny" onClick={() => downloadProject(project)}>
                {t('Exporter')}
              </button>
              <button className="btn tiny danger" onClick={() => remove(project.name)}>
                {t('Supprimer')}
              </button>
            </div>
          </div>
        ))}
        {!projects.length && <div className="empty">{t('Aucun projet enregistré.')}</div>}
      </div>
    </Modal>
  )
}
