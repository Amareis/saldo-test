/**
 * Isomorphic ChatStore tests: run in Node (tsx tests/run-logic.ts) and in
 * the browser (/#tests). Transport is scripted — no network, deterministic.
 */
import { ChatStore } from '../stores/chat-store';
import { ChatApiError } from '../lib/chat-api';
import type { ChatTransport } from '../lib/chat-api';
import type { ChatMessage, Role } from '../types/chat';
import { assert, assertEq, assertIncludes, test } from './harness';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type ApiMessages = { role: Role; content: string }[];

/** A transport scripted per test; can capture the history it was called with. */
function scripted(
  fn: (opts: { signal: AbortSignal; onDelta: (t: string) => void; onReasoning?: (t: string) => void }) => void | Promise<void>,
  captured?: ApiMessages[],
): ChatTransport {
  return (messages, opts) => {
    captured?.push(messages);
    // Defer into a microtask: the real transport never calls back
    // synchronously, and tests assert the 'awaiting' phase after send().
    return Promise.resolve().then(() => fn(opts));
  };
}

function aborted(signal: AbortSignal): Promise<never> {
  // Like fetch: an already-aborted signal rejects immediately.
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((_, reject) =>
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
  );
}

const lastMsg = (s: ChatStore): ChatMessage => {
  const { messages } = s.getSnapshot();
  return messages[messages.length - 1];
};

test('send: placeholder, streaming deltas, done', async () => {
  const store = new ChatStore(scripted(({ onDelta }) => {
    onDelta('Hel');
    onDelta('lo');
  }));

  store.send('  hi  ');
  assertEq(store.getSnapshot().phase, 'awaiting');
  assertEq(store.getSnapshot().messages.length, 2);
  assertEq(store.getSnapshot().messages[0].role, 'user');

  await flush();
  const st = store.getSnapshot();
  assertEq(st.phase, 'idle');
  assertEq(lastMsg(store).content, 'Hello');
  assertEq(lastMsg(store).status, 'done');
});

test('reasoning: accumulates separately, first reasoning token means streaming', async () => {
  const phases: string[] = [];
  const store = new ChatStore(scripted(async ({ onDelta, onReasoning }) => {
    onReasoning?.('думаю… ');
    phases.push(store.getSnapshot().phase);
    await flush();
    onReasoning?.('ещё думаю');
    onDelta('готово');
  }));

  store.send('q');
  await flush();
  await flush();

  assertEq(phases[0], 'streaming'); // reasoning flipped us out of 'awaiting'
  assertEq(lastMsg(store).reasoning, 'думаю… ещё думаю');
  assertEq(lastMsg(store).content, 'готово');
  assertEq(lastMsg(store).status, 'done');
});

test('stop: partial answer kept, marked stopped, phase back to idle', async () => {
  const store = new ChatStore(scripted(async ({ signal, onDelta }) => {
    onDelta('часть от');
    await aborted(signal);
  }));

  store.send('q');
  await flush();
  assertEq(store.getSnapshot().phase, 'streaming');

  store.stop();
  await flush();
  assertEq(lastMsg(store).status, 'stopped');
  assertEq(lastMsg(store).content, 'часть от');
  assertEq(store.getSnapshot().phase, 'idle');
});

test('typed error: ChatApiError maps code and retryAfter onto the message', async () => {
  const store = new ChatStore(scripted(() => {
    throw new ChatApiError('rate_limit', 'slow down', 7);
  }));

  store.send('q');
  await flush();
  const msg = lastMsg(store);
  assertEq(msg.status, 'error');
  assertEq(msg.error?.code, 'rate_limit');
  assertEq(msg.error?.retryAfter, 7);
  assertEq(store.getSnapshot().phase, 'idle');
});

test('unknown error: untyped throw is wrapped with its name and message', async () => {
  const store = new ChatStore(scripted(() => {
    throw new TypeError('boom');
  }));

  store.send('q');
  await flush();
  const msg = lastMsg(store);
  assertEq(msg.status, 'error');
  assertEq(msg.error?.code, 'unknown');
  assertIncludes(msg.error?.message ?? '', 'TypeError: boom');
});

test('retry: failed turn replaced, history before it kept and resent', async () => {
  const calls: ApiMessages[] = [];
  let fail = true;
  const store = new ChatStore(scripted(({ onDelta }) => {
    if (fail) throw new ChatApiError('timeout', 'nope');
    onDelta('ок');
  }, calls));

  store.send('вопрос');
  await flush();
  assertEq(lastMsg(store).status, 'error');
  const failedId = lastMsg(store).id;

  fail = false;
  store.retry(failedId);
  await flush();

  const st = store.getSnapshot();
  assertEq(st.messages.length, 2); // user + new assistant, failed one replaced
  assertEq(lastMsg(store).status, 'done');
  assertEq(lastMsg(store).content, 'ок');
  assertEq(calls.length, 2);
  assertEq(calls[1].length, 1); // retried with just the user message
  assertEq(calls[1][0].content, 'вопрос');
});

test('history: done turns only, no placeholder, reasoning never sent back', async () => {
  const calls: ApiMessages[] = [];
  const store = new ChatStore(scripted(({ onDelta, onReasoning }) => {
    onReasoning?.('мысли');
    onDelta('ответ');
  }, calls));

  store.send('q1');
  await flush();
  store.send('q2');
  await flush();

  assertEq(calls.length, 2);
  const second = calls[1];
  assertEq(second.length, 3); // user q1, assistant, user q2
  assertEq(second[1].role, 'assistant');
  assertEq(second[1].content, 'ответ');
  assert(!('reasoning' in second[1]), 'reasoning must not leak into history');
});

test('guards: no send/clear while busy, empty draft not sent', async () => {
  const store = new ChatStore(scripted(({ signal }) => aborted(signal)));

  store.send('   ');
  assertEq(store.getSnapshot().messages.length, 0); // whitespace — ignored

  store.setDraft('черновик');
  assertEq(store.getSnapshot().draft, 'черновик');

  store.send('первый');
  assertEq(store.getSnapshot().phase, 'awaiting');
  store.send('второй'); // busy — must be ignored
  assertEq(store.getSnapshot().messages.length, 2);
  store.clear(); // busy — must be ignored
  assertEq(store.getSnapshot().messages.length, 2);

  store.stop();
  await flush();
  store.clear();
  assertEq(store.getSnapshot().messages.length, 0);
});
