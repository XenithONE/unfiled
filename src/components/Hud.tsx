import { ArrowUp, LayoutGrid, Pause, Play, Volume2, VolumeX } from "lucide-react";
import type { StageStats } from "../stage/Stage";
import type { StageStatus } from "../stage/useStage";

interface Props {
  status: StageStatus;
  stats: StageStats | null;
  figureIndex: number;
  total: number;
  figureTitle: string;
  paused: boolean;
  soundOn: boolean;
  reducedMotion: boolean;
  onTogglePaused: () => void;
  onToggleSound: () => void;
  onIndex: () => void;
  onTop: () => void;
}

const BUILD = typeof __BUILD_STAMP__ === "string" ? __BUILD_STAMP__ : "dev";

export default function Hud({
  status,
  stats,
  figureIndex,
  total,
  figureTitle,
  paused,
  soundOn,
  reducedMotion,
  onTogglePaused,
  onToggleSound,
  onIndex,
  onTop,
}: Props) {
  const ready = status.state === "ready";
  const backend = ready
    ? status.backend === "webgpu"
      ? "WEBGPU"
      : "WEBGL2"
    : status.state === "booting"
      ? "BOOT"
      : "STATIC";
  const count = stats?.count ?? (ready ? status.count : 0);
  return (
    <>
      <div className="hud mono" aria-hidden="true">
        <div className="hud-line">
          <span className="hud-key">SYS</span>
          <span className={`hud-chip ${ready ? "is-on" : ""}`}>{backend}</span>
          <span>{count ? `${count.toLocaleString("en-US")} PTC` : "—"}</span>
          <span>{stats ? `${String(stats.fps).padStart(3, " ")} FPS` : ""}</span>
          <span className="hud-faint">
            {stats && stats.renderScale < 1 ? `×${stats.renderScale.toFixed(2)}` : ""}
          </span>
        </div>
        <div className="hud-line">
          <span className="hud-key">FIG</span>
          <span>
            {figureIndex > 0
              ? `${String(figureIndex).padStart(2, "0")} / ${String(total).padStart(2, "0")}`
              : `— / ${String(total).padStart(2, "0")}`}
          </span>
          <span className="hud-title">{figureTitle}</span>
        </div>
        <div className="hud-line hud-faint hud-keys">
          <span className="hud-key">KEY</span>
          <span>↑↓ MOVE</span>
          <span>↵ OPEN</span>
          <span>I INDEX</span>
          <span>ESC BACK</span>
        </div>
        <div className="hud-line hud-faint">
          <span className="hud-key">BLD</span>
          <span>{BUILD}</span>
        </div>
      </div>

      <div className="hud-controls">
        <button
          type="button"
          className={`hud-button ${soundOn ? "is-on" : ""}`}
          onClick={onToggleSound}
          aria-pressed={soundOn}
          aria-label={soundOn ? "音を止める" : "音を鳴らす"}
          title={soundOn ? "音を止める" : "音を鳴らす（生成音・素材なし）"}
          data-cursor={soundOn ? "MUTE" : "SOUND"}
        >
          {soundOn ? <Volume2 size={15} strokeWidth={1.6} /> : <VolumeX size={15} strokeWidth={1.6} />}
          <span className="mono">SND</span>
        </button>
        <button
          type="button"
          className="hud-button"
          onClick={onIndex}
          aria-label="作品の索引"
          title="作品の索引（I）"
          data-cursor="INDEX"
        >
          <LayoutGrid size={15} strokeWidth={1.6} />
          <span className="mono">IDX</span>
        </button>
        <button
          type="button"
          className="hud-button"
          onClick={onTogglePaused}
          disabled={!ready}
          aria-pressed={paused}
          aria-label={paused ? "粒子の動きを再生" : "粒子の動きを停止"}
          title={
            reducedMotion
              ? "端末設定に合わせて動きを抑えています"
              : paused
                ? "動きを再生"
                : "動きを停止"
          }
          data-cursor={paused ? "PLAY" : "PAUSE"}
        >
          {paused ? <Play size={14} fill="currentColor" strokeWidth={1.4} /> : <Pause size={14} fill="currentColor" strokeWidth={1.4} />}
        </button>
        <button type="button" className="hud-button" onClick={onTop} aria-label="最初へ戻る" title="最初へ" data-cursor="TOP">
          <ArrowUp size={15} strokeWidth={1.6} />
        </button>
      </div>
    </>
  );
}
