// 作品一覧（このブラウザに保存された絵）。
import { Copy, FilePlus2, FolderOpen, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { deleteDoc, listDocs, loadDoc, saveAsCopy, saveDoc, type DocMeta } from "../io/autosave";
import { registerAction } from "./actions";
import { Dialog, registerDialog } from "./Dialogs";
import { useStudio } from "./hooks";

function Thumb({ blob }: { blob: Blob | null }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url ? <img src={url} alt="" /> : <span className="gal-empty">まだ絵がありません</span>;
}

function GalleryDialog() {
  const s = useStudio();
  const [list, setList] = useState<DocMeta[] | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const reload = async () => {
    try {
      await saveDoc(s, true);
    } catch {
      /* 保存できなくても一覧は出す */
    }
    try {
      setList(await listDocs());
    } catch {
      setList([]);
    }
  };
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const fmt = (t: number) => new Date(t).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <Dialog title="作品一覧（このブラウザに保存）" wide>
      <p className="hint">描いた絵はこの端末のブラウザの中だけに自動で保存されます（サーバーには送られません）。ブラウザのデータを消すと消えるので、大事な絵は PSD や PNG でも書き出してください。</p>
      <div className="gal-actions">
        <button type="button" className="btn btn--primary" onClick={() => s.openDialog("new")}>
          <FilePlus2 size={14} /> 新しいキャンバス
        </button>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            await saveAsCopy(s, `${s.doc.name} のコピー`);
            s.emit("doc");
            void reload();
          }}
        >
          <Copy size={14} /> 今の絵を複製
        </button>
      </div>
      {list === null ? (
        <p className="hint">読み込んでいます…</p>
      ) : list.length === 0 ? (
        <p className="hint">保存された作品はまだありません。</p>
      ) : (
        <ul className="gallery">
          {list.map((m) => (
            <li key={m.docId} className={m.docId === s.doc.docId ? "is-on" : ""}>
              <button
                type="button"
                className="gal-open"
                title="開く"
                onClick={async () => {
                  if (m.docId === s.doc.docId) {
                    s.closeDialog();
                    return;
                  }
                  s.closeDialog();
                  if (!(await loadDoc(s, m.docId))) s.toast("開けませんでした", "error");
                }}
              >
                <Thumb blob={m.thumb} />
              </button>
              <div className="gal-meta">
                <strong title={m.name}>{m.name}</strong>
                <span>
                  {m.w}×{m.h} · {fmt(m.updated)}
                </span>
              </div>
              <div className="gal-btns">
                {m.docId === s.doc.docId ? (
                  <span className="gal-now">描いている絵</span>
                ) : confirm === m.docId ? (
                  <>
                    <button
                      type="button"
                      className="btn btn--small btn--danger"
                      onClick={async () => {
                        await deleteDoc(m.docId);
                        setConfirm(null);
                        void reload();
                      }}
                    >
                      消す（戻せません）
                    </button>
                    <button type="button" className="btn btn--small btn--ghost" onClick={() => setConfirm(null)}>
                      やめる
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="icon-btn"
                      title="開く"
                      aria-label="開く"
                      onClick={async () => {
                        s.closeDialog();
                        await loadDoc(s, m.docId);
                      }}
                    >
                      <FolderOpen size={15} />
                    </button>
                    <button type="button" className="icon-btn" title="削除" aria-label="削除" onClick={() => setConfirm(m.docId)}>
                      <Trash2 size={15} />
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

registerDialog("gallery", GalleryDialog);
registerAction("gallery", { label: "作品一覧…", key: "Ctrl+Shift+O", bind: ["ctrl+shift+o"], run: (s) => s.openDialog("gallery") });
