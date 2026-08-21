// src/utils/pointCloud.ts
export type PointCloud = {
  x: number[];
  y: number[];
  z: number[];
  c: number[]; // color (0-255 or z)
};

export type DepthGrid = (number | null)[][];

type Manifest = { files: string[] };

// 1枚のスライス画像から各y列の深度（輝度加重x重心）を算出
function buildGridRowFromImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number
): (number | null)[] {
  const row: (number | null)[] = new Array(height);
  for (let yy = 0; yy < height; yy++) {
    let sumX = 0;
    let sumW = 0;
    for (let xx = 0; xx < width; xx++) {
      const i = (yy * width + xx) * 4;
      const v = data[i]; // R
      if (v <= threshold) continue;
      sumX += xx * v;
      sumW += v;
    }
    row[yy] = sumW > 0 ? sumX / sumW : null;
  }
  return row;
}

// 1枚の画像から「threshold超え」の点を最大 samplePerSlice 個だけ取る（reservoir sampling）
function samplePointsFromImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  zIndex: number,
  threshold: number,
  samplePerSlice: number
) {
  // reservoir
  const xs: number[] = [];
  const ys: number[] = [];
  const cs: number[] = [];
  let seen = 0;

  // RGBA の R を使う（グレースケールbmpなら R=G=B）
  for (let yy = 0; yy < height; yy++) {
    for (let xx = 0; xx < width; xx++) {
      const i = (yy * width + xx) * 4;
      const v = data[i]; // R
      if (v <= threshold) continue;

      seen++;
      if (xs.length < samplePerSlice) {
        xs.push(xx);
        ys.push(yy);
        cs.push(v);
      } else {
        // reservoir: 1/seen の確率で置き換え
        const j = Math.floor(Math.random() * seen);
        if (j < samplePerSlice) {
          xs[j] = xx;
          ys[j] = yy;
          cs[j] = v;
        }
      }
    }
  }

  return { xs, ys, cs, zIndex };
}

// ボクセル(グリッド)間引き: 空間を格子で区切り、各セルにつき代表1点だけ残す。
// ランダム間引きと違い密度が均一になり、面としての見栄えが保たれる。
function voxelDownsample(
  x: number[],
  y: number[],
  z: number[],
  c: number[],
  targetCount: number
): PointCloud {
  const n = x.length;
  if (n <= targetCount) return { x, y, z, c };

  // バウンディングボックス
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    if (x[i] < minX) minX = x[i];
    if (x[i] > maxX) maxX = x[i];
    if (y[i] < minY) minY = y[i];
    if (y[i] > maxY) maxY = y[i];
    if (z[i] < minZ) minZ = z[i];
    if (z[i] > maxZ) maxZ = z[i];
  }
  const dx = Math.max(1e-6, maxX - minX);
  const dy = Math.max(1e-6, maxY - minY);
  const dz = Math.max(1e-6, maxZ - minZ);

  // 各ボクセルの先頭点を代表として拾う（vv = ボクセル一辺）
  const pick = (vv: number): number[] => {
    const inv = 1 / vv;
    const ny = Math.floor(dy * inv) + 1;
    const nz = Math.floor(dz * inv) + 1;
    const map = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const ix = Math.floor((x[i] - minX) * inv);
      const iy = Math.floor((y[i] - minY) * inv);
      const iz = Math.floor((z[i] - minZ) * inv);
      const key = (ix * ny + iy) * nz + iz;
      if (!map.has(key)) map.set(key, i);
    }
    return Array.from(map.values());
  };

  // 占有ボクセル数が targetCount 前後になる一辺を反復探索（占有数は vv に対し単調減少）
  let vv = Math.cbrt((dx * dy * dz) / targetCount) || 1;
  let selected = pick(vv);
  for (
    let iter = 0;
    iter < 8 && (selected.length > targetCount * 1.15 || selected.length < targetCount * 0.7);
    iter++
  ) {
    vv *= Math.cbrt(selected.length / targetCount);
    if (!isFinite(vv) || vv <= 0) break;
    selected = pick(vv);
  }

  // 上限を厳守（超過時は均一ストライドで削る＝密度を保ったまま数を合わせる）
  if (selected.length > targetCount) {
    const step = selected.length / targetCount;
    const trimmed: number[] = [];
    for (let i = 0; i < targetCount; i++) trimmed.push(selected[Math.floor(i * step)]);
    selected = trimmed;
  }

  // スライス(配列)順に安定ソートしてから詰め直す
  selected.sort((a, b) => a - b);
  const rx = new Array(selected.length);
  const ry = new Array(selected.length);
  const rz = new Array(selected.length);
  const rc = new Array(selected.length);
  for (let i = 0; i < selected.length; i++) {
    const idx = selected[i];
    rx[i] = x[idx];
    ry[i] = y[idx];
    rz[i] = z[idx];
    rc[i] = c[idx];
  }
  return { x: rx, y: ry, z: rz, c: rc };
}

