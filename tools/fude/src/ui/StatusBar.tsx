import { autosaveStatus } from "../io/autosave";
import { useStudio, useTopics } from "./hooks";

const SAVE: Record<string, string> = { idle: "", pending: "未保存の変更", saving: "保存しています…", saved: "ブラウザに保存しました", error: "保存できませんでした" };

export function StatusBar() {
  const s = useStudio();
  useTopics("view", "doc", "status", "history", "layers");
  const v = s.view;
  const deg = Math.round((((v.rot * 180) / Math.PI) % 360 + 540) % 360 - 180);
  return (
    <footer className="statusbar">
      <span>
        {s.doc.w} × {s.doc.h}
      </span>
      <span>{Math.round(v.zoom * 100)}%</span>
      {deg !== 0 && <span>{deg}°</span>}
      {v.flip && <span className="warn">左右反転表示</span>}
      {s.symmetry.enabled && <span>対称定規</span>}
      {s.perspective.enabled && <span>パース定規</span>}
      {s.doc.editMask && <span className="warn">マスクを編集中</span>}
      <span className="grow" />
      <span>{SAVE[autosaveStatus]}</span>
      <span title="GPU のメモリ（取り消しの記録を含む）">{s.memoryMB()} MB</span>
    </footer>
  );
}
