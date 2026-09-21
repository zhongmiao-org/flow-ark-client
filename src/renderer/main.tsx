import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@fontsource-variable/inter';
import '@fontsource-variable/noto-sans-sc';
import './style.css';
import './design-system.css';
import './workspace.css';
import './editor-system.css';
import './runs-system.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
