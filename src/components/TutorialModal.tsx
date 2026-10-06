import { useState } from 'react'
import { TUTORIAL } from '../data/tutorial'
import { useT } from '../i18n'
import { useUiStore } from '../state/uiStore'
import { Modal } from './Modal'

const CHECKS_KEY = 'tutorial.checks'

function loadChecks(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(CHECKS_KEY)
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

export function TutorialModal() {
  const closeModal = useUiStore((s) => s.closeModal)
  const [checks, setChecks] = useState<Record<string, boolean>>(loadChecks)
  const t = useT()

  const toggle = (key: string) => {
    const next = { ...checks, [key]: !checks[key] }
    setChecks(next)
    localStorage.setItem(CHECKS_KEY, JSON.stringify(next))
  }

  const reset = () => {
    setChecks({})
    localStorage.setItem(CHECKS_KEY, '{}')
  }

  return (
    <Modal title={t('Tutoriel')} onClose={closeModal} wide>
      <div className="tutorial-head">
        <button className="btn tiny" onClick={reset}>
          {t('Réinitialiser les cases')}
        </button>
      </div>
      {TUTORIAL.map((section, si) => (
        <section key={section.title} className="tutorial-section">
          <h3>{t(section.title)}</h3>
          {section.items.map((item, ii) => {
            const key = `${si}-${ii}`
            return (
              <label key={key} className="tutorial-item">
                <input type="checkbox" checked={!!checks[key]} onChange={() => toggle(key)} />
                <span>{t(item)}</span>
              </label>
            )
          })}
        </section>
      ))}
    </Modal>
  )
}
