import { type DataSource } from "../../utils/units";
import type { PlotType } from "../../types";

// プロット左下のチップ（描画モード・エンジン・データの出どころ・換算）
export function PlotInfoChips({
  chip,
  chipValue,
  csvPitchX,
  csvPitchY,
  dataSource,
  engineLabel,
  plotType,
  showPlot,
  sweepInterval,
  umPerPixelX,
  umPerPixelY,
}: {
  chip: (children: React.ReactNode) => React.JSX.Element;
  chipValue: (v: React.ReactNode) => React.JSX.Element;
  csvPitchX: number;
  csvPitchY: number;
  dataSource: DataSource;
  engineLabel: "three.js" | "Plotly";
  plotType: PlotType;
  showPlot: boolean;
  sweepInterval: string;
  umPerPixelX: number;
  umPerPixelY: number;
}) {
  return (
    <>
      {showPlot && (
        <div
          style={{
            position: "absolute",
            left: "12px",
            bottom: "12px",
            zIndex: 20,
            display: "flex",
            gap: "6px",
            pointerEvents: "none",
          }}
        >
          {chip(
            <>
              {plotType === "surface" ? "Surface" : "Point Cloud"} · {chipValue(engineLabel)}
            </>
          )}
          {/* 表示中データに実際に効いている換算を出す（CSV なら CSV のピッチ） */}
          {dataSource === "csv" ? (
            <>
              {chip(<>CSV</>)}
              {chip(<>ピッチ {chipValue(`${csvPitchX} × ${csvPitchY} µm/px`)}</>)}
            </>
          ) : (
            <>
              {chip(<>掃引 {chipValue(sweepInterval ? `${sweepInterval} µm` : "—")}</>)}
              {chip(
                <>
                  X {chipValue(umPerPixelX)} · Y {chipValue(`${umPerPixelY} µm/px`)}
                </>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
