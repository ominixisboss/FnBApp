import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { setupNative } from './native';
import { registerServiceWorker } from './ui/offline';
import { loadBotDecks } from './deck/botDecks';

setupNative();
registerServiceWorker();
void loadBotDecks();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
