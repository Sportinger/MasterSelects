import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/base.css'
import RootApp from './RootApp.tsx'
import { resolveEntryExperience } from './routing/entryExperience'

const initialExperience = resolveEntryExperience(window.location);

if (initialExperience === 'editor') {
  void import('./editorBoot');
}

// Note: StrictMode disabled for WebGPU compatibility in development
// StrictMode causes double-mounting which breaks external texture references
createRoot(document.getElementById('root')!).render(<RootApp initialExperience={initialExperience} />)
