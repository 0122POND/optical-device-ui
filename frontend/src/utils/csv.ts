// src/utils/csv.ts
import type { PointCloud } from "./pointCloud";

declare global {
  interface Window {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<FileSystemFileHandle>;
  }
}

/**
 * CSVテキストをパースして2Dグリッドに変換（-9999.9 と空セルは null）。
 * 空白のみのテキストは空配列を返す。行は一切間引かない
 * （全欠損行も硬貨内側に実在し、落とすと走査方向の寸法が狂うため）。
 */
export function parseCSV(text: string): (number | null)[][] {
  const trimmed = text.trim();
  if (trimmed === "") return [];
  return trimmed.split("\n").map((line) =>
    line.split(",").map((cell) => {
      const s = cell.trim();
      if (s === "" || s === "-9999.9") return null;
      const n = Number(s);
      return isNaN(n) ? null : n;
    })
  );
}

/**
 * 点群形式CSV（1行1点）かどうか。先頭の非空行が `x,y,z` ヘッダなら点群形式とみなす。
 * ヘッダ無しの3列CSVは幅3の高さマップと区別できないため、ヘッダを必須にしている。
 */
export function isPointCSV(text: string): boolean {
  const first = text.trimStart().split("\n", 1)[0] ?? "";
  const cols = first.split(",").map((s) => s.trim().toLowerCase());
  return cols.length >= 3 && cols[0] === "x" && cols[1] === "y" && cols[2] === "z";
}

/**
 * 点群形式CSV（`x,y,z` ヘッダ＋1行1点）をパースする。同じ (x, y) に複数の z を持てるため、
 * 断層・内部構造のような高さマップで表せない形状を扱える。
 * 単位は高さマップCSVと同じ（x=列, y=行, z=高さ値）で、小数も可。
 * 内部の PointCloud 規約（x=高さ値, y=列, z=行, c=高さ値）に並べ替えて返す。
 * いずれかの座標が数値でない行・z が -9999.9 の行は読み飛ばす。
 */
export function parsePointCSV(text: string): PointCloud {
  const lines = text.trim().split("\n").slice(1); // ヘッダ行を除く
  const px: number[] = [];
  const py: number[] = [];
  const pz: number[] = [];
  for (const line of lines) {
    const cells = line.split(",");
    if (cells.length < 3) continue;
    const xs = cells[0].trim();
    const ys = cells[1].trim();
    const zs = cells[2].trim();
    if (xs === "" || ys === "" || zs === "" || zs === "-9999.9") continue;
    const x = Number(xs);
    const y = Number(ys);
    const z = Number(zs);
    if (isNaN(x) || isNaN(y) || isNaN(z)) continue;
    px.push(x);
    py.push(y);
    pz.push(z);
  }
  return { x: pz, y: px, z: py, c: pz };
}

/** PointCloud（内部規約）を点群形式CSVテキスト（`x,y,z` ヘッダ付き）に変換する。 */
export function pointCloudToCSV(cloud: PointCloud): string {
  const rows = ["x,y,z"];
  for (let i = 0; i < cloud.x.length; i++) {
    rows.push(`${cloud.y[i]},${cloud.z[i]},${cloud.x[i]}`);
  }
  return rows.join("\n");
}

export async function downloadCSV(zData: (number | null)[][], filename = "surface.csv") {
  const rows = zData.map((row) => row.map((v) => (v == null ? "-9999.9" : v.toString())).join(","));
  await saveCSVText(rows.join("\n"), filename);
}

export async function downloadPointCSV(cloud: PointCloud, filename = "points.csv") {
  await saveCSVText(pointCloudToCSV(cloud), filename);
}

async function saveCSVText(csv: string, filename: string) {
  // File System Access API 対応ブラウザの場合
  if ("showSaveFilePicker" in window) {
    try {
      const handle = await window.showSaveFilePicker!({
        suggestedName: filename,
        types: [
          {
            description: "CSV Files",
            accept: { "text/csv": [".csv"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(csv);
      await writable.close();
      return;
    } catch (e) {
      // ユーザーがキャンセルした場合は何もしない
      if (e instanceof DOMException && e.name === "AbortError") return;
      // その他のエラーはフォールバック
    }
  }

  // フォールバック: 従来のBlobダウンロード
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
