import { ArrowUpRight, Github } from "lucide-react";

interface Props {
  year: number;
  reduced: boolean;
  onIndex: () => void;
  onAbout: () => void;
  onHome: () => void;
}

export default function Topbar({ year, onIndex, onAbout, onHome }: Props) {
  return (
    <header className="topbar">
      <a
        className="wordmark"
        href="#top"
        aria-label="UNFILED ホーム"
        data-cursor="TOP"
        onClick={(e) => {
          e.preventDefault();
          onHome();
        }}
      >
        UNFILED<span className="wordmark-dot">.</span>
      </a>
      <p className="topbar-thought mono">
        <span className="signal">WORK IN PROGRESS</span>
        <span className="sep" aria-hidden="true">
          /
        </span>
        <span>VOL. {year}</span>
        <span className="sep" aria-hidden="true">
          /
        </span>
        <span className="ja">つくる。ためす。また、つくる。</span>
      </p>
      <nav aria-label="メインナビゲーション">
        <button type="button" onClick={onIndex} data-cursor="INDEX">
          作品の索引<kbd aria-hidden="true">I</kbd>
        </button>
        <button type="button" onClick={onAbout} data-cursor="ABOUT">
          この場所について
        </button>
        <a
          className="github-link"
          href="https://github.com/XenithONE"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="XenithONEのGitHub（新しいタブ）"
          data-cursor="GITHUB"
        >
          <Github size={18} strokeWidth={1.7} />
          <ArrowUpRight size={16} strokeWidth={1.5} />
        </a>
      </nav>
    </header>
  );
}
