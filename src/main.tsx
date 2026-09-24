import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { chatStore } from './stores/chat-store'

// Dev console access: __chatStore.getSnapshot(), __chatStore.send('...') etc.
if (import.meta.env.DEV) {
  ;(window as unknown as { __chatStore: typeof chatStore }).__chatStore = chatStore
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
