// Plotly の Surface 表示用に高さマップを間引く（表示だけ。断面・統計・CSV出力・後処理は元の解像度のまま）。
// Plotly の 3D シーンは更新のたびに全セルを計算し直すため、10円（1772×1008 = 180万セル）では
// 1回の更新（断面の点のクリック・色レンジの変更など）に 0.4〜0.55 秒かかっていた。画面に出せるのは
// せいぜい数十万点なので、それを超えるときだけ s×s のブロックに1点へ間引く。
// ブロックの代表はブロック先頭の画素の値（平均しない）。先頭が欠損ならブロック内で最初に見つかった有効値。
// 高さは常に実測値で、欠損の多いデータでも間引きで穴が広がらない。座標はブロック先頭の格子位置なので、
// 先頭が欠損だったブロックだけ、ホバー・距離計測の位置が最大 (間隔−1) 画素ずれる。

type Grid = (number | null)[][];

// 表示に使うセル数の上限（10円 1772×1008 なら 1/3 → 591×336 ≈ 20万セル）
export const DISPLAY_MAX_CELLS = 250_000;

export interface DisplayGrid {
  x: number[];
  y: number[];
  z: Grid;
  mask: boolean[][] | null;
  // 間引きの間隔（1 = 間引きなし）
  stride: number;
}

export function decimateForDisplay(
  x: number[],
  y: number[],
  z: Grid,
  mask: boolean[][] | null,
  maxCells = DISPLAY_MAX_CELLS
): DisplayGrid {
  const rows = z.length;
  const cols = rows > 0 ? z[0].length : 0;
  const s = Math.max(1, Math.ceil(Math.sqrt((rows * cols) / maxCells)));
  if (s === 1) return { x, y, z, mask, stride: 1 };
  const outR = Math.ceil(rows / s);
  const outC = Math.ceil(cols / s);
  const ox: number[] = new Array(outC);
  const oy: number[] = new Array(outR);
  const oz: Grid = [];
  const om: boolean[][] | null = mask ? [] : null;
  for (let i = 0; i < outC; i++) ox[i] = x[i * s];
  for (let j = 0; j < outR; j++) oy[j] = y[j * s];
  for (let bj = 0; bj < outR; bj++) {
    const zr: (number | null)[] = new Array(outC).fill(null);
    const mr: boolean[] | null = om ? new Array(outC).fill(false) : null;
    for (let bi = 0; bi < outC; bi++) {
      found: for (let r = bj * s; r < Math.min(rows, bj * s + s); r++) {
        for (let c = bi * s; c < Math.min(cols, bi * s + s); c++) {
          const v = z[r][c];
          if (v == null) continue;
          zr[bi] = v;
          if (mr && mask) mr[bi] = mask[r][c];
          break found;
        }
      }
    }
    oz.push(zr);
    if (om && mr) om.push(mr);
  }
  return { x: ox, y: oy, z: oz, mask: om, stride: s };
}
