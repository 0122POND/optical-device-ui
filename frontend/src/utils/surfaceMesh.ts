// 高さマップ → three.js メッシュ用バッファの生成（ThreeSurfaceMeshView 用の純粋関数群）。
// tools/surface_viewer.html と同じ処理を TypeScript に移したもの。

export type Detrend = "none" | "plane" | "quad";
export type MeshColormap = "turbo" | "viridis" | "metal";

// 最小二乗で平面 / 2次曲面を当てて引く（大域的な傾き・すり鉢を消して起伏を見せる）。
// 入力は行優先の Float32Array（NaN=欠損）で、欠損は NaN のまま返す。
export function detrendHeights(z: Float32Array, w: number, h: number, mode: Detrend): Float32Array {
  const out = new Float32Array(z);
  if (mode === "none") return out;
  const basis =
    mode === "plane"
      ? (x: number, y: number) => [1, x, y]
      : (x: number, y: number) => [1, x, y, x * x, x * y, y * y];
  const n = mode === "plane" ? 3 : 6;
  const A = new Float64Array(n * n);
  const b = new Float64Array(n);
  // フィットは最大約20万点に間引いて行う
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 200_000)));
  let count = 0;
  for (let r = 0; r < h; r += step) {
    for (let c = 0; c < w; c += step) {
      const v = z[r * w + c];
      if (Number.isNaN(v)) continue;
      const f = basis(c / w - 0.5, r / h - 0.5);
      for (let i = 0; i < n; i++) {
        b[i] += f[i] * v;
        for (let j = 0; j < n; j++) A[i * n + j] += f[i] * f[j];
      }
      count++;
    }
  }
  if (count < n) return out;
  const coef = solveLinear(A, b, n);
  if (!coef) return out;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const k = r * w + c;
      if (Number.isNaN(z[k])) continue;
      const f = basis(c / w - 0.5, r / h - 0.5);
      let t = 0;
      for (let i = 0; i < n; i++) t += coef[i] * f[i];
      out[k] = z[k] - t;
    }
  }
  return out;
}

// ガウス消去（部分ピボット）。特異なら null
function solveLinear(A0: Float64Array, b0: Float64Array, n: number): Float64Array | null {
  const A = A0.slice();
  const b = b0.slice();
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(A[k * n + i]) > Math.abs(A[p * n + i])) p = k;
    if (Math.abs(A[p * n + i]) < 1e-12) return null;
    for (let j = 0; j < n; j++) [A[i * n + j], A[p * n + j]] = [A[p * n + j], A[i * n + j]];
    [b[i], b[p]] = [b[p], b[i]];
    for (let k = i + 1; k < n; k++) {
      const f = A[k * n + i] / A[i * n + i];
      for (let j = i; j < n; j++) A[k * n + j] -= f * A[i * n + j];
      b[k] -= f * b[i];
    }
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i * n + j] * x[j];
    x[i] = s / A[i * n + i];
  }
  return x;
}

// パーセンタイル（NaN除外、最大約20万点サンプリング）。有効値が無ければ 0
export function percentileOf(arr: Float32Array, p: number): number {
  const v: number[] = [];
  const step = Math.max(1, Math.floor(arr.length / 200_000));
  for (let i = 0; i < arr.length; i += step) if (!Number.isNaN(arr[i])) v.push(arr[i]);
  if (v.length === 0) return 0;
  v.sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

// カラーマップ（多項式近似、sRGB 0〜1）
export const MESH_COLORMAPS: Record<MeshColormap, (t: number) => [number, number, number]> = {
  turbo: (t) => [
    clamp01(
      0.13572138 +
        t *
          (4.6153926 +
            t * (-42.66032258 + t * (132.13108234 + t * (-152.94239396 + t * 59.28637943))))
    ),
    clamp01(
      0.09140261 +
        t * (2.19418839 + t * (4.84296658 + t * (-14.18503333 + t * (4.27729857 + t * 2.82956604))))
    ),
    clamp01(
      0.1066733 +
        t *
          (12.64194608 +
            t * (-60.58204836 + t * (110.36276771 + t * (-89.90310912 + t * 27.34824973))))
    ),
  ],
  viridis: (t) => [
    clamp01(
      0.2777273 +
        t *
          (0.105093 +
            t *
              (-0.3308618 + t * (-4.6342305 + t * (6.2282699 + t * (4.7763849 + t * -5.4354559)))))
    ),
    clamp01(
      0.0054073 +
        t *
          (1.4046134 +
            t *
              (0.2148476 + t * (-5.7991009 + t * (14.1799334 + t * (-13.7451454 + t * 4.6458526)))))
    ),
    clamp01(
      0.3340998 +
        t *
          (1.3845901 +
            t *
              (0.0950952 +
                t * (-19.3324409 + t * (56.6905526 + t * (-65.3530326 + t * 26.3124352)))))
    ),
  ],
  metal: () => [0.8, 0.81, 0.84],
};

// 2Dグリッド（null=欠損）→ 行優先 Float32Array（NaN=欠損）
export function gridToHeights(grid: (number | null)[][]): {
  z: Float32Array;
  w: number;
  h: number;
} {
  const h = grid.length;
  const w = h > 0 ? grid[0].length : 0;
  const z = new Float32Array(w * h);
  for (let r = 0; r < h; r++) {
    const row = grid[r];
    for (let c = 0; c < w; c++) {
      const v = row[c];
      z[r * w + c] = v == null || !Number.isFinite(v) ? NaN : v;
    }
  }
  return { z, w, h };
}

// 三角形インデックス: 4隅のうち有効な3点以上で三角形を張る（欠損の縁がギザギザになりにくい）
export function buildTriangleIndex(z: Float32Array, w: number, h: number): Uint32Array {
  const idx = new Uint32Array(Math.max(0, (w - 1) * (h - 1) * 6));
  let n = 0;
  const ok = (k: number) => !Number.isNaN(z[k]);
  for (let r = 0; r < h - 1; r++) {
    for (let c = 0; c < w - 1; c++) {
      const a = r * w + c;
      const b = a + 1;
      const d = a + w;
      const e = d + 1;
      const A = ok(a);
      const B = ok(b);
      const D = ok(d);
      const E = ok(e);
      if (A && B && D && E) {
        idx[n++] = a;
        idx[n++] = d;
        idx[n++] = b;
        idx[n++] = b;
        idx[n++] = d;
        idx[n++] = e;
      } else if (A && B && D) {
        idx[n++] = a;
        idx[n++] = d;
        idx[n++] = b;
      } else if (B && D && E) {
        idx[n++] = b;
        idx[n++] = d;
        idx[n++] = e;
      } else if (A && D && E) {
        idx[n++] = a;
        idx[n++] = d;
        idx[n++] = e;
      } else if (A && B && E) {
        idx[n++] = a;
        idx[n++] = e;
        idx[n++] = b;
      }
    }
  }
  return idx.slice(0, n);
}

// 見やすい刻み（1, 2, 5 × 10^n）に丸める。等高線間隔に使う
export function niceStep(x: number): number {
  if (!(x > 0)) return 1;
  const e = 10 ** Math.floor(Math.log10(x));
  const m = x / e;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * e;
}
