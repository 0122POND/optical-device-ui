// 幅を持たせた帯の断面。断面線から垂直方向に ±幅/2 以内の画素を集め、線に沿った距離で横から見る。
// 1本の線では欠損やノイズで途切れる断面も、帯の中央値なら形が読める（ばらつきは P10〜P90 で示す）。
// grid は µm 換算済み（physicalGrid の z）。列 c の位置 = c×colPitch、行 r の位置 = r×rowPitch [µm]。

export interface BandSection {
  // 帯の中の全画素（多いときは間引き）: 線に沿った距離 t[µm] と値
  t: number[];
  v: number[];
  // 距離ごとの中央値と P10・P90（ビン幅はピッチ程度）
  profT: number[];
  profMed: number[];
  profLo: number[];
  profHi: number[];
  // 帯の中の有効画素数（間引き前）
  count: number;
}

type Pt = { y: number; z: number };

const quantile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];

export function bandSection(
  grid: (number | null)[][],
  colPitch: number,
  rowPitch: number,
  start: Pt,
  end: Pt,
  widthUm: number,
  maxScatter = 40_000
): BandSection {
  const empty: BandSection = {
    t: [],
    v: [],
    profT: [],
    profMed: [],
    profLo: [],
    profHi: [],
    count: 0,
  };
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const len = Math.hypot(dy, dz);
  const rows = grid.length;
  const cols = rows > 0 ? grid[0].length : 0;
  if (len < 1e-9 || rows === 0 || cols === 0) return empty;
  const uy = dy / len;
  const uz = dz / len;
  const half = widthUm / 2;

  // 帯を囲む矩形の範囲だけ走査する
  const ys = [start.y, end.y].flatMap((y) => [y - half, y + half]);
  const zs = [start.z, end.z].flatMap((z) => [z - half, z + half]);
  const c0 = Math.max(0, Math.floor(Math.min(...ys) / colPitch));
  const c1 = Math.min(cols - 1, Math.ceil(Math.max(...ys) / colPitch));
  const r0 = Math.max(0, Math.floor(Math.min(...zs) / rowPitch));
  const r1 = Math.min(rows - 1, Math.ceil(Math.max(...zs) / rowPitch));

  const binW = Math.max(Math.min(colPitch, rowPitch), len / 2000);
  // 終点（t = 長さ）も独立したビンに入れる
  const nBins = Math.floor(len / binW) + 1;
  const bins: number[][] = Array.from({ length: nBins }, () => []);
  const allT: number[] = [];
  const allV: number[] = [];
  for (let r = r0; r <= r1; r++) {
    const pz = r * rowPitch - start.z;
    const row = grid[r];
    for (let c = c0; c <= c1; c++) {
      const v = row[c];
      if (v == null) continue;
      const py = c * colPitch - start.y;
      const t = py * uy + pz * uz;
      if (t < 0 || t > len) continue;
      if (Math.abs(py * uz - pz * uy) > half) continue;
      allT.push(t);
      allV.push(v);
      bins[Math.min(nBins - 1, Math.floor(t / binW))].push(v);
    }
  }
  if (allT.length === 0) return empty;

  const out: BandSection = { ...empty, count: allT.length };
  const stride = Math.max(1, Math.ceil(allT.length / maxScatter));
  for (let i = 0; i < allT.length; i += stride) {
    out.t.push(allT[i]);
    out.v.push(allV[i]);
  }
  bins.forEach((b, i) => {
    if (b.length === 0) return;
    b.sort((x, y) => x - y);
    out.profT.push((i + 0.5) * binW);
    out.profMed.push(quantile(b, 0.5));
    out.profLo.push(quantile(b, 0.1));
    out.profHi.push(quantile(b, 0.9));
  });
  return out;
}

// 2D 表示に描く帯の外形（閉じた四角形の y, z 座標）
export function bandOutline(start: Pt, end: Pt, widthUm: number): { y: number[]; z: number[] } {
  const len = Math.hypot(end.y - start.y, end.z - start.z) || 1;
  const ny = (-(end.z - start.z) / len) * (widthUm / 2);
  const nz = ((end.y - start.y) / len) * (widthUm / 2);
  const corners = [
    [start.y + ny, start.z + nz],
    [end.y + ny, end.z + nz],
    [end.y - ny, end.z - nz],
    [start.y - ny, start.z - nz],
    [start.y + ny, start.z + nz],
  ];
  return { y: corners.map((p) => p[0]), z: corners.map((p) => p[1]) };
}
