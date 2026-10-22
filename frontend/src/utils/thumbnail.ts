import { colors } from "./constants";
import type { PointCloud } from "./pointCloud";

// 点群から2Dサムネイル（data URL）を生成（測定履歴の一覧に出す）
export function generateThumbnail(pc: PointCloud, size = 64): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = colors.plotBg;
  ctx.fillRect(0, 0, size, size);

  const { y, z, x: depth } = pc;
  const n = y.length;
  if (n === 0) return canvas.toDataURL();

  // データ範囲を計算
  let yMin = y[0],
    yMax = y[0],
    zMin = z[0],
    zMax = z[0],
    dMin = depth[0],
    dMax = depth[0];
  for (let i = 1; i < n; i++) {
    if (y[i] < yMin) yMin = y[i];
    if (y[i] > yMax) yMax = y[i];
    if (z[i] < zMin) zMin = z[i];
    if (z[i] > zMax) zMax = z[i];
    if (depth[i] < dMin) dMin = depth[i];
    if (depth[i] > dMax) dMax = depth[i];
  }
  const yRange = yMax - yMin || 1;
  const zRange = zMax - zMin || 1;
  const dRange = dMax - dMin || 1;

  // アスペクト比を保ってfit（余白2px）
  const pad = 2;
  const drawSize = size - pad * 2;
  const scale = Math.min(drawSize / yRange, drawSize / zRange);
  const offY = (size - yRange * scale) / 2;
  const offZ = (size - zRange * scale) / 2;

  // カラースケール（青→水色→緑→黄→赤）
  const stops = [
    [0, 0, 255],
    [0, 191, 255],
    [0, 255, 0],
    [255, 191, 0],
    [255, 0, 0],
  ];
  const toColor = (t: number) => {
    const idx = t * (stops.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, stops.length - 1);
    const f = idx - lo;
    return `rgb(${stops[lo][0] + (stops[hi][0] - stops[lo][0]) * f},${stops[lo][1] + (stops[hi][1] - stops[lo][1]) * f},${stops[lo][2] + (stops[hi][2] - stops[lo][2]) * f})`;
  };

  // 間引き描画（多すぎる場合）
  const step = n > 20000 ? Math.ceil(n / 20000) : 1;
  for (let i = 0; i < n; i += step) {
    const px = offY + (y[i] - yMin) * scale;
    const py = size - (offZ + (z[i] - zMin) * scale);
    const t = (depth[i] - dMin) / dRange;
    ctx.fillStyle = toColor(t);
    ctx.fillRect(px, py, 1.2, 1.2);
  }
  return canvas.toDataURL("image/png");
}
