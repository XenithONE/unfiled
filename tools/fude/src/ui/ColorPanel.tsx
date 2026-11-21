import { ArrowLeftRight, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { hexToRgb } from "../engine/compositor";
import { hsvToRgb, rgbToHsv } from "../engine/brush/stroke";
import { normHex, rgbToHex } from "../engine/studio";
import { Panel, Segmented, Slider } from "./controls";
import { useStudio, useTopics } from "./hooks";

const PALETTES: Record<string, string[]> = {
  基本: ["#000000", "#3b3b3b", "#7a7a7a", "#b5b5b5", "#e6e6e6", "#ffffff", "#e8303a", "#f26b2e", "#f7b32b", "#f6e44c", "#9bd54a", "#3fb950", "#1fa58a", "#21a9c9", "#2f7fe0", "#4c4fd9", "#7d4fd6", "#c24bc9", "#e9579b", "#8a5a3c", "#c79a6b", "#5b4033", "#2b3a55", "#fa512c"],
  肌と髪: ["#fff1e8", "#fde3d2", "#f8d0b8", "#f0b99c", "#e2a07f", "#c98161", "#a3634a", "#7a4634", "#f7c6c1", "#e99a92", "#2a2228", "#4a3a3a", "#6e4b3a", "#a26b45", "#d9a066", "#f1d38a", "#e7e0d4", "#8f8f9a"],
  空と影: ["#0f1b33", "#1d3461", "#2e5a96", "#4f8fd1", "#89c2f0", "#cfe8fb", "#ffd7a8", "#ff9e7a", "#e4677a", "#8d4f9a", "#3d2d5c", "#6b7b8c", "#a7b4c2", "#5a6e8a", "#3b4a63", "#7f6a93"],
};

const USER_KEY = "fude:palette:v1";
function loadUser(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(USER_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function saveUser(v: string[]): void {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(v));
  } catch {
    /* 覚えられない */
  }
}

export function ColorPanel() {
  const s = useStudio();
  useTopics("color");
  const [hsv, setHsv] = useState<[number, number, number]>(() => rgbToHsv(...hexToRgb(s.colors.main)));
  const last = useRef(s.colors.main);
  const [mode, setMode] = useState<"hsv" | "rgb">("hsv");
  const [pal, setPal] = useState<string>("基本");
  const [user, setUser] = useState<string[]>(loadUser);
  useEffect(() => {
    if (s.colors.main !== last.current) {
      last.current = s.colors.main;
      const n = rgbToHsv(...hexToRgb(s.colors.main));
      // 灰色のときは色相を保つ
      setHsv((h) => (n[1] < 0.001 || n[2] < 0.001 ? [h[0], n[1], n[2]] : n));
    }
  }, [s.colors.main]);
  const apply = (h: [number, number, number]) => {
    setHsv(h);
    const hex = rgbToHex(...hsvToRgb(h[0], h[1], h[2]));
    last.current = hex;
    s.setColor(hex);
  };
  const rgb = hexToRgb(s.colors.main);
  const [hexText, setHexText] = useState(s.colors.main);
  useEffect(() => setHexText(s.colors.main), [s.colors.main]);
  const list = pal === "自分" ? user : PALETTES[pal];
  return (
    <Panel
      title="カラー"
      className="colors"
      right={
        <button type="button" className="icon-btn" title="描画色と背景色を入れ替え（X）" aria-label="描画色と背景色を入れ替え" onClick={() => s.swapColors()}>
          <ArrowLeftRight size={14} />
        </button>
      }
    >
      <Wheel hsv={hsv} onChange={apply} />
      <div className="color-row">
        <div className="swatch-pair">
          <span className="sw sw--sub" style={{ background: s.colors.sub }} title="背景色" />
          <span className={`sw sw--main${s.colors.transparent ? " is-clear" : ""}`} style={{ background: s.colors.transparent ? undefined : s.colors.main }} title="描画色" />
        </div>
        <input
          className="hex"
          value={hexText}
          aria-label="色の番号"
          spellCheck={false}
          onChange={(e) => setHexText(e.target.value)}
          onBlur={() => {
            const h = normHex(hexText);
            if (h) s.setColor(h);
            else setHexText(s.colors.main);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <Segmented
          value={mode}
          options={[
            { value: "hsv", label: "HSV" },
            { value: "rgb", label: "RGB" },
          ]}
          onChange={setMode}
        />
      </div>
      {mode === "hsv" ? (
        <>
          <Slider label="色相" value={Math.round(hsv[0] * 360)} min={0} max={360} step={1} unit="°" onChange={(v) => apply([v / 360, hsv[1], hsv[2]])} />
          <Slider label="彩度" value={Math.round(hsv[1] * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => apply([hsv[0], v / 100, hsv[2]])} />
          <Slider label="明度" value={Math.round(hsv[2] * 100)} min={0} max={100} step={1} unit="%" onChange={(v) => apply([hsv[0], hsv[1], v / 100])} />
        </>
      ) : (
        <>
          {(["R", "G", "B"] as const).map((n, i) => (
            <Slider
              key={n}
              label={n}
              value={Math.round(rgb[i] * 255)}
              min={0}
              max={255}
              step={1}
              onChange={(v) => {
                const c = [...rgb] as [number, number, number];
                c[i] = v / 255;
                s.setColor(rgbToHex(...c));
              }}
            />
          ))}
        </>
      )}
      {s.colorHistory.length > 0 && (
        <div className="swatches swatches--hist" aria-label="使った色">
          {s.colorHistory.slice(0, 16).map((c) => (
            <button key={c} type="button" className="swatch" style={{ background: c }} title={c} onClick={() => s.setColor(c)} />
          ))}
        </div>
      )}
      <div className="palette-head">
        <select value={pal} onChange={(e) => setPal(e.target.value)} aria-label="カラーセット">
          {[...Object.keys(PALETTES), "自分"].map((k) => (
            <option key={k} value={k}>
              {k === "自分" ? "自分のカラーセット" : k}
            </option>
          ))}
        </select>
        {pal === "自分" && (
          <button
            type="button"
            className="icon-btn"
            title="今の色を加える"
            aria-label="今の色を加える"
            onClick={() => {
              const v = [...user.filter((c) => c !== s.colors.main), s.colors.main];
              setUser(v);
              saveUser(v);
            }}
          >
            <Plus size={14} />
          </button>
        )}
      </div>
      <div className="swatches">
        {list.map((c) => (
          <button
            key={c}
            type="button"
            className="swatch"
            style={{ background: c }}
            title={pal === "自分" ? `${c}（右クリックで削除）` : c}
            onClick={() => s.setColor(c)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (pal !== "自分") return;
              const v = user.filter((x) => x !== c);
              setUser(v);
              saveUser(v);
            }}
          />
        ))}
        {pal === "自分" && user.length === 0 && <p className="hint">＋で今の色を加えられます。</p>}
      </div>
    </Panel>
  );
}

function Wheel({ hsv, onChange }: { hsv: [number, number, number]; onChange: (h: [number, number, number]) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<"ring" | "sv" | null>(null);
  const S = 188;
  const R = S / 2 - 2;
  const r = R - 16;
  const side = r * Math.SQRT2 * 0.94;
  useEffect(() => {
    const c = ref.current!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = S * dpr;
    c.height = S * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    const cx = S / 2;
    // 色相の輪
    for (let i = 0; i < 360; i += 1) {
      ctx.beginPath();
      ctx.arc(cx, cx, (R + r) / 2, ((i - 90.6) * Math.PI) / 180, ((i - 89) * Math.PI) / 180);
      ctx.strokeStyle = `hsl(${i},100%,50%)`;
      ctx.lineWidth = R - r;
      ctx.stroke();
    }
    // 彩度・明度の四角
    const x0 = cx - side / 2;
    const [hr, hg, hb] = hsvToRgb(hsv[0], 1, 1);
    ctx.fillStyle = rgbToHex(hr, hg, hb);
    ctx.fillRect(x0, x0, side, side);
    const gw = ctx.createLinearGradient(x0, 0, x0 + side, 0);
    gw.addColorStop(0, "#fff");
    gw.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gw;
    ctx.fillRect(x0, x0, side, side);
    const gb = ctx.createLinearGradient(0, x0, 0, x0 + side);
    gb.addColorStop(0, "rgba(0,0,0,0)");
    gb.addColorStop(1, "#000");
    ctx.fillStyle = gb;
    ctx.fillRect(x0, x0, side, side);
    // 印
    const ha = hsv[0] * Math.PI * 2 - Math.PI / 2;
    const hx = cx + Math.cos(ha) * ((R + r) / 2);
    const hy = cx + Math.sin(ha) * ((R + r) / 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fff";
    ctx.beginPath();
    ctx.arc(hx, hy, (R - r) / 2 - 1, 0, Math.PI * 2);
    ctx.stroke();
    const sx = x0 + hsv[1] * side;
    const sy = x0 + (1 - hsv[2]) * side;
    ctx.strokeStyle = hsv[2] > 0.55 && hsv[1] < 0.5 ? "#111" : "#fff";
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, Math.PI * 2);
    ctx.stroke();
  }, [hsv, R, r, side]);
  const pick = (e: React.PointerEvent, start: boolean) => {
    const rect = ref.current!.getBoundingClientRect();
    const x = e.clientX - rect.left - S / 2;
    const y = e.clientY - rect.top - S / 2;
    const d = Math.hypot(x, y);
    if (start) drag.current = d > r - 2 ? "ring" : "sv";
    if (drag.current === "ring") {
      let h = (Math.atan2(y, x) + Math.PI / 2) / (Math.PI * 2);
      if (h < 0) h += 1;
      onChange([h, hsv[1], hsv[2]]);
    } else if (drag.current === "sv") {
      const sv = Math.min(1, Math.max(0, (x + side / 2) / side));
      const vv = Math.min(1, Math.max(0, 1 - (y + side / 2) / side));
      onChange([hsv[0], sv, vv]);
    }
  };
  return (
    <canvas
      ref={ref}
      className="wheel"
      style={{ width: S, height: S }}
      aria-label="色相環"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        pick(e, true);
      }}
      onPointerMove={(e) => e.buttons && pick(e, false)}
      onPointerUp={() => (drag.current = null)}
    />
  );
}
