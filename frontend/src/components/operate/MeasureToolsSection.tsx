import { type PointCloud } from "../../utils/pointCloud";
import { DIM_COLORS, colors } from "../../utils/constants";
import { Icon } from "../Icon";
import {
  buttonFileStyle,
  panelSectionStyle,
  sectionTitleStyle,
  toolButtonStyle,
} from "../../utils/styles";
import type { ViewMode, MeasureState } from "../../types";

// 操作タブ「計測ツール」（距離・寸法・断層）
export function MeasureToolsSection({
  addDimLine,
  cloud,
  dimReadouts,
  dimensionMode,
  measureMode,
  measurePt1,
  measurePt2,
  measureStateRef,
  removeDimLine,
  setDimReadouts,
  setDimensionMode,
  setMeasureMode,
  setMeasurePt1,
  setMeasurePt2,
  setShowSlice,
  setSliceLineEnd,
  setSliceLineStart,
  showPlot,
  showSlice,
  viewMode,
  zData,
}: {
  addDimLine: () => void;
  cloud: PointCloud | null;
  dimReadouts: { id: number; dist: number; dx: number; dy: number; unit: string }[];
  dimensionMode: boolean;
  measureMode: boolean;
  measurePt1: { x: number; y: number; z: number } | null;
  measurePt2: { x: number; y: number; z: number } | null;
  measureStateRef: React.RefObject<MeasureState>;
  removeDimLine: (id: number) => void;
  setDimReadouts: React.Dispatch<
    React.SetStateAction<{ id: number; dist: number; dx: number; dy: number; unit: string }[]>
  >;
  setDimensionMode: React.Dispatch<React.SetStateAction<boolean>>;
  setMeasureMode: React.Dispatch<React.SetStateAction<boolean>>;
  setMeasurePt1: React.Dispatch<React.SetStateAction<{ x: number; y: number; z: number } | null>>;
  setMeasurePt2: React.Dispatch<React.SetStateAction<{ x: number; y: number; z: number } | null>>;
  setShowSlice: React.Dispatch<React.SetStateAction<boolean>>;
  setSliceLineEnd: React.Dispatch<React.SetStateAction<{ y: number; z: number } | null>>;
  setSliceLineStart: React.Dispatch<React.SetStateAction<{ y: number; z: number } | null>>;
  showPlot: boolean;
  showSlice: boolean;
  viewMode: ViewMode;
  zData: (number | null)[][] | null;
}) {
  return (
    <>
      <section style={{ ...panelSectionStyle, borderBottom: "none" }}>
        <h3 style={sectionTitleStyle}>計測ツール</h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "6px",
          }}
        >
          {/* 距離計測 */}
          <button
            className="tt-hover"
            disabled={!showPlot}
            onClick={() => {
              if (!showPlot) return;
              const next = !measureMode;
              setMeasureMode(next);
              measureStateRef.current = { mode: next, pt1: null, pt2: null };
              if (!next) {
                setMeasurePt1(null);
                setMeasurePt2(null);
              }
            }}
            style={toolButtonStyle(measureMode, showPlot)}
          >
            <Icon size={18}>
              <path d="M2 12h4l1-3h2l2 6h2l1-3h4" />
              <circle cx="5" cy="12" r="1.5" fill="currentColor" />
              <circle cx="19" cy="12" r="1.5" fill="currentColor" />
            </Icon>
            距離
          </button>

          {/* 寸法測定（2D 両矢印ドラッグ） */}
          <button
            className="tt-hover"
            disabled={viewMode !== "2D-camera" || !zData || zData.length === 0}
            onClick={() => {
              if (viewMode !== "2D-camera" || !zData || zData.length === 0) return;
              const next = !dimensionMode;
              setDimensionMode(next);
              if (next) {
                // 競合する他モードを解除
                setShowSlice(false);
                setMeasureMode(false);
                measureStateRef.current = { mode: false, pt1: null, pt2: null };
                setMeasurePt1(null);
                setMeasurePt2(null);
              } else {
                setDimReadouts([]);
              }
            }}
            style={toolButtonStyle(
              dimensionMode,
              viewMode === "2D-camera" && !!zData && zData.length > 0
            )}
            title="2D表示で両矢印をドラッグし、任意2点間の寸法を測る"
          >
            <Icon size={18}>
              <line x1="3" y1="12" x2="21" y2="12" />
              <polyline points="6 9 3 12 6 15" />
              <polyline points="18 9 21 12 18 15" />
            </Icon>
            寸法
          </button>

          {/* 断層 出力/停止 */}
          <button
            className="tt-hover"
            disabled={(!cloud && !zData) || viewMode !== "2D-camera"}
            style={toolButtonStyle(showSlice, !!(cloud || zData) && viewMode === "2D-camera")}
            onClick={() => {
              if ((!cloud && !zData) || viewMode !== "2D-camera") return;
              setShowSlice((v) => {
                if (!v) {
                  setSliceLineStart(null);
                  setSliceLineEnd(null);
                  // 競合する他モード（寸法測定・距離計測）を解除
                  setDimensionMode(false);
                  setDimReadouts([]);
                  setMeasureMode(false);
                  measureStateRef.current = { mode: false, pt1: null, pt2: null };
                  setMeasurePt1(null);
                  setMeasurePt2(null);
                }
                return !v;
              });
            }}
            title={showSlice ? "断層グラフを閉じる" : "2D表示で断層グラフを出す"}
          >
            <Icon size={18}>
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <line x1="2" y1="12" x2="22" y2="12" />
            </Icon>
            断層
          </button>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            marginTop: "10px",
          }}
        >
          {/* 寸法読み取り値（線ごと） */}
          {dimensionMode && (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  onClick={addDimLine}
                  style={{
                    ...buttonFileStyle,
                    flex: 1,
                  }}
                  title="寸法線をもう1本追加する"
                >
                  ＋ 寸法線を追加
                </button>
              </div>
              {dimReadouts.map((r, idx) => {
                const color = DIM_COLORS[idx % DIM_COLORS.length];
                return (
                  <div
                    key={r.id}
                    style={{
                      padding: "8px 10px",
                      borderRadius: "8px",
                      backgroundColor: colors.bgDark,
                      border: `1px solid ${color}`,
                      fontSize: "12px",
                      color: colors.text,
                      lineHeight: 1.6,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ fontWeight: 600, color }}>
                        {dimReadouts.length > 1 ? `${idx + 1}. ` : ""}距離:{" "}
                        {r.unit === "µm" && r.dist >= 1000
                          ? `${r.dist.toFixed(1)} µm (${(r.dist / 1000).toFixed(3)} mm)`
                          : `${r.dist.toFixed(1)} ${r.unit}`}
                      </div>
                      <button
                        onClick={() => removeDimLine(r.id)}
                        style={{
                          background: "none",
                          border: "none",
                          color: colors.textDim,
                          cursor: "pointer",
                          fontSize: "14px",
                          lineHeight: 1,
                          padding: "0 2px",
                        }}
                        title="この寸法線を削除"
                      >
                        ✕
                      </button>
                    </div>
                    <div style={{ color: colors.textMuted }}>
                      ΔX: {r.dx.toFixed(1)} {r.unit} ／ ΔY: {r.dy.toFixed(1)} {r.unit}
                    </div>
                  </div>
                );
              })}
              <div style={{ color: colors.textDim, fontSize: "11px" }}>
                矢印の端点をドラッグして測りたい2点に合わせてください。Shiftを押しながらドラッグすると水平/垂直に固定できます。数値ボックスはドラッグで自由に移動できます
              </div>
            </div>
          )}

          {/* 距離計測結果 */}
          {measureMode && (
            <div
              style={{
                padding: "10px",
                borderRadius: "8px",
                backgroundColor: colors.bgDark,
                border: `1px solid ${colors.border}`,
                fontSize: "12px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              <div
                style={{
                  color: colors.primary,
                  fontWeight: 600,
                  marginBottom: "2px",
                }}
              >
                距離計測モード
              </div>
              <div style={{ color: colors.textMuted, fontSize: "11px" }}>
                3Dプロット上の2点をクリックしてください
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: colors.textMuted }}>点1</span>
                <span>
                  {measurePt1
                    ? `(${measurePt1.x.toFixed(1)}, ${measurePt1.y.toFixed(1)}, ${measurePt1.z.toFixed(1)})`
                    : "—"}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: colors.textMuted }}>点2</span>
                <span>
                  {measurePt2
                    ? `(${measurePt2.x.toFixed(1)}, ${measurePt2.y.toFixed(1)}, ${measurePt2.z.toFixed(1)})`
                    : "—"}
                </span>
              </div>
              {measurePt1 && measurePt2 && (
                <>
                  <div
                    style={{
                      color: colors.textMuted,
                      fontSize: "11px",
                      borderTop: `1px solid ${colors.border}`,
                      paddingTop: "6px",
                    }}
                  >
                    距離はグラフ上（計測線の中点）に表示されます
                  </div>
                  <button
                    onClick={() => {
                      measureStateRef.current = { mode: true, pt1: null, pt2: null };
                      setMeasurePt1(null);
                      setMeasurePt2(null);
                    }}
                    style={{
                      marginTop: "6px",
                      padding: "6px 0",
                      borderRadius: "4px",
                      border: `1px solid ${colors.border}`,
                      backgroundColor: "transparent",
                      color: colors.textMuted,
                      fontSize: "11px",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    再計測
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
