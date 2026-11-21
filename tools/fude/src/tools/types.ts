import type { Sample } from "../engine/brush/stroke";

export interface Ptr {
  /** キャンバス座標 */
  x: number;
  y: number;
  /** 画面（作業台の CSS 画素） */
  sx: number;
  sy: number;
  p: number;
  tx: number;
  ty: number;
  t: number;
  type: "mouse" | "pen" | "touch";
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  button: number;
}

export interface Tool {
  readonly id: string;
  cursor?: string;
  down(e: Ptr): void;
  move(e: Ptr): void;
  up(e: Ptr): void;
  cancel(): void;
  hover?(e: Ptr): void;
  leave?(): void;
  overlay?(ctx: CanvasRenderingContext2D): void;
  /** Enter / Esc などのキー（道具が受け取ったら true）。 */
  key?(key: string, e: KeyboardEvent): boolean;
  /** 道具を離れるとき。 */
  deactivate?(): void;
}

export function toSample(e: Ptr): Sample {
  return { x: e.x, y: e.y, p: e.p, tx: e.tx, ty: e.ty, t: e.t };
}
