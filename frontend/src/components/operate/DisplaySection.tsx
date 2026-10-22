import type { DepthMeta, PointCloud } from "../../utils/pointCloud";
import { heightLabel, type DataSource, type ScaleInputs } from "../../utils/units";
import { colors, monoFont } from "../../utils/constants";
import { Icon } from "../Icon";
import {
  rowLabelStyle,
  settingRowStyle,
  panelSectionStyle,
  sectionTitleStyle,
  segmentButtonStyle,
  segmentGroupStyle,
  toolButtonStyle,
} from "../../utils/styles";
import type { PlotType, ViewMode } from "../../types";

// 操作タブ「表示」（軸・左右反転・自動回転・描画モード・エンジン・点群の色など）
export function DisplaySection({
  aiMeta,
  aiThreshold,
  autoRotate,
  axisVisible,
  cloud,
  dataSource,
  depthExaggeration,
  effectivePointColorBy,
  flipX,
  fromProb,
  plotType,
  pointEngine,
  scale,
  setAiThreshold,
  setAutoRotate,
  setAxisVisible,
  setDepthExaggerationInput,
  setDimReadouts,
  setDimensionMode,
  setFlipX,
  setPlotType,
  setPointColorBy,
  setPointEngine,
  setShowSlice,
  setSurfaceEngine,
  setViewMode,
  showPlot,
  surfaceEngine,
  viewMode,
  zData,
}: {
  aiMeta: DepthMeta | null;
  aiThreshold: number | null;
  autoRotate: boolean;
  axisVisible: boolean;
  cloud: PointCloud | null;
  dataSource: DataSource;
  depthExaggeration: number;
  effectivePointColorBy: "depth" | "confidence";
  flipX: boolean;
  fromProb: boolean;
  plotType: PlotType;
  pointEngine: "plotly" | "three";
  scale: ScaleInputs;
  setAiThreshold: React.Dispatch<React.SetStateAction<number | null>>;
  setAutoRotate: React.Dispatch<React.SetStateAction<boolean>>;
  setAxisVisible: React.Dispatch<React.SetStateAction<boolean>>;
  setDepthExaggerationInput: (v: string) => void;
  setDimReadouts: React.Dispatch<
    React.SetStateAction<{ id: number; dist: number; dx: number; dy: number; unit: string }[]>
  >;
  setDimensionMode: React.Dispatch<React.SetStateAction<boolean>>;
  setFlipX: React.Dispatch<React.SetStateAction<boolean>>;
  setPlotType: React.Dispatch<React.SetStateAction<PlotType>>;
  setPointColorBy: React.Dispatch<React.SetStateAction<"depth" | "confidence">>;
  setPointEngine: React.Dispatch<React.SetStateAction<"plotly" | "three">>;
  setShowSlice: React.Dispatch<React.SetStateAction<boolean>>;
  setSurfaceEngine: React.Dispatch<React.SetStateAction<"plotly" | "three">>;
  setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>;
  showPlot: boolean;
  surfaceEngine: "plotly" | "three";
  viewMode: ViewMode;
  zData: (number | null)[][] | null;
}) {
  return (
    <>
      <section style={panelSectionStyle}>
        <h3 style={sectionTitleStyle}>表示</h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "6px",
          }}
        >
          {/* 軸 */}
          <button
            className="tt-hover"
            disabled={!showPlot}
            onClick={() => {
              if (!showPlot) return;
              setAxisVisible((v) => !v);
            }}
            style={toolButtonStyle(axisVisible, showPlot)}
            title={axisVisible ? "軸を非表示にする" : "軸を表示する"}
          >
            <Icon size={18}>
              <line x1="4" y1="20" x2="4" y2="4" />
              <line x1="4" y1="20" x2="20" y2="20" />
              <polyline points="4 4 2 6" />
              <polyline points="4 4 6 6" />
              <polyline points="20 20 18 18" />
              <polyline points="20 20 18 22" />
            </Icon>
            軸
          </button>

          {/* 左右反転 */}
          <button
            className="tt-hover"
            disabled={!showPlot}
            onClick={() => {
              if (!showPlot) return;
              setFlipX((v) => !v);
            }}
            style={toolButtonStyle(flipX, showPlot)}
          >
            <Icon size={18}>
              <polyline points="7 8 3 12 7 16" />
              <polyline points="17 8 21 12 17 16" />
              <line x1="3" y1="12" x2="10" y2="12" />
              <line x1="14" y1="12" x2="21" y2="12" />
              <line x1="12" y1="4" x2="12" y2="20" strokeDasharray="2 2" />
            </Icon>
            左右反転
          </button>

          {/* 自動回転（表示中の Surface / 点群をそのまま回す） */}
          <button
            className="tt-hover"
            disabled={!cloud && !zData}
            onClick={() => {
              if (!cloud && !zData) return;
              const next = !autoRotate;
              if (next) {
                // 3D表示に切り替え、回転と噛み合わない2D系モードを解除
                //（Surface/Point Cloud の表示タイプは変えずに今の見た目で回す）
                setViewMode("3D");
                setShowSlice(false);
                setDimensionMode(false);
                setDimReadouts([]);
              }
              setAutoRotate(next);
            }}
            style={toolButtonStyle(autoRotate, !!(cloud || zData))}
            title="表示中の3Dグラフ（Surface / 点群）をターンテーブルのように自動回転させる"
          >
            <Icon size={18}>
              <path d="M21 12a9 9 0 1 1-2.6-6.3" />
              <polyline points="21 2 21 6 17 6" />
              <ellipse cx="12" cy="12" rx="5" ry="2" />
            </Icon>
            自動回転
          </button>
        </div>

        {/* 表示タイプ・エンジン切替 */}
        {/* 高さマップが無い点群形式CSVでは描画モードは選べず、エンジンだけ切り替える */}
        {showPlot && ((zData && zData.length > 0) || !!cloud) && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              marginTop: "14px",
            }}
          >
            {zData && zData.length > 0 && (
              <div style={settingRowStyle}>
                <span style={rowLabelStyle}>描画モード</span>
                <div style={{ ...segmentGroupStyle, width: "190px" }}>
                  {(["surface", "scatter3d"] as const).map((pt) => (
                    <button
                      key={pt}
                      className="tt-hover"
                      onClick={() => setPlotType(pt)}
                      style={segmentButtonStyle(plotType === pt)}
                    >
                      {pt === "surface" ? "Surface" : "Point Cloud"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Surface エンジン切替（Surface のときのみ） */}
            {plotType === "surface" && (
              <div style={settingRowStyle}>
                <span style={rowLabelStyle}>エンジン</span>
                <div style={{ ...segmentGroupStyle, width: "190px" }}>
                  {(["plotly", "three"] as const).map((eng) => (
                    <button
                      key={eng}
                      className="tt-hover"
                      onClick={() => setSurfaceEngine(eng)}
                      style={segmentButtonStyle(surfaceEngine === eng)}
                    >
                      {eng === "plotly" ? "Plotly" : "three.js"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 点群エンジン切替（Point Cloud のときのみ） */}
            {plotType === "scatter3d" && (
              <div style={settingRowStyle}>
                <span style={rowLabelStyle}>エンジン</span>
                <div style={{ ...segmentGroupStyle, width: "190px" }}>
                  {(["plotly", "three"] as const).map((eng) => (
                    <button
                      key={eng}
                      className="tt-hover"
                      onClick={() => setPointEngine(eng)}
                      style={segmentButtonStyle(pointEngine === eng)}
                      title={eng === "plotly" ? "最大12万点" : "高密度（最大100万点以上）"}
                    >
                      {eng === "plotly" ? "Plotly" : "three.js"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* AI の確率マップがあるとき: しきい値の変更と信頼度での色分け */}
            {aiMeta && (
              <div style={settingRowStyle}>
                <span
                  style={rowLabelStyle}
                  title="推論をやり直さずに、確率マップから縞を抜き出し直す"
                >
                  しきい値（AI）
                </span>
                <div
                  style={{
                    width: "190px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <input
                    type="range"
                    min={Math.max(0.05, aiMeta.prob_min ?? 0.05)}
                    max={0.95}
                    step={0.05}
                    value={aiThreshold ?? aiMeta.threshold ?? 0.5}
                    onChange={(e) => setAiThreshold(parseFloat(e.target.value))}
                    style={{ flex: 1, minWidth: 0, accentColor: colors.primary }}
                  />
                  <span
                    style={{
                      width: "40px",
                      textAlign: "right",
                      fontFamily: monoFont,
                      fontSize: "12px",
                      color: colors.text,
                    }}
                  >
                    {(aiThreshold ?? aiMeta.threshold ?? 0.5).toFixed(2)}
                  </span>
                </div>
              </div>
            )}
            {aiMeta && plotType === "scatter3d" && (
              <div style={settingRowStyle}>
                <span style={rowLabelStyle}>色分け</span>
                <div style={{ ...segmentGroupStyle, width: "190px" }}>
                  {(["depth", "confidence"] as const).map((mode) => (
                    <button
                      key={mode}
                      className="tt-hover"
                      onClick={() => {
                        setPointColorBy(mode);
                        // 信頼度は確率マップの点群で塗るので、まだなら推論時のしきい値で作る
                        if (mode === "confidence" && !fromProb)
                          setAiThreshold(aiMeta.threshold ?? 0.5);
                      }}
                      style={segmentButtonStyle(effectivePointColorBy === mode)}
                      title={
                        mode === "confidence"
                          ? "AI の確率（0〜1）で色分けする。低い（青い）ところは検出が怪しい"
                          : "高さ（奥行き）で色分けする"
                      }
                    >
                      {mode === "depth" ? "高さ" : "信頼度"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 奥行きの強調（点群表示のとき）。層が重なった構造を引き離して見るため */}
            {plotType === "scatter3d" && viewMode === "3D" && (
              <div style={settingRowStyle}>
                <span style={rowLabelStyle} title={heightLabel(dataSource, scale)}>
                  奥行きの強調
                </span>
                <div
                  style={{
                    width: "190px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <input
                    type="range"
                    min={0.5}
                    max={20}
                    step={0.5}
                    value={depthExaggeration}
                    onChange={(e) => setDepthExaggerationInput(e.target.value)}
                    onDoubleClick={() => setDepthExaggerationInput("1")}
                    title="ダブルクリックで ×1 に戻す（値・計測は変わらず、見た目だけ伸びる）"
                    style={{ flex: 1, minWidth: 0, accentColor: colors.primary }}
                  />
                  <span
                    style={{
                      width: "40px",
                      textAlign: "right",
                      fontFamily: monoFont,
                      fontSize: "12px",
                      color: colors.text,
                    }}
                  >
                    ×{depthExaggeration}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}
