import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted AFTERGLOW fonts (bundled + SW-precached for offline use).
import '@fontsource-variable/fraunces';
import '@fontsource-variable/inter';
import '@fontsource-variable/geist-mono';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
