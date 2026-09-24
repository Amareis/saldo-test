import { lazy, Suspense, useEffect, useState } from 'react';
import Home from './pages/Home';

// The test runner is a dev/diagnostic page — lazy-loaded so the main bundle
// doesn't carry it.
const TestRunner = lazy(() => import('./pages/TestRunner'));

export default function App() {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (hash === '#tests') {
    return (
      <Suspense fallback={<p className="p-10 text-sm text-muted-foreground">Загрузка тестов…</p>}>
        <TestRunner />
      </Suspense>
    );
  }
  return <Home />;
}
