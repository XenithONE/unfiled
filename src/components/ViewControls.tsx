import { Box, Hand, List, Pause, Play, Shuffle } from "lucide-react";
import type { View } from "../types";

interface Props {
  view: View;
  setView: (view: View) => void;
  paused: boolean;
  setPaused: (value: boolean) => void;
  shuffle: () => void;
  count: number;
  reducedMotion: boolean;
}
export default function ViewControls({
  view,
  setView,
  paused,
  setPaused,
  shuffle,
  count,
  reducedMotion,
}: Props) {
  return (
    <div className="controls-row">
      <div className="explore-help">
        <Hand size={32} strokeWidth={1.1} />
        <div>
          <span className="desktop-help">ドラッグして探索</span>
          <span className="mobile-help">気になる作品に、触れてみる</span>
          <span>作品をクリックして、ひらく</span>
        </div>
      </div>
      <div className="view-controls">
        <div className="view-switch" role="group" aria-label="作品の表示方法">
          <button
            aria-pressed={view === "space"}
            onClick={() => setView("space")}
            className={view === "space" ? "active" : ""}
          >
            <Box size={22} strokeWidth={1.5} />
            <span>空間</span>
          </button>
          <span className="control-divider" />
          <button
            aria-pressed={view === "index"}
            onClick={() => setView("index")}
            className={view === "index" ? "active" : ""}
          >
            <List size={22} strokeWidth={1.5} />
            <span>一覧</span>
          </button>
        </div>
        <button
          className="shuffle-button"
          onClick={shuffle}
          disabled={view !== "space"}
          aria-label="作品の配置をシャッフル"
          title="作品の配置をシャッフル"
        >
          <Shuffle size={24} strokeWidth={1.5} />
        </button>
      </div>
      <button
        className="motion-button"
        onClick={() => setPaused(!paused)}
        aria-label={paused ? "作品の動きを再生" : "作品の動きを停止"}
        aria-pressed={paused}
        title={
          reducedMotion
            ? "端末設定に合わせて動きを抑えています"
            : paused
              ? "動きを再生"
              : "動きを停止"
        }
        disabled={reducedMotion}
      >
        {paused ? (
          <Play size={17} fill="currentColor" />
        ) : (
          <Pause size={18} fill="currentColor" />
        )}
      </button>
      <div className="work-count">
        <span>{String(count).padStart(2, "0")}</span>
        <span>EXPERIMENTS</span>
      </div>
    </div>
  );
}
