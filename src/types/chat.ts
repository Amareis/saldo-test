export type Role = 'user' | 'assistant';

/** Typed error codes, mirrored 1:1 with the server's mapping. */
export type ChatErrorCode =
  | 'rate_limit' // 429 from the free model
  | 'timeout' // first-byte or mid-stream idle timeout
  | 'network' // connection lost / unreachable
  | 'auth' // bad OpenRouter key on the server
  | 'no_key' // server has no key configured at all
  | 'bad_request'
  | 'upstream'
  | 'unknown'; // anything untyped — UI shows generic text, details under a spoiler

export interface ChatError {
  code: ChatErrorCode;
  message: string;
  /** Seconds suggested by the provider before retrying (429). */
  retryAfter?: number;
}

export type MessageStatus = 'done' | 'streaming' | 'stopped' | 'error';

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  /** Reasoning tokens of thinking models — shown collapsed above the answer. */
  reasoning?: string;
  status: MessageStatus;
  error?: ChatError;
  createdAt: number;
}
