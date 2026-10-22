import { colors, monoFont } from "../../utils/constants";
import { Icon } from "../Icon";
import {
  buttonPrimaryStyle,
  buttonSecondaryStyle,
  enabledStateStyle,
  panelSectionStyle,
  sectionTitleStyle,
  segmentButtonStyle,
  segmentGroupStyle,
} from "../../utils/styles";
import type { MeasureStatus } from "../../types";

// 操作タブ「計測」（アルゴリズム・CPU/GPU・計測開始・AI計測）
export function MeasureSection({
  algorithmLabel,
  handleShowAIResult,
  isLoadingAI,
  setConfirmMode,
  setShowAlgorithms,
  setShowConfirm,
  setUseGpu,
  status,
  useGpu,
}: {
  algorithmLabel: "硬貨" | "硬貨(別アプローチ)" | "論文硬貨" | "TGV" | "エレキ" | "医療" | "半導体";
  handleShowAIResult: () => void;
  isLoadingAI: boolean;
  setConfirmMode: React.Dispatch<React.SetStateAction<"plot" | "ai" | null>>;
  setShowAlgorithms: React.Dispatch<React.SetStateAction<boolean>>;
  setShowConfirm: React.Dispatch<React.SetStateAction<boolean>>;
  setUseGpu: React.Dispatch<React.SetStateAction<boolean>>;
  status: MeasureStatus;
  useGpu: boolean;
}) {
  return (
    <>
      <section style={panelSectionStyle}>
        <h3 style={sectionTitleStyle}>計測</h3>
        {/* アルゴリズム選択（クリックでポップアップ） */}
        <button
          className="tt-hover"
          onClick={() => setShowAlgorithms(true)}
          title="クリックしてアルゴリズムを変更"
          style={{
            ...buttonSecondaryStyle,
            width: "100%",
            height: "40px",
            justifyContent: "flex-start",
            gap: "10px",
          }}
        >
          <span style={{ color: colors.textMuted, fontSize: "12px" }}>アルゴリズム</span>
          <span style={{ fontWeight: 500 }}>{algorithmLabel}</span>
          <span style={{ marginLeft: "auto", color: colors.textDim, display: "flex" }}>
            <Icon size={14}>
              <polyline points="9 18 15 12 9 6" />
            </Icon>
          </span>
        </button>

        {/* CPU / GPU の選択と計測開始 */}
        <div style={{ ...segmentGroupStyle, marginTop: "8px" }}>
          {([false, true] as const).map((gpu) => (
            <button
              key={gpu ? "gpu" : "cpu"}
              className="tt-hover"
              disabled={status === "RUNNING"}
              onClick={() => setUseGpu(gpu)}
              style={{
                ...segmentButtonStyle(useGpu === gpu),
                fontFamily: monoFont,
                ...enabledStateStyle(status !== "RUNNING"),
              }}
            >
              {gpu ? "GPU" : "CPU"}
            </button>
          ))}
        </div>
        <button
          className="tt-hover-strong"
          disabled={status === "RUNNING"}
          style={{
            ...buttonPrimaryStyle,
            width: "100%",
            marginTop: "8px",
            ...(status === "RUNNING"
              ? {
                  backgroundColor: colors.secondary,
                  color: colors.textMuted,
                  boxShadow: "none",
                  cursor: "not-allowed",
                }
              : {}),
          }}
          onClick={() => {
            setConfirmMode("plot");
            setShowConfirm(true);
          }}
        >
          {status === "RUNNING" ? (
            "処理中..."
          ) : (
            <>
              <Icon size={14} color="currentColor">
                <path d="M7 5v14l11-7z" fill="currentColor" stroke="none" />
              </Icon>
              計測開始
            </>
          )}
        </button>

        {/* AI推論で表示 */}
        <button
          className="tt-hover"
          disabled={status === "RUNNING" || isLoadingAI}
          style={{
            ...buttonSecondaryStyle,
            width: "100%",
            marginTop: "8px",
            ...enabledStateStyle(!(status === "RUNNING" || isLoadingAI)),
          }}
          onClick={handleShowAIResult}
          title="AI推論でマスク画像から3次元形状を再構成して表示する"
        >
          <span style={{ color: colors.textMuted, display: "flex" }}>
            <Icon>
              <circle cx="5" cy="6" r="2" />
              <circle cx="19" cy="6" r="2" />
              <circle cx="5" cy="18" r="2" />
              <circle cx="19" cy="18" r="2" />
              <circle cx="12" cy="12" r="2.5" />
              <line x1="7" y1="7" x2="10" y2="10" />
              <line x1="14" y1="10" x2="17" y2="7" />
              <line x1="7" y1="17" x2="10" y2="14" />
              <line x1="14" y1="14" x2="17" y2="17" />
            </Icon>
          </span>
          {isLoadingAI ? "読込中..." : "AI計測"}
        </button>
      </section>
    </>
  );
}
