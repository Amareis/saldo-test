/**
 * Shared fakes for the isomorphic tests: scripted transports and the
 * headless context (Node runner). The browser panel builds its own
 * interactive context on the visible chat store.
 */
import { ChatStore } from '../stores/chat-store';
import type { ChatTransport } from '../lib/chat-api';
import type { ApiMessages, ScriptFn, TestContext } from './harness';

export const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Wait until the store finishes a run (phase back to 'idle').
 * In the browser panel a scripted transport parks on checkpoints until the
 * user clicks «Далее», so assertions must wait for real completion rather
 * than a fixed number of flushes. Headless scripts are finite, so an
 * unbounded wait is safe there (the runner has a global watchdog).
 */
export async function settle(store: ChatStore): Promise<void> {
  while (store.getSnapshot().phase !== 'idle') await flush();
}

/** A transport scripted per test; can capture the history it was called with. */
export function scripted(fn: ScriptFn, captured?: ApiMessages[]): ChatTransport {
  return (messages, opts) => {
    captured?.push(messages);
    // Defer into a microtask: the real transport never calls back
    // synchronously, and tests assert the 'awaiting' phase after send().
    return Promise.resolve().then(() => fn(opts));
  };
}

export function aborted(signal: AbortSignal): Promise<never> {
  // Like fetch: an already-aborted signal rejects immediately.
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((_, reject) =>
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
  );
}

/** Node context: every scenario gets a fresh store, checkpoints are no-ops. */
export function headlessContext(): TestContext {
  return {
    useTransport: (fn, captured) => new ChatStore(scripted(fn, captured)),
    checkpoint: async () => {},
  };
}
