export interface Project {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  category: string;
  year: string;
  url: string;
  source?: string;
  cover: string;
  accent: string;
}
export type View = "space" | "index";
