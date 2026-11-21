// キャンバスの大きさ・画像の大きさ・回転の小窓と、レイヤーの設定。
import { useState } from "react";
import { resizeCanvas, resizeImage, rotateCanvas } from "../engine/canvasOps";
import type { Studio } from "../engine/studio";
import { saveBackup } from "../io/autosave";
import { exportTimelapse, timelapse } from "../io/timelapse";
import { registerAction } from "./actions";
import { Slider, Toggle } from "./controls";
import { Dialog, registerDialog } from "./Dialogs";
import { useStudio, useTopics } from "./hooks";

async function withBackup(s: Studio, label: string, fn: () => void): Promise<void> {
  try {
    await saveBackup(s, `${s.doc.name}（${label}の前）`);
  } catch {
    /* 保存できない環境でも続ける */
  }
  fn();
  s.toast(`${label}しました（元の絵は作品一覧に残してあります）`);
}

function CanvasSizeDialog() {
  const s = useStudio();
  const d = s.doc;
  const [w, setW] = useState(d.w);
  const [h, setH] = useState(d.h);
  const [anchor, setAnchor] = useState<[number, number]>([0.5, 0.5]);
  const max = Math.min(8192, s.g.maxTex);
  return (
    <Dialog
      title="キャンバスの大きさを変える"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={() => s.closeDialog()}>
            やめる
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              s.closeDialog();
              void withBackup(s, "キャンバスの大きさを変更", () => resizeCanvas(s, w, h, anchor[0], anchor[1]));
            }}
          >
            変える
          </button>
        </>
      }
    >
      <p className="hint">絵の大きさはそのままで、紙だけを広げたり切ったりします。この操作は取り消せないので、元の絵のコピーを作品一覧に残します。</p>
      <div className="field-row">
        <label className="field">
          <span>幅</span>
          <input type="number" min={16} max={max} value={w} onChange={(e) => setW(Math.max(16, Math.min(max, Number(e.target.value) || 16)))} />
        </label>
        <label className="field">
          <span>高さ</span>
          <input type="number" min={16} max={max} value={h} onChange={(e) => setH(Math.max(16, Math.min(max, Number(e.target.value) || 16)))} />
        </label>
      </div>
      <div className="anchor" role="radiogroup" aria-label="基準の位置">
        {[0, 0.5, 1].map((ay) =>
          [0, 0.5, 1].map((ax) => (
            <button key={`${ax}-${ay}`} type="button" role="radio" aria-checked={anchor[0] === ax && anchor[1] === ay} className={anchor[0] === ax && anchor[1] === ay ? "on" : ""} onClick={() => setAnchor([ax, ay])} />
          )),
        )}
      </div>
      <p className="hint">点は「今の絵をどこに寄せるか」です。</p>
    </Dialog>
  );
}

function ImageSizeDialog() {
  const s = useStudio();
  const d = s.doc;
  const [w, setW] = useState(d.w);
  const [h, setH] = useState(d.h);
  const [keep, setKeep] = useState(true);
  const max = Math.min(8192, s.g.maxTex);
  return (
    <Dialog
      title="画像の大きさを変える（拡大・縮小）"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={() => s.closeDialog()}>
            やめる
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              s.closeDialog();
              void withBackup(s, "画像の大きさを変更", () => resizeImage(s, w, h));
            }}
          >
            変える
          </button>
        </>
      }
    >
      <div className="field-row">
        <label className="field">
          <span>幅</span>
          <input
            type="number"
            min={16}
            max={max}
            value={w}
            onChange={(e) => {
              const v = Math.max(16, Math.min(max, Number(e.target.value) || 16));
              setW(v);
              if (keep) setH(Math.round((v * d.h) / d.w));
            }}
          />
        </label>
        <label className="field">
          <span>高さ</span>
          <input
            type="number"
            min={16}
            max={max}
            value={h}
            onChange={(e) => {
              const v = Math.max(16, Math.min(max, Number(e.target.value) || 16));
              setH(v);
              if (keep) setW(Math.round((v * d.w) / d.h));
            }}
          />
        </label>
      </div>
      <Toggle label="縦横の比を保つ" value={keep} onChange={setKeep} />
      <div className="btn-grid btn-grid--3">
        {[0.5, 2, 1.5].map((k) => (
          <button
            key={k}
            type="button"
            className="btn btn--small"
            onClick={() => {
              setW(Math.min(max, Math.round(d.w * k)));
              setH(Math.min(max, Math.round(d.h * k)));
            }}
          >
            {k * 100}%
          </button>
        ))}
      </div>
      <p className="hint">取り消せないので、元の絵のコピーを作品一覧に残します。</p>
    </Dialog>
  );
}

