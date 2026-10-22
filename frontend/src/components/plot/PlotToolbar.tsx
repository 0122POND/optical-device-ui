import type { DragMode } from "../../types";
import { Icon } from "../Icon";
import { floatingGroupStyle, iconButtonStyle, segmentButtonStyle } from "../../utils/styles";
import type { ViewMode, ViewPresetKind } from "../../types";
import { ViewPresetBar } from "./ViewPresetBar";

// プロット左上のフローティングツールバー（3D/2D・画像保存・ズーム・パン・回転・視点リセット）
export function PlotToolbar({
  dragMode,
  handleCameraReset,
  handleDownload,
  handleDragMode,
  handleViewPreset,
  handleZoom,
  setDimensionMode,
  setShowSlice,
  setViewMode,
  showPlot,
  viewMode,
}: {
  dragMode: DragMode;
  handleCameraReset: () => void;
  handleDownload: () => Promise<void>;
  handleDragMode: (mode: DragMode) => void;
  handleViewPreset: (kind: Exclude<ViewPresetKind, "reset">) => void;
  handleZoom: (factor: number) => void;
  setDimensionMode: React.Dispatch<React.SetStateAction<boolean>>;
  setShowSlice: React.Dispatch<React.SetStateAction<boolean>>;
  setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>;
  showPlot: boolean;
  viewMode: ViewMode;
}) {
  return (
    <>
      <div
        style={{
          position: "absolute",
          top: "12px",
          left: "12px",
          zIndex: 20,
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
        }}
      >
        <div style={floatingGroupStyle}>
          {(
            [
              { key: "3D", label: "3D" },
              { key: "2D-camera", label: "2D" },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              className="tt-hover"
              onClick={() => {
                setViewMode(key);
                if (key === "3D") {
                  setShowSlice(false);
                  setDimensionMode(false);
                }
              }}
              style={{ ...segmentButtonStyle(viewMode === key, 30), flex: "none" }}
            >
              {key === "3D" ? (
                <Icon>
                  <path d="M12 2 3 7v10l9 5 9-5V7z" />
                  <path d="M3 7l9 5 9-5M12 12v10" />
                </Icon>
              ) : (
                <Icon>
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                  <path d="M4 12h16M12 4v16" />
                </Icon>
              )}
              {label}
            </button>
          ))}
        </div>

        <div style={floatingGroupStyle}>
          <button
            title="画像保存"
            className="tt-hover"
            style={iconButtonStyle()}
            onClick={handleDownload}
          >
            <Icon>
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-5-5L5 21" />
            </Icon>
          </button>
          <button
            title="ズームイン"
            className="tt-hover"
            style={iconButtonStyle()}
            onClick={() => handleZoom(0.8)}
          >
            <Icon>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5M11 8v6M8 11h6" />
            </Icon>
          </button>
          <button
            title="ズームアウト"
            className="tt-hover"
            style={iconButtonStyle()}
            onClick={() => handleZoom(1.25)}
          >
            <Icon>
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5M8 11h6" />
            </Icon>
          </button>
          <button
            title="パン"
            className="tt-hover"
            style={iconButtonStyle(dragMode === "pan")}
            onClick={() => handleDragMode("pan")}
          >
            <Icon>
              <path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8a8 8 0 0 0 16 0v-3a2 2 0 0 0-4 0" />
            </Icon>
          </button>
          <button
            title="回転 (Turntable)"
            className="tt-hover"
            style={iconButtonStyle(dragMode === "turntable")}
            onClick={() => handleDragMode("turntable")}
          >
            <Icon>
              <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
              <path d="M21 3v5h-5" />
            </Icon>
          </button>
          <button
            title="回転 (Orbital)"
            className="tt-hover"
            style={iconButtonStyle(dragMode === "orbit")}
            onClick={() => handleDragMode("orbit")}
          >
            <Icon>
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
            </Icon>
          </button>
          <button
            title="カメラリセット"
            className="tt-hover"
            style={iconButtonStyle()}
            onClick={handleCameraReset}
          >
            <Icon>
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <path d="M3 3v5h5" />
            </Icon>
          </button>
        </div>

        {/* 視点のプリセット（3D表示のときだけ） */}
        <ViewPresetBar
          handleViewPreset={handleViewPreset}
          showPlot={showPlot}
          viewMode={viewMode}
        />
      </div>
    </>
  );
}
