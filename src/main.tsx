import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './ui/App'
import './ui/styles.css'

const root = document.getElementById('root')!

if (import.meta.env.DEV && location.hash === '#lineup') {
  // Dev-only art review: every character placeholder side by side.
  void import('./dev/lineup').then((m) => m.mountLineup(root))
} else {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}
