// 小さな通知の仕組み。React からは useSyncExternalStore で購読する。
export type Topic = "doc" | "layers" | "pixels" | "history" | "tool" | "brush" | "color" | "view" | "selection" | "status" | "ai" | "ui";

export class Emitter {
  private subs = new Map<Topic, Set<() => void>>();
  private ver = new Map<Topic, number>();
  private queued = new Set<Topic>();
  private scheduled = false;

  on(topic: Topic, fn: () => void): () => void {
    let s = this.subs.get(topic);
    if (!s) {
      s = new Set();
      this.subs.set(topic, s);
    }
    s.add(fn);
    return () => s!.delete(fn);
  }

  version(topic: Topic): number {
    return this.ver.get(topic) ?? 0;
  }

  /** 同じ瞬間の通知はまとめる（マイクロタスクで 1 回）。 */
  emit(...topics: Topic[]): void {
    for (const t of topics) {
      this.ver.set(t, (this.ver.get(t) ?? 0) + 1);
      this.queued.add(t);
    }
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      const q = [...this.queued];
      this.queued.clear();
      for (const t of q) for (const fn of this.subs.get(t) ?? []) fn();
    });
  }
}
