// アプリ全体で共有する定数

// 1ピクセルあたりのµm換算係数（軸ごとに異なる）のデフォルト値
export const DEFAULT_UM_PER_PIXEL_X = 1.8; // 干渉画像の横方向（深さ方向）
export const DEFAULT_UM_PER_PIXEL_Y = 20; // 干渉画像の縦方向

// 寸法線の色パレット（線ごとに色を変えて区別しやすくする）
export const DIM_COLORS = ["#ffffff", "#fde047", "#34d399", "#f472b6", "#60a5fa", "#fb923c"];

// CSV点群表示時の総点数上限（pointCloud.ts の maxTotalPoints と揃える）
export const CSV_MAX_TOTAL_POINTS = 120_000;

// カラーパレット（モダングレー）
export const colors = {
  bg: "#3a3f47",
  bgLight: "#454b54",
  bgDark: "#2d3139",
  border: "#4f5661",
  borderLight: "#5a6270",
  text: "#f0f1f3",
  textMuted: "#9ca3af",
  textDim: "#8b939f",
  primary: "#3b82f6",
  primaryHover: "#2563eb",
  danger: "#ef4444",
  success: "#22c55e",
  secondary: "#6b7280",
  secondaryHover: "#4b5563",
};

// フォント設定
export const fontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
