import { ArrowUp, Footprints, LayoutGrid, Pause, Play, Square, Volume2, VolumeX } from "lucide-react";
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
  touring: boolean;
  onTogglePaused: () => void;
  onToggleTour: () => void;
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
  touring,
  onTogglePaused,
  onToggleTour,
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
  return (
    <>
      <div className="hud mono" aria-hidden="true">
        <div className="hud-line">
          <span className="hud-key">SYS</span>
          <span className={`hud-chip ${ready ? "is-on" : ""}`}>{backend}</span>
          <span className="hud-clock">{stats ? stats.clock : "--:--"}</span>
          <span className="hud-phase">{stats ? stats.phase : ""}</span>
          <span className="hud-faint">{stats ? `${String(stats.fps).padStart(3, " ")} FPS` : ""}</span>
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
          <span>T TOUR</span>
          <span>H HIDE</span>
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
          className={`hud-button ${touring ? "is-on" : ""}`}
          onClick={onToggleTour}
          disabled={!ready}
          aria-pressed={touring}
          aria-label={touring ? "おまかせ散歩を止める" : "おまかせ散歩を始める（一晩を自動で歩く）"}
          title={touring ? "おまかせ散歩を止める（T）" : "おまかせ散歩：一晩を自動で歩く（T）"}
          data-cursor={touring ? "STOP" : "TOUR"}
        >
          {touring ? (
            <Square size={13} fill="currentColor" strokeWidth={1.4} />
          ) : (
            <Footprints size={15} strokeWidth={1.6} />
          )}
          <span className="mono">TOUR</span>
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
          aria-label={paused ? "景色の動きを再生" : "景色の動きを停止"}
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
