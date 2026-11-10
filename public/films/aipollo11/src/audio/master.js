// 仕上げ：音量の測定（ITU-R BS.1770 / LUFS）・先読みリミッター・WAV 書き出し
// すべて JavaScript の配列計算で行うので、再生でも書き出しでも同じ結果になる。

/** K 特性フィルター（48 kHz 用の係数）をかけた 2 乗平均を 400 ms / 100 ms 刻みで返す */
function kBlocks(ch, sr) {
  // 48 kHz 以外でも近い値になるよう、係数は 48 kHz のものをそのまま使う（この作品は 48 kHz 固定）
  const b1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], a1 = [-1.69065929318241, 0.73248077421585];
  const b2 = [1.0, -2.0, 1.0], a2 = [-1.99004745483398, 0.99007225036621];
  const n = ch[0].length;
  const blk = Math.round(sr * 0.4), hop = Math.round(sr * 0.1);
  const nb = Math.max(0, Math.floor((n - blk) / hop) + 1);
  const sums = new Float64Array(nb);
  for (const x of ch) {
    // 1 サンプルずつフィルターを通し、100 ms ごとの 2 乗和をためる
    const acc = new Float64Array(Math.ceil(n / hop) + 1);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, u1 = 0, u2 = 0, v1 = 0, v2 = 0;
    for (let i = 0; i < n; i++) {
      const s = x[i];
      const y = b1[0] * s + b1[1] * x1 + b1[2] * x2 - a1[0] * y1 - a1[1] * y2;
      x2 = x1; x1 = s; y2 = y1; y1 = y;
      const v = b2[0] * y + b2[1] * u1 + b2[2] * u2 - a2[0] * v1 - a2[1] * v2;
      u2 = u1; u1 = y; v2 = v1; v1 = v;
      acc[(i / hop) | 0] += v * v;
    }
    for (let k = 0; k < nb; k++) sums[k] += (acc[k] + acc[k + 1] + acc[k + 2] + acc[k + 3]) / blk;
  }
  return sums;
}

/** 統合ラウドネス（LUFS） */
export function measureLUFS(ch, sr) {
  const ms = kBlocks(ch, sr);
  const lk = (m) => -0.691 + 10 * Math.log10(Math.max(m, 1e-12));
  let s = 0, c = 0;
  for (const m of ms) if (lk(m) > -70) { s += m; c++; }
  if (!c) return -Infinity;
  const rel = lk(s / c) - 10;
  s = 0; c = 0;
  for (const m of ms) { const l = lk(m); if (l > -70 && l > rel) { s += m; c++; } }
  return c ? lk(s / c) : -Infinity;
}

// 4 倍オーバーサンプリング用の補間係数（窓付き sinc・1 相あたり 12 タップ）
let TP = null;
function tpCoef() {
  if (TP) return TP;
  TP = [];
  for (let p = 1; p < 4; p++) {
    const f = p / 4, c = new Float32Array(12);
    let sum = 0;
    for (let j = -5; j <= 6; j++) { const t = j - f, w = 0.5 + 0.5 * Math.cos((Math.PI * t) / 6.5); c[j + 5] = (Math.sin(Math.PI * t) / (Math.PI * t)) * w; sum += c[j + 5]; }
    for (let k = 0; k < 12; k++) c[k] /= sum;
    TP.push(c);
  }
  return TP;
}
/** サンプル間のピーク（真のピーク）を 4 倍補間で見積もる。各サンプル位置の最大値を返す */
function truePeakEnvelope(ch, floor = 0.3) {
  const n = ch[0].length, C = tpCoef();
  const env = new Float32Array(n);
  for (const x of ch) {
    for (let i = 0; i < n; i++) {
      const a0 = Math.abs(x[i]);
      if (a0 > env[i]) env[i] = a0;
      // 小さい所は調べない（山になり得ない）
      if (i < 5 || i > n - 8 || (a0 < floor && Math.abs(x[i + 1]) < floor)) continue;
      let m = 0;
      for (let p = 0; p < 3; p++) {
        const c = C[p];
        let y = 0;
        for (let k = 0; k < 12; k++) y += x[i - 5 + k] * c[k];
        const a = Math.abs(y);
        if (a > m) m = a;
      }
      if (m > env[i]) env[i] = m;
      if (m > env[i + 1]) env[i + 1] = m;
    }
  }
  return env;
}

export function truePeakDb(ch) {
  const env = truePeakEnvelope(ch);
  let m = 0;
  for (let i = 0; i < env.length; i++) if (env[i] > m) m = env[i];
  return 20 * Math.log10(Math.max(m, 1e-9));
}

