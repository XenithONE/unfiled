import { ArrowUp, ArrowUpRight } from "lucide-react";
import type { StageStats } from "../stage/Stage";
import type { StageStatus } from "../stage/useStage";

interface Props {
  stats: StageStats | null;
  status: StageStatus;
  year: number;
  onTop: () => void;
  onIndex: () => void;
}

/** The chamber at the end of the rail: field notes, colophon, footer. */
export default function Ending({ stats, status, year, onTop, onIndex }: Props) {
  const backend =
    status.state === "ready"
      ? status.backend === "webgpu"
        ? "WebGPU"
        : "WebGL2 (fallback)"
      : status.state === "unsupported"
        ? "static"
        : "—";
  return (
    <section className="ending" id="about" aria-labelledby="ending-title">
      <header className="section-head mono">
        <span className="signal">02</span>
        <span>FIELD NOTES</span>
        <span>この場所について</span>
      </header>
      <div className="ending-body">
        <h2 id="ending-title" className="ending-lead">
          つくる。ためす。
          <br />
          また、つくる。
        </h2>
        <div className="ending-copy">
          <p>
            つくりたいものは、そのときの好奇心で変わる。
            <br />
            宇宙へ行ったり、時間を旅したり、ただ海を眺めたり。
          </p>
          <p>
            AIといっしょに、思いつきをかたちにする。
            <br />
            つくること自体が楽しくて、テーマも、目的も、まだばらばら。
          </p>
          <p>
            ここは、そんな制作物が集まる場所。
            <br />
            分類するより先に、まずは並べてみました。
          </p>
        </div>
        <dl className="colophon mono">
          <div>
            <dt>FIELD</dt>
            <dd>
              three.js WebGPURenderer + TSL compute ·{" "}
              {stats ? stats.count.toLocaleString("en-US") : "—"} particles · {backend}
            </dd>
          </div>
          <div>
            <dt>BUILD</dt>
            <dd>React · Vite · GSAP · Web Audio（音声素材なし） · 画像以外の外部アセットなし</dd>
          </div>
          <div>
            <dt>MADE WITH</dt>
            <dd>人とAIの共同制作。コードも、粒子も、言葉も、まだ途中。</dd>
          </div>
        </dl>
        <div className="ending-actions">
          <button type="button" className="big-button" onClick={onIndex} data-cursor="INDEX">
            <span>作品の索引をひらく</span>
            <span className="mono">31 FILED</span>
          </button>
          <button type="button" className="big-button ghost" onClick={onTop} data-cursor="TOP">
            <span>最初へ戻る</span>
            <ArrowUp size={18} strokeWidth={1.6} aria-hidden="true" />
          </button>
        </div>
      </div>
      <footer className="site-footer mono">
        <span>XenithONE © {year}</span>
        <span>好奇心に、完成はない。</span>
        <a href="https://github.com/XenithONE/unfiled" target="_blank" rel="noopener noreferrer" data-cursor="SOURCE">
          SOURCE
          <ArrowUpRight size={14} strokeWidth={1.5} aria-hidden="true" />
        </a>
      </footer>
    </section>
  );
}
