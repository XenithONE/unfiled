import { X } from "lucide-react";
import { useState, type ComponentType, type ReactNode } from "react";
import { BLEND_MODES } from "../engine/blend";
import { GRAIN_IDS, GRAIN_NAMES, PRESET_HINTS, TIP_IDS, TIP_NAMES, type BrushSettings } from "../engine/brush/presets";
import { ACTIONS, TOOL_KEYS } from "./actions";
import { Segmented, Select, Slider, Toggle } from "./controls";
import { useStudio, useTopics } from "./hooks";
import { TOOL_LIST } from "./Toolbar";

const REGISTRY: Record<string, ComponentType<{ data?: unknown }>> = {};
export function registerDialog(id: string, c: ComponentType<{ data?: unknown }>): void {
  REGISTRY[id] = c;
}

export function Dialogs() {
  const s = useStudio();
  useTopics("ui");
  const d = s.ui.dialog;
  if (!d) return null;
  const C = REGISTRY[d.id];
  if (!C) return null;
  return <C data={d.data} />;
}

export function Dialog(p: { title: string; children: ReactNode; footer?: ReactNode; wide?: boolean; onClose?: () => void; className?: string }) {
  const s = useStudio();
  const close = p.onClose ?? (() => s.closeDialog());
  return (
    <div className="dialog-back" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className={`dialog${p.wide ? " dialog--wide" : ""} ${p.className ?? ""}`} role="dialog" aria-modal="true" aria-label={p.title}>
        <header className="dialog-head">
          <h2>{p.title}</h2>
          <button type="button" className="icon-btn" aria-label="閉じる" onClick={close}>
            <X size={16} />
          </button>
        </header>
        <div className="dialog-body">{p.children}</div>
        {p.footer && <footer className="dialog-foot">{p.footer}</footer>}
      </div>
    </div>
  );
}

const SIZES: { name: string; w: number; h: number }[] = [
  { name: "標準（4:3）", w: 2000, h: 1500 },
  { name: "横長 16:9（フル HD）", w: 1920, h: 1080 },
  { name: "横長 16:9（2K）", w: 2560, h: 1440 },
  { name: "正方形", w: 2048, h: 2048 },
  { name: "縦長 SNS（4:5）", w: 1600, h: 2000 },
  { name: "スマホの壁紙（9:16）", w: 1440, h: 2560 },
  { name: "A4 縦（200dpi）", w: 1654, h: 2339 },
  { name: "A4 縦（300dpi）", w: 2480, h: 3508 },
  { name: "B5 漫画原稿（350dpi・仕上がり）", w: 2508, h: 3541 },
  { name: "はがき（300dpi）", w: 1181, h: 1748 },
  { name: "アイコン", w: 1024, h: 1024 },
  { name: "小さめ（軽い）", w: 1200, h: 900 },
];

function NewCanvasDialog() {
  const s = useStudio();
  const [w, setW] = useState(s.doc.w);
  const [h, setH] = useState(s.doc.h);
  const [paper, setPaper] = useState("#ffffff");
  const [usePaper, setUsePaper] = useState(true);
  const [name, setName] = useState("無題");
  const max = Math.min(8192, s.g.maxTex);
  const mb = Math.round((w * h * 4) / (1024 * 1024));
  return (
    <Dialog
      title="新しいキャンバス"
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
              s.newDocument(w, h, { paper: usePaper ? paper : null, name });
              s.toast("新しいキャンバスを作りました（前の作品はファイル › 作品一覧から開けます）");
            }}
          >
            作る
          </button>
        </>
      }
    >
      <label className="field">
        <span>作品名</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="size-presets">
        {SIZES.map((p) => (
          <button
            key={p.name}
            type="button"
            className={`chip-btn${p.w === w && p.h === h ? " is-on" : ""}`}
            onClick={() => {
              setW(p.w);
              setH(p.h);
            }}
          >
            {p.name}
            <small>
              {p.w}×{p.h}
            </small>
          </button>
        ))}
      </div>
      <div className="field-row">
        <label className="field">
          <span>幅</span>
          <input type="number" min={16} max={max} value={w} onChange={(e) => setW(Math.max(16, Math.min(max, Number(e.target.value) || 16)))} />
        </label>
        <button type="button" className="btn btn--ghost" title="縦と横を入れ替え" onClick={() => [setW(h), setH(w)]}>
          ⇄
        </button>
        <label className="field">
          <span>高さ</span>
          <input type="number" min={16} max={max} value={h} onChange={(e) => setH(Math.max(16, Math.min(max, Number(e.target.value) || 16)))} />
        </label>
      </div>
      <div className="field-row">
        <Toggle label="用紙の色" value={usePaper} onChange={setUsePaper} />
        <input type="color" value={paper} onChange={(e) => setPaper(e.target.value)} disabled={!usePaper} aria-label="用紙の色" />
      </div>
      <p className="hint">1 レイヤーあたり約 {mb} MB。大きいキャンバスは端末のメモリを多く使います（最大 {max}×{max}）。</p>
    </Dialog>
  );
}

