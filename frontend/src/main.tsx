import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './App.css'
import './styles/global.css'
import App from './App.tsx'
import { initThemeFromStorage } from './themePreference'

initThemeFromStorage()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
