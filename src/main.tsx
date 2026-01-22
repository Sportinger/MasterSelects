import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Note: StrictMode disabled for WebGPU compatibility in development
// StrictMode causes double-mounting which breaks external texture references
createRoot(document.getElementById('root')!).render(<App />)
