import type { ChatErrorCode, Role } from '../types/chat';

/**
 * Client for our own /api/chat proxy. The browser never sees the OpenRouter
 * key — it only talks to this endpoint, and receives the answer as SSE.
 *
 * Why fetch + ReadableStream and not EventSource: EventSource is GET-only,
 * can't send the message history in a body, and its abort semantics are
 * clunkier. fetch gives us POST, AbortController and proper error statuses.
 */

export class ChatApiError extends Error {
  readonly code: ChatErrorCode;
  readonly retryAfter?: number;

  constructor(code: ChatErrorCode, message: string, retryAfter?: number) {
    super(message);
    this.name = 'ChatApiError';
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

interface StreamOptions {
  signal: AbortSignal;
  onDelta: (text: string) => void;
  /** Reasoning tokens stream as separate events, before/alongside the answer. */
  onReasoning?: (text: string) => void;
}

interface ApiMessage {
  role: Role;
  content: string;
}

export async function streamChat(messages: ApiMessage[], { signal, onDelta, onReasoning }: StreamOptions): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new ChatApiError('network', 'Не удалось соединиться с сервером. Проверьте сеть и повторите.');
  }

  // Setup-phase errors arrive as plain JSON with a real HTTP status.
  if (!res.ok || !res.body) {
    throw await toHttpError(res);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split('\n\n');
    buffer = events.pop() ?? ''; // last piece may be incomplete — keep it

    for (const event of events) {
      const dataLine = event.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      let payload: { type?: string; text?: string; code?: ChatErrorCode; message?: string; retryAfter?: number };
      try {
        payload = JSON.parse(dataLine.slice(5));
      } catch {
        continue;
      }
      if (payload.type === 'delta' && payload.text) {
        onDelta(payload.text);
      } else if (payload.type === 'reasoning' && payload.text) {
        onReasoning?.(payload.text);
      } else if (payload.type === 'error') {
        throw new ChatApiError(payload.code ?? 'upstream', payload.message ?? 'Модель вернула ошибку.', payload.retryAfter);
      } else if (payload.type === 'done') {
        return;
      }
    }
  }

  // The stream ended without "done" or "error" — the server died mid-answer.
  throw new ChatApiError('network', 'Соединение оборвалось до конца ответа.');
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

async function toHttpError(res: Response): Promise<ChatApiError> {
  try {
    const body = await res.json();
    const e = body?.error;
    if (e?.code && e?.message) return new ChatApiError(e.code, e.message, e.retryAfter);
  } catch {
    /* fall through to status-based mapping */
  }
  if (res.status === 429) return new ChatApiError('rate_limit', 'Бесплатная модель перегружена. Попробуйте чуть позже.');
  if (res.status === 504) return new ChatApiError('timeout', 'Модель не ответила вовремя.');
  return new ChatApiError('upstream', `Сервер вернул ошибку (HTTP ${res.status}).`);
}

/**
 * Transport signature ChatStore depends on. Injectable: tests run the store
 * on a scripted fake, no network involved.
 */
export type ChatTransport = typeof streamChat;
