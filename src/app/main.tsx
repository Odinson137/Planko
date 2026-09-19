import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { preloadPhotoTextures } from '../core/textures/PhotoTextures';

const container = document.getElementById('root') as HTMLElement;
container.textContent = 'Загрузка материалов…';
void preloadPhotoTextures().then(() => {
  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
