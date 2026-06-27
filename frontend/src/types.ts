// アプリ全体で共有する型定義
import type { PointCloud } from "./utils/pointCloud";

// 3D表示のプロット種別
export type PlotType = "scatter3d" | "surface";

// 測定履歴の取得元（算法名 / CSV / AI）
export type HistorySource = "coin" | "coin2" | "tgv" | "elec" | "medical" | "semi" | "csv" | "ai";

// 計測ステータス
export type MeasureStatus = "READY" | "RUNNING" | "COMPLETE";

// 測定履歴の1エントリ（点群＋メタ情報）
export type CloudHistoryEntry = {
  cloud: PointCloud;
  measuredAt: string;
  points: number;
  thumbnail: string;
  name: string;
  source: HistorySource;
};
