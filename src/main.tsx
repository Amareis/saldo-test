import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { chatStore } from './stores/chat-store'

// Console access, always on: store.getSnapshot(), store.send('...'), store.reset()
;(window as unknown as { store: typeof chatStore }).store = chatStore

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
