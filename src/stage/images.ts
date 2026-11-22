import { ImageLoader } from "three/webgpu";

const imageLoader = new ImageLoader();
const imageCache = new Map<string, Promise<HTMLImageElement>>();

/** Load an image once; a failed load is forgotten so it can be retried. */
export function loadImage(url: string) {
  let entry = imageCache.get(url);
  if (!entry) {
    entry = imageLoader.loadAsync(url);
    imageCache.set(url, entry);
    entry.catch(() => imageCache.delete(url));
  }
  return entry;
}
