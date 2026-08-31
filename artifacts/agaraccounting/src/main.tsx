import { createRoot } from 'react-dom/client';

import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const path = typeof window === 'undefined' ? '' : window.location.pathname;
const stripped = basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
const isPublicDetailRequest = stripped.startsWith('/detail-request/');

const root = createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
});

void (isPublicDetailRequest ? import('./pages/detail-request') : import('./App')).then(({ default: Page }) => {
  root.render(
    <ErrorBoundary>
      <Page />
    </ErrorBoundary>,
  );
});
