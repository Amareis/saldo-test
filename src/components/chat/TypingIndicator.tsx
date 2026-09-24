export function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 px-1 py-2" role="status" aria-label="Модель печатает">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden="true"
          className="h-2 w-2 rounded-full bg-muted-foreground/60 animate-bounce"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
      <span className="sr-only">Модель печатает…</span>
    </div>
  );
}
