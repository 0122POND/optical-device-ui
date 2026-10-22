// 幅を持たせた帯の断面。断面線から垂直方向に ±幅/2 以内の画素を集め、線に沿った距離で横から見る。
// 1本の線では欠損やノイズで途切れる断面も、帯の中央値なら形が読める（ばらつきは P10〜P90 で示す）。
// grid は µm 換算済み（physicalGrid の z）。列 c の位置 = c×colPitch、行 r の位置 = r×rowPitch [µm]。

// 線の断面。線に沿って一定の間隔（ピッチの小さい方）で双一次補間（周りの4画素）した値を返す。
// 4画素のどれかが欠損なら最寄りの画素、それも欠損なら null（グラフの線はそこで切れる。以前は
// 欠損をまたいで直線でつないでおり、値があるように見えていた）
export function lineSection(
  grid: (number | null)[][],
  colPitch: number,
  rowPitch: number,
  start: Pt,
  end: Pt
): { t: number[]; v: (number | null)[] } {
  const rows = grid.length;
  const cols = rows > 0 ? grid[0].length : 0;
  const len = Math.hypot(end.y - start.y, end.z - start.z);
  if (len < 1e-9 || rows === 0 || cols === 0) return { t: [], v: [] };
  const step = Math.min(colPitch, rowPitch);
  const n = Math.max(2, Math.ceil(len / step) + 1);
  const at = (r: number, c: number) =>
    r >= 0 && r < rows && c >= 0 && c < cols ? grid[r][c] : null;
  const t: number[] = [];
  const v: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    const cf = (start.y + (end.y - start.y) * f) / colPitch;
    const rf = (start.z + (end.z - start.z) * f) / rowPitch;
    // 範囲外（端より半画素以上外）は値なし
    if (cf < -0.5 || rf < -0.5 || cf > cols - 0.5 || rf > rows - 0.5) {
      t.push(len * f);
      v.push(null);
      continue;
    }
    const c0 = Math.floor(cf);
    const r0 = Math.floor(rf);
    const fx = cf - c0;
    const fz = rf - r0;
    const a = at(r0, c0);
    const b = at(r0, c0 + 1);
    const c = at(r0 + 1, c0);
    const d = at(r0 + 1, c0 + 1);
    let val: number | null;
    if (a != null && b != null && c != null && d != null) {
      val = (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
    } else {
      val = at(Math.round(rf), Math.round(cf));
    }
    t.push(len * f);
    v.push(val);
  }
  return { t, v };
}

export interface BandSection {
  // 帯の中の全画素（多いときは間引き）: 線に沿った距離 t[µm] と値
  t: number[];
  v: number[];
  // 距離ごとの中央値と P10・P90（ビン幅はピッチ程度）
  // 画素の無いビンは null（線と P10〜P90 の帯がそこで切れる）
  profT: number[];
  profMed: (number | null)[];
  profLo: (number | null)[];
  profHi: (number | null)[];
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
    out.profT.push((i + 0.5) * binW);
    if (b.length === 0) {
      out.profMed.push(null);
      out.profLo.push(null);
      out.profHi.push(null);
      return;
    }
    b.sort((x, y) => x - y);
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
