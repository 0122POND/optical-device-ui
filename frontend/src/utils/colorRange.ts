// 高さ/深さヒートマップのカラーレンジ制御。
// - 手動レンジ（設定タブの min/max 入力, µm）を最優先
// - 未入力時は自動: 外れ値でレンジが引き伸ばされている場合のみ 1〜99 パーセンタイルに切替
// - レンジ外の値はグレー表示（点・面は残し、色だけ無彩色化）
// Plotly（heatmap / surface / scatter3d）と three.js 点群ビューで共有する。

// 5段カラースケール（青→水色→緑→橙→赤）。Plotly 用 hex と three.js 用 RGB を併記
export const COLOR_STOPS: Array<[number, string]> = [
  [0.0, "#0000ff"],
  [0.25, "#00bfff"],
  [0.5, "#00ff00"],
  [0.75, "#ffbf00"],
  [1.0, "#ff0000"],
];

export const COLOR_STOPS_RGB: Array<[number, [number, number, number]]> = [
  [0.0, [0, 0, 255]],
  [0.25, [0, 191, 255]],
  [0.5, [0, 255, 0]],
  [0.75, [255, 191, 0]],
  [1.0, [255, 0, 0]],
];

// レンジ外の色（黒背景でも識別でき、かつ有彩色と混ざらないグレー）
export const OUT_OF_RANGE_COLOR = "#808080";
export const OUT_OF_RANGE_RGB: [number, number, number] = [128 / 255, 128 / 255, 128 / 255];

export interface ColorRange {
  lo: number; // カラースケール下端（この値未満はグレー）
  hi: number; // カラースケール上端（この値超はグレー）
  min: number; // データの生の最小値
  max: number; // データの生の最大値
}

// 有限値の min/max と、外れ値に頑健な自動レンジを求める。
// 全レンジ(max-min)がパーセンタイル幅の1.3倍を超える（＝外れ値でレンジが
// 引き伸ばされている）ときだけ 1〜99% に切替え、通常データでは min/max を使う。
export function robustRange(values: ArrayLike<number>): ColorRange {
  const n = values.length;
  let min = Infinity;
  let max = -Infinity;
  // パーセンタイル推定はソートコストを抑えるため最大10万点にサンプリング
  const stride = Math.max(1, Math.floor(n / 100_000));
  const sample: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (!isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
    if (i % stride === 0) sample.push(v);
  }
  if (!isFinite(min)) return { lo: 0, hi: 1, min: 0, max: 1 };

  sample.sort((a, b) => a - b);
  const q = (p: number) => sample[Math.round(p * (sample.length - 1))];
  const p01 = q(0.01);
  const p99 = q(0.99);
  if (p99 > p01 && max - min > (p99 - p01) * 1.3) {
    return { lo: p01, hi: p99, min, max };
  }
  return { lo: min, hi: max, min, max };
}

// 手動入力（空文字=自動）と自動レンジを合成して最終レンジを決める。
// min/max の片側だけの指定も可。min>=max になる不正入力は自動へフォールバック。
export function resolveColorRange(
  values: ArrayLike<number>,
  manualMin: string,
  manualMax: string
): ColorRange {
  const auto = robustRange(values);
  const mi = parseFloat(manualMin);
  const ma = parseFloat(manualMax);
  let lo = isFinite(mi) ? mi : auto.lo;
  let hi = isFinite(ma) ? ma : auto.hi;
  if (!(hi > lo)) {
    lo = auto.lo;
    hi = auto.hi;
  }
  return { lo, hi, min: auto.min, max: auto.max };
}

// Plotly 用のカラースケールと cmin/cmax を生成する。
// [lo, hi] に5段グラデーションを割り当て、データがレンジ外に出る側にだけ
// グレー帯（グラデーション幅の5%）を付ける。Plotly は cmin/cmax 外の値を
// 端の色にクランプするため、レンジ外の値は自動的にグレーで描かれる。
export function buildClippedColorscale(range: ColorRange): {
  colorscale: Array<[number, string]>;
  cmin: number;
  cmax: number;
  lo: number; // グラデーション下端（グレー帯を除く。カラーバーtick等に使う）
  hi: number; // グラデーション上端（同上）
} {
  const { lo, hi, min, max } = range;
  const span = hi - lo || 1;
  const hasBelow = min < lo;
  const hasAbove = max > hi;
  const band = span * 0.05;
  const cmin = hasBelow ? lo - band : lo;
  const cmax = hasAbove ? hi + band : hi;
  const total = cmax - cmin || 1;
  const tLo = (lo - cmin) / total;
  const tHi = (hi - cmin) / total;

  const colorscale: Array<[number, string]> = [];
  if (hasBelow) colorscale.push([0, OUT_OF_RANGE_COLOR], [tLo, OUT_OF_RANGE_COLOR]);
  for (const [t, c] of COLOR_STOPS) colorscale.push([tLo + t * (tHi - tLo), c]);
  if (hasAbove) colorscale.push([tHi, OUT_OF_RANGE_COLOR], [1, OUT_OF_RANGE_COLOR]);
  return { colorscale, cmin, cmax, lo, hi };
}

// three.js 用: 値→RGB(0-1)。レンジ外はグレー。
export function colorForValue(v: number, lo: number, hi: number): [number, number, number] {
  if (v < lo || v > hi) return OUT_OF_RANGE_RGB;
  const t = (v - lo) / (hi - lo || 1);
  const tt = Math.max(0, Math.min(1, t));
  for (let i = 1; i < COLOR_STOPS_RGB.length; i++) {
    if (tt <= COLOR_STOPS_RGB[i][0]) {
      const [t0, c0] = COLOR_STOPS_RGB[i - 1];
      const [t1, c1] = COLOR_STOPS_RGB[i];
      const f = (tt - t0) / (t1 - t0 || 1);
      return [
        (c0[0] + (c1[0] - c0[0]) * f) / 255,
        (c0[1] + (c1[1] - c0[1]) * f) / 255,
        (c0[2] + (c1[2] - c0[2]) * f) / 255,
      ];
    }
  }
  return [1, 0, 0];
}
