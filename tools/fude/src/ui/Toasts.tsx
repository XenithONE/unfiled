import { useStudio, useTopics } from "./hooks";

export function Toasts() {
  const s = useStudio();
  useTopics("status");
  return (
    <div className="toasts" role="status" aria-live="polite">
      {s.toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
