import { useEffect, useRef } from 'react';
import { chatStore } from '@/stores/chat-store';
import { useStore } from '@/lib/use-store';
import { ChatMessageItem } from './ChatMessage';
import { TypingIndicator } from './TypingIndicator';
import { EmptyState } from './EmptyState';

export function MessageList() {
  const { messages, phase } = useStore(chatStore);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Don't yank the scroll if the user scrolled up to read — only follow
  // the stream while they're near the bottom.
  const nearBottomRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && nearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, phase]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  if (messages.length === 0) {
    return (
      <div className="h-full overflow-y-auto">
        <EmptyState onSuggestion={(text) => chatStore.setDraft(text)} />
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="h-full overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      tabIndex={0}
      role="region"
      aria-label="История диалога"
    >
      <ul role="log" aria-live="polite" aria-label="Сообщения" className="mx-auto flex w-full max-w-3xl flex-col gap-3.5 px-3 py-4 sm:gap-4 sm:px-4 sm:py-6">
        {messages.map((m) => (
          <ChatMessageItem key={m.id} message={m} />
        ))}
        {phase === 'awaiting' && (
          <li className="flex">
            <TypingIndicator />
          </li>
        )}
      </ul>
    </div>
  );
}
