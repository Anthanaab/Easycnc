import { useEffect, useRef, useState } from 'react'
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
import { setAccessToken } from '../state/accessToken'
import {
  deleteServerProject,
  exportServerProjects,
  importServerProjects,
  listServerProjects,
  loadServerProject,
  saveServerProject,
  type ServerProjectInfo,
} from '../state/serverProjects'
import { useUiStore } from '../state/uiStore'
import { Modal } from './Modal'

export function ProjectsModal() {
  const closeModal = useUiStore((s) => s.closeModal)
  const [projects, setProjects] = useState(() => listProjects())
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  // null = serveur sans gestion des projets (local, hebergement statique).
  const [serverProjects, setServerProjects] = useState<ServerProjectInfo[] | null>(null)
  // Serveur protege par un code d'acces non encore saisi.
  const [locked, setLocked] = useState(false)
  const [code, setCode] = useState('')
  const backupRef = useRef<HTMLInputElement>(null)
  const [alsoServer, setAlsoServer] = useState(true)
  const t = useT()

  const refresh = () => setProjects(listProjects())
  const refreshServer = () =>
    void listServerProjects().then((list) => {
      setLocked(list === 'locked')
      setServerProjects(list === 'locked' ? null : list)
    })
  useEffect(refreshServer, [])

  const save = async () => {
    if (!name.trim()) {
      setMessage(t('Donnez un nom au projet'))
      return
    }
    const project = currentProject(name.trim())
    saveProject(project)
    let text = t('Projet enregistré')
    if (serverProjects && alsoServer) {
      try {
        await saveServerProject(project)
        text = t('Projet enregistré (navigateur + serveur)')
      } catch (error) {
        text = `${t('Projet enregistré dans le navigateur, échec sur le serveur')} : ${error instanceof Error ? error.message : String(error)}`
      }
      refreshServer()
    }
    setName('')
    setMessage(text)
    refresh()
  }

  const toServer = async (projectName: string) => {
    const project = projects.find((p) => p.name === projectName)
    if (!project) return
    try {
      if (serverProjects?.some((p) => p.name === projectName) && !window.confirm(t('Remplacer le projet du même nom sur le serveur ?'))) return
      await saveServerProject(project)
      setMessage(`${t('Envoyé sur le serveur')} : ${projectName}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
    refreshServer()
  }

  const openServer = async (projectName: string) => {
    try {
      const project = await loadServerProject(projectName)
      applyProject(project)
      setMessage(`${t('Projet ouvert depuis le serveur')} : ${projectName}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  const removeServer = async (projectName: string) => {
    if (!window.confirm(t('Supprimer ce projet du serveur ? (il reste récupérable dans la corbeille du serveur)'))) return
    try {
      await deleteServerProject(projectName)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
    refreshServer()
  }

  const open = (projectName: string) => {
    const project = projects.find((p) => p.name === projectName)
    if (!project) return
    applyProject(project)
    setMessage(`${t('Projet ouvert')} : ${projectName}`)
  }

  const remove = (projectName: string) => {
    deleteProject(projectName)
    refresh()
  }

  return (
    <Modal title={t('Projets')} onClose={closeModal} wide>
      <div className="projects-save">
        <input value={name} placeholder={t('Nom du projet')} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary" onClick={() => void save()}>
          {t('Enregistrer le projet actuel')}
        </button>
        {serverProjects && (
          <label className="check">
            <input type="checkbox" checked={alsoServer} onChange={(e) => setAlsoServer(e.target.checked)} />
            {t('aussi sur le serveur')}
          </label>
        )}
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
                setMessage(`${t('Projet importé')} : ${project.name}`)
              } catch (error) {
                setMessage(error instanceof Error ? error.message : 'Import impossible')
              }
            }
            e.target.value = ''
          }}
        />
      </div>
      {message && <p className="notes">{message}</p>}

      {locked && (
        <div className="projects-save">
          <input type="password" autoComplete="off" placeholder={t("Code d'accès du serveur")} value={code} onChange={(e) => setCode(e.target.value)} />
          <button
            className="btn"
            onClick={() => {
              setAccessToken(code)
              refreshServer()
            }}
          >
            {t('Déverrouiller')}
          </button>
        </div>
      )}

      {serverProjects && (
        <>
          <div className="panel-head">
            <h3 className="sub">{t('Sur le serveur')} ({serverProjects.length})</h3>
            <div className="console-tools">
              <button
                className="btn tiny"
                disabled={!serverProjects.length}
                onClick={() =>
                  void exportServerProjects().then(
                    (n) => setMessage(`${t('Sauvegarde téléchargée')} : ${n} ${t('projet(s)')}`),
                    (error: Error) => setMessage(error.message),
                  )
                }
              >
                {t('Sauvegarder (serveur)')}
              </button>
              <button className="btn tiny" onClick={() => backupRef.current?.click()}>
                {t('Restaurer')}
              </button>
              <input
                ref={backupRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  try {
                    const n = await importServerProjects(await file.text())
                    setMessage(`${t('Restauré sur le serveur')} : ${n} ${t('projet(s)')}`)
                  } catch (error) {
                    setMessage(error instanceof Error ? error.message : String(error))
                  }
                  refreshServer()
                }}
              />
            </div>
          </div>
          <div className="project-list">
            {serverProjects.map((project) => (
              <div key={project.name} className="project-item">
                {project.thumbnail && <img className="project-thumb" src={project.thumbnail} alt="" />}
                <div className="project-info">
                  <b>{project.name}</b>
                  <div className="muted">
                    {project.date ? new Date(project.date).toLocaleString() : '—'} · {project.shapes} {t('forme(s)')}
                  </div>
                </div>
                <div className="project-actions">
                  <button className="btn tiny" onClick={() => void openServer(project.name)}>
                    {t('Ouvrir')}
                  </button>
                  <button className="btn tiny danger" onClick={() => void removeServer(project.name)}>
                    {t('Supprimer')}
                  </button>
                </div>
              </div>
            ))}
            {!serverProjects.length && <div className="empty">{t('Aucun projet sur le serveur.')}</div>}
          </div>
          <h3 className="sub">{t('Dans ce navigateur')} ({projects.length})</h3>
        </>
      )}

      <div className="project-list">
        {projects.map((project) => (
          <div key={project.name} className="project-item">
            {project.thumbnail && <img className="project-thumb" src={project.thumbnail} alt="" />}
            <div className="project-info">
              <b>{project.name}</b>
              <div className="muted">
                {new Date(project.date).toLocaleString()} · {project.shapes.length} {t('forme(s)')} · {project.images.length} {t('image(s)')}
              </div>
            </div>
            <div className="project-actions">
              <button className="btn tiny" onClick={() => open(project.name)}>
                {t('Ouvrir')}
              </button>
              <button className="btn tiny" onClick={() => downloadProject(project)}>
                {t('Exporter')}
              </button>
              {serverProjects && (
                <button className="btn tiny" onClick={() => void toServer(project.name)} title={t('Envoyer sur le serveur')}>
                  ⇪ {t('Serveur')}
                </button>
              )}
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
