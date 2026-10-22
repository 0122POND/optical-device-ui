// アプリ全体で共有する定数

// 1ピクセルあたりのµm換算係数（軸ごとに異なる）のデフォルト値
export const DEFAULT_UM_PER_PIXEL_X = 1.8; // 干渉画像の横方向（深さ方向）
export const DEFAULT_UM_PER_PIXEL_Y = 20; // 干渉画像の縦方向

// 寸法線の色パレット（線ごとに色を変えて区別しやすくする）
export const DIM_COLORS = ["#ffffff", "#fde047", "#34d399", "#f472b6", "#60a5fa", "#fb923c"];

// CSV点群表示時の総点数上限（pointCloud.ts の maxTotalPoints と揃える）
export const CSV_MAX_TOTAL_POINTS = 120_000;

// カラーパレット（ダーク＋琥珀アクセント）。背景は1系統の濃淡、強調色は primary の1色だけ
export const colors = {
  bg: "#0e1217", // アプリ背景
  surface: "#161b22", // ヘッダー・サイドパネル
  bgLight: "#1c222b", // 一段持ち上げた面（ダイアログ・カード・ボタン）
  bgDark: "#0b0e13", // 一段沈めた面（入力欄・セグメントの溝）
  plotBg: "#0b0e13", // プロット背景（bg となじませる）
  stageGlow: "#1e2531", // プロット背景のグラデーション中心
  border: "#262e39",
  borderLight: "#323b48",
  grid: "#232a34", // プロットのグリッド線
  text: "#e3e7ee",
  textMuted: "#96a0b0",
  textDim: "#687284",
  primary: "#e0ae4a",
  primaryHover: "#d29b2f",
  primarySoft: "rgba(224, 174, 74, 0.14)", // トグルON・選択中の薄い塗り
  onPrimary: "#1a1406", // primary 塗りの上の文字色
  danger: "#f07c5b",
  success: "#34d399",
  secondary: "#2a313c", // 中立ボタン（キャンセル等）
  secondaryHover: "#323a46",
};

// フォント設定: 本文 / 数値・ラベル（等幅） / 見出し
export const fontFamily =
  '"IBM Plex Sans JP", "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const monoFont = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
export const displayFont = '"Barlow Semi Condensed", "IBM Plex Sans JP", sans-serif';
