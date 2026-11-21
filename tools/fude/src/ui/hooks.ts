import { createContext, useCallback, useContext, useSyncExternalStore } from "react";
import type { Topic } from "../engine/events";
import type { Studio } from "../engine/studio";

export const StudioCtx = createContext<Studio | null>(null);

export function useStudio(): Studio {
  const s = useContext(StudioCtx);
  if (!s) throw new Error("Studio がありません");
  return s;
}

/** 指定した話題が変わったら描き直す。 */
export function useTopics(...topics: Topic[]): number {
  const s = useStudio();
  const key = topics.join(",");
  const subscribe = useCallback(
    (cb: () => void) => {
      const offs = key.split(",").map((t) => s.ev.on(t as Topic, cb));
      return () => offs.forEach((f) => f());
    },
    [s, key],
  );
  const get = useCallback(() => key.split(",").reduce((a, t) => a + s.ev.version(t as Topic), 0), [s, key]);
  return useSyncExternalStore(subscribe, get);
}
