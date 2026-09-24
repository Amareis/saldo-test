import { Sparkles } from 'lucide-react';

const SUGGESTIONS = [
  'Объясни, чем SSE отличается от WebSocket, в трёх предложениях',
  'Напиши хокку про код-ревью',
  'Какие краевые случаи стоит тестировать в стриминговом чате?',
];

export function EmptyState({ onSuggestion }: { onSuggestion: (text: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
        <Sparkles className="h-7 w-7 text-primary" aria-hidden="true" />
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">Чем помочь?</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Задайте вопрос — ответ появится по мере генерации. Enter отправляет сообщение, Esc останавливает генерацию.
        </p>
      </div>
      <ul className="flex w-full max-w-md flex-col gap-2">
        {SUGGESTIONS.map((s) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => onSuggestion(s)}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-left text-sm text-card-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
