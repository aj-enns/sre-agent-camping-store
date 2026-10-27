import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ApiContext, defaultApiClient } from './api';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ApiContext.Provider value={defaultApiClient()}>
      <App />
    </ApiContext.Provider>
  </StrictMode>
);
