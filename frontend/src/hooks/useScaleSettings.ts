import { useMemo } from "react";
import { usePersistentState } from "./usePersistentState";
import { DEFAULT_UM_PER_PIXEL_X, DEFAULT_UM_PER_PIXEL_Y } from "../utils/constants";
import type { ScaleInputs } from "../utils/units";

// 単位換算・色レンジ・奥行きの強調の設定（設定タブの入力値。ブラウザに保存し、リロードしても残す）と、
// 入力値を数値にした µm 換算の設定一式（scale）
export function useScaleSettings() {
  // 掃引間隔の入力値（単位は µm 固定）
  // 設定値はブラウザに保存し、リロードしても残す
  const [sweepInterval, setSweepInterval] = usePersistentState("sweepInterval", "100");
  // ヒートマップのカラーレンジ手動指定（µm, 空文字=自動）。範囲外はグレー表示
  const [colorRangeMin, setColorRangeMin] = usePersistentState("colorRangeMin", "");
  const [colorRangeMax, setColorRangeMax] = usePersistentState("colorRangeMax", "");
  // X/Y軸 µm/pix 換算係数（可変設定）
  const [umPerPixelXInput, setUmPerPixelXInput] = usePersistentState(
    "umPerPixelX",
    String(DEFAULT_UM_PER_PIXEL_X)
  );
  const [umPerPixelYInput, setUmPerPixelYInput] = usePersistentState(
    "umPerPixelY",
    String(DEFAULT_UM_PER_PIXEL_Y)
  );
  // CSV（高さマップ）の列・行ピッチ µm/px。CSV は装置ごとにピッチが違うため個別に持つ
  const [csvPitchXInput, setCsvPitchXInput] = usePersistentState("csvPitchX", "10");
  const [csvPitchYInput, setCsvPitchYInput] = usePersistentState("csvPitchY", "10");
  // CSV の高さの単位（µm / 未校正の px）と、px のときの µm/px（空欄=未校正）
  const [csvHeightUnit, setCsvHeightUnit] = usePersistentState("csvHeightUnit", "um");
  const [csvUmPerHeightPxInput, setCsvUmPerHeightPxInput] = usePersistentState(
    "csvUmPerHeightPx",
    ""
  );
  // 点群表示の奥行きの強調（1=従来の見え方。値・計測は変えず見た目だけ伸ばす）
  const [depthExaggerationInput, setDepthExaggerationInput] = usePersistentState(
    "depthExaggeration",
    "1"
  );
  const depthExaggeration = (() => {
    const v = parseFloat(depthExaggerationInput);
    return !isNaN(v) && v > 0 ? v : 1;
  })();
  const umPerPixelX = (() => {
    const v = parseFloat(umPerPixelXInput);
    return !isNaN(v) && v > 0 ? v : DEFAULT_UM_PER_PIXEL_X;
  })();
  const umPerPixelY = (() => {
    const v = parseFloat(umPerPixelYInput);
    return !isNaN(v) && v > 0 ? v : DEFAULT_UM_PER_PIXEL_Y;
  })();

  const csvPitchX = (() => {
    const v = parseFloat(csvPitchXInput);
    return !isNaN(v) && v > 0 ? v : 10;
  })();
  const csvPitchY = (() => {
    const v = parseFloat(csvPitchYInput);
    return !isNaN(v) && v > 0 ? v : 10;
  })();
  const csvUmPerHeightPx = (() => {
    const v = parseFloat(csvUmPerHeightPxInput);
    return !isNaN(v) && v > 0 ? v : null;
  })();
  const csvHeightUnitValue: "um" | "px" = csvHeightUnit === "px" ? "px" : "um";
  // µm 換算の設定一式（描画 effect の依存に入るので参照を安定させる）
  const scale = useMemo<ScaleInputs>(
    () => ({
      umPerPixelX,
      umPerPixelY,
      sweepInterval,
      csvPitchX,
      csvPitchY,
      csvHeightUnit: csvHeightUnitValue,
      csvUmPerHeightPx,
    }),
    [
      umPerPixelX,
      umPerPixelY,
      sweepInterval,
      csvPitchX,
      csvPitchY,
      csvHeightUnitValue,
      csvUmPerHeightPx,
    ]
  );

  return {
    sweepInterval,
    setSweepInterval,
    colorRangeMin,
    setColorRangeMin,
    colorRangeMax,
    setColorRangeMax,
    umPerPixelXInput,
    setUmPerPixelXInput,
    umPerPixelYInput,
    setUmPerPixelYInput,
    csvPitchXInput,
    setCsvPitchXInput,
    csvPitchYInput,
    setCsvPitchYInput,
    csvHeightUnit,
    setCsvHeightUnit,
    csvUmPerHeightPxInput,
    setCsvUmPerHeightPxInput,
    depthExaggerationInput,
    setDepthExaggerationInput,
    depthExaggeration,
    umPerPixelX,
    umPerPixelY,
    csvPitchX,
    csvPitchY,
    csvUmPerHeightPx,
    csvHeightUnitValue,
    scale,
  };
}
