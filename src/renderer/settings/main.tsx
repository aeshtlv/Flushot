import { StrictMode } from 'react'
import { resolveLanguage, t } from '../../shared/i18n'
import { createRoot } from 'react-dom/client'
import { SettingsApp } from './SettingsApp'
import './styles.css'

const container = document.getElementById('root')
// The window is ours, so a missing root means the page was not built right.
if (!container) throw new Error(t(resolveLanguage(undefined, navigator.language), 'shell.noRoot'))

createRoot(container).render(
  <StrictMode>
    <SettingsApp />
  </StrictMode>
)
