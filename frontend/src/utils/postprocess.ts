// 高さマップの後処理（アプリ内）。tools/remove_outliers.py と tools/interpolate_scan.py と同じ処理。
// grid[行][列] で、行の方向が走査方向（デバイスの CSV は 1スライス=1行）。
// 補った画素は filled に印を付ける（補間値は実測ではないので、精度評価に混ぜないため）。

type Grid = (number | null)[][];

// 正規分布で MAD×1.4826 ≈ σ
const MAD_TO_SIGMA = 1.4826;
// 走査方向のギャップ: 3行以下は線形、4〜8行は局所スプライン、9行以上は埋めない
export const MAX_LINEAR_GAP = 3;
export const MAX_SPLINE_GAP = 8;

export interface PostSettings {
  removeOutliers: boolean;
  sigma: number;
  // 外れ値の基準。local=近傍の中央値からのずれ（凹凸を残す・推奨）/ global=全体の中央値（tools と同じ）
  outlierBase: "local" | "global";
  interpolate: boolean;
}

export const POST_OFF: PostSettings = {
  removeOutliers: false,
  sigma: 3,
  outlierBase: "local",
  interpolate: false,
};

export const postActive = (p: PostSettings) => p.removeOutliers || p.interpolate;

export interface PostResult {
  grid: Grid;
  // 補間で埋めた画素（行×列、true=補間値）。補間していなければ null
  filled: boolean[][] | null;
  removed: number;
  filledLinear: number;
  filledSpline: number;
  skipped: number;
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const m = n >> 1;
  return n % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

// MAD（中央絶対偏差）で外れ値を欠損にする。統計は全体の有効値で取る（remove_outliers.py と同じ）
export function removeOutliersMAD(
  grid: Grid,
  sigma: number
): { grid: Grid; removed: number; median: number; threshold: number } {
  const vals: number[] = [];
  for (const row of grid) for (const v of row) if (v != null) vals.push(v);
  if (vals.length === 0) return { grid, removed: 0, median: NaN, threshold: NaN };
  vals.sort((a, b) => a - b);
  const med = median(vals);
  const dev = vals.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const threshold = sigma * MAD_TO_SIGMA * median(dev);
  let removed = 0;
  const out = grid.map((row) =>
    row.map((v) => {
      if (v == null) return null;
      if (Math.abs(v - med) > threshold) {
        removed++;
        return null;
      }
      return v;
    })
  );
  return { grid: out, removed, median: med, threshold };
}

// 近傍の中央値を基準にした外れ値除去（Hampel フィルタ）。同じ走査行の左右 ±radius 画素（自分を含む）の
// 有効値で中央値 m と MAD s を取り、|値−m| が σ×1.4826×s を超える点を欠損にする。硬貨の凹凸のように近くの
// 画素と一緒に高い・低い部分は残り、行の中で突き出た点だけが外れる。
// - 上下の行を窓に入れないのは、デバイスのデータに走査の行ごとの段差（横縞）があり、行ごと消えるため
//   （10円で上下を含めると除去が 9〜13% になった）
// - 自分を窓に入れるのは、段差の縁の画素で中央値が段差の中間になって縁が削られないため
// - s は窓ごと（段差や荒れた所では大きくなり、本物の凹凸を消しにくい）。s≈0 で過敏にならないよう、
//   面全体の s の中央値を下限にする
// 窓の有効値が minCount 未満の画素は判定できないので残す
export function removeOutliersLocal(
  grid: Grid,
  sigma: number,
  radius = 4,
  minCount = 5
): { grid: Grid; removed: number; threshold: number } {
  const rows = grid.length;
  const cols = rows > 0 ? grid[0].length : 0;
  const med: (number | null)[][] = grid.map((row) => row.map(() => null));
  const mad: (number | null)[][] = grid.map((row) => row.map(() => null));
  const buf: number[] = [];
  const allMad: number[] = [];
  for (let r = 0; r < rows; r++) {
    const row = grid[r];
    for (let c = 0; c < cols; c++) {
      if (row[c] == null) continue;
      buf.length = 0;
      for (let cc = Math.max(0, c - radius); cc <= Math.min(cols - 1, c + radius); cc++) {
        const u = row[cc];
        if (u != null) buf.push(u);
      }
      if (buf.length < minCount) continue;
      buf.sort((a, b) => a - b);
      const m = median(buf);
      for (let k = 0; k < buf.length; k++) buf[k] = Math.abs(buf[k] - m);
      buf.sort((a, b) => a - b);
      const s = median(buf);
      med[r][c] = m;
      mad[r][c] = s;
      allMad.push(s);
    }
  }
  if (allMad.length === 0) return { grid, removed: 0, threshold: NaN };
  allMad.sort((a, b) => a - b);
  const floor = median(allMad);
  let removed = 0;
  const out = grid.map((row, r) =>
    row.map((v, c) => {
      const m = med[r][c];
      const s = mad[r][c];
      if (v == null || m == null || s == null) return v;
      if (Math.abs(v - m) <= sigma * MAD_TO_SIGMA * Math.max(s, floor)) return v;
      removed++;
      return null;
    })
  );
  // 表示用の目安: ばらつきが面全体の典型値のときの閾値
  return { grid: out, removed, threshold: sigma * MAD_TO_SIGMA * floor };
}

// 自然境界の3次スプライン（x は昇順・不等間隔可）。scipy の CubicSpline(bc_type="natural") と同じ
function naturalCubicSpline(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length;
  const h = Array.from({ length: n - 1 }, (_, i) => xs[i + 1] - xs[i]);
  // 2階微分 m（両端 0）を三重対角方程式で解く
  const m = new Array<number>(n).fill(0);
  if (n > 2) {
    const a = new Array<number>(n).fill(0);
    const b = new Array<number>(n).fill(0);
    const c = new Array<number>(n).fill(0);
    const d = new Array<number>(n).fill(0);
    for (let i = 1; i < n - 1; i++) {
      a[i] = h[i - 1];
      b[i] = 2 * (h[i - 1] + h[i]);
      c[i] = h[i];
      d[i] = 6 * ((ys[i + 1] - ys[i]) / h[i] - (ys[i] - ys[i - 1]) / h[i - 1]);
    }
    for (let i = 2; i < n - 1; i++) {
      const w = a[i] / b[i - 1];
      b[i] -= w * c[i - 1];
      d[i] -= w * d[i - 1];
    }
    m[n - 2] = d[n - 2] / b[n - 2];
    for (let i = n - 3; i >= 1; i--) m[i] = (d[i] - c[i] * m[i + 1]) / b[i];
  }
  return (x: number) => {
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const t = xs[i + 1] - x;
    const u = x - xs[i];
    return (
      (m[i] * t ** 3 + m[i + 1] * u ** 3) / (6 * h[i]) +
      (ys[i] / h[i] - (m[i] * h[i]) / 6) * t +
      (ys[i + 1] / h[i] - (m[i + 1] * h[i]) / 6) * u
    );
  };
}

// 走査方向（行の方向）の欠損を埋める（interpolate_scan.py の interpolate_columns と同じ規則）
export function interpolateScan(grid: Grid): {
  grid: Grid;
  filled: boolean[][];
  linear: number;
  spline: number;
  skipped: number;
} {
  const rows = grid.length;
  const cols = rows > 0 ? grid[0].length : 0;
  const out: Grid = grid.map((row) => [...row]);
  const filled = grid.map((row) => row.map(() => false));
  let linear = 0;
  let spline = 0;
  let skipped = 0;

  const fillLinear = (col: number, g0: number, g1: number, before: number, after: number) => {
    const v0 = grid[before][col] as number;
    const v1 = grid[after][col] as number;
    for (let i = g0; i <= g1; i++) {
      out[i][col] = v0 + ((i - before) / (after - before)) * (v1 - v0);
      filled[i][col] = true;
    }
    linear += g1 - g0 + 1;
  };

  for (let col = 0; col < cols; col++) {
    const validIdx: number[] = [];
    for (let r = 0; r < rows; r++) if (grid[r][col] != null) validIdx.push(r);
    if (validIdx.length < 2) continue;

    // 有効データの範囲内のギャップ（両端の外側は埋めない）
    const first = validIdx[0];
    const last = validIdx[validIdx.length - 1];
    for (let r = first; r <= last; r++) {
      if (grid[r][col] != null) continue;
      const g0 = r;
      while (r + 1 <= last && grid[r + 1][col] == null) r++;
      const g1 = r;
      const size = g1 - g0 + 1;
      const before = g0 - 1;
      const after = g1 + 1;

      if (size <= MAX_LINEAR_GAP) {
        fillLinear(col, g0, g1, before, after);
      } else if (size <= MAX_SPLINE_GAP) {
        // ギャップの前後からそれぞれ最大5点ずつ使う局所スプライン
        const beforePts = validIdx.filter((i) => i < g0).slice(-5);
        const afterPts = validIdx.filter((i) => i > g1).slice(0, 5);
        const localIdx = [...beforePts, ...afterPts];
        if (localIdx.length < 4) {
          fillLinear(col, g0, g1, before, after);
          continue;
        }
        const localVals = localIdx.map((i) => grid[i][col] as number);
        const cs = naturalCubicSpline(localIdx, localVals);
        const interp: number[] = [];
        for (let i = g0; i <= g1; i++) interp.push(cs(i));
        // 近傍の有効値の範囲（±30%の余裕）から外れたらスプラインが暴れたとみなして線形にする
        const lo = Math.min(...localVals);
        const hi = Math.max(...localVals);
        const margin = (hi - lo) * 0.3;
        if (interp.every((v) => v >= lo - margin && v <= hi + margin)) {
          for (let i = g0; i <= g1; i++) {
            out[i][col] = interp[i - g0];
            filled[i][col] = true;
          }
          spline += size;
        } else {
          fillLinear(col, g0, g1, before, after);
        }
      } else {
        skipped += size;
      }
    }
  }
  return { grid: out, filled, linear, spline, skipped };
}

// 設定に従って 外れ値除去 → 走査方向の補間 の順に適用する
export function applyPostprocess(grid: Grid, p: PostSettings): PostResult {
  let g = grid;
  let removed = 0;
  if (p.removeOutliers) {
    const r =
      p.outlierBase === "global" ? removeOutliersMAD(g, p.sigma) : removeOutliersLocal(g, p.sigma);
    g = r.grid;
    removed = r.removed;
  }
  if (!p.interpolate)
    return { grid: g, filled: null, removed, filledLinear: 0, filledSpline: 0, skipped: 0 };
  const r = interpolateScan(g);
  return {
    grid: r.grid,
    filled: r.filled,
    removed,
    filledLinear: r.linear,
    filledSpline: r.spline,
    skipped: r.skipped,
  };
}

// 表示の向きに合わせた補間画素の印（CSV の左右反転は physicalGrid と同じく列を逆順にする）
export function orientFilled(
  filled: boolean[][] | null,
  source: "device" | "csv",
  flipX: boolean
): boolean[][] | null {
  if (!filled) return null;
  return source === "csv" && flipX ? filled.map((row) => [...row].reverse()) : filled;
}
