// 経過時間を「12.3秒」「1分5.0秒」形式に整形
export const formatElapsed = (ms: number): string => {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}秒`;
  const m = Math.floor(s / 60);
  return `${m}分${(s - m * 60).toFixed(1)}秒`;
};
