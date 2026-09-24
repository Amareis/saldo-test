import { AlertCircle, RotateCcw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage } from '@/types/chat';
import { chatStore } from '@/stores/chat-store';
import { cn } from '@/lib/utils';

/** Streaming caret — shared by the plain and markdown branches. */
const Caret = () => (
  <span
    aria-hidden="true"
    className="ml-0.5 inline-block h-4 w-[7px] translate-y-[2px] animate-pulse rounded-[2px] bg-current opacity-70"
  />
);

export function ChatMessageItem({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <li className={cn('flex w-full flex-col', isUser ? 'items-end' : 'items-start')}>
      <article
        aria-label={isUser ? 'Вы' : 'Модель'}
        className={cn(
          'max-w-[88%] rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed shadow-sm sm:max-w-[75%] sm:px-4 sm:py-2.5',
          isUser
            ? 'rounded-br-md bg-primary text-primary-foreground'
            : 'rounded-bl-md bg-muted text-foreground',
        )}
      >
        {message.reasoning && (
          // Reasoning under a spoiler — natively keyboard-accessible.
          // While the model thinks (no visible answer yet) the summary says so.
          <details className="mb-1.5 text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {message.status === 'streaming' && !message.content ? 'Модель размышляет…' : 'Размышления модели'}
            </summary>
            <p className="mt-1 whitespace-pre-wrap break-words border-l-2 border-border pl-2 italic opacity-80">
              {message.reasoning}
            </p>
          </details>
        )}
        {message.content ? (
          isUser ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : (
            // Assistant answers are markdown (GFM) — models emit lists, code
            // and tables all the time. Re-parsing per token is fine at
            // chat-message sizes.
            <div className="md break-words">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  // External links open in a new tab, never navigate the chat away.
                  a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
                }}
              >
                {message.content}
              </ReactMarkdown>
              {message.status === 'streaming' && <Caret />}
            </div>
          )
        ) : (
          message.status === 'streaming' && <Caret />
        )}
      </article>

      {message.status === 'stopped' && (
        <p className="mt-1 px-1 text-xs text-muted-foreground">Генерация остановлена — ответ сохранён частично</p>
      )}

      {message.status === 'error' && message.error && (
        <div role="alert" className="mt-2 flex max-w-[85%] items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <div className="space-y-1.5">
            <ErrorText code={message.error.code} message={message.error.message} retryAfter={message.error.retryAfter} />
            <button
              type="button"
              onClick={() => chatStore.retry(message.id)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Повторить
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Human-readable states per failure kind — no eternal spinners, no silent deaths. */
function ErrorText({ code, message, retryAfter }: { code: string; message: string; retryAfter?: number }) {
  switch (code) {
    case 'rate_limit':
      return (
        <p className="text-foreground">
          {retryAfter
            ? `Бесплатная модель сейчас перегружена (429). Попробуйте через ~${retryAfter} сек.`
            : 'Бесплатная модель сейчас перегружена (429). Подождите немного и повторите.'}
        </p>
      );
    case 'timeout':
      return <p className="text-foreground">Модель не ответила вовремя. Ваше сообщение сохранено — можно просто повторить.</p>;
    case 'network':
      return <p className="text-foreground">Соединение оборвалось. Проверьте сеть и повторите.</p>;
    case 'no_key':
      return <p className="text-foreground">На сервере не настроен ключ OpenRouter: скопируйте .env.example в .env и добавьте OPENROUTER_API_KEY.</p>;
    case 'auth':
      return <p className="text-foreground">Ключ OpenRouter отклонён. Проверьте OPENROUTER_API_KEY в .env на сервере.</p>;
    default:
      // Unknown/untyped failure: stay calm, hide the gory details under a spoiler.
      // <details> is natively keyboard-accessible — no custom button needed.
      return (
        <div className="space-y-1">
          <p className="text-foreground">Что-то пошло не так. Попробуйте повторить запрос.</p>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Технические детали
            </summary>
            <pre className="mt-1 max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded bg-background/60 p-2">{message}</pre>
          </details>
        </div>
      );
  }
}
