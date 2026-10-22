import { floatingGroupStyle, segmentButtonStyle } from "../../utils/styles";
import type { ViewMode, ViewPresetKind } from "../../types";

// 視点のプリセット（正面・側面・上面）。3D表示のときだけ
export function ViewPresetBar({
  handleViewPreset,
  showPlot,
  viewMode,
}: {
  handleViewPreset: (kind: Exclude<ViewPresetKind, "reset">) => void;
  showPlot: boolean;
  viewMode: ViewMode;
}) {
  return (
    <>
      {viewMode === "3D" && showPlot && (
        <div style={floatingGroupStyle}>
          {(
            [
              { kind: "front", label: "正面", title: "正面（横方向×奥行き）" },
              { kind: "side", label: "側面", title: "側面（縦方向×奥行き）" },
              { kind: "top", label: "上面", title: "上面（横方向×縦方向）" },
            ] as const
          ).map(({ kind, label, title }) => (
            <button
              key={kind}
              title={`${title}。カメラリセットで元の視点に戻る`}
              className="tt-hover"
              style={{
                // 押した瞬間に視点を切り替えるだけ（手で回すと向きが変わるので選択状態は持たない）
                ...segmentButtonStyle(false, 30),
                flex: "none",
                padding: "0 10px",
              }}
              onClick={() => handleViewPreset(kind)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
