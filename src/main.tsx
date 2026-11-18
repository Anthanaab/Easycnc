import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { startAppUpdate } from './state/appUpdate'
import { startJobWatch } from './state/jobWatch'
import './styles.css'

startAppUpdate()
startJobWatch()

const container = document.getElementById('root')
if (!container) throw new Error('Element #root introuvable')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
