import { useEffect } from 'react';
import { MessageSquarePlus, Bot } from 'lucide-react';
import { chatStore } from '@/stores/chat-store';
import { useStore } from '@/lib/use-store';
import { MessageList } from '@/components/chat/MessageList';
import { Composer } from '@/components/chat/Composer';

export default function Home() {
  const { messages, phase } = useStore(chatStore);

  // Esc stops generation no matter where the focus is.
  useEffect(() => {
    if (phase === 'idle') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        chatStore.stop();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase]);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Bot className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
            </span>
            <h1 className="text-base font-semibold tracking-tight">AI Чат</h1>
          </div>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => chatStore.clear()}
              disabled={phase !== 'idle'}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
              Новый чат
            </button>
          )}
        </div>
      </header>

      <main className="min-h-0 flex-1">
        <MessageList />
      </main>

      <Composer />
    </div>
  );
}
