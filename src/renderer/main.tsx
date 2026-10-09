import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ApplicationTheme } from './theme';
import '@fontsource-variable/inter';
import '@fontsource-variable/noto-sans-sc';
import './style.css';
import './design-system.css';
import './workspace.css';
import './editor-system.css';
import './runs-system.css';
import './ai-task.css';
import './script-editor.css';
import './flow-outline.css';
import './excel-mapping.css';
import './antd-layout.css';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ApplicationTheme>
      <App />
    </ApplicationTheme>
  </React.StrictMode>,
);
