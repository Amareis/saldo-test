/**
 * Minimal external-store base class, built on React's useSyncExternalStore
 * contract: { subscribe, getSnapshot }.
 *
 * Rules that keep React happy:
 * - getSnapshot() must return the SAME reference between mutations,
 *   otherwise React re-renders forever → state updates are immutable;
 * - subscribe() returns an unsubscribe function.
 */
export abstract class Store<TState> {
  private listeners = new Set<() => void>();
  private state: TState;

  constructor(initial: TState) {
    this.state = initial;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): TState => this.state;

  protected setState(next: TState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  /**
   * Shallow-merge a patch into the state — the common case. Keeps call
   * sites short: updateState({ draft }) instead of setState({ ...state, draft }).
   */
  protected updateState(patch: Partial<TState>): void {
    this.setState({ ...this.state, ...patch });
  }
}
