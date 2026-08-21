// アプリ全体で共有する型定義
import type { PointCloud } from "./utils/pointCloud";

// 3D表示のプロット種別
export type PlotType = "scatter3d" | "surface";

// 表示モード（3D / 2Dカメラ）
export type ViewMode = "3D" | "2D-camera";

// 測定履歴の取得元（算法名 / CSV / AI）
export type HistorySource =
  | "coin"
  | "coin2"
  | "coin_paper"
  | "tgv"
  | "elec"
  | "medical"
  | "semi"
  | "csv"
  | "ai";

// 計測ステータス
export type MeasureStatus = "READY" | "RUNNING" | "COMPLETE";

// 距離計測の点（3D）
export type MeasurePt = { x: number; y: number; z: number } | null;
// 距離計測の状態（クリックハンドラ用 ref に保持）
export type MeasureState = { mode: boolean; pt1: MeasurePt; pt2: MeasurePt };
// 寸法線（2D寸法測定の両矢印1本ぶん）。lx/ly は手動でずらしたラベル位置
export type DimLine = {
  id: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  lx?: number | null;
  ly?: number | null;
};
// 寸法読み取り値（サイドパネル表示用）
export type DimReadout = { id: number; dist: number; dx: number; dy: number; unit: string };
// 寸法描画範囲（新規寸法線の配置に使う）
export type DimRange = { xMin: number; xMax: number; yMin: number; yMax: number };
// 断層ライン端点（2D平面 µm 座標）
export type SlicePoint = { y: number; z: number };

// 測定履歴の1エントリ（点群＋メタ情報）
export type CloudHistoryEntry = {
  cloud: PointCloud;
  measuredAt: string;
  points: number;
  thumbnail: string;
  name: string;
  source: HistorySource;
};
