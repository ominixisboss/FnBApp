import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { setupNative } from './native';
import { registerServiceWorker } from './ui/offline';
import { loadBotDecks } from './deck/botDecks';
import { applyA11y } from './ui/a11y';

setupNative();
registerServiceWorker();
void loadBotDecks();
applyA11y();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
