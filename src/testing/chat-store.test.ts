/**
 * Isomorphic ChatStore tests: run in Node (npm run test:logic) and in the
 * browser panel — there they drive the visible chat store, and checkpoints
 * pause until «Далее» so every step is observable on the real UI.
 *
 * Timing rule: after the actions, always `await settle(store)` before the
 * final assertions — in the browser a scripted transport may be parked on a
 * checkpoint, so a fixed number of flushes proves nothing.
 */
import { ChatApiError } from '../lib/chat-api';
import type { ChatStore } from '../stores/chat-store';
import type { ChatMessage } from '../types/chat';
import { aborted, flush, settle } from './fakes';
import type { ApiMessages } from './harness';
import { assert, assertEq, assertIncludes, test } from './harness';

const lastMsg = (s: ChatStore): ChatMessage => {
  const { messages } = s.getSnapshot();
  return messages[messages.length - 1];
};

test('send: placeholder, streaming deltas, done', async (ctx) => {
  const store = ctx.useTransport(async ({ onDelta }) => {
    onDelta('Hel');
    await ctx.checkpoint('первый чанк ответа прилетел — каретка стриминга');
    onDelta('lo');
  });

  store.send('  hi  ');
  assertEq(store.getSnapshot().phase, 'awaiting');
  assertEq(store.getSnapshot().messages.length, 2);
  assertEq(store.getSnapshot().messages[0].role, 'user');

  await settle(store);
  await ctx.checkpoint('ответ доехал целиком — статус done');

  const st = store.getSnapshot();
  assertEq(st.phase, 'idle');
  assertEq(lastMsg(store).content, 'Hello');
  assertEq(lastMsg(store).status, 'done');
});

test('reasoning: accumulates separately, first reasoning token means streaming', async (ctx) => {
  const phases: string[] = [];
  const store = ctx.useTransport(async ({ onDelta, onReasoning }) => {
    onReasoning?.('думаю… ');
    phases.push(store.getSnapshot().phase);
    await ctx.checkpoint('модель «размышляет» — спойлер над пустым ответом');
    onReasoning?.('ещё думаю');
    onDelta('готово');
  });

  store.send('q');
  await settle(store);
  await ctx.checkpoint('ответ готов, размышления сохранились под спойлером');

  assertEq(phases[0], 'streaming'); // reasoning flipped us out of 'awaiting'
  assertEq(lastMsg(store).reasoning, 'думаю… ещё думаю');
  assertEq(lastMsg(store).content, 'готово');
  assertEq(lastMsg(store).status, 'done');
});

test('stop: partial answer kept, marked stopped, phase back to idle', async (ctx) => {
  const store = ctx.useTransport(async ({ signal, onDelta }) => {
    onDelta('часть от');
    await ctx.checkpoint('ответ стримится — после «Далее» тест сам нажмёт «Стоп»');
    await aborted(signal);
  });

  store.send('q');
  await flush();
  assertEq(store.getSnapshot().phase, 'streaming');

  store.stop();
  await settle(store);
  await ctx.checkpoint('стоп: частичный ответ сохранился с пометкой');

  assertEq(lastMsg(store).status, 'stopped');
  assertEq(lastMsg(store).content, 'часть от');
  assertEq(store.getSnapshot().phase, 'idle');
});

test('typed error: ChatApiError maps code and retryAfter onto the message', async (ctx) => {
  const store = ctx.useTransport(() => {
    throw new ChatApiError('rate_limit', 'slow down', 7);
  });

  store.send('q');
  await settle(store);
  await ctx.checkpoint('типизированная ошибка: 429 с подсказкой retryAfter');

  const msg = lastMsg(store);
  assertEq(msg.status, 'error');
  assertEq(msg.error?.code, 'rate_limit');
  assertEq(msg.error?.retryAfter, 7);
  assertEq(store.getSnapshot().phase, 'idle');
});

test('unknown error: untyped throw is wrapped with its name and message', async (ctx) => {
  const store = ctx.useTransport(() => {
    throw new TypeError('boom');
  });

  store.send('q');
  await settle(store);
  await ctx.checkpoint('неизвестная ошибка: спокойный текст, детали под спойлером');

  const msg = lastMsg(store);
  assertEq(msg.status, 'error');
  assertEq(msg.error?.code, 'unknown');
  assertIncludes(msg.error?.message ?? '', 'TypeError: boom');
});

test('retry: failed turn replaced, history before it kept and resent', async (ctx) => {
  const calls: ApiMessages[] = [];
  let fail = true;
  const store = ctx.useTransport(({ onDelta }) => {
    if (fail) throw new ChatApiError('timeout', 'nope');
    onDelta('ок');
  }, calls);

  store.send('вопрос');
  await settle(store);
  assertEq(lastMsg(store).status, 'error');
  const failedId = lastMsg(store).id;
  await ctx.checkpoint('ход упал с ошибкой — после «Далее» тест нажмёт «Повторить»');

  fail = false;
  store.retry(failedId);
  await settle(store);
  await ctx.checkpoint('повтор: упавший ответ заменён успешным');

  const st = store.getSnapshot();
  assertEq(st.messages.length, 2); // user + new assistant, failed one replaced
  assertEq(lastMsg(store).status, 'done');
  assertEq(lastMsg(store).content, 'ок');
  assertEq(calls.length, 2);
  assertEq(calls[1].length, 1); // retried with just the user message
  assertEq(calls[1][0].content, 'вопрос');
});

test('history: done turns only, no placeholder, reasoning never sent back', async (ctx) => {
  const calls: ApiMessages[] = [];
  const store = ctx.useTransport(({ onDelta, onReasoning }) => {
    onReasoning?.('мысли');
    onDelta('ответ');
  }, calls);

  store.send('q1');
  await settle(store);
  store.send('q2');
  await settle(store);
  await ctx.checkpoint('два готовых хода — история чистая, без размышлений');

  assertEq(calls.length, 2);
  const second = calls[1];
  assertEq(second.length, 3); // user q1, assistant, user q2
  assertEq(second[1].role, 'assistant');
  assertEq(second[1].content, 'ответ');
  assert(!('reasoning' in second[1]), 'reasoning must not leak into history');
});

test('guards: no send/clear while busy, empty draft not sent', async (ctx) => {
  const store = ctx.useTransport(({ signal }) => aborted(signal));

  store.send('   ');
  assertEq(store.getSnapshot().messages.length, 0); // whitespace — ignored

  store.setDraft('черновик');
  assertEq(store.getSnapshot().draft, 'черновик');

  store.send('первый');
  assertEq(store.getSnapshot().phase, 'awaiting');
  await ctx.checkpoint('генерация висит — «второй» и очистка будут проигнорированы');

  store.send('второй'); // busy — must be ignored
  assertEq(store.getSnapshot().messages.length, 2);
  store.clear(); // busy — must be ignored
  assertEq(store.getSnapshot().messages.length, 2);

  store.stop();
  await settle(store);
  store.clear();
  assertEq(store.getSnapshot().messages.length, 0);
});
