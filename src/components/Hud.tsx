import { ArrowUp, Pause, Play, Sparkles } from "lucide-react";
import type { StageStats } from "../stage/ParticleStage";
import type { StageStatus } from "../stage/useStage";

interface Props {
  status: StageStatus;
  stats: StageStats | null;
  figureIndex: number;
  total: number;
  figureTitle: string;
  paused: boolean;
  reducedMotion: boolean;
  onTogglePaused: () => void;
  onScatter: () => void;
}

const BUILD = typeof __BUILD_STAMP__ === "string" ? __BUILD_STAMP__ : "dev";

export default function Hud({
  status,
  stats,
  figureIndex,
  total,
  figureTitle,
  paused,
  reducedMotion,
  onTogglePaused,
  onScatter,
}: Props) {
  const ready = status.state === "ready";
  const backend = ready
    ? status.backend === "webgpu"
      ? "WEBGPU"
      : "WEBGL2"
    : status.state === "booting"
      ? "BOOT"
      : "STATIC";
  const count = ready ? status.count : 0;
  return (
    <>
      <div className="hud mono" aria-hidden="true">
        <div className="hud-line">
          <span className="hud-key">SYS</span>
          <span className={`hud-chip ${ready ? "is-on" : ""}`}>{backend}</span>
          <span>{count ? `${count.toLocaleString("en-US")} PARTICLES` : "—"}</span>
          <span>{stats ? `${String(stats.fps).padStart(3, " ")} FPS` : ""}</span>
          <span className="hud-faint">
            {stats && stats.renderScale < 1
              ? `SCALE ${Math.round(stats.renderScale * 100)}%`
              : ""}
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
        <div className="hud-line hud-faint">
          <span className="hud-key">BLD</span>
          <span>{BUILD}</span>
          <span>{stats?.gpu ? stats.gpu.toUpperCase() : ""}</span>
        </div>
      </div>

      <div className="hud-controls">
        <button
          type="button"
          className="hud-button"
          onClick={onScatter}
          disabled={!ready}
          aria-label="粒子をはじく"
          title="粒子をはじく"
        >
          <Sparkles size={16} strokeWidth={1.6} />
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
        >
          {paused ? (
            <Play size={15} fill="currentColor" strokeWidth={1.4} />
          ) : (
            <Pause size={15} fill="currentColor" strokeWidth={1.4} />
          )}
        </button>
        <a className="hud-button" href="#top" aria-label="ページの先頭へ" title="先頭へ">
          <ArrowUp size={16} strokeWidth={1.6} />
        </a>
      </div>
    </>
  );
}
