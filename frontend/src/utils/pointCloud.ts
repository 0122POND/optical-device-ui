// src/utils/pointCloud.ts
export type PointCloud = {
  x: number[];
  y: number[];
  z: number[];
  c: number[]; // color (0-255 or z)
};

export type DepthGrid = (number | null)[][];

type Manifest = { files: string[] };

// 同じ行の中で、この画素数以下の隙間しか空いていない区間は1本の縞として結合する
//（縞の途切れや細い抜けで1本が複数層に誤判定されるのを防ぐ）
const LAYER_MERGE_GAP_PX = 3;

// 複数層の行が有効行のこの割合以上あるときだけ「複数層データ」とみなし、点群形式で出力する。
// AIマスクには本線から離れた線状ノイズで複数層になる行が0.03〜0.7%あり（硬貨データで実測）、
// 1行でもあれば…という判定では1層のデータまで点群形式になるため。
// 断層・内部構造なら広い範囲に層が出る前提の仮の値で、実データで要調整
export const MULTI_LAYER_MIN_RATIO = 0.05;

// 1枚のスライス画像の各y行を、threshold超え画素の連続区間（=縞1本=1層）に分け、
// 区間ごとの輝度加重x重心を求める。
// - row: 高さマップ1行分。区間が1つならその重心、0または2つ以上なら null
//   （複数層を平均すると層の間の何もない位置になるため、欠損として扱う）
// - layerYs/layerXs: 全区間の (y, 重心x)。複数層のときの点群出力に使う
// - validRows/multiRows: 区間を1つ以上持つ行数 / 2つ以上持つ行数
export function extractRowLayers(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number
): {
  row: (number | null)[];
  layerYs: number[];
  layerXs: number[];
  validRows: number;
  multiRows: number;
} {
  const row: (number | null)[] = new Array(height);
  const layerYs: number[] = [];
  const layerXs: number[] = [];
  let validRows = 0;
  let multiRows = 0;
  for (let yy = 0; yy < height; yy++) {
    let runs = 0;
    let sumX = 0;
    let sumW = 0;
    let lastX = -Infinity;
    const flush = () => {
      layerYs.push(yy);
      layerXs.push(sumX / sumW);
      runs++;
    };
    for (let xx = 0; xx < width; xx++) {
      const i = (yy * width + xx) * 4;
      const v = data[i]; // R
      if (v <= threshold) continue;
      if (sumW > 0 && xx - lastX - 1 > LAYER_MERGE_GAP_PX) {
        flush();
        sumX = 0;
        sumW = 0;
      }
      sumX += xx * v;
      sumW += v;
      lastX = xx;
    }
    if (sumW > 0) flush();
    row[yy] = runs === 1 ? layerXs[layerXs.length - 1] : null;
    if (runs > 0) validRows++;
    if (runs > 1) multiRows++;
  }
  return { row, layerYs, layerXs, validRows, multiRows };
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

export type FolderSource = {
  folderUrl: string; // 例: "/data/result_coin_ruined"
  manifestName?: string; // 例: "manifest.json"
  threshold: number; // 例: 128
  samplePerSlice: number; // 例: 4000
  maxTotalPoints?: number; // 総点数の上限（デフォルト: 100000）
  flipZ?: boolean; // 例: true
  colorMode?: "z" | "intensity";
};

// バックエンドが結果フォルダに置く処理条件（backend/depth_export.py の depth_meta.json）
export type DepthMeta = {
  version: number;
  created_at?: string;
  // サブピクセルの深さファイル名（depth_grid.f32）。無ければ結果画像の重心から深さを求める
  depth_grid: string | null;
  shape: [number, number] | null; // [フレーム数, 画像の行数]
  source?: "preprocess" | "ai_inference";
  depth_method?: string; // argmax+parabolic3 / prob_centroid
  algorithm?: string;
  use_gpu?: boolean;
  peak_threshold?: number;
  blur?: { sweep_sigma?: number; xy_sigma?: number };
  model_type?: string;
  threshold?: number;
  device?: string;
  input_dir?: string;
  note?: string;
};

// depth_grid.f32（float32 リトルエンディアン、[フレーム数, 行数]、欠損は NaN）を高さマップの行に変換する
export function depthGridFromBuffer(
  buf: ArrayBuffer,
  shape: [number, number]
): (number | null)[][] {
  const [n, h] = shape;
  const dv = new DataView(buf);
  if (buf.byteLength < n * h * 4)
    throw new Error("depth_grid.f32 の大きさが depth_meta.json と合いません");
  const rows: (number | null)[][] = [];
  for (let i = 0; i < n; i++) {
    const row: (number | null)[] = new Array(h);
    for (let j = 0; j < h; j++) {
      const v = dv.getFloat32((i * h + j) * 4, true);
      row[j] = Number.isNaN(v) ? null : v;
    }
    rows.push(row);
  }
  return rows;
}

// buildPointCloudFromFolder の戻り値。layers は複数層の行が MULTI_LAYER_MIN_RATIO 以上あるときだけ、
// 全スライス・全行の層ごとの重心点（PointCloud 規約: x=重心, y=行, z=スライス）。
// 1層だけのデータでは null（高さマップで表せるため）
export type FolderCloudResult = {
  cloud: PointCloud;
  grid: DepthGrid;
  layers: PointCloud | null;
  // 処理条件（depth_meta.json が無いフォルダでは null）
  meta: DepthMeta | null;
  // 高さマップの深さの求め方。subpixel=バックエンドのサブピクセル値 / centroid=結果画像の重心（従来）
  depthSource: "subpixel" | "centroid";
  width: number;
  height: number;
  depth: number;
};

export async function buildPointCloudFromFolder(options: FolderSource): Promise<FolderCloudResult> {
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

  // サブピクセルの深さと処理条件（あれば使う。無い・壊れている場合は従来どおり画像の重心から求める）
  let meta: DepthMeta | null = null;
  let subpixelRows: (number | null)[][] | null = null;
  try {
    const metaRes = await fetch(`${folderUrl}/depth_meta.json?t=${cacheKey}`);
    if (metaRes.ok) {
      meta = (await metaRes.json()) as DepthMeta;
      if (meta.depth_grid && meta.shape && meta.shape[0] === D) {
        const gridRes = await fetch(`${folderUrl}/${meta.depth_grid}?t=${cacheKey}`);
        if (gridRes.ok) subpixelRows = depthGridFromBuffer(await gridRes.arrayBuffer(), meta.shape);
      }
    }
  } catch (e) {
    console.warn(
      "depth_meta.json / depth_grid.f32 を読めなかったため、画像の重心から深さを求めます",
      e
    );
    subpixelRows = null;
  }

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
  // 層ごとの重心点（複数層のときの点群出力用）
  const lx: number[] = [];
  const ly: number[] = [];
  const lz: number[] = [];
  let validRows = 0;
  let multiRows = 0;

  for (let zi = 0; zi < D; zi++) {
    const file = files[zi];
    const url = `${folderUrl}/${file}?t=${cacheKey}`;

    const imgData = await loadImageAsImageData(url);
    width = imgData.width;
    height = imgData.height;

    // グリッド行と層ごとの重心を構築（サンプリング前の全ピクセルから）
    const rowLayers = extractRowLayers(imgData.data, width, height, threshold);
    gridRows.push(rowLayers.row);
    validRows += rowLayers.validRows;
    multiRows += rowLayers.multiRows;
    const layerZ = flipZ ? D - 1 - zi : zi;
    for (let k = 0; k < rowLayers.layerXs.length; k++) {
      lx.push(rowLayers.layerXs[k]);
      ly.push(rowLayers.layerYs[k]);
      lz.push(layerZ);
    }

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
  // サブピクセルの深さが画像の大きさと合っていれば、高さマップはそちらを使う
  const useSubpixel = subpixelRows !== null && meta?.shape?.[1] === height;
  const rows = useSubpixel ? subpixelRows! : gridRows;
  const depthSource: FolderCloudResult["depthSource"] = useSubpixel ? "subpixel" : "centroid";
  const grid: DepthGrid = flipZ ? rows.reverse() : rows;
  const multiLayer = validRows > 0 && multiRows / validRows >= MULTI_LAYER_MIN_RATIO;
  const layers: PointCloud | null = multiLayer ? { x: lx, y: ly, z: lz, c: lx } : null;

  // 総点数が上限を超えた場合、ボクセル(グリッド)間引きで均一に減らす。
  // ランダム間引きは密度ムラで面が「ノイズ」に見えるため廃止。
  if (x.length > maxTotalPoints) {
    const cloud = voxelDownsample(x, y, z, c, maxTotalPoints);
    return { cloud, grid, layers, meta, depthSource, width, height, depth: D };
  }

  return { cloud: { x, y, z, c }, grid, layers, meta, depthSource, width, height, depth: D };
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

// CSV由来の2Dグリッドから、有効点を最大 maxPoints 個までランダムに間引いた点群を作る
// （Plotly surface/scatter3d 用）。展開と間引きを1パスで行う reservoir sampling。
// 全有効点を一旦配列に展開→全インデックスをシャッフルする旧方式は、巨大CSVで
// メインスレッドを数秒凍結させた。上限件数だけを保持しながら走査することで、
// 確保するメモリ・計算量を点数ではなく上限値に比例させる。
// 間引きが発生した場合はサンプルを元の出現順（行→列）に並べ直して返す。
// x=高さ値, y=列, z=行, c=高さ値（c は x と同一配列を共有）。有効点が0なら空の点群。
// rng はテスト用に差し替え可能（既定 Math.random）。
export function sampledPointsFromGrid(
  grid: (number | null)[][],
  maxPoints: number,
  rng: () => number = Math.random
): PointCloud {
  const sx: number[] = [];
  const sy: number[] = [];
  const sz: number[] = [];
  const sseq: number[] = []; // 各サンプルの元の出現順（間引き後に並び順を復元するため）
  let seen = 0; // これまでに見た有効点の数
  for (let row = 0; row < grid.length; row++) {
    const gridRow = grid[row];
    for (let col = 0; col < gridRow.length; col++) {
      const v = gridRow[col];
      if (v == null) continue;
      if (seen < maxPoints) {
        sx.push(v);
        sy.push(col);
        sz.push(row);
        sseq.push(seen);
      } else {
        // 既に上限に達している場合は確率 maxPoints/(seen+1) で既存サンプルと置換
        const j = Math.floor(rng() * (seen + 1));
        if (j < maxPoints) {
          sx[j] = v;
          sy[j] = col;
          sz[j] = row;
          sseq[j] = seen;
        }
      }
      seen++;
    }
  }
  if (seen <= maxPoints) return { x: sx, y: sy, z: sz, c: sx };

  const order = Array.from({ length: maxPoints }, (_, i) => i).sort((a, b) => sseq[a] - sseq[b]);
  const cx = order.map((i) => sx[i]);
  return { x: cx, y: order.map((i) => sy[i]), z: order.map((i) => sz[i]), c: cx };
}

// 任意の点群から最大 maxPoints 点をランダムに間引く（点群形式CSV用、reservoir sampling）。
// 間引いた点は元の並び順のまま返す。点数が上限以下ならそのまま返す。
// rng はテスト用に差し替え可能（既定 Math.random）。
export function samplePointCloud(
  cloud: PointCloud,
  maxPoints: number,
  rng: () => number = Math.random
): PointCloud {
  const n = cloud.x.length;
  if (n <= maxPoints) return cloud;
  const idx = Array.from({ length: maxPoints }, (_, i) => i);
  for (let i = maxPoints; i < n; i++) {
    const j = Math.floor(rng() * (i + 1));
    if (j < maxPoints) idx[j] = i;
  }
  idx.sort((a, b) => a - b);
  return {
    x: idx.map((i) => cloud.x[i]),
    y: idx.map((i) => cloud.y[i]),
    z: idx.map((i) => cloud.z[i]),
    c: idx.map((i) => cloud.c[i]),
  };
}
