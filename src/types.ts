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
/**
 * Progress along the walk: 0 is the first work and each work is one unit;
 * the opening shot sits this far before it.
 */
export const HERO_PROGRESS = -1.2;
