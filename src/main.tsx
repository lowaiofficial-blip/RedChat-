import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { PlatformClosureScreen } from './components/PlatformClosureScreen';

const PLATFORM_PERMANENTLY_CLOSED = true;

const rootElement = document.getElementById('root')!;

if (PLATFORM_PERMANENTLY_CLOSED) {
  createRoot(rootElement).render(
    <StrictMode>
      <PlatformClosureScreen />
    </StrictMode>,
  );
} else {
  Promise.all([import('./utils/theme.ts'), import('./App.tsx')]).then(
    ([{ initTheme }, { default: App }]) => {
      initTheme();
      createRoot(rootElement).render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    },
  );
}
