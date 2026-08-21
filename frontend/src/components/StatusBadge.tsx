import type { MeasureStatus } from "../types";

// 計測ステータスをドット付きピル表示するバッジ
export const StatusBadge = ({ status }: { status: MeasureStatus }) => {
  const config = {
    READY: {
      bg: "#1e3a2f",
      color: "#6bff95",
      border: "#6bff9555",
      dot: "#3ddc84",
      label: "READY",
    },
    RUNNING: {
      bg: "#3a2828",
      color: "#ff6b6b",
      border: "#ff6b6b55",
      dot: "#ff4d4d",
      label: "RUNNING",
    },
    COMPLETE: {
      bg: "#1e2a3a",
      color: "#6b95ff",
      border: "#6b95ff55",
      dot: "#4d7fff",
      label: "COMPLETE",
    },
  };
  const c = config[status];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "8px 12px",
        borderRadius: "999px",
        fontSize: "12px",
        fontWeight: 600,
        backgroundColor: c.bg,
        color: c.color,
        border: `1px solid ${c.border}`,
      }}
    >
      <span
        style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          backgroundColor: c.dot,
          animation: status === "RUNNING" ? "blink 1s ease-in-out infinite" : "none",
        }}
      />
      {c.label}
    </div>
  );
};
