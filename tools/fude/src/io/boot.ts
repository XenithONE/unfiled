// 起動: 前回の続き（自動保存）があれば開き、なければ新しいキャンバス。
import type { Studio } from "../engine/studio";
import { restoreLatest, startAutosave } from "./autosave";
import { playFromUrl } from "../ai/share";
import { startTimelapse } from "./timelapse";

export const DEFAULT_SIZE = { w: 2000, h: 1500 };

export async function boot(s: Studio): Promise<void> {
  const params = new URLSearchParams(location.search);
  let restored = false;
  if (!params.has("new") && !params.has("play")) {
    try {
      restored = await restoreLatest(s);
    } catch (e) {
      console.warn("restore failed", e);
    }
  }
  if (!restored) {
    const w = Number(params.get("w")) || DEFAULT_SIZE.w;
    const h = Number(params.get("h")) || DEFAULT_SIZE.h;
    s.newDocument(w, h);
  }
  startAutosave(s);
  startTimelapse(s);
  if (params.has("play")) void playFromUrl(s, params.get("play")!);
}
