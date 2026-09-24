import { AlertCircle, RotateCcw } from 'lucide-react';
import type { ChatMessage } from '@/types/chat';
import { cn } from '@/lib/utils';

interface Props {
  message: ChatMessage;
  onRetry: (id: string) => void;
}

export function ChatMessageItem({ message, onRetry }: Props) {
  const isUser = message.role === 'user';

  return (
    <li className={cn('flex w-full flex-col', isUser ? 'items-end' : 'items-start')}>
      <article
        aria-label={isUser ? 'Вы' : 'Модель'}
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed sm:max-w-[75%]',
          isUser
            ? 'rounded-br-md bg-primary text-primary-foreground'
            : 'rounded-bl-md bg-muted text-foreground',
        )}
      >
        {message.content ? (
          <p className="whitespace-pre-wrap break-words">
            {message.content}
            {message.status === 'streaming' && (
              <span aria-hidden="true" className="ml-0.5 inline-block h-4 w-[7px] translate-y-[2px] animate-pulse rounded-[2px] bg-current opacity-70" />
            )}
          </p>
        ) : (
          message.status === 'streaming' && (
            <span aria-hidden="true" className="inline-block h-4 w-[7px] animate-pulse rounded-[2px] bg-current opacity-70" />
          )
        )}
      </article>

      {message.status === 'stopped' && (
        <p className="mt-1 px-1 text-xs text-muted-foreground">Генерация остановлена — ответ сохранён частично</p>
      )}

      {message.status === 'error' && message.error && (
        <div role="alert" className="mt-2 flex max-w-[85%] items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <div className="space-y-1.5">
            <p className="text-foreground">{errorText(message.error.code, message.error.message, message.error.retryAfter)}</p>
            <button
              type="button"
              onClick={() => onRetry(message.id)}
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
function errorText(code: string, fallback: string, retryAfter?: number): string {
  switch (code) {
    case 'rate_limit':
      return retryAfter
        ? `Бесплатная модель сейчас перегружена (429). Попробуйте через ~${retryAfter} сек.`
        : 'Бесплатная модель сейчас перегружена (429). Подождите немного и повторите.';
    case 'timeout':
      return 'Модель не ответила вовремя. Ваше сообщение сохранено — можно просто повторить.';
    case 'network':
      return 'Соединение оборвалось. Проверьте сеть и повторите.';
    case 'no_key':
      return 'На сервере не настроен ключ OpenRouter: скопируйте .env.example в .env и добавьте OPENROUTER_API_KEY.';
    case 'auth':
      return 'Ключ OpenRouter отклонён. Проверьте OPENROUTER_API_KEY в .env на сервере.';
    default:
      return fallback;
  }
}
