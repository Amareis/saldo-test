import { useEffect, useRef } from 'react';
import { SendHorizontal, Square } from 'lucide-react';
import { chatStore } from '@/stores/chat-store';
import { useStore } from '@/lib/use-store';

export function Composer() {
  const { draft, phase } = useStore(chatStore);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const generating = phase !== 'idle';
  const canSend = draft.trim().length > 0 && !generating;

  // Autofocus on mount — it's a chat, typing is the primary action.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Grow the textarea with content up to a sane cap.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const submit = () => {
    if (!canSend) return;
    chatStore.send(draft);
    chatStore.setDraft('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter inserts a newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    // Esc stops generation. (Also handled globally — but when the textarea
    // has focus the event lands here first.)
    if (e.key === 'Escape' && generating) {
      e.preventDefault();
      chatStore.stop();
    }
  };

  return (
    <form
      className="border-t border-border bg-background/80 backdrop-blur"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="mx-auto flex w-full max-w-3xl items-end gap-2 px-4 py-3">
        <label htmlFor="chat-input" className="sr-only">
          Сообщение модели
        </label>
        <textarea
          id="chat-input"
          ref={textareaRef}
          value={draft}
          onChange={(e) => chatStore.setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Напишите сообщение…"
          rows={1}
          aria-describedby="composer-hint"
          className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl border border-input bg-card px-3.5 py-2.5 text-[15px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
        {generating ? (
          <button
            type="button"
            onClick={() => chatStore.stop()}
            aria-label="Остановить генерацию"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-destructive text-destructive-foreground transition-colors hover:bg-destructive/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Square className="h-4 w-4 fill-current" aria-hidden="true" />
          </button>
        ) : (
          // NOT type="submit": React morphs the stop button into this one in
          // place, and Blink computes the click's activation behavior AFTER
          // listeners — a morphed submit button gets activated by the very
          // click that pressed «stop», sending the draft. type="button" has
          // no activation behavior, so the phantom click is a no-op.
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            aria-label="Отправить сообщение"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <SendHorizontal className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      <p id="composer-hint" className="mx-auto w-full max-w-3xl px-4 pb-2 text-xs text-muted-foreground">
        Enter — отправить · Shift+Enter — новая строка · Esc — остановить генерацию
      </p>
    </form>
  );
}
