import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SettingsApp } from './SettingsApp'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('Не найден корневой элемент')

createRoot(container).render(
  <StrictMode>
    <SettingsApp />
  </StrictMode>
)
