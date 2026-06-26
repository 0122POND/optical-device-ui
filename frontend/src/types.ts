// アプリ全体で共有する型定義

// 3D表示のプロット種別
export type PlotType = "scatter3d" | "surface";

// 測定履歴の取得元（算法名 / CSV / AI）
export type HistorySource = "coin" | "coin2" | "tgv" | "elec" | "medical" | "semi" | "csv" | "ai";