async function loadImageAsImageData(url: string): Promise<ImageData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch: ${url}`);
  const blob = await res.blob();

  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2D context not available");

  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export async function buildPointCloudFromFolder(options: {
  folderUrl: string; // 例: "/data/result_coin_ruined"
  manifestName?: string; // 例: "manifest.json"
  threshold: number; // 例: 128
  samplePerSlice: number; // 例: 4000
  maxTotalPoints?: number; // 総点数の上限（デフォルト: 100000）
  flipZ?: boolean; // 例: true
  colorMode?: "z" | "intensity";
}): Promise<{ cloud: PointCloud; grid: DepthGrid; width: number; height: number; depth: number }> {
  const {
    folderUrl,
    manifestName = "manifest.json",
    threshold,
    samplePerSlice,
    maxTotalPoints = 120_000,
    flipZ = true,
    colorMode = "z",
  } = options;

  const cacheKey = Date.now();
  const manifestUrl = `${folderUrl}/${manifestName}?t=${cacheKey}`;
  const manRes = await fetch(manifestUrl);
  if (!manRes.ok) throw new Error(`manifest.json が読めません: ${manifestUrl}`);
  const manifest = (await manRes.json()) as Manifest;

  const files = manifest.files ?? [];
  if (files.length === 0) throw new Error("manifest.json に files がありません");

  const D = files.length;

  // ボクセル間引き前に、最終目標の約3倍まで収集して均一化の余地を残す
  // （スライス数Dで割ってメモリ上限も兼ねる）
  const collectPerSlice = Math.max(1, Math.ceil((maxTotalPoints * 3) / D));
  const effectiveSamplePerSlice = Math.min(samplePerSlice, collectPerSlice);

  const x: number[] = [];
  const y: number[] = [];
  const z: number[] = [];
  const c: number[] = [];

  let width = 0;
  let height = 0;

  // グリッド: grid[z][y] = 輝度加重x重心（断面プロファイル用）
  const gridRows: (number | null)[][] = [];

  for (let zi = 0; zi < D; zi++) {
    const file = files[zi];
    const url = `${folderUrl}/${file}?t=${cacheKey}`;

    const imgData = await loadImageAsImageData(url);
    width = imgData.width;
    height = imgData.height;

    // グリッド行を構築（サンプリング前の全ピクセルから）
    gridRows.push(buildGridRowFromImageData(imgData.data, width, height, threshold));

    const sampled = samplePointsFromImageData(
      imgData.data,
      imgData.width,
      imgData.height,
      zi,
      threshold,
      effectiveSamplePerSlice
    );

    // Z反転（Python版と同じ）
    const zz = flipZ ? D - 1 - sampled.zIndex : sampled.zIndex;

    for (let i = 0; i < sampled.xs.length; i++) {
      x.push(sampled.xs[i]);
      y.push(sampled.ys[i]);
      z.push(zz);
      c.push(colorMode === "z" ? zz : sampled.cs[i]);
    }
  }

  // flipZ時はグリッド行も反転
  const grid: DepthGrid = flipZ ? gridRows.reverse() : gridRows;

  // 総点数が上限を超えた場合、ボクセル(グリッド)間引きで均一に減らす。
  // ランダム間引きは密度ムラで面が「ノイズ」に見えるため廃止。
  if (x.length > maxTotalPoints) {
    const cloud = voxelDownsample(x, y, z, c, maxTotalPoints);
    return { cloud, grid, width, height, depth: D };
  }

  return { cloud: { x, y, z, c }, grid, width, height, depth: D };
}

// CSV由来の2Dグリッド(高さマップ)から高密度点群を作る。
// three.js 用に上限を大きく取り、超過時は 2D グリッドを均一ストライドで間引く
// （ランダムでなく等間隔なので密度が保たれる）。x=高さ値, y=列, z=行, c=高さ値。
export function densePointsFromGrid(grid: (number | null)[][], maxPoints = 2_000_000): PointCloud {
  let valid = 0;
  for (const row of grid) for (const v of row) if (v != null) valid++;
  const step = valid > maxPoints ? Math.max(1, Math.round(Math.sqrt(valid / maxPoints))) : 1;

  const x: number[] = [];
  const y: number[] = [];
  const z: number[] = [];
  const c: number[] = [];
  for (let r = 0; r < grid.length; r += step) {
    const gr = grid[r];
    for (let col = 0; col < gr.length; col += step) {
      const v = gr[col];
      if (v == null) continue;
      x.push(v);
      y.push(col);
      z.push(r);
      c.push(v);
    }
  }
  return { x, y, z, c };
}
