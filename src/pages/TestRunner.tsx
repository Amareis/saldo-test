import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, XCircle, RefreshCw, ArrowLeft } from 'lucide-react';
import { runTests, type TestResult } from '../testing/harness';
import '../testing/chat-store.test';
import '../testing/live.test';

/**
 * Browser test runner at /#tests: the same isomorphic cases that Node runs
 * via `npm run test:logic`, plus live checks against the serving origin.
 */
export default function TestRunner() {
  const [results, setResults] = useState<TestResult[] | null>(null);

  const run = useCallback(() => {
    setResults(null);
    void runTests().then(setResults);
  }, []);

  // Auto-run on mount; the rerun button calls run() from an event handler.
  useEffect(() => {
    void runTests().then(setResults);
  }, []);

  const passed = results?.filter((r) => r.ok).length ?? 0;
  const total = results?.length ?? 0;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Тесты логики чата</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Те же кейсы, что гоняет <code className="rounded bg-muted px-1">npm run test:logic</code> в Node, — здесь они
            выполняются в настоящем браузере, плюс live-проверка сервера.
          </p>
        </div>
        <a
          href="#"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          В чат
        </a>
      </header>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={results === null}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Перезапустить
        </button>
        {results && (
          <p role="status" className="text-sm text-muted-foreground">
            {passed}/{total} passed
          </p>
        )}
      </div>

      {results === null ? (
        <p className="text-sm text-muted-foreground">Выполняются…</p>
      ) : (
        <ul className="space-y-2">
          {results.map((r) => (
            <li key={r.name} className="rounded-xl border border-border bg-card px-4 py-3">
              <div className="flex items-start gap-2.5">
                {r.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                )}
                <div className="min-w-0">
                  <p className="text-sm">
                    {r.name} <span className="text-muted-foreground">· {r.durationMs}ms</span>
                  </p>
                  {r.error && (
                    <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-all rounded bg-destructive/10 p-2 text-xs text-destructive">
                      {r.error}
                    </pre>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
