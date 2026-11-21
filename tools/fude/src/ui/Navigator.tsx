import { FlipHorizontal2, Maximize2, RotateCcw } from "lucide-react";
import { useEffect, useRef } from "react";
import { Panel, Slider } from "./controls";
import { useStudio, useTopics } from "./hooks";

export function Navigator() {
  const s = useStudio();
  useTopics("view", "pixels", "layers", "doc");
  const ref = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLCanvasElement | null>(null);
  const W = 232;
  const d = s.doc;
  const k = W / Math.max(d.w, d.h);
  const w = Math.round(d.w * k);
  const h = Math.round(d.h * k);
  const pv = useTopics("pixels", "layers", "doc");
  useEffect(() => {
    const t = setTimeout(() => {
      const im = s.previewImage(W);
      const small = document.createElement("canvas");
      small.width = im.width;
      small.height = im.height;
      small.getContext("2d")!.putImageData(im, 0, 0);
      img.current = small;
      draw();
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pv, w, h]);
  const draw = () => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#3a3c41";
    ctx.fillRect(0, 0, w, h);
    if (img.current) ctx.drawImage(img.current, 0, 0);
    const v = s.view;
    const pts = [
      v.toCanvas(0, 0),
      v.toCanvas(v.sw, 0),
      v.toCanvas(v.sw, v.sh),
      v.toCanvas(0, v.sh),
    ];
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k)));
    ctx.closePath();
    ctx.strokeStyle = "#fa512c";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };
  useEffect(draw);
  const move = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    s.view.cx = (e.clientX - r.left) / k;
    s.view.cy = (e.clientY - r.top) / k;
    s.view.fitted = false;
    s.view.onChange?.();
  };
  const v = s.view;
  return (
    <Panel
      title="ナビゲーター"
      className="navigator"
      right={
        <>
          <button type="button" className={`icon-btn${v.flip ? " is-on" : ""}`} title="左右反転表示（H）" aria-label="左右反転表示" aria-pressed={v.flip} onClick={() => v.setFlip(!v.flip)}>
            <FlipHorizontal2 size={14} />
          </button>
          <button type="button" className="icon-btn" title="回転を戻す" aria-label="回転を戻す" onClick={() => v.rotateAt(0, v.sw / 2, v.sh / 2)}>
            <RotateCcw size={14} />
          </button>
          <button type="button" className="icon-btn" title="全体を表示（Ctrl+0）" aria-label="全体を表示" onClick={() => v.fit()}>
            <Maximize2 size={14} />
          </button>
        </>
      }
    >
      <canvas
        ref={ref}
        className="nav-canvas"
        style={{ width: w, height: h }}
        aria-label="全体図"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          move(e);
        }}
        onPointerMove={(e) => e.buttons && move(e)}
      />
      <Slider label="表示" value={Math.round(v.zoom * 100)} min={1} max={6400} log unit="%" onChange={(z) => v.zoomAt(z / 100, v.sw / 2, v.sh / 2)} />
      <Slider label="回転" value={Math.round(((((v.rot * 180) / Math.PI) % 360) + 540) % 360) - 180} min={-180} max={180} step={1} unit="°" onChange={(a) => v.rotateAt((a * Math.PI) / 180, v.sw / 2, v.sh / 2)} />
    </Panel>
  );
}
