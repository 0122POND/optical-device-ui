// 表示データの物理単位(µm)への換算を1か所に集約する。
// 以前は各表示が「点群があればデバイス由来」と推測して換算していたが、CSV読込でも点群を
// 作るため推測が常に外れ、CSVの高さに X軸 µm/pix が掛かる・ピッチがデバイス設定に
// すり替わるといった誤りが全表示で起きていた。出どころ(DataSource)は読込経路で明示する。
import type { PointCloud } from "./pointCloud";

// 表示中データの出どころ
//   device: 干渉画像から作ったグリッド。値=縞のx重心[px]、列=画像y[px]、行=掃引スライス
//   csv   : 高さマップCSV（Keyence/WI5000/自社書き出し）。値=高さ[µm]、列・行は CSV のピッチ
export type DataSource = "device" | "csv";

// 換算に使う設定値（設定タブの入力）
export interface ScaleInputs {
  umPerPixelX: number; // デバイス: 深さ方向（画像x）µm/px
  umPerPixelY: number; // デバイス: 画像y µm/px
  sweepInterval: string; // デバイス: 掃引間隔 µm/スライス（空欄=未指定）
  csvPitchX: number; // CSV: 列方向 µm/px
  csvPitchY: number; // CSV: 行方向 µm/px
  // CSV: 高さの単位。px のとき csvUmPerHeightPx があれば µm に換算し、無ければ未校正の px のまま扱う
  // （HDD掃引の奥行きのように、高さ軸が未校正の画素のデータがあるため）
  csvHeightUnit: "um" | "px";
  csvUmPerHeightPx: number | null;
}

// グリッドの「値・列・行」それぞれの µm 換算係数
export interface GridScale {
  value: number;
  col: number;
  row: number;
  // 行方向のピッチが未指定で、仮の値（デバイスの画像y µm/px）を使っているか
  rowAssumed: boolean;
  // 値（高さ）が µm に校正されているか。false のときは未校正の px で、距離計測に高さを含めると無意味
  valueCalibrated: boolean;
  valueUnit: "µm" | "px";
}

export function gridScale(source: DataSource, s: ScaleInputs): GridScale {
  if (source === "csv") {
    const pxUncal = s.csvHeightUnit === "px" && s.csvUmPerHeightPx == null;
    return {
      value: s.csvHeightUnit === "px" ? (s.csvUmPerHeightPx ?? 1) : 1,
      col: s.csvPitchX,
      row: s.csvPitchY,
      rowAssumed: false,
      valueCalibrated: !pxUncal,
      valueUnit: pxUncal ? "px" : "µm",
    };
  }
  const sweep = parseFloat(s.sweepInterval);
  const hasSweep = !isNaN(sweep) && sweep > 0;
  return {
    value: s.umPerPixelX,
    col: s.umPerPixelY,
    row: hasSweep ? sweep : s.umPerPixelY,
    rowAssumed: !hasSweep,
    valueCalibrated: true,
    valueUnit: "µm",
  };
}

// デバイスデータの左右反転（深さ方向の反転）の基準値。全表示で同じ値を使わないと、
// 断面と Surface で深さがずれる。グリッドがあればその最大値、なければ点群xの最大値
export function deviceFlipRef(grid: (number | null)[][] | null, cloud: PointCloud | null): number {
  let m = -Infinity;
  if (grid) for (const row of grid) for (const v of row) if (v != null && v > m) m = v;
  if (m === -Infinity && cloud) for (const v of cloud.x) if (v > m) m = v;
  return m === -Infinity ? 0 : m;
}

export interface PhysicalGrid {
  x: number[]; // 列座標 [µm]
  y: number[]; // 行座標 [µm]
  z: (number | null)[][]; // 値 [µm]
  xLabel: string;
  yLabel: string;
  zLabel: string;
  rowAssumed: boolean;
}

// グリッドを物理単位(µm)へ変換する。左右反転は
//   device: 深さ方向（値）を反転（基準 flipRef）
//   csv   : 列を左右に鏡映
export function physicalGrid(
  grid: (number | null)[][],
  source: DataSource,
  s: ScaleInputs,
  flipX: boolean,
  flipRef = 0
): PhysicalGrid {
  const sc = gridScale(source, s);
  const numRows = grid.length;
  const numCols = numRows > 0 ? grid[0].length : 0;
  const x = Array.from({ length: numCols }, (_, i) => i * sc.col);
  const y = Array.from({ length: numRows }, (_, j) => j * sc.row);
  let z: (number | null)[][];
  if (source === "device") {
    z = grid.map((row) =>
      row.map((v) => (v == null ? null : (flipX ? flipRef - v : v) * sc.value))
    );
  } else {
    z = grid.map((row) => {
      const r = flipX ? [...row].reverse() : row;
      return r.map((v) => (v == null ? null : v * sc.value));
    });
  }
  return {
    x,
    y,
    z,
    xLabel: "X [µm]",
    yLabel: sc.rowAssumed ? "Y (仮定値) [µm]" : "Y [µm]",
    zLabel: heightLabel(source, s),
    rowAssumed: sc.rowAssumed,
  };
}

