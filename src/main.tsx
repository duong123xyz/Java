import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {PlayerPortal} from './PlayerPortal.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.pathname.startsWith('/studio') ? <App /> : <PlayerPortal />}
  </StrictMode>,
);
