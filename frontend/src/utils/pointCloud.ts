// src/utils/pointCloud.ts
export type PointCloud = {
  x: number[];
  y: number[];
  z: number[];
  c: number[]; // color (0-255 or z)
};

type Manifest = { files: string[] };

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
  flipZ?: boolean; // 例: true
  colorMode?: "z" | "intensity";
}): Promise<{ cloud: PointCloud; width: number; height: number; depth: number }> {
  const {
    folderUrl,
    manifestName = "manifest.json",
    threshold,
    samplePerSlice,
    flipZ = true,
    colorMode = "z",
  } = options;

  const manifestUrl = `${folderUrl}/${manifestName}`;
  const manRes = await fetch(manifestUrl);
  if (!manRes.ok) throw new Error(`manifest.json が読めません: ${manifestUrl}`);
  const manifest = (await manRes.json()) as Manifest;

  const files = manifest.files ?? [];
  if (files.length === 0) throw new Error("manifest.json に files がありません");

  const D = files.length;

  const x: number[] = [];
  const y: number[] = [];
  const z: number[] = [];
  const c: number[] = [];

  let width = 0;
  let height = 0;

  for (let zi = 0; zi < D; zi++) {
    const file = files[zi];
    const url = `${folderUrl}/${file}`;

    const imgData = await loadImageAsImageData(url);
    width = imgData.width;
    height = imgData.height;

    const sampled = samplePointsFromImageData(
      imgData.data,
      imgData.width,
      imgData.height,
      zi,
      threshold,
      samplePerSlice
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

  return { cloud: { x, y, z, c }, width, height, depth: D };
}
