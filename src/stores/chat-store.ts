import { Store } from '../lib/store';
import { ChatApiError, streamChat } from '../lib/chat-api';
import type { ChatTransport } from '../lib/chat-api';
import type { ChatError, ChatMessage } from '../types/chat';

export type ChatPhase = 'idle' | 'awaiting' | 'streaming';

export interface ChatState {
  messages: ChatMessage[];
  phase: ChatPhase;
  /** Composer draft lives here too — components stay dumb. */
  draft: string;
}

function makeId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

/** History we send to the proxy: finished turns only, last turn must be the user's. */
function toApiMessages(history: ChatMessage[]) {
  return history
    .filter((m) => m.status === 'done' || m.status === 'stopped' || m.role === 'user')
    .filter((m) => m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content }));
}

export class ChatStore extends Store<ChatState> {
  private abortController: AbortController | null = null;
  private transport: ChatTransport;

  /**
   * Transport defaults to the real SSE client; tests inject a scripted fake.
   * The store itself is DOM-free and runs under plain Node — UI only renders
   * snapshots and calls these methods.
   */
  constructor(transport: ChatTransport = streamChat) {
    super({ messages: [], phase: 'idle', draft: '' });
    this.transport = transport;
  }

  setDraft(draft: string): void {
    this.updateState({ draft });
  }

  send(text: string): void {
    const { messages, phase } = this.getSnapshot();
    const content = text.trim();
    if (!content || phase !== 'idle') return;
    const userMsg: ChatMessage = { id: makeId(), role: 'user', content, status: 'done', createdAt: Date.now() };
    void this.run([...messages, userMsg]);
  }

  /** Stop button / Esc: abort mid-stream; whatever arrived stays in history. */
  stop(): void {
    this.abortController?.abort();
  }

  /** Re-run generation for a failed assistant message, keeping history before it. */
  retry(failedId: string): void {
    const { messages, phase } = this.getSnapshot();
    if (phase !== 'idle') return;
    const idx = messages.findIndex((m) => m.id === failedId);
    if (idx === -1) return;
    void this.run(messages.slice(0, idx));
  }

  clear(): void {
    if (this.getSnapshot().phase !== 'idle') return;
    this.updateState({ messages: [] });
  }

  private async run(history: ChatMessage[]): Promise<void> {
    if (this.getSnapshot().phase !== 'idle') return;

    const assistantId = makeId();
    const placeholder: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      status: 'streaming',
      createdAt: Date.now(),
    };
    this.updateState({ messages: [...history, placeholder], phase: 'awaiting' });

    const controller = new AbortController();
    this.abortController = controller;
    let gotFirstActivity = false;

    const patchMessage = (patch: Partial<ChatMessage>) =>
      this.updateState({
        messages: this.getSnapshot().messages.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)),
      });

    // Any token — visible answer or reasoning — means the model is alive:
    // flip to 'streaming' so the typing indicator gives way to the caret.
    const appendDelta = (field: 'content' | 'reasoning', text: string) => {
      if (!gotFirstActivity) {
        gotFirstActivity = true;
        this.updateState({ phase: 'streaming' });
      }
      this.updateState({
        messages: this.getSnapshot().messages.map((m) =>
          m.id === assistantId ? { ...m, [field]: (m[field] ?? '') + text } : m,
        ),
      });
    };

    try {
      await this.transport(toApiMessages(history), {
        signal: controller.signal,
        onDelta: (text) => appendDelta('content', text),
        onReasoning: (text) => appendDelta('reasoning', text),
      });
      patchMessage({ status: 'done' });
    } catch (err) {
      if (controller.signal.aborted) {
        patchMessage({ status: 'stopped' });
      } else {
        const error: ChatError =
          err instanceof ChatApiError
            ? { code: err.code, message: err.message, retryAfter: err.retryAfter }
            : // Anything untyped (bug, JSON parse explosion, …) — the UI shows
              // a calm generic message, raw details go under a spoiler.
              { code: 'unknown', message: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
        patchMessage({ status: 'error', error });
      }
    } finally {
      this.abortController = null;
      this.updateState({ phase: 'idle' });
    }
  }
}

export const chatStore = new ChatStore();