function RotateDialog() {
  const s = useStudio();
  const go = (k: "cw" | "ccw" | "180" | "flipH" | "flipV", label: string) => {
    s.closeDialog();
    void withBackup(s, label, () => rotateCanvas(s, k));
  };
  return (
    <Dialog title="キャンバスの回転・反転">
      <div className="btn-grid">
        <button type="button" className="btn" onClick={() => go("cw", "右へ 90° 回転")}>
          右へ 90°
        </button>
        <button type="button" className="btn" onClick={() => go("ccw", "左へ 90° 回転")}>
          左へ 90°
        </button>
        <button type="button" className="btn" onClick={() => go("180", "180° 回転")}>
          180°
        </button>
        <button type="button" className="btn" onClick={() => go("flipH", "左右反転")}>
          左右反転
        </button>
        <button type="button" className="btn" onClick={() => go("flipV", "上下反転")}>
          上下反転
        </button>
      </div>
      <p className="hint">絵そのものを回します（表示だけを回すには R キーやナビゲーター）。取り消せないので、元の絵のコピーを作品一覧に残します。</p>
    </Dialog>
  );
}

function LayerPropsDialog() {
  const s = useStudio();
  useTopics("layers");
  const l = s.doc.active;
  const [tintOn, setTintOn] = useState(!!l?.props.tint);
  const [tint, setTint] = useState(l?.props.tint ?? "#2f6fdd");
  if (!l) return null;
  return (
    <Dialog title={`レイヤーの設定 — ${l.props.name}`}>
      <Slider label="不透明度" value={l.props.opacity} min={0} max={1} onChange={(v) => s.setLayerPropsLive(l.id, { opacity: v })} />
      <Toggle
        label="レイヤーカラー（線を一色で表示・下描き向け）"
        value={tintOn}
        onChange={(v) => {
          setTintOn(v);
          s.setLayerProps(l.id, { tint: v ? tint : null }, "レイヤーカラー");
        }}
      />
      {tintOn && (
        <input
          type="color"
          value={tint}
          aria-label="レイヤーカラー"
          onChange={(e) => {
            setTint(e.target.value);
            s.setLayerPropsLive(l.id, { tint: e.target.value });
          }}
        />
      )}
      <p className="hint">フチ（境界効果）は「フィルター › フチ（境界効果）」で付けられます。</p>
    </Dialog>
  );
}


function TimelapseDialog() {
  const s = useStudio();
  const [sec, setSec] = useState(20);
  const [rec, setRec] = useState(timelapse.enabled);
  const [busy, setBusy] = useState<number | null>(null);
  const n = timelapse.docId === s.doc.docId ? timelapse.frames.length : 0;
  return (
    <Dialog
      title="タイムラプス"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={() => s.closeDialog()}>
            閉じる
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy !== null || n < 2}
            onClick={async () => {
              setBusy(0);
              await exportTimelapse(s, sec, (p) => setBusy(p));
              setBusy(null);
            }}
          >
            {busy !== null ? `作っています… ${Math.round(busy * 100)}%` : "動画にする"}
          </button>
        </>
      }
    >
      <p>描くたびに小さなコマを記録しています（この画面を開いている間だけ・今の絵で {n} コマ）。描いた過程を動画で書き出せます。</p>
      <Toggle
        label="記録する"
        value={rec}
        onChange={(v) => {
          setRec(v);
          timelapse.enabled = v;
        }}
      />
      <Slider label="動画の長さ" value={sec} min={5} max={90} step={1} unit="秒" onChange={setSec} />
      <p className="hint">書き出しは実際の長さだけ時間がかかります（{sec} 秒ほど）。その間はこの画面をそのままにしてください。</p>
    </Dialog>
  );
}

registerDialog("timelapse", TimelapseDialog);
registerDialog("canvasSize", CanvasSizeDialog);
registerDialog("imageSize", ImageSizeDialog);
registerDialog("rotateCanvas", RotateDialog);
registerDialog("layerProps", LayerPropsDialog);
registerAction("canvasSize", { label: "キャンバスの大きさ…", run: (s) => s.openDialog("canvasSize") });
registerAction("imageSize", { label: "画像の大きさ（拡大・縮小）…", run: (s) => s.openDialog("imageSize") });
registerAction("rotateCanvas", { label: "キャンバスの回転・反転…", run: (s) => s.openDialog("rotateCanvas") });
registerAction("layerProps", { label: "レイヤーの設定…", run: (s) => s.openDialog("layerProps") });
