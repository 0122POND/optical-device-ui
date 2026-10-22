import { colors, fontFamily } from "../utils/constants";

// 下段の断層グラフ（帯の幅・距離計測の操作つき）
export function SlicePanel({
  setSliceBandUm,
  setSliceMeasureEnd,
  setSliceMeasureMode,
  setSliceMeasureStart,
  showSlice,
  sliceBandUm,
  sliceMeasureEnd,
  sliceMeasureMode,
  sliceMeasureStart,
  sliceRef,
  viewZ,
}: {
  setSliceBandUm: React.Dispatch<React.SetStateAction<number>>;
  setSliceMeasureEnd: React.Dispatch<React.SetStateAction<{ t: number; d: number } | null>>;
  setSliceMeasureMode: React.Dispatch<React.SetStateAction<boolean>>;
  setSliceMeasureStart: React.Dispatch<React.SetStateAction<{ t: number; d: number } | null>>;
  showSlice: boolean;
  sliceBandUm: number;
  sliceMeasureEnd: { t: number; d: number } | null;
  sliceMeasureMode: boolean;
  sliceMeasureStart: { t: number; d: number } | null;
  sliceRef: React.RefObject<HTMLDivElement | null>;
  viewZ: (number | null)[][] | null;
}) {
  return (
    <>
      {showSlice && (
        <div
          style={{
            height: "260px",
            flexShrink: 0,
            position: "relative",
            borderTop: `1px solid ${colors.border}`,
          }}
        >
          <div ref={sliceRef} style={{ width: "100%", height: "100%" }} />
          {/* 2点間距離計測の操作（ON/OFFトグル＋クリア） */}
          <div
            style={{
              position: "absolute",
              top: "6px",
              right: "10px",
              zIndex: 5,
              display: "flex",
              gap: "6px",
            }}
          >
            {/* 帯の幅（高さマップがあるとき）。帯なら幅の中の画素の中央値で断面を描く */}
            {viewZ && viewZ.length > 0 && (
              <div
                title="断面線の両側 ±幅/2 の画素を集めて横から見る（線は距離ごとの中央値、薄い帯は P10〜P90）"
                style={{ display: "flex", alignItems: "center", gap: "2px" }}
              >
                <span style={{ fontSize: "11px", color: colors.textMuted, marginRight: "4px" }}>
                  帯の幅
                </span>
                {[0, 200, 500, 1000].map((w) => (
                  <button
                    key={w}
                    onClick={() => setSliceBandUm(w)}
                    style={{
                      padding: "4px 8px",
                      fontSize: "11px",
                      fontWeight: 600,
                      fontFamily,
                      borderRadius: "4px",
                      border: `1px solid ${sliceBandUm === w ? colors.primary : colors.border}`,
                      backgroundColor:
                        sliceBandUm === w ? colors.primarySoft : "rgba(22, 27, 34, 0.86)",
                      color: sliceBandUm === w ? colors.primary : colors.text,
                      cursor: "pointer",
                    }}
                  >
                    {w === 0 ? "線" : `${w} µm`}
                  </button>
                ))}
              </div>
            )}
            {/* 計測中で2点が確定済みのときだけ「クリア」を出す（やり直し用） */}
            {sliceMeasureMode && sliceMeasureStart && sliceMeasureEnd && (
              <button
                onClick={() => {
                  setSliceMeasureStart(null);
                  setSliceMeasureEnd(null);
                }}
                style={{
                  padding: "4px 10px",
                  fontSize: "11px",
                  fontWeight: 600,
                  fontFamily,
                  borderRadius: "4px",
                  border: `1px solid ${colors.border}`,
                  backgroundColor: "rgba(22, 27, 34, 0.86)",
                  color: colors.text,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                クリア
              </button>
            )}
            <button
              onClick={() => setSliceMeasureMode((v) => !v)}
              style={{
                padding: "4px 10px",
                fontSize: "11px",
                fontWeight: 600,
                fontFamily,
                borderRadius: "4px",
                border: `1px solid ${sliceMeasureMode ? colors.primary : colors.borderLight}`,
                backgroundColor: sliceMeasureMode ? colors.primary : "rgba(22, 27, 34, 0.86)",
                color: sliceMeasureMode ? colors.onPrimary : colors.text,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {!sliceMeasureMode
                ? "距離計測"
                : sliceMeasureStart && sliceMeasureEnd
                  ? "計測中（端点ドラッグで調整）"
                  : "計測中（2点クリック）"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
