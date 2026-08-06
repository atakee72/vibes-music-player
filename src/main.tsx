import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted AFTERGLOW fonts (bundled + SW-precached for offline use).
import '@fontsource-variable/fraunces';
import '@fontsource-variable/inter';
import '@fontsource-variable/geist-mono';
import App from './App';
import './index.css';

// Stale-chunk recovery: after a deploy, a tab holding the previous build can
// 404 on a lazy chunk (old hashes evicted from the SW precache). Vite fires
// this event on dynamic-import failure — reload to pick up the new build
// instead of leaving a blank surface where the lazy component should be.
window.addEventListener('vite:preloadError', () => {
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
