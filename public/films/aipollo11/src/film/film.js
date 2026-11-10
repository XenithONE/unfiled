// 全編の進行表：カットを順に並べ、時刻 t のコマを組み立てる
import { clamp } from '../core/util.js';

export class Film {
  constructor(engine, world) {
    this.engine = engine; this.world = world;
    this.shots = []; this.duration = 0; this.cues = []; this.marks = {};
  }
  /** カットを足す。update(t, shot, T)：t はカット内の秒、T は全編の秒。cues は [[カット内の秒, 名前, 引数], ...]（音の合図） */
  shot(name, dur, update, cues) {
    const t0 = this.duration;
    this.shots.push({ name, t0, t1: t0 + dur, dur, update });
    this.duration += dur;
    this.marks[name] = t0;
    if (cues) for (const c of cues) this.cues.push({ t: t0 + c[0], name: c[1], p: c[2] || {} });
    return this;
  }
  find(t) {
    const s = this.shots;
    let lo = 0, hi = s.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid].t0 <= t) lo = mid; else hi = mid - 1; }
    return s[lo];
  }
  /** 時刻 T（秒）の場面を組む。描画はしない。 */
  frame(T) {
    T = clamp(T, 0, this.duration - 1e-4);
    const s = this.find(T);
    this.world.begin(T);
    this.world.shot = s;   // いまのカット（時間帯の既定を決めるのに使う）
    s.update(T - s.t0, s, T);
    this.world.end(T);
    return s;
  }
}