function BrushDialog({ data }: { data?: unknown }) {
  const s = useStudio();
  useTopics("brush");
  const id = String(data ?? s.currentBrush().id);
  const g = s.brushGroupOf(id);
  const b = s.brushFor(g, id);
  const set = <K extends keyof BrushSettings>(k: K, v: BrushSettings[K]) => {
    const cur = s.brushFor(g, id);
    s.brushes.set(id, { ...cur, [k]: v });
    s.emit("brush");
    s.saveSettingsSoon();
  };
  const [tab, setTab] = useState<"shape" | "dyn" | "tex" | "scatter" | "mix">("shape");
  return (
    <Dialog title={`筆の詳細設定 — ${b.name}`} wide>
      <label className="field">
        <span>名前</span>
        <input value={b.name} onChange={(e) => set("name", e.target.value)} />
      </label>
      <p className="hint">{PRESET_HINTS[id] ?? ""}</p>
      <Segmented
        value={tab}
        options={[
          { value: "shape", label: "形" },
          { value: "dyn", label: "筆圧・入り抜き" },
          { value: "tex", label: "紙の目" },
          { value: "scatter", label: "散布・色の揺らぎ" },
          { value: "mix", label: "混色・水彩" },
        ]}
        onChange={setTab}
      />
      <div className="brush-grid">
        {tab === "shape" && (
          <>
            <Select label="描き方" value={b.engine} options={[{ value: "stamp", label: "ふつう（重ねる）" }, { value: "water", label: "水彩（混色・縁）" }, { value: "mix", label: "油彩（下の絵の具を引きずる）" }, { value: "smudge", label: "指先（こする）" }, { value: "blur", label: "ぼかし" }]} onChange={(v) => set("engine", v)} />
            <Select label="筆先" value={b.tip} options={TIP_IDS.map((t) => ({ value: t, label: TIP_NAMES[t] }))} onChange={(v) => set("tip", v)} />
            <Slider label="大きさ" value={b.size} min={1} max={1000} log unit="px" onChange={(v) => set("size", v)} />
            <Slider label="硬さ" value={b.hardness} min={0} max={1} onChange={(v) => set("hardness", v)} />
            <Slider label="不透明度" value={b.opacity} min={0} max={1} onChange={(v) => set("opacity", v)} />
            <Slider label="濃度（流量）" value={b.flow} min={0.01} max={1} onChange={(v) => set("flow", v)} />
            <Slider label="間隔" value={b.spacing} min={0.02} max={2} step={0.01} digits={2} onChange={(v) => set("spacing", v)} title="大きさに対する判子の間隔" />
            <Slider label="つぶれ" value={b.roundness} min={0.05} max={1} onChange={(v) => set("roundness", v)} />
            <Slider label="角度" value={b.angle} min={-180} max={180} step={1} unit="°" onChange={(v) => set("angle", v)} />
            <Select label="向き" value={b.angleMode} options={[{ value: "fixed", label: "固定" }, { value: "direction", label: "進む向き" }, { value: "random", label: "ランダム" }, { value: "tilt", label: "ペンの傾き" }]} onChange={(v) => set("angleMode", v)} />
            <Slider label="角度の揺らぎ" value={b.angleJitter} min={0} max={180} step={1} unit="°" onChange={(v) => set("angleJitter", v)} />
            <Select label="重ね方" value={b.accumulate} options={[{ value: "max", label: "一筆の中では濃くならない" }, { value: "over", label: "重ねるほど濃くなる" }]} onChange={(v) => set("accumulate", v)} />
            <Select label="合成モード" value={b.blend} options={BLEND_MODES.map((m) => ({ value: m.id, label: m.name }))} onChange={(v) => set("blend", v)} />
            <Toggle label="消しゴムとして描く" value={b.erase} onChange={(v) => set("erase", v)} />
          </>
        )}
        {tab === "dyn" && (
          <>
            <Toggle label="筆圧で太さを変える" value={b.sizePressure} onChange={(v) => set("sizePressure", v)} />
            <Slider label="最小の太さ" value={b.sizeMin} min={0} max={1} onChange={(v) => set("sizeMin", v)} />
            <Toggle label="筆圧で不透明度を変える" value={b.opacityPressure} onChange={(v) => set("opacityPressure", v)} />
            <Slider label="最小の不透明度" value={b.opacityMin} min={0} max={1} onChange={(v) => set("opacityMin", v)} />
            <Toggle label="筆圧で濃度を変える" value={b.flowPressure} onChange={(v) => set("flowPressure", v)} />
            <Slider label="最小の濃度" value={b.flowMin} min={0} max={1} onChange={(v) => set("flowMin", v)} />
            <Slider label="入り" value={b.taperIn} min={0} max={20} step={0.1} digits={1} unit="×" onChange={(v) => set("taperIn", v)} title="描き始めを細くする長さ（大きさの何倍か）" />
            <Slider label="抜き" value={b.taperOut} min={0} max={20} step={0.1} digits={1} unit="×" onChange={(v) => set("taperOut", v)} title="描き終わりを細くする長さ（大きさの何倍か）" />
            <Slider label="速さで細く" value={b.velocityThin} min={0} max={1} onChange={(v) => set("velocityThin", v)} />
            <Slider label="手ブレ補正" value={b.stabilize} min={0} max={100} step={1} onChange={(v) => set("stabilize", v)} />
          </>
        )}
        {tab === "tex" && (
          <>
            <Select label="紙の目" value={b.grain} options={GRAIN_IDS.map((t) => ({ value: t, label: GRAIN_NAMES[t] }))} onChange={(v) => set("grain", v)} />
            <Slider label="紙の目の強さ" value={b.grainStrength} min={0} max={1} onChange={(v) => set("grainStrength", v)} />
            <Slider label="紙の目の大きさ" value={b.grainScale} min={0.25} max={4} step={0.05} digits={2} unit="×" onChange={(v) => set("grainScale", v)} />
          </>
        )}
        {tab === "scatter" && (
          <>
            <Slider label="粒の大きさ" value={b.particle} min={0} max={1} step={0.01} digits={2} onChange={(v) => set("particle", v)} title="0 で通常の筆。0 より大きいと、筆の円の中に粒を散らす" />
            <Slider label="粒の数" value={b.count} min={1} max={30} step={1} onChange={(v) => set("count", v)} />
            <Slider label="大きさの揺らぎ" value={b.sizeJitter} min={0} max={1} onChange={(v) => set("sizeJitter", v)} />
            <Slider label="不透明度の揺らぎ" value={b.opacityJitter} min={0} max={1} onChange={(v) => set("opacityJitter", v)} />
            <Slider label="色相の揺らぎ" value={b.hueJitter} min={0} max={1} onChange={(v) => set("hueJitter", v)} />
            <Slider label="彩度の揺らぎ" value={b.satJitter} min={0} max={1} onChange={(v) => set("satJitter", v)} />
            <Slider label="明度の揺らぎ" value={b.valJitter} min={0} max={1} onChange={(v) => set("valJitter", v)} />
          </>
        )}
        {tab === "mix" && (
          <>
            <Slider label={b.engine === "mix" ? "絵の具の量" : "色延び（混色）"} value={b.mixAmount} min={0} max={1} onChange={(v) => set("mixAmount", v)} />
            <Slider label="色の拾いやすさ" value={b.pickup} min={0} max={1} onChange={(v) => set("pickup", v)} />
            <Slider label="指先・ぼかしの強さ" value={b.strength} min={0} max={1} onChange={(v) => set("strength", v)} />
            <Slider label="水彩の縁" value={b.wetEdge} min={0} max={1} onChange={(v) => set("wetEdge", v)} />
            <Slider label="絵の具が尽きる長さ" value={b.paintLoad} min={0} max={5000} step={10} unit="px" onChange={(v) => set("paintLoad", v)} title="0 で尽きない" />
          </>
        )}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn--ghost" onClick={() => s.resetBrush(id)}>
          初期設定に戻す
        </button>
      </div>
    </Dialog>
  );
}