/** 先読みリミッター（天井 ceilDb dBTP・先読み 5 ms・戻り 120 ms）。配列をその場で書き換える */
export function limit(ch, sr, ceilDb = -1.8) {
  const n = ch[0].length;
  const ceil = Math.pow(10, ceilDb / 20);
  const env = truePeakEnvelope(ch);
  const LA = Math.round(sr * 0.005);
  // 必要な下げ幅（1 以下）。戻りはゆっくり
  const need = new Float32Array(n);
  const rel = Math.exp(-1 / (sr * 0.12));
  let g = 1;
  for (let i = 0; i < n; i++) {
    const d = env[i] > ceil ? ceil / env[i] : 1;
    g = Math.min(d, 1 - (1 - g) * rel);
    need[i] = g;
  }
  // 逆向きにも同じ処理（山の手前でなめらかに下げ始める）
  g = 1;
  const att = Math.exp(-1 / (sr * 0.0018));
  for (let i = n - 1; i >= 0; i--) { g = Math.min(need[i], 1 - (1 - g) * att); need[i] = g; }
  // 先読みぶんの最小値 → 移動平均（山の位置で必ず下げ切る）
  const mn = new Float32Array(n);
  const dq = new Int32Array(n); let head = 0, tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && need[dq[tail - 1]] >= need[i]) tail--;
    dq[tail++] = i;
    while (dq[head] > i + LA) head++;
    mn[i] = need[dq[head]];
  }
  let sum = 0, reduced = 0, minG = 1;
  const gain = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    sum += mn[i];
    if (i >= LA) sum -= mn[i - LA];
    gain[i] = sum / Math.min(i + 1, LA);
    if (gain[i] < 0.944) reduced++;
    if (gain[i] < minG) minG = gain[i];
  }
  for (const x of ch) for (let i = 0; i < n; i++) x[i] *= gain[i];
  return { reducedRatio: reduced / n, maxReductionDb: -20 * Math.log10(minG) };
}

/** 直流分と超低域の除去（1 次のハイパス） */
export function dcBlock(ch, sr, fc = 18) {
  const r = Math.exp(-2 * Math.PI * fc / sr);
  for (const x of ch) { let px = 0, py = 0; for (let i = 0; i < x.length; i++) { const y = x[i] - px + r * py; px = x[i]; py = y; x[i] = y; } }
}

/**
 * 目標ラウドネスに合わせ、ピークを抑える。戻り値は測定結果。
 * 天井を −2.8 dB にしているのは、ここでの真のピークの見積もりが ffmpeg（ebur128=peak=true）より
 * 0.2〜0.8 dB 低く出るため。こうしておくと、ffmpeg で測っても −1.5 dBTP 以下に収まる。
 */
export function master(ch, sr, target = -16, ceilDb = -2.8) {
  dcBlock(ch, sr);
  const l0 = measureLUFS(ch, sr);
  let info = { rawLufs: l0 };
  if (!isFinite(l0)) return { ...info, lufs: l0, truePeak: -Infinity };
  let gainDb = target - l0;
  for (let pass = 0; pass < 2; pass++) {
    const g = Math.pow(10, gainDb / 20);
    for (const x of ch) for (let i = 0; i < x.length; i++) x[i] *= g;
    const r = limit(ch, sr, ceilDb);
    const l = measureLUFS(ch, sr);
    info = { ...info, lufs: l, limited: r.reducedRatio, limiterMaxDb: Math.max(info.limiterMaxDb || 0, r.maxReductionDb) };
    gainDb = target - l;
    if (Math.abs(gainDb) < 0.2) break;
  }
  info.truePeak = truePeakDb(ch);
  let pk = 0;
  for (const x of ch) for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > pk) pk = a; }
  info.samplePeak = 20 * Math.log10(Math.max(pk, 1e-9));
  return info;
}

/** 32 bit 浮動小数のステレオ WAV */
export function wavBlob(ch, sr) {
  const n = ch[0].length, nc = ch.length;
  const buf = new ArrayBuffer(44 + n * nc * 4);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * nc * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 3, true); v.setUint16(22, nc, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * nc * 4, true); v.setUint16(32, nc * 4, true); v.setUint16(34, 32, true);
  str(36, 'data'); v.setUint32(40, n * nc * 4, true);
  const f = new Float32Array(buf, 44);
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) f[i * nc + c] = ch[c][i];
  return new Blob([buf], { type: 'audio/wav' });
}
