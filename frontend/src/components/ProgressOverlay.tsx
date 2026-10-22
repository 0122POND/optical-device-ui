import { colors } from "../utils/constants";
import { formatElapsed } from "../utils/format";
import { modalButtonStyle } from "../utils/styles";

// 計測中（前処理・AI推論）の進捗と中止ボタン。プロットの上に重ねる
export function ProgressOverlay({
  cancel,
  cancelling,
  elapsedMs,
  isAcquiring,
  isLoadingAI,
  progressMessage,
  progressPercent,
  progressStep,
  progressTotal,
  setCancelling,
}: {
  cancel: () => void;
  cancelling: boolean;
  elapsedMs: number;
  isAcquiring: boolean;
  isLoadingAI: boolean;
  progressMessage: string;
  progressPercent: number;
  progressStep: number;
  progressTotal: number;
  setCancelling: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  return (
    <>
      {(isAcquiring || isLoadingAI) && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: colors.text,
            fontSize: "15px",
            backgroundColor: "rgba(11, 14, 19, 0.82)",
            pointerEvents: "none",
            textAlign: "center",
            lineHeight: 1.6,
            gap: "16px",
          }}
        >
          <div style={{ fontSize: "18px", fontWeight: 600 }}>
            {isLoadingAI ? "AI推論中..." : "画像処理中..."}
          </div>

          {/* 進捗バー */}
          <div
            style={{
              width: "300px",
              height: "8px",
              backgroundColor: colors.border,
              borderRadius: "4px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${progressPercent}%`,
                height: "100%",
                backgroundColor: colors.primary,
                transition: "width 0.3s ease",
              }}
            />
          </div>

          <div style={{ fontSize: "14px" }}>
            [{progressStep}/{progressTotal}] {progressMessage}
          </div>
          <div style={{ fontSize: "13px", opacity: 0.8 }}>経過時間: {formatElapsed(elapsedMs)}</div>
          <button
            className="tt-hover"
            disabled={cancelling}
            title={
              isLoadingAI
                ? "1枚の推論が終わったところで止めます（途中までのマスクは残しません）"
                : "今の工程が終わったところで止めます"
            }
            style={{
              ...modalButtonStyle("neutral"),
              pointerEvents: "auto",
              opacity: cancelling ? 0.6 : 1,
              cursor: cancelling ? "default" : "pointer",
            }}
            onClick={() => {
              setCancelling(true);
              cancel();
            }}
          >
            {cancelling ? "中止しています…" : "中止"}
          </button>
        </div>
      )}
    </>
  );
}
