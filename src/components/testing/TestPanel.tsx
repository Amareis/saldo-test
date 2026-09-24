import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  X,
  Play,
  PlayCircle,
  StepForward,
  Loader2,
  FlaskConical,
  ChevronUp,
  ChevronDown,
  PauseCircle,
} from 'lucide-react';
import { chatStore } from '../../stores/chat-store';
import { streamChat } from '../../lib/chat-api';
import { getTests, runOne, type TestCase, type TestContext, type TestResult } from '../../testing/harness';
import { scripted } from '../../testing/fakes';
import { cn } from '../../lib/utils';
import '../../testing/chat-store.test';
import '../../testing/live.test';

interface TestPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Interactive test panel: the same isomorphic cases as npm run test:logic,
 * but driving the VISIBLE chat store — the chat next to the panel renders
 * every scenario live. In step mode checkpoints pause until «Далее».
 *
 * Layout: on desktop the panel is a flex sibling and squeezes the chat
 * (both stay visible); on mobile it opens over the page, and while a run
 * is in flight it collapses into a semi-transparent top bar with just the
 * checkpoint text and «Далее» — the chat underneath stays watchable.
 *
 * Running resets the chat and re-wires it to scripted transports; the real
 * transport is restored when a run finishes.
 */
export function TestPanel({ open, onClose }: TestPanelProps) {
  const [results, setResults] = useState<ReadonlyMap<string, TestResult>>(new Map());
  const [running, setRunning] = useState<string | null>(null);
  const [paused, setPaused] = useState<{ label?: string; resume: () => void } | null>(null);
  const [stepMode, setStepMode] = useState(true);
  const [forceExpanded, setForceExpanded] = useState(false);
  const stepModeRef = useRef(stepMode);
  stepModeRef.current = stepMode;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  // Checkpoints may only park while the panel is visible. Closing mid-run
  // fast-forwards the rest of the run: unpark the current checkpoint and
  // skip further pauses, so the run completes and the real transport comes
  // back instead of the chat staying wired to a scripted one in the background.
  const allowPausesRef = useRef(true);

  // Esc closes the panel (the chat's own Esc handler is paused while we're open).
  useEffect(() => {
    if (!open) {
      allowPausesRef.current = false;
      pausedRef.current?.resume();
      return;
    }
    allowPausesRef.current = true;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const makeCtx = (): TestContext => {
    // Checkpoints serialize into one lane: a test may hit its own checkpoint
    // while its scripted transport is still parked on an earlier one — without
    // a queue the banners would race and the transport would never resume.
    let lane = Promise.resolve();
    return {
      useTransport: (script, captured) => {
        chatStore.reset();
        chatStore.setTransport(scripted(script, captured));
        return chatStore;
      },
      checkpoint: (label) => {
        const turn = lane.then(() => {
          // Panel closed mid-run: fast-forward, no pauses and no delays.
          if (!allowPausesRef.current) return undefined;
          // Step mode: park until «Далее»; batch mode: linger a moment so
          // the state change is visible on the chat instead of flashing by.
          if (!stepModeRef.current) return new Promise<void>((r) => setTimeout(r, 200));
          return new Promise<void>((resolve) => {
            setPaused({
              label,
              resume: () => {
                setPaused(null);
                resolve();
              },
            });
          });
        });
        lane = turn;
        return turn;
      },
    };
  };

  const run = async (entry: TestCase) => {
    const result = await runOne(entry, makeCtx());
    setResults((m) => new Map(m).set(entry.name, result));
  };

  const finishRun = () => {
    // Real transport back; demoed messages stay visible for inspection, but
    // composer debris from scenarios (e.g. the guards test's draft) is wiped.
    setPaused(null);
    chatStore.setTransport(streamChat);
    chatStore.setDraft('');
    setRunning(null);
    setForceExpanded(false);
  };

  const runGuarded = async (entry: TestCase) => {
    if (running) return;
    setRunning(entry.name);
    try {
      await run(entry);
    } finally {
      finishRun();
    }
  };

  const runEverything = async () => {
    if (running) return;
    setRunning('*');
    setResults(new Map());
    try {
      for (const entry of getTests()) await run(entry);
    } finally {
      finishRun();
    }
  };

  if (!open) return null;

  const tests = getTests();
  const passed = [...results.values()].filter((r) => r.ok).length;
  const inFlight = running !== null || paused !== null;
  // Mobile-only collapse (sm: overrides keep the desktop panel always full).
  const collapsed = inFlight && !forceExpanded;

  return (
    <aside
      role="dialog"
      aria-label="Тесты"
      className={cn(
        'flex w-full flex-col border-l border-border bg-background',
        // Mobile: overlay over the page.
        'fixed inset-0 z-50 shadow-2xl',
        // Desktop: squeezes the chat instead of covering it.
        'sm:static sm:z-auto sm:w-[26rem] sm:shrink-0 sm:shadow-none',
        // Mobile, run in flight: semi-transparent bar pinned to the top.
        collapsed && 'bottom-auto bg-background/80 backdrop-blur-md sm:bg-background sm:backdrop-blur-none',
      )}
    >
      {collapsed && (
        <div className="flex items-center gap-2 px-3 py-2 sm:hidden">
          {paused ? (
            <PauseCircle className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          ) : (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
          )}
          <p className="line-clamp-2 min-w-0 flex-1 text-xs leading-snug">
            {paused ? paused.label ?? 'Контрольная точка' : `Выполняется… ${results.size}/${tests.length}`}
          </p>
          {paused && (
            <button
              type="button"
              onClick={paused.resume}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <StepForward className="h-3.5 w-3.5" aria-hidden="true" />
              Далее
            </button>
          )}
          <button
            type="button"
            onClick={() => setForceExpanded(true)}
            aria-label="Развернуть панель тестов"
            className="shrink-0 rounded-lg p-1.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть панель тестов"
            className="shrink-0 rounded-lg p-1.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      <div className={cn('flex min-h-0 flex-1 flex-col', collapsed && 'hidden sm:flex')}>
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <FlaskConical className="h-4 w-4 text-primary" aria-hidden="true" />
            Тесты
            {results.size > 0 && (
              <span className="text-muted-foreground">
                {passed}/{results.size} passed
              </span>
            )}
          </h2>
          <div className="flex items-center gap-1">
            {inFlight && (
              <button
                type="button"
                onClick={() => setForceExpanded(false)}
                aria-label="Свернуть панель в плашку"
                className="rounded-lg p-1.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden"
              >
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть панель тестов"
              className="rounded-lg p-1.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="border-b border-border px-4 py-3 text-xs text-muted-foreground">
          Кейсы те же, что гоняет <code className="rounded bg-muted px-1">npm run test:logic</code>, но здесь они
          двигают настоящий чат рядом с панелью. Запуск сбрасывает текущий диалог; транспорт подменяется скриптом
          до конца прогона.
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-foreground">
            <input
              type="checkbox"
              checked={stepMode}
              onChange={(e) => setStepMode(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-current"
            />
            Пошагово — паузы на контрольных точках
          </label>
        </div>

        {paused && (
          <div className="flex items-center justify-between gap-3 border-b border-border bg-primary/5 px-4 py-2.5">
            <p className="min-w-0 text-xs">
              <span className="font-medium">Контрольная точка:</span> {paused.label ?? 'шаг'}
            </p>
            <button
              type="button"
              autoFocus
              onClick={paused.resume}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <StepForward className="h-3.5 w-3.5" aria-hidden="true" />
              Далее
            </button>
          </div>
        )}

        <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
          {tests.map((entry) => {
            const result = results.get(entry.name);
            const isRunning = running === entry.name || running === '*';
            return (
              <li key={entry.name} className="rounded-xl border border-border bg-card px-3 py-2.5">
                <div className="flex items-center gap-2.5">
                  <span className="shrink-0" aria-hidden="true">
                    {isRunning && !result ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : result?.ok ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : result ? (
                      <XCircle className="h-4 w-4 text-destructive" />
                    ) : (
                      <span className="block h-4 w-4 rounded-full border border-border" />
                    )}
                  </span>
                  <p className="min-w-0 flex-1 text-xs leading-snug">
                    {entry.name}
                    {result && <span className="text-muted-foreground"> · {result.durationMs}ms</span>}
                  </p>
                  <button
                    type="button"
                    onClick={() => void runGuarded(entry)}
                    disabled={running !== null}
                    aria-label={`Запустить: ${entry.name}`}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors hover:bg-accent disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    Пуск
                  </button>
                </div>
                {result?.error && (
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-destructive/10 p-2 text-xs text-destructive">
                    {result.error}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>

        <footer className="border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={() => void runEverything()}
            disabled={running !== null}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PlayCircle className="h-4 w-4" aria-hidden="true" />
            Запустить все
          </button>
        </footer>
      </div>
    </aside>
  );
}
