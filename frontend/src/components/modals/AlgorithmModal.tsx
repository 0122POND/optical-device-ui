import { colors, fontFamily } from "../../utils/constants";
import { modalButtonStyle, modalCardStyle, modalOverlayStyle } from "../../utils/styles";

// アルゴリズム選択ポップアップ
export function AlgorithmModal({
  algorithm,
  setAlgorithm,
  setShowAlgorithms,
  showAlgorithms,
}: {
  algorithm: "coin" | "coin2" | "tgv" | "elec" | "medical" | "semi" | "coin_paper";
  setAlgorithm: React.Dispatch<
    React.SetStateAction<"coin" | "coin2" | "tgv" | "elec" | "medical" | "semi" | "coin_paper">
  >;
  setShowAlgorithms: React.Dispatch<React.SetStateAction<boolean>>;
  showAlgorithms: boolean;
}) {
  return (
    <>
      {showAlgorithms && (
        <div style={modalOverlayStyle} onClick={() => setShowAlgorithms(false)}>
          <div style={{ ...modalCardStyle, width: "380px" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: "15px", fontWeight: 600, marginBottom: "4px" }}>
              アルゴリズムを選択
            </div>
            <div style={{ fontSize: "12px", color: colors.textDim, marginBottom: "16px" }}>
              現在は「硬貨」のみ選択できます
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "8px",
              }}
            >
              {(["coin", "coin2", "tgv", "elec", "medical", "semi"] as const).map((alg) => {
                const label =
                  alg === "coin"
                    ? "硬貨"
                    : alg === "coin2"
                      ? "硬貨(別アプローチ)"
                      : alg === "tgv"
                        ? "TGV"
                        : alg === "elec"
                          ? "エレキ"
                          : alg === "medical"
                            ? "医療"
                            : "半導体";
                const icon =
                  alg === "coin" || alg === "coin2" ? (
                    <>
                      <circle cx="12" cy="12" r="9" />
                      <circle cx="12" cy="12" r="5" />
                    </>
                  ) : alg === "tgv" ? (
                    <>
                      <rect x="2" y="6" width="20" height="12" rx="1" />
                      <circle cx="12" cy="12" r="4" strokeDasharray="3 2" />
                    </>
                  ) : alg === "elec" ? (
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                  ) : alg === "medical" ? (
                    <>
                      <line x1="12" y1="4" x2="12" y2="20" />
                      <line x1="4" y1="12" x2="20" y2="12" />
                    </>
                  ) : (
                    <>
                      <rect x="4" y="4" width="16" height="16" rx="2" />
                      <rect x="8" y="8" width="8" height="8" rx="1" />
                      <line x1="8" y1="2" x2="8" y2="4" />
                      <line x1="12" y1="2" x2="12" y2="4" />
                      <line x1="16" y1="2" x2="16" y2="4" />
                      <line x1="8" y1="20" x2="8" y2="22" />
                      <line x1="12" y1="20" x2="12" y2="22" />
                      <line x1="16" y1="20" x2="16" y2="22" />
                      <line x1="2" y1="8" x2="4" y2="8" />
                      <line x1="2" y1="12" x2="4" y2="12" />
                      <line x1="2" y1="16" x2="4" y2="16" />
                      <line x1="20" y1="8" x2="22" y2="8" />
                      <line x1="20" y1="12" x2="22" y2="12" />
                      <line x1="20" y1="16" x2="22" y2="16" />
                    </>
                  );
                const disabled = alg !== "coin";
                return (
                  <button
                    key={alg}
                    onClick={() => {
                      if (disabled) return;
                      setAlgorithm(alg);
                      setShowAlgorithms(false);
                    }}
                    disabled={disabled}
                    title={disabled ? "現在は「硬貨」のみ選択可能です" : ""}
                    className="tt-hover"
                    style={{
                      height: "44px",
                      borderRadius: "8px",
                      border: `1px solid ${algorithm === alg ? colors.primary + "80" : colors.border}`,
                      backgroundColor: algorithm === alg ? colors.primarySoft : "transparent",
                      color: algorithm === alg ? colors.primary : colors.text,
                      fontSize: "12px",
                      fontWeight: algorithm === alg ? 600 : 500,
                      fontFamily: fontFamily,
                      cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled ? 0.45 : 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                    }}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {icon}
                    </svg>
                    {label}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "18px" }}>
              <button
                className="tt-hover"
                style={modalButtonStyle("neutral")}
                onClick={() => setShowAlgorithms(false)}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
