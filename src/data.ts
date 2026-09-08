import type { Project } from "./types";

export const assetUrl = (path: string) =>
  `${import.meta.env.BASE_URL}${path.replace(/^\//, "")}`;

export async function loadProjects(signal: AbortSignal): Promise<Project[]> {
  const response = await fetch(assetUrl("projects.json"), { signal });
  if (!response.ok) throw new Error("作品の読み込みに失敗しました。");
  const data: unknown = await response.json();
  const seen = new Set<string>();
  if (!Array.isArray(data))
    throw new Error("作品データの形式を確認してください。");
  return data.map((item: Record<string, unknown>) => {
    if (!item || typeof item !== "object")
      throw new Error("作品データを確認してください。");
    for (const key of [
      "id",
      "title",
      "subtitle",
      "description",
      "category",
      "year",
      "url",
      "cover",
      "accent",
    ]) {
      if (typeof item[key] !== "string" || !item[key])
        throw new Error(`作品の${key}を確認してください。`);
    }
    const project = item as unknown as Project;
    if (item.source !== undefined && (typeof item.source !== "string" || !item.source))
      throw new Error("作品のsourceを確認してください。");
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(project.id) ||
      ["about", "works"].includes(project.id)
    ) {
      throw new Error(
        "作品のIDには小文字の英数字とハイフンを使い、aboutとworks以外を指定してください。",
      );
    }
    if (seen.has(project.id)) throw new Error("作品のIDが重複しています。");
    seen.add(project.id);
    for (const link of [project.url, ...(project.source ? [project.source] : [])]) {
      if (new URL(link).protocol !== "https:")
        throw new Error("作品リンクにはHTTPSを指定してください。");
    }
    if (
      !/^images\/[\w./-]+$/.test(project.cover) ||
      project.cover.includes("..")
    )
      throw new Error("カバー画像のパスを確認してください。");
    if (!/^#[0-9a-fA-F]{6}$/.test(project.accent))
      throw new Error("アクセント色を確認してください。");
    return project;
  });
}
