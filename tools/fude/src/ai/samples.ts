// 見本の台本。Claude（Anthropic の AI）が FUDE の操作口（window.fude）で描きながら作ったもの。
// 「AI に描かせる › 見本」から、描く様子を再生できる。
import lighthouse from "./samples/lighthouse.json";
import moonCat from "./samples/moon-cat.json";
import sakura from "./samples/sakura-torii.json";

export interface Sample {
  id: string;
  title: string;
  note: string;
  script: unknown;
}

export const SAMPLES: Sample[] = [
  { id: "lighthouse", title: "夕暮れの灯台", note: "グラデーション・水彩のにじみ・加算（発光）の光・照り返し", script: lighthouse },
  { id: "moon-cat", title: "月夜の猫", note: "大きな月・雲・猫の影絵と縁の光・縦書き", script: moonCat },
  { id: "sakura-torii", title: "桜と鳥居", note: "フォルダー・油彩の幹・雲と花びらの散らし筆・木漏れ日", script: sakura },
];
