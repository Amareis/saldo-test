import { useEffect, useState } from 'react';
import Home from './pages/Home';
import { TestPanel } from './components/testing/TestPanel';

export default function App() {
  // #tests opens the test panel too — handy for linking.
  const [testsOpen, setTestsOpen] = useState(() => window.location.hash === '#tests');

  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash === '#tests') setTestsOpen(true);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const closeTests = () => {
    setTestsOpen(false);
    if (window.location.hash === '#tests') history.replaceState(null, '', window.location.pathname);
  };

  return (
    <>
      <Home onOpenTests={() => setTestsOpen(true)} testsOpen={testsOpen} />
      <TestPanel open={testsOpen} onClose={closeTests} />
    </>
  );
}
