import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { OverlayApp } from './OverlayApp'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('Не найден корневой элемент')

createRoot(container).render(
  <StrictMode>
    <OverlayApp />
  </StrictMode>
)