// 高さ（値）軸のラベル。未校正の px なら明示する
export function heightLabel(source: DataSource, s: ScaleInputs): string {
  if (source === "device") return "Z (Depth) [µm]";
  return gridScale(source, s).valueCalibrated ? "Height [µm]" : "Height [px・未校正]";
}

// 点群（x=値, y=列, z=行 の規約）を物理単位(µm)へ変換する。反転の意味は physicalGrid と同じ
export function physicalPoints(
  cloud: PointCloud,
  source: DataSource,
  s: ScaleInputs,
  flipX: boolean,
  flipRef = 0
): { xs: number[]; ys: number[]; zs: number[] } {
  const sc = gridScale(source, s);
  if (source === "device") {
    return {
      xs: cloud.x.map((v) => (flipX ? flipRef - v : v) * sc.value),
      ys: cloud.y.map((v) => v * sc.col),
      zs: cloud.z.map((v) => v * sc.row),
    };
  }
  let maxCol = 0;
  if (flipX) for (const v of cloud.y) if (v > maxCol) maxCol = v;
  return {
    xs: cloud.x.map((v) => v * sc.value),
    ys: cloud.y.map((v) => (flipX ? maxCol - v : v) * sc.col),
    zs: cloud.z.map((v) => v * sc.row),
  };
}

// 点群を、点群形式CSVの単位（x=列の添字, y=行の添字, 高さ=µm）の内部規約 PointCloud
// （x=高さ, y=列, z=行）に変換する。高さマップCSVと同じく、列・行のピッチはファイル名に残す。
// 左右反転は表示と同じ意味（device=深さの反転 / csv=列の鏡映）を反映する
export function pointsInCsvUnits(
  cloud: PointCloud,
  source: DataSource,
  s: ScaleInputs,
  flipX: boolean,
  flipRef = 0
): PointCloud {
  const sc = gridScale(source, s);
  let maxCol = 0;
  if (source === "csv" && flipX) for (const v of cloud.y) if (v > maxCol) maxCol = v;
  const x = cloud.x.map((v) =>
    source === "device" ? (flipX ? flipRef - v : v) * sc.value : v * sc.value
  );
  const y = source === "csv" && flipX ? cloud.y.map((v) => maxCol - v) : cloud.y.slice();
  return { x, y, z: cloud.z.slice(), c: x };
}

// 書き出しファイル名に埋め込んだピッチ（例: foo_pitch20x100um.csv）を読む。
// 読込時に CSV のピッチ設定へ自動反映し、µm/ピッチの取り違えを防ぐ
export function parsePitchFromFilename(name: string): { x: number; y: number } | null {
  const m = name.match(/_pitch(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)um/i);
  if (!m) return null;
  const x = parseFloat(m[1]);
  const y = parseFloat(m[2]);
  return x > 0 && y > 0 ? { x, y } : null;
}

// ピッチ（と高さの単位）をファイル名に埋め込む（小数は最大3桁、末尾の0は落とす）。
// 高さが未校正の px なら `_zpx` を付け、読み戻し時に px として扱えるようにする
export function pitchFilename(
  base: string,
  pitchX: number,
  pitchY: number,
  heightUnit: "µm" | "px" = "µm"
): string {
  const f = (v: number) => String(Number(v.toFixed(3)));
  const stem = base
    .replace(/\.csv$/i, "")
    .replace(/_pitch[\d.]+x[\d.]+um/i, "")
    .replace(/_z(um|px)(?=$|_)/i, "");
  return `${stem}_pitch${f(pitchX)}x${f(pitchY)}um_z${heightUnit === "px" ? "px" : "um"}.csv`;
}

// ファイル名の高さ単位（_zum / _zpx）を読む。無ければ null（設定をそのまま使う）
export function parseHeightUnitFromFilename(name: string): "um" | "px" | null {
  const m = name.match(/_z(um|px)(?=\.csv$|_)/i);
  return m ? (m[1].toLowerCase() as "um" | "px") : null;
}
