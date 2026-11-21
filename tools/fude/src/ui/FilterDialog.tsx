// フィルター・色調補正の小窓。キャンバスを隠さず、動かすとすぐ結果が見える。
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { applyFilterNow, FILTERS, FilterSession, GRADIENT_MAPS } from "../engine/filters";
import type { Studio } from "../engine/studio";
import { registerAction } from "./actions";
import { Slider } from "./controls";
import { registerDialog } from "./Dialogs";
import { useStudio } from "./hooks";

function FilterPanel({ data }: { data?: unknown }) {
  const s = useStudio();
  const id = String(data);
  const def = FILTERS.find((f) => f.id === id);
  const sess = useRef<FilterSession | null>(null);
  const [vals, setVals] = useState<Record<string, number>>(() => Object.fromEntries((def?.params ?? []).map((p) => [p.key, p.def])));
  const [gm, setGm] = useState(0);
  const [color, setColor] = useState("#ffffff");
  const raf = useRef(0);
  useEffect(() => {
    const fs = FilterSession.begin(s, id);
    sess.current = fs;
    if (!fs) s.closeDialog();
    return () => {
      // 閉じた（Esc・×）ときは取り消し
      sess.current?.cancel();
      sess.current = null;
    };
  }, [s, id]);
  useEffect(() => {
    cancelAnimationFrame(raf.current);
    const run = () => sess.current?.update(vals, def?.colors === "gradient" ? GRADIENT_MAPS[gm].stops : def?.colors === "single" ? [color] : []);
    raf.current = requestAnimationFrame(run);
    const t = setTimeout(run, 40);
    return () => {
      cancelAnimationFrame(raf.current);
      clearTimeout(t);
    };
  }, [vals, gm, color, def]);
  if (!def) return null;
  const ok = () => {
    const fs = sess.current;
    sess.current = null;
    fs?.update(vals, def.colors === "gradient" ? GRADIENT_MAPS[gm].stops : def.colors === "single" ? [color] : []);
    fs?.commit();
    s.closeDialog();
  };
  return (
    <div className="float-panel" role="dialog" aria-label={def.name}>
      <header className="dialog-head">
        <h2>{def.name}</h2>
        <button type="button" className="icon-btn" aria-label="やめる" onClick={() => s.closeDialog()}>
          <X size={16} />
        </button>
      </header>
      <div className="dialog-body">
        {s.doc.selection && <p className="hint">選択範囲の中だけに効きます。</p>}
        {def.params.map((p) => (
          <Slider key={p.key} label={p.label} value={vals[p.key]} min={p.min} max={p.max} step={p.step} unit={p.unit} digits={p.step < 1 ? 2 : 0} onChange={(v) => setVals((o) => ({ ...o, [p.key]: v }))} />
        ))}
        {def.colors === "gradient" && (
          <div className="gmaps">
            {GRADIENT_MAPS.map((g, i) => (
              <button key={g.name} type="button" className={`gmap${i === gm ? " is-on" : ""}`} onClick={() => setGm(i)} title={g.name}>
                <span style={{ background: `linear-gradient(90deg, ${g.stops.join(",")})` }} />
                {g.name}
              </button>
            ))}
          </div>
        )}
        {def.colors === "single" && (
          <label className="field-row">
            <span>色</span>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            <button type="button" className="btn btn--ghost btn--small" onClick={() => setColor(s.colors.main)}>
              描画色
            </button>
          </label>
        )}
        {def.params.length === 0 && !def.colors && <p className="hint">設定はありません。OK で適用します。</p>}
      </div>
      <footer className="dialog-foot">
        <button type="button" className="btn btn--ghost" onClick={() => s.closeDialog()}>
          やめる
        </button>
        <button type="button" className="btn btn--primary" onClick={ok}>
          OK
        </button>
      </footer>
    </div>
  );
}

registerDialog("filter", FilterPanel);

const ALIAS: Record<string, string> = {
  gaussian: "blur",
  gaussian_blur: "blur",
  motion: "motion_blur",
  zoom_blur: "radial_blur",
  radial: "radial_blur",
  hue: "hsl",
  hue_saturation: "hsl",
  saturation: "hsl",
  brightness_contrast: "brightness",
  contrast: "brightness",
  balance: "color_balance",
  colorbalance: "color_balance",
  gradientmap: "gradient_map",
  map: "gradient_map",
  luma: "luma_to_alpha",
  white_to_alpha: "luma_to_alpha",
  line: "lineart",
  line_art: "lineart",
  border: "outline",
  edge: "outline",
  bloom: "glow",
  pixelate: "mosaic",
  grain: "noise",
  aberration: "chromatic",
  chromatic_aberration: "chromatic",
  unsharp: "sharpen",
};

export function registerFilterActions(s: Studio): void {
  for (const f of FILTERS) registerAction(`f:${f.id}`, { label: `${f.name}…`, run: (st) => st.openDialog("filter", f.id) });
  s.ext.applyFilter = (type: string, params: Record<string, unknown>) => {
    const t = type.toLowerCase().replace(/[\s-]/g, "_");
    const id = FILTERS.some((f) => f.id === t) ? t : ALIAS[t];
    if (!id) throw new Error(`効果「${type}」はありません`);
    // AI の書き方の揺れ（hue: 20 → hsl の hue）を吸収
    const p = { ...params };
    if (id === "hsl" && typeof p.saturation === "number" && Math.abs(p.saturation as number) > 1) p.saturation = (p.saturation as number) / 100;
    if (id === "brightness" && typeof p.brightness === "number" && Math.abs(p.brightness as number) > 1) p.brightness = (p.brightness as number) / 100;
    applyFilterNow(s, id, p);
  };
}
