// 表示中の高さマップの統計（結果タブに出す）。値は physicalGrid で µm（または未校正 px）に換算済みのものを渡す。
// 有効率は「どの領域で数えたか」を必ず添える（中央50%×50% と 中央面積50% で値が大きく違うため）。

export interface ValidRates {
  full: number; // 全体
  center50: number; // 中央50%×50%（縦横それぞれ中央の半分）
  centerArea50: number; // 中央面積50%（縦横それぞれ中央の √0.5 ≒ 70.7%）
}

export interface HeightStats {
  count: number;
  mean: number;
  std: number;
  min: number;
  max: number;
  p1: number;
  p99: number;
  // 平面を当てて引いた残差の二乗平均平方根 / 算術平均（面のうねり・凹凸の大きさの目安）
  sq: number;
  sa: number;
}

// 縦横それぞれ中央 frac の矩形で有効画素の割合を数える
function validRateIn(grid: (number | null)[][], frac: number): number {
  const h = grid.length;
  const w = h > 0 ? grid[0].length : 0;
  if (h === 0 || w === 0) return 0;
  const r0 = Math.floor((h * (1 - frac)) / 2);
  const r1 = Math.max(r0 + 1, Math.ceil((h * (1 + frac)) / 2));
  const c0 = Math.floor((w * (1 - frac)) / 2);
  const c1 = Math.max(c0 + 1, Math.ceil((w * (1 + frac)) / 2));
  let valid = 0;
  for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) if (grid[r][c] != null) valid++;
  return valid / ((r1 - r0) * (c1 - c0));
}

export function validRates(grid: (number | null)[][]): ValidRates {
  return {
    full: validRateIn(grid, 1),
    center50: validRateIn(grid, 0.5),
    centerArea50: validRateIn(grid, Math.SQRT1_2),
  };
}

// 高さの統計。x/y は列・行の座標（µm）で、平面除去の当てはめに使う。
// 点が多いときは平面の当てはめとパーセンタイルを最大約20万点に間引いて求める
export function heightStats(z: (number | null)[][], x: number[], y: number[]): HeightStats | null {
  const h = z.length;
  const w = h > 0 ? z[0].length : 0;
  let count = 0;
  let sum = 0;
  let sum2 = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) {
      const v = z[r][c];
      if (v == null) continue;
      count++;
      sum += v;
      sum2 += v * v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  if (count < 3) return null;
  const mean = sum / count;
  const std = Math.sqrt(Math.max(0, sum2 / count - mean * mean));

  // 間引いた点でパーセンタイルと平面（z = a + b·x + c·y）を求める
  const step = Math.max(1, Math.floor(Math.sqrt(count / 200_000)));
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (let r = 0; r < h; r += step)
    for (let c = 0; c < w; c += step) {
      const v = z[r][c];
      if (v == null) continue;
      xs.push(x[c]);
      ys.push(y[r]);
      zs.push(v);
    }
  const sorted = [...zs].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

  // 座標は平均を引いてから当てはめる（µm の大きな値で正規方程式の桁落ちを避ける）
  const n = zs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const mz = zs.reduce((a, b) => a + b, 0) / n;
  let sxx = 0,
    sxy = 0,
    syy = 0,
    sxz = 0,
    syz = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    const dz = zs[i] - mz;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
    sxz += dx * dz;
    syz += dy * dz;
  }
  const det = sxx * syy - sxy * sxy;
  const b = Math.abs(det) > 1e-12 ? (sxz * syy - syz * sxy) / det : 0;
  const cc = Math.abs(det) > 1e-12 ? (syz * sxx - sxz * sxy) / det : 0;
  let res2 = 0;
  let resAbs = 0;
  for (let i = 0; i < n; i++) {
    const res = zs[i] - (mz + b * (xs[i] - mx) + cc * (ys[i] - my));
    res2 += res * res;
    resAbs += Math.abs(res);
  }
  return {
    count,
    mean,
    std,
    min,
    max,
    p1: q(0.01),
    p99: q(0.99),
    sq: Math.sqrt(res2 / n),
    sa: resAbs / n,
  };
}

// 粗さとして読める下限の目安[µm]（粗さ標準機の検証で、重心抽出のノイズフロア≈0.26µm、
// Ra が全等級 ≈0.2µm で頭打ち）。これを下回る Sa は分解能以下の可能性がある
export const ROUGHNESS_NOISE_FLOOR_UM = 0.26;
export const ROUGHNESS_WARN_SA_UM = 0.5;
