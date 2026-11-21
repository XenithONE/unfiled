// 「AI に描かせる」パネル。チャットの AI へ渡す指示をコピー → 返事（台本）を貼る → 1 画ずつ再生。
import { Bot, Copy, Link2, Play, Square, X, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { startRun, stopCurrent } from "../ai/api";
import { SAMPLES } from "../ai/samples";
import { parseScript } from "../ai/script";
import { shareUrl } from "../ai/share";
import { apiHelp, buildPrompt } from "../ai/spec";
import { Slider, Toggle, useDebounced } from "./controls";
import { registerDialog } from "./Dialogs";
import { useStudio, useTopics } from "./hooks";
import { registerAction } from "./actions";

const DRAFT_KEY = "fude:ai:draft";
function loadDraft(): { req: string; script: string } {
  try {
    const v = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}");
    return { req: typeof v.req === "string" ? v.req : "", script: typeof v.script === "string" ? v.script : "" };
  } catch {
    return { req: "", script: "" };
  }
}
function saveDraft(v: { req: string; script: string }): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(v));
  } catch {
    /* 覚えられない */
  }
}

async function copyText(t: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    // 古い方法
    const ta = document.createElement("textarea");
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

function AIPanel({ data }: { data?: unknown }) {
  const s = useStudio();
  useTopics("ui", "doc", "layers");
  const draft = useMemo(loadDraft, []);
  const [req, setReq] = useState(draft.req);
  const [script, setScript] = useState(draft.script);
  const [cont, setCont] = useState(false);
  const [newCanvas, setNewCanvas] = useState(true);
  const [speed, setSpeed] = useState(1.5);
  const [progress, setProgress] = useState<{ i: number; n: number } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "samples" | "agent">(((data as { tab?: string } | undefined)?.tab as "chat" | "samples" | "agent") ?? "chat");
  const dScript = useDebounced(script, 250);
  const parsed = useMemo(() => (dScript.trim() ? parseScript(dScript) : null), [dScript]);
  useEffect(() => saveDraft({ req, script }), [req, script]);
  const errors = parsed?.issues.filter((i) => i.level === "error") ?? [];
  const warns = parsed?.issues.filter((i) => i.level === "warn") ?? [];
  const playing = s.ui.aiPlaying;
  const d = s.doc;
  const prompt = () =>
    buildPrompt({
      request: req,
      width: d.w,
      height: d.h,
      layers: d.allLayers().map((l) => l.props.name),
      continuing: cont,
      paper: d.paper.visible ? d.paper.color : null,
    });
  const play = async (animate: boolean, text = script, fresh = newCanvas && !cont) => {
    const p = parseScript(text);
    if (!p.ops.length) {
      s.toast("命令がありません", "warn");
      return;
    }
    setResult(null);
    setProgress({ i: 0, n: p.ops.length });
    const r = await startRun(s, p, animate, speed, fresh && !!(p.canvas || p.size), (i, n) => setProgress({ i, n }));
    setProgress(null);
    if (r.stopped) setResult(`止めました（${r.done} / ${r.total}）`);
    else if (r.errors.length) setResult(`描き終わりました。うまく描けなかった命令が ${r.errors.length} 個あります: ${r.errors.slice(0, 3).join(" / ")}`);
    else setResult(`描き終わりました（${r.total} 個の命令・${(r.ms / 1000).toFixed(1)} 秒）。取り消し（Ctrl+Z）1 回で元に戻せます。`);
  };
  return (
    <div className="ai-panel" role="dialog" aria-label="AI に描かせる">
      <header className="ai-head">
        <Bot size={16} />
        <h2>AI に描かせる</h2>
        <button type="button" className="icon-btn" aria-label="閉じる" onClick={() => s.closeDialog()}>
          <X size={16} />
        </button>
      </header>
      <div className="ai-tabs" role="tablist">
        {(
          [
            ["chat", "チャットの AI"],
            ["samples", "見本"],
            ["agent", "ブラウザを操作する AI"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="ai-body">
        {tab === "chat" && (
          <>
            <section className="ai-step">
              <h3>
                <span className="step">1</span>何を描いてほしい？
              </h3>
              <textarea className="ai-req" rows={3} value={req} placeholder="例: 夕焼けの海辺に立つ灯台。水彩で、空はオレンジから紫へ。" onChange={(e) => setReq(e.target.value)} />
              <Toggle label="今の絵に描き足してもらう" value={cont} onChange={setCont} />
              <button
                type="button"
                className="btn btn--primary btn--wide"
                onClick={async () => {
                  const ok = await copyText(prompt());
                  s.toast(ok ? "AI への指示をコピーしました。チャットに貼り付けて送ってください" : "コピーできませんでした", ok ? "info" : "error");
                }}
              >
                <Copy size={14} /> AI への指示をコピー
              </button>
              <p className="hint">ChatGPT・Claude・Gemini などのチャットに貼り付けて送ると、「台本」（JSON）が返ってきます。{cont ? "続きを頼むときは、メニューの「ファイル › 絵を画像としてコピー」で今の絵も一緒に貼ると伝わりやすくなります。" : ""}</p>
            </section>
            <section className="ai-step">
              <h3>
                <span className="step">2</span>AI の返事を貼り付け
              </h3>
              <textarea className="ai-script" rows={7} spellCheck={false} value={script} placeholder='{"fude":1,"size":[…],"ops":[…]}' onChange={(e) => setScript(e.target.value)} />
              {parsed && (
                <div className={`ai-check${errors.length ? " is-bad" : ""}`}>
                  {errors.length === 0 ? `✓ ${parsed.ops.length} 個の命令${parsed.title ? `「${parsed.title}」` : ""}${warns.length ? `（注意 ${warns.length}）` : ""}` : `エラー ${errors.length} 個`}
                  {(errors.length > 0 || warns.length > 0) && (
                    <ul>
                      {[...errors, ...warns].slice(0, 6).map((i, k) => (
                        <li key={k} className={i.level}>
                          {i.index >= 0 ? `${i.index + 1} 番目（${i.op}）: ` : ""}
                          {i.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  {errors.length > 0 && (
                    <button
                      type="button"
                      className="btn btn--ghost btn--small"
                      onClick={async () => {
                        const msg = `FUDE で読めない所がありました。次の点を直した台本を、JSON だけでもう一度ください。\n${errors.map((i) => `- ${i.index >= 0 ? `${i.index + 1} 番目の命令（${i.op}）: ` : ""}${i.message}`).join("\n")}`;
                        await copyText(msg);
                        s.toast("AI に伝える文をコピーしました");
                      }}
                    >
                      エラーを AI に伝える文をコピー
                    </button>
                  )}
                </div>
              )}
              <Toggle label="台本の大きさで新しいキャンバスを作る" value={newCanvas && !cont} onChange={setNewCanvas} />
              <Slider label="再生の速さ" value={speed} min={0.25} max={8} step={0.25} digits={2} unit="×" onChange={setSpeed} />
              <div className="ai-actions">
                {!playing ? (
                  <>
                    <button type="button" className="btn btn--primary" disabled={!parsed || parsed.ops.length === 0 || errors.some((e) => e.index < 0)} onClick={() => void play(true)}>
                      <Play size={14} /> 描くところを再生
                    </button>
                    <button type="button" className="btn" disabled={!parsed || parsed.ops.length === 0 || errors.some((e) => e.index < 0)} onClick={() => void play(false)}>
                      <Zap size={14} /> すぐ描く
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn" onClick={() => stopCurrent()}>
                    <Square size={14} /> 止める
                  </button>
                )}
                <button
                  type="button"
                  className="icon-btn"
                  title="この台本を再生する共有リンクをコピー"
                  aria-label="共有リンクをコピー"
                  disabled={!parsed || !parsed.ops.length}
                  onClick={async () => {
                    const u = await shareUrl(script);
                    if (u.length > 60000) s.toast("台本が大きすぎてリンクにできません", "warn");
                    else {
                      await copyText(u);
                      s.toast("共有リンクをコピーしました（開くと描くところが再生されます）");
                    }
                  }}
                >
                  <Link2 size={15} />
                </button>
              </div>
              {progress && (
                <div className="ai-progress" aria-label="進み具合">
                  <div style={{ width: `${(progress.i / Math.max(1, progress.n)) * 100}%` }} />
                </div>
              )}
              {result && <p className="hint">{result}</p>}
            </section>
          </>
        )}
        {tab === "samples" && (
          <section className="ai-step">
            <p className="hint">AI（Claude）がこのツールの操作口を使って描いた台本です。新しいキャンバスで再生します。</p>
            {SAMPLES.length === 0 && <p className="hint">見本はまだありません。</p>}
            <ul className="ai-samples">
              {SAMPLES.map((x) => (
                <li key={x.id}>
                  <div>
                    <strong>{x.title}</strong>
                    <span>{x.note}</span>
                  </div>
                  <button type="button" className="btn" disabled={playing} onClick={() => void play(true, JSON.stringify(x.script), true)}>
                    <Play size={14} /> 再生
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title="台本を下書きに写す"
                    aria-label="台本を下書きに写す"
                    onClick={() => {
                      setScript(JSON.stringify(x.script, null, 1));
                      setTab("chat");
                    }}
                  >
                    <Copy size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {tab === "agent" && (
          <section className="ai-step">
            <p className="hint">ブラウザを操作できる AI（Claude in Chrome・Claude Code のブラウザ・Codex など）は、このページの <code>window.fude</code> を直接使えます。台本の書き方はチャット用と同じで、<code>await fude.run(台本)</code> で描き、<code>fude.snapshot()</code> で絵を見て、続きを描けます。</p>
            <button
              type="button"
              className="btn btn--wide"
              onClick={async () => {
                await copyText(apiHelp());
                s.toast("操作口の説明をコピーしました");
              }}
            >
              <Copy size={14} /> 操作口の説明をコピー
            </button>
            <pre className="ai-code">{`await fude.run({
  size: [1600, 1200],
  ops: [
    { op: "layer", name: "空" },
    { op: "gradient", from: [0,0], to: [0,900],
      stops: ["#24345c", "#f6b38a"] },
    { op: "stroke", d: "M200 700 C500 600 900 650 1400 560",
      preset: "gpen", size: 6, color: "#1d1b24" }
  ]
}, { animate: true })`}</pre>
          </section>
        )}
      </div>
    </div>
  );
}

registerDialog("ai", AIPanel);

registerAction("aiPanel", { label: "AI に描かせる…", key: "Ctrl+I", bind: ["ctrl+i"], run: (s) => s.openDialog("ai") });
registerAction("aiCopyPrompt", {
  label: "AI への指示をコピー",
  run: async (s) => {
    const d = s.doc;
    const ok = await copyText(buildPrompt({ request: loadDraft().req, width: d.w, height: d.h, layers: d.allLayers().map((l) => l.props.name), continuing: false, paper: d.paper.visible ? d.paper.color : null }));
    s.toast(ok ? "AI への指示をコピーしました" : "コピーできませんでした", ok ? "info" : "error");
  },
});
registerAction("aiSamples", { label: "AI が描いた見本を再生…", run: (s) => s.openDialog("ai", { tab: "samples" }) });
registerAction("aiApi", { label: "ブラウザを操作する AI 向けの説明", run: (s) => s.openDialog("ai", { tab: "agent" }) });
