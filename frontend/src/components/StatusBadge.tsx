import type { MeasureStatus } from "../types";
import { colors, monoFont } from "../utils/constants";

// 計測ステータスをドット付きピル表示するバッジ（待機=中立 / 実行中=アクセント点滅 / 完了=緑）
export const StatusBadge = ({ status }: { status: MeasureStatus }) => {
  const config = {
    READY: { color: colors.textMuted, dot: colors.success, label: "READY" },
    RUNNING: { color: colors.primary, dot: colors.primary, label: "RUNNING" },
    COMPLETE: { color: colors.success, dot: colors.success, label: "COMPLETE" },
  };
  const c = config[status];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "7px",
        height: "26px",
        padding: "0 11px",
        borderRadius: "999px",
        fontFamily: monoFont,
        fontSize: "11px",
        fontWeight: 500,
        letterSpacing: "0.06em",
        color: c.color,
        backgroundColor: `color-mix(in srgb, ${c.dot} 12%, transparent)`,
      }}
    >
      <span
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          backgroundColor: c.dot,
          boxShadow: `0 0 8px ${c.dot}`,
          animation: status === "RUNNING" ? "blink 1s ease-in-out infinite" : "none",
        }}
      />
      {c.label}
    </div>
  );
};
