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
    // Flex row: on desktop the open test panel squeezes the chat instead of
    // covering it (on mobile the panel is an overlay — see TestPanel).
    <div className="flex h-dvh">
      <div className="min-w-0 flex-1">
        <Home onOpenTests={() => setTestsOpen(true)} testsOpen={testsOpen} />
      </div>
      <TestPanel open={testsOpen} onClose={closeTests} />
    </div>
  );
}
