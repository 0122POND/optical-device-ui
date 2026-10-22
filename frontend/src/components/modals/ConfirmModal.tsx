import { colors } from "../../utils/constants";
import { modalButtonStyle, modalCardStyle, modalOverlayStyle } from "../../utils/styles";

// 計測開始・AI推論の確認モーダル
export function ConfirmModal({
  algorithm,
  confirmMode,
  handleConfirmCancel,
  handleConfirmOk,
  showConfirm,
  useGpu,
}: {
  algorithm: "coin" | "coin2" | "coin_paper" | "tgv" | "elec" | "medical" | "semi";
  confirmMode: "plot" | "ai" | null;
  handleConfirmCancel: () => void;
  handleConfirmOk: () => Promise<void>;
  showConfirm: boolean;
  useGpu: boolean;
}) {
  return (
    <>
      {showConfirm && confirmMode && (
        <div style={modalOverlayStyle}>
          <div style={{ ...modalCardStyle, width: "340px" }}>
            <div
              style={{
                fontSize: "15px",
                marginBottom: "20px",
                fontWeight: 500,
                lineHeight: 1.6,
              }}
            >
              {confirmMode === "ai" ? (
                <>
                  AI推論を実行しますか？
                  <div style={{ marginTop: "8px", fontSize: "12.5px", color: colors.textMuted }}>
                    モデル: U-Net++ (ResNet50)
                  </div>
                </>
              ) : (
                <>
                  3次元形状計測を開始しますか？
                  <br />（{useGpu ? "GPU" : "CPU"}モード /{" "}
                  {algorithm === "tgv"
                    ? "TGV"
                    : algorithm === "elec"
                      ? "エレキ"
                      : algorithm === "medical"
                        ? "医療"
                        : algorithm === "semi"
                          ? "半導体"
                          : algorithm === "coin2"
                            ? "硬貨(別アプローチ)"
                            : algorithm === "coin_paper"
                              ? "論文硬貨"
                              : "硬貨"}
                  ）
                </>
              )}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
              }}
            >
              <button
                className="tt-hover"
                style={modalButtonStyle("neutral")}
                onClick={handleConfirmCancel}
              >
                いいえ
              </button>
              <button
                className="tt-hover-strong"
                style={modalButtonStyle("primary")}
                onClick={handleConfirmOk}
              >
                はい
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
