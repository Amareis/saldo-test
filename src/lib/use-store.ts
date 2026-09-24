import { useSyncExternalStore } from 'react';
import type { Store } from './store';

/**
 * Subscribes a component to an external store. Returns the whole snapshot:
 * state is kept flat, and derived arrays via selectors would need memoization
 * (fresh reference each call = infinite re-render) — not worth it at this size.
 */
export function useStore<TState>(store: Store<TState>): TState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
