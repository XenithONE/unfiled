import { ArrowUpRight } from "lucide-react";
import { assetUrl } from "../data";
import type { Project } from "../types";

export default function ProjectIndex({
  projects,
  onOpen,
}: {
  projects: Project[];
  onOpen: (project: Project) => void;
}) {
  return (
    <div className="project-index" aria-label="作品一覧">
      <div className="index-heading">
        <span>SELECTED EXPERIMENTS</span>
        <span>{projects.length} WORKS / 2026—</span>
      </div>
      {projects.map((project, index) => (
        <button
          key={project.id}
          className="index-row"
          onClick={() => onOpen(project)}
          aria-label={`${project.title}の詳細をひらく`}
        >
          <span className="index-number">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="index-thumbnail">
            <img src={assetUrl(project.cover)} alt="" />
          </span>
          <span className="index-name">
            <span>{project.title}</span>
            <span>{project.subtitle}</span>
          </span>
          <span className="index-category">{project.category}</span>
          <span className="index-year">{project.year}</span>
          <ArrowUpRight className="index-arrow" size={28} strokeWidth={1.5} />
        </button>
      ))}
    </div>
  );
}