function HelpDialog() {
  const rows: [string, string][] = [];
  for (const t of TOOL_LIST) rows.push([t.key, t.name]);
  const acts = Object.values(ACTIONS).filter((a) => a.key);
  return (
    <Dialog title="操作の一覧" wide>
      <div className="help-cols">
        <section>
          <h3>道具</h3>
          <dl className="keys">
            {rows.map(([k, n]) => (
              <div key={n}>
                <dt>{k}</dt>
                <dd>{n}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <h3>操作</h3>
          <dl className="keys">
            {acts.map((a) => (
              <div key={a.label}>
                <dt>{a.key}</dt>
                <dd>{a.label}</dd>
              </div>
            ))}
            <div>
              <dt>Space＋ドラッグ</dt>
              <dd>表示を動かす</dd>
            </div>
            <div>
              <dt>Ctrl＋Space＋ドラッグ</dt>
              <dd>拡大・縮小</dd>
            </div>
            <div>
              <dt>R＋ドラッグ</dt>
              <dd>表示を回す</dd>
            </div>
            <div>
              <dt>Alt（筆を使っている時）</dt>
              <dd>スポイト</dd>
            </div>
            <div>
              <dt>Shift＋クリック</dt>
              <dd>前の線の終わりから直線</dd>
            </div>
            <div>
              <dt>ホイール</dt>
              <dd>拡大・縮小（Alt で回転）</dd>
            </div>
            <div>
              <dt>指 2 本</dt>
              <dd>移動・拡大・回転。トンと叩くと取り消し（3 本でやり直し）</dd>
            </div>
          </dl>
        </section>
      </div>
      <p className="hint">道具のキー: {Object.entries(TOOL_KEYS).map(([k, v]) => `${k.toUpperCase()}＝${TOOL_LIST.find((t) => t.id === v)?.name ?? v}`).join("、")}</p>
    </Dialog>
  );
}

function AboutDialog() {
  return (
    <Dialog title="FUDE について">
      <p className="lead">人も、AIも、同じ筆で。</p>
      <p>FUDE はブラウザで動くお絵描きツールです。ペン・鉛筆・水彩・油彩・エアブラシ・デコレーション、28 の合成モードのレイヤー、選択範囲、塗りつぶし、変形、定規、フィルターを備えています。描いた絵はこの端末のブラウザの中だけに保存され、どこにも送られません。</p>
      <p>AI にも同じ筆で描かせられます。メニューの「AI」から、AI への指示をコピーして AI のチャットに貼り、返ってきた「台本」を貼り付けると、筆の動きが 1 本ずつ再生されます。ブラウザを操作できる AI は <code>window.fude</code> を直接使えます。</p>
      <p>筆先・紙の目の模様はすべてその場でコードから作っています。素材ファイルや外部への通信はありません。</p>
      <p>
        <a href="../../">← UNFILED に戻る</a>
      </p>
    </Dialog>
  );
}

function PressureDialog() {
  const s = useStudio();
  useTopics("brush");
  const [g, setG] = useState(s.pressureGamma);
  const pts: string[] = [];
  for (let i = 0; i <= 20; i++) {
    const x = i / 20;
    pts.push(`${x * 200},${200 - Math.pow(x, g) * 200}`);
  }
  return (
    <Dialog title="筆圧の調整">
      <svg viewBox="0 0 200 200" className="curve" aria-label="筆圧の曲線">
        <rect x="0" y="0" width="200" height="200" className="curve-bg" />
        <polyline points={pts.join(" ")} className="curve-line" />
      </svg>
      <Slider
        label="筆圧の強さ"
        value={g}
        min={0.3}
        max={3}
        step={0.05}
        digits={2}
        onChange={(v) => {
          setG(v);
          s.pressureGamma = v;
          s.saveSettingsSoon();
        }}
        title="1 より小さいと軽い筆圧でも濃く・太く、1 より大きいと強く押した時だけ濃く・太くなります"
      />
      <p className="hint">軽い筆圧でしっかり描きたい時は左へ、強弱をはっきりさせたい時は右へ。</p>
    </Dialog>
  );
}

function ColorDialog() {
  const s = useStudio();
  useTopics("color");
  return (
    <Dialog title="描画色">
      <input type="color" className="color-native" value={s.colors.main} onChange={(e) => s.setColor(e.target.value)} aria-label="描画色" />
      <p className="hint">細かい調整は右のカラーパネルで。</p>
    </Dialog>
  );
}

function NumberDialog({ data }: { data?: unknown }) {
  const s = useStudio();
  const o = data as { title: string; label: string; value: number; min: number; max: number; unit?: string; run: (v: number) => void };
  const [v, setV] = useState(o.value);
  const ok = () => {
    s.closeDialog();
    o.run(v);
  };
  return (
    <Dialog
      title={o.title}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={() => s.closeDialog()}>
            やめる
          </button>
          <button type="button" className="btn btn--primary" onClick={ok}>
            OK
          </button>
        </>
      }
    >
      <Slider label={o.label} value={v} min={o.min} max={o.max} step={1} unit={o.unit} onChange={setV} />
    </Dialog>
  );
}

registerDialog("number", NumberDialog);
registerDialog("new", NewCanvasDialog);
registerDialog("brush", BrushDialog);
registerDialog("help", HelpDialog);
registerDialog("about", AboutDialog);
registerDialog("pressure", PressureDialog);
registerDialog("color", ColorDialog);
