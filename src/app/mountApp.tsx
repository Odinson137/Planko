import React, { useLayoutEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';

export function mountApp(container: HTMLElement, onReady: () => void): void {
  function ReadyApp() {
    useLayoutEffect(onReady, []);
    return <App />;
  }

  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <ReadyApp />
    </React.StrictMode>
  );
}
