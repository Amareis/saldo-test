import { useCallback, useRef, useState } from 'react';
import { ChatApiError, streamChat } from '@/lib/chat-api';
import type { ChatError, ChatMessage } from '@/types/chat';

export type ChatPhase = 'idle' | 'awaiting' | 'streaming';

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

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [phase, setPhase] = useState<ChatPhase>('idle');
  const abortRef = useRef<AbortController | null>(null);
  // Phase in a ref too: the async stream loop must see fresh values,
  // not the closure it was created with.
  const phaseRef = useRef<ChatPhase>('idle');

  const setPhaseBoth = (p: ChatPhase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const run = useCallback(async (history: ChatMessage[]) => {
    if (phaseRef.current !== 'idle') return;

    const assistantId = makeId();
    const placeholder: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      status: 'streaming',
      createdAt: Date.now(),
    };
    setMessages([...history, placeholder]);
    setPhaseBoth('awaiting');

    const controller = new AbortController();
    abortRef.current = controller;
    let gotFirstDelta = false;

    const patch = (p: Partial<ChatMessage>) =>
      setMessages((ms) => ms.map((m) => (m.id === assistantId ? { ...m, ...p } : m)));

    try {
      await streamChat(toApiMessages(history), {
        signal: controller.signal,
        onDelta: (text) => {
          if (!gotFirstDelta) {
            gotFirstDelta = true;
            setPhaseBoth('streaming');
          }
          setMessages((ms) => ms.map((m) => (m.id === assistantId ? { ...m, content: m.content + text } : m)));
        },
      });
      patch({ status: 'done' });
    } catch (err) {
      if (controller.signal.aborted) {
        // Stop button / Esc: keep whatever was generated, mark honestly.
        patch({ status: 'stopped' });
      } else {
        const error: ChatError =
          err instanceof ChatApiError
            ? { code: err.code, message: err.message, retryAfter: err.retryAfter }
            : { code: 'network', message: 'Неизвестная ошибка. Попробуйте ещё раз.' };
        patch({ status: 'error', error });
      }
    } finally {
      abortRef.current = null;
      setPhaseBoth('idle');
    }
  }, []);

  const send = useCallback(
    (text: string) => {
      const content = text.trim();
      if (!content || phaseRef.current !== 'idle') return;
      const userMsg: ChatMessage = { id: makeId(), role: 'user', content, status: 'done', createdAt: Date.now() };
      void run([...messages, userMsg]);
    },
    [messages, run],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /** Re-run generation for a failed assistant message, keeping the history before it. */
  const retry = useCallback(
    (failedId: string) => {
      if (phaseRef.current !== 'idle') return;
      const idx = messages.findIndex((m) => m.id === failedId);
      if (idx === -1) return;
      void run(messages.slice(0, idx));
    },
    [messages, run],
  );

  const clear = useCallback(() => {
    if (phaseRef.current !== 'idle') return;
    setMessages([]);
  }, []);

  return { messages, phase, send, stop, retry, clear };
}
